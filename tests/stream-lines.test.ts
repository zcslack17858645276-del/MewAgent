// S2-7 修复的纯逻辑单测：流式文本按行拆分 + 动态尾巴长度上限。
//
// 背景见 src/ui/stream-lines.ts：长输出若整段留在 Ink 动态区，动态区高度会超过终端，
// 旧帧无法被擦除、残留到 scrollback，用户滚动时表现为同一段输出反复叠加。

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DYNAMIC_TAIL_CHARS,
  clampDynamicTail,
  splitCompletedLines,
} from "../src/ui/stream-lines.js";

test("splitCompletedLines：空缓冲区没有行也没有尾", () => {
  assert.deepEqual(splitCompletedLines(""), { lines: [], tail: "" });
});

test("splitCompletedLines：没有换行时全部是尾行", () => {
  assert.deepEqual(splitCompletedLines("还没写完"), { lines: [], tail: "还没写完" });
});

test("splitCompletedLines：一个换行 → 一行已完成 + 尾巴", () => {
  assert.deepEqual(splitCompletedLines("第一行\n第二"), {
    lines: ["第一行"],
    tail: "第二",
  });
});

test("splitCompletedLines：以换行结尾时尾巴为空、空行保留", () => {
  assert.deepEqual(splitCompletedLines("a\n\nb\n"), {
    lines: ["a", "", "b"],
    tail: "",
  });
});

test("splitCompletedLines：CRLF 的行尾 \\r 被剥掉（不能当正文渲染）", () => {
  assert.deepEqual(splitCompletedLines("line one\r\nline two\r\n"), {
    lines: ["line one", "line two"],
    tail: "",
  });
});

test("clampDynamicTail：未超过上限时原样返回", () => {
  assert.deepEqual(clampDynamicTail("短尾巴", 800), { text: "短尾巴", hiddenChars: 0 });
});

test("clampDynamicTail：超过上限时只保留末尾并报告隐藏长度", () => {
  const text = "0123456789".repeat(10); // 100 码点
  const result = clampDynamicTail(text, 10);
  assert.equal(result.text, "0123456789");
  assert.equal(result.hiddenChars, 90);
});

test("clampDynamicTail：按码点截断，不切开代理对（emoji）", () => {
  const result = clampDynamicTail("😀😀😀", 2);
  assert.equal(result.text, "😀😀");
  assert.equal(result.hiddenChars, 1);
  assert.equal(Array.from(result.text).length, 2);
});

test("clampDynamicTail：默认上限是 MAX_DYNAMIC_TAIL_CHARS", () => {
  const text = "x".repeat(MAX_DYNAMIC_TAIL_CHARS + 5);
  const result = clampDynamicTail(text);
  assert.equal(result.text.length, MAX_DYNAMIC_TAIL_CHARS);
  assert.equal(result.hiddenChars, 5);
});
