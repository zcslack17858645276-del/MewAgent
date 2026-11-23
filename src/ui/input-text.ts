// 多行输入框的纯逻辑：光标移动、插入、删除、粘贴文本规范化。
//
// 单独抽出来是为了不依赖 Ink/终端也能单测——终端交互本身由 InputBox.tsx 负责。
// 光标用 JS 字符串下标（UTF-16 code unit）表示，这里所有移动/删除都按"码点边界"处理，
// 避免把一个 emoji/代理对删掉一半。

/** 输入行首提示符（第一行）与其显示宽度。 */
export const PROMPT = "❯ ";
export const PROMPT_WIDTH = 2;

/** 续行缩进（第二行起），与提示符等宽，保证内容左对齐。 */
export const CONTINUATION = "  ";
export const CONTINUATION_WIDTH = 2;

/**
 * 规范化粘贴文本：
 * - 统一换行（`\r\n`、`\r` → `\n`），保证多行粘贴能保留断行；
 * - Tab 展开为两个空格（终端表格宽度不确定，硬 Tab 会让光标计算失真）；
 * - 去掉除换行以外的控制字符（含 BOM、退格等），防止污染输入缓冲。
 */
export function normalizePastedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFEFF]/g, "");
}

/** 按行切分（保留空行）。 */
export function splitLines(value: string): string[] {
  return value.split("\n");
}

/** 把光标下标夹到 [0, value.length]。 */
export function clampOffset(value: string, offset: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.min(Math.max(0, Math.trunc(offset)), value.length);
}

/** 光标所在的 0 基行号与该行内的列下标（列下标同样是 UTF-16 下标）。 */
export function lineAndColumn(
  value: string,
  offset: number,
): { lineIndex: number; columnIndex: number } {
  const clamped = clampOffset(value, offset);
  const lines = value.slice(0, clamped).split("\n");
  const lineIndex = lines.length - 1;
  const columnIndex = lines[lineIndex]?.length ?? 0;
  return { lineIndex, columnIndex };
}

/** 编辑结果：新文本 + 新光标位置。 */
export interface EditResult {
  readonly value: string;
  readonly cursorOffset: number;
}

/** 在光标处插入文本，光标落到插入内容之后。 */
export function insertText(
  value: string,
  offset: number,
  inserted: string,
): EditResult {
  const clamped = clampOffset(value, offset);
  return {
    value: value.slice(0, clamped) + inserted + value.slice(clamped),
    cursorOffset: clamped + inserted.length,
  };
}

/** 光标前一个码点的起点（左移/退格共用）。 */
export function previousBoundary(value: string, offset: number): number {
  if (offset <= 0) {
    return 0;
  }
  const start = offset - 1;
  if (start > 0) {
    const previous = value.charCodeAt(start - 1);
    const current = value.charCodeAt(start);
    const previousIsHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
    const currentIsLowSurrogate = current >= 0xdc00 && current <= 0xdfff;
    if (previousIsHighSurrogate && currentIsLowSurrogate) {
      return start - 1;
    }
  }
  return start;
}

/** 光标后一个码点的终点（右移/Delete 共用）。 */
export function nextBoundary(value: string, offset: number): number {
  if (offset >= value.length) {
    return value.length;
  }
  const current = value.charCodeAt(offset);
  const currentIsHighSurrogate = current >= 0xd800 && current <= 0xdbff;
  if (currentIsHighSurrogate && offset + 1 < value.length) {
    const following = value.charCodeAt(offset + 1);
    if (following >= 0xdc00 && following <= 0xdfff) {
      return offset + 2;
    }
  }
  return offset + 1;
}

/** Backspace：删除光标前一个码点（跨行时即删除换行、两行合并）。 */
export function deleteBefore(value: string, offset: number): EditResult {
  const clamped = clampOffset(value, offset);
  if (clamped === 0) {
    return { value, cursorOffset: 0 };
  }
  const start = previousBoundary(value, clamped);
  return {
    value: value.slice(0, start) + value.slice(clamped),
    cursorOffset: start,
  };
}

/** Delete：删除光标后一个码点。 */
export function deleteAfter(value: string, offset: number): EditResult {
  const clamped = clampOffset(value, offset);
  if (clamped >= value.length) {
    return { value, cursorOffset: clamped };
  }
  const end = nextBoundary(value, clamped);
  return {
    value: value.slice(0, clamped) + value.slice(end),
    cursorOffset: clamped,
  };
}

/** 行首/行尾下标（Home/End）。 */
export function lineBoundaryOffset(
  value: string,
  offset: number,
  edge: "start" | "end",
): number {
  const { columnIndex } = lineAndColumn(value, offset);
  const clamped = clampOffset(value, offset);
  if (edge === "start") {
    return clamped - columnIndex;
  }
  const lineEnd = value.indexOf("\n", clamped);
  if (lineEnd === -1) {
    return value.length;
  }
  return lineEnd;
}

/**
 * 上下移动光标（用 code unit 列保持列位置；软换行的视觉列不参与）。
 * direction: -1 上移，1 下移。
 */
export function moveVertically(
  value: string,
  offset: number,
  direction: -1 | 1,
): number {
  const clamped = clampOffset(value, offset);
  const { lineIndex, columnIndex } = lineAndColumn(value, clamped);
  const targetLine = lineIndex + direction;
  const lines = value.split("\n");
  if (targetLine < 0 || targetLine >= lines.length) {
    return clamped;
  }
  let targetStart = 0;
  for (let index = 0; index < targetLine; index += 1) {
    targetStart += (lines[index]?.length ?? 0) + 1;
  }
  const targetLength = lines[targetLine]?.length ?? 0;
  return targetStart + Math.min(columnIndex, targetLength);
}
