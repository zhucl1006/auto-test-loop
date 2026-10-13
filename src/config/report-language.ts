export const REPORT_LANG_KEY = "AUTOTESTLOOP_REPORT_LANG"
export const DEFAULT_REPORT_LANG = "zh-CN"

export interface ReportLanguage {
  code: string
  /** 启动日志和报告页眉使用的名称。 */
  label: string
  /** 交给模型的语言名称，避免简体界面把繁体要求写丢。 */
  prose: string
}

const PRESETS: Array<ReportLanguage & { aliases: string[] }> = [
  {
    code: "zh-CN",
    label: "简体中文",
    prose: "Simplified Chinese (简体中文)",
    aliases: ["zh-cn", "zh", "cn", "zh-hans", "简体", "简体中文", "簡體中文"],
  },
  {
    code: "zh-TW",
    label: "繁体中文",
    prose: "Traditional Chinese (繁體中文)",
    aliases: ["zh-tw", "zh-hant", "tw", "繁体", "繁體", "繁体中文", "繁體中文"],
  },
  {
    code: "en",
    label: "English",
    prose: "English",
    aliases: ["en", "en-us", "english", "英文"],
  },
]

export function resolveReportLanguage(raw = process.env[REPORT_LANG_KEY]): ReportLanguage {
  const value = (raw || "").trim()
  if (!value) return { code: DEFAULT_REPORT_LANG, label: "简体中文", prose: "Simplified Chinese (简体中文)" }
  const folded = value.toLowerCase()
  const preset = PRESETS.find((item) => item.code.toLowerCase() === folded || item.aliases.includes(folded) || item.aliases.includes(value))
  if (preset) return { code: preset.code, label: preset.label, prose: preset.prose }
  return { code: value, label: value, prose: value }
}

export function reportLanguageInstruction(language = resolveReportLanguage()): string {
  return [
    "Report language: write every human-readable string in " + language.prose + ".",
    "This includes summary, description, rootCause, suggestedFix, and reasoning.",
    "Keep JSON property names and enumerated values such as intent, type, and category in English.",
    "semanticTarget must stay in the page's visible language and must not be translated into the report language.",
  ].join(" ")
}

export function withReportLanguage(prompt: string, language = resolveReportLanguage()): string {
  return prompt + "\n\n" + reportLanguageInstruction(language)
}
