import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { CONFIGURED_FLAG, ensureUserEnv, MODEL_PROMPTS } from "../src/config/user-env.js"

const keys = [CONFIGURED_FLAG, ...MODEL_PROMPTS.map((item) => item.key)]
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

describe("user env", () => {
  it("首次输入后保存，第二次不再询问", async () => {
    for (const key of keys) delete process.env[key]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autotestloop-"))
    const configPath = path.join(dir, "env")
    const answers = ["jev-key", "", "", "", ""]
    const first = await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => answers.shift() || "",
    })
    expect(first.prompted).toBe(true)
    expect(process.env.TYPESAFE_API_KEY).toBe("jev-key")
    expect(fs.readFileSync(configPath, "utf8")).toContain("TYPESAFE_API_KEY=jev-key")
    expect(fs.readFileSync(configPath, "utf8")).not.toContain("password")
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600)

    delete process.env.TYPESAFE_API_KEY
    let asked = false
    const second = await ensureUserEnv({
      interactive: true,
      configPath,
      ask: async () => {
        asked = true
        return "should-not-ask"
      },
    })
    expect(second.prompted).toBe(false)
    expect(asked).toBe(false)
    expect(process.env.TYPESAFE_API_KEY).toBe("jev-key")
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
