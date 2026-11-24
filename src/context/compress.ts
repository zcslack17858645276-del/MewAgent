// S3-4 上下文压缩（§6.7 / §4 S3）
//
// 算法（§6.7）：
// 1. 按"轮"分组：每条 user 开始一轮，直到下一条 user 之前的所有 assistant/tool 属于该轮；
// 2. system 常驻，不计入可丢部分；
// 3. 从最新一轮往前累加，直到超过 budget = contextTokens × budgetRatio；
// 4. 被丢弃的轮次**整体移除**（不留半轮，保证 assistant.toolCalls 与 tool 结果配对）；
// 5. 最新一轮本身就超预算时：保留该轮，但把 tool 内容截到 2000 字符、assistant 内容截到 4000 字符；
// 6. 结果不能以 tool 消息开头（悬空结果会被 API 拒绝）。
//
// 边界（§3.1）：纯函数，不做 I/O、不 console、不 import Ink；loop 在请求前调用。

import type { Message } from "../types.js";
import {
  computeBudgetTokens,
  DEFAULT_CONTEXT_TOKENS,
  estimateMessagesTokens,
} from "./tokens.js";

/** 最新一轮超预算时，tool 消息内容的保留上限（§6.7 第 4 条）。 */
export const MAX_TOOL_CONTENT_CHARS = 2_000;

/** 最新一轮超预算时，assistant 内容（含总结）的保留上限（§6.7 第 4 条）。 */
export const MAX_ASSISTANT_CONTENT_CHARS = 4_000;

/** 截断标记：让模型/用户知道这里被裁剪过。 */
export const TRUNCATED_SUFFIX = "…（已截断）";

/** `compressMessages` 的可选项。 */
export interface CompressOptions {
  /** 上下文窗口 token 数；缺省 {@link DEFAULT_CONTEXT_TOKENS}。 */
  readonly contextTokens?: number;
  /** 预算比例；缺省 0.7。 */
  readonly budgetRatio?: number;
  /** 截断上限覆盖（测试用）。 */
  readonly maxToolContentChars?: number;
  readonly maxAssistantContentChars?: number;
}

/** 压缩结果：既有新消息数组，也有给调试/统计用的数字。 */
export interface CompressResult {
  /** 压缩后的消息（system 在最前、最新轮保留、无悬空 tool）。 */
  readonly messages: Message[];
  /** 被整体丢弃的轮数。 */
  readonly droppedTurns: number;
  /** 保留的轮数。 */
  readonly keptTurns: number;
  /** 压缩前估算 token。 */
  readonly beforeTokens: number;
  /** 压缩后估算 token。 */
  readonly afterTokens: number;
  /** 是否对最新一轮做了内容截断。 */
  readonly truncated: boolean;
}

/**
 * 把消息按"轮"分组（system 单独拎出来）。
 *
 * 第一条 user 之前的 assistant/tool 是历史遗留的孤立消息，归入第一轮（如果没有任何
 * user，则整段非 system 消息算一轮），这样压缩不会凭空造出新的悬空消息。
 */
export function groupIntoTurns(messages: readonly Message[]): {
  readonly system: Message[];
  readonly turns: readonly (readonly Message[])[];
} {
  const system: Message[] = [];
  const turns: Message[][] = [];
  let current: Message[] | null = null;
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message);
      continue;
    }
    if (message.role === "user" || current === null) {
      current = [message];
      turns.push(current);
      continue;
    }
    current.push(message);
  }
  return { system, turns };
}

/** 按码点截断文本（不切坏代理对），超限时追加截断标记。 */
function truncateText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join("")}${TRUNCATED_SUFFIX}`;
}

/** 复制一条消息，避免压缩改动调用方的历史对象。 */
function cloneMessage(message: Message): Message {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      toolCalls: message.toolCalls.map((call) => ({ ...call })),
    };
  }
  return { ...message };
}

/** 截断"最新一轮"里的 assistant/tool 内容（§6.7 第 4 条）。 */
function truncateTurn(
  turn: readonly Message[],
  options: CompressOptions,
): { readonly messages: Message[]; readonly changed: boolean } {
  const maxTool = options.maxToolContentChars ?? MAX_TOOL_CONTENT_CHARS;
  const maxAssistant = options.maxAssistantContentChars ?? MAX_ASSISTANT_CONTENT_CHARS;
  let changed = false;
  const messages = turn.map((message): Message => {
    if (message.role === "assistant" && message.content.length > maxAssistant) {
      changed = true;
      return { ...message, content: truncateText(message.content, maxAssistant) };
    }
    if (message.role === "tool" && message.content.length > maxTool) {
      changed = true;
      return { ...message, content: truncateText(message.content, maxTool) };
    }
    return cloneMessage(message);
  });
  return { messages, changed };
}

/**
 * 按轮压缩消息历史（纯函数）。
 *
 * 注意：返回的 `messages` 是新数组；调用方可以把它发给 LLM，同时保留完整历史用于
 * 会话持久化（session 存全量，不存压缩版）。
 */
export function compressMessages(
  messages: readonly Message[],
  options: CompressOptions = {},
): CompressResult {
  const contextTokens = options.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  const budget = computeBudgetTokens(contextTokens, options.budgetRatio);
  const beforeTokens = estimateMessagesTokens(messages);
  const { system, turns } = groupIntoTurns(messages);
  const systemTokens = estimateMessagesTokens(system);

  if (turns.length === 0) {
    const kept = system.map(cloneMessage);
    return {
      messages: kept,
      droppedTurns: 0,
      keptTurns: 0,
      beforeTokens,
      afterTokens: estimateMessagesTokens(kept),
      truncated: false,
    };
  }

  // 最新一轮必须保留，所以它无条件计入 used（即使已超预算）。
  const latestTurnIndex = turns.length - 1;
  const latestTurn = turns[latestTurnIndex]!;
  let used = systemTokens + estimateMessagesTokens(latestTurn);
  let firstKept = latestTurnIndex;
  for (let index = latestTurnIndex - 1; index >= 0; index -= 1) {
    const turnTokens = estimateMessagesTokens(turns[index]!);
    if (used + turnTokens > budget) {
      break;
    }
    used += turnTokens;
    firstKept = index;
  }

  const keptTurns = turns.slice(firstKept).map((turn) => turn.map(cloneMessage));
  let truncated = false;

  // 最新一轮自己就超预算：保留，但截断其中的长工具输出/长 assistant 文本。
  const latestKept = keptTurns[keptTurns.length - 1]!;
  if (estimateMessagesTokens(latestKept) > Math.max(0, budget - systemTokens)) {
    const result = truncateTurn(latestKept, options);
    if (result.changed) {
      keptTurns[keptTurns.length - 1] = result.messages;
      truncated = true;
    }
  }

  // system 一定在最前；其后若出现悬空 tool（孤立历史），直接丢掉，避免 API 400。
  const resultMessages: Message[] = system.map(cloneMessage);
  for (const turn of keptTurns) {
    for (const message of turn) {
      resultMessages.push(cloneMessage(message));
    }
  }
  while (system.length < resultMessages.length && resultMessages[system.length]!.role === "tool") {
    resultMessages.splice(system.length, 1);
  }

  return {
    messages: resultMessages,
    droppedTurns: turns.length - keptTurns.length,
    keptTurns: keptTurns.length,
    beforeTokens,
    afterTokens: estimateMessagesTokens(resultMessages),
    truncated,
  };
}
