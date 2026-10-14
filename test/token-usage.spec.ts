import { describe, expect, it } from "vitest"
import {
  formatTokenSummary,
  parseTokenUsage,
  recordTokenUsage,
  resetTokenUsage,
  setTokenLogger,
  snapshotTokenUsage,
} from "../src/llm/token-usage.js"

describe("token usage", () => {
  it("读取 Gemini 和 OpenAI 的用量字段", () => {
    expect(parseTokenUsage({
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
    })).toEqual({ input: 120, output: 30, total: 150 })
    expect(parseTokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    })).toEqual({ input: 10, output: 4, total: 14 })
    expect(parseTokenUsage({ answers: { target: { choice: "e1" } } })).toBeNull()
  })

  it("实时累计，并标明未返回用量的调用", () => {
    const lines: string[] = []
    setTokenLogger((line) => lines.push(line))
    resetTokenUsage()
    recordTokenUsage({ source: "Gemini", model: "gemini-3.8-flash", input: 100, output: 20, total: 120 })
    recordTokenUsage({ source: "Jev", model: "jev-latest", reported: false })
    const summary = snapshotTokenUsage()
    expect(summary.total).toBe(120)
    expect(summary.unreported).toBe(1)
    expect(lines[0]).toContain("Gemini")
    expect(lines[0]).toContain("累计合计")
    expect(lines[1]).toContain("未返回 token 用量")
    expect(formatTokenSummary(summary)).toContain("合计 120")
    expect(formatTokenSummary(summary)).toContain("未返回用量 1 次")
    setTokenLogger((line) => console.log(line))
  })
})
