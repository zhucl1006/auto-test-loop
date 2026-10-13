import { describe, it, expect } from "vitest";
import { AssertionVerifier } from "../src/core/verifier.js";
import { LlmHealer } from "../src/core/healer.js";
import { ElementSnapshot, ExpectedAssertion, FailureContext } from "../src/types/index.js";

describe("AssertionVerifier (Step 04) & LlmHealer (Step 05)", () => {
  const mockPage: any = {
    url: () => "http://localhost:5173/app/dashboard",
    locator: (selector: string) => ({
      first: () => ({
        isVisible: async () => true,
      }),
    }),
  };

  const visibleElements: ElementSnapshot[] = [
    {
      targetId: 1,
      tagName: "div",
      text: "欢迎回来，管理员！",
      testId: "user-profile-header",
      selector: '[data-testid="user-profile-header"]',
      isVisible: true,
      isEnabled: true,
    },
  ];

  it("全满足断言校验为 PASS", async () => {
    const verifier = new AssertionVerifier();
    const assertions: ExpectedAssertion[] = [
      { assertionId: "a1", description: "URL 进入 /app", type: "url_contains", expected: "/app" },
      {
        assertionId: "a2",
        description: "页面显示欢迎回来",
        type: "text_visible",
        expected: "欢迎回来",
      },
    ];

    const result = await verifier.verifyAll(mockPage, assertions, visibleElements);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  it("未满足断言校验为 FAIL", async () => {
    const verifier = new AssertionVerifier();
    const assertions: ExpectedAssertion[] = [
      {
        assertionId: "a1",
        description: "URL 是不存在的页面",
        type: "url_contains",
        expected: "/not-exist",
      },
    ];

    const result = await verifier.verifyAll(mockPage, assertions, visibleElements);
    expect(result.allPassed).toBe(false);
    expect(result.results[0].passed).toBe(false);
  });

  it("Healer 正确诊断 PRODUCT_BUG", async () => {
    const healer = new LlmHealer();
    const context: FailureContext = {
      currentUrl: "http://localhost:5173/login",
      failedAssertions: [],
      consoleErrors: ["[Browser Error] 500 Internal Server Error /api/auth/login"],
    };

    const diagnosis = await healer.diagnose(context);
    expect(diagnosis.category).toBe("PRODUCT_BUG");
    expect(diagnosis.canSelfHeal).toBe(false);
  });

  it("Healer 正确诊断 TIMING_FLAKY 并提供自愈等待指令", async () => {
    const healer = new LlmHealer();
    const context: FailureContext = {
      currentUrl: "http://localhost:5173/app",
      failedStep: {
        stepIndex: 2,
        action: { action: "click", reasoning: "点击提交", confidence: 0.9 },
        status: "FAILED",
        durationMs: 4000,
        urlBefore: "http://localhost:5173/app",
        urlAfter: "http://localhost:5173/app",
        error: "Timeout 4000ms waiting for selector",
      },
      failedAssertions: [],
      consoleErrors: [],
    };

    const diagnosis = await healer.diagnose(context);
    expect(diagnosis.category).toBe("TIMING_FLAKY");
    expect(diagnosis.canSelfHeal).toBe(true);
    expect(diagnosis.healingAction?.action).toBe("wait");
  });
});
