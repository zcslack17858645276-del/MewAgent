// 多行输入纯逻辑单测：粘贴规范化、插入/删除（含代理对）、光标移动、换行合并。
//
// 这些函数不依赖终端，所以能直接测；InputBox 的按键映射靠 TUI 冒烟与用户 B 级验证。

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTINUATION,
  CONTINUATION_WIDTH,
  PROMPT,
  PROMPT_WIDTH,
  clampOffset,
  deleteAfter,
  deleteBefore,
  insertText,
  lineAndColumn,
  lineBoundaryOffset,
  moveVertically,
  nextBoundary,
  normalizePastedText,
  previousBoundary,
  splitLines,
} from "../src/ui/input-text.js";

describe("input-text：粘贴规范化", () => {
  it("统一 CRLF/CR 为 LF，保留断行", () => {
    assert.equal(normalizePastedText("a\r\nb\rc"), "a\nb\nc");
  });

  it("Tab 展开为两个空格", () => {
    assert.equal(normalizePastedText("a\tb"), "a  b");
  });

  it("去掉 BOM 与除换行外的控制字符", () => {
    assert.equal(normalizePastedText("\uFEFFa\u0001b\u007F\nc"), "ab\nc");
  });
});

describe("input-text：插入与删除", () => {
  it("insertText 把光标放到插入内容之后", () => {
    assert.deepEqual(insertText("你好", 1, "a"), {
      value: "你a好",
      cursorOffset: 2,
    });
  });

  it("deleteBefore 在换行处合并两行", () => {
    assert.deepEqual(deleteBefore("ab\ncd", 3), {
      value: "abcd",
      cursorOffset: 2,
    });
  });

  it("deleteBefore 删除整个代理对（emoji 不被删一半）", () => {
    const value = "a😀b";
    assert.deepEqual(deleteBefore(value, 3), {
      value: "ab",
      cursorOffset: 1,
    });
  });

  it("deleteAfter 删除整个代理对", () => {
    const value = "😀b";
    assert.deepEqual(deleteAfter(value, 0), {
      value: "b",
      cursorOffset: 0,
    });
  });

  it("deleteBefore/deleteAfter 在边界处不变", () => {
    assert.deepEqual(deleteBefore("ab", 0), { value: "ab", cursorOffset: 0 });
    assert.deepEqual(deleteAfter("ab", 2), { value: "ab", cursorOffset: 2 });
  });
});

describe("input-text：光标边界", () => {
  it("previousBoundary/nextBoundary 跨过代理对", () => {
    const value = "a😀b";
    assert.equal(previousBoundary(value, 3), 1);
    assert.equal(nextBoundary(value, 1), 3);
  });

  it("lineAndColumn 返回行号与行内下标", () => {
    assert.deepEqual(lineAndColumn("ab\ncd", 4), {
      lineIndex: 1,
      columnIndex: 1,
    });
    assert.deepEqual(lineAndColumn("ab\n", 3), { lineIndex: 1, columnIndex: 0 });
  });

  it("lineBoundaryOffset 取行首/行尾", () => {
    const value = "ab\ncd";
    assert.equal(lineBoundaryOffset(value, 4, "start"), 3);
    assert.equal(lineBoundaryOffset(value, 1, "end"), 2);
    assert.equal(lineBoundaryOffset(value, 4, "end"), 5);
  });

  it("moveVertically 按列移动、越界时夹到行尾", () => {
    const value = "abcdef\nxy\n";
    assert.equal(moveVertically(value, 4, 1), 9);
    assert.equal(moveVertically(value, 9, 1), 10);
    assert.equal(moveVertically(value, 4, -1), 4);
  });

  it("clampOffset/splitLines/常量", () => {
    assert.equal(clampOffset("ab", -5), 0);
    assert.equal(clampOffset("ab", 99), 2);
    assert.deepEqual(splitLines("a\n\nb"), ["a", "", "b"]);
    assert.equal(PROMPT, "❯ ");
    assert.equal(PROMPT_WIDTH, 2);
    assert.equal(CONTINUATION, "  ");
    assert.equal(CONTINUATION_WIDTH, 2);
  });
});
