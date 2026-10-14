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
import { resolveReportLanguage } from "../config/report-language.js";
import { formatTokenCount } from "../llm/token-usage.js";
import { redactSecrets } from "../core/goal-context.js";
import { AiUiTestReport, StepExecutionResult } from "../types/index.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function renderRounds(rounds: NonNullable<AiUiTestReport["rounds"]>): string {
  if (!rounds.length) return `<p class="round-meta">这次运行没有分轮规划。</p>`;
  return rounds.map((round) => `
    <article class="round-card">
      <h3>第 ${round.round} 轮${round.complete ? " · 判断目标已完成" : ""}${round.modalOpen ? " · 模态窗口" : ""}</h3>
      <div class="round-meta">${escapeHtml(round.url)}</div>
      <p><strong>意图：</strong>${escapeHtml(round.summary || "未命名")}</p>
      <ul>
        ${round.steps.map((step) => `<li>步骤：${escapeHtml(step.intent)} · ${escapeHtml(step.semanticTarget)} · ${escapeHtml(step.description)}</li>`).join("")}
        ${round.assertions.map((item) => `<li>断言：${escapeHtml(item.description)} · ${escapeHtml(item.type)} · ${escapeHtml(item.expected)}</li>`).join("")}
        ${!round.steps.length && !round.assertions.length ? "<li>没有新的步骤或断言</li>" : ""}
      </ul>
    </article>`).join("");
}

function screenshotButton(src: string, name: string): string {
  return `
            <div class="screenshot-box">
              <button type="button" class="shot-open" data-name="${escapeHtml(name)}" title="点击放大查看">
                <img src="${src}" alt="现场截图" />
              </button>
              <div class="shot-hint">点击图片放大查看 · ${escapeHtml(name)}</div>
            </div>`;
}

function displayInput(step: StepExecutionResult, secrets: Array<string | undefined>): string {
  const target = (step.plannedStep?.semanticTarget || "") + " " + (step.plannedStep?.description || "");
  if (step.action.action === "fill" && /密码|密碼|password|pwd|验证码|驗證碼|otp/i.test(target)) {
    return "******";
  }
  return redactSecrets(step.action.value || "", secrets);
}

export class HtmlReporter {
  static generate(report: AiUiTestReport, outputDir: string): string {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const secretValues = [
      report.goal.initialContext?.password,
      report.goal.initialContext?.otp,
    ];
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
            imageTag = screenshotButton(dataUrl, path.basename(step.screenshotPath));
          } catch {
            imageTag = screenshotButton(step.screenshotPath, path.basename(step.screenshotPath));
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
            ${step.action.value ? `<p><strong>输入载荷：</strong><code>${displayInput(step, secretValues)}</code></p>` : ""}
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
    .round-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
    .round-card h3 { margin: 0 0 6px; font-size: 1rem; }
    .round-card ul { margin: 6px 0 0; padding-left: 18px; }
    .round-meta { color: #64748b; font-size: 0.85rem; }
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
    .shot-open { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
    .shot-open img { display: block; width: 100%; max-height: 320px; object-fit: contain; object-position: left center; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; }
    .shot-hint { font-size: 0.75rem; color: #64748b; margin-top: 4px; }
    #shot-lightbox[hidden] { display: none; }
    #shot-lightbox { position: fixed; inset: 0; z-index: 40; }
    .shot-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.86); }
    .shot-toolbar { position: absolute; top: 0; left: 0; right: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 12px 16px; color: #e2e8f0; }
    .shot-caption { margin-right: auto; font-size: 0.9rem; }
    .shot-toolbar button { border: 0; border-radius: 6px; background: #e2e8f0; color: #0f172a; padding: 6px 10px; font: inherit; cursor: pointer; }
    .shot-stage { position: absolute; inset: 58px 12px 12px; overflow: auto; }
    .shot-stage img { display: block; margin: auto; box-shadow: 0 12px 40px rgba(0,0,0,.35); background: #fff; cursor: grab; }
    .shot-stage img:active { cursor: grabbing; }
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
        <p style="margin: 6px 0 0; color: #64748b;">${redactSecrets(report.goal.description, secretValues)}</p>
        <div class="meta-grid">
          <div>目标地址: <code>${report.goal.targetUrl}</code></div>
          <div>总耗时: <strong>${report.durationMs}ms</strong></div>
          <div>开始时间: ${report.startTime}</div>
          <div>报告语言: <strong>${escapeHtml(resolveReportLanguage().label)}</strong></div>
          ${report.tokenUsage ? `<div>Token: <strong>合计 ${formatTokenCount(report.tokenUsage.total)}</strong>（输入 ${formatTokenCount(report.tokenUsage.input)} · 输出 ${formatTokenCount(report.tokenUsage.output)}）</div>` : ""}
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

    <div class="section-title">🗺️ 规划轮次</div>
    <div class="rounds-container">
      ${renderRounds(report.rounds || [])}
    </div>

    <div class="section-title">🪜 操作执行流</div>
    <div class="steps-container">
      ${stepsHtml}
    </div>
  </div>
  <div id="shot-lightbox" hidden>
    <div class="shot-backdrop" data-close="1"></div>
    <div class="shot-toolbar">
      <span class="shot-caption"></span>
      <button type="button" data-zoom="out" title="缩小">－</button>
      <button type="button" data-zoom="fit" title="适应窗口">适应</button>
      <button type="button" data-zoom="actual" title="原始大小">100%</button>
      <button type="button" data-zoom="in" title="放大">＋</button>
      <button type="button" data-close="1">关闭</button>
    </div>
    <div class="shot-stage"><img id="shot-full" alt="放大后的现场截图" /></div>
  </div>
  <script>
    (() => {
      const lightbox = document.getElementById("shot-lightbox");
      const stage = lightbox.querySelector(".shot-stage");
      const full = document.getElementById("shot-full");
      const caption = lightbox.querySelector(".shot-caption");
      let scale = 1;
      const apply = (next) => {
        if (!full.naturalWidth) return;
        scale = Math.min(8, Math.max(0.2, next));
        full.style.width = Math.round(full.naturalWidth * scale) + "px";
        full.style.height = "auto";
        full.style.maxWidth = "none";
        full.style.maxHeight = "none";
        caption.textContent = (full.dataset.name || "截图") + " · " + Math.round(scale * 100) + "%";
      };
      const fit = () => {
        const availW = Math.max(stage.clientWidth - 24, 1);
        const availH = Math.max(stage.clientHeight - 24, 1);
        apply(Math.min(availW / full.naturalWidth, availH / full.naturalHeight, 1));
      };
      const open = (thumb, name) => {
        full.dataset.name = name || "截图";
        full.src = thumb.src;
        lightbox.hidden = false;
        document.body.style.overflow = "hidden";
        const show = () => fit();
        if (full.complete) show();
        else full.onload = show;
      };
      const close = () => {
        lightbox.hidden = true;
        document.body.style.overflow = "";
        full.removeAttribute("src");
      };
      document.querySelectorAll(".shot-open").forEach((button) => {
        button.addEventListener("click", () => open(button.querySelector("img"), button.dataset.name));
      });
      lightbox.addEventListener("click", (event) => {
        const zoom = event.target.closest("[data-zoom]");
        if (event.target.closest("[data-close]")) close();
        if (!zoom) return;
        if (zoom.dataset.zoom === "in") apply(scale * 1.25);
        if (zoom.dataset.zoom === "out") apply(scale / 1.25);
        if (zoom.dataset.zoom === "fit") fit();
        if (zoom.dataset.zoom === "actual") apply(1);
      });
      stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        apply(scale * (event.deltaY < 0 ? 1.12 : 0.89));
      }, { passive: false });
      full.addEventListener("dblclick", () => { if (scale < 0.98) apply(1); else fit(); });
      let drag = null;
      stage.addEventListener("pointerdown", (event) => {
        if (event.target !== full) return;
        drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
        stage.setPointerCapture(event.pointerId);
      });
      stage.addEventListener("pointermove", (event) => {
        if (!drag) return;
        stage.scrollLeft = drag.left - (event.clientX - drag.x);
        stage.scrollTop = drag.top - (event.clientY - drag.y);
      });
      stage.addEventListener("pointerup", () => { drag = null; });
      document.addEventListener("keydown", (event) => {
        if (lightbox.hidden) return;
        if (event.key === "Escape") close();
        if (event.key === "+" || event.key === "=") apply(scale * 1.25);
        if (event.key === "-" || event.key === "_") apply(scale / 1.25);
        if (event.key === "0") fit();
      });
    })();
  </script>
</body>
</html>`;

    const filePath = path.join(outputDir, `report-${report.goal.id}.html`);
    fs.writeFileSync(filePath, html, "utf-8");
    return filePath;
  }
}
