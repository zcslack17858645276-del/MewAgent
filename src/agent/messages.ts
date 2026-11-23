// S1-3 消息转换：内部 `Message[]` 与 OpenAI chat/completions 线上格式之间的纯数据转换。
//
// 边界（方案 §3.1）：agent 层不 import Ink、不读 stdin、不 console.log；
// 本文件只做数据形状转换，便于单测与 S2 的 Agent Loop 复用。

import type { LlmChatResult, Message } from "../types.js";

/** 线上协议里的 message 形状（只覆盖本项目会发的字段）。 */
export type ApiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ApiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** 线上协议里的 tool_calls 元素；注意 `arguments` 是 JSON 字符串而不是对象。 */
export interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * 把内部 `Message[]` 转成 OpenAI chat/completions 的线上格式。
 *
 * assistant 的 `toolCalls` 要转成 `tool_calls[{id,type:"function",function:{...}}]`，
 * tool 消息要带 `tool_call_id`；否则供应商会拒绝整个历史（消息配对错误）。
 */
export function toApiMessages(messages: readonly Message[]): ApiMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      if (message.toolCalls.length === 0) {
        return { role: "assistant", content: message.content };
      }
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * 反向转换：把一次 `LlmClient.chat` 的结果转成内部 assistant 消息。
 *
 * 流式增量由 llm 层负责聚合，这里只做「结果 → 历史」这一跳；S2 的 loop 会用它追加历史。
 */
export function toAssistantMessage(result: LlmChatResult): Message {
  return { role: "assistant", content: result.content, toolCalls: result.toolCalls };
}
