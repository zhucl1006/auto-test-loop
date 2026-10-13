import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { createRequire } from "module"
import { chromium } from "playwright"

export function ensureChromium(): void {
  if (fs.existsSync(chromium.executablePath())) return
  console.log("首次运行，正在安装 Chromium。这一步只需要做一次。")
  const require = createRequire(import.meta.url)
  const pkg = require.resolve("playwright/package.json")
  const cli = path.join(path.dirname(pkg), "cli.js")
  const result = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error("Chromium 安装失败。请稍后重试，或手动执行 npx playwright install chromium")
  }
}
