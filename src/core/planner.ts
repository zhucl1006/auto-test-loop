/**
 * Step 01: LLM Planner (理解测试目标)
 *
 * 职责：
 * 1. 接收高层测试意图 (TestGoal)
 * 2. 运用 LLM（或启发式回退）拆解为具体的操作步骤 (PlannedSteps) 与预期结果断言 (ExpectedAssertions)
 */

import { withReportLanguage } from "../config/report-language.js"
import {
  ExecutionPlan,
  LLMProvider,
  PlannedStep,
  ExpectedAssertion,
  TestGoal,
} from "../types/index.js";

export interface PlanHistoryItem {
  description: string;
  intent: string;
  semanticTarget: string;
  urlAfter?: string;
  status: string;
}

export interface PlanRequest {
  /** next-page 只规划下一次页面变化，供自主循环反复调用。 */
  scope?: "full" | "next-page";
  history?: PlanHistoryItem[];
}

export interface PageContext {
  url: string;
  modalOpen?: boolean;
  elements: {
    targetId: number;
    tagName: string;
    text?: string;
    testId?: string;
    placeholder?: string;
  }[];
}

export class LlmPlanner {
  constructor(private llmProvider?: LLMProvider) {}

  async plan(goal: TestGoal, pageContext?: PageContext, request?: PlanRequest): Promise<ExecutionPlan> {
    if (goal.plannedSteps && goal.plannedSteps.length > 0) {
      return {
        goalId: goal.id,
        summary: goal.name,
        steps: goal.plannedSteps,
        assertions: goal.expectedAssertions || [],
      };
    }

    if (this.llmProvider) {
      try {
        return await this.planWithLLM(goal, pageContext, request);
      } catch (err: any) {
        console.warn(
          `[LlmPlanner] LLM planning failed, falling back to heuristic planner: ${err.message}`,
        );
      }
    }

    return this.planWithHeuristics(goal, request);
  }

  private async planWithLLM(goal: TestGoal, pageContext?: PageContext, request?: PlanRequest): Promise<ExecutionPlan> {
    const systemPrompt = `You are a QA planner for any website. Do not assume a product, login method, or URL structure.
Read the natural-language goal and the observed page, then decide a short executable test.

Rules:
1. First step should navigate to the target URL unless the page is already open.
2. Use only facts from the goal, initial context, and observed elements. Do not invent credentials or expected text.
3. fill must target an input, textarea, or select. click must target a button, link, or tab.
4. semanticTarget must name the visible control in the page language, not a container.
5. Keep at most 12 steps. Mark uncertain steps optional.
6. Assertions may only use url_contains, url_matches, text_visible, or element_visible.
7. If the goal is exploratory, assert that the target page loaded and a relevant visible control or heading exists.
${request?.scope === "next-page" ? `
8. This call plans only the next page transition, at most 4 steps. The runner calls you again after the URL changes.
9. Do not repeat completed steps. Use only observed elements.
10. If the goal is already satisfied, set complete to true, return an empty steps array, and provide assertions that prove completion.
11. Never use element_visible with expected "body". Do not invent a destination URL from a testid, label, or hyphenated slug. url_contains may only use a URL already present in the current page or completed steps. Otherwise assert text already visible, or omit the URL assertion.
12. Set complete to false while goal work remains.
13. If the goal asks to cover every sidebar or navigation item, complete is true only after every visible navigation link has been clicked in the completed steps. Do not treat a group heading as a link, and do not skip a visible nav link.
14. Do not assert that the control you are about to click will remain visible after the URL changes.
15. If a dialog is open, plan only inside that dialog: fill visible fields when needed, then close or cancel it. Do not click the page behind the dialog, and do not mark the goal complete merely because a dialog opened.
16. semanticTarget must be visible text, a testid, or Escape. Never use "-", "x", or "×". To close an icon-only dialog, use intent press and semanticTarget Escape.` : ""}

Return a JSON object conforming to this schema:
{
  "summary": "Brief summary of the test flow",
  "steps": [
    {
      "stepIndex": number,
      "description": "Short explanation",
      "intent": "navigate" | "fill" | "click" | "hover" | "press" | "wait",
      "semanticTarget": "string target name",
      "value": "string value to input if fill or wait duration",
      "optional": boolean
    }
  ],
  "assertions": [
    {
      "assertionId": "string",
      "description": "What is verified",
      "type": "url_contains" | "url_matches" | "text_visible" | "element_visible",
      "expected": "expected value"
    }
  ],
  "complete": boolean
}`;
    const systemPromptWithLanguage = withReportLanguage(systemPrompt);

    const observed = (pageContext?.elements || [])
      .slice(0, 40)
      .map(
        (element) =>
          "#" +
          element.targetId +
          " " +
          element.tagName +
          " testid=" +
          (element.testId || "-") +
          " text=" +
          (element.text || "-") +
          " placeholder=" +
          (element.placeholder || "-"),
      )
      .join("\n");
    const userPrompt = `Test Goal ID: ${goal.id}
Test Name: ${goal.name}
Test Description: ${goal.description}
Target URL: ${goal.targetUrl}
Current URL: ${pageContext?.url || "not opened yet"}
Dialog open: ${pageContext?.modalOpen ? "yes" : "no"}
Initial Context: ${JSON.stringify(goal.initialContext || {})}
Observed elements:
${observed || "none"}
${request?.scope === "next-page" ? formatHistory(request.history) : ""}`;

    const result = await this.llmProvider!.generateJson<any>(userPrompt, { systemPrompt: systemPromptWithLanguage });

    // 优先采用测试用例显式指定的确定性验收断言，消除 LLM 幻觉产生假数据断言
    const finalAssertions =
      goal.expectedAssertions && goal.expectedAssertions.length > 0
        ? goal.expectedAssertions
        : result.assertions || [];

    const steps = Array.isArray(result.steps) ? result.steps : [];
    return {
      goalId: goal.id,
      summary: result.summary || goal.name,
      steps,
      assertions: finalAssertions,
      complete: Boolean(result.complete) && steps.length === 0,
      rawPlanText: JSON.stringify(result, null, 2),
    };
  }

  /**
   * 启发式计划生成器（在无 LLM Key 或离线时提供确定性、高精度的测试用例规划）
   */
  private planWithHeuristics(goal: TestGoal, request?: PlanRequest): ExecutionPlan {
    if (request?.history?.length) {
      return {
        goalId: goal.id,
        summary: "本地规则不会在页面变化后继续规划",
        steps: [],
        assertions: goal.expectedAssertions || [],
        complete: true,
      };
    }
    const desc = goal.description.toLowerCase();
    const steps: PlannedStep[] = [];
    const assertions: ExpectedAssertion[] = [];

    // 默认第一步：打开页面
    steps.push({
      stepIndex: 1,
      description: `打开页面: ${goal.targetUrl}`,
      intent: "navigate",
      semanticTarget: "page",
      value: goal.targetUrl,
    });

    let currentStep = 2;

    // 场景 A: 登录场景 (包含登录/登入/login/账号/密码/验证码等关键词)
    if (
      desc.includes("登录") ||
      desc.includes("登入") ||
      desc.includes("login") ||
      desc.includes("sign in") ||
      goal.initialContext?.email ||
      goal.initialContext?.username ||
      goal.initialContext?.password ||
      goal.initialContext?.phone ||
      goal.initialContext?.otp
    ) {
      const isOtpFlow =
        desc.includes("手机") ||
        desc.includes("手機") ||
        desc.includes("短信") ||
        desc.includes("簡訊") ||
        desc.includes("验证码") ||
        desc.includes("otp") ||
        Boolean(goal.initialContext?.phone);
      const phone = goal.initialContext?.phone || "";
      const password = goal.initialContext?.password || "";
      const email = goal.initialContext?.email || goal.initialContext?.username || "";

      if (isOtpFlow) {
        // 手机短信验证码登录链路
        steps.push({
          stepIndex: currentStep++,
          description: "切换到手机短信登录选项卡",
          intent: "click",
          semanticTarget: "手机短信登录Tab",
          optional: true,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "输入手机号码",
          intent: "fill",
          semanticTarget: "手机号输入框",
          value: phone,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "点击获取短信验证码按钮",
          intent: "click",
          semanticTarget: "获取验证码按钮",
          optional: true,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "等待短信验证码接收",
          intent: "wait",
          semanticTarget: "等待",
          value: "800",
        });
        steps.push({
          stepIndex: currentStep++,
          description: "输入短信验证码",
          intent: "fill",
          semanticTarget: "验证码输入框",
          value: goal.initialContext?.otp || password,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "点击登录提交按钮",
          intent: "click",
          semanticTarget: "登录提交按钮",
        });
      } else {
        // 邮箱密码登录链路
        steps.push({
          stepIndex: currentStep++,
          description: "输入登录电子邮箱或用户名",
          intent: "fill",
          semanticTarget: "用户名/邮箱输入框",
          value: email,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "输入密码",
          intent: "fill",
          semanticTarget: "密码输入框",
          value: password,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "点击登录提交按钮",
          intent: "click",
          semanticTarget: "登录提交按钮",
        });
      }

      // 预期断言
      assertions.push({
        assertionId: "assert_url_not_login",
        description: "URL 离开登录页并进入管理控制台 (/app)",
        type: "url_contains",
        expected: "/app",
      });
      assertions.push({
        assertionId: "assert_welcome_or_user",
        description: "页面成功进入并呈现工作区或导航中心",
        type: "element_visible",
        expected: "app-sidebar-div-container",
        semanticTarget: "sidebar",
      });
    } else {
      // 业务页面通用探索与交互链条
      steps.push({
        stepIndex: currentStep++,
        description: "等待页面核心容器与数据渲染就绪",
        intent: "wait",
        semanticTarget: "等待",
        value: "1000",
      });

      // 场景 B: 标签中心新建与保存完整链条
      if (desc.includes("标签") && (desc.includes("新建") || desc.includes("创建"))) {
        const tagName = goal.initialContext?.tagName || "回归VIP客户";
        steps.push({
          stepIndex: currentStep++,
          description: "点击新建标签按钮",
          intent: "click",
          semanticTarget: "新建标签按钮",
        });
        steps.push({
          stepIndex: currentStep++,
          description: "等待新建标签模态弹窗呈现",
          intent: "wait",
          semanticTarget: "等待",
          value: "600",
        });
        steps.push({
          stepIndex: currentStep++,
          description: "输入标签名称",
          intent: "fill",
          semanticTarget: "标签名称输入框",
          value: tagName,
        });
        steps.push({
          stepIndex: currentStep++,
          description: "点击模态框确认保存按钮",
          intent: "click",
          semanticTarget: "确认保存按钮",
        });
        steps.push({
          stepIndex: currentStep++,
          description: "等待保存响应与列表刷新",
          intent: "wait",
          semanticTarget: "等待",
          value: "800",
        });
      } else if (desc.includes("活动") && (desc.includes("新建") || desc.includes("创建"))) {
        // 场景 C: 营销活动新建跳转链条
        steps.push({
          stepIndex: currentStep++,
          description: "点击新建营销活动按钮",
          intent: "click",
          semanticTarget: "新建活动按钮",
        });
        steps.push({
          stepIndex: currentStep++,
          description: "等待新建活动编排页面渲染",
          intent: "wait",
          semanticTarget: "等待",
          value: "800",
        });
      } else if (desc.includes("新建") || desc.includes("创建") || desc.includes("新增")) {
        steps.push({
          stepIndex: currentStep++,
          description: "点击新建或添加按钮",
          intent: "click",
          semanticTarget: "新建按钮",
          optional: true,
        });
      }

      // 获取目标路径 pathname
      let expectedPath = goal.targetUrl;
      try {
        const u = new URL(goal.targetUrl);
        expectedPath = u.pathname;
      } catch {
        // 保留原值
      }

      assertions.push({
        assertionId: "assert_page_loaded",
        description: `页面成功导航且 URL 匹配目标路径 ${expectedPath}`,
        type: "url_contains",
        expected: expectedPath,
      });
      assertions.push({
        assertionId: "assert_sidebar_visible",
        description: "控制台主导航或工作区正常呈现",
        type: "element_visible",
        expected: "app-sidebar-div-container",
        semanticTarget: "sidebar",
      });
    }

    const finalAssertions =
      goal.expectedAssertions && goal.expectedAssertions.length > 0
        ? goal.expectedAssertions
        : assertions;

    return {
      goalId: goal.id,
      summary: `启发式解析测试目标: ${goal.name}`,
      steps,
      assertions: finalAssertions,
    };
  }
}

function formatHistory(history: PlanHistoryItem[] | undefined): string {
  if (!history?.length) return "\nCompleted steps:\nnone";
  const lines = history.map((item, index) =>
    (index + 1) + ". " + item.status + " " + item.intent + " " + item.semanticTarget + " -> " + (item.urlAfter || "same page") + " (" + item.description + ")",
  );
  return "\nCompleted steps:\n" + lines.join("\n");
}
