#!/usr/bin/env node

/**
 * AutoTestLoop 示例项目的定期回归入口：API 功能 + UI 全功能。
 * 压力测试不在默认门禁内，需单独 pnpm run aireach:load。
 */

import { spawn } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";
import { escapeHtml, writeTableReport, badge } from "./report.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: "inherit", cwd: ROOT_DIR, env: process.env });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const jobs = [];
if (process.env.SKIP_API !== "1") {
  jobs.push({ id: "api", name: "API 功能回归", command: "node targets/aireach/api-functional.mjs", report: "api/api-functional.html" });
}
if (process.env.SKIP_UI !== "1") {
  jobs.push({ id: "ai-ui", name: "AutoTestLoop UI 全功能回归", command: "node targets/aireach/run-suite.mjs", report: "ai-ui/summary-report.html" });
}
if (process.env.RUN_LOAD === "1") {
  jobs.push({ id: "load", name: "只读压力测试", command: "node targets/aireach/load-regression.mjs", report: "load/load-" + (process.env.LOAD_PROFILE || "smoke") + ".html" });
}

const results = [];
for (const job of jobs) {
  const started = Date.now();
  const code = await run(job.command);
  results.push({ ...job, status: code === 0 ? "PASS" : "FAIL", durationMs: Date.now() - started });
}

const htmlPath = path.join(ROOT_DIR, "test/reports/qa-index.html");
writeTableReport({
  file: htmlPath,
  title: "AiReach 定期回归总报告",
  subtitle: "失败项会让本命令返回非 0。压力测试默认不跑。",
  headers: ["套件", "状态", "耗时", "报告"],
  rows: results.map((item) => [
    escapeHtml(item.name),
    badge(item.status),
    item.durationMs + "ms",
    '<a href="' + item.report + '">打开报告</a>',
  ]),
});
console.log("总报告: " + htmlPath);
if (results.some((item) => item.status === "FAIL")) process.exit(1);
