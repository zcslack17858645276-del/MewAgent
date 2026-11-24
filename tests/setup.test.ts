// 首次配置向导：纯逻辑校验 + 连接测试（内存里，不联网）。
// 覆盖：各字段校验、归一化、掩码/摘要不泄露 key、probe 的成功/HTTP/网络/超时分支。

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FetchLike } from "../src/llm/openai.js";
import { probeConnection } from "../src/setup/probe.js";
import {
  describeSetupSummary,
  maskSecret,
  normalizeDraft,
  validateApiKey,
  validateBaseUrl,
  validateModel,
} from "../src/ui/setup-state.js";

test("validateBaseUrl：空/非 http(s) 拒绝，正常地址通过", () => {
  assert.equal(validateBaseUrl("").ok, false);
  assert.equal(validateBaseUrl("   ").ok, false);
  assert.equal(validateBaseUrl("ftp://example.com").ok, false);
  assert.equal(validateBaseUrl("api.deepseek.com").ok, false);
  assert.equal(validateBaseUrl("https://api.deepseek.com").ok, true);
  assert.equal(validateBaseUrl("http://127.0.0.1:8080/v1").ok, true);
});

test("validateModel：空与含空格拒绝，正常名字通过", () => {
  assert.equal(validateModel("").ok, false);
  assert.equal(validateModel("   ").ok, false);
  assert.equal(validateModel("deep seek").ok, false);
  assert.equal(validateModel("deepseek-chat").ok, true);
});

test("validateApiKey：空只允许在已有 key 时；含空格拒绝", () => {
  assert.equal(validateApiKey("", { hasExisting: false }).ok, false);
  assert.equal(validateApiKey("", { hasExisting: true }).ok, true);
  assert.equal(validateApiKey("sk-a b", { hasExisting: true }).ok, false);
  assert.equal(validateApiKey("sk-abc", { hasExisting: false }).ok, true);
});

test("normalizeDraft：去空白与 base-url 尾部斜杠", () => {
  const draft = normalizeDraft({
    baseUrl: "  https://api.deepseek.com///  ",
    model: " deepseek-chat ",
    apiKey: " sk-abc ",
  });
  assert.deepEqual(draft, {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "sk-abc",
  });
});

test("maskSecret/describeSetupSummary：不泄露 key 原文", () => {
  const secret = "sk-should-not-leak-123456";
  assert.equal(maskSecret(secret), "•".repeat(Array.from(secret).length));
  const lines = describeSetupSummary(
    {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: secret,
    },
    { hasExistingApiKey: false },
  );
  const joined = lines.join("\n");
  assert.equal(joined.includes(secret), false);
  assert.equal(joined.includes("sk-"), false);
  assert.equal(joined.includes(`（${Array.from(secret).length} 个字符）`), true);

  const keep = describeSetupSummary(
    { baseUrl: "https://x.example.com", model: "m", apiKey: "" },
    { hasExistingApiKey: true },
  );
  assert.equal(keep.join("\n").includes("保留已保存的 key"), true);
});

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

function fakeFetch(
  response:
    | FakeResponse
    | (() => Promise<FakeResponse>),
  calls: { url: string; body: string; headers: Record<string, string> }[] = [],
): FetchLike {
  return async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    const next =
      typeof response === "function" ? await response() : response;
    return { ...next, body: null };
  };
}

test("probeConnection：2xx 视为连接成功，请求体是最小非流式请求", async () => {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchImpl = fakeFetch(
    {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "{}",
    },
    calls,
  );
  const result = await probeConnection({
    baseUrl: "https://api.deepseek.com/",
    apiKey: "sk-probe",
    model: "deepseek-chat",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0]?.headers["authorization"], "Bearer sk-probe");
  const body = JSON.parse(calls[0]?.body ?? "{}") as {
    model?: string;
    stream?: boolean;
    max_tokens?: number;
  };
  assert.equal(body.model, "deepseek-chat");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 1);
});

test("probeConnection：401 给出可操作下一步且不回显 key", async () => {
  const secret = "sk-secret-401";
  const fetchImpl = fakeFetch({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => '{"error":"invalid api key"}',
  });
  const result = await probeConnection({
    baseUrl: "https://api.deepseek.com",
    apiKey: secret,
    model: "deepseek-chat",
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes("401"), true);
  assert.match(result.reason, /API[_ ]?key/i);
  assert.equal(result.reason.includes("下一步"), true);
  assert.equal(result.reason.includes(secret), false);
  assert.equal(result.reason.includes("invalid api key"), true);
});

test("probeConnection：429/503 分别给出限流/稍后重试", async () => {
  const limited = await probeConnection({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-x",
    model: "m",
    fetchImpl: fakeFetch({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "",
    }),
  });
  assert.equal(limited.ok, false);
  assert.equal(limited.reason.includes("429"), true);

  const serverError = await probeConnection({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-x",
    model: "m",
    fetchImpl: fakeFetch({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "upstream busy",
    }),
  });
  assert.equal(serverError.ok, false);
  assert.equal(serverError.reason.includes("503"), true);
  assert.equal(serverError.reason.includes("重试"), true);
});

test("probeConnection：网络错误与超时都给出下一步", async () => {
  const network = await probeConnection({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-x",
    model: "m",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(network.ok, false);
  assert.equal(network.reason.includes("网络"), true);
  assert.equal(network.reason.includes("下一步"), true);

  const timeout = await probeConnection({
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-x",
    model: "m",
    timeoutMs: 20,
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.reason.includes("超时"), true);
});
