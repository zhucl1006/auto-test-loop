#!/usr/bin/env node

/**
 * AiReach 在 AutoTestLoop 上的 UI 回归调度器。
 *
 * 用法:
 *   pnpm run aireach:ui
 *   SUITE=smoke pnpm run aireach:ui
 *   SUITE=functional pnpm run aireach:ui
 *   SUITE=admin pnpm run aireach:ui
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createCatalog, selectScenarios, detailScenario } from "./catalog.mjs";
import { badge, escapeHtml, writeJson, writeTableReport } from "./report.mjs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const WEB_URL = (process.env.WEB_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const BFF_URL = (process.env.BFF_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const REPORT_DIR = path.join(ROOT_DIR, "test/reports/ai-ui");
const SCREENSHOT_DIR = path.join(ROOT_DIR, "test/screenshots/ai-ui");

const { runAiUiTest, createAutoLLMProvider } = await import(
  path.join(ROOT_DIR, "dist/index.js")
);

function isPass(status) {
  return status === "PASS" || status === "HEALED";
}

async function assertServices() {
  const web = await fetch(WEB_URL + "/healthz").then((res) => res.ok).catch(() => false);
  const bff = await fetch(BFF_URL + "/api/health").then((res) => res.ok).catch(() => false);
  if (!web || !bff) {
    throw new Error("Web 或 BFF 未就绪。请先执行 pnpm run services:up，不要用本机 Node 启动服务。");
  }
}

function orderScenarios(items) {
  const rank = { public: 0, auth: 1, smoke: 2, functional: 3, admin: 4 };
  return [...items].sort((a, b) => (rank[a.layer] ?? 9) - (rank[b.layer] ?? 9));
}

async function discoverDetails(context) {
  const page = await context.newPage();
  const found = [];
  try {
    await page.goto(WEB_URL + "/app/contacts", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1200);
    const contactId = await page
      .locator('[data-testid^="contact-list-page-table-row-"]')
      .first()
      .getAttribute("data-testid")
      .catch(() => null);
    if (contactId) {
      found.push(detailScenario("contact", contactId, "/app/contacts/"));
    }

    await page.goto(WEB_URL + "/app/campaigns", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1200);
    const campaignId = await page
      .locator('[data-testid^="campaign-list-page-table-btn-view-"]')
      .first()
      .getAttribute("data-testid")
      .catch(() => null);
    if (campaignId) {
      found.push(detailScenario("campaign", campaignId, "/app/campaigns/"));
    }
  } finally {
    await page.close().catch(() => {});
  }
  return found;
}

async function detectProductAccess(context) {
  const page = await context.newPage();
  try {
    await page.goto(WEB_URL + "/app", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);
    const denied = await page
      .locator('[data-testid="access-denied-page-div-container"]')
      .isVisible()
      .catch(() => false);
    const shell = await page
      .locator('[data-testid*="sidebar"]')
      .first()
      .isVisible()
      .catch(() => false);
    return { denied, shell, url: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

function classify(scenario, report) {
  if (!scenario.optional || isPass(report.overallStatus)) return report.overallStatus;
  const lastUrl = report.stepResults?.at?.(-1)?.urlAfter || "";
  let expectedPath = "";
  try {
    expectedPath = new URL(scenario.targetUrl).pathname;
  } catch {
    expectedPath = scenario.targetUrl;
  }
  if (!lastUrl.includes(expectedPath)) return "SKIPPED";
  return "FAIL";
}

function thumbnail(report) {
  const shots = report.screenshots || [];
  const last = shots[shots.length - 1];
  if (!last || !fs.existsSync(last)) return "<span>无截图</span>";
  const data = fs.readFileSync(last).toString("base64");
  return '<a href="data:image/png;base64,' + data + '" target="_blank"><img alt="截图" src="data:image/png;base64,' + data + '" style="height:46px;border:1px solid #cbd5e1;border-radius:4px"></a>';
}

async function runSuite() {
  await assertServices();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const suiteName = process.env.SUITE || "all";
  let scenarios = orderScenarios(selectScenarios(createCatalog(), suiteName));
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const results = [];
  let authBlocked = false;
  let accessBlocked = false;

  const browser = await chromium.launch({
    headless: process.env.AI_UI_HEADED !== "1",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const llmProvider = createAutoLLMProvider();
  const jevModule = await import(
    path.join(ROOT_DIR, "dist/llm/jev-decider.js")
  );
  console.log("AutoTestLoop 回归套件: " + suiteName + " / " + scenarios.length + " 个目录场景");
  console.log("决策模型: " + jevModule.jevDecisionName());
  console.log("分析模型: " + (llmProvider ? llmProvider.name : "本地启发式分析"));

  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    if ((authBlocked || accessBlocked) && (scenario.requiresAuth || scenario.optional)) {
      results.push({
        id: scenario.id,
        name: scenario.name,
        module: scenario.module,
        layer: scenario.layer,
        status: "SKIPPED",
        durationMs: 0,
        note: accessBlocked
          ? "当前账号产品授权未开通，业务页未执行"
          : "登录未通过，后续鉴权场景未执行",
        reportFile: "",
      });
      console.log("SKIP " + scenario.id + (accessBlocked ? " 产品授权未开通" : " 登录未通过"));
      continue;
    }

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    try {
      const report = await runAiUiTest(scenario, page, {
        llmProvider,
        screenshotDir: SCREENSHOT_DIR,
        reportDir: REPORT_DIR,
        verbose: process.env.AI_UI_VERBOSE === "1",
      });
      const status = classify(scenario, report);
      const note = report.diagnosis
        ? "[" + report.diagnosis.category + "] " + report.diagnosis.rootCause
        : status === "SKIPPED"
          ? "可选场景未进入目标页"
          : "";
      results.push({
        id: scenario.id,
        name: scenario.name,
        module: scenario.module,
        layer: scenario.layer,
        status,
        durationMs: report.durationMs,
        note,
        consoleErrors: consoleErrors.slice(0, 5),
        reportFile: "report-" + scenario.id + ".html",
        thumbnail: thumbnail(report),
      });
      console.log(status + " " + scenario.id + " " + report.durationMs + "ms");
      if (scenario.layer === "auth" && !isPass(status)) authBlocked = true;
      if (scenario.layer === "auth" && isPass(status)) {
        const access = await detectProductAccess(context);
        if (access.denied) {
          accessBlocked = true;
          results.push({
            id: "SCENARIO-ACCESS-DENIED",
            name: "产品授权拒绝页",
            module: "access",
            layer: "auth",
            status: "PASS",
            durationMs: 0,
            note: "账号未被授权使用 AiReach，已验证拒绝页。开通授权后才会执行业务页。",
            reportFile: "",
            thumbnail: "",
          });
          console.log("PASS SCENARIO-ACCESS-DENIED 产品授权未开通");
        } else if (!access.shell) {
          authBlocked = true;
          console.log("FAIL 登录后既无工作台也无授权拒绝页");
        }
      }
      if (scenario.layer === "auth" && isPass(status) && !accessBlocked && suiteName !== "public") {
        const details = await discoverDetails(context);
        const missing = details.filter((item) => !scenarios.some((current) => current.id === item.id));
        if (missing.length > 0) {
          scenarios.splice(index + 1, 0, ...missing);
          console.log("发现详情场景: " + missing.map((item) => item.id).join(", "));
        }
      }
    } catch (err) {
      results.push({
        id: scenario.id,
        name: scenario.name,
        module: scenario.module,
        layer: scenario.layer,
        status: "FAIL",
        durationMs: 0,
        note: err.message,
        reportFile: "",
        thumbnail: "",
      });
      console.log("FAIL " + scenario.id + " " + err.message);
      if (scenario.layer === "auth") authBlocked = true;
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close();

  const summary = {
    title: "AiReach AutoTestLoop 全功能回归",
    suite: suiteName,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    webUrl: WEB_URL,
    counts: {
      total: results.length,
      passed: results.filter((item) => isPass(item.status)).length,
      failed: results.filter((item) => item.status === "FAIL").length,
      skipped: results.filter((item) => item.status === "SKIPPED").length,
    },
    scenarios: results.map(({ thumbnail: _thumbnail, ...item }) => item),
  };
  const jsonPath = path.join(REPORT_DIR, "summary.json");
  writeJson(jsonPath, summary);
  const htmlPath = path.join(REPORT_DIR, "summary-report.html");
  writeTableReport({
    file: htmlPath,
    title: "AiReach AutoTestLoop 全功能回归报告",
    subtitle:
      "套件 " +
      escapeHtml(suiteName) +
      " · 通过 " +
      summary.counts.passed +
      " · 失败 " +
      summary.counts.failed +
      " · 跳过 " +
      summary.counts.skipped +
      " · 耗时 " +
      summary.durationMs +
      "ms",
    headers: ["场景", "模块", "层级", "状态", "耗时", "截图", "诊断", "明细"],
    rows: results.map((item) => [
      "<code>" + escapeHtml(item.id) + "</code><br>" + escapeHtml(item.name),
      escapeHtml(item.module),
      escapeHtml(item.layer),
      badge(item.status),
      String(item.durationMs) + "ms",
      item.thumbnail || "",
      escapeHtml(item.note || ""),
      item.reportFile ? '<a href="' + item.reportFile + '">详情</a>' : "",
    ]),
  });
  fs.copyFileSync(htmlPath, path.join(ROOT_DIR, "test/reports/summary-report.html"));
  console.log("报告: " + htmlPath);
  console.log("JSON: " + jsonPath);
  if (summary.counts.failed > 0) process.exitCode = 1;
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
