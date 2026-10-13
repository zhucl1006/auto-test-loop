#!/usr/bin/env node

/**
 * AiReach 只读压力脚本。
 *
 * 只打 GET，不发送活动、不写数据、不循环发送 OTP。
 * 默认 smoke。stress 必须 LOAD_CONFIRM=1。
 *
 * 用法:
 *   pnpm run aireach:load
 *   LOAD_PROFILE=baseline pnpm run aireach:load
 *   LOAD_PROFILE=stress LOAD_CONFIRM=1 pnpm run aireach:load
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { badge, escapeHtml, writeJson, writeTableReport } from "./report.mjs";

dotenv.config();

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BFF_URL = (process.env.BFF_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const REPORT_DIR = path.join(ROOT_DIR, "test/reports/load");
const PHONE = process.env.TEST_PHONE || "";
const OTP = process.env.TEST_OTP || "";
const AUTH_ENV = process.env.TEST_AUTH_ENV || "";

const PROFILES = {
  smoke: {
    concurrency: 4,
    requestsPerEndpoint: 8,
    thresholds: { errorRate: 0.05, p95Ms: 3000 },
    confirm: false,
  },
  baseline: {
    concurrency: 10,
    requestsPerEndpoint: 30,
    thresholds: { errorRate: 0.02, p95Ms: 2500 },
    confirm: false,
  },
  stress: {
    concurrency: 30,
    requestsPerEndpoint: 80,
    thresholds: { errorRate: 0.05, p95Ms: 5000 },
    confirm: true,
  },
};

const ENDPOINTS = [
  { id: "health", path: "/api/health", auth: false },
  { id: "home", path: "/api/home/summary", auth: true },
  { id: "contacts", path: "/api/contacts?limit=20", auth: true },
  { id: "campaigns", path: "/api/campaigns", auth: true },
  { id: "tags", path: "/api/tags", auth: true },
  { id: "insights", path: "/api/insights/overview", auth: true },
];

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

async function login() {
  if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
    const logged = await fetch(BFF_URL + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.TEST_EMAIL,
        password: process.env.TEST_PASSWORD,
        ...(process.env.TEST_TENANT_ID ? { tenantId: process.env.TEST_TENANT_ID } : {}),
      }),
    });
    const body = await logged.json();
    const token = body.tokens?.accessToken || body.token;
    if (!logged.ok || !token || !body.user?.tenantId) throw new Error("邮箱登录失败，压力测试未启动");
    return {
      jwtToken: token,
      Authorization: "Bearer " + token,
      "X-Tenant-Id": body.user.tenantId,
      "x-selected-tenant-id": body.user.tenantId,
      "X-User-Id": body.user.userId || "",
    };
  }
  if (!PHONE || !OTP || !AUTH_ENV) {
    throw new Error("OTP 登录需要 TEST_PHONE、TEST_OTP 和 TEST_AUTH_ENV。请写入本地 .env，不要提交。");
  }
  const sent = await fetch(BFF_URL + "/api/auth/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: PHONE, purpose: "Login", env: AUTH_ENV }),
  });
  const sentJson = await sent.json();
  const onceToken = sentJson.onceToken || sentJson.data?.onceToken;
  if (!sent.ok || !onceToken) throw new Error("OTP 发送失败，压力测试未启动");
  const logged = await fetch(BFF_URL + "/api/auth/otp/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onceToken, otp: OTP, env: AUTH_ENV }),
  });
  const body = await logged.json();
  if (!logged.ok || !body.token || !body.user?.tenantId) throw new Error("OTP 登录失败，压力测试未启动");
  return {
    jwtToken: body.token,
    Authorization: "Bearer " + body.token,
    "X-Tenant-Id": body.user.tenantId,
    "x-selected-tenant-id": body.user.tenantId,
  };
}

async function hit(endpoint, headers) {
  const started = Date.now();
  try {
    const res = await fetch(BFF_URL + endpoint.path, {
      headers: endpoint.auth ? headers : {},
    });
    const denied = res.status === 401 || res.status === 403;
    return {
      ok: res.status >= 200 && res.status < 400,
      denied,
      status: res.status,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - started, error: err.message };
  }
}

async function runEndpoint(endpoint, profile, headers) {
  const samples = [];
  let cursor = 0;
  const total = profile.requestsPerEndpoint;
  async function worker() {
    while (cursor < total) {
      cursor += 1;
      samples.push(await hit(endpoint, headers));
    }
  }
  await Promise.all(Array.from({ length: Math.min(profile.concurrency, total) }, () => worker()));
  const durations = samples.map((item) => item.durationMs);
  const denied = samples.filter((item) => item.denied).length;
  const errors = samples.filter((item) => !item.ok && !item.denied).length;
  return {
    id: endpoint.id,
    path: endpoint.path,
    requests: samples.length,
    errors,
    denied,
    errorRate: samples.length ? errors / samples.length : 1,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max(0, ...durations),
  };
}

async function main() {
  const name = process.env.LOAD_PROFILE || "smoke";
  const profile = PROFILES[name];
  if (!profile) throw new Error("未知 LOAD_PROFILE: " + name);
  if (profile.confirm && process.env.LOAD_CONFIRM !== "1") {
    throw new Error("stress 档案会提高本地服务负载。确认后使用 LOAD_CONFIRM=1。");
  }
  const started = Date.now();
  const headers = await login();
  const rows = [];
  for (const endpoint of ENDPOINTS) {
    const row = await runEndpoint(endpoint, profile, headers);
    const accessDenied = row.denied === row.requests;
    const failed = !accessDenied && (row.errorRate > profile.thresholds.errorRate || row.p95Ms > profile.thresholds.p95Ms);
    row.status = accessDenied ? "SKIPPED" : failed ? "FAIL" : "PASS";
    rows.push(row);
    console.log(row.status + " " + row.id + " p95=" + row.p95Ms + "ms errors=" + row.errors + "/" + row.requests);
  }
  const summary = {
    title: "AiReach 只读压力测试",
    profile: name,
    thresholds: profile.thresholds,
    concurrency: profile.concurrency,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    counts: {
      total: rows.length,
      passed: rows.filter((item) => item.status === "PASS").length,
      failed: rows.filter((item) => item.status === "FAIL").length,
    skipped: rows.filter((item) => item.status === "SKIPPED").length,
    },
    endpoints: rows,
  };
  writeJson(path.join(REPORT_DIR, "load-" + name + ".json"), summary);
  const htmlPath = path.join(REPORT_DIR, "load-" + name + ".html");
  writeTableReport({
    file: htmlPath,
    title: "AiReach 只读压力测试报告",
    subtitle:
      "档案 " + escapeHtml(name) +
      " · 并发 " + profile.concurrency +
      " · 每接口 " + profile.requestsPerEndpoint +
      " · p95 阈值 " + profile.thresholds.p95Ms + "ms",
    headers: ["接口", "请求数", "错误率", "p50", "p95", "p99", "最大", "状态"],
    rows: rows.map((item) => [
      "<code>" + escapeHtml(item.id) + "</code><br>" + escapeHtml(item.path),
      String(item.requests),
      (item.errorRate * 100).toFixed(1) + "%",
      item.p50Ms + "ms",
      item.p95Ms + "ms",
      item.p99Ms + "ms",
      item.maxMs + "ms",
      badge(item.status),
    ]),
  });
  console.log("压力报告: " + htmlPath);
  if (summary.counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
