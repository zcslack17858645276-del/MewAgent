// S3-4 Token 估算与预算（§6.7 / §4 S3）
//
// 目的：给"上下文压缩"一把**便宜的尺子**。这里不做真实分词（供应商 tokenizer 不公开、
// 引入 tiktoken 会新增依赖且不准），只做"足够接近、宁可高估"的字符级估算：
// - CJK 字符（汉字/假名/谚文/全角标点）≈ 1.1 token/字；
// - 其他字符 ≈ 1/4 token/字符；
// - 每条消息固定 +8（role、分隔符等协议开销）；
// - assistant 的 tool_calls 按 id/name/arguments 字符串计入（arguments 是原始 JSON）。
//
// 边界：这是**保险丝**不是计费器（§6.7）。预算按 contextTokens × 0.7 留余量，
// 真实 400 时调用方可以调小 ratio 或提前压缩。

import type { Message } from "../types.js";

/** 默认上下文窗口（DeepSeek V3.x 128K；可用 MEWCODE_CONTEXT_TOKENS 覆盖）。 */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/** 默认预算比例：只用上下文的 70%，给回复与工具声明留余量（§6.7）。 */
export const DEFAULT_BUDGET_RATIO = 0.7;

/** CJK 字符的 token 当量（§6.7：≈ 1.1 token/字）。 */
export const TOKENS_PER_CJK_CHAR = 1.1;

/** 其他字符的 token 当量倒数（§6.7：≈ 4 字符/token）。 */
export const CHARS_PER_TOKEN_OTHER = 4;

/** 每条消息的协议开销（§6.7：+8）。 */
export const MESSAGE_OVERHEAD_TOKENS = 8;

/**
 * 是否按 CJK 计权。
 *
 * 覆盖范围比"汉字"宽（假名/谚文/全角符号都是中文混排里的常见成本），
 * 这样中文界面/中文回答不会被低估。
 */
function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK 部首、假名、统一表意
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // 谚文
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // 兼容表意
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // 兼容标点
    (codePoint >= 0xff00 && codePoint <= 0xffef) || // 全角字符
    (codePoint >= 0x3000 && codePoint <= 0x303f) || // CJK 标点
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // 扩展 B 及以上
  );
}

/**
 * 估算文本 token 数（向上取整：宁可高估，早一点压缩比 400 好）。
 *
 * 按码点遍历，避免把代理对当成两个"其他字符"。
 */
export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isCjkCodePoint(codePoint)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk * TOKENS_PER_CJK_CHAR + other / CHARS_PER_TOKEN_OTHER);
}

/** 估算单条消息的 token 数（含协议开销与 tool_calls 的 JSON）。 */
export function estimateMessageTokens(message: Message): number {
  if (message.role === "assistant") {
    let total = MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
    for (const call of message.toolCalls) {
      total +=
        estimateTextTokens(call.id) +
        estimateTextTokens(call.name) +
        estimateTextTokens(call.arguments);
    }
    return total;
  }
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
}

/** 估算一整段消息历史的 token 总数。 */
export function estimateMessagesTokens(messages: readonly Message[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }
  return total;
}

/**
 * 计算可用的 token 预算：contextTokens × budgetRatio。
 *
 * 非法输入（NaN/<=0）返回 0，表示"没有可用预算"——压缩层仍会保留最新一轮，
 * 避免把"配置写错"变成"清空上下文"。
 */
export function computeBudgetTokens(
  contextTokens: number,
  budgetRatio: number = DEFAULT_BUDGET_RATIO,
): number {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) {
    return 0;
  }
  const ratio =
    Number.isFinite(budgetRatio) && budgetRatio > 0 ? budgetRatio : DEFAULT_BUDGET_RATIO;
  return Math.max(1, Math.floor(contextTokens * ratio));
}
