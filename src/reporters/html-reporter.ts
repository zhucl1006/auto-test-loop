/**
 * 交互式现代化 HTML 测试报告生成器
 * 包含：
 * - 总体执行状态看板 (PASS / FAIL / HEALED)
 * - 01~05 阶段执行时间线 (Timeline)
 * - 单步操作决策记录 (Jev Action Decision)
 * - 现场截图与控制台报错回溯
 * - 自愈诊断卡片 (Root Cause & Suggested Fix)
 */

import * as fs from "fs";
import * as path from "path";
import { AiUiTestReport } from "../types/index.js";

export class HtmlReporter {
  static generate(report: AiUiTestReport, outputDir: string): string {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const statusBadgeColor =
      report.overallStatus === "PASS"
        ? "#10b981"
        : report.overallStatus === "HEALED"
          ? "#3b82f6"
          : "#ef4444";

    const stepsHtml = report.stepResults
      .map((step) => {
        const isSuccess = step.status === "SUCCESS";
        let imageTag = "";
        if (step.screenshotPath && fs.existsSync(step.screenshotPath)) {
          try {
            const base64 = fs.readFileSync(step.screenshotPath).toString("base64");
            const dataUrl = `data:image/png;base64,${base64}`;
            imageTag = `
            <div class="screenshot-box">
              <a href="${dataUrl}" target="_blank" title="点击查看原图">
                <img src="${dataUrl}" alt="现场截图" style="border: 1px solid #cbd5e1; border-radius: 6px; max-width: 100%; max-height: 320px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" />
              </a>
              <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">📸 实时截图: <code>${path.basename(step.screenshotPath)}</code></div>
            </div>`;
          } catch {
            imageTag = `<div class="screenshot-box"><img src="${step.screenshotPath}" alt="现场截图" /></div>`;
          }
        }

        return `
        <div class="step-card ${isSuccess ? "success" : "failed"}">
          <div class="step-header">
            <span class="step-badge ${isSuccess ? "badge-success" : "badge-danger"}">步骤 ${step.stepIndex}</span>
            <span class="step-intent">${step.action.action.toUpperCase()}</span>
            <span class="step-duration">${step.durationMs}ms</span>
          </div>
          <div class="step-body">
            <p><strong>操作意图：</strong>${step.plannedStep?.description || step.action.reasoning}</p>
            <p><strong>决策原因 (Jev)：</strong>${step.action.reasoning} (置信度: ${(step.action.confidence * 100).toFixed(0)}%)</p>
            ${step.action.selector ? `<p><strong>选择器：</strong><code>${step.action.selector}</code></p>` : ""}
            ${step.action.value ? `<p><strong>输入载荷：</strong><code>${step.action.value}</code></p>` : ""}
            ${step.error ? `<div class="error-box"><strong>执行异常：</strong>${step.error}</div>` : ""}
            ${imageTag}
          </div>
        </div>
      `;
      })
      .join("");

    const assertionsHtml = report.assertionResults
      .map(
        (a) => `
      <div class="assertion-item ${a.passed ? "assert-pass" : "assert-fail"}">
        <span class="assert-icon">${a.passed ? "✓" : "✗"}</span>
        <div class="assert-info">
          <strong>${a.description}</strong> (${a.type})
          <div class="assert-detail">期望: ${a.expected} | 实际: ${a.actual || a.message}</div>
        </div>
      </div>
    `,
      )
      .join("");

    const diagnosisHtml = report.diagnosis
      ? `
      <div class="diagnosis-card">
        <h3>🔍 LLM 根因诊断与自愈分析 (Step 05)</h3>
        <div class="diagnosis-meta">
          <span class="category-badge">${report.diagnosis.category}</span>
          <span>是否可自愈: <strong>${report.diagnosis.canSelfHeal ? "是 (Self-Healed)" : "否 (需要研发介入)"}</strong></span>
        </div>
        <p><strong>根本原因：</strong>${report.diagnosis.rootCause}</p>
        <p><strong>修复建议：</strong>${report.diagnosis.suggestedFix}</p>
      </div>
    `
      : "";

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>AutoTestLoop 测试报告 - ${report.goal.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; }
    .header { background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .status-badge { font-size: 1.25rem; font-weight: 700; color: #fff; padding: 8px 18px; border-radius: 9999px; background: ${statusBadgeColor}; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; font-size: 0.9rem; color: #64748b; }
    .section-title { font-size: 1.2rem; font-weight: 600; margin: 24px 0 12px; color: #0f172a; }
    .step-card { background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 12px; overflow: hidden; }
    .step-card.failed { border-left: 4px solid #ef4444; }
    .step-card.success { border-left: 4px solid #10b981; }
    .step-header { padding: 12px 16px; background: #f1f5f9; display: flex; align-items: center; gap: 12px; font-size: 0.85rem; font-weight: 600; }
    .step-badge { padding: 2px 8px; border-radius: 4px; color: #fff; }
    .badge-success { background: #10b981; }
    .badge-danger { background: #ef4444; }
    .step-duration { margin-left: auto; color: #64748b; }
    .step-body { padding: 16px; font-size: 0.9rem; line-height: 1.6; }
    .step-body p { margin: 4px 0; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .error-box { background: #fef2f2; color: #991b1b; padding: 8px 12px; border-radius: 6px; margin-top: 8px; }
    .screenshot-box { margin-top: 12px; }
    .screenshot-box img { max-width: 100%; max-height: 280px; border-radius: 6px; border: 1px solid #cbd5e1; }
    .assertion-item { background: #fff; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; border: 1px solid #e2e8f0; }
    .assert-pass { border-left: 4px solid #10b981; }
    .assert-fail { border-left: 4px solid #ef4444; }
    .assert-icon { font-size: 1.2rem; font-weight: bold; }
    .assert-pass .assert-icon { color: #10b981; }
    .assert-fail .assert-icon { color: #ef4444; }
    .assert-detail { font-size: 0.85rem; color: #64748b; margin-top: 2px; }
    .diagnosis-card { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 16px; margin-top: 20px; }
    .diagnosis-card h3 { margin-top: 0; color: #9a3412; }
    .category-badge { background: #ea580c; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 style="margin: 0; font-size: 1.5rem;">${report.goal.name}</h1>
        <p style="margin: 6px 0 0; color: #64748b;">${report.goal.description}</p>
        <div class="meta-grid">
          <div>目标地址: <code>${report.goal.targetUrl}</code></div>
          <div>总耗时: <strong>${report.durationMs}ms</strong></div>
          <div>开始时间: ${report.startTime}</div>
        </div>
      </div>
      <div>
        <span class="status-badge">${report.overallStatus}</span>
      </div>
    </div>

    ${diagnosisHtml}

    <div class="section-title">🚦 验证断言 (Step 04)</div>
    <div class="assertions-container">
      ${assertionsHtml}
    </div>

    <div class="section-title">🪜 操作执行流 (Step 01 ~ Step 03)</div>
    <div class="steps-container">
      ${stepsHtml}
    </div>
  </div>
</body>
</html>`;

    const filePath = path.join(outputDir, `report-${report.goal.id}.html`);
    fs.writeFileSync(filePath, html, "utf-8");
    return filePath;
  }
}
