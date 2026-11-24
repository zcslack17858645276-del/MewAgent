import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_ASSISTANT_CONTENT_CHARS,
  MAX_TOOL_CONTENT_CHARS,
  TRUNCATED_SUFFIX,
  compressMessages,
  groupIntoTurns,
} from "../src/context/compress.js";
import {
  CHARS_PER_TOKEN_OTHER,
  DEFAULT_BUDGET_RATIO,
  MESSAGE_OVERHEAD_TOKENS,
  TOKENS_PER_CJK_CHAR,
  computeBudgetTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
} from "../src/context/tokens.js";
import type { Message } from "../src/types.js";

const SYSTEM: Message = { role: "system", content: "sys" };

function chatPair(userContent: string, answer = "ok"): Message[] {
  return [
    { role: "user", content: userContent },
    { role: "assistant", content: answer, toolCalls: [] },
  ];
}

function charCount(text: string): number {
  return Array.from(text).length;
}

// ---------------------------------------------------------------- tokens.ts

test("tokens：ASCII 按 4 字符/token 估算并向上取整", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("a"), 1);
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("abcde"), 2);
  assert.equal(estimateTextTokens("abcdefgh"), 2);
  assert.equal(CHARS_PER_TOKEN_OTHER, 4);
});

test("tokens：CJK 按 1.1 token/字估算（中文不低估）", () => {
  assert.equal(estimateTextTokens("你"), Math.ceil(TOKENS_PER_CJK_CHAR));
  assert.equal(estimateTextTokens("你好"), 3); // ceil(2.2)
  assert.equal(estimateTextTokens("你好世界"), 5); // ceil(4.4)
  // 混合：1 个 CJK + 4 个 ASCII = ceil(1.1 + 1) = 3
  assert.equal(estimateTextTokens("你abcd"), 3);
});

test("tokens：emoji 按码点计数，不会因代理对翻倍", () => {
  // 单个 emoji 是 1 个码点 → 其他字符 1/4 → 向上取整 1
  assert.equal(estimateTextTokens("😀"), 1);
});

test("tokens：每条消息有 +8 协议开销，tool 消息同样计", () => {
  assert.equal(MESSAGE_OVERHEAD_TOKENS, 8);
  assert.equal(estimateMessageTokens({ role: "user", content: "abcd" }), 9);
  assert.equal(
    estimateMessageTokens({ role: "tool", toolCallId: "call_1", content: "abcd" }),
    9,
  );
});

test("tokens：assistant 的 tool_calls（id/name/arguments）计入 token", () => {
  const withoutCalls = estimateMessageTokens({
    role: "assistant",
    content: "abcd",
    toolCalls: [],
  });
  const withCall = estimateMessageTokens({
    role: "assistant",
    content: "abcd",
    toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' }],
  });
  assert.ok(withCall > withoutCalls);
  // 拆开验证：8（开销）+ 1（content abcd）+ 2（call_1）+ 3（read_file）+ 4（arguments）= 18
  assert.equal(withCall, 8 + 1 + 2 + 3 + 4);
});

test("tokens：预算 = contextTokens × 0.7（向下取整，非法输入返回 0）", () => {
  assert.equal(DEFAULT_BUDGET_RATIO, 0.7);
  assert.equal(computeBudgetTokens(1000), 700);
  assert.equal(computeBudgetTokens(1000, 0.5), 500);
  assert.equal(computeBudgetTokens(0), 0);
  assert.equal(computeBudgetTokens(Number.NaN), 0);
  assert.equal(computeBudgetTokens(-1), 0);
});

test("tokens：estimateMessagesTokens 累加整段历史", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "user", content: "abcd" },
    { role: "assistant", content: "abcd", toolCalls: [] },
  ];
  assert.equal(estimateMessagesTokens(messages), 9 + 9 + 9);
});

// ---------------------------------------------------------------- grouping

test("compress：按 user 分轮，system 单独拎出、assistant/tool 归属所在轮", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "user", content: "u1" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }] },
    { role: "tool", toolCallId: "c1", content: "result" },
    { role: "assistant", content: "done", toolCalls: [] },
    { role: "user", content: "u2" },
    { role: "assistant", content: "done2", toolCalls: [] },
  ];
  const { system, turns } = groupIntoTurns(messages);
  assert.equal(system.length, 1);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]!.length, 4);
  assert.equal(turns[1]!.length, 2);
});

test("compress：没有 user 时整段非 system 消息算一轮（不造悬空消息）", () => {
  const { system, turns } = groupIntoTurns([
    { role: "assistant", content: "hi", toolCalls: [] },
    { role: "tool", toolCallId: "c1", content: "x" },
  ]);
  assert.equal(system.length, 0);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.length, 2);
});

// ---------------------------------------------------------------- compress

test("compress：未超预算时原样保留（不丢轮、不截断）", () => {
  const messages: Message[] = [SYSTEM, ...chatPair("u1", "a1"), ...chatPair("u2", "a2")];
  const result = compressMessages(messages, { contextTokens: 10_000 });
  assert.deepEqual(result.messages, messages);
  assert.equal(result.droppedTurns, 0);
  assert.equal(result.keptTurns, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.beforeTokens, result.afterTokens);
});

test("compress：3 轮超预算 → system 保留、最新轮保留、旧轮整轮丢弃", () => {
  const long = "a".repeat(400); // 116 token（含 +8）
  const messages: Message[] = [
    SYSTEM, // 9
    { role: "user", content: long }, // 108
    { role: "assistant", content: "ok1", toolCalls: [] }, // 9
    { role: "user", content: "b".repeat(400) }, // 108
    { role: "assistant", content: "ok2", toolCalls: [] }, // 9
    { role: "user", content: "latest" }, // 10
    { role: "assistant", content: "final", toolCalls: [] }, // 10
  ];
  const result = compressMessages(messages, { contextTokens: 300 }); // budget 210
  assert.equal(result.messages[0]!.role, "system");
  assert.equal(result.droppedTurns, 1);
  assert.equal(result.keptTurns, 2);
  // 最新一轮完整保留
  const last = result.messages[result.messages.length - 1]!;
  assert.equal(last.role, "assistant");
  assert.equal(last.content, "final");
  // 第一轮被整体移除（它的 user 不再出现）
  assert.ok(!result.messages.some((message) => message.content === long));
  assert.ok(result.afterTokens <= result.beforeTokens);
});

test("compress：最新一轮自己就超预算 → 保留但截断 assistant 内容到 4000 字符", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "user", content: "go" },
    { role: "assistant", content: "y".repeat(MAX_ASSISTANT_CONTENT_CHARS + 5000), toolCalls: [] },
  ];
  const result = compressMessages(messages, { contextTokens: 100 }); // budget 70
  assert.equal(result.truncated, true);
  const assistant = result.messages.find((message) => message.role === "assistant");
  assert.ok(assistant !== undefined && assistant.role === "assistant");
  assert.ok(charCount(assistant.content) <= MAX_ASSISTANT_CONTENT_CHARS + charCount(TRUNCATED_SUFFIX));
  assert.ok(assistant.content.endsWith(TRUNCATED_SUFFIX));
  // 最新一轮仍在（user + assistant）
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["system", "user", "assistant"],
  );
});

test("compress：最新一轮的工具输出超长 → 截断到 2000 字符（保留配对）", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "user", content: "run" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_long", name: "bash", arguments: "{}" }],
    },
    {
      role: "tool",
      toolCallId: "call_long",
      content: "x".repeat(MAX_TOOL_CONTENT_CHARS + 3000),
    },
    { role: "assistant", content: "done", toolCalls: [] },
  ];
  const result = compressMessages(messages, { contextTokens: 100 });
  assert.equal(result.truncated, true);
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.ok(charCount(toolMessage.content) <= MAX_TOOL_CONTENT_CHARS + charCount(TRUNCATED_SUFFIX));
  assert.ok(toolMessage.content.endsWith(TRUNCATED_SUFFIX));
  // 配对完整：assistant 的 tool_calls 与 tool 消息都在
  assert.ok(result.messages.some((message) => message.role === "assistant" && message.toolCalls.length === 1));
  assert.equal(toolMessage.toolCallId, "call_long");
});

test("compress：结果不会以 tool 消息开头（悬空结果被丢弃）", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "tool", toolCallId: "orphan", content: "dangling result" },
  ];
  const result = compressMessages(messages, { contextTokens: 10_000 });
  assert.equal(result.messages[0]!.role, "system");
  assert.ok(!result.messages.some((message) => message.role === "tool"));
});

test("compress：多条 system 全部常驻且保持顺序（不计入可丢部分）", () => {
  const messages: Message[] = [
    { role: "system", content: "s1" },
    { role: "system", content: "s2" },
    { role: "user", content: "a".repeat(400) },
    { role: "assistant", content: "ok", toolCalls: [] },
    { role: "user", content: "latest" },
    { role: "assistant", content: "final", toolCalls: [] },
  ];
  const result = compressMessages(messages, { contextTokens: 200 }); // budget 140
  assert.deepEqual(
    result.messages.slice(0, 2).map((message) => message.content),
    ["s1", "s2"],
  );
  // 最新一轮仍在
  assert.equal(result.messages[result.messages.length - 1]!.content, "final");
});

test("compress：空历史与只有 system 的边界", () => {
  const empty = compressMessages([], { contextTokens: 100 });
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.keptTurns, 0);

  const systemOnly = compressMessages([SYSTEM], { contextTokens: 100 });
  assert.deepEqual(systemOnly.messages, [SYSTEM]);
  assert.equal(systemOnly.droppedTurns, 0);
});

test("compress：截断上限可通过选项覆盖（测试友好）", () => {
  const messages: Message[] = [
    SYSTEM,
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "z".repeat(200),
      toolCalls: [{ id: "c1", name: "bash", arguments: "{}" }],
    },
    { role: "tool", toolCallId: "c1", content: "q".repeat(200) },
  ];
  const result = compressMessages(messages, {
    contextTokens: 50,
    maxAssistantContentChars: 20,
    maxToolContentChars: 10,
  });
  const assistant = result.messages.find((message) => message.role === "assistant");
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.ok(assistant !== undefined && assistant.role === "assistant");
  assert.ok(toolMessage !== undefined && toolMessage.role === "tool");
  assert.ok(charCount(assistant.content) <= 20 + charCount(TRUNCATED_SUFFIX));
  assert.ok(charCount(toolMessage.content) <= 10 + charCount(TRUNCATED_SUFFIX));
});
