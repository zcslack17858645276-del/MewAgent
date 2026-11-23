// S0-4 离线 mock 客户端与“工具调用 → 最终文本”两轮链路的自动化测试。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../src/index.js";
import {
  MOCK_FINAL_TEXT,
  MOCK_FIRST_ROUND_TEXT,
  MOCK_TOOL_ARGUMENTS,
  MOCK_TOOL_CALL_ID,
  MOCK_TOOL_NAME,
  createMockLlmClient,
  isMockFirstRound,
} from "../src/llm/mock.js";
import type { Message } from "../src/types.js";

const USER_MESSAGE: Message = { role: "user", content: "你好" };

/** 模拟第二轮的历史：user → assistant(工具调用) → tool(工具结果)。 */
function toolHistory(): Message[] {
  return [
    USER_MESSAGE,
    {
      role: "assistant",
      content: MOCK_FIRST_ROUND_TEXT,
      toolCalls: [
        {
          id: MOCK_TOOL_CALL_ID,
          name: MOCK_TOOL_NAME,
          arguments: MOCK_TOOL_ARGUMENTS,
        },
      ],
    },
    { role: "tool", toolCallId: MOCK_TOOL_CALL_ID, content: "（占位工具结果）" },
  ];
}

test("mock：第一轮返回 read_file 工具调用（finishReason=tool_calls）", async () => {
  const client = createMockLlmClient();
  const result = await client.chat([USER_MESSAGE], []);
  assert.equal(result.content, MOCK_FIRST_ROUND_TEXT);
  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.toolCalls.length, 1);
  const call = result.toolCalls[0];
  assert.ok(call !== undefined);
  assert.equal(call.id, MOCK_TOOL_CALL_ID);
  assert.equal(call.name, MOCK_TOOL_NAME);
  assert.deepEqual(JSON.parse(call.arguments), { path: "README.md" });
});

test("mock：第二轮（历史含 tool 消息）返回最终文本（finishReason=stop）", async () => {
  const client = createMockLlmClient();
  const result = await client.chat(toolHistory(), []);
  assert.equal(result.content, MOCK_FINAL_TEXT);
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.toolCalls, []);
});

test("mock：isMockFirstRound 只看历史里有没有 tool 消息", () => {
  assert.equal(isMockFirstRound([USER_MESSAGE]), true);
  assert.equal(isMockFirstRound(toolHistory()), false);
});

test("mock：输出确定（同一输入两次调用完全一致）", async () => {
  const first = await createMockLlmClient().chat([USER_MESSAGE], []);
  const second = await createMockLlmClient().chat([USER_MESSAGE], []);
  assert.deepEqual(second, first);
});

test("mock：最终文本通过 onText 回调一次（流式接口形状可用）", async () => {
  const deltas: string[] = [];
  const client = createMockLlmClient();
  await client.chat(toolHistory(), [], {
    onText: (delta) => deltas.push(delta),
  });
  assert.equal(deltas.join(""), MOCK_FINAL_TEXT);
});

test("mock：AbortSignal 已中断时拒绝（AbortError）", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createMockLlmClient();
  await assert.rejects(
    () => client.chat([USER_MESSAGE], [], { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

async function runCli(
  argv: readonly string[],
  options: RunOptions,
): Promise<{ code: number; out: string; err: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    cwd: options.cwd,
    env: options.env ?? {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    write: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    loadDotEnv: () => {},
  });
  return { code, out: stdout, err: stderr };
}

test("main：--mock --print 走完两轮（工具调用 → 最终文本）", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mewagent-mock-"));
  try {
    const result = await runCli(["--mock", "--print", "你好"], { cwd });
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(result.out.includes("--- 第 1 轮：模型 → 工具调用 ---"));
    assert.ok(
      result.out.includes(`tool_call: ${MOCK_TOOL_NAME} ${MOCK_TOOL_ARGUMENTS}`),
    );
    assert.ok(result.out.includes("--- 第 2 轮：模型 → 最终文本 ---"));
    assert.ok(result.out.includes(MOCK_FINAL_TEXT));
    assert.ok(result.out.includes("finish: stop"));
    // 两轮输出可区分，且不夹带旧骨架/错误噪音。
    assert.ok(!result.out.includes("S0-3 骨架"));
    assert.ok(!result.out.includes("Error:"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("main：非 mock 的 --print 仍是 S1 占位，不跑两轮", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mewagent-nomock-"));
  try {
    const result = await runCli(["--print", "hi"], {
      cwd,
      env: { MEWCODE_API_KEY: "sk-test", MEWCODE_MODEL: "deepseek-chat" },
    });
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(result.out.includes("真实 API 将在 S1 接入"));
    assert.ok(!result.out.includes("第 1 轮"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
