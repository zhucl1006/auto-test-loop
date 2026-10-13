import { describe, it, expect } from "vitest";
import { AiUiAutomationRunner } from "../src/core/runner.js";
import { TestGoal } from "../src/types/index.js";
import * as fs from "fs";
import * as path from "path";

describe("AiUiAutomationRunner Full Flow (01 -> 05)", () => {
  const tempReportDir = path.resolve("test/reports/test-unit");

  it("执行完整登录闭环流程并生成报告", async () => {
    let currentUrl = "http://localhost:5173/login";
    const calls: string[] = [];

    const mockPage: any = {
      url: () => currentUrl,
      goto: async (url: string) => {
        calls.push(`goto:${url}`);
        currentUrl = url;
      },
      click: async (selector: string) => {
        calls.push(`click:${selector}`);
        if (selector.includes("submit")) {
          currentUrl = "http://localhost:5173/app/dashboard";
        }
      },
      fill: async (selector: string, value: string) => {
        calls.push(`fill:${selector}:${value}`);
      },
      hover: async () => {},
      press: async () => {},
      waitForTimeout: async () => {},
      screenshot: async () => Buffer.from("mock-png"),
      on: () => {},
      evaluate: async () => [
        {
          targetId: 1,
          tagName: "input",
          testId: "login-username-input",
          selector: '[data-testid="login-username-input"]',
          isVisible: true,
          isEnabled: true,
        },
        {
          targetId: 2,
          tagName: "input",
          testId: "login-password-input",
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
          tagName: "div",
          testId: "app-sidebar-div-container",
          text: "控制台侧边导航",
          selector: '[data-testid="app-sidebar-div-container"]',
          isVisible: true,
          isEnabled: true,
        },
      ],
      locator: (selector: string) => ({
        first: () => ({
          isVisible: async () => true,
        }),
      }),
    };

    const runner = new AiUiAutomationRunner({
      reportDir: tempReportDir,
      verbose: false,
    });

    const goal: TestGoal = {
      id: "full_flow_001",
      name: "端到端登录流程回归",
      description: "测试登录功能，输入用户名和密码并点击登录，校验进入首页",
      targetUrl: "http://localhost:5173/login",
      initialContext: { username: "testuser", password: "123" },
    };

    const report = await runner.runTest(goal, mockPage);

    expect(report.overallStatus).toBe("PASS");
    expect(report.stepResults.length).toBeGreaterThanOrEqual(3);
    expect(calls).toContain("goto:http://localhost:5173/login");
    expect(calls.some((c) => c.includes('fill:[data-testid="login-username-input"]'))).toBe(true);
    expect(calls.some((c) => c.includes('click:[data-testid="login-submit-button"]'))).toBe(true);

    // 验证报告文件已生成
    const htmlReport = path.join(tempReportDir, "report-full_flow_001.html");
    expect(fs.existsSync(htmlReport)).toBe(true);
    const htmlContent = fs.readFileSync(htmlReport, "utf-8");
    expect(htmlContent).toContain("端到端登录流程回归");
    expect(htmlContent).toContain("PASS");
  });
});
