// 首次配置向导的「连接测试」：用一次最小的非流式请求确认 base-url / 模型 / API key 可用。
//
// 边界（AGENTS §3/§4）：
// - 纯网络层，不 import Ink、不读 stdin；错误信息统一带「下一步」，且**绝不回显 API key**。
// - 只复用 `src/errors.ts` 的错误描述，不依赖 LLM 客户端内部实现。

import { describeHttpStatus } from "../errors.js";
import type { FetchLike } from "../llm/openai.js";

/** 连接测试结果：`reason` 是可以直接展示给用户的中文说明（含下一步）。 */
export interface ProbeConnectionResult {
  ok: boolean;
  reason: string;
}

/** 连接测试参数；`fetchImpl` 仅测试注入。 */
export interface ProbeConnectionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  /** 单次请求超时（毫秒），默认 10 秒。 */
  timeoutMs?: number;
}

/** 服务器返回原文在错误信息里的最大长度，避免刷屏。 */
const MAX_SERVER_DETAIL_CHARS = 300;

/**
 * 发一次 `max_tokens: 1` 的 `ping` 请求：
 * - 2xx：连接可用；
 * - 非 2xx：给出 HTTP 状态 + `describeHttpStatus` 的下一步 + 服务端原话（截断）；
 * - 网络/超时/中断：分别给出可操作的原因。
 */
export async function probeConnection(
  options: ProbeConnectionOptions,
): Promise<ProbeConnectionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readTruncatedText(response);
      const suffix =
        detail === "" ? "" : `\n服务器原话（已截断）：${detail}`;
      return {
        ok: false,
        reason: `接口返回 HTTP ${response.status} ${response.statusText}。\n下一步：${describeHttpStatus(
          response.status,
        )}${suffix}`,
      };
    }
    return { ok: true, reason: "连接成功，配置可用。" };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        reason: `连接超时（${Math.round(
          timeoutMs / 1000,
        )} 秒内没有响应）。\n下一步：检查网络/代理，或换一个可达的 base-url。`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `网络请求失败：${message}\n下一步：检查网络、代理（如 HTTP_PROXY/HTTPS_PROXY）与 base-url 是否正确。`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readTruncatedText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    return trimmed.length > MAX_SERVER_DETAIL_CHARS
      ? `${trimmed.slice(0, MAX_SERVER_DETAIL_CHARS)}…`
      : trimmed;
  } catch {
    return "";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
