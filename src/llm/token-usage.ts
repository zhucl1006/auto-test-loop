export interface TokenCall {
  source: string;
  model?: string;
  input?: number;
  output?: number;
  total?: number;
  reported: boolean;
}

export interface TokenSourceSummary {
  source: string;
  calls: number;
  input: number;
  output: number;
  total: number;
  unreported: number;
}

export interface TokenSummary {
  input: number;
  output: number;
  total: number;
  calls: number;
  unreported: number;
  bySource: TokenSourceSummary[];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = numberOrUndefined(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function parseTokenUsage(payload: unknown): Pick<TokenCall, "input" | "output" | "total"> | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, any>;
  const gemini = body.usageMetadata;
  if (gemini && typeof gemini === "object") {
    const input = firstNumber(gemini.promptTokenCount, gemini.prompt_token_count);
    const output = firstNumber(gemini.candidatesTokenCount, gemini.candidates_token_count);
    const total = firstNumber(gemini.totalTokenCount, gemini.total_token_count) ?? sum(input, output);
    if (input === undefined && output === undefined && total === undefined) return null;
    return { input, output, total };
  }
  const usage = body.usage || body.meta?.usage || body.billing;
  if (!usage || typeof usage !== "object") return null;
  const input = firstNumber(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount);
  const output = firstNumber(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount);
  const total = firstNumber(usage.total_tokens, usage.totalTokenCount, usage.total) ?? sum(input, output);
  if (input === undefined && output === undefined && total === undefined) return null;
  return { input, output, total };
}

function sum(input?: number, output?: number): number | undefined {
  if (input === undefined && output === undefined) return undefined;
  return (input || 0) + (output || 0);
}

export function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "未知" : value.toLocaleString("zh-CN");
}

export function formatTokenCall(call: TokenCall, summary: TokenSummary): string {
  const who = call.model ? call.source + " (" + call.model + ")" : call.source;
  if (!call.reported) {
    return "[Token] " + who + " 本次未返回 token 用量 · 累计合计 " + formatTokenCount(summary.total);
  }
  return "[Token] " + who + " 本次 输入 " + formatTokenCount(call.input) + " · 输出 " + formatTokenCount(call.output) + " · 合计 " + formatTokenCount(call.total) + " · 累计合计 " + formatTokenCount(summary.total);
}

export function formatTokenSummary(summary: TokenSummary): string {
  if (!summary.calls) return "[Token] 本次没有调用 Jev 或 LLM";
  const parts = summary.bySource.map((item) => item.source + " " + item.calls + " 次");
  const missing = summary.unreported ? " · 未返回用量 " + summary.unreported + " 次" : "";
  return "[Token] 本次消耗 合计 " + formatTokenCount(summary.total) + "（输入 " + formatTokenCount(summary.input) + " · 输出 " + formatTokenCount(summary.output) + "）· " + parts.join(" · ") + missing;
}

let logger: (line: string) => void = (line) => console.log(line);
const calls: TokenCall[] = [];

export function setTokenLogger(next: (line: string) => void): void {
  logger = next;
}

export function resetTokenUsage(): void {
  calls.length = 0;
}

export function recordTokenUsage(call: Omit<TokenCall, "reported" | "total"> & { total?: number; reported?: boolean }): TokenSummary {
  const reported = call.reported ?? (call.input !== undefined || call.output !== undefined || call.total !== undefined);
  const total = call.total ?? sum(call.input, call.output);
  calls.push({ ...call, total, reported });
  const summary = snapshotTokenUsage();
  logger(formatTokenCall(calls[calls.length - 1], summary));
  return summary;
}

export function snapshotTokenUsage(): TokenSummary {
  const bySource = new Map<string, TokenSourceSummary>();
  for (const call of calls) {
    const current = bySource.get(call.source) || { source: call.source, calls: 0, input: 0, output: 0, total: 0, unreported: 0 };
    current.calls += 1;
    current.input += call.input || 0;
    current.output += call.output || 0;
    current.total += call.total || 0;
    if (!call.reported) current.unreported += 1;
    bySource.set(call.source, current);
  }
  const items = [...bySource.values()];
  return {
    input: items.reduce((sum, item) => sum + item.input, 0),
    output: items.reduce((sum, item) => sum + item.output, 0),
    total: items.reduce((sum, item) => sum + item.total, 0),
    calls: calls.length,
    unreported: calls.filter((call) => !call.reported).length,
    bySource: items,
  };
}

export function recordTokenPayload(source: string, model: string | undefined, payload: unknown): void {
  const parsed = parseTokenUsage(payload);
  recordTokenUsage({
    source,
    model,
    input: parsed?.input,
    output: parsed?.output,
    total: parsed?.total,
    reported: Boolean(parsed),
  });
}
