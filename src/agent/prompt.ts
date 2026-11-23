// S1-3 system prompt（先简版）：S1-5 的 `--print` 与 S2 的 loop 负责把它放在消息首位。
//
// 原则：短、稳定、可预测；不写会随实现细节过期的指令（工具列表由调用方传入）。
// 改了文案就把 SYSTEM_PROMPT_VERSION +1，方便从日志定位行为变化。

import type { Message } from "../types.js";

/** system prompt 文案版本号；只用于观测/排查，不参与逻辑。 */
export const SYSTEM_PROMPT_VERSION = 1;

export interface SystemPromptOptions {
  /** 会话工作区绝对路径；告诉模型文件操作的边界。 */
  workspace: string;
  /** 可用工具名列表；S2 起由 registry 传入，空/缺省表示当前没有工具。 */
  toolNames?: readonly string[];
}

/** 构造 system prompt 文本（纯函数，便于单测与调试时打印）。 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const toolNames = options.toolNames ?? [];
  const toolLine =
    toolNames.length > 0
      ? `可用工具：${toolNames.join("、")}。需要读文件或执行命令时再调用工具，不要编造工具结果。`
      : "当前没有可用工具：只回答，不要声称调用了工具。";

  return [
    "你是 MewAgent，一个在终端里工作的 CLI 编程助手。",
    `当前工作区：${options.workspace}`,
    toolLine,
    "规则：",
    "- 使用中文回答，先给结论再给必要细节；代码块标注语言。",
    "- 不确定的事实先查证（读文件、看命令输出），不要编造。",
    "- 不要输出与任务无关的客套话；不要声称做过未做的事。",
    "- 涉及写文件、删除、执行命令时，先说明将要做什么（确认由上层权限闸负责）。",
  ].join("\n");
}

/**
 * 把 system prompt 归一到消息列表首位，并保证只出现一条。
 *
 * 已有 system 消息（例如会话恢复时的旧版本 prompt）会被替换，其余消息顺序不变；
 * 返回新数组，不修改入参。对应 testing.md S1-3 第 3 条「system prompt 在首位且不重复」。
 */
export function withSystemPrompt(messages: readonly Message[], prompt: string): Message[] {
  const rest = messages.filter((message) => message.role !== "system");
  return [{ role: "system", content: prompt }, ...rest];
}
