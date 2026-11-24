import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_MAX_STEPS, runAgent } from "../src/agent/loop.js";
import type { AgentLoopOptions } from "../src/agent/loop.js";
import { createDefaultRegistry } from "../src/tools/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type {
  AgentEvent,
  LlmChatOptions,
  LlmChatResult,
  LlmClient,
  Message,
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolSpec,
} from "../src/types.js";

const WORKSPACE = "D:/workplace/testbed";
const SYSTEM_PROMPT = "你是测试用 MewAgent。";

interface ScriptedTurn {
  /** 不传则用 deltas 拼接。 */
  readonly content?: string;
  /** 模拟流式：逐段调用 onText。 */
  readonly deltas?: readonly string[];
  readonly toolCalls?: readonly ToolCall[];
  readonly finishReason?: string;
  /** 抛出该错误（用于 abort/网络错误场景）。 */
  readonly error?: unknown;
}

interface ChatCall {
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
  readonly opts: LlmChatOptions | undefined;
}

interface ScriptedLlm extends LlmClient {
  readonly calls: ChatCall[];
}

/** 按剧本依次返回的假 LLM；剧本用尽即抛错，避免循环意外多跑。 */
function createScriptedLlm(turns: readonly ScriptedTurn[]): ScriptedLlm {
  const calls: ChatCall[] = [];
  return {
    calls,
    async chat(messages, tools, opts): Promise<LlmChatResult> {
      calls.push({ messages: [...messages], tools, opts });
      const turn = turns[calls.length - 1];
      if (turn === undefined) {
        throw new Error(`剧本超出：第 ${calls.length} 次 chat 没有预设响应。`);
      }
      if (turn.error !== undefined) {
        throw turn.error;
      }
      const deltas = turn.deltas ?? [];
      if (deltas.length > 0) {
        for (const delta of deltas) {
          opts?.onText?.(delta);
        }
      }
      const content = turn.content ?? deltas.join("");
      const toolCalls = [...(turn.toolCalls ?? [])];
      return {
        content,
        toolCalls,
        finishReason:
          turn.finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop"),
      };
    },
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

interface EchoSeen {
  count: number;
  lastArgs?: Record<string, unknown>;
}

function createEchoTool(seen: EchoSeen = { count: 0 }): ToolDefinition {
  return {
    name: "echo",
    description: "回显 text 参数，仅用于 loop 测试。",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    readOnly: true,
    run: async (args): Promise<ToolResult> => {
      seen.count += 1;
      seen.lastArgs = args;
      return { ok: true, output: `echo:${String(args["text"] ?? "")}` };
    },
  };
}

function createFlakyTool(): ToolDefinition {
  return {
    name: "flaky",
    description: "总是返回失败且不带 Error: 前缀，用于验证回填规范化。",
    parameters: { type: "object", properties: {} },
    readOnly: false,
    run: async (): Promise<ToolResult> => ({ ok: false, output: "磁盘满了" }),
  };
}

function createWriteTool(): ToolDefinition {
  return {
    name: "write_file",
    description: "假写文件工具（验证 specs 透传）。",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    readOnly: false,
    run: async (): Promise<ToolResult> => ({ ok: true, output: "written" }),
  };
}

interface Collected {
  readonly events: AgentEvent[];
  readonly emit: (event: AgentEvent) => void;
}

function collectEvents(): Collected {
  const events: AgentEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

function eventTypes(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

function baseOptions(
  llm: LlmClient,
  tools: ToolRegistry,
  overrides: Partial<AgentLoopOptions> = {},
): AgentLoopOptions {
  return {
    llm,
    tools,
    workspace: WORKSPACE,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: "你好" }],
    ...overrides,
  };
}

test("loop：纯文本单轮 → 逐段 assistant_text 后 turn_end(stop)", async () => {
  const llm = createScriptedLlm([{ deltas: ["你", "好"] }]);
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry(), { emit }),
  );

  assert.deepEqual(eventTypes(events), ["assistant_text", "assistant_text", "turn_end"]);
  const last = events[events.length - 1];
  assert.ok(last !== undefined && last.type === "turn_end");
  assert.equal(last.reason, "stop");
  assert.equal(result.stopReason, "stop");
  assert.equal(result.steps, 1);
  assert.equal(result.toolCallCount, 0);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["system", "user", "assistant"],
  );
  const assistant = result.messages[2];
  assert.ok(assistant !== undefined && assistant.role === "assistant");
  assert.equal(assistant.content, "你好");
  assert.deepEqual(assistant.toolCalls, []);
  assert.equal(llm.calls.length, 1);
});

test("loop：先工具调用再文本 → 事件顺序与 assistant/tool 配对正确", async () => {
  const llm = createScriptedLlm([
    { toolCalls: [toolCall("call_1", "echo", { text: "hi" })] },
    { content: "完成" },
  ]);
  const registry = new ToolRegistry([createEchoTool()]);
  const { events, emit } = collectEvents();

  const result = await runAgent(baseOptions(llm, registry, { emit }));

  assert.deepEqual(eventTypes(events), [
    "tool_start",
    "tool_end",
    "assistant_text",
    "turn_end",
  ]);
  const start = events[0];
  assert.ok(start !== undefined && start.type === "tool_start");
  assert.equal(start.call.id, "call_1");
  assert.deepEqual(start.args, { text: "hi" });
  const end = events[1];
  assert.ok(end !== undefined && end.type === "tool_end");
  assert.equal(end.result.ok, true);
  assert.equal(end.result.output, "echo:hi");
  assert.ok(end.durationMs >= 0);

  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool", "assistant"],
  );
  const toolMessage = result.messages[3];
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.equal(toolMessage.toolCallId, "call_1");
  assert.equal(toolMessage.content, "echo:hi");
  assert.equal(result.steps, 2);
  assert.equal(result.toolCallCount, 1);
  assert.equal(result.stopReason, "stop");
});

test("loop：一轮多个工具调用按顺序发事件并一一配对", async () => {
  const llm = createScriptedLlm([
    {
      toolCalls: [
        toolCall("call_a", "echo", { text: "a" }),
        toolCall("call_b", "echo", { text: "b" }),
      ],
    },
    { content: "都做完了" },
  ]);
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([createEchoTool()]), { emit }),
  );

  assert.deepEqual(eventTypes(events), [
    "tool_start",
    "tool_end",
    "tool_start",
    "tool_end",
    "assistant_text",
    "turn_end",
  ]);
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.equal(toolMessages.length, 2);
  assert.deepEqual(
    toolMessages.map((message) => (message.role === "tool" ? message.toolCallId : "")),
    ["call_a", "call_b"],
  );
  assert.equal(result.toolCallCount, 2);
});

test("loop：达到 maxSteps 发 turn_end(max_steps)，消息仍完整配对", async () => {
  const turns: ScriptedTurn[] = Array.from({ length: 5 }, () => ({
    toolCalls: [toolCall("call_x", "echo", { text: "x" })],
  }));
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(createScriptedLlm(turns), new ToolRegistry([createEchoTool()]), {
      emit,
      maxSteps: 3,
    }),
  );

  assert.equal(result.steps, 3);
  assert.equal(result.toolCallCount, 3);
  assert.equal(result.stopReason, "max_steps");
  assert.equal(result.finishReason, "max_steps");
  const last = events[events.length - 1];
  assert.ok(last !== undefined && last.type === "turn_end");
  assert.equal(last.reason, "max_steps");
  // system + user + 3 轮 assistant/tool = 8 条
  assert.equal(result.messages.length, 8);
});

test("loop：默认 maxSteps 为 30", async () => {
  assert.equal(DEFAULT_MAX_STEPS, 30);
  const turns: ScriptedTurn[] = Array.from({ length: DEFAULT_MAX_STEPS }, () => ({
    toolCalls: [toolCall("call_default", "echo", { text: "x" })],
  }));
  const result = await runAgent(
    baseOptions(createScriptedLlm(turns), new ToolRegistry([createEchoTool()])),
  );
  assert.equal(result.steps, DEFAULT_MAX_STEPS);
  assert.equal(result.stopReason, "max_steps");
});

test("loop：signal 已中止时一次 LLM 都不调用，直接 turn_end(aborted)", async () => {
  const llm = createScriptedLlm([{ content: "不应发生" }]);
  const { events, emit } = collectEvents();
  const controller = new AbortController();
  controller.abort();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry(), { emit, signal: controller.signal }),
  );

  assert.equal(llm.calls.length, 0);
  assert.deepEqual(eventTypes(events), ["turn_end"]);
  const last = events[0];
  assert.ok(last !== undefined && last.type === "turn_end");
  assert.equal(last.reason, "aborted");
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.steps, 0);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["system", "user"],
  );
});

test("loop：工具执行中途中止 → 剩余工具回填中断错误，配对完整且不再下一轮", async () => {
  const controller = new AbortController();
  const seen = { count: 0 };
  const abortingTool: ToolDefinition = {
    name: "echo",
    description: "第一次执行时中止会话。",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    readOnly: true,
    run: async () => {
      seen.count += 1;
      controller.abort();
      return { ok: true, output: "first" };
    },
  };
  const llm = createScriptedLlm([
    {
      toolCalls: [
        toolCall("call_1", "echo", { text: "one" }),
        toolCall("call_2", "echo", { text: "two" }),
      ],
    },
  ]);
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([abortingTool]), {
      emit,
      signal: controller.signal,
    }),
  );

  assert.equal(seen.count, 1, "第二个工具不应再执行");
  assert.equal(llm.calls.length, 1, "abort 后不应再请求 LLM");
  assert.equal(result.stopReason, "aborted");
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.equal(toolMessages.length, 2, "每个 tool_call 都必须有对应 tool 消息");
  const second = toolMessages[1];
  assert.ok(second !== undefined && second.role === "tool");
  assert.match(second.content, /^Error: 用户已中断/);
  const last = events[events.length - 1];
  assert.ok(last !== undefined && last.type === "turn_end");
  assert.equal(last.reason, "aborted");
});

test("loop：LLM 抛 AbortError → 收敛为 turn_end(aborted)，不向上抛", async () => {
  const abortError = Object.assign(new Error("SSE 解析已被中断。"), {
    name: "AbortError",
  });
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(createScriptedLlm([{ error: abortError }]), new ToolRegistry(), { emit }),
  );

  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(eventTypes(events), ["turn_end"]);
  const last = events[0];
  assert.ok(last !== undefined && last.type === "turn_end");
  assert.equal(last.reason, "aborted");
});

test("loop：未知工具与坏 JSON 回填 Error 且循环继续（不崩）", async () => {
  const llm = createScriptedLlm([
    {
      toolCalls: [
        { id: "call_unknown", name: "nope", arguments: "{}" },
        { id: "call_bad", name: "echo", arguments: "{bad json" },
      ],
    },
    { content: "已根据错误调整" },
  ]);
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([createEchoTool()]), { emit }),
  );

  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.equal(toolMessages.length, 2);
  for (const message of toolMessages) {
    assert.ok(message.role === "tool");
    assert.match(message.content, /^Error: /);
    assert.doesNotMatch(message.content, /^Error: Error:/);
  }
  assert.equal(result.stopReason, "stop");
  assert.equal(result.steps, 2);
  assert.equal(events.filter((event) => event.type === "tool_end").length, 2);
});

test("loop：工具 ok:false 且无 Error: 前缀时自动补前缀", async () => {
  const llm = createScriptedLlm([
    { toolCalls: [toolCall("call_flaky", "flaky", {})] },
    { content: "收到失败" },
  ]);
  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([createFlakyTool()])),
  );
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.equal(toolMessage.content, "Error: 磁盘满了");
});

test("loop：gate 拒绝 → 工具不执行，回填拒绝原因", async () => {
  const seen = { count: 0 };
  const llm = createScriptedLlm([
    { toolCalls: [toolCall("call_danger", "echo", { text: "x" })] },
    { content: "换方案" },
  ]);
  const { events, emit } = collectEvents();

  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([createEchoTool(seen)]), {
      emit,
      gate: async () => ({ allow: false, reason: "危险命令 rm -rf" }),
    }),
  );

  assert.equal(seen.count, 0, "被拒绝的工具不应执行");
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.match(toolMessage.content, /权限被拒绝：危险命令 rm -rf/);
  const end = events.find((event) => event.type === "tool_end");
  assert.ok(end !== undefined && end.type === "tool_end");
  assert.equal(end.result.ok, false);
});

test("loop：gate 抛异常按拒绝处理（不中断循环）", async () => {
  const llm = createScriptedLlm([
    { toolCalls: [toolCall("call_gate", "echo", { text: "x" })] },
    { content: "继续" },
  ]);
  const result = await runAgent(
    baseOptions(llm, new ToolRegistry([createEchoTool()]), {
      gate: async () => {
        throw new Error("gate 爆炸");
      },
    }),
  );
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.match(toolMessage.content, /权限检查失败：gate 爆炸/);
  assert.equal(result.stopReason, "stop");
});

test("loop：systemPrompt 归一化到首位，旧 system 被替换且只保留一条", async () => {
  const llm = createScriptedLlm([{ content: "好" }]);
  const result = await runAgent({
    llm,
    tools: new ToolRegistry(),
    workspace: WORKSPACE,
    systemPrompt: "新提示",
    messages: [
      { role: "system", content: "旧提示" },
      { role: "user", content: "hi" },
    ],
  });

  assert.equal(result.messages[0]?.role, "system");
  assert.equal(result.messages[0]?.content, "新提示");
  assert.equal(
    result.messages.filter((message) => message.role === "system").length,
    1,
  );
  assert.equal(llm.calls[0]?.messages[0]?.role, "system");
  assert.equal(llm.calls[0]?.messages[0]?.content, "新提示");
});

test("loop：非流式 provider 不调 onText 时补发 assistant_text 差额", async () => {
  const llm = createScriptedLlm([{ content: "你好" }]);
  const { events, emit } = collectEvents();

  await runAgent(baseOptions(llm, new ToolRegistry(), { emit }));

  const textEvents = events.filter((event) => event.type === "assistant_text");
  assert.equal(textEvents.length, 1);
  const first = textEvents[0];
  assert.ok(first !== undefined && first.type === "assistant_text");
  assert.equal(first.delta, "你好");
});

test("loop：给 LLM 透传 signal 与 registry.specs()", async () => {
  const llm = createScriptedLlm([{ content: "ok" }]);
  const registry = new ToolRegistry([createEchoTool(), createWriteTool()]);
  const controller = new AbortController();

  const result = await runAgent(
    baseOptions(llm, registry, { signal: controller.signal }),
  );

  assert.equal(result.stopReason, "stop");
  const call = llm.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.opts?.signal, controller.signal);
  assert.deepEqual(call.tools, registry.specs());
  assert.equal(call.messages[0]?.role, "system");
});

test("loop：LLM 非中断错误向上抛，由调用方处理", async () => {
  const llm = createScriptedLlm([{ error: new Error("网络爆炸") }]);
  const { events, emit } = collectEvents();

  await assert.rejects(
    Promise.resolve(
      runAgent(baseOptions(llm, new ToolRegistry(), { emit })),
    ),
    /网络爆炸/,
  );
  assert.deepEqual(events, [], "异常路径不应伪造 turn_end");
});

test("loop：emit 缺省时不崩，结果照常返回", async () => {
  const llm = createScriptedLlm([{ content: "安静地返回" }]);
  const result = await runAgent({
    llm,
    tools: new ToolRegistry(),
    workspace: WORKSPACE,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(result.stopReason, "stop");
  assert.equal(result.messages.at(-1)?.role, "assistant");
});

test("loop：createDefaultRegistry 提供 6 个工具且 specs 可发给模型", () => {
  const registry = createDefaultRegistry();
  assert.deepEqual(registry.names(), [
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "bash",
  ]);
  assert.equal(registry.size, 6);
  const specs = registry.specs();
  assert.equal(specs.length, 6);
  for (const spec of specs) {
    assert.equal(spec.type, "function");
    assert.ok(spec.function.name.length > 0);
    assert.ok(spec.function.description.length > 0);
  }
});

test("loop：maxSteps 非法值抛可读错误", async () => {
  await assert.rejects(
    Promise.resolve(
      runAgent({
        llm: createScriptedLlm([{ content: "x" }]),
        tools: new ToolRegistry(),
        workspace: WORKSPACE,
        maxSteps: 0,
      }),
    ),
    /maxSteps 必须是 ≥1 的整数/,
  );
});
