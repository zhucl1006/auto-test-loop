import { resolveReportLanguage } from "./report-language.js"

export type DecisionChoice = "jev" | "local"
export type AnalysisChoice = "gemini" | "openai" | "deepseek" | "local"

export const DECISION_KEY = "AUTOTESTLOOP_DECISION"
export const ANALYSIS_KEY = "AUTOTESTLOOP_ANALYSIS"
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"

export function resolveDecision(): DecisionChoice {
  const choice = (process.env.AUTOTESTLOOP_DECISION || "").toLowerCase()
  if (choice === "local" || choice === "none") return "local"
  if (choice === "jev" || process.env.TYPESAFE_API_KEY) {
    return process.env.TYPESAFE_API_KEY ? "jev" : "local"
  }
  return "local"
}

export function resolveAnalysis(): AnalysisChoice {
  const choice = (process.env.AUTOTESTLOOP_ANALYSIS || "").toLowerCase()
  if (choice === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : "local"
  if (choice === "openai") return process.env.OPENAI_API_KEY ? "openai" : "local"
  if (choice === "deepseek") return process.env.DEEPSEEK_API_KEY ? "deepseek" : "local"
  if (choice === "local" || choice === "none") return "local"
  if (process.env.GEMINI_API_KEY) return "gemini"
  if (process.env.OPENAI_API_KEY) return "openai"
  if (process.env.DEEPSEEK_API_KEY) return "deepseek"
  return "local"
}

export function describeSelection(): string {
  const decision = resolveDecision()
  const analysis = resolveAnalysis()
  const decisionText = decision === "jev"
    ? "Jev (" + (process.env.TYPESAFE_MODEL || "jev-latest") + ")"
    : "本地规则"
  const analysisText = analysis === "gemini"
    ? "Gemini (" + (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) + ")"
    : analysis === "openai"
      ? "OpenAI (" + (process.env.OPENAI_MODEL || "gpt-4o-mini") + ")"
      : analysis === "deepseek"
        ? "DeepSeek (" + (process.env.DEEPSEEK_MODEL || "deepseek-chat") + ")"
        : "本地规则"
  return "决策模型: " + decisionText + "\n规划与诊断: " + analysisText + "\n报告语言: " + resolveReportLanguage().label
}
