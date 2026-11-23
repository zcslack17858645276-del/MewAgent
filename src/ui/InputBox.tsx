// 受控多行输入框：替代单行的 ink-text-input。
//
// 为什么自己写（S1-4 补丁）：
// - ink-text-input 是单行组件，粘贴多行文本时会把换行吞掉（它只 append 到 value）；
// - 它不暴露光标偏移，没法在多行时把终端光标放到正确位置（Windows Terminal 的中文候选框跟着光标走）；
// - 需要 Shift+Enter 换行（Kitty 协议下为 ESC[13;2u；不支持时用 Ctrl+J 兜底）。
//
// 本组件只做"输入编辑 + 渲染"，光标位置由 App 用 measureElement 计算后交给 useCursor。

import { Box, Text, useInput, usePaste } from "ink";
import { useCallback } from "react";
import type { ReactElement, ReactNode } from "react";

import {
  CONTINUATION,
  PROMPT,
  clampOffset,
  deleteBefore,
  insertText,
  lineAndColumn,
  lineBoundaryOffset,
  moveVertically,
  nextBoundary,
  normalizePastedText,
  previousBoundary,
  splitLines,
} from "./input-text.js";
import type { EditResult } from "./input-text.js";

export interface InputBoxProps {
  readonly value: string;
  readonly cursorOffset: number;
  readonly onChange: (value: string, cursorOffset: number) => void;
  readonly onSubmit: (value: string) => void;
  readonly placeholder?: string | undefined;
  /** 为 false 时不接收按键（例如审批弹窗聚焦时）；默认真。 */
  readonly active?: boolean | undefined;
  readonly promptColor?: string | undefined;
}

/** 非 bracketed-paste 路径下的多字符输入（终端模拟器粘贴/输入法整段上屏）。 */
function normalizeTypedInput(input: string): string {
  if (input.length > 1 || input.includes("\r") || input.includes("\t")) {
    return normalizePastedText(input);
  }

  return input;
}

function renderPlaceholder(placeholder: string): ReactNode {
  const characters = Array.from(placeholder);
  const first = characters[0] ?? " ";
  const rest = characters.slice(1).join("");
  return (
    <>
      <Text inverse>{first}</Text>
      {rest === "" ? null : <Text dimColor>{rest}</Text>}
    </>
  );
}

function renderLineContent(line: string, caretColumn: number | null): ReactNode {
  if (caretColumn === null) {
    return line;
  }

  const before = line.slice(0, caretColumn);
  const caretEnd = nextBoundary(line, caretColumn);
  const at = line.slice(caretColumn, caretEnd);
  const after = line.slice(caretEnd);
  return (
    <>
      {before}
      <Text inverse>{at === "" ? " " : at}</Text>
      {after}
    </>
  );
}

export function InputBox({
  value,
  cursorOffset,
  onChange,
  onSubmit,
  placeholder,
  active = true,
  promptColor = "cyan",
}: InputBoxProps): ReactElement {
  const applyEdit = useCallback(
    (edit: EditResult) => {
      if (edit.value !== value || edit.cursorOffset !== cursorOffset) {
        onChange(edit.value, edit.cursorOffset);
      }
    },
    [cursorOffset, onChange, value],
  );

  const insert = useCallback(
    (inserted: string) => {
      applyEdit(insertText(value, cursorOffset, inserted));
    },
    [applyEdit, cursorOffset, value],
  );

  const moveTo = useCallback(
    (offset: number) => {
      const clamped = clampOffset(value, offset);
      if (clamped !== cursorOffset) {
        onChange(value, clamped);
      }
    },
    [cursorOffset, onChange, value],
  );

  useInput(
    (typed, key) => {
      if (key.ctrl && typed === "c") {
        return; // 交给 App：生成中中断 / 空闲退出
      }

      if (key.escape) {
        return; // 交给 App：中断或清空
      }

      if (key.return) {
        if (key.shift) {
          insert("\n"); // Shift+Enter 换行（Kitty 协议）
          return;
        }

        onSubmit(value);
        return;
      }

      // Ctrl+J 作为不支持 Kitty 协议时的换行兜底（终端里就是 \n）。
      if (typed === "\n" || (key.ctrl && typed === "j")) {
        insert("\n");
        return;
      }

      if (key.backspace || key.delete) {
        applyEdit(deleteBefore(value, cursorOffset));
        return;
      }

      if (key.leftArrow) {
        moveTo(previousBoundary(value, cursorOffset));
        return;
      }

      if (key.rightArrow) {
        moveTo(nextBoundary(value, cursorOffset));
        return;
      }

      if (key.upArrow) {
        moveTo(moveVertically(value, cursorOffset, -1));
        return;
      }

      if (key.downArrow) {
        moveTo(moveVertically(value, cursorOffset, 1));
        return;
      }

      if (key.home) {
        moveTo(lineBoundaryOffset(value, cursorOffset, "start"));
        return;
      }

      if (key.end) {
        moveTo(lineBoundaryOffset(value, cursorOffset, "end"));
        return;
      }

      if (key.tab || key.ctrl || key.meta || key.pageUp || key.pageDown) {
        return;
      }

      const normalized = normalizeTypedInput(typed);
      if (normalized !== "") {
        insert(normalized);
      }
    },
    { isActive: active },
  );

  usePaste((pasted) => {
    if (!active) {
      return;
    }

    const normalized = normalizePastedText(pasted);
    if (normalized !== "") {
      insert(normalized);
    }
  });

  const lines = splitLines(value);
  const caret = lineAndColumn(value, cursorOffset);
  const showPlaceholder =
    value === "" && placeholder !== undefined && placeholder !== "";
  const caretLine = showPlaceholder ? null : caret.lineIndex;

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const isFirstLine = index === 0;
        const isCaretLine = caretLine === index;
        return (
          <Text key={`line-${index}`}>
            <Text color={isFirstLine ? promptColor : "gray"}>
              {isFirstLine ? PROMPT : CONTINUATION}
            </Text>
            {showPlaceholder && isFirstLine
              ? renderPlaceholder(placeholder ?? "")
              : renderLineContent(
                  line,
                  isCaretLine ? caret.columnIndex : null,
                )}
          </Text>
        );
      })}
    </Box>
  );
}
