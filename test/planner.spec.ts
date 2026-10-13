import { describe, it, expect } from "vitest";
import { LlmPlanner } from "../src/core/planner.js";
import { MockLLMProvider } from "../src/llm/provider.js";
import { TestGoal } from "../src/types/index.js";

describe("LlmPlanner (Step 01)", () => {
  const goal: TestGoal = {
    id: "test_login_01",
    name: "测试登录功能",
    description: "测试登录功能，使用正常账号登录，验证用户能够进入首页",
    targetUrl: "http://localhost:5173/login",
    initialContext: { username: "admin", password: "secretpassword" },
  };

  it("使用启发式规划器生成标准登录步骤与断言", async () => {
    const planner = new LlmPlanner();
    const plan = await planner.plan(goal);

    expect(plan.goalId).toBe("test_login_01");
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.steps[0].intent).toBe("navigate");
    expect(
      plan.steps.some(
        (s) => s.semanticTarget.includes("用户名") || s.semanticTarget.includes("邮箱"),
      ),
    ).toBe(true);
    expect(plan.steps.some((s) => s.semanticTarget.includes("登录"))).toBe(true);
    expect(plan.assertions.length).toBeGreaterThanOrEqual(1);
  });

  it("使用 MockLLMProvider 成功解析复杂自定义意图", async () => {
    const mockLlm = new MockLLMProvider({
      "Test Goal ID": {
        summary: "AI 规划的端到端活动创建",
        steps: [
          {
            stepIndex: 1,
            description: "打开活动页",
            intent: "navigate",
            semanticTarget: "page",
            value: "/app/campaigns",
          },
          {
            stepIndex: 2,
            description: "点击新建按钮",
            intent: "click",
            semanticTarget: "新建活动按钮",
          },
        ],
        assertions: [
          {
            assertionId: "assert_created",
            description: "出现活动列表项",
            type: "text_visible",
            expected: "618大促",
          },
        ],
      },
    });

    const planner = new LlmPlanner(mockLlm);
    const plan = await planner.plan(goal);

    expect(plan.summary).toBe("AI 规划的端到端活动创建");
    expect(plan.steps).toHaveLength(2);
    expect(plan.assertions[0].expected).toBe("618大促");
  });

  it("显式 plannedSteps 优先于 LLM，保证回归步骤不被改写", async () => {
    const mockLlm = new MockLLMProvider({
      "Test Goal ID": {
        summary: "不应覆盖显式步骤",
        steps: [],
        assertions: [],
      },
    });
    const planner = new LlmPlanner(mockLlm);
    const plan = await planner.plan({
      ...goal,
      id: "explicit_steps",
      plannedSteps: [
        {
          stepIndex: 1,
          description: "打开标签中心",
          intent: "navigate",
          semanticTarget: "page",
          value: "http://127.0.0.1:5173/app/tags",
        },
      ],
      expectedAssertions: [
        {
          assertionId: "assert_tags",
          description: "停留在标签中心",
          type: "url_contains",
          expected: "/app/tags",
        },
      ],
    });

    expect(plan.summary).toBe("测试登录功能");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].value).toContain("/app/tags");
    expect(plan.assertions[0].expected).toBe("/app/tags");
  });

  it("启发式规划保留用例显式断言", async () => {
    const planner = new LlmPlanner();
    const plan = await planner.plan({
      ...goal,
      expectedAssertions: [
        {
          assertionId: "custom",
          description: "自定义断言",
          type: "url_contains",
          expected: "/custom",
        },
      ],
    });
    expect(plan.assertions).toHaveLength(1);
    expect(plan.assertions[0].expected).toBe("/custom");
  });

  it("短信登录使用目标中的验证码，而不是密码字段", async () => {
    const planner = new LlmPlanner();
    const plan = await planner.plan({
      id: "otp_from_goal",
      name: "短信登录",
      description: "使用手机号登录",
      targetUrl: "http://localhost/login",
      initialContext: { phone: "13800138000", otp: "123456", password: "not-the-otp" },
    });
    const otpStep = plan.steps.find((step) => step.semanticTarget.includes("验证码输入"));
    expect(otpStep?.value).toBe("123456");
  });
});
