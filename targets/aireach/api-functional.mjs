#!/usr/bin/env node

/**
 * AiReach BFF 只读功能回归。
 *
 * 默认不创建、不发送、不删除。
 * REGRESSION_MUTATE=1 时额外创建并删除一条 qa-reg-* 标签。
 *
 * 用法: pnpm run aireach:api
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { badge, escapeHtml, writeJson, writeTableReport } from "./report.mjs";

dotenv.config();

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BFF_URL = (process.env.BFF_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const REPORT_DIR = path.join(ROOT_DIR, "test/reports/api");
const PHONE = process.env.TEST_PHONE || "";
const OTP = process.env.TEST_OTP || "";
const AUTH_ENV = process.env.TEST_AUTH_ENV || "";

function caseResult(item, status, actual, note) {
  return {
    id: item.id,
    name: item.name,
    module: item.module,
    method: item.method,
    path: item.path,
    status,
    actual,
    note: note || "",
  };
}

async function request(method, urlPath, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const started = Date.now();
  const res = await fetch(BFF_URL + urlPath, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json, durationMs: Date.now() - started };
}

async function login() {
  if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
    const logged = await request("POST", "/api/auth/login", {
      body: {
        email: process.env.TEST_EMAIL,
        password: process.env.TEST_PASSWORD,
        ...(process.env.TEST_TENANT_ID ? { tenantId: process.env.TEST_TENANT_ID } : {}),
      },
    });
    const token = logged.json?.tokens?.accessToken || logged.json?.token;
    const user = logged.json?.user || {};
    const tenantId = user.tenantId;
    if (logged.status >= 400 || !token || !tenantId) {
      throw new Error("邮箱登录失败: " + logged.status + " " + logged.text.slice(0, 240));
    }
    return sessionFromLogin(token, user);
  }
  if (!PHONE || !OTP || !AUTH_ENV) {
    throw new Error("OTP 登录需要 TEST_PHONE、TEST_OTP 和 TEST_AUTH_ENV。请写入本地 .env，不要提交。");
  }
  const sent = await request("POST", "/api/auth/otp/send", {
    body: { mobile: PHONE, purpose: "Login", env: AUTH_ENV },
  });
  const onceToken = sent.json?.onceToken || sent.json?.data?.onceToken;
  if (!sent.status || sent.status >= 400 || !onceToken) {
    throw new Error("OTP 发送失败: " + sent.status + " " + sent.text.slice(0, 240));
  }
  const logged = await request("POST", "/api/auth/otp/login", {
    body: { onceToken, otp: OTP, env: AUTH_ENV },
  });
  const token = logged.json?.token || logged.json?.tokens?.accessToken;
  const user = logged.json?.user || {};
  const tenantId = user.tenantId;
  if (logged.status >= 400 || !token || !tenantId) {
    throw new Error("OTP 登录失败: " + logged.status + " " + logged.text.slice(0, 240));
  }
  return sessionFromLogin(token, user);
}

function sessionFromLogin(token, user) {
  const tenantId = user.tenantId;
  const headers = {
    jwtToken: token,
    Authorization: "Bearer " + token,
    "X-Tenant-Id": tenantId,
    "x-selected-tenant-id": tenantId,
    "X-User-Id": user.userId || "",
  };
  if (user.openId) headers["X-Open-Id"] = user.openId;
  if (user.employeeId) headers["X-Employee-Id"] = user.employeeId;
  return {
    token,
    tenantId,
    user,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    headers,
  };
}

function readCases() {
  return [
    { id: "API-HEALTH", name: "BFF 健康检查", module: "health", method: "GET", path: "/api/health", auth: false, expect: [200], includes: "aireach-bff" },
    { id: "API-AUTH-ME-ANON", name: "未登录读取会话", module: "auth", method: "GET", path: "/api/auth/me", auth: false, expect: [401, 403] },
    { id: "API-AUTH-ME", name: "当前登录用户", module: "auth", method: "GET", path: "/api/auth/me", auth: true, expect: [200], jsonKey: "user" },
    { id: "API-HOME", name: "首页摘要", module: "home", method: "GET", path: "/api/home/summary", auth: true, expect: [200] },
    { id: "API-CONTACTS", name: "联络人列表", module: "contact", method: "GET", path: "/api/contacts?limit=5", auth: true, expect: [200] },
    { id: "API-CONTACTS-ANON", name: "未登录联络人列表", module: "contact", method: "GET", path: "/api/contacts?limit=1", auth: false, expect: [401, 403], warnOn: [200] },
    { id: "API-TAGS", name: "标签列表", module: "tag", method: "GET", path: "/api/tags", auth: true, expect: [200] },
    { id: "API-SEGMENTS", name: "分众列表", module: "audience", method: "GET", path: "/api/segments", auth: true, expect: [200] },
    { id: "API-TEMPLATES", name: "范本列表", module: "template", method: "GET", path: "/api/templates", auth: true, expect: [200] },
    { id: "API-CAMPAIGNS", name: "活动列表", module: "campaign", method: "GET", path: "/api/campaigns", auth: true, expect: [200] },
    { id: "API-INSIGHTS", name: "成效总览", module: "insights", method: "GET", path: "/api/insights/overview", auth: true, expect: [200] },
    { id: "API-OMNICHANNEL", name: "全渠道成效", module: "insights", method: "GET", path: "/api/analytics/omnichannel", auth: true, expect: [200] },
    { id: "API-SERVICE-NUMBERS", name: "服务号列表", module: "tenant", method: "GET", path: "/api/tenants/service-numbers", auth: true, expect: [200] },
    { id: "API-TENANT-CURRENT", name: "当前租户", module: "tenant", method: "GET", path: "/api/tenants/current", auth: true, expect: [200] },
    { id: "API-CHANNELS", name: "渠道实例", module: "channel", method: "GET", path: "/api/channels", auth: true, expect: [200] },
    { id: "API-TEAM", name: "团队成员", module: "settings", method: "GET", path: "/api/team/members", auth: true, expect: [200] },
    { id: "API-STORES", name: "电商店铺", module: "ecommerce", method: "GET", path: "/api/ecommerce/stores", auth: true, expect: [200] },
    { id: "API-RECONCILIATION", name: "月度对账", module: "ecommerce", method: "GET", path: "/api/ecommerce/attribution/monthly-reconciliation", auth: true, expect: [200] },
    { id: "API-ORDERS", name: "最近订单", module: "ecommerce", method: "GET", path: "/api/ecommerce/orders/recent?limit=5", auth: true, expect: [200] },
    { id: "API-JOURNEYS", name: "旅程列表", module: "journey", method: "GET", path: "/api/marketing-automation/journeys", auth: true, expect: [200] },
    { id: "API-JOURNEY-TEMPLATES", name: "旅程模板", module: "journey", method: "GET", path: "/api/marketing-automation/journey-templates", auth: true, expect: [200] },
    { id: "API-SCORING", name: "评分摘要", module: "scoring", method: "GET", path: "/api/marketing-automation/scoring/summary", auth: true, expect: [200] },
    { id: "API-DEAD-LETTERS", name: "群发死信只读", module: "dispatch", method: "GET", path: "/api/dispatch/dead-letters", auth: true, expect: [200] },
    { id: "API-MAIL-STATUS", name: "邮件服务状态", module: "mail", method: "GET", path: "/api/mail/status", auth: true, expect: [200] },
    { id: "API-AI-GENERATE-ANON", name: "未登录不得调用 AI 生成", module: "ai", method: "POST", path: "/api/ai/generate", auth: false, expect: [401, 403], body: {} },
    { id: "API-ADMIN-HEALTH", name: "平台管理健康检查", module: "admin", method: "GET", path: "/api/admin/health", auth: true, expect: [200, 401, 403], optionalAdmin: true },
  ];
}

async function runMutate(session, results) {
  const name = "qa-reg-" + Date.now();
  const created = await request("POST", "/api/tags", {
    headers: session.headers,
    body: { name, category: "general", description: "regression disposable" },
  });
  const tagId = created.json?.tagId || created.json?.id || created.json?.tag?.tagId || created.json?.tag?.id;
  if (created.status >= 400 || !tagId) {
    results.push(caseResult({
      id: "API-TAG-MUTATE",
      name: "标签创建后删除",
      module: "tag",
      method: "POST",
      path: "/api/tags",
    }, "FAIL", created.status, "未拿到可删除的标签 ID: " + created.text.slice(0, 180)));
    return;
  }
  const removed = await request("DELETE", "/api/tags/" + tagId, { headers: session.headers });
  const ok = removed.status < 500;
  results.push(caseResult({
    id: "API-TAG-MUTATE",
    name: "标签创建后删除",
    module: "tag",
    method: "POST/DELETE",
    path: "/api/tags",
  }, ok ? "PASS" : "FAIL", created.status + "/" + removed.status, "临时标签 " + name));
}

async function main() {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const results = [];
  let session = null;
  try {
    session = await login();
    results.push(caseResult({
      id: "API-AUTH-LOGIN",
      name: "OTP 登录",
      module: "auth",
      method: "POST",
      path: "/api/auth/otp/login",
    }, "PASS", 200, "tenant " + session.tenantId + " role=" + (session.user.role || "-") + " access=" + (session.user.accessStatus || "-")));
  } catch (err) {
    results.push(caseResult({
      id: "API-AUTH-LOGIN",
      name: "OTP 登录",
      module: "auth",
      method: "POST",
      path: "/api/auth/otp/login",
    }, "FAIL", 0, err.message));
  }

  for (const item of readCases()) {
    if (item.auth && !session) {
      results.push(caseResult(item, "SKIPPED", 0, "登录失败"));
      continue;
    }
    try {
      const res = await request(item.method, item.path, {
        headers: item.auth ? session.headers : {},
        body: item.body,
      });
      const bodyText = res.text || "";
      const accessBlocked = session && ["revoked", "not_granted"].includes(session.user.accessStatus);
      const matched = item.expect.includes(res.status);
      const warned = item.warnOn?.includes(res.status);
      let status = matched ? "PASS" : warned ? "WARN" : "FAIL";
      if (item.auth && accessBlocked && res.status === 403) status = "SKIPPED";
      if (item.optionalAdmin && !session?.isSuperAdmin && [401, 403].includes(res.status)) status = "SKIPPED";
      if (status === "PASS" && item.includes && !bodyText.includes(item.includes)) status = "FAIL";
      if (status === "PASS" && item.jsonKey && !(res.json && res.json[item.jsonKey])) status = "FAIL";
      if (status === "PASS" && item.expect.includes(200) && res.json === null && bodyText) status = "FAIL";
      const note = item.auth && accessBlocked && res.status === 403
        ? "账号 accessStatus=" + session.user.accessStatus + "，业务接口被授权门拒绝。开通后应返回 200。"
        : warned
        ? "未登录仍返回 " + res.status + "。该接口目前可能失败即降级为空数据，不能当作安全门禁。"
        : item.optionalAdmin && status === "SKIPPED"
          ? "当前账号不是超级管理员"
          : "";
      const detail = status === "PASS" || status === "SKIPPED" ? note : (note ? note + " " : "") + (res.text || "").slice(0, 180);
      results.push(caseResult(item, status, res.status + " " + res.durationMs + "ms", detail));
    } catch (err) {
      results.push(caseResult(item, "FAIL", 0, err.message));
    }
  }

  if (session && process.env.REGRESSION_MUTATE === "1") {
    await runMutate(session, results);
  }

  const summary = {
    title: "AiReach API 功能回归",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    bffUrl: BFF_URL,
    mutate: process.env.REGRESSION_MUTATE === "1",
    counts: {
      total: results.length,
      passed: results.filter((item) => item.status === "PASS").length,
      failed: results.filter((item) => item.status === "FAIL").length,
      warned: results.filter((item) => item.status === "WARN").length,
      skipped: results.filter((item) => item.status === "SKIPPED").length,
    },
    scenarios: results,
  };
  writeJson(path.join(REPORT_DIR, "api-functional.json"), summary);
  const htmlPath = path.join(REPORT_DIR, "api-functional.html");
  writeTableReport({
    file: htmlPath,
    title: "AiReach API 功能回归报告",
    subtitle:
      "通过 " + summary.counts.passed +
      " · 失败 " + summary.counts.failed +
      " · 警告 " + summary.counts.warned +
      " · 跳过 " + summary.counts.skipped +
      " · 耗时 " + summary.durationMs + "ms",
    headers: ["用例", "模块", "请求", "状态", "实际", "说明"],
    rows: results.map((item) => [
      "<code>" + escapeHtml(item.id) + "</code><br>" + escapeHtml(item.name),
      escapeHtml(item.module),
      "<code>" + escapeHtml(item.method + " " + item.path) + "</code>",
      badge(item.status),
      escapeHtml(item.actual),
      escapeHtml(item.note),
    ]),
  });
  console.log("API 报告: " + htmlPath);
  console.log(JSON.stringify(summary.counts));
  if (summary.counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
