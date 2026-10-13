#!/usr/bin/env node

/**
 * AutoTestLoop 自然语言测试入口。
 * 用法:
 *   npx --yes github:zhucl1006/auto-test-loop --goal "用邮箱 qa@example.com、密码 secret 登录" --url "https://example.com/login"
 */

import dotenv from "dotenv"
import { chromium } from "playwright"
import { askHidden, askVisible, ensureUserEnv } from "./config/user-env.js"
import { extractGoalContext, goalNeedsCredentials, redactSecrets } from "./core/goal-context.js"
import { runAiUiTest } from "./core/runner.js"
import { jevDecisionName } from "./llm/jev-decider.js"
import { createAutoLLMProvider } from "./llm/provider.js"
import { ensureChromium } from "./runtime/browser.js"
import { TestGoal } from "./types/index.js"

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function printHelp(): void {
  console.log(`AutoTestLoop

用法:
  npx --yes github:zhucl1006/auto-test-loop --goal "用邮箱 qa@example.com、密码 secret 登录" --url "https://example.com/login"

参数:
  --goal           自然语言目标。账密写在这句话里，只用于本次运行，不会保存。
  --url            起始地址
  --headed         显示浏览器
  --report-dir     报告目录
  --screenshot-dir 截图目录
  --configure      重新输入并保存模型密钥
  --no-prompt      不询问，适合 CI
  --help           显示帮助
`)
}

async function fillRunCredentials(goalText: string, interactive: boolean): Promise<Record<string, string>> {
  const fromGoal = extractGoalContext(goalText)
  const needed = goalNeedsCredentials(goalText) || Object.keys(fromGoal).length > 0
  const context: Record<string, string> = {}
  if (!needed) return context
  if (process.env.TEST_EMAIL) context.email = process.env.TEST_EMAIL
  if (process.env.TEST_USERNAME) context.username = process.env.TEST_USERNAME
  if (process.env.TEST_PASSWORD) context.password = process.env.TEST_PASSWORD
  if (process.env.TEST_PHONE) context.phone = process.env.TEST_PHONE
  if (process.env.TEST_OTP) context.otp = process.env.TEST_OTP
  Object.assign(context, fromGoal)

  if (interactive && !context.password && !context.otp) {
    console.log("目标需要登录信息，但没有识别到密码或验证码。本次输入不会保存。")
    const account = await askVisible("邮箱或账号（可回车跳过）: ")
    const secret = await askHidden("密码或验证码（可回车跳过）: ")
    if (account.includes("@")) context.email = account
    else if (account) context.username = account
    if (/验证码|otp|手机|手機/.test(goalText) && secret) context.otp = secret
    else if (secret) context.password = secret
  }
  return context
}

function describeContext(context: Record<string, string>): string {
  const parts = []
  if (context.email) parts.push("邮箱 " + context.email)
  else if (context.username) parts.push("账号 " + context.username)
  if (context.phone) parts.push("手机号 " + context.phone)
  if (context.password || context.otp) parts.push("密码或验证码已隐藏")
  return parts.join("，")
}

async function main() {
  dotenv.config()
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    return
  }

  const interactive = !args.includes("--no-prompt") && Boolean(process.stdin.isTTY && process.stdout.isTTY)
  await ensureUserEnv({
    force: args.includes("--configure"),
    interactive,
  })

  const goalText = readArg(args, "--goal") || "打开页面，确认主要内容和关键操作入口可见"
  const url = readArg(args, "--url") || process.env.WEB_URL
  if (!url) throw new Error("缺少 --url 或 WEB_URL")
  const reportDir = readArg(args, "--report-dir") || "test/reports/auto"
  const screenshotDir = readArg(args, "--screenshot-dir") || "test/screenshots/auto"
  const headless = !args.includes("--headed")
  const context = await fillRunCredentials(goalText, interactive)
  const secrets = [
    context.password,
    context.otp,
    process.env.TYPESAFE_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.DEEPSEEK_API_KEY,
  ]
  const llmProvider = createAutoLLMProvider()

  console.log("AutoTestLoop")
  console.log("目标: " + redactSecrets(goalText, secrets))
  console.log("页面: " + url)
  const contextSummary = describeContext(context)
  if (contextSummary) console.log("登录信息: " + contextSummary)
  console.log("决策模型: " + jevDecisionName())
  console.log("分析模型: " + (llmProvider ? llmProvider.name : "本地启发式分析"))

  ensureChromium()
  const goal: TestGoal = {
    id: "auto_" + Date.now(),
    name: "自然语言自主测试",
    description: goalText,
    targetUrl: url,
    initialContext: context,
    maxSteps: Number(process.env.AUTO_MAX_STEPS || "12"),
  }
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    const report = await runAiUiTest(goal, page, {
      llmProvider,
      autonomous: true,
      screenshotDir,
      reportDir,
    })
    console.log("结果: " + report.overallStatus + " (" + report.durationMs + "ms)")
    console.log("报告: " + reportDir + "/report-" + goal.id + ".html")
    process.exitCode = report.overallStatus === "FAIL" ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
