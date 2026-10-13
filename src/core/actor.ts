/**
 * Step 02-B: Jev Actor (单步决策引擎)
 *
 * 职责：
 * 1. 结合当前操作目标意图 (PlannedStep) 与当前提取的候选元素 (ElementSnapshot[])
 * 2. 决策最佳操作目标与具体指令:
 *    {
 *      "action": "click",
 *      "targetId": 3,
 *      "reasoning": "...",
 *      "confidence": 0.95
 *    }
 */

import { chooseElementWithJev, jevDecisionEnabled } from "../llm/jev-decider.js";
import { ActionDecision, ElementSnapshot, LLMProvider, PlannedStep } from "../types/index.js";

export class JevActor {
  constructor(private llmProvider?: LLMProvider) {}

  async decideNextAction(step: PlannedStep, elements: ElementSnapshot[]): Promise<ActionDecision> {
    if (step.intent === "navigate") {
      return {
        action: "navigate",
        value: step.value,
        reasoning: `直接导航到目标地址: ${step.value}`,
        confidence: 1.0,
      };
    }

    if (step.intent === "wait") {
      return {
        action: "wait",
        value: step.value || "1000",
        reasoning: "等待页面状态就绪",
        confidence: 1.0,
      };
    }

    const explicit = this.matchExplicitTarget(step);
    if (explicit) return explicit;

    if (jevDecisionEnabled()) {
      try {
        const jevDecision = await chooseElementWithJev(step, elements);
        if (jevDecision) return jevDecision;
      } catch (err: any) {
        console.warn(`[JevActor] Jev 决策失败，回退本地规则: ${err.message}`);
      }
    }

    // 1. 优先使用语义匹配规则引擎（快速且零成本）
    const ruleMatch = this.matchBySemanticHeuristic(step, elements);
    if (ruleMatch && ruleMatch.confidence >= 0.8) {
      return ruleMatch;
    }

    // 2. 如果规则未高置信度命中且配置了 LLM，则由 LLM/Jev 进行视觉/语义推理决策
    if (this.llmProvider) {
      try {
        const aiDecision = await this.decideWithLLM(step, elements);
        if (aiDecision) return aiDecision;
      } catch (err: any) {
        console.warn(`[JevActor] LLM decision failed: ${err.message}, falling back to best match.`);
      }
    }

    // 3. 兜底最佳猜测或报告未找到
    if (ruleMatch) return ruleMatch;

    return {
      action: step.intent,
      reasoning: `未能在当前页面找到匹配「${step.semanticTarget}」的合适元素`,
      confidence: 0,
    };
  }

  /**
   * 回归用例可写死锚点，避免定期跑测依赖自然语言猜测。
   * semanticTarget 使用 testid: 或 selector: 前缀。
   */
  private matchExplicitTarget(step: PlannedStep): ActionDecision | null {
    const raw = step.semanticTarget || "";
    if (raw.startsWith("testid:")) {
      const id = raw.slice("testid:".length).replaceAll('"', "");
      return {
        action: step.intent,
        selector: '[data-testid="' + id + '"]',
        value: step.value,
        reasoning: "精确匹配 data-testid=" + id,
        confidence: 0.99,
      };
    }
    if (raw.startsWith("selector:")) {
      return {
        action: step.intent,
        selector: raw.slice("selector:".length),
        value: step.value,
        reasoning: "使用回归用例显式选择器",
        confidence: 0.99,
      };
    }
    return null;
  }

  private matchBySemanticHeuristic(
    step: PlannedStep,
    elements: ElementSnapshot[],
  ): ActionDecision | null {
    const target = (step.semanticTarget || "").toLowerCase();
    let bestEl: ElementSnapshot | null = null;
    let highestScore = 0;
    let matchReason = "";

    for (const el of elements) {
      // 严格防呆：fill 意图绝不匹配非输入控件 (过滤纯容器 div, form 等)
      if (
        step.intent === "fill" &&
        el.tagName !== "input" &&
        el.tagName !== "textarea" &&
        el.tagName !== "select"
      ) {
        continue;
      }
      // click 意图如果语义是按钮/链接，过滤掉输入框（除非是 submit/button）
      if (
        step.intent === "click" &&
        el.tagName === "input" &&
        (el as any).type !== "submit" &&
        (el as any).type !== "button"
      ) {
        continue;
      }

      let score = 0;
      const testId = (el.testId || "").toLowerCase();
      const text = (el.text || "").toLowerCase();
      const placeholder = (el.placeholder || "").toLowerCase();
      const aria = (el.ariaLabel || "").toLowerCase();
      const type = ((el as any).type || "").toLowerCase();

      // 1. data-testid 强匹配 (权重最高)
      if (testId) {
        // Tab 切换按钮
        if (target.includes("tab") || target.includes("切换") || target.includes("切換")) {
          if (
            testId.includes("tab-btn-otp") &&
            (target.includes("手机") ||
              target.includes("手機") ||
              target.includes("短信") ||
              target.includes("簡訊") ||
              target.includes("otp"))
          )
            score += 0.95;
          if (
            testId.includes("tab-btn-email") &&
            (target.includes("邮箱") || target.includes("信箱") || target.includes("email"))
          )
            score += 0.95;
        }

        // 手机号输入框
        if (
          target.includes("手机") ||
          target.includes("手機") ||
          target.includes("phone") ||
          target.includes("mobile") ||
          target.includes("tel")
        ) {
          if (testId.includes("phone") || testId.includes("mobile") || testId.includes("tel"))
            score += 0.95;
        }

        // 邮箱输入框
        if (target.includes("邮箱") || target.includes("信箱") || target.includes("email")) {
          if (testId.includes("email") || testId.includes("mail")) score += 0.95;
        }

        // 通用用户名/账号
        if (
          target.includes("用户") ||
          target.includes("账号") ||
          target.includes("帳號") ||
          target.includes("user") ||
          target.includes("account")
        ) {
          if (
            testId.includes("user") ||
            testId.includes("account") ||
            testId.includes("email") ||
            testId.includes("phone") ||
            testId.includes("login-input")
          )
            score += 0.9;
        }

        // 密码输入框
        if (
          target.includes("密码") ||
          target.includes("密碼") ||
          target.includes("pass") ||
          target.includes("pwd")
        ) {
          if (testId.includes("pass") || testId.includes("pwd")) score += 0.95;
        }

        // 获取验证码按钮
        if (
          target.includes("获取验证码") ||
          target.includes("獲取驗證碼") ||
          target.includes("发送验证码") ||
          target.includes("發送驗證碼") ||
          target.includes("send-otp")
        ) {
          if (
            testId.includes("send-otp") ||
            testId.includes("btn-otp") ||
            testId.includes("get-otp")
          )
            score += 0.95;
        }

        // 验证码输入框
        if (
          target.includes("验证码") ||
          target.includes("驗證碼") ||
          target.includes("otp") ||
          target.includes("code")
        ) {
          if (
            (testId.includes("otp") || testId.includes("code")) &&
            !testId.includes("send") &&
            !testId.includes("btn")
          )
            score += 0.95;
        }

        // 登录提交按钮
        if (
          target.includes("登录") ||
          target.includes("登入") ||
          target.includes("login") ||
          target.includes("提交") ||
          target.includes("submit")
        ) {
          if (
            testId.includes("submit") ||
            testId.includes("btn-login") ||
            testId.includes("login-submit")
          )
            score += 0.95;
        }

        // 新建/添加操作按钮 (支持 button 和 a 链接型按钮)
        if (
          target.includes("新建") ||
          target.includes("新增") ||
          target.includes("创建") ||
          target.includes("create") ||
          target.includes("add")
        ) {
          if (
            testId.includes("create") ||
            testId.includes("add") ||
            testId.includes("new") ||
            testId.includes("btn-create")
          )
            score += 0.96;
        }

        // 弹窗表单名称输入框
        if (
          target.includes("名称") ||
          target.includes("name") ||
          target.includes("标签名") ||
          target.includes("活动名") ||
          target.includes("标题")
        ) {
          if (testId.includes("name") || testId.includes("title") || testId.includes("modal-input"))
            score += 0.95;
        }

        // 弹窗确认/保存/提交按钮
        if (
          target.includes("确认") ||
          target.includes("確定") ||
          target.includes("保存") ||
          target.includes("儲存") ||
          target.includes("confirm") ||
          target.includes("save")
        ) {
          if (
            testId.includes("confirm") ||
            testId.includes("save") ||
            testId.includes("modal-btn") ||
            testId.includes("submit")
          )
            score += 0.96;
        }
      }

      // 2. 文本内容匹配 (针对按钮、链接与 Tab)
      if (text) {
        if (text === target) score += 0.9;
        else if (text.includes(target) || target.includes(text)) score += 0.75;

        // Tab 切换文本
        if (
          (target.includes("手机") ||
            target.includes("手機") ||
            target.includes("短信") ||
            target.includes("簡訊")) &&
          (text.includes("手機簡訊") ||
            text.includes("手机短信") ||
            text.includes("簡訊登入") ||
            text.includes("短信登录"))
        ) {
          score += 0.92;
        }
        if (
          (target.includes("邮箱") || target.includes("信箱")) &&
          (text.includes("電子信箱") ||
            text.includes("电子邮箱") ||
            text.includes("信箱登入") ||
            text.includes("邮箱登录"))
        ) {
          score += 0.92;
        }

        // 获取验证码按钮
        if (
          target.includes("获取验证码") ||
          target.includes("獲取驗證碼") ||
          target.includes("验证码")
        ) {
          if (
            text.includes("獲取驗證碼") ||
            text.includes("获取验证码") ||
            text.includes("发送验证码") ||
            text.includes("重新發送")
          )
            score += 0.92;
        }

        // 登录按钮
        if (target.includes("登录") || target.includes("登入") || target.includes("提交")) {
          if (
            text.includes("安全登入") ||
            text.includes("登入") ||
            text.includes("登录") ||
            text.includes("Login")
          )
            score += 0.9;
        }

        // 新建操作按钮文本
        if (
          target.includes("新建") ||
          target.includes("创建") ||
          target.includes("新增") ||
          target.includes("添加")
        ) {
          if (
            text.includes("新建") ||
            text.includes("新增") ||
            text.includes("創建") ||
            text.includes("添加")
          )
            score += 0.93;
        }

        // 确认与保存按钮文本
        if (
          target.includes("确认") ||
          target.includes("确定") ||
          target.includes("保存") ||
          target.includes("儲存")
        ) {
          if (
            text.includes("確認") ||
            text.includes("确定") ||
            text.includes("确认") ||
            text.includes("儲存") ||
            text.includes("保存")
          )
            score += 0.93;
        }
      }

      // 3. Placeholder 与 input type 匹配
      if (placeholder) {
        if (placeholder.includes(target) || target.includes(placeholder)) score += 0.8;
        if (
          (target.includes("手机") || target.includes("mobile")) &&
          (placeholder.includes("手机") ||
            placeholder.includes("手機") ||
            placeholder.includes("電話"))
        )
          score += 0.85;
        if (
          (target.includes("邮箱") || target.includes("email")) &&
          (placeholder.includes("email") ||
            placeholder.includes("信箱") ||
            placeholder.includes("郵箱"))
        )
          score += 0.85;
        if (
          (target.includes("密码") || target.includes("密碼")) &&
          (placeholder.includes("密码") ||
            placeholder.includes("密碼") ||
            placeholder.includes("至少"))
        )
          score += 0.85;
        if (
          (target.includes("验证码") || target.includes("驗證碼")) &&
          (placeholder.includes("验证码") ||
            placeholder.includes("驗證碼") ||
            placeholder.includes("6位"))
        )
          score += 0.85;
      }

      // Type 匹配提权
      if (type === "tel" && (target.includes("手机") || target.includes("phone"))) score += 0.3;
      if (type === "email" && (target.includes("邮箱") || target.includes("email"))) score += 0.3;
      if (type === "password" && (target.includes("密码") || target.includes("password")))
        score += 0.3;
      if (
        type === "submit" &&
        (target.includes("登录") || target.includes("登入") || target.includes("提交"))
      )
        score += 0.3;

      // 4. Aria 标签匹配
      if (aria && (aria.includes(target) || target.includes(aria))) {
        score += 0.7;
      }

      // 5. 意图类型与标签匹配修正
      if (step.intent === "fill" && el.tagName === "input") score += 0.1;
      if (
        step.intent === "click" &&
        (el.tagName === "button" || el.tagName === "a" || el.role === "button")
      )
        score += 0.1;

      if (score > highestScore) {
        highestScore = score;
        bestEl = el;
        matchReason = `匹配到序号 [${el.targetId}] <${el.tagName}> (testid="${el.testId || ""}", text="${el.text || ""}", type="${type}")`;
      }
    }

    if (bestEl && highestScore > 0.4) {
      return {
        action: step.intent,
        targetId: bestEl.targetId,
        selector: bestEl.selector,
        value: step.value,
        reasoning: `规则引擎高置信度选中: ${matchReason}`,
        confidence: Math.min(1.0, highestScore),
      };
    }

    return null;
  }

  private async decideWithLLM(
    step: PlannedStep,
    elements: ElementSnapshot[],
  ): Promise<ActionDecision | null> {
    const formattedElements = elements
      .slice(0, 30) // 控制上下文在合理范围
      .map(
        (el) =>
          `[${el.targetId}] <${el.tagName}> testid="${el.testId || ""}" text="${el.text || ""}" placeholder="${el.placeholder || ""}" aria="${el.ariaLabel || ""}" selector="${el.selector}"`,
      )
      .join("\n");

    const systemPrompt = `You are Jev, a fast-action decision model for browser automation.
Given the target operation step and the visible interactive elements on page, choose the single best element target [1..N] and action.

Return ONLY a JSON object:
{
  "action": "${step.intent}",
  "targetId": number,
  "reasoning": "Brief explanation why this target matches",
  "confidence": number between 0 and 1
}`;

    const userPrompt = `Target Step:
- Intent: ${step.intent}
- Semantic Target: ${step.semanticTarget}
- Value to input (if applicable): ${step.value || "N/A"}

Available Page Elements:
${formattedElements}`;

    const res = await this.llmProvider!.generateJson<any>(userPrompt, { systemPrompt });
    const chosenEl = elements.find((e) => e.targetId === res.targetId);

    return {
      action: res.action || step.intent,
      targetId: res.targetId,
      selector: chosenEl?.selector,
      value: step.value,
      reasoning: res.reasoning || `Jev 模型选定目标 [${res.targetId}]`,
      confidence: res.confidence ?? 0.9,
    };
  }
}
