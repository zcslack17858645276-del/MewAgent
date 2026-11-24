// S2-6 Agent Loop：模型 ⇄ 工具 的循环（§3.2 / §6.3）。
//
// 边界（§3.1）：
// - 不 import Ink、不 console.log、不读 stdin；所有对外信息走 `emit(AgentEvent)`；
// - 只依赖契约（LlmClient / ToolRegistry / Gate），不关心 UI 与真实网络；
// - 终止条件是协议层信号：某轮 chat 不返回 tool_call 就结束，不靠关键词（§6.3）。
//
// 事件顺序约定（S2-7 UI 依赖）：
//   每轮：assistant_text*（流式 delta）→ [tool_start → tool_end]* → 下一轮 …
//   结束：turn_end（reason = LLM finishReason / "max_steps" / "aborted"）。
//
// 与 §6.3 伪代码的两处有意偏差（已记录到 HANDOFF §4）：
// 1. 达到 maxSteps 时**不抛异常**，而是发 `turn_end("max_steps")` 后正常返回：
//    UI/headless 需要拿到已产生的消息与事件，抛异常会让调用方丢掉上下文；
// 2. 中断（AbortSignal）同样收敛为 `turn_end("aborted")` 并返回，而不是抛错；
//    只有非中断的 LLM 错误才向上抛，由调用方（UI/headless）负责提示。

import type {
  AgentEvent,
  GateResult,
  LlmChatResult,
  LlmClient,
  Message,
  ToolCall,
  ToolResult,
  ToolRunContext,
} from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { compressMessages } from "../context/compress.js";
import type { CompressResult } from "../context/compress.js";
import { withSystemPrompt } from "./prompt.js";

/** 默认最大步数（§4：单 Agent startLoop maxSteps=30）。 */
export const DEFAULT_MAX_STEPS = 30;

/** loop 结束原因：模型正常结束 / 达到步数上限 / 用户中断。 */
export type AgentStopReason = "stop" | "max_steps" | "aborted";

/** `runAgent` 的入参与依赖注入（测试可塞假 LLM / 假 Gate）。 */
export interface AgentLoopOptions {
  readonly llm: LlmClient;
  readonly tools: ToolRegistry;
  /** 工具与 system prompt 使用的工作区绝对路径。 */
  readonly workspace: string;
  /** 事件回调；缺省为丢弃（纯逻辑测试）。 */
  readonly emit?: (event: AgentEvent) => void;
  /** 传入则归一化到消息首位（旧 system 会被替换，§S1-3）。 */
  readonly systemPrompt?: string;
  /** 历史消息（可含 system；不含本轮新 user 时由调用方自行追加）。 */
  readonly messages?: readonly Message[];
  /** 权限闸；S3 接线。缺省全部放行。 */
  readonly gate?: (call: ToolCall) => Promise<GateResult>;
  /** 步数上限，默认 {@link DEFAULT_MAX_STEPS}。 */
  readonly maxSteps?: number;
  /** Esc 中断：透传给 LLM，并在工具执行前后检查。 */
  readonly signal?: AbortSignal;
  /**
   * 上下文预算（token）；设置后每次请求 LLM 前按轮压缩（S3-4）。
   * 压缩只作用于发给模型的副本，返回值 `messages` 仍是完整历史（供会话持久化）。
   */
  readonly contextTokens?: number;
  /** 每次压缩后的统计回调（调试/提示用）；未设置则不回调。 */
  readonly onCompress?: (info: CompressResult) => void;
}

/** `runAgent` 的返回值：消息历史 + 结束原因，便于调用方持久化/展示。 */
export interface AgentLoopResult {
  readonly messages: Message[];
  readonly stopReason: AgentStopReason;
  /** 最后一次 LLM 的 finishReason（max_steps/aborted 时为同名标记）。 */
  readonly finishReason: string;
  /** 实际执行的 LLM 轮数。 */
  readonly steps: number;
  /** 实际执行的工具调用次数。 */
  readonly toolCallCount: number;
  readonly durationMs: number;
}

/** 工具阶段被中断时的回填内容：既保证 assistant/tool 配对，又让模型知道发生了什么。 */
function abortedToolResult(): ToolResult {
  return {
    ok: false,
    output:
      "Error: 用户已中断本次执行（AbortSignal）。\n" +
      "下一步：如需继续，请重新发送请求；中断前已完成的工具调用结果仍然有效。",
  };
}

/** 识别 AbortError（SSE/OpenAI 客户端与 mock 都用 name === "AbortError"）。 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted|中断/i.test(error.message))
  );
}

/**
 * 读取 aborted 状态。
 *
 * 单独包一层是必要的：TypeScript 会把 `isAborted(options.signal)` 的首次判断
 * 收窄到后续代码（readonly 属性 + 可选链），导致第二次判断报 TS2367；函数调用不参与收窄。
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 tool_call.arguments 用于 `tool_start` 事件；解析失败返回 null（契约约定）。 */
function parseCallArguments(call: ToolCall): Record<string, unknown> | null {
  const raw = typeof call.arguments === "string" ? call.arguments.trim() : "";
  if (raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 回填给模型的 tool 消息内容：失败时保证只有一个 `Error:` 前缀（工具实现可能已带）。 */
function toolContentForModel(result: ToolResult): string {
  if (result.ok) {
    return result.output;
  }
  return /^\s*Error:/i.test(result.output) ? result.output : `Error: ${result.output}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertMaxSteps(maxSteps: number): void {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`maxSteps 必须是 ≥1 的整数（收到 ${String(maxSteps)}）。`);
  }
}

/**
 * 执行一次完整 Agent Loop。
 *
 * 正常结束（stop）或达到上限（max_steps）/ 中断（aborted）都通过 `turn_end` 事件通知；
 * 非中断异常向上抛，由调用方决定如何展示（loop 不 console、不写 UI）。
 */
export async function runAgent(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const startedAt = Date.now();
  const emit = options.emit ?? ((): void => {});
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  assertMaxSteps(maxSteps);

  const history = options.messages ?? [];
  const messages: Message[] =
    options.systemPrompt !== undefined
      ? withSystemPrompt(history, options.systemPrompt)
      : [...history];

  const toolCtx: ToolRunContext = { workspace: options.workspace };
  let toolCallCount = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    if (isAborted(options.signal)) {
      emit({ type: "turn_end", reason: "aborted" });
      return {
        messages,
        stopReason: "aborted",
        finishReason: "aborted",
        steps: step - 1,
        toolCallCount,
        durationMs: Date.now() - startedAt,
      };
    }

    // S3-4：请求前按轮压缩（§3 架构流 L238）。只把压缩副本发给模型，
    // `messages` 保持完整历史——返回给调用方后用于会话持久化/UI 展示。
    let requestMessages: Message[] = messages;
    if (options.contextTokens !== undefined) {
      const compressed = compressMessages(messages, { contextTokens: options.contextTokens });
      requestMessages = compressed.messages;
      options.onCompress?.(compressed);
    }

    let streamed = "";
    let response: LlmChatResult;
    try {
      response = await options.llm.chat(requestMessages, options.tools.specs(), {
        signal: options.signal,
        onText: (delta) => {
          streamed += delta;
          if (delta.length > 0) {
            emit({ type: "assistant_text", delta });
          }
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        emit({ type: "turn_end", reason: "aborted" });
        return {
          messages,
          stopReason: "aborted",
          finishReason: "aborted",
          steps: step,
          toolCallCount,
          durationMs: Date.now() - startedAt,
        };
      }
      throw error;
    }

    // 非流式 provider 可能不调 onText：补发差额，保证 UI 不丢文本；流式时此处为空。
    if (response.content.length > 0 && response.content !== streamed) {
      const suffix = response.content.startsWith(streamed)
        ? response.content.slice(streamed.length)
        : response.content;
      if (suffix.length > 0) {
        emit({ type: "assistant_text", delta: suffix });
      }
    }

    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    if (response.toolCalls.length === 0) {
      const finishReason = response.finishReason === "" ? "stop" : response.finishReason;
      emit({ type: "turn_end", reason: finishReason });
      return {
        messages,
        stopReason: "stop",
        finishReason,
        steps: step,
        toolCallCount,
        durationMs: Date.now() - startedAt,
      };
    }

    for (const call of response.toolCalls) {
      toolCallCount += 1;
      emit({ type: "tool_start", call, args: parseCallArguments(call) });

      const toolStartedAt = Date.now();
      let result: ToolResult;
      if (isAborted(options.signal)) {
        result = abortedToolResult();
      } else {
        let decision: GateResult = { allow: true };
        if (options.gate !== undefined) {
          try {
            decision = await options.gate(call);
          } catch (error) {
            decision = { allow: false, reason: `权限检查失败：${describeError(error)}` };
          }
        }
        if (decision.allow) {
          try {
            result = await options.tools.run(call, toolCtx);
          } catch (error) {
            // registry 承诺不抛；这里兜底只防未来改动破坏契约。
            result = {
              ok: false,
              output: `Error: 工具执行异常：${describeError(error)}\n下一步：这是内部错误，请勿重复相同调用。`,
            };
          }
        } else {
          result = {
            ok: false,
            output: `Error: 权限被拒绝：${decision.reason}\n下一步：换一种用户允许的方式，或先向用户说明需要什么权限。`,
          };
        }
      }

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: toolContentForModel(result),
      });
      emit({
        type: "tool_end",
        call,
        result,
        durationMs: Date.now() - toolStartedAt,
      });
    }

    if (isAborted(options.signal)) {
      emit({ type: "turn_end", reason: "aborted" });
      return {
        messages,
        stopReason: "aborted",
        finishReason: "aborted",
        steps: step,
        toolCallCount,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  emit({ type: "turn_end", reason: "max_steps" });
  return {
    messages,
    stopReason: "max_steps",
    finishReason: "max_steps",
    steps: maxSteps,
    toolCallCount,
    durationMs: Date.now() - startedAt,
  };
}
