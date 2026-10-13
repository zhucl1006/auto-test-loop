import fs from "fs"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { HtmlReporter } from "../src/reporters/html-reporter.js"
import { AiUiTestReport } from "../src/types/index.js"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

describe("HtmlReporter screenshots", () => {
  it("点击截图时在页面内放大，而不是打开会被浏览器拦截的 data 链接", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atl-report-"))
    const shot = path.join(dir, "step.png")
    fs.writeFileSync(shot, png)
    const report: AiUiTestReport = {
      goal: { id: "shot", name: "截图", description: "查看截图", targetUrl: "https://example.test" },
      plan: { goalId: "shot", summary: "s", steps: [], assertions: [] },
      overallStatus: "PASS",
      stepResults: [
        {
          stepIndex: 1,
          action: { action: "click", reasoning: "点击", confidence: 1 },
          status: "SUCCESS",
          durationMs: 1,
          urlBefore: "https://example.test",
          urlAfter: "https://example.test/app",
          screenshotPath: shot,
        },
      ],
      assertionResults: [],
      startTime: "2026-10-13T00:00:00.000Z",
      endTime: "2026-10-13T00:00:01.000Z",
      durationMs: 1,
      screenshots: [shot],
    }
    const htmlPath = HtmlReporter.generate(report, dir)
    const html = fs.readFileSync(htmlPath, "utf8")
    expect(html).toContain('class="shot-open"')
    expect(html).toContain('id="shot-lightbox"')
    expect(html).toContain("点击图片放大查看")
    expect(html).not.toContain('href="data:image')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
