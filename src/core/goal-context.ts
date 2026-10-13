/**
 * 从自然语言目标中提取本次运行需要的登录信息。
 * 这些值只进入当次上下文，不写入本机配置。
 */

export interface GoalContext {
  email?: string
  username?: string
  password?: string
  phone?: string
  otp?: string
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

export function goalNeedsCredentials(text: string): boolean {
  return /登录|登入|sign[\s-]?in|\blogin\b|账号|帳號|用户名|用戶名|密码|密碼|password|验证码|驗證碼|\botp\b/i.test(text)
}

export function extractGoalContext(text: string): GoalContext {
  const context: GoalContext = {}
  const email = text.match(EMAIL)?.[0]
  if (email) context.email = email

  const password = labeledValue(text, ["密码", "密碼", "password", "pwd"])
  if (password) context.password = password

  const phone = labeledValue(text, ["手机号", "手機號", "手机号码", "手機號碼", "手机", "手機", "电话", "電話", "phone", "mobile"])
  if (phone) context.phone = phone.replace(/[\s-]/g, "")

  const otp = labeledValue(text, ["验证码", "驗證碼", "otp"])
  if (otp) context.otp = otp

  const username = labeledValue(text, ["账号", "帳號", "用户名", "用戶名", "username", "user"])
  if (username && !username.includes("@")) context.username = username

  return context
}

export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  const values = secrets.filter((secret): secret is string => Boolean(secret && secret.length >= 3))
  return values
    .sort((left, right) => right.length - left.length)
    .reduce((output, secret) => output.split(secret).join("******"), text)
}

function labeledValue(text: string, labels: string[]): string | undefined {
  const label = labels.map(escapeRegExp).join("|")
  const pattern = new RegExp(
    `(?:${label})\\s*(?:是|为|為|:|：|=)?\\s*(?:"([^"]+)"|'([^']+)'|([^\\s"'，,。；;、]+))`,
    "i",
  )
  const match = text.match(pattern)
  return match?.[1] || match?.[2] || match?.[3]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
