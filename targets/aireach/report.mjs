import fs from "fs";
import path from "path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function statusColor(status) {
  if (status === "PASS" || status === "HEALED") return "#059669";
  if (status === "SKIPPED" || status === "WARN") return "#d97706";
  return "#dc2626";
}

export function badge(status) {
  return (
    '<span style="display:inline-block;padding:2px 8px;border-radius:999px;color:#fff;font-weight:600;background:' +
    statusColor(status) +
    '">' +
    escapeHtml(status) +
    "</span>"
  );
}

export function writeTableReport(options) {
  const file = options.file;
  const title = options.title;
  const subtitle = options.subtitle || "";
  const headers = options.headers || [];
  const rows = options.rows || [];
  const extra = options.extra || "";
  ensureDir(path.dirname(file));
  const head = headers.map((item) => "<th>" + escapeHtml(item) + "</th>").join("");
  const body = rows
    .map((row) => "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>")
    .join("");
  const html = [
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>",
    escapeHtml(title),
    "</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}main{max-width:1180px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#475569}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:top}th{background:#f8fafc}a{color:#1d4ed8}code{font-family:ui-monospace,monospace;font-size:12px}</style></head><body><main><h1>",
    escapeHtml(title),
    "</h1><p>",
    subtitle,
    "</p>",
    extra,
    "<table><thead><tr>",
    head,
    "</tr></thead><tbody>",
    body,
    "</tbody></table></main></body></html>",
  ].join("");
  fs.writeFileSync(file, html);
  return file;
}
