/**
 * 本机模型配置。
 * 只保存模型密钥和配置完成标记，不保存账密。
 */

import fs from "fs"
import os from "os"
import path from "path"
import readline from "readline"

export const CONFIGURED_FLAG = "AUTOTESTLOOP_CONFIGURED"

export const MODEL_PROMPTS = [
  { key: "TYPESAFE_API_KEY", label: "Jev / TypeSafe API Key", secret: true },
  { key: "GEMINI_API_KEY", label: "Gemini API Key", secret: true },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", secret: true },
  { key: "OPENAI_BASE_URL", label: "OpenAI 兼容接口地址", secret: false },
  { key: "DEEPSEEK_API_KEY", label: "DeepSeek API Key", secret: true },
] as const

export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".config", "auto-test-loop", "env")
}

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1)
  }
  return values
}

export function serializeEnvFile(values: Record<string, string>): string {
  const lines = Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => key + "=" + value.replace(/\r?\n/g, ""))
  return lines.length ? lines.join("\n") + "\n" : ""
}

export function applyMissingEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (key === CONFIGURED_FLAG || !value) continue
    if (!process.env[key]) process.env[key] = value
  }
}

export async function ensureUserEnv(options: {
  force?: boolean
  interactive?: boolean
  configPath?: string
  ask?: (label: string, secret: boolean) => Promise<string>
} = {}): Promise<{ path: string; prompted: boolean }> {
  const configPath = options.configPath || defaultConfigPath()
  const saved = fs.existsSync(configPath) ? parseEnvFile(fs.readFileSync(configPath, "utf8")) : {}
  applyMissingEnv(saved)

  const interactive = options.interactive ?? false
  const configured = saved[CONFIGURED_FLAG] === "1"
  if (!options.force && (configured || !interactive)) {
    return { path: configPath, prompted: false }
  }

  const pending = MODEL_PROMPTS.filter((item) => options.force || !(process.env[item.key] || saved[item.key]))
  const next: Record<string, string> = { ...saved, [CONFIGURED_FLAG]: "1" }
  if (pending.length === 0) {
    writeConfig(configPath, next)
    return { path: configPath, prompted: false }
  }

  const ask = options.ask || askOnTerminal
  console.log("首次使用可以输入模型密钥。直接回车表示跳过。")
  console.log("配置只保存在本机，下次不再询问: " + configPath)
  for (const item of pending) {
    const current = process.env[item.key] || saved[item.key] || ""
    const hint = current ? "，回车保留已有值" : "，可回车跳过"
    const answer = (await ask(item.label + hint + ": ", item.secret)).trim()
    if (answer) next[item.key] = answer
    else if (current) next[item.key] = current
  }
  writeConfig(configPath, next)
  applyMissingEnv(next)
  return { path: configPath, prompted: true }
}

export function askVisible(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let value = ""
    const onData = (char: string) => {
      if (char === "\u0003") {
        cleanup()
        process.stdout.write("\n")
        reject(new Error("已取消输入"))
        return
      }
      if (char === "\r" || char === "\n") {
        process.stdout.write("\n")
        cleanup()
        resolve(value.trim())
        return
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1)
        return
      }
      value += char
      process.stdout.write("*")
    }
    const cleanup = () => {
      stdin.setRawMode?.(false)
      stdin.pause()
      stdin.off("data", onData)
    }
    stdin.on("data", onData)
  })
}

async function askOnTerminal(label: string, secret: boolean): Promise<string> {
  return secret ? askHidden(label) : askVisible(label)
}

function writeConfig(configPath: string, values: Record<string, string>): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 })
  fs.writeFileSync(configPath, serializeEnvFile(values), { mode: 0o600 })
  fs.chmodSync(configPath, 0o600)
}
