// 已提交历史的单项渲染：只做展示，不持有状态、不发请求。
//
// 用 <Static> 承载这些条目：它们渲染一次后不再重绘，从而让动态区（流式文本、
// 输入框）的刷新不会带着历史一起闪（方案 §6.9）。
//
// S4-1：新增 `diff` 条目（edit_file 的改动按红绿渲染，见 `diff-view.ts`）。

import { Box, Text } from "ink";
import type { ReactElement } from "react";

import { clampDiffLines, type ParsedDiff, type ParsedDiffLineKind } from "./diff-view.js";

export type HistoryEntryKind = "user" | "assistant" | "stream" | "info" | "error" | "diff";

export interface HistoryEntry {
  readonly id: number;
  readonly kind: HistoryEntryKind;
  readonly text: string;
  /** kind === "diff" 时存在：解析好的 diff 行。 */
  readonly diff?: ParsedDiff;
}

/** 根据 kind 构造条目，避免调用方到处写判别联合字面量（diff 走 createDiffEntry）。 */
export function createHistoryEntry(
  id: number,
  kind: Exclude<HistoryEntryKind, "diff">,
  text: string,
): HistoryEntry {
  switch (kind) {
    case "user":
      return { id, kind, text };
    case "assistant":
      return { id, kind, text };
    case "stream":
      return { id, kind, text };
    case "info":
      return { id, kind, text };
    case "error":
      return { id, kind, text };
  }
}

/** S4-1：构造 diff 历史条目（标题 + 解析后的红绿行）。 */
export function createDiffEntry(id: number, text: string, diff: ParsedDiff): HistoryEntry {
  return { id, kind: "diff", text, diff };
}

export interface HistoryItemProps {
  readonly entry: HistoryEntry;
}

/** diff 行 → 颜色：新增绿、删除红、hunk 青色、文件头暗色、原样默认色。 */
function diffLineColor(kind: ParsedDiffLineKind): string | undefined {
  switch (kind) {
    case "added":
      return "green";
    case "removed":
      return "red";
    case "hunk":
      return "cyan";
    case "header":
      return undefined;
    case "context":
      return undefined;
  }
}

export function HistoryItem({ entry }: HistoryItemProps): ReactElement {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <Text>{entry.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text>{entry.text}</Text>
        </Box>
      );
    case "stream":
      // 流式文本按行提交：行与行之间不额外留空，空行用单个空格占位以保留原始排版。
      return (
        <Box>
          <Text>{entry.text === "" ? " " : entry.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">{entry.text}</Text>
        </Box>
      );
    case "info":
      return (
        <Box>
          <Text dimColor>{entry.text}</Text>
        </Box>
      );
    case "diff": {
      const diff = entry.diff;
      if (diff === undefined) {
        return (
          <Box marginTop={1}>
            <Text dimColor>{entry.text}</Text>
          </Box>
        );
      }
      const clamped = clampDiffLines(diff.lines);
      return (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{entry.text}</Text>
          {clamped.lines.map((line, index) => (
            <Text key={`${entry.id}-${index}`} color={diffLineColor(line.kind)} dimColor={line.kind === "header"}>
              {line.text}
            </Text>
          ))}
          {clamped.hidden > 0 ? (
            <Text dimColor>{`…（还有 ${clamped.hidden} 行 diff 未显示）`}</Text>
          ) : null}
        </Box>
      );
    }
  }
}
