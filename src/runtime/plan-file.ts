import fs from "fs"
import path from "path"
import { ExpectedAssertion, PlannedStep, TestGoal } from "../types/index.js"

export interface PlanFile {
  id?: string
  name?: string
  description?: string
  targetUrl?: string
  plannedSteps?: PlannedStep[]
  expectedAssertions?: ExpectedAssertion[]
  initialContext?: Record<string, string>
  maxSteps?: number
}

export function loadPlanFile(filePath: string): PlanFile {
  const absolute = path.resolve(filePath)
  if (!fs.existsSync(absolute)) throw new Error("找不到计划文件: " + absolute)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error("计划文件不是合法 JSON: " + message)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("计划文件必须是 JSON 对象")
  }
  const plan = parsed as PlanFile
  if (!Array.isArray(plan.plannedSteps) || plan.plannedSteps.length === 0) {
    throw new Error("计划模式需要 plannedSteps，且至少包含一步")
  }
  return plan
}

export function goalFromPlan(plan: PlanFile, fallback: { url?: string; description?: string; context: Record<string, string> }): TestGoal {
  const targetUrl = plan.targetUrl || fallback.url
  if (!targetUrl) throw new Error("计划文件或 --url 需要目标地址")
  return {
    id: plan.id || "plan_" + Date.now(),
    name: plan.name || "计划模式测试",
    description: plan.description || fallback.description || plan.name || "按显式计划执行",
    targetUrl,
    plannedSteps: plan.plannedSteps,
    expectedAssertions: plan.expectedAssertions,
    initialContext: { ...fallback.context, ...(plan.initialContext || {}) },
    maxSteps: plan.maxSteps,
  }
}
