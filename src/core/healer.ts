/**
 * Step 05: LLM Healer & Diagnoser (根因诊断与自愈分析器)
 *
 * 职责：
 * 1. 在操作失败或断言未通过时，收集第一现场证据包 (FailureContext)
 * 2. 深入分析控制台报错、DOM 状态、断言差异
 * 3. 归类根因 (PRODUCT_BUG / LOCATOR_DRIFT / TIMING_FLAKY / TEST_DATA_INVALID)
 * 4. 给出修复建议并生成自愈指令 (healingAction)
 */

import { withReportLanguage } from "../config/report-language.js";
import { FailureContext, FailureDiagnosis, LLMProvider } from "../types/index.js";

export class LlmHealer {
  constructor(private llmProvider?: LLMProvider) {}

  async diagnose(context: FailureContext): Promise<FailureDiagnosis> {
    // 1. 如果配置了 LLM，优先执行大模型智能诊断
    if (this.llmProvider) {
      try {
        const aiDiagnosis = await this.diagnoseWithLLM(context);
        if (aiDiagnosis) return aiDiagnosis;
      } catch (err: any) {
        console.warn(
          `[LlmHealer] LLM diagnosis failed: ${err.message}, falling back to heuristic diagnosis.`,
        );
      }
    }

    // 2. 启发式确定性诊断分析器
    return this.diagnoseWithHeuristics(context);
  }

  private async diagnoseWithLLM(context: FailureContext): Promise<FailureDiagnosis | null> {
    const systemPrompt = `You are an expert QA and SRE incident diagnostic agent.
Analyze the test failure context, determine the root cause, classify the failure category, and decide if it can be self-healed.

Allowed categories:
- "PRODUCT_BUG": Real application crash, 500 error, unhandled exception, blocking alert.
- "LOCATOR_DRIFT": Element changed due to UI redesign, renamed label/class, or drifted selector.
- "TIMING_FLAKY": Race condition, timeout, loading skeleton not disappeared.
- "TEST_DATA_INVALID": Expired OTP, wrong password, tenant mismatch.
- "UNKNOWN": Other unspecified reason.

Return ONLY a JSON object:
{
  "category": "PRODUCT_BUG" | "LOCATOR_DRIFT" | "TIMING_FLAKY" | "TEST_DATA_INVALID" | "UNKNOWN",
  "rootCause": "Detailed root cause explanation",
  "suggestedFix": "Actionable suggestion for developers or QA",
  "canSelfHeal": boolean,
  "healingAction": {
    "action": "wait" | "click" | "fill" | "navigate",
    "value": "string parameter or timeout if applicable",
    "reasoning": "how this action heals the state"
  }
}`;
    const systemPromptWithLanguage = withReportLanguage(systemPrompt);

    const userPrompt = `Failure Context:
- Current URL: ${context.currentUrl}
- Failed Step: ${context.failedStep ? JSON.stringify(context.failedStep) : "None"}
- Failed Assertions: ${JSON.stringify(context.failedAssertions)}
- Browser Console Errors: ${JSON.stringify(context.consoleErrors)}
- Screenshot Path: ${context.screenshotPath || "None"}`;

    const res = await this.llmProvider!.generateJson<any>(userPrompt, { systemPrompt: systemPromptWithLanguage });

    return {
      category: res.category || "UNKNOWN",
      rootCause: res.rootCause || "未能由 LLM 获取明确根因",
      suggestedFix: res.suggestedFix || "请人工查看截图与控制台日志",
      canSelfHeal: Boolean(res.canSelfHeal),
      healingAction: res.healingAction,
    };
  }

  private diagnoseWithHeuristics(context: FailureContext): FailureDiagnosis {
    const consoleText = (context.consoleErrors || []).join(" ").toLowerCase();
    const failedAssertionsText = (context.failedAssertions || [])
      .map((a) => a.message || "")
      .join(" ")
      .toLowerCase();
    const stepError = (context.failedStep?.error || "").toLowerCase();

    // 1. 优先排查控制台或接口崩溃 (PRODUCT_BUG)
    if (
      consoleText.includes("500") ||
      consoleText.includes("internal server error") ||
      consoleText.includes("uncaught exception") ||
      consoleText.includes("typeerror")
    ) {
      return {
        category: "PRODUCT_BUG",
        rootCause:
          "浏览器捕获到控制台未捕获异常或后端接口 500 错误，表明前端或服务端业务代码存在真实缺陷。",
        suggestedFix: "定位控制台报错堆栈及对应接口返回，检查服务端日志及前端数据防御逻辑。",
        canSelfHeal: false,
      };
    }

    // 2. 排查网络时序抖动或超时 (TIMING_FLAKY)
    if (
      stepError.includes("timeout") ||
      stepError.includes("waiting for") ||
      failedAssertionsText.includes("未见或未渲染")
    ) {
      return {
        category: "TIMING_FLAKY",
        rootCause: "操作或断言由于页面渲染延迟、异步网络请求尚未完成而发生超时。",
        suggestedFix:
          "建议增加显式状态等待（如 waitForLoadState 或 waitForSelector），或提升单步超时阈值。",
        canSelfHeal: true,
        healingAction: {
          action: "wait",
          value: "2000",
          reasoning: "自愈策略：延长等待 2000ms 让异步渲染与网络请求完成",
          confidence: 0.85,
        },
      };
    }

    // 3. 排查选择器漂移 (LOCATOR_DRIFT)
    if (
      stepError.includes("无法定位") ||
      stepError.includes("not found") ||
      failedAssertionsText.includes("未能识别到元素")
    ) {
      return {
        category: "LOCATOR_DRIFT",
        rootCause: "前端组件迭代或样式改版导致选择器/元素文本发生变动，既有定位策略失效。",
        suggestedFix: "推荐采用 data-testid 稳定层级命名规范，或更新 Jev 语义识别选择器。",
        canSelfHeal: true,
        healingAction: {
          action: "wait",
          value: "1000",
          reasoning: "自愈策略：尝试降级文本选择器与模糊属性重新匹配目标",
          confidence: 0.75,
        },
      };
    }

    // 4. 通用兜底
    return {
      category: "UNKNOWN",
      rootCause: `测试未达成预期。当前停留在 ${context.currentUrl}，未满足断言: ${context.failedAssertions.map((a) => a.description).join(", ")}`,
      suggestedFix: "检查用例前置数据及登录态有效性。",
      canSelfHeal: false,
    };
  }
}
