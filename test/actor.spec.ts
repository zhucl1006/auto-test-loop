import { describe, it, expect } from "vitest";
import { JevActor } from "../src/core/actor.js";
import { ElementSnapshot, PlannedStep } from "../src/types/index.js";

describe("JevActor (Step 02)", () => {
  const elements: ElementSnapshot[] = [
    {
      targetId: 1,
      tagName: "input",
      testId: "login-username-input",
      placeholder: "请输入用户名",
      selector: '[data-testid="login-username-input"]',
      isVisible: true,
      isEnabled: true,
    },
    {
      targetId: 2,
      tagName: "input",
      testId: "login-password-input",
      placeholder: "请输入密码",
      selector: '[data-testid="login-password-input"]',
      isVisible: true,
      isEnabled: true,
    },
    {
      targetId: 3,
      tagName: "button",
      testId: "login-submit-button",
      text: "登录",
      selector: '[data-testid="login-submit-button"]',
      isVisible: true,
      isEnabled: true,
    },
    {
      targetId: 4,
      tagName: "a",
      text: "注册新账号",
      selector: 'a:has-text("注册新账号")',
      isVisible: true,
      isEnabled: true,
    },
  ];

  const actor = new JevActor();

  it("能准确定位用户名输入框目标并给出决策 (Target 1)", async () => {
    const step: PlannedStep = {
      stepIndex: 1,
      description: "输入用户名",
      intent: "fill",
      semanticTarget: "用户名输入框",
      value: "admin_test",
    };

    const decision = await actor.decideNextAction(step, elements);

    expect(decision.action).toBe("fill");
    expect(decision.targetId).toBe(1);
    expect(decision.value).toBe("admin_test");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("能准确定位登录按钮并决策点击 (Target 3)", async () => {
    const step: PlannedStep = {
      stepIndex: 3,
      description: "点击登录按钮",
      intent: "click",
      semanticTarget: "登录按钮",
    };

    const decision = await actor.decideNextAction(step, elements);

    expect(decision.action).toBe("click");
    expect(decision.targetId).toBe(3);
    expect(decision.selector).toBe('[data-testid="login-submit-button"]');
  });

  it("testid 前缀直接生成稳定选择器", async () => {
    const actor = new JevActor();
    const step: PlannedStep = {
      stepIndex: 1,
      description: "点击提交",
      intent: "click",
      semanticTarget: "testid:login-submit-button",
    };
    const decision = await actor.decideNextAction(step, elements);
    expect(decision.action).toBe("click");
    expect(decision.selector).toBe('[data-testid="login-submit-button"]');
    expect(decision.confidence).toBeGreaterThan(0.9);
  });
});
