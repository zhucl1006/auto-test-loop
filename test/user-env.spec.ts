import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { describeSelection } from "../src/config/selection.js"
import { CONFIG_KEYS, ensureUserEnv, parseChoice } from "../src/config/user-env.js"
import { createAutoLLMProvider } from "../src/llm/provider.js"

const previous = Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of CONFIG_KEYS) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

function tempConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autotestloop-"))
  return path.join(dir, "env")
}

describe("model config", () => {
  it("先选择 Jev 和 Gemini，只保存对应的 key", async () => {
    for (const key of CONFIG_KEYS) delete process.env[key]
    const configPath = tempConfig()
    const answers = ["1", "jev-key", "", "1", "gemini-key", ""]
    const first = await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => answers.shift() || "",
    })
    const saved = fs.readFileSync(configPath, "utf8")
    expect(first.prompted).toBe(true)
    expect(saved).toContain("AUTOTESTLOOP_DECISION=jev")
    expect(saved).toContain("TYPESAFE_API_KEY=jev-key")
    expect(saved).toContain("AUTOTESTLOOP_ANALYSIS=gemini")
    expect(saved).toContain("GEMINI_API_KEY=gemini-key")
    expect(saved).not.toContain("OPENAI_API_KEY=")
    expect(saved).not.toContain("DEEPSEEK_API_KEY=")
    expect(describeSelection()).toContain("Jev")
    expect(describeSelection()).toContain("Gemini")
    expect(createAutoLLMProvider()?.name).toContain("Gemini")

    delete process.env.TYPESAFE_API_KEY
    delete process.env.GEMINI_API_KEY
    let asked = false
    const second = await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => {
        asked = true
        return "2"
      },
    })
    expect(second.prompted).toBe(false)
    expect(asked).toBe(false)
    expect(process.env.TYPESAFE_API_KEY).toBe("jev-key")
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
  })

  it("选择 DeepSeek 时不询问 Gemini key", async () => {
    for (const key of CONFIG_KEYS) delete process.env[key]
    const configPath = tempConfig()
    const answers = ["2", "3", "ds-key", ""]
    await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => answers.shift() || "",
    })
    const saved = fs.readFileSync(configPath, "utf8")
    expect(saved).toContain("AUTOTESTLOOP_DECISION=local")
    expect(saved).toContain("AUTOTESTLOOP_ANALYSIS=deepseek")
    expect(saved).toContain("DEEPSEEK_API_KEY=ds-key")
    expect(saved).not.toContain("GEMINI_API_KEY=")
    expect(createAutoLLMProvider()?.name).toContain("deepseek-chat")
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
  })

  it("选择 Ollama 时不要求云端 key", async () => {
    for (const key of CONFIG_KEYS) delete process.env[key]
    const configPath = tempConfig()
    const answers = ["2", "4", "", ""]
    await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => answers.shift() || "",
    })
    const saved = fs.readFileSync(configPath, "utf8")
    expect(saved).toContain("AUTOTESTLOOP_ANALYSIS=ollama")
    expect(saved).toContain("OLLAMA_BASE_URL=http://127.0.0.1:11434/v1")
    expect(saved).toContain("OLLAMA_MODEL=qwen2.5")
    expect(saved).not.toContain("OLLAMA_API_KEY=")
    expect(createAutoLLMProvider()?.name).toContain("qwen2.5")
    expect(describeSelection()).toContain("Ollama")
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
  })

  it("无法识别的序号回退到推荐项", () => {
    expect(parseChoice("nope", [{ id: "jev", aliases: ["1", "jev"] }], "jev")).toBe("jev")
    expect(parseChoice("3", [{ id: "deepseek", aliases: ["3", "deepseek"] }], "gemini")).toBe("deepseek")
  })
})
