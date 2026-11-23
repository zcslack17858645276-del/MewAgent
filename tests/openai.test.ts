// S1-2 单测：tool_calls 增量聚合、Message → API 消息转换、假 fetch 驱动的流式 chat。
//
// 全部离线：fetch 通过 `fetchImpl` 注入假实现 + 内存 ReadableStream，不联网、不改全局。

import test from "node:test";
import assert from "node:assert/strict";

import type { Message, ToolSpec } from "../src/types.js";
import {
  createOpenAiLlmClient,
  aggregateToolCallDeltas,
  toApiMessages,
  LlmHttpError,
  type FetchLike,
} from "../src/llm/openai.js";

function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface FetchCall {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal | undefined;
  };
}

interface FetchStubOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
}

function createFetchStub(options: FetchStubOptions = {}): {
  fetchImpl: FetchLike;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      statusText: options.statusText ?? "OK",
      body: options.body ?? null,
      text: options.text ?? (async () => ""),
    };
  };
  return { fetchImpl, calls };
}

function readJsonBody(call: FetchCall): Record<string, unknown> {
  const parsed: unknown = JSON.parse(call.init.body);
  assert.ok(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    "请求体应是 JSON 对象",
  );
  return parsed as Record<string, unknown>;
}

const userMessage: Message = { role: "user", content: "读一下 README" };
const readFileTool: ToolSpec = {
  type: "function",
  function: {
    name: "read_file",
    description: "读取文件内容",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
};

test("aggregateToolCallDeltas：arguments 分多段到达时按顺序拼接", () => {
  const calls = aggregateToolCallDeltas([
    { index: 0, id: "call_1", function: { name: "read_file", arguments: "" } },
    { index: 0, function: { arguments: '{"path":' } },
    { index: 0, function: { arguments: '"README.md"}' } },
  ]);
  assert.deepEqual(calls, [
    { id: "call_1", name: "read_file", arguments: '{"path":"README.md"}' },
  ]);
});

test("aggregateToolCallDeltas：index 乱序到达时按 index 排序输出", () => {
  const calls = aggregateToolCallDeltas([
    { index: 1, id: "call_b", function: { name: "bash", arguments: '{"cmd":' } },
    { index: 0, id: "call_a", function: { name: "read_file", arguments: '{"path":' } },
    { index: 1, function: { arguments: '"ls"}' } },
    { index: 0, function: { arguments: '"a.txt"}' } },
  ]);
  assert.deepEqual(calls, [
    { id: "call_a", name: "read_file", arguments: '{"path":"a.txt"}' },
    { id: "call_b", name: "bash", arguments: '{"cmd":"ls"}' },
  ]);
});

test("aggregateToolCallDeltas：空 delta 与缺 name 的残缺项被过滤", () => {
  assert.deepEqual(aggregateToolCallDeltas([]), []);
  assert.deepEqual(aggregateToolCallDeltas([{ index: 0 }, { function: { arguments: "{}" } }]), []);
});

test("aggregateToolCallDeltas：id/name 只取第一次出现的非空值", () => {
  const calls = aggregateToolCallDeltas([
    { index: 0, id: "call_first", function: { name: "read_file" } },
    { index: 0, id: "call_second", function: { name: "bash", arguments: "{}" } },
  ]);
  assert.deepEqual(calls, [{ id: "call_first", name: "read_file", arguments: "{}" }]);
});

test("aggregateToolCallDeltas：缺 id 时使用确定性占位 call_<index>", () => {
  const calls = aggregateToolCallDeltas([
    { index: 2, function: { name: "bash", arguments: '{"cmd":"pwd"}' } },
  ]);
  assert.deepEqual(calls, [{ id: "call_2", name: "bash", arguments: '{"cmd":"pwd"}' }]);
});

test("toApiMessages：四类消息转成线上格式，tool 带 tool_call_id", () => {
  const wire = toApiMessages([
    { role: "system", content: "你是 MewAgent" },
    { role: "user", content: "你好" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' }],
    },
    { role: "tool", toolCallId: "call_1", content: "文件内容" },
  ]);
  assert.deepEqual(wire, [
    { role: "system", content: "你是 MewAgent" },
    { role: "user", content: "你好" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.txt"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "文件内容" },
  ]);
});

test("toApiMessages：assistant 没有 toolCalls 时不带 tool_calls 字段", () => {
  const wire = toApiMessages([{ role: "assistant", content: "直接回答", toolCalls: [] }]);
  assert.deepEqual(wire, [{ role: "assistant", content: "直接回答" }]);
});

test("chat：文本流逐段累加并回调 onText，请求体与请求头正确", async () => {
  const { fetchImpl, calls } = createFetchStub({
    body: sseStream([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"！"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });

  const deltas: string[] = [];
  const result = await client.chat([userMessage], [readFileTool], {
    onText: (delta) => deltas.push(delta),
  });

  assert.equal(result.content, "你好！");
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(deltas, ["你", "好", "！"]);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, "https://api.example.com/v1/chat/completions");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Authorization"], "Bearer test-key");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.init.headers["Accept"], "text/event-stream");

  const body = readJsonBody(call);
  assert.equal(body["model"], "test-model");
  assert.equal(body["stream"], true);
  assert.deepEqual(body["messages"], [{ role: "user", content: "读一下 README" }]);
  assert.deepEqual(body["tools"], [readFileTool]);
});

test("chat：tool_calls 分片流式到达时聚合，finishReason 以实际数据为准", async () => {
  const { fetchImpl } = createFetchStub({
    body: sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });

  const deltas: string[] = [];
  const result = await client.chat([userMessage], [], { onText: (delta) => deltas.push(delta) });

  assert.equal(result.content, "");
  assert.deepEqual(result.toolCalls, [
    { id: "call_abc", name: "read_file", arguments: '{"path":"README.md"}' },
  ]);
  // 供应商报了 stop，但实际有 tool_calls → 以数据为准。
  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(deltas, []);
});

test("chat：HTTP 401 抛 LlmHttpError，供应商摘要保留且 key 被脱敏", async () => {
  const { fetchImpl } = createFetchStub({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => '{"error":{"message":"Incorrect API key provided: sk-secret-key"}}',
  });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com",
    apiKey: "sk-secret-key",
    model: "test-model",
    fetchImpl,
  });

  await assert.rejects(client.chat([userMessage], []), (error: unknown) => {
    assert.ok(error instanceof LlmHttpError);
    assert.equal(error.status, 401);
    assert.match(error.message, /HTTP 401/);
    assert.match(error.message, /Incorrect API key/);
    assert.doesNotMatch(error.message, /sk-secret-key/);
    return true;
  });
});

test("chat：已中止的 signal 在发请求前就抛 AbortError", async () => {
  const { fetchImpl, calls } = createFetchStub({
    body: sseStream(['data: [DONE]\n\n']),
  });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(client.chat([userMessage], [], { signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(calls.length, 0, "已中止时不应发起网络请求");
});

test("chat：坏 JSON 分片抛可读错误而不是静默失败", async () => {
  const { fetchImpl } = createFetchStub({
    body: sseStream(["data: {oops}\n\n", "data: [DONE]\n\n"]),
  });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });

  await assert.rejects(client.chat([userMessage], []), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /不是合法 JSON/);
    return true;
  });
});

test("chat：响应没有 body 时给出明确错误", async () => {
  const { fetchImpl } = createFetchStub({ body: null });
  const client = createOpenAiLlmClient({
    baseUrl: "https://api.example.com",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl,
  });

  await assert.rejects(client.chat([userMessage], []), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /没有可读取的 body/);
    return true;
  });
});
