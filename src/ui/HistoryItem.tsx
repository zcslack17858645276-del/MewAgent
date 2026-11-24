// 已提交历史的单项渲染：只做展示，不持有状态、不发请求。
//
// 用 <Static> 承载这些条目：它们渲染一次后不再重绘，从而让动态区（流式文本、
// 输入框）的刷新不会带着历史一起闪（方案 §6.9）。

import { Box, Text } from "ink";
import type { ReactElement } from "react";

export type HistoryEntryKind = "user" | "assistant" | "stream" | "info" | "error";

export interface HistoryEntry {
  readonly id: number;
  readonly kind: HistoryEntryKind;
  readonly text: string;
}

/** 根据 kind 构造条目，避免调用方到处写判别联合字面量。 */
export function createHistoryEntry(
  id: number,
  kind: HistoryEntryKind,
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

export interface HistoryItemProps {
  readonly entry: HistoryEntry;
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
  }
}
