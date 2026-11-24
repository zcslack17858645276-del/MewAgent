// S2-7：TUI 工具事件摘要（纯函数）的自动化测试。
//
// 覆盖验收里能自动化的部分：参数摘要截断、成功/失败行、错误首行摘要、耗时格式化、
// turn_end 提示。真实 Ink 渲染与 B 级 4 条手工项在 TUI 冒烟/用户验收里覆盖。

import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCall, ToolResult } from "../src/types.js";
import {
  TOOL_ARGS_MAX_CHARS,
  TOOL_ERROR_MAX_CHARS,
  formatDuration,
  formatToolCall,
  formatToolEnd,
  formatTurnEndNote,
  truncateForDisplay,
} from "../src/ui/tool-display.js";

const CALL: ToolCall = {
  id: "call_1",
  name: "read_file",
  arguments: '{"path":"package.json","limit":12}',
};

test("truncateForDisplay：短文本原样、长文本按码点截断并加省略号", () => {
  assert.equal(truncateForDisplay("abc", 10), "abc");
  assert.equal(truncateForDisplay("abcdef", 3), "abc…");
  // emoji 是代理对：按码点截断，不会切出半个字符。
  assert.equal(truncateForDisplay("a😀b😀c", 2), "a😀…");
  assert.equal(truncateForDisplay("abc", 0), "…");
});

test("formatToolCall：工具名 + 参数摘要；空参数/空对象只显示工具名", () => {
  assert.equal(
    formatToolCall(CALL),
    'read_file {"path":"package.json","limit":12}',
  );
  assert.equal(formatToolCall({ id: "c", name: "glob", arguments: "" }), "glob");
  assert.equal(formatToolCall({ id: "c", name: "glob", arguments: "{}" }), "glob");
});

test("formatToolCall：超长参数截断到上限，不撑爆布局", () => {
  const longPath = "a".repeat(500);
  const text = formatToolCall({
    id: "c",
    name: "bash",
    arguments: JSON.stringify({ command: `echo ${longPath}` }),
  });
  assert.ok(text.startsWith('bash {"command":"echo '));
  assert.ok(text.endsWith("…"));
  // 工具名 + 空格之后的内容不超过上限 + 省略号。
  const argsPart = text.slice("bash ".length);
  assert.ok(Array.from(argsPart).length <= TOOL_ARGS_MAX_CHARS + 1);
});

test("formatDuration：ms / s 的边界", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(5), "5ms");
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1000), "1.0s");
  assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(Number.NaN), "0ms");
});

test("formatToolEnd：成功显示 ✅ + 耗时", () => {
  const result: ToolResult = { ok: true, output: "文件内容…" };
  assert.equal(
    formatToolEnd(CALL, result, 3),
    '✅ read_file {"path":"package.json","limit":12} · 3ms',
  );
});

test("formatToolEnd：失败显示 ❌ + 错误首行（截断为单行）", () => {
  const result: ToolResult = {
    ok: false,
    output: "Error: 文件不存在：nope.txt。\n下一步：先用 glob 确认路径。",
  };
  const line = formatToolEnd(CALL, result, 12);
  assert.equal(
    line,
    '❌ read_file {"path":"package.json","limit":12} · 12ms · Error: 文件不存在：nope.txt。',
  );
  assert.ok(!line.includes("\n"), "必须是单行，多行错误不能撑破历史区");
});

test("formatToolEnd：超长错误首行截断，仍保持单行", () => {
  const result: ToolResult = { ok: false, output: `Error: ${"x".repeat(1000)}` };
  const line = formatToolEnd(CALL, result, 1);
  const detail = line.split(" · ").at(-1) ?? "";
  assert.ok(Array.from(detail).length <= TOOL_ERROR_MAX_CHARS + 1);
  assert.ok(detail.endsWith("…"));
});

test("formatToolEnd：空错误输出只显示头部", () => {
  const result: ToolResult = { ok: false, output: "" };
  assert.equal(
    formatToolEnd(CALL, result, 2),
    '❌ read_file {"path":"package.json","limit":12} · 2ms',
  );
});

test("formatTurnEndNote：正常结束不提示，中断/步数上限给中文说明与下一步", () => {
  assert.equal(formatTurnEndNote("stop"), null);
  assert.equal(formatTurnEndNote("aborted"), "（已中断）如果您还要继续，重新输入问题即可。");

  const maxSteps = formatTurnEndNote("max_steps");
  assert.ok(maxSteps !== null, "max_steps 必须有提示");
  assert.ok(maxSteps.includes("（已达到最大步数 30，已停止）"), maxSteps);
  assert.ok(maxSteps.includes("下一步："), maxSteps);

  const custom = formatTurnEndNote("max_steps", 3);
  assert.ok(custom !== null && custom.includes("（已达到最大步数 3，已停止）"), String(custom));
});
