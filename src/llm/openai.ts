// S1-2 OpenAI 兼容流式客户端：fetch + SSE + text delta + tool_calls 增量聚合 + abort。
//
// 边界（方案 §3.1）：llm 层只负责协议，不执行工具、不读 stdin、不 import Ink。
// 为了可测，fetch 通过参数注入（`fetchImpl`），测试用假流喂 SSE，不碰网络、
// 也不打补丁全局 fetch。
//
// 关键规则（方案 §6.2）：
// - `delta.tool_calls` 按 `index` 聚合；`id` / `function.name` 取第一次出现的非空值；
// - `function.arguments` 字符串累加；
// - 结束时按 index 排序，过滤掉没有 name 的项；
// - 有 tool_calls 时 finishReason 以实际数据为准（有些供应商返回 stop）。

import { toApiMessages } from "../agent/messages.js";
import type { LlmChatOptions, LlmChatResult, LlmClient, Message, ToolCall, ToolSpec } from "../types.js";
import { parseSseStream } from "./sse.js";

/** 流式响应里 `delta.tool_calls` 的单片；字段都可能缺失。 */
export interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** 只声明客户端实际用到的 fetch 形状，便于测试注入假实现。 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  body: ReadableStream<Uint8Array> | null;
}>;

export interface OpenAiClientConfig {
  /** 例如 `https://api.deepseek.com`；客户端负责拼 `/chat/completions`。 */
  baseUrl: string;
  /** 只在这里使用，绝不写进错误消息或日志。 */
  apiKey: string;
  model: string;
  /** 测试注入；默认用全局 fetch。 */
  fetchImpl?: FetchLike;
  /**
   * 请求发出前的只读调试钩子（`MEWCODE_DEBUG=1` 用）。
   * 传入的是最终请求体字符串：不含 apiKey，可安全打印。
   */
  onRequest?: (info: { url: string; body: string }) => void;
}

/** 请求失败（非 2xx）时抛出；UI 据此显示状态码与供应商摘要。 */
export class LlmHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LlmHttpError";
    this.status = status;
  }
}

function createAbortError(): Error {
  const error = new Error("LLM 请求已被中断（AbortSignal）。");
  error.name = "AbortError";
  return error;
}

/** 统一的取消检查；独立成函数，避免调用处被 TS 的 `aborted` 收窄误导。 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw createAbortError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, limit = 400): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * 把流式 `tool_calls` 分片聚合成完整工具调用（纯函数，便于单测）。
 *
 * 分片规则见方案 §6.2：index 稳定、id/name 只取第一次非空、arguments 累加；
 * 最后按 index 排序并丢弃没有 name 的残缺项。
 */
export function aggregateToolCallDeltas(deltas: readonly ToolCallDelta[]): ToolCall[] {
  const byIndex = new Map<number, { id?: string; name?: string; arguments: string }>();

  for (const delta of deltas) {
    const index = typeof delta.index === "number" && delta.index >= 0 ? delta.index : 0;
    let entry = byIndex.get(index);
    if (entry === undefined) {
      entry = { arguments: "" };
      byIndex.set(index, entry);
    }

    if (entry.id === undefined && typeof delta.id === "string" && delta.id !== "") {
      entry.id = delta.id;
    }

    const fn = delta.function;
    if (fn === undefined) continue;
    if (entry.name === undefined && typeof fn.name === "string" && fn.name !== "") {
      entry.name = fn.name;
    }
    if (typeof fn.arguments === "string" && fn.arguments !== "") {
      entry.arguments += fn.arguments;
    }
  }

  const calls: ToolCall[] = [];
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const entry = byIndex.get(index);
    if (entry === undefined || entry.name === undefined) continue;
    // 正常响应第一片就带 id；缺失时给个确定性占位值，避免下游拿到空 id。
    calls.push({
      id: entry.id ?? `call_${index}`,
      name: entry.name,
      arguments: entry.arguments,
    });
  }
  return calls;
}

interface DeltaChunk {
  content: string;
  toolCallDeltas: ToolCallDelta[];
  finishReason: string | null;
}

function toToolCallDelta(value: unknown): ToolCallDelta | null {
  if (!isRecord(value)) return null;
  const delta: ToolCallDelta = {};
  if (typeof value.index === "number") delta.index = value.index;
  if (typeof value.id === "string") delta.id = value.id;

  const fn = isRecord(value.function) ? value.function : undefined;
  if (fn !== undefined) {
    const functionDelta: NonNullable<ToolCallDelta["function"]> = {};
    if (typeof fn.name === "string") functionDelta.name = fn.name;
    if (typeof fn.arguments === "string") functionDelta.arguments = fn.arguments;
    delta.function = functionDelta;
  }
  return delta;
}

/** 解析一条 `data:` 负载；坏 JSON 直接抛出可读错误（调用方会原样冒泡给 UI）。 */
function readDeltaChunk(payload: string): DeltaChunk {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`流式响应不是合法 JSON：${truncate(payload)}`);
  }

  const chunk: DeltaChunk = { content: "", toolCallDeltas: [], finishReason: null };
  if (!isRecord(parsed)) return chunk;

  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return chunk;
  const first = choices[0];
  if (!isRecord(first)) return chunk;

  if (typeof first.finish_reason === "string" && first.finish_reason !== "") {
    chunk.finishReason = first.finish_reason;
  }

  const delta = isRecord(first.delta) ? first.delta : undefined;
  if (delta === undefined) return chunk;

  if (typeof delta.content === "string" && delta.content !== "") {
    chunk.content = delta.content;
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const raw of delta.tool_calls) {
      const toolCallDelta = toToolCallDelta(raw);
      if (toolCallDelta !== null) chunk.toolCallDeltas.push(toolCallDelta);
    }
  }
  return chunk;
}

async function toHttpError(response: {
  status: number;
  statusText: string;
  text(): Promise<string>;
}, apiKey: string): Promise<LlmHttpError> {
  let detail = "";
  try {
    detail = truncate(await response.text()).trim();
  } catch {
    // 读失败不影响报错本身。
  }
  if (apiKey !== "" && detail.includes(apiKey)) {
    detail = detail.split(apiKey).join("[REDACTED]");
  }
  const statusText = response.statusText === "" ? "" : ` ${response.statusText}`;
  const suffix = detail === "" ? "" : `：${detail}`;
  return new LlmHttpError(
    response.status,
    `LLM 请求失败（HTTP ${response.status}${statusText}）${suffix}`,
  );
}

/** 创建真实 LLM 客户端；每个实例只绑定配置，不持有请求状态。 */
export function createOpenAiLlmClient(config: OpenAiClientConfig): LlmClient {
  const fetchImpl: FetchLike = config.fetchImpl ?? fetch;
  const endpoint = `${stripTrailingSlashes(config.baseUrl)}/chat/completions`;

  return {
    async chat(
      messages: Message[],
      tools: ToolSpec[],
      opts: LlmChatOptions = {},
    ): Promise<LlmChatResult> {
      const { signal, onText } = opts;
      throwIfAborted(signal);

      const requestBody: Record<string, unknown> = {
        model: config.model,
        messages: toApiMessages(messages),
        stream: true,
      };
      if (tools.length > 0) requestBody.tools = tools;

      const body = JSON.stringify(requestBody);
      config.onRequest?.({ url: endpoint, body });

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
        signal,
      });

      if (!response.ok) throw await toHttpError(response, config.apiKey);
      if (response.body === null) {
        throw new Error("LLM 响应没有可读取的 body（应返回 text/event-stream）。");
      }

      let content = "";
      let finishReason: string | null = null;
      const toolCallDeltas: ToolCallDelta[] = [];

      for await (const payload of parseSseStream(response.body, { signal })) {
        throwIfAborted(signal);

        const chunk = readDeltaChunk(payload);
        if (chunk.content !== "") {
          content += chunk.content;
          onText?.(chunk.content);
        }
        if (chunk.toolCallDeltas.length > 0) toolCallDeltas.push(...chunk.toolCallDeltas);
        if (chunk.finishReason !== null) finishReason = chunk.finishReason;
      }

      const toolCalls = aggregateToolCallDeltas(toolCallDeltas);
      return {
        content,
        toolCalls,
        // 方案 §6.2：以实际数据为准，避免供应商把 tool_calls 报成 stop。
        finishReason: toolCalls.length > 0 ? "tool_calls" : finishReason ?? "stop",
      };
    },
  };
}
