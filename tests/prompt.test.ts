// S1-3 单测：system prompt 文案与「首位且唯一」的归一化。
//
// 纯函数，全部离线。

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemPrompt,
  withSystemPrompt,
  SYSTEM_PROMPT_VERSION,
} from "../src/agent/prompt.js";
import type { Message } from "../src/types.js";

test("buildSystemPrompt：包含身份、工作区与无工具提示", () => {
  const prompt = buildSystemPrompt({ workspace: "D:\\work\\demo" });
  assert.match(prompt, /MewAgent/);
  assert.match(prompt, /D:\\work\\demo/);
  assert.match(prompt, /当前没有可用工具/);
  assert.match(prompt, /不要声称调用了工具/);
});

test("buildSystemPrompt：有工具时列出工具名并禁止编造结果", () => {
  const prompt = buildSystemPrompt({
    workspace: "C:\\ws",
    toolNames: ["read_file", "bash"],
  });
  assert.match(prompt, /read_file、bash/);
  assert.match(prompt, /不要编造工具结果/);
  assert.ok(!prompt.includes("当前没有可用工具"));
});

test("buildSystemPrompt：同一入参输出稳定（便于请求体断言）", () => {
  const options = { workspace: "C:\\ws", toolNames: ["glob"] } as const;
  assert.equal(buildSystemPrompt(options), buildSystemPrompt(options));
  assert.ok(Number.isInteger(SYSTEM_PROMPT_VERSION) && SYSTEM_PROMPT_VERSION >= 1);
});

test("withSystemPrompt：没有 system 时插到首位，且只有一条", () => {
  const messages: Message[] = [{ role: "user", content: "你好" }];
  const result = withSystemPrompt(messages, "SYS");

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { role: "system", content: "SYS" });
  assert.deepEqual(result[1], { role: "user", content: "你好" });
  assert.equal(result.filter((message) => message.role === "system").length, 1);
  assert.deepEqual(messages, [{ role: "user", content: "你好" }], "不修改入参");
});

test("withSystemPrompt：已有相同 system 时不重复", () => {
  const messages: Message[] = [
    { role: "system", content: "SYS" },
    { role: "user", content: "hi" },
  ];
  const result = withSystemPrompt(messages, "SYS");

  assert.equal(result.length, 2);
  assert.equal(result.filter((message) => message.role === "system").length, 1);
});

test("withSystemPrompt：旧 system 被替换，其余消息顺序不变", () => {
  const messages: Message[] = [
    { role: "user", content: "a" },
    { role: "system", content: "OLD" },
    { role: "assistant", content: "b", toolCalls: [] },
  ];
  const result = withSystemPrompt(messages, "NEW");

  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { role: "system", content: "NEW" });
  assert.deepEqual(result.slice(1), [
    { role: "user", content: "a" },
    { role: "assistant", content: "b", toolCalls: [] },
  ]);
});
