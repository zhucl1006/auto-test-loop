import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { REPORT_LANG_KEY, reportLanguageInstruction, resolveReportLanguage } from "../src/config/report-language.js"
import { CONFIG_KEYS, ensureUserEnv } from "../src/config/user-env.js"
import { LlmPlanner } from "../src/core/planner.js"
import { LlmHealer } from "../src/core/healer.js"
import { LLMProvider } from "../src/types/index.js"

const previous = process.env[REPORT_LANG_KEY]

afterEach(() => {
  if (previous === undefined) delete process.env[REPORT_LANG_KEY]
  else process.env[REPORT_LANG_KEY] = previous
})

describe("report language", () => {
  it("默认简体中文", () => {
    delete process.env[REPORT_LANG_KEY]
    const language = resolveReportLanguage()
    expect(language.code).toBe("zh-CN")
    expect(language.label).toBe("简体中文")
    expect(reportLanguageInstruction()).toContain("简体中文")
    expect(reportLanguageInstruction()).toContain("semanticTarget must stay in the page's visible language")
  })

  it("识别预设和自定义语言", () => {
    expect(resolveReportLanguage("en").code).toBe("en")
    expect(resolveReportLanguage("繁體中文").prose).toContain("繁體中文")
    expect(resolveReportLanguage(" 日本語 ").label).toBe("日本語")
  })

  it("config 回车保存简体中文，也可以改成 English", async () => {
    for (const key of CONFIG_KEYS) delete process.env[key]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autotestloop-lang-"))
    const configPath = path.join(dir, "env")
    await ensureUserEnv({
      force: true,
      interactive: true,
      configPath,
      ask: async () => "",
    })
    expect(fs.readFileSync(configPath, "utf8")).toContain("AUTOTESTLOOP_REPORT_LANG=zh-CN")

    const answers = ["2", "5", "en"]
    await ensureUserEnv({
      force: true,
      interactive: true,
      configPath,
      ask: async () => answers.shift() || "",
    })
    expect(fs.readFileSync(configPath, "utf8")).toContain("AUTOTESTLOOP_REPORT_LANG=en")
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

class CaptureProvider implements LLMProvider {
  name = "capture"
  system = ""
  async generateText(): Promise<string> {
    return ""
  }
  async generateJson<T>(_prompt: string, options?: { systemPrompt?: string }): Promise<T> {
    this.system = options?.systemPrompt || ""
    return { summary: "s", steps: [], assertions: [], category: "UNKNOWN", rootCause: "r", suggestedFix: "f", canSelfHeal: false } as T
  }
}

describe("model prompts follow report language", () => {
  it("规划提示要求使用已配置语言", async () => {
    process.env[REPORT_LANG_KEY] = "en"
    const provider = new CaptureProvider()
    await new LlmPlanner(provider).plan({
      id: "lang",
      name: "语言",
      description: "打开页面",
      targetUrl: "https://example.com",
    })
    expect(provider.system).toContain("English")
    expect(provider.system).not.toContain("简体中文")
  })

  it("诊断提示要求使用已配置语言", async () => {
    process.env[REPORT_LANG_KEY] = "zh-TW"
    const provider = new CaptureProvider()
    await new LlmHealer(provider).diagnose({
      currentUrl: "https://example.com/app",
      failedAssertions: [],
      consoleErrors: [],
    })
    expect(provider.system).toContain("繁體中文")
  })
})
