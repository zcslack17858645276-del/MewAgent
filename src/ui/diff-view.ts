// S4-1：把 `edit_file` 的 unified diff 文本解析成可着色渲染的行。
//
// 约定格式由 `src/tools/diff.ts` 生成：
//   --- a/<path>
//   +++ b/<path>
//   @@ -旧起,旧数 +新起,新数 @@
//   <标记><4 位行号>│ <内容>     // 标记：空格 / "-" / "+"
// 解析失败（不是 diff 文本）返回 null，调用方回退到普通信息行，绝不让 UI 崩。

/** 解析后的行种类：文件头 / hunk 头 / 原样 / 删除 / 新增。 */
export type ParsedDiffLineKind = "header" | "hunk" | "context" | "removed" | "added";

export interface ParsedDiffLine {
  readonly kind: ParsedDiffLineKind;
  /** 原始整行文本（含标记与行号），渲染时原样输出。 */
  readonly text: string;
}

export interface ParsedDiff {
  readonly path: string;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly lines: readonly ParsedDiffLine[];
  /** 文本里带"还有 N 个改动块未显示"（工具输出被截断）。 */
  readonly truncated: boolean;
}

/** 历史区最多渲染多少行 diff（完整 diff 已在工具输出/文件里）。 */
export const MAX_DIFF_RENDER_LINES = 80;

const HUNK_RE = /^@@ -\d+,\d+ \+\d+,\d+ @@/u;
const CONTENT_RE = /^([ +\-])(.{4})│ /u;

/**
 * 解析 `edit_file` 工具输出里的 diff 段。
 *
 * 找不到 `--- a/` 或没有任何内容行时返回 null（不是 diff，只是普通文本）。
 */
export function parseEditDiffOutput(output: string): ParsedDiff | null {
  const sourceLines = output.split("\n");
  const start = sourceLines.findIndex((line) => line.startsWith("--- a/"));
  if (start === -1) {
    return null;
  }
  const path = (sourceLines[start] as string).slice("--- a/".length);

  const lines: ParsedDiffLine[] = [{ kind: "header", text: sourceLines[start] as string }];
  let addedCount = 0;
  let removedCount = 0;
  let truncated = false;
  let sawHunk = false;

  for (const line of sourceLines.slice(start + 1)) {
    if (line.startsWith("+++ b/")) {
      lines.push({ kind: "header", text: line });
      continue;
    }
    if (HUNK_RE.test(line)) {
      sawHunk = true;
      lines.push({ kind: "hunk", text: line });
      continue;
    }
    const match = CONTENT_RE.exec(line);
    if (match !== null) {
      const marker = match[1] as string;
      const kind: ParsedDiffLineKind = marker === "+" ? "added" : marker === "-" ? "removed" : "context";
      if (kind === "added") addedCount += 1;
      if (kind === "removed") removedCount += 1;
      lines.push({ kind, text: line });
      continue;
    }
    if (line.startsWith("…（")) {
      truncated = true;
    }
  }

  if (!sawHunk) {
    return null;
  }
  return { path, addedCount, removedCount, lines, truncated };
}

/** 只保留前 max 行，超出部分返回 hidden 计数（渲染层另加提示）。 */
export function clampDiffLines(
  lines: readonly ParsedDiffLine[],
  max = MAX_DIFF_RENDER_LINES,
): { lines: ParsedDiffLine[]; hidden: number } {
  if (lines.length <= max) {
    return { lines: [...lines], hidden: 0 };
  }
  return { lines: lines.slice(0, max), hidden: lines.length - max };
}

/** `+3 −1`；都是 0 时返回空串。 */
export function formatDiffCounts(added: number, removed: number): string {
  if (added <= 0 && removed <= 0) {
    return "";
  }
  return `+${added} −${removed}`;
}
