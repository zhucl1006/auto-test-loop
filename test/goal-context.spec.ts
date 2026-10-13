import { describe, expect, it } from "vitest"
import { extractGoalContext, goalNeedsCredentials, redactSecrets } from "../src/core/goal-context.js"

describe("goal context", () => {
  it("从中文目标提取邮箱和密码", () => {
    const context = extractGoalContext("用邮箱 qa@example.com、密码 secret123 登录，并确认进入控制台")
    expect(context.email).toBe("qa@example.com")
    expect(context.password).toBe("secret123")
    expect(goalNeedsCredentials("用邮箱 qa@example.com、密码 secret123 登录")).toBe(true)
  })

  it("从英文目标提取账号和带空格的密码", () => {
    const context = extractGoalContext('login with username admin and password "secret 123"')
    expect(context.username).toBe("admin")
    expect(context.password).toBe("secret 123")
  })

  it("提取手机号和验证码，且不把邮箱当成用户名", () => {
    const context = extractGoalContext("账号 qa@example.com，手机号 138-0013-8000，验证码 654321 登录")
    expect(context.email).toBe("qa@example.com")
    expect(context.username).toBeUndefined()
    expect(context.phone).toBe("13800138000")
    expect(context.otp).toBe("654321")
  })

  it("普通浏览目标不要求账密", () => {
    expect(goalNeedsCredentials("打开定价页，确认有免费方案")).toBe(false)
    expect(extractGoalContext("打开定价页，确认有免费方案")).toEqual({})
  })

  it("日志会隐藏本次密码", () => {
    expect(redactSecrets("密码 secret123", ["secret123"])).toBe("密码 ******")
  })
})
