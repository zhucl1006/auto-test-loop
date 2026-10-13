import fs from "fs"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { goalFromPlan, loadPlanFile } from "../src/runtime/plan-file.js"

describe("plan file", () => {
  it("读取显式计划并保留步骤", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autotestloop-plan-"))
    const file = path.join(dir, "plan.json")
    fs.writeFileSync(file, JSON.stringify({
      name: "定价页",
      targetUrl: "https://example.com/pricing",
      plannedSteps: [{ stepIndex: 1, description: "打开", intent: "navigate", semanticTarget: "page", value: "https://example.com/pricing" }],
      expectedAssertions: [{ assertionId: "url", description: "定价页", type: "url_contains", expected: "/pricing" }],
    }))
    const plan = loadPlanFile(file)
    const goal = goalFromPlan(plan, { context: { email: "qa@example.com" } })
    expect(goal.plannedSteps).toHaveLength(1)
    expect(goal.targetUrl).toBe("https://example.com/pricing")
    expect(goal.initialContext?.email).toBe("qa@example.com")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("没有步骤时拒绝进入计划模式", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autotestloop-plan-"))
    const file = path.join(dir, "empty.json")
    fs.writeFileSync(file, "{}")
    expect(() => loadPlanFile(file)).toThrow(/plannedSteps/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
