/**
 * 本机模型配置。
 * 先选择决策模型和规划模型，再只询问对应的 key。不保存账密。
 */

import fs from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { DEFAULT_REPORT_LANG, REPORT_LANG_KEY, resolveReportLanguage } from "./report-language.js"
import { ANALYSIS_KEY, DECISION_KEY, DEFAULT_GEMINI_MODEL, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "./selection.js"

export const CONFIGURED_FLAG = "AUTOTESTLOOP_CONFIGURED"

export const CONFIG_KEYS = [
  CONFIGURED_FLAG,
  DECISION_KEY,
  ANALYSIS_KEY,
  "TYPESAFE_API_KEY",
  "TYPESAFE_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_BASE_URL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_API_KEY",
  REPORT_LANG_KEY,
  "AUTO_MAX_STEPS",
]

const DECISION_CHOICES = [
  { id: "jev", label: "Jev，负责选择页面元素", aliases: ["1", "jev", "j"] },
  { id: "local", label: "本地规则", aliases: ["2", "local", "本地", "规则"] },
]

const ANALYSIS_CHOICES = [
  { id: "gemini", label: "Gemini，负责规划与诊断", aliases: ["1", "gemini", "g"] },
  { id: "openai", label: "OpenAI", aliases: ["2", "openai"] },
  { id: "deepseek", label: "DeepSeek", aliases: ["3", "deepseek", "ds"] },
  { id: "ollama", label: "Ollama，本地模型", aliases: ["4", "ollama", "本地模型"] },
  { id: "local", label: "本地规则", aliases: ["5", "local", "本地", "规则"] },
]

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
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1).trim()
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

export function parseChoice(answer: string, choices: { id: string; aliases: string[] }[], fallback: string): string {
  const normalized = answer.trim().toLowerCase()
  if (!normalized) return fallback
  return choices.find((choice) => choice.aliases.includes(normalized) || choice.id === normalized)?.id || fallback
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
  const selectionReady = Boolean(saved[DECISION_KEY] && saved[ANALYSIS_KEY])
  if (!options.force && (!interactive || (saved[CONFIGURED_FLAG] === "1" && selectionReady))) {
    return { path: configPath, prompted: false }
  }

  const ask = options.ask || askOnTerminal
  const next: Record<string, string> = { ...saved, [CONFIGURED_FLAG]: "1" }
  console.log("请选择要使用的模型。直接回车表示使用推荐项或保留已有值。")
  console.log("配置只保存在本机: " + configPath)

  const decisionFallback = saved[DECISION_KEY] || "jev"
  next[DECISION_KEY] = await askChoice(ask, "单步决策模型", DECISION_CHOICES, decisionFallback)
  if (next[DECISION_KEY] === "jev") {
    next.TYPESAFE_API_KEY = await askSecret(ask, "Jev / TypeSafe API Key", saved.TYPESAFE_API_KEY || "")
    next.TYPESAFE_MODEL = await askText(ask, "Jev 模型名", saved.TYPESAFE_MODEL || "", "jev-latest")
    if (!next.TYPESAFE_API_KEY) {
      console.log("没有 Jev Key，决策模型改为本地规则。")
      next[DECISION_KEY] = "local"
    }
  }

  const analysisFallback = saved[ANALYSIS_KEY] || "gemini"
  next[ANALYSIS_KEY] = await askChoice(ask, "规划与诊断模型", ANALYSIS_CHOICES, analysisFallback)
  if (next[ANALYSIS_KEY] === "gemini") {
    next.GEMINI_API_KEY = await askSecret(ask, "Gemini API Key", saved.GEMINI_API_KEY || "")
    next.GEMINI_MODEL = await askText(ask, "Gemini 模型名", saved.GEMINI_MODEL || "", DEFAULT_GEMINI_MODEL)
    if (!next.GEMINI_API_KEY) {
      console.log("没有 Gemini Key，规划与诊断改为本地规则。")
      next[ANALYSIS_KEY] = "local"
    }
  } else if (next[ANALYSIS_KEY] === "openai") {
    next.OPENAI_API_KEY = await askSecret(ask, "OpenAI API Key", saved.OPENAI_API_KEY || "")
    next.OPENAI_MODEL = await askText(ask, "OpenAI 模型名", saved.OPENAI_MODEL || "", "gpt-4o-mini")
    next.OPENAI_BASE_URL = await askText(ask, "OpenAI 兼容接口地址", saved.OPENAI_BASE_URL || "", "留空使用官方地址")
    if (next.OPENAI_BASE_URL === "留空使用官方地址") delete next.OPENAI_BASE_URL
    if (!next.OPENAI_API_KEY) {
      console.log("没有 OpenAI Key，规划与诊断改为本地规则。")
      next[ANALYSIS_KEY] = "local"
    }
  } else if (next[ANALYSIS_KEY] === "deepseek") {
    next.DEEPSEEK_API_KEY = await askSecret(ask, "DeepSeek API Key", saved.DEEPSEEK_API_KEY || "")
    next.DEEPSEEK_MODEL = await askText(ask, "DeepSeek 模型名", saved.DEEPSEEK_MODEL || "", "deepseek-chat")
    next.DEEPSEEK_BASE_URL = saved.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1"
    if (!next.DEEPSEEK_API_KEY) {
      console.log("没有 DeepSeek Key，规划与诊断改为本地规则。")
      next[ANALYSIS_KEY] = "local"
    }
  } else if (next[ANALYSIS_KEY] === "ollama") {
    next.OLLAMA_BASE_URL = await askText(ask, "Ollama 接口地址", saved.OLLAMA_BASE_URL || "", DEFAULT_OLLAMA_BASE_URL)
    next.OLLAMA_MODEL = await askText(ask, "Ollama 模型名", saved.OLLAMA_MODEL || "", DEFAULT_OLLAMA_MODEL)
    console.log("请先在本机执行 ollama pull " + next.OLLAMA_MODEL + "。Ollama 不需要云端 key。")
  }

  next[REPORT_LANG_KEY] = await askReportLanguage(ask, saved[REPORT_LANG_KEY] || "")
  next.AUTO_MAX_STEPS = await askMaxSteps(ask, saved.AUTO_MAX_STEPS || "")

  writeConfig(configPath, next)
  applyMissingEnv(next)
  return { path: configPath, prompted: true }
}

async function askChoice(
  ask: (label: string, secret: boolean) => Promise<string>,
  title: string,
  choices: { id: string; label: string; aliases: string[] }[],
  fallback: string,
): Promise<string> {
  console.log(title + ":")
  choices.forEach((choice, index) => {
    const current = choice.id === fallback ? "，当前/推荐" : ""
    console.log("  " + (index + 1) + ". " + choice.label + current)
  })
  const answer = await ask("请输入序号: ", false)
  const selected = parseChoice(answer, choices, fallback)
  if (answer.trim() && selected === fallback && !choices.some((choice) => choice.aliases.includes(answer.trim().toLowerCase()))) {
    console.log("没有识别这个选项，使用 " + fallback + "。")
  }
  return selected
}

async function askSecret(
  ask: (label: string, secret: boolean) => Promise<string>,
  label: string,
  current: string,
): Promise<string> {
  const hint = current ? "，回车保留已保存的值" : "，可回车跳过"
  const answer = (await ask(label + hint + ": ", true)).trim()
  return answer || current
}

async function askText(
  ask: (label: string, secret: boolean) => Promise<string>,
  label: string,
  current: string,
  fallback: string,
): Promise<string> {
  const shown = current || fallback
  const answer = (await ask(label + "（回车使用 " + shown + "）: ", false)).trim()
  return (answer || current || fallback).trim()
}

const REPORT_LANG_CHOICES = [
  { id: "zh-CN", label: "简体中文", aliases: ["1", "zh-cn", "zh", "cn", "简体", "简体中文"] },
  { id: "zh-TW", label: "繁体中文", aliases: ["2", "zh-tw", "tw", "繁体", "繁体中文", "繁體中文"] },
  { id: "en", label: "English", aliases: ["3", "en", "english", "英文"] },
]

async function askReportLanguage(
  ask: (label: string, secret: boolean) => Promise<string>,
  current: string,
): Promise<string> {
  const fallback = resolveReportLanguage(current).code || DEFAULT_REPORT_LANG
  const shown = resolveReportLanguage(fallback).label
  console.log("报告语言:")
  REPORT_LANG_CHOICES.forEach((choice, index) => {
    const mark = choice.id === fallback ? "，当前/推荐" : ""
    console.log("  " + (index + 1) + ". " + choice.label + mark)
  })
  console.log("  也可以直接输入其他语言名称。")
  const answer = (await ask("请输入序号或语言名称（回车使用 " + shown + "）: ", false)).trim()
  if (!answer) return fallback
  const known = REPORT_LANG_CHOICES.find((choice) => choice.aliases.includes(answer.toLowerCase()) || choice.id.toLowerCase() === answer.toLowerCase())
  return known ? known.id : answer
}

export function normalizeMaxSteps(value: string | undefined, fallback = "12"): string {
  const parsed = Number((value || "").trim())
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) return fallback
  return String(parsed)
}

async function askMaxSteps(
  ask: (label: string, secret: boolean) => Promise<string>,
  current: string,
): Promise<string> {
  const fallback = normalizeMaxSteps(current)
  const answer = (await ask("单次最多执行步数（回车使用 " + fallback + "）: ", false)).trim()
  return normalizeMaxSteps(answer, fallback)
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
