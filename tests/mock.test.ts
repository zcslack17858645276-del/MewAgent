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
import type { FetchLike } from "../src/llm/openai.js";
import type { StartTuiOptions } from "../src/ui/start-tui.js";
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

test("mock：chunkDelayMs 时把最终文本按块流式发出", async () => {
  const deltas: string[] = [];
  const client = createMockLlmClient({ chunkDelayMs: 1, chunkSize: 8 });
  const result = await client.chat(toolHistory(), [], {
    onText: (delta) => deltas.push(delta),
  });
  assert.equal(result.content, MOCK_FINAL_TEXT);
  assert.ok(deltas.length > 1, "应当分多块发出");
  assert.equal(deltas.join(""), MOCK_FINAL_TEXT);
  for (const delta of deltas) {
    assert.ok(Array.from(delta).length <= 8, "每块不超过 chunkSize 个码点");
  }
});

test("mock：慢速流式中途 abort → AbortError，已发出的前缀保留", async () => {
  const controller = new AbortController();
  const deltas: string[] = [];
  const client = createMockLlmClient({ chunkDelayMs: 1, chunkSize: 8 });
  await assert.rejects(
    () =>
      client.chat(toolHistory(), [], {
        signal: controller.signal,
        onText: (delta) => {
          deltas.push(delta);
          controller.abort();
        },
      }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(deltas.length, 1);
  assert.ok(MOCK_FINAL_TEXT.startsWith(deltas.join("")));
});

interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  startTui?: (options: StartTuiOptions) => Promise<void>;
  fetchImpl?: FetchLike;
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
    startTui: options.startTui ?? (async () => {}),
    fetchImpl: options.fetchImpl,
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

test("main：非 mock 的 --print 走真实 API 单轮流式（假 fetch，不跑两轮）", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mewagent-nomock-"));
  try {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"收"}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"到"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body,
      text: async () => "",
    });

    const result = await runCli(["--print", "hi"], {
      cwd,
      env: { MEWCODE_API_KEY: "sk-test", MEWCODE_MODEL: "deepseek-chat" },
      fetchImpl,
    });
    assert.equal(result.code, 0);
    assert.equal(result.out, "收到\n", "headless 真实路径只输出模型文本");
    assert.ok(!result.out.includes("第 1 轮"), "真实路径不应跑 mock 两轮剧本");
    assert.match(result.err, /headless · model: deepseek-chat/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("main：MEWCODE_MOCK_DELAY_MS 让交互 TUI 的 mock 回复按块流式", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "mewagent-mock-stream-"));
  try {
    let captured: StartTuiOptions | undefined;
    const result = await runCli(["--mock"], {
      cwd,
      env: { MEWCODE_MOCK_DELAY_MS: "1" },
      startTui: async (options) => {
        captured = options;
      },
    });
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(captured !== undefined);

    const deltas: string[] = [];
    const reply = await captured.send([USER_MESSAGE], {
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });
    assert.equal(reply.content, MOCK_FINAL_TEXT);
    assert.ok(deltas.length > 1, "环境变量应让 mock 分多块输出");
    assert.equal(deltas.join(""), MOCK_FINAL_TEXT);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
