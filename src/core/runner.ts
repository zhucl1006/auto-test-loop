/**
 * Core Runner 调度中枢 (State Machine Orchestrator)
 *
 * 调度完整的五步闭环流程：
 * [01. LLM Planner] -> 循环([02. Jev Actor] -> [03. Playwright Executor]) -> [04. Assertion Verifier] -> [05. LLM Healer 自愈分析]
 */

import { LlmPlanner } from "./planner.js";
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
