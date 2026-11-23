// S1-3 单测：`Message[]` → OpenAI chat/completions 线上格式（角色、tool_call_id、assistant.tool_calls 配对）。
//
// 纯数据转换，全部离线；不联网、不 import Ink。

import test from "node:test";
import assert from "node:assert/strict";

import { toApiMessages, toAssistantMessage } from "../src/agent/messages.js";
import type { LlmChatResult, Message, ToolCall } from "../src/types.js";

const readCall: ToolCall = {
  id: "call_1",
  name: "read_file",
  arguments: '{"path":"README.md"}',
};

test("toApiMessages：四类消息按原顺序转成线上格式", () => {
  const messages: Message[] = [
    { role: "system", content: "你是助手" },
    { role: "user", content: "读一下 README" },
    { role: "assistant", content: "", toolCalls: [readCall] },
    { role: "tool", toolCallId: "call_1", content: "README 内容" },
  ];

  const wire = toApiMessages(messages);
  assert.equal(wire.length, 4);
  assert.deepEqual(wire[0], { role: "system", content: "你是助手" });
  assert.deepEqual(wire[1], { role: "user", content: "读一下 README" });
  assert.deepEqual(wire[2], {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"README.md"}' },
      },
    ],
  });
  assert.deepEqual(wire[3], { role: "tool", tool_call_id: "call_1", content: "README 内容" });
});

test("toApiMessages：assistant 没有 toolCalls 时不带 tool_calls 字段", () => {
  const [wire] = toApiMessages([{ role: "assistant", content: "直接回答", toolCalls: [] }]);
  assert.deepEqual(wire, { role: "assistant", content: "直接回答" });
  assert.equal(Object.hasOwn(wire as object, "tool_calls"), false);
});

test("toApiMessages：tool 消息带 tool_call_id，字段不多不少", () => {
  const [wire] = toApiMessages([{ role: "tool", toolCallId: "call_abc", content: "ok" }]);
  assert.deepEqual(wire, { role: "tool", tool_call_id: "call_abc", content: "ok" });
});

test("toApiMessages：空数组返回空数组，且不修改入参", () => {
  assert.deepEqual(toApiMessages([]), []);

  const messages: Message[] = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "", toolCalls: [readCall] },
  ];
  const snapshot = structuredClone(messages);
  toApiMessages(messages);
  assert.deepEqual(messages, snapshot);
});

test("toAssistantMessage：tool_calls 结果转成内部 assistant 消息", () => {
  const result: LlmChatResult = { content: "", toolCalls: [readCall], finishReason: "tool_calls" };
  assert.deepEqual(toAssistantMessage(result), {
    role: "assistant",
    content: "",
    toolCalls: [readCall],
  });
});

test("toAssistantMessage：纯文本结果保留 content 与空 toolCalls", () => {
  const result: LlmChatResult = { content: "你好", toolCalls: [], finishReason: "stop" };
  assert.deepEqual(toAssistantMessage(result), {
    role: "assistant",
    content: "你好",
    toolCalls: [],
  });
});
