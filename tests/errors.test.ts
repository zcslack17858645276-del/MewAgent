import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeFailure,
  describeHttpStatus,
  describeToolFailure,
  isNetworkFailure,
} from "../src/errors.js";

test("errors：HTTP 状态码映射到具体下一步", () => {
  assert.ok(describeHttpStatus(401).includes("MEWCODE_API_KEY"));
  assert.ok(describeHttpStatus(403).includes("MEWCODE_API_KEY"));
  assert.ok(describeHttpStatus(404).includes("MEWCODE_BASE_URL"));
  assert.ok(describeHttpStatus(429).includes("限流"));
  assert.ok(describeHttpStatus(503).includes("稍后重试"));
  assert.ok(describeHttpStatus(418).includes("API key"));
});

test("errors：isNetworkFailure 只认网络类 TypeError", () => {
  assert.equal(isNetworkFailure(new TypeError("fetch failed")), true);
  assert.equal(isNetworkFailure(new TypeError("connect ECONNREFUSED 127.0.0.1:7890")), true);
  assert.equal(isNetworkFailure(new TypeError("getaddrinfo ENOTFOUND api.deepseek.com")), true);
  assert.equal(isNetworkFailure(new TypeError("boom")), false);
  assert.equal(isNetworkFailure(new Error("fetch failed")), false);
  assert.equal(isNetworkFailure("fetch failed"), false);
});

test("errors：describeFailure 覆盖 HTTP / 网络 / 中断 / 其它", () => {
  const http = describeFailure({
    name: "LlmHttpError",
    status: 401,
    message: "LLM 请求失败（HTTP 401）：invalid api key",
  });
  assert.equal(http.what, "LLM 请求失败（HTTP 401）：invalid api key");
  assert.ok(http.next.includes("MEWCODE_API_KEY"), http.next);

  const network = describeFailure(new TypeError("fetch failed"));
  assert.equal(network.what, "网络请求失败：fetch failed");
  assert.ok(network.next.includes("HTTP_PROXY"), network.next);

  const aborted = new Error("aborted");
  aborted.name = "AbortError";
  const interruption = describeFailure(aborted);
  assert.ok(interruption.what.includes("已中断"), interruption.what);
  assert.ok(interruption.next !== "");

  const generic = describeFailure(new Error("boom"));
  assert.equal(generic.what, "请求失败：boom");
  assert.ok(generic.next.length > 0);
});

test("errors：describeToolFailure 提取首行与下一步，缺下一步时为 null", () => {
  const withNext = describeToolFailure(
    "Error: 未找到匹配内容（a.txt），请检查缩进/换行。\n下一步：先用 read_file 确认原文。",
  );
  assert.equal(withNext.what, "未找到匹配内容（a.txt），请检查缩进/换行。");
  assert.equal(withNext.next, "先用 read_file 确认原文。");

  const withoutNext = describeToolFailure("Error: 未知工具 \"foo\"。\n可用工具：read_file");
  assert.equal(withoutNext.what, "未知工具 \"foo\"。");
  assert.equal(withoutNext.next, null);
});
