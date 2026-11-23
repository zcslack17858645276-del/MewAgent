// S0-2 契约测试：本文件通过 typecheck 就证明「按契约写实现」能编译；
// 负例用 @ts-expect-error 固定住"不该编译过的写法"，契约被放松时 typecheck 会失败。
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentEvent,
  Gate,
  LlmChatResult,
  LlmClient,
  Message,
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolSpec,
} from "../src/types.js";

const echoCall: ToolCall = {
  id: "call_1",
  name: "echo",
  arguments: '{"text":"你好"}',
};

const okResult: ToolResult = { ok: true, output: "你好" };

const echoTool: ToolDefinition = {
  name: "echo",
  description: "把参数 text 原样返回（测试用）",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  readOnly: true,
  async run(args, ctx): Promise<ToolResult> {
    return { ok: true, output: `${ctx.workspace}:${String(args["text"])}` };
  },
};

const echoSpec: ToolSpec = {
  type: "function",
  function: {
    name: echoTool.name,
    description: echoTool.description,
    parameters: echoTool.parameters,
  },
};

const readOnlyGate: Gate = async (call) =>
  call.name === "rm" ? { allow: false, reason: "危险命令" } : { allow: true };

const fakeLlm: LlmClient = {
  async chat(messages, tools, opts): Promise<LlmChatResult> {
    opts?.onText?.("流式");
    const lastRole = messages.at(-1)?.role ?? "none";
    return {
      content: `共 ${messages.length} 条消息，${tools.length} 个工具，最后角色 ${lastRole}`,
      toolCalls: [],
      finishReason: "stop",
    };
  },
};

// 判别联合收窄：每个分支里只能访问该分支的字段，漏分支/多字段都会编译失败。
function describeMessage(message: Message): string {
  switch (message.role) {
    case "system":
    case "user":
      return `${message.role}:${message.content}`;
    case "assistant":
      return `assistant:${message.content}:${message.toolCalls.length}`;
    case "tool":
      return `tool:${message.toolCallId}:${message.content}`;
  }
}

function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case "assistant_text":
      return `text:${event.delta}`;
    case "tool_start":
      return `start:${event.call.name}:${event.args === null ? "invalid-json" : "args"}`;
    case "tool_end":
      return `end:${event.call.name}:${event.result.ok ? "ok" : "error"}:${event.durationMs}`;
    case "turn_end":
      return `turn:${event.reason}`;
  }
}

// 负例：以下写法必须编译失败；一旦契约被放松，@ts-expect-error 会因"没有错误"而导致 typecheck 失败。
// @ts-expect-error assistant 消息必须带 toolCalls 字段
const missingToolCalls: Message = { role: "assistant", content: "我会调用工具" };
// @ts-expect-error tool 消息必须带 toolCallId 字段
const missingToolCallId: Message = { role: "tool", content: "结果" };
// @ts-expect-error ToolCall.arguments 必须是原始 JSON 字符串，不能直接传对象
const numericArguments: ToolCall = { id: "c1", name: echoTool.name, arguments: 1 };
// @ts-expect-error 工具定义必须显式声明 readOnly（决定是否自动放行）
const missingReadOnly: ToolDefinition = { name: "write_file", description: "写文件", parameters: {}, run: async () => okResult };
void [missingToolCalls, missingToolCallId, numericArguments, missingReadOnly];

test("契约：Message 判别联合按 role 收窄", () => {
  assert.equal(describeMessage({ role: "system", content: "sys" }), "system:sys");
  assert.equal(describeMessage({ role: "user", content: "你好" }), "user:你好");
  assert.equal(
    describeMessage({ role: "assistant", content: "", toolCalls: [echoCall] }),
    "assistant::1",
  );
  assert.equal(
    describeMessage({ role: "tool", toolCallId: echoCall.id, content: "ok" }),
    "tool:call_1:ok",
  );
});

test("契约：ToolDefinition / ToolSpec / Gate 可直接实现", async () => {
  const result = await echoTool.run({ text: "你好" }, { workspace: "D:\\work" });
  assert.deepEqual(result, { ok: true, output: "D:\\work:你好" });
  assert.equal(echoTool.readOnly, true);

  assert.equal(echoSpec.type, "function");
  assert.equal(echoSpec.function.name, "echo");
  assert.equal(echoSpec.function.parameters["type"], "object");

  assert.deepEqual(await readOnlyGate(echoCall), { allow: true });
  assert.deepEqual(await readOnlyGate({ ...echoCall, name: "rm" }), {
    allow: false,
    reason: "危险命令",
  });
});

test("契约：LlmClient 假实现可跑通，AgentEvent 四个分支齐全", async () => {
  const deltas: string[] = [];
  const result = await fakeLlm.chat([{ role: "user", content: "你好" }], [echoSpec], {
    onText: (delta) => deltas.push(delta),
  });
  assert.deepEqual(deltas, ["流式"]);
  assert.equal(result.finishReason, "stop");
  assert.match(result.content, /共 1 条消息，1 个工具，最后角色 user/);

  const events: AgentEvent[] = [
    { type: "assistant_text", delta: "hi" },
    { type: "tool_start", call: echoCall, args: { text: "你好" } },
    { type: "tool_start", call: echoCall, args: null },
    { type: "tool_end", call: echoCall, result: okResult, durationMs: 12 },
    { type: "turn_end", reason: "stop" },
  ];
  assert.deepEqual(events.map(describeEvent), [
    "text:hi",
    "start:echo:args",
    "start:echo:invalid-json",
    "end:echo:ok:12",
    "turn:stop",
  ]);
});
