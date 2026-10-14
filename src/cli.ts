#!/usr/bin/env node

/**
 * AutoTestLoop 自然语言测试入口。
 * 用法:
 *   npx --yes github:zhucl1006/auto-test-loop --goal "用邮箱 qa@example.com、密码 secret 登录" --url "https://example.com/login"
 */

import fs from "fs"
import dotenv from "dotenv"
import { chromium } from "playwright"
import { describeSelection } from "./config/selection.js"
import { askHidden, askVisible, ensureUserEnv, normalizeMaxSteps, parseEnvFile } from "./config/user-env.js"
import { extractGoalContext, goalNeedsCredentials, redactSecrets } from "./core/goal-context.js"
import { runAiUiTest } from "./core/runner.js"
import { createAutoLLMProvider } from "./llm/provider.js"
import { ensureChromium } from "./runtime/browser.js"
import { goalFromPlan, loadPlanFile } from "./runtime/plan-file.js"

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function readCommand(args: string[]): string | undefined {
  const valued = new Set(["--goal", "--url", "--report-dir", "--screenshot-dir", "--plan", "--mode", "--report-lang", "--max-steps"])
  for (let index = 0; index < args.length; index += 1) {
    if (valued.has(args[index])) {
      index += 1
      continue
    }
    if (!args[index].startsWith("-")) return args[index]
  }
  return undefined
}

function printHelp(): void {
  console.log(`AutoTestLoop

用一句话检查网页，或按写好的计划回归。账密只写在本次目标里，不会保存。

用法:
  npx --yes github:zhucl1006/auto-test-loop help
  npx --yes github:zhucl1006/auto-test-loop config
  npx --yes github:zhucl1006/auto-test-loop --goal "用邮箱 qa@example.com、密码 secret 登录，并确认进入控制台" --url "https://example.com/login"

命令:
  help             显示这份使用说明
  config           选择模型并保存对应的 key，之后可重复调整

参数:
  --goal           自然语言目标。账密写在这句话里，只用于本次运行。
  --url            起始地址。省略时读取 WEB_URL。
  --mode auto      自动模式，默认。由模型或规则建立计划。
  --mode plan      计划模式，必须配合 --plan。
  --plan <file>    计划 JSON。有 plannedSteps 时不会改写步骤。
  --headed         显示浏览器
  --report-dir     报告目录，默认 test/reports/auto
  --screenshot-dir 截图目录，默认 test/screenshots/auto
  --report-lang    本次报告语言，默认简体中文。例如 zh-CN、zh-TW、en
  --max-steps      本次步数上限，覆盖 config 和项目 .env
  --configure      先调整配置，再执行本次目标
  --no-prompt      不询问，适合 CI
  --help, -h       显示这份使用说明

目标写法:
  确认页面:     打开定价页，确认有免费方案和购买按钮
  点遍导航:     登录后，每个可见导航都要点进一次。还有未点的导航时禁止结束。
  自己发现并建立: 自己列出新建、导入、录入按钮，填写必填项后点保存。禁止取消和 Escape。
  路径必须固定: 改用 --mode plan --plan 计划.json

模型:
  单步决策用 Jev 或本地规则。规划与诊断可用 Gemini、OpenAI、DeepSeek、Ollama 或本地规则。
  Ollama 默认连接 http://127.0.0.1:11434/v1，模型名默认 qwen2.5，需先 ollama pull。
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
  const command = readCommand(args)
  if (command === "help" || args.includes("--help") || args.includes("-h")) {
    printHelp()
    return
  }
  const configuring = command === "config" || command === "configure" || args.includes("--configure")
  const interactive = !args.includes("--no-prompt") && Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (configuring && !interactive) throw new Error("config 需要在交互终端中运行")
  const envState = await ensureUserEnv({
    force: configuring,
    interactive,
  })
  const reportLang = readArg(args, "--report-lang")
  if (reportLang) process.env.AUTOTESTLOOP_REPORT_LANG = reportLang.trim()
  const saved = fs.existsSync(envState.path) ? parseEnvFile(fs.readFileSync(envState.path, "utf8")) : {}
  const cliMaxSteps = readArg(args, "--max-steps")
  if (cliMaxSteps) process.env.AUTO_MAX_STEPS = normalizeMaxSteps(cliMaxSteps)
  else if (saved.AUTO_MAX_STEPS) process.env.AUTO_MAX_STEPS = normalizeMaxSteps(saved.AUTO_MAX_STEPS)
  if (command === "config" || command === "configure") {
    console.log("配置已保存")
    console.log(describeSelection())
    console.log("步数上限: " + (process.env.AUTO_MAX_STEPS || "12"))
    return
  }

  const mode = readArg(args, "--mode")
  const planPath = readArg(args, "--plan")
  if (mode && mode !== "auto" && mode !== "plan") throw new Error("--mode 只能是 auto 或 plan")
  const planMode = mode === "plan" || Boolean(planPath)
  if (planMode && !planPath) throw new Error("计划模式需要 --plan 计划文件")
  const goalText = readArg(args, "--goal") || "打开页面，确认主要内容和关键操作入口可见"
  const url = readArg(args, "--url") || process.env.WEB_URL
  if (!planMode && !url) throw new Error("缺少 --url 或 WEB_URL")
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

  const loadedPlan = planMode ? loadPlanFile(planPath!) : undefined
  const goal = loadedPlan
    ? goalFromPlan(loadedPlan, { url, description: goalText, context })
    : {
        id: "auto_" + Date.now(),
        name: "自然语言自主测试",
        description: goalText,
        targetUrl: url!,
        initialContext: context,
        maxSteps: Number(normalizeMaxSteps(process.env.AUTO_MAX_STEPS)),
      }

  console.log("AutoTestLoop")
  console.log("模式: " + (planMode ? "计划模式" : "自动模式"))
  console.log("目标: " + redactSecrets(goal.description, secrets))
  console.log("页面: " + goal.targetUrl)
  const contextSummary = describeContext(context)
  if (contextSummary) console.log("登录信息: " + contextSummary)
  console.log(describeSelection())

  ensureChromium()
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    const report = await runAiUiTest(goal, page, {
      llmProvider,
      autonomous: !planMode,
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
