/**
 * Step 03: Playwright Executor (真实浏览器执行引擎)
 *
 * 职责：
 * 1. 接收 Jev Actor 的决策指令 (ActionDecision)
 * 2. 调度 Playwright 执行浏览器真实操作 (click, fill, navigate, hover 等)
 * 3. 处理等待、超时降级与现场状态捕获 (截图、前后 URL、Console 日志)
 */

import { ActionDecision, ElementSnapshot, StepExecutionResult } from "../types/index.js";

export interface PlaywrightPage {
  goto(url: string, options?: any): Promise<any>;
  click(selector: string, options?: any): Promise<any>;
  fill(selector: string, value: string, options?: any): Promise<any>;
  hover(selector: string, options?: any): Promise<any>;
  press(selector: string, key: string, options?: any): Promise<any>;
  waitForTimeout(timeout: number): Promise<any>;
  waitForLoadState?(state?: string, options?: any): Promise<any>;
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer | any>;
  url(): string;
  on(event: string, handler: (...args: any[]) => void): any;
  locator(selector: string): any;
  evaluate<T = any>(pageFunction: string | ((...args: any[]) => any), arg?: any): Promise<T>;
}

export class PlaywrightExecutor {
  private consoleLogs: string[] = [];

  constructor(private page: PlaywrightPage) {
    this.setupConsoleListener();
  }

  private setupConsoleListener() {
    try {
      this.page.on("console", (msg: any) => {
        const type = typeof msg.type === "function" ? msg.type() : msg.type;
        const text = typeof msg.text === "function" ? msg.text() : msg.text;
        if (type === "error") {
          this.consoleLogs.push(`[Browser Error] ${text}`);
        }
      });
    } catch {
      // 兼容非原生测试环境
    }
  }

  getCapturedConsoleErrors(): string[] {
    return [...this.consoleLogs];
  }

  clearConsoleLogs() {
    this.consoleLogs = [];
  }

  async executeAction(
    stepIndex: number,
    decision: ActionDecision,
    options?: { screenshotDir?: string; elements?: ElementSnapshot[] },
  ): Promise<StepExecutionResult> {
    const urlBefore = this.page.url();
    const startTime = Date.now();
    let status: StepExecutionResult["status"] = "SUCCESS";
    let errorMessage: string | undefined;

    try {
      switch (decision.action) {
        case "navigate": {
          const targetUrl = decision.value || "about:blank";
          await this.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          if (this.page.waitForLoadState) {
            await this.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
          }
          break;
        }

        case "click": {
          const selector = this.resolveSelector(decision, options?.elements);
          if (!selector) {
            throw new Error(`无法定位点击目标选择器: ${decision.reasoning}`);
          }
          await this.clickWithRetry(selector);
          await this.page.waitForTimeout(800);
          if (this.page.waitForLoadState) {
            await this.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
          }
          break;
        }

        case "fill": {
          const selector = this.resolveSelector(decision, options?.elements);
          if (!selector) {
            throw new Error(`无法定位输入目标选择器: ${decision.reasoning}`);
          }
          await this.fillWithRetry(selector, decision.value || "");
          await this.page.waitForTimeout(300);
          break;
        }

        case "hover": {
          const selector = this.resolveSelector(decision, options?.elements);
          if (selector) {
            await this.page.hover(selector);
          }
          break;
        }

        case "press": {
          const key = decision.value || "Enter";
          const selector = this.resolveSelector(decision, options?.elements) || "body";
          await this.page.press(selector, key);
          break;
        }

        case "wait": {
          const ms = parseInt(decision.value || "1000", 10);
          await this.page.waitForTimeout(ms);
          break;
        }

        case "finish":
          break;

        default:
          throw new Error(`不支持的操作类型: ${decision.action}`);
      }
    } catch (err: any) {
      status = "FAILED";
      errorMessage = err.message;
    }

    const durationMs = Date.now() - startTime;
    const urlAfter = this.page.url();

    // 捕获步骤后截图 (包含 goalId 避免被后续场景覆盖)
    let screenshotPath: string | undefined;
    if (options?.screenshotDir) {
      const prefix = (options as any)?.goalId ? `${(options as any).goalId}-` : "";
      const fileName = `${prefix}step-${stepIndex}-${decision.action}-${status.toLowerCase()}.png`;
      screenshotPath = `${options.screenshotDir.replace(/\/+$/, "")}/${fileName}`;
      try {
        await this.page.screenshot({ path: screenshotPath, fullPage: false });
      } catch {
        // 忽略截图错误
      }
    }

    return {
      stepIndex,
      action: decision,
      status,
      durationMs,
      urlBefore,
      urlAfter,
      screenshotPath,
      error: errorMessage,
    };
  }

  private resolveSelector(decision: ActionDecision, elements?: ElementSnapshot[]): string {
    if (decision.selector) return decision.selector;
    if (decision.targetId && elements) {
      const el = elements.find((e) => e.targetId === decision.targetId);
      if (el) return el.selector;
    }
    return "";
  }

  private async clickWithRetry(selector: string, retries = 2): Promise<void> {
    for (let i = 0; i <= retries; i++) {
      try {
        await this.page.click(selector, { timeout: 4000 });
        return;
      } catch (err: any) {
        if (i === retries) throw err;
        await this.page.waitForTimeout(500);
      }
    }
  }

  private async fillWithRetry(selector: string, value: string, retries = 2): Promise<void> {
    for (let i = 0; i <= retries; i++) {
      try {
        await this.page.fill(selector, value, { timeout: 4000 });
        return;
      } catch (err: any) {
        if (i === retries) throw err;
        await this.page.waitForTimeout(500);
      }
    }
  }
}
