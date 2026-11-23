// 离线 mock LLM 客户端（S0-4）：没有 API key / 网络时也能验证 Agent 两轮链路。
//
// 剧本固定，便于测试断言：
// - 历史里还没有 `role: "tool"` 消息 → 第 1 轮：返回 `read_file` 工具调用（finishReason "tool_calls"）。
// - 历史里已有 `role: "tool"` 消息 → 第 2 轮：返回最终总结文本（finishReason "stop"）。
//
// 不依赖网络、随机数、时间；同一输入永远得到同一输出。
// `onText` 在最终文本时调用一次（S1 接真实流式客户端后改为多段 delta）。

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

function abortedError(): Error {
  const error = new Error("离线 mock 已中断（AbortSignal）。");
  error.name = "AbortError";
  return error;
}

/** 创建离线 mock 客户端；每次调用返回新实例，方便测试并行使用。 */
export function createMockLlmClient(): LlmClient {
  return {
    async chat(messages, _tools, opts?: LlmChatOptions): Promise<LlmChatResult> {
      if (opts?.signal?.aborted === true) {
        throw abortedError();
      }
      if (isMockFirstRound(messages)) {
        return {
          content: MOCK_FIRST_ROUND_TEXT,
          toolCalls: [{ ...MOCK_TOOL_CALL }],
          finishReason: "tool_calls",
        };
      }
      opts?.onText?.(MOCK_FINAL_TEXT);
      return {
        content: MOCK_FINAL_TEXT,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}
