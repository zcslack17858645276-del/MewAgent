// S2-7：把 AgentEvent 里的工具调用/结果压成"一行可读摘要"（纯函数，便于单测）。
//
// 为什么单独拆文件：
// - UI 只负责展示，摘要格式最好可测且不依赖 Ink（reducer 逻辑不进渲染树）；
// - 参数与错误必须截断（红线：任何东西都不能撑爆终端布局，也不能把 30KB 工具输出塞进历史区）；
// - 工具结束立即提交为历史项（方案 §6.9），所以"结果 + 耗时"要在同一行里说清楚。

import type { ToolCall, ToolResult } from "../types.js";

/** 参数摘要最多显示多少个码点（超长路径/命令截断，避免撑爆布局）。 */
export const TOOL_ARGS_MAX_CHARS = 120;

/** 失败时错误摘要最多显示多少个码点（完整错误已回填给模型，UI 给首行即可）。 */
export const TOOL_ERROR_MAX_CHARS = 160;

/** 按码点截断（不会把 emoji 这类代理对切成两半），超出时补省略号。 */
export function truncateForDisplay(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "…";
  }

  const characters = Array.from(text);
  if (characters.length <= maxChars) {
    return text;
  }

  return `${characters.slice(0, maxChars).join("")}…`;
}

/** `read_file {"path":"package.json"}`；无参数时只显示工具名。 */
export function formatToolCall(call: ToolCall): string {
  const args = call.arguments.trim();
  if (args === "" || args === "{}") {
    return call.name;
  }

  return `${call.name} ${truncateForDisplay(args, TOOL_ARGS_MAX_CHARS)}`;
}

/** 毫秒 → `12ms` / `1.5s` / `12s`。 */
export function formatDuration(durationMs: number): string {
  const safe = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (safe < 1000) {
    return `${Math.round(safe)}ms`;
  }

  const seconds = safe / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/** 失败输出只取首行做摘要：多行错误会在历史区占很多行，完整内容模型已收到。 */
function firstLine(text: string): string {
  const index = text.indexOf("\n");
  const line = index === -1 ? text : text.slice(0, index);
  return line.trim();
}

/** `✅ read_file {"path":"a.txt"} · 3ms`；失败时追加 `· Error: …`（单行、截断）。 */
export function formatToolEnd(
  call: ToolCall,
  result: ToolResult,
  durationMs: number,
): string {
  const head = `${result.ok ? "✅" : "❌"} ${formatToolCall(call)} · ${formatDuration(durationMs)}`;
  if (result.ok) {
    return head;
  }

  const detail = truncateForDisplay(firstLine(result.output), TOOL_ERROR_MAX_CHARS);
  return detail === "" ? head : `${head} · ${detail}`;
}

/** 回合结束原因 → 历史区提示行（正常结束返回 null，不额外占一行）。 */
export function formatTurnEndNote(reason: string, maxSteps = 30): string | null {
  if (reason === "aborted") {
    return "（已中断）";
  }
  if (reason === "max_steps") {
    return `（已达到最大步数 ${maxSteps}，已停止）`;
  }
  return null;
}
