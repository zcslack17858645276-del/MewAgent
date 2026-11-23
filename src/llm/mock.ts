// 离线 mock LLM 客户端（S0-4）：没有 API key / 网络时也能验证 Agent 两轮链路。
//
// 剧本固定，便于测试断言：
// - 历史里还没有 `role: "tool"` 消息 → 第 1 轮：返回 `read_file` 工具调用（finishReason "tool_calls"）。
// - 历史里已有 `role: "tool"` 消息 → 第 2 轮：返回最终总结文本（finishReason "stop"）。
//
// 不依赖网络、随机数、时间；同一输入永远得到同一输出。
// `onText` 默认在最终文本时调用一次；设置 `chunkDelayMs` 后改为按块慢速流式发出
// （给多行输入 / 生成中中断等手工验收用；默认 0 保持测试确定性）。

import type { LlmChatOptions, LlmChatResult, LlmClient, Message, ToolCall } from "../types.js";

export const MOCK_TOOL_CALL_ID = "call_mock_read_file_1";
export const MOCK_TOOL_NAME = "read_file";
export const MOCK_TOOL_ARGUMENTS = '{"path":"README.md"}';

/** 第 1 轮剧本的文本内容（只发起工具调用，不输出文本）。 */
export const MOCK_FIRST_ROUND_TEXT = "";
/** 第 2 轮剧本的最终文本。 */
export const MOCK_FINAL_TEXT =
  "你好！我是 MewAgent 的离线 mock。两轮链路已跑通：第一轮我请求调用 read_file，第二轮收到工具结果后给出这段总结。真实工具执行在 S2 接入。";

/** 第 1 轮固定返回的工具调用。 */
export const MOCK_TOOL_CALL: ToolCall = {
  id: MOCK_TOOL_CALL_ID,
  name: MOCK_TOOL_NAME,
  arguments: MOCK_TOOL_ARGUMENTS,
};

/** 第一轮剧本判定：历史里还没有工具结果，就返回工具调用。 */
export function isMockFirstRound(messages: readonly Message[]): boolean {
  return !messages.some((message) => message.role === "tool");
}

/** 慢速流式参数：把最终文本按 `chunkSize` 个字符切块，每块间隔 `chunkDelayMs` 毫秒发出。 */
export interface MockStreamingOptions {
  /** 块间延迟（毫秒）；0 或未设置时一次性发出（默认，保持测试确定性）。 */
  chunkDelayMs?: number;
  /** 每块字符数（按码点切，默认 4）。 */
  chunkSize?: number;
}

const DEFAULT_CHUNK_SIZE = 4;

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

/** 按码点切块，避免把代理对/emoji 切坏。 */
function splitIntoChunks(text: string, chunkSize: number): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += chunkSize) {
    chunks.push(characters.slice(index, index + chunkSize).join(""));
  }
  return chunks;
}

function abortedError(): Error {
  const error = new Error("离线 mock 已中断（AbortSignal）。");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortedError();
  }
}

/** 创建离线 mock 客户端；每次调用返回新实例，方便测试并行使用。 */
export function createMockLlmClient(
  streaming: MockStreamingOptions = {},
): LlmClient {
  const delayMs = Math.max(0, Math.floor(streaming.chunkDelayMs ?? 0));
  const chunkSize = Math.max(1, Math.floor(streaming.chunkSize ?? DEFAULT_CHUNK_SIZE));

  return {
    async chat(messages, _tools, opts?: LlmChatOptions): Promise<LlmChatResult> {
      throwIfAborted(opts?.signal);
      if (isMockFirstRound(messages)) {
        return {
          content: MOCK_FIRST_ROUND_TEXT,
          toolCalls: [{ ...MOCK_TOOL_CALL }],
          finishReason: "tool_calls",
        };
      }

      if (delayMs === 0) {
        opts?.onText?.(MOCK_FINAL_TEXT);
        return {
          content: MOCK_FINAL_TEXT,
          toolCalls: [],
          finishReason: "stop",
        };
      }

      // 慢速流式：逐块发出，每块之间等待并由 AbortSignal 中断（生成中 Esc 用）。
      let content = "";
      for (const chunk of splitIntoChunks(MOCK_FINAL_TEXT, chunkSize)) {
        throwIfAborted(opts?.signal);
        await sleep(delayMs);
        throwIfAborted(opts?.signal);
        content += chunk;
        opts?.onText?.(chunk);
      }
      return {
        content,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}
