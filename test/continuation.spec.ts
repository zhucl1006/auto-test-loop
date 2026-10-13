import fs from "fs"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { AiUiAutomationRunner } from "../src/core/runner.js"
import { LLMProvider, TestGoal } from "../src/types/index.js"

class ScriptedPlanner implements LLMProvider {
  name = "scripted"
  calls: string[] = []
  async generateText(): Promise<string> {
    return ""
  }
  async generateJson<T>(prompt: string): Promise<T> {
    this.calls.push(prompt)
    if (prompt.includes("https://example.test/app/campaigns")) {
      return {
        summary: "侧边栏页面已覆盖",
        complete: true,
        steps: [],
        assertions: [
          { assertionId: "done", description: "活动页标题可见", type: "text_visible", expected: "活动列表" },
        ],
      } as T
    }
    if (prompt.includes("https://example.test/app")) {
      return {
        summary: "进入行销活动",
        complete: false,
        steps: [
          { stepIndex: 1, description: "点击行销活动", intent: "click", semanticTarget: "行销活动", optional: false },
        ],
        assertions: [
          { assertionId: "campaign", description: "进入活动页", type: "url_contains", expected: "/campaigns" },
        ],
      } as T
    }
    return {
      summary: "先登录",
      complete: false,
      steps: [
        { stepIndex: 1, description: "输入账号", intent: "fill", semanticTarget: "用户名输入框", value: "qa@example.com" },
        { stepIndex: 2, description: "输入密码", intent: "fill", semanticTarget: "密码输入框", value: "secret" },
        { stepIndex: 3, description: "点击登录", intent: "click", semanticTarget: "登录提交按钮" },
      ],
      assertions: [
        { assertionId: "app", description: "进入控制台", type: "url_contains", expected: "/app" },
      ],
    } as T
  }
}

describe("autonomous continuation", () => {
  it("登录后按 URL 变化继续规划，并在目标完成时停止", async () => {
    let currentUrl = "https://example.test/login"
    const provider = new ScriptedPlanner()
    const page: any = {
      url: () => currentUrl,
      goto: async (url: string) => {
        currentUrl = url
      },
      click: async (selector: string) => {
        if (selector.includes("submit")) currentUrl = "https://example.test/app"
        if (selector.includes("nav-campaigns")) currentUrl = "https://example.test/app/campaigns"
      },
      fill: async () => {},
      hover: async () => {},
      press: async () => {},
      waitForTimeout: async () => {},
      waitForLoadState: async () => {},
      screenshot: async () => Buffer.from("png"),
      on: () => {},
      locator: () => ({ first: () => ({ isVisible: async () => true }) }),
      evaluate: async () => {
        if (currentUrl.includes("/campaigns")) {
          return [{ targetId: 1, tagName: "h1", text: "活动列表", testId: "campaign-title", selector: "h1", isVisible: true, isEnabled: true }]
        }
        if (currentUrl.endsWith("/app")) {
          return [{ targetId: 1, tagName: "a", text: "行销活动", testId: "nav-campaigns", selector: '[data-testid="nav-campaigns"]', isVisible: true, isEnabled: true }]
        }
        return [
          { targetId: 1, tagName: "input", testId: "login-username-input", selector: '[data-testid="login-username-input"]', isVisible: true, isEnabled: true },
          { targetId: 2, tagName: "input", type: "password", testId: "login-password-input", selector: '[data-testid="login-password-input"]', isVisible: true, isEnabled: true },
          { targetId: 3, tagName: "button", text: "登录", testId: "login-submit-button", selector: '[data-testid="login-submit-button"]', isVisible: true, isEnabled: true },
        ]
      },
    }
    const goal: TestGoal = {
      id: "continue_1",
      name: "登录后检查侧边栏",
      description: "登录并确认进入控制台后，测试行销活动",
      targetUrl: "https://example.test/login",
      maxSteps: 8,
    }
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-continue-"))
    const report = await new AiUiAutomationRunner({
      llmProvider: provider,
      autonomous: true,
      verbose: false,
      reportDir,
    }).runTest(goal, page)
    fs.rmSync(reportDir, { recursive: true, force: true })

    expect(provider.calls.length).toBeGreaterThanOrEqual(3)
    expect(report.overallStatus).toBe("PASS")
    expect(report.plan.complete).toBe(true)
    expect(report.stepResults.some((step) => step.action.action === "click" && step.urlAfter?.includes("/campaigns"))).toBe(true)
    expect(currentUrl).toBe("https://example.test/app/campaigns")
  })

  it("导航成功但规划器猜错路由时，不中断后续页面", async () => {
    let currentUrl = "https://example.test/login"
    const provider = new ScriptedPlanner()
    provider.generateJson = async function <T>(prompt: string): Promise<T> {
      this.calls.push(prompt)
      if (prompt.includes("https://example.test/app/campaigns")) {
        return { summary: "已覆盖", complete: true, steps: [], assertions: [] } as T
      }
      if (prompt.includes("https://example.test/app")) {
        return {
          summary: "进入行销活动",
          complete: false,
          steps: [{ stepIndex: 1, description: "点击行销活动", intent: "click", semanticTarget: "行销活动" }],
          assertions: [{ assertionId: "bad-route", description: "猜错的路由", type: "url_contains", expected: "/app/campaigns-wrong" }],
        } as T
      }
      return {
        summary: "先登录",
        complete: false,
        steps: [{ stepIndex: 1, description: "点击登录", intent: "click", semanticTarget: "登录提交按钮" }],
        assertions: [{ assertionId: "app", description: "进入控制台", type: "url_contains", expected: "/app" }],
      } as T
    }
    const page: any = {
      url: () => currentUrl,
      goto: async (url: string) => { currentUrl = url },
      click: async (selector: string) => {
        if (selector.includes("submit")) currentUrl = "https://example.test/app"
        if (selector.includes("nav-campaigns")) currentUrl = "https://example.test/app/campaigns"
      },
      fill: async () => {},
      hover: async () => {},
      press: async () => {},
      waitForTimeout: async () => {},
      waitForLoadState: async () => {},
      screenshot: async () => Buffer.from("png"),
      on: () => {},
      locator: () => ({ first: () => ({ isVisible: async () => true }) }),
      evaluate: async () => currentUrl.endsWith("/app")
        ? [{ targetId: 1, tagName: "a", text: "行销活动", testId: "nav-campaigns", selector: '[data-testid="nav-campaigns"]', isVisible: true, isEnabled: true }]
        : [{ targetId: 1, tagName: "button", text: "登录", testId: "login-submit-button", selector: '[data-testid="login-submit-button"]', isVisible: true, isEnabled: true }],
    }
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-route-"))
    const report = await new AiUiAutomationRunner({
      llmProvider: provider,
      autonomous: true,
      verbose: false,
      reportDir,
    }).runTest({
      id: "route_guess",
      name: "猜错路由仍继续",
      description: "登录后打开行销活动",
      targetUrl: "https://example.test/login",
      maxSteps: 6,
    }, page)
    fs.rmSync(reportDir, { recursive: true, force: true })
    expect(report.overallStatus).toBe("PASS")
    expect(currentUrl).toBe("https://example.test/app/campaigns")
    expect(report.assertionResults.some((item) => item.message?.includes("不中断后续覆盖"))).toBe(true)
  })

  it("点击后打开模态窗口且地址不变时，继续规划而不是停止", async () => {
    let currentUrl = "https://example.test/templates"
    let opened = false
    const calls: string[] = []
    const provider: LLMProvider = {
      name: "modal",
      async generateText() { return "" },
      async generateJson<T>(prompt: string): Promise<T> {
        calls.push(prompt)
        if (prompt.includes("Dialog open: yes") || calls.length > 1) {
          return { summary: "关闭新建范本弹窗", complete: true, steps: [], assertions: [] } as T
        }
        return {
          summary: "点击新建范本",
          complete: false,
          steps: [{ stepIndex: 1, description: "点击新建范本按钮", intent: "click", semanticTarget: "新建範本" }],
          assertions: [{ assertionId: "opened", description: "确认触发新建范本操作", type: "element_visible", expected: "新建範本" }],
        } as T
      },
    }
    const page: any = {
      url: () => currentUrl,
      goto: async () => {},
      click: async () => { opened = true },
      fill: async () => {},
      hover: async () => {},
      press: async () => {},
      waitForTimeout: async () => {},
      waitForLoadState: async () => {},
      screenshot: async () => Buffer.from("png"),
      on: () => {},
      locator: () => ({ first: () => ({ isVisible: async () => false }) }),
      evaluate: async () => opened
        ? "create-template-dialog"
        : [{ targetId: 1, tagName: "button", text: "新建範本", testId: "template-list-page-header-btn-create", selector: '[data-testid="template-list-page-header-btn-create"]', isVisible: true, isEnabled: true }],
    }
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-modal-"))
    const report = await new AiUiAutomationRunner({
      llmProvider: provider,
      autonomous: true,
      verbose: false,
      reportDir,
    }).runTest({
      id: "modal_1",
      name: "模态窗口",
      description: "测试新建范本弹窗",
      targetUrl: "https://example.test/templates",
      maxSteps: 4,
    }, page)
    const html = fs.readFileSync(path.join(reportDir, "report-modal_1.html"), "utf8")
    fs.rmSync(reportDir, { recursive: true, force: true })
    expect(report.overallStatus).toBe("PASS")
    expect(report.rounds?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain("第 1 轮")
    expect(html).toContain("点击新建范本")
  })

  it("关闭按钮没有文字时按 Escape，而不是因为重复计划停止", async () => {
    let currentUrl = "https://example.test/app/contacts"
    let dialog = "batch-invite"
    const calls: string[] = []
    const provider: LLMProvider = {
      name: "close",
      async generateText() { return "" },
      async generateJson<T>(prompt: string): Promise<T> {
        calls.push(prompt)
        if (!dialog) {
          return { summary: "弹窗已关闭", complete: true, steps: [], assertions: [] } as T
        }
        return {
          summary: "关闭批量邀请进线弹窗",
          complete: false,
          steps: [{ stepIndex: 1, description: "点击弹窗右上角关闭按钮关闭批量邀请进线弹窗", intent: "click", semanticTarget: "-" }],
          assertions: [{ assertionId: "stay", description: "仍在联系人页", type: "url_contains", expected: "/app/contacts" }],
        } as T
      },
    }
    const page: any = {
      url: () => currentUrl,
      goto: async () => {},
      click: async () => {},
      fill: async () => {},
      hover: async () => {},
      press: async (_selector: string, key: string) => { if (key === "Escape") dialog = "" },
      waitForTimeout: async () => {},
      waitForLoadState: async () => {},
      screenshot: async () => Buffer.from("png"),
      on: () => {},
      locator: () => ({ first: () => ({ isVisible: async () => true }) }),
      evaluate: async (fn: unknown) => {
        const source = typeof fn === "function" ? fn.toString() : ""
        if (source.includes('role="dialog"')) return dialog
        return [{ targetId: 1, tagName: "button", text: "下一步", testId: "next", selector: "button", isVisible: true, isEnabled: true }]
      },
    }
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-escape-"))
    const report = await new AiUiAutomationRunner({
      llmProvider: provider,
      autonomous: true,
      verbose: false,
      reportDir,
    }).runTest({
      id: "escape_1",
      name: "关闭无文字弹窗",
      description: "关闭批量邀请进线弹窗后继续",
      targetUrl: "https://example.test/app/contacts",
      maxSteps: 4,
    }, page)
    fs.rmSync(reportDir, { recursive: true, force: true })
    expect(report.overallStatus).toBe("PASS")
    expect(report.stepResults.some((step) => step.action.action === "press" && step.action.value === "Escape")).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })
})
