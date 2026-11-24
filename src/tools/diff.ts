// S4-1：行级 unified diff（供 `edit_file` 返回、TUI 按红绿渲染）。
//
// 为什么自己写：
// - 不引入新依赖（AGENTS §1）；`edit_file` 只需要"改动附近的 hunk"，不是完整补丁工具；
// - 输出会回填给模型，也会被 TUI 解析着色，所以格式必须稳定、可截断、带行号；
// - 只做展示用 diff，不负责三方合并、二进制/换行符标记等完整 patch 能力。
//
// 格式（每个内容行都以标记符开头，便于 UI 正则解析）：
//
//   --- a/src/a.ts
//   +++ b/src/a.ts
//   @@ -3,4 +3,5 @@
//      3│ 原样行
//   -  4│ 旧行
//   +  4│ 新行
//   +  5│ 新增行
//
// 说明：context 行号显示旧文件行号；`-` 显示旧行号、`+` 显示新行号（替换时会出现同号的一减一加）。
// 内容行格式固定为 `<标记><4 位行号>│ <内容>`，标记只有空格 / `-` / `+` 三种。

/** diff 行的类型：原样 / 删除 / 新增。 */
export type DiffLineKind = "context" | "removed" | "added";

/** diff 的一行（行号按类型落在旧文件或新文件上）。 */
export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
}

/** 一个 hunk（改动块）：头部的 `@@ -oldStart,oldCount +newStart,newCount @@` 与内容行。 */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

/** `edit_file` 的 diff 结果；`text` 是可直接放进 ToolResult.output 的渲染文本。 */
export interface UnifiedDiff {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  /** 全部改动的增/删行数（不受 hunk 截断影响）。 */
  readonly addedCount: number;
  readonly removedCount: number;
  readonly text: string;
  /** hunk/行数超限被截断（只影响文本，计数仍是全量）。 */
  readonly truncated: boolean;
  /** 被截断时未展示的 hunk 数；未截断为 0。 */
  readonly hiddenHunks: number;
}

/** 创建 diff 的可选项；默认值按"一眼能看懂"与"不撑爆终端"折中。 */
export interface DiffOptions {
  /** 改动前后各保留多少行原文（默认 3）。 */
  readonly contextLines?: number;
  /** 最多展示多少个 hunk（默认 8），超出的记入 hiddenHunks。 */
  readonly maxHunks?: number;
  /** 最多展示多少内容行（默认 240），超出后停止追加并标记 truncated。 */
  readonly maxLines?: number;
}

export const DEFAULT_CONTEXT_LINES = 3;
export const DEFAULT_MAX_HUNKS = 8;
export const DEFAULT_MAX_LINES = 240;

/** LCS 表的格子上限：超过就走"整段替换"的粗略 diff，避免大文件卡死。 */
const MAX_LCS_CELLS = 250_000;

interface RawOp {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** 按行切分；空文本 = 0 行，末尾换行不产生空行（\r\n 与 \n 都接受）。 */
function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split(/\r\n|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /(?:\r\n|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

/** 粗略 diff：要么全删，要么全增，用于超大改动块（LCS 会太慢/太占内存）。 */
function coarseOps(before: readonly string[], after: readonly string[]): RawOp[] {
  return [
    ...before.map((text): RawOp => ({ kind: "removed", text })),
    ...after.map((text): RawOp => ({ kind: "added", text })),
  ];
}

/** 中间段的行级 LCS diff；长公共前后缀已在外层剥掉。 */
function middleOps(before: readonly string[], after: readonly string[]): RawOp[] {
  if (before.length === 0) {
    return after.map((text): RawOp => ({ kind: "added", text }));
  }
  if (after.length === 0) {
    return before.map((text): RawOp => ({ kind: "removed", text }));
  }
  if (before.length * after.length > MAX_LCS_CELLS) {
    return coarseOps(before, after);
  }

  const width = after.length + 1;
  const dp = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const diagonal = dp[(i + 1) * width + j + 1] ?? 0;
      const down = dp[(i + 1) * width + j] ?? 0;
      const right = dp[i * width + j + 1] ?? 0;
      dp[i * width + j] =
        before[i] === after[j] ? diagonal + 1 : Math.max(down, right);
    }
  }

  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ kind: "context", text: before[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    // 相等时优先删除（- 在 + 前），保证同一处改动的输出顺序稳定。
    const down = dp[(i + 1) * width + j] ?? 0;
    const right = dp[i * width + j + 1] ?? 0;
    if (down >= right) {
      ops.push({ kind: "removed", text: before[i] as string });
      i += 1;
    } else {
      ops.push({ kind: "added", text: after[j] as string });
      j += 1;
    }
  }
  for (; i < before.length; i += 1) ops.push({ kind: "removed", text: before[i] as string });
  for (; j < after.length; j += 1) ops.push({ kind: "added", text: after[j] as string });
  return ops;
}

/** 全文件行级 diff：剥公共前后缀 → 中间段 LCS/粗略 diff → 拼回带行号的行。 */
function buildDiffLines(beforeText: string, afterText: string): DiffLine[] {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const ops: RawOp[] = [
    ...before.slice(0, prefix).map((text): RawOp => ({ kind: "context", text })),
    ...middleOps(before.slice(prefix, before.length - suffix), after.slice(prefix, after.length - suffix)),
    ...before.slice(before.length - suffix).map((text): RawOp => ({ kind: "context", text })),
  ];

  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    if (op.kind === "context") {
      lines.push({ kind: "context", oldLine, newLine, text: op.text });
      oldLine += 1;
      newLine += 1;
    } else if (op.kind === "removed") {
      lines.push({ kind: "removed", oldLine, newLine: null, text: op.text });
      oldLine += 1;
    } else {
      lines.push({ kind: "added", oldLine: null, newLine, text: op.text });
      newLine += 1;
    }
  }
  return lines;
}

/** 数字列宽固定 4（超过 9999 行的文件取实际宽度），与 UI 解析保持一致。 */
function formatLineNumber(value: number | null): string {
  if (value === null) return "    ";
  return String(value).padStart(4, " ");
}

/** 内容行 → 文本行：`<标记><行号>│ <内容>`。 */
export function formatDiffLine(line: DiffLine): string {
  const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
  const number = formatLineNumber(line.kind === "added" ? line.newLine : line.oldLine);
  return `${marker}${number}│ ${line.text}`;
}

/** 内容行 → 文本行（导出格式的唯一入口，UI 解析依赖它）。 */
export function formatHunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}

/** 把带行号的行切成 hunk：改动行 ± contextLines，相邻/重叠的合并。 */
function buildHunks(lines: readonly DiffLine[], contextLines: number): DiffHunk[] {
  const changeIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.kind !== "context") changeIndexes.push(index);
  }
  if (changeIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changeIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range): DiffHunk => {
    const slice = lines.slice(range.start, range.end + 1);
    const before = lines.slice(0, range.start);
    const oldStart = before.filter((line) => line.kind !== "added").length + 1;
    const newStart = before.filter((line) => line.kind !== "removed").length + 1;
    return {
      oldStart,
      oldCount: slice.filter((line) => line.kind !== "added").length,
      newStart,
      newCount: slice.filter((line) => line.kind !== "removed").length,
      lines: slice,
    };
  });
}

/**
 * 生成 `edit_file` 用的 unified diff。
 *
 * 不抛异常：即使输入为空/相同也返回合法结构（无 hunk，text 只有文件头）。
 */
export function createUnifiedDiff(
  filePath: string,
  beforeText: string,
  afterText: string,
  options: DiffOptions = {},
): UnifiedDiff {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxHunks = options.maxHunks ?? DEFAULT_MAX_HUNKS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;

  const lines = buildDiffLines(beforeText, afterText);
  const addedCount = lines.filter((line) => line.kind === "added").length;
  const removedCount = lines.filter((line) => line.kind === "removed").length;

  const allHunks = buildHunks(lines, contextLines);
  const keptHunks: DiffHunk[] = [];
  const rendered: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let lineBudget = maxLines;
  let hiddenHunks = 0;

  for (const hunk of allHunks) {
    if (keptHunks.length >= maxHunks || lineBudget <= 0) {
      hiddenHunks += 1;
      continue;
    }
    const allowed = Math.min(hunk.lines.length, lineBudget);
    if (allowed < hunk.lines.length) {
      // 只显示一部分时保留 hunk 头，便于知道还有内容；计数仍是全量。
      rendered.push(formatHunkHeader(hunk));
      for (const line of hunk.lines.slice(0, allowed)) rendered.push(formatDiffLine(line));
      hiddenHunks += 1;
      lineBudget = 0;
      continue;
    }
    rendered.push(formatHunkHeader(hunk));
    for (const line of hunk.lines) rendered.push(formatDiffLine(line));
    lineBudget -= hunk.lines.length;
    keptHunks.push(hunk);
  }

  const truncated = hiddenHunks > 0;
  if (truncated) {
    rendered.push(`…（还有 ${hiddenHunks} 个改动块未显示；完整改动已写入文件）`);
  }

  return {
    path: filePath,
    hunks: keptHunks,
    addedCount,
    removedCount,
    text: rendered.join("\n"),
    truncated,
    hiddenHunks,
  };
}
