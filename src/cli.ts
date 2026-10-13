#!/usr/bin/env node

/**
 * AutoTestLoop 自然语言测试入口。
 * 用法:
 *   pnpm run auto -- --goal "检查定价页是否展示免费方案" --url "https://example.com/pricing"
 */

import dotenv from "dotenv";
import { chromium } from "playwright";
import { runAiUiTest } from "./core/runner.js";
import { jevDecisionName } from "./llm/jev-decider.js";
import { createAutoLLMProvider } from "./llm/provider.js";
import { TestGoal } from "./types/index.js";

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  dotenv.config();
  const args = process.argv.slice(2);
  const goalText = readArg(args, "--goal") || "打开页面，确认主要内容和关键操作入口可见";
  const url = readArg(args, "--url") || process.env.WEB_URL;
  if (!url) throw new Error("缺少 --url 或 WEB_URL");
  const reportDir = readArg(args, "--report-dir") || "test/reports/auto";
  const screenshotDir = readArg(args, "--screenshot-dir") || "test/screenshots/auto";
  const headless = !args.includes("--headed");
  const context: Record<string, string> = {};
  if (process.env.TEST_EMAIL) context.email = process.env.TEST_EMAIL;
  if (process.env.TEST_USERNAME) context.username = process.env.TEST_USERNAME;
  if (process.env.TEST_PASSWORD) context.password = process.env.TEST_PASSWORD;

  const goal: TestGoal = {
    id: "auto_" + Date.now(),
    name: "自然语言自主测试",
    description: goalText,
    targetUrl: url,
    initialContext: context,
    maxSteps: Number(process.env.AUTO_MAX_STEPS || "12"),
  };
  const llmProvider = createAutoLLMProvider();

  console.log("AutoTestLoop");
  console.log("目标: " + goalText);
  console.log("页面: " + url);
  console.log("决策模型: " + jevDecisionName());
  console.log("分析模型: " + (llmProvider ? llmProvider.name : "本地启发式分析"));

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const report = await runAiUiTest(goal, page, {
      llmProvider,
      autonomous: true,
      screenshotDir,
      reportDir,
    });
    console.log("结果: " + report.overallStatus + " (" + report.durationMs + "ms)");
    console.log("报告: " + reportDir + "/report-" + goal.id + ".html");
    process.exitCode = report.overallStatus === "FAIL" ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
