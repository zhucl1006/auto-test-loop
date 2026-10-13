/**
 * AutoTestLoop
 * 核心类型协议契约 (Core Types & Contracts)
 *
 * 对齐五步闭环架构：
 * 01. LLM Planner (意图解析与规划)
 * 02. Observer & Actor (Jev: 元素感知与单步操作决策)
 * 03. Playwright Executor (真实浏览器执行)
 * 04. Assertion Verifier (确定性与语义断言验证)
 * 05. LLM Healer (现场捕获、根因诊断与自愈重试)
 */

export type StepActionType =
  "navigate" | "click" | "fill" | "hover" | "press" | "wait" | "select" | "scroll" | "finish";

export interface TestGoal {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  initialContext?: Record<string, any>;
  expectedAssertions?: ExpectedAssertion[];
  /** 回归套件显式步骤。存在时 Planner 必须原样采用，禁止被 LLM 或启发式改写。 */
  plannedSteps?: PlannedStep[];
  maxSteps?: number;
  timeoutMs?: number;
}

export interface PlannedStep {
  stepIndex: number;
  description: string;
  intent: StepActionType;
  semanticTarget: string; // 意图目标，例如 "用户名输入框"、"登录按钮"
  value?: string;
  optional?: boolean;
}

export interface ExpectedAssertion {
  assertionId: string;
  description: string;
  type: "url_contains" | "url_matches" | "text_visible" | "element_visible" | "custom";
  expected: string;
  semanticTarget?: string;
}

export interface ExecutionPlan {
  goalId: string;
  summary: string;
  steps: PlannedStep[];
  assertions: ExpectedAssertion[];
  rawPlanText?: string;
}

export interface ElementSnapshot {
  targetId: number; // 标号 1, 2, 3...
  tagName: string;
  role?: string;
  text?: string;
  placeholder?: string;
  testId?: string; // data-testid 优先
  ariaLabel?: string;
  value?: string;
  selector: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean;
  isEnabled: boolean;
}

export interface ActionDecision {
  action: StepActionType;
  targetId?: number;
  selector?: string;
  value?: string;
  reasoning: string;
  confidence: number;
}

export interface StepExecutionResult {
  stepIndex: number;
  plannedStep?: PlannedStep;
  action: ActionDecision;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  urlBefore: string;
  urlAfter: string;
  screenshotPath?: string;
  error?: string;
}

export interface AssertionResult {
  assertionId: string;
  description: string;
  type: ExpectedAssertion["type"];
  expected: string;
  passed: boolean;
  actual?: string;
  message?: string;
}

export type FailureCategory =
  | "PRODUCT_BUG" // 系统真实 Bug (500错误, 接口崩溃, 阻断提示)
  | "LOCATOR_DRIFT" // 前端改版导致元素选择器漂移
  | "TIMING_FLAKY" // 网络抖动、时序竞争、骨架屏未消失
  | "TEST_DATA_INVALID" // 账号失效、测试数据过期
  | "UNKNOWN";

export interface FailureDiagnosis {
  category: FailureCategory;
  rootCause: string;
  suggestedFix: string;
  canSelfHeal: boolean;
  healingAction?: ActionDecision;
}

export interface FailureContext {
  failedStepIndex?: number;
  failedStep?: StepExecutionResult;
  failedAssertions: AssertionResult[];
  currentUrl: string;
  screenshotPath?: string;
  consoleErrors: string[];
  recentElements?: ElementSnapshot[];
}

export interface AiUiTestReport {
  goal: TestGoal;
  plan: ExecutionPlan;
  overallStatus: "PASS" | "FAIL" | "HEALED";
  stepResults: StepExecutionResult[];
  assertionResults: AssertionResult[];
  diagnosis?: FailureDiagnosis;
  startTime: string;
  endTime: string;
  durationMs: number;
  screenshots: string[];
}

export interface LLMProvider {
  name: string;
  generateText(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number },
  ): Promise<string>;
  generateJson<T = any>(
    prompt: string,
    options?: { systemPrompt?: string; schemaDescription?: string },
  ): Promise<T>;
}
