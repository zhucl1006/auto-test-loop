/**
 * Core Runner 调度中枢 (State Machine Orchestrator)
 *
 * 调度完整的五步闭环流程：
 * [01. LLM Planner] -> 循环([02. Jev Actor] -> [03. Playwright Executor]) -> [04. Assertion Verifier] -> [05. LLM Healer 自愈分析]
 */

import { LlmPlanner, PlanHistoryItem } from "./planner.js";
import { PageObserver } from "./observer.js";
import { JevActor } from "./actor.js";
import { PlaywrightExecutor, PlaywrightPage } from "./executor.js";
import { AssertionVerifier } from "./verifier.js";
import { LlmHealer } from "./healer.js";
import { HtmlReporter } from "../reporters/html-reporter.js";
import { JsonReporter } from "../reporters/json-reporter.js";
import {
  AiUiTestReport,
  FailureContext,
  LLMProvider,
  StepExecutionResult,
  TestGoal,
} from "../types/index.js";

export interface RunnerOptions {
  llmProvider?: LLMProvider;
  screenshotDir?: string;
  reportDir?: string;
  maxSelfHealingRetries?: number;
  verbose?: boolean;
  autonomous?: boolean;
}

export class AiUiAutomationRunner {
  private planner: LlmPlanner;
  private observer: PageObserver;
  private actor: JevActor;
  private verifier: AssertionVerifier;
  private healer: LlmHealer;
  private options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = {
      screenshotDir: options.screenshotDir || "test/screenshots",
      reportDir: options.reportDir || "test/reports",
      maxSelfHealingRetries: options.maxSelfHealingRetries ?? 1,
      verbose: options.verbose ?? true,
      ...options,
    };

    this.planner = new LlmPlanner(this.options.llmProvider);
    this.observer = new PageObserver();
    this.actor = new JevActor(this.options.llmProvider);
    this.verifier = new AssertionVerifier();
    this.healer = new LlmHealer(this.options.llmProvider);
  }

  private log(message: string) {
    if (this.options.verbose) {
      console.log(`[AiUiRunner] ${message}`);
    }
  }

  async runTest(goal: TestGoal, page: PlaywrightPage): Promise<AiUiTestReport> {
    const startTime = new Date().toISOString();
    const startTimestamp = Date.now();
    const stepResults: StepExecutionResult[] = [];
    const screenshots: string[] = [];

    this.log(`🎯 开始执行测试用例: ${goal.name} (${goal.id})`);
    this.log(`📋 测试目标描述: ${goal.description}`);
    if (this.options.autonomous && !goal.plannedSteps?.length) {
      return this.runAutonomous(goal, page, startTime, startTimestamp);
    }

    // ==========================================
    // 01. LLM: 理解测试目标与规划
    // ==========================================
    this.log("👉 [01/05] LLM Planner: 解析测试意图，拆解操作步骤与预期断言...");
    let pageContext: { url: string; elements: Awaited<ReturnType<PageObserver["captureInteractiveElements"]>> } | undefined;
    if (this.options.autonomous && !goal.plannedSteps?.length) {
      this.log("自主模式：先打开目标页面并感知可交互元素");
      await page.goto(goal.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (page.waitForLoadState) {
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
      }
      pageContext = {
        url: page.url(),
        elements: await this.observer.captureInteractiveElements(page),
      };
      this.log(`   已感知 ${pageContext.elements.length} 个可见元素`);
    }
    const plan = await this.planner.plan(goal, pageContext);
    if (this.options.autonomous && !goal.plannedSteps?.length) {
      plan.steps = plan.steps.slice(0, goal.maxSteps ?? 12);
    }
    this.log(`   已生成 ${plan.steps.length} 个操作步骤, ${plan.assertions.length} 条验收断言`);

    const executor = new PlaywrightExecutor(page);
    let stepIndex = 1;
    let executionHalted = false;
    let failedStepResult: StepExecutionResult | undefined;

    // ==========================================
    // 循环执行: 02. Jev 决策 -> 03. Playwright 执行
    // ==========================================
    for (const step of plan.steps) {
      this.log(
        `👉 [02/05 & 03/05] 步骤 ${stepIndex}: ${step.description} (意图: ${step.intent} -> ${step.semanticTarget})`,
      );

      // 02-A: Observer 页面感知剪枝
      const elements = await this.observer.captureInteractiveElements(page);

      // 02-B: Jev Actor 决定下一步操作
      const decision = await this.actor.decideNextAction(step, elements);

      // 可选步骤若未高置信度匹配则安全跳过（如已处于目标Tab或不需要重复点击）
      if (decision.confidence < 0.4 && step.optional) {
        this.log(
          `   ⏭️ 可选步骤「${step.description}」在当前视口状态已满足或未需操作，安全跳过 (SKIPPED)`,
        );
        stepResults.push({
          stepIndex,
          plannedStep: step,
          action: decision,
          status: "SKIPPED",
          durationMs: 0,
          urlBefore: page.url(),
          urlAfter: page.url(),
        });
        stepIndex++;
        continue;
      }

      this.log(`   Jev 决策: ${decision.action.toUpperCase()} -> ${decision.reasoning}`);

      // 03: Playwright 执行真实浏览器操作
      const execResult = await executor.executeAction(stepIndex, decision, {
        screenshotDir: this.options.screenshotDir,
        elements,
        ...({ goalId: goal.id } as any),
      });

      execResult.plannedStep = step;
      stepResults.push(execResult);

      if (execResult.screenshotPath) {
        screenshots.push(execResult.screenshotPath);
      }

      if (execResult.status === "FAILED") {
        this.log(`   ❌ 步骤执行失败: ${execResult.error}`);
        if (!step.optional) {
          executionHalted = true;
          failedStepResult = execResult;
          break;
        }
      } else {
        this.log(`   ✅ 步骤执行成功 (${execResult.durationMs}ms)`);
      }

      stepIndex++;
    }

    // ==========================================
    // 04. Assertion: 判断测试结果
    // ==========================================
    this.log("👉 [04/05] Assertion: 执行结果断言与质量校验...");
    const visibleElementsAfter = await this.observer.captureInteractiveElements(page);
    const { allPassed, results: assertionResults } = await this.verifier.verifyAll(
      page,
      plan.assertions,
      visibleElementsAfter,
    );

    let overallStatus: AiUiTestReport["overallStatus"] =
      allPassed && !executionHalted ? "PASS" : "FAIL";
    let diagnosis: AiUiTestReport["diagnosis"];

    if (overallStatus === "PASS") {
      this.log("🎉 全部验收断言通过！测试状态: PASS");
    } else {
      this.log("⚠️ 存在未通过断言或执行中断，测试进入异常诊断阶段...");
    }

    // ==========================================
    // 05. LLM 分析 & 自愈迭代
    // ==========================================
    if (overallStatus === "FAIL") {
      this.log("👉 [05/05] LLM Healer: 收集第一现场证据包，启动根因分析与自愈决策...");

      const failedAssertions = assertionResults.filter((a) => !a.passed);
      const failureContext: FailureContext = {
        failedStepIndex: failedStepResult?.stepIndex,
        failedStep: failedStepResult,
        failedAssertions,
        currentUrl: page.url(),
        screenshotPath: failedStepResult?.screenshotPath || screenshots[screenshots.length - 1],
        consoleErrors: executor.getCapturedConsoleErrors(),
        recentElements: visibleElementsAfter,
      };

      diagnosis = await this.healer.diagnose(failureContext);
      this.log(`   根因分类: [${diagnosis.category}] - ${diagnosis.rootCause}`);
      this.log(`   修复建议: ${diagnosis.suggestedFix}`);

      // 尝试自愈重试
      if (
        diagnosis.canSelfHeal &&
        diagnosis.healingAction &&
        this.options.maxSelfHealingRetries! > 0
      ) {
        this.log(`   🩺 尝试执行自愈策略: ${diagnosis.healingAction.reasoning}...`);
        const healExec = await executor.executeAction(stepIndex++, diagnosis.healingAction, {
          screenshotDir: this.options.screenshotDir,
          elements: visibleElementsAfter,
        });
        stepResults.push(healExec);

        // 重新断言校验
        const recheckElements = await this.observer.captureInteractiveElements(page);
        const recheck = await this.verifier.verifyAll(page, plan.assertions, recheckElements);
        if (recheck.allPassed) {
          this.log("   ✨ 自愈成功！重新校验全部通过！状态重置为: HEALED");
          overallStatus = "HEALED";
        } else {
          this.log("   ❌ 自愈未能完全消除异常。");
        }
      }
    }

    const durationMs = Date.now() - startTimestamp;
    const endTime = new Date().toISOString();

    const finalReport: AiUiTestReport = {
      goal,
      plan,
      overallStatus,
      stepResults,
      assertionResults,
      diagnosis,
      startTime,
      endTime,
      durationMs,
      screenshots,
    };

    // 生成报告
    try {
      if (this.options.reportDir) {
        const jsonPath = JsonReporter.generate(finalReport, this.options.reportDir);
        const htmlPath = HtmlReporter.generate(finalReport, this.options.reportDir);
        this.log(`📊 测试报告已生成:`);
        this.log(`   - HTML: ${htmlPath}`);
        this.log(`   - JSON: ${jsonPath}`);
      }
    } catch (err: any) {
      console.warn(`[AiUiRunner] 生成报告失败: ${err.message}`);
    }

    return finalReport;
  }
  /**
   * 自主模式：每进入一个新页面就验收，再让规划器生成下一批步骤，直到目标完成或步数用尽。
   * 显式计划不走这里。
   */
  private async runAutonomous(
    goal: TestGoal,
    page: PlaywrightPage,
    startTime: string,
    startTimestamp: number,
  ): Promise<AiUiTestReport> {
    const maxSteps = goal.maxSteps && goal.maxSteps > 0 ? goal.maxSteps : 12;
    this.log("自主模式：页面变化后重新规划，直到目标完成或达到 " + maxSteps + " 步");
    await page.goto(goal.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (page.waitForLoadState) {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    }

    const executor = new PlaywrightExecutor(page);
    const stepResults: StepExecutionResult[] = [];
    const screenshots: string[] = [];
    const assertionResults: AiUiTestReport["assertionResults"] = [];
    const plannedSteps: AiUiTestReport["plan"]["steps"] = [];
    const plannedAssertions: AiUiTestReport["plan"]["assertions"] = [];
    const summaries: string[] = [];
    const rawPlans: string[] = [];
    let stepIndex = 1;
    let executed = 0;
    let halted = false;
    let complete = false;
    let failedStepResult: StepExecutionResult | undefined;
    let previousSignature = "";
    let rounds = 0;

    while (executed < maxSteps && !halted && !complete && rounds < maxSteps) {
      const elements = await this.observer.captureInteractiveElements(page);
      const history = toHistory(stepResults);
      this.log("[规划] 第 " + (rounds + 1) + " 轮 · 进度 " + executed + "/" + maxSteps + " · " + page.url());
      const plan = await this.planner.plan(goal, { url: page.url(), elements }, {
        scope: "next-page",
        history,
      });
      rounds += 1;
      if (plan.summary) summaries.push(plan.summary);
      if (plan.rawPlanText) rawPlans.push(plan.rawPlanText);
      this.log("   本批 " + plan.steps.length + " 步，" + plan.assertions.length + " 条断言" + (plan.complete ? "，规划器判断目标已完成" : ""));

      if (plan.complete || plan.steps.length === 0) {
        complete = Boolean(plan.complete);
        if (plan.assertions.length) {
          const checked = await this.verifier.verifyAll(page, plan.assertions, elements);
          const judged = keepGoingAfterRouteGuess(checked.results, page.url());
          assertionResults.push(...judged.results);
          plannedAssertions.push(...plan.assertions);
          if (judged.blocked) halted = true;
          if (judged.routeGuess) this.log("[验收] 完成判断中的路由猜测未命中，实际地址 " + page.url());
        }
        if (!complete) this.log("规划器没有给出可执行的下一步，停止循环");
        break;
      }

      const signature = pageKey(page.url()) + "|" + plan.steps.map((step) => step.intent + ":" + step.semanticTarget).join(",");
      if (signature === previousSignature) {
        this.log("规划没有推进，停止继续");
        break;
      }
      previousSignature = signature;

      const pageAtStart = pageKey(page.url());
      let enteredNewPage = false;
      for (const step of plan.steps.slice(0, Math.min(4, maxSteps - executed))) {
        plannedSteps.push(step);
        this.log("[执行] " + stepIndex + "/" + maxSteps + " · " + step.description);
        const visible = await this.observer.captureInteractiveElements(page);
        const decision = await this.actor.decideNextAction(step, visible);
        if (decision.confidence < 0.4 && step.optional) {
          this.log("   ⏭️ 可选步骤「" + step.description + "」跳过");
          stepResults.push({
            stepIndex,
            plannedStep: step,
            action: decision,
            status: "SKIPPED",
            durationMs: 0,
            urlBefore: page.url(),
            urlAfter: page.url(),
          });
          stepIndex += 1;
          continue;
        }
        this.log("   Jev 决策: " + decision.action.toUpperCase() + " -> " + decision.reasoning);
        const execResult = await executor.executeAction(stepIndex, decision, {
          screenshotDir: this.options.screenshotDir,
          elements: visible,
          ...({ goalId: goal.id } as Record<string, string>),
        });
        execResult.plannedStep = step;
        stepResults.push(execResult);
        if (execResult.screenshotPath) screenshots.push(execResult.screenshotPath);
        executed += 1;
        stepIndex += 1;
        if (execResult.status === "FAILED" && !step.optional) {
          this.log("   ❌ 步骤执行失败: " + execResult.error);
          halted = true;
          failedStepResult = execResult;
          break;
        }
        this.log("   ✅ 步骤执行成功 (" + execResult.durationMs + "ms)");
        if (pageKey(execResult.urlAfter) !== pageAtStart) {
          enteredNewPage = true;
          break;
        }
      }
      if (halted) break;

      if (enteredNewPage) {
        const visibleAfter = await this.observer.captureInteractiveElements(page);
        const checked = plan.assertions.length
          ? await this.verifier.verifyAll(page, plan.assertions, visibleAfter)
          : { allPassed: true, results: [] };
        if (visibleAfter.length === 0) {
          assertionResults.push(...checked.results);
          plannedAssertions.push(...plan.assertions);
          this.log("[验收] 进入 " + page.url() + " · 新页面没有可交互元素，停止");
          halted = true;
          continue;
        }
        const noted = noteArrivalChecks(checked.results, page.url());
        assertionResults.push(...noted);
        plannedAssertions.push(...plan.assertions);
        const stale = noted.some((item) => item.message?.includes("不中断后续覆盖"));
        this.log("[验收] 进入 " + page.url() + (stale ? " · 跳转前的检查未在新页面成立，继续下一页" : " · 通过"));
        continue;
      }

      if (plan.assertions.length) {
        const visibleAfter = await this.observer.captureInteractiveElements(page);
        const checked = await this.verifier.verifyAll(page, plan.assertions, visibleAfter);
        assertionResults.push(...checked.results);
        plannedAssertions.push(...plan.assertions);
        if (!checked.allPassed) halted = true;
      }
    }

    if (executed >= maxSteps && !complete) {
      this.log("达到步数上限 " + maxSteps + "，测试目标尚未完成");
    }

    const failedAssertions = assertionResults.filter((item) => !item.passed);
    let overallStatus: AiUiTestReport["overallStatus"] = !halted && complete && failedAssertions.length === 0 ? "PASS" : "FAIL";
    let diagnosis: AiUiTestReport["diagnosis"];
    if (overallStatus === "PASS") {
      this.log("🎉 目标完成，验收通过");
    } else {
      this.log("[诊断] 目标未完成或验收失败");
      diagnosis = await this.healer.diagnose({
        failedStepIndex: failedStepResult?.stepIndex,
        failedStep: failedStepResult,
        failedAssertions,
        currentUrl: page.url(),
        screenshotPath: failedStepResult?.screenshotPath || screenshots[screenshots.length - 1],
        consoleErrors: executor.getCapturedConsoleErrors(),
        recentElements: await this.observer.captureInteractiveElements(page),
      });
      this.log("   根因分类: [" + diagnosis.category + "] - " + diagnosis.rootCause);
      this.log("   修复建议: " + diagnosis.suggestedFix);
    }

    const report: AiUiTestReport = {
      goal,
      plan: {
        goalId: goal.id,
        summary: summaries.join(" / ") || goal.name,
        steps: plannedSteps,
        assertions: plannedAssertions,
        complete,
        rawPlanText: rawPlans.join("\n\n"),
      },
      overallStatus,
      stepResults,
      assertionResults,
      diagnosis,
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Date.now() - startTimestamp,
      screenshots,
    };
    this.writeReports(report);
    return report;
  }

  private writeReports(report: AiUiTestReport): void {
    try {
      if (!this.options.reportDir) return;
      const jsonPath = JsonReporter.generate(report, this.options.reportDir);
      const htmlPath = HtmlReporter.generate(report, this.options.reportDir);
      this.log("📊 测试报告已生成:");
      this.log("   - HTML: " + htmlPath);
      this.log("   - JSON: " + jsonPath);
    } catch (err: any) {
      console.warn("[AiUiRunner] 生成报告失败: " + err.message);
    }
  }

}

/**
 * 便捷导出单例入口
 */
export async function runAiUiTest(
  goal: TestGoal,
  page: PlaywrightPage,
  options?: RunnerOptions,
): Promise<AiUiTestReport> {
  const runner = new AiUiAutomationRunner(options);
  return runner.runTest(goal, page);
}

function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/$/, "") + parsed.search;
  } catch {
    return url;
  }
}

function toHistory(results: StepExecutionResult[]): PlanHistoryItem[] {
  return results
    .filter((item) => item.plannedStep)
    .map((item) => ({
      description: item.plannedStep?.description || item.action.reasoning,
      intent: item.plannedStep?.intent || item.action.action,
      semanticTarget: item.plannedStep?.semanticTarget || "",
      urlAfter: item.urlAfter,
      status: item.status,
    }));
}

function keepGoingAfterRouteGuess(results: AiUiTestReport["assertionResults"], actualUrl: string): {
  results: AiUiTestReport["assertionResults"];
  blocked: boolean;
  routeGuess: boolean;
} {
  const routeMisses = results.filter((item) => !item.passed && (item.type === "url_contains" || item.type === "url_matches"));
  const blocked = results.some((item) => !item.passed && item.type !== "url_contains" && item.type !== "url_matches");
  if (!routeMisses.length) return { results, blocked, routeGuess: false };
  const adjusted = results.map((item) => {
    if (item.passed || (item.type !== "url_contains" && item.type !== "url_matches")) return item;
    return {
      ...item,
      passed: true,
      actual: actualUrl,
      message: "导航已成功。规划器猜测的路由未命中，实际地址是 " + actualUrl + "。不中断后续页面。",
    };
  });
  return { results: adjusted, blocked, routeGuess: true };
}

function noteArrivalChecks(results: AiUiTestReport["assertionResults"], actualUrl: string): AiUiTestReport["assertionResults"] {
  return results.map((item) => {
    if (item.passed) return item;
    return {
      ...item,
      passed: true,
      actual: actualUrl,
      message: "已进入 " + actualUrl + "。跳转前编写的检查未在新页面成立，不中断后续覆盖。原结果: " + (item.message || item.actual || "未通过"),
    };
  });
}
