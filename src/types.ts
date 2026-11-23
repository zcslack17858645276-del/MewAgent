/**
 * MewAgent 核心契约（S0-2）
 *
 * 来源：`MewCode-TS实施方案.md` §3.3（合同；实现阶段不得顺手改）。
 * 边界（§3.1）：types.ts 只放类型，不放实现、不做 I/O、不 import 任何运行时模块；
 * UI 只消费 AgentEvent；Loop 不 import Ink；工具只依赖 ToolRunContext。
 *
 * 约束：
 * - 字段形状与 §3.3 完全一致；§3.3 里内联的对象类型在此提取为具名别名
 *   （ToolRunContext / LlmChatOptions / LlmChatResult），不新增/删除字段。
 * - 禁止类型逃逸：校验过的数据用精确结构，不确定的外部数据用 `unknown`，
 *   不允许用宽泛的顶层类型蒙混过关。
 * - 错误统一走 ToolResult.output（以 "Error:" 开头），保证模型能看到失败原因。
 */

/** 一次会话中的消息；持久化、发给模型、回填工具结果都用同一份结构。 */
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** 模型发起的一次工具调用。 */
export interface ToolCall {
  /** 模型给的调用 id；回填 tool 消息时必须原样带回，否则 API 会拒绝。 */
  id: string;
  name: string;
  /** 原始 JSON 字符串（可能是坏 JSON），由 tools/registry 负责解析与校验。 */
  arguments: string;
}

/** 工具执行结果；成功失败都通过 output 回填给模型。 */
export interface ToolResult {
  /** 是否执行成功；失败时 output 以 "Error:" 开头。 */
  ok: boolean;
  /** 回填给模型的文本（已按单次 30KB 上限截断）。 */
  output: string;
}

/** 工具执行上下文：只提供工作区根目录，工具不得读取其它全局状态。 */
export interface ToolRunContext {
  workspace: string;
}

/** 工具定义：模型看 name/description/parameters，运行时执行 run。 */
export interface ToolDefinition {
  name: string;
  /** 模型据此决定什么时候用这个工具。 */
  description: string;
  /** JSON Schema，供模型理解参数。 */
  parameters: Record<string, unknown>;
  /** 只读工具自动放行；写文件 / 执行命令需要过 Gate。 */
  readOnly: boolean;
  run(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult>;
}

/** 发给模型的工具声明（OpenAI `tools` 格式），由 ToolDefinition 转换而来。 */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema。 */
    parameters: Record<string, unknown>;
  };
}

/** `LlmClient.chat` 的可选项。 */
export interface LlmChatOptions {
  /** 用于 Esc 中断；实现必须把 signal 透传给 fetch。 */
  signal?: AbortSignal;
  /** 流式文本回调：每收到一段 delta 调一次，UI 负责节流渲染。 */
  onText?: (delta: string) => void;
}

/** `LlmClient.chat` 的返回值；tool_calls 已完成增量聚合。 */
export interface LlmChatResult {
  /** 本轮文本（可能为空字符串，例如只返回工具调用）。 */
  content: string;
  /** 完整工具调用列表（arguments 为原始 JSON 字符串）。 */
  toolCalls: ToolCall[];
  /** 供应商返回的 finish_reason，如 "stop" / "tool_calls" / "length"。 */
  finishReason: string;
}

/** LLM 客户端：只负责协议（OpenAI 兼容 chat/completions），不管工具执行。 */
export interface LlmClient {
  chat(
    messages: Message[],
    tools: ToolSpec[],
    opts?: LlmChatOptions,
  ): Promise<LlmChatResult>;
}

/** 权限闸的结果：allow=false 必须带可读原因，会原样回填给模型。 */
export type GateResult = { allow: true } | { allow: false; reason: string };

/**
 * 权限闸：只做判断，不弹 UI（§3.1）。
 * 需要参数时自行解析 `call.arguments`；解析失败按拒绝处理。
 */
export type Gate = (call: ToolCall) => Promise<GateResult>;

/** Agent Loop 发出的单向事件流；UI 只消费这些事件（§3.1、§6.9）。 */
export type AgentEvent =
  | { type: "assistant_text"; delta: string }
  /** args 为 null 表示模型给的 arguments JSON 无法解析。 */
  | { type: "tool_start"; call: ToolCall; args: Record<string, unknown> | null }
  | { type: "tool_end"; call: ToolCall; result: ToolResult; durationMs: number }
  | { type: "turn_end"; reason: string };
