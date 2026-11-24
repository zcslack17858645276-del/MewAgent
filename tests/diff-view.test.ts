import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DIFF_RENDER_LINES,
  clampDiffLines,
  formatDiffCounts,
  parseEditDiffOutput,
} from "../src/ui/diff-view.js";

/** 模拟 edit_file 的工具输出（S4-1 的固定格式）。 */
const SAMPLE = [
  "已替换 1 处（src/a.ts）：",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  "    1│ keep",
  "-   2│ old",
  "+   2│ new",
  "    3│ tail",
].join("\n");

test("diff-view：解析 edit_file 输出为可着色行", () => {
  const parsed = parseEditDiffOutput(SAMPLE);
  assert.ok(parsed !== null);
  assert.equal(parsed.path, "src/a.ts");
  assert.equal(parsed.addedCount, 1);
  assert.equal(parsed.removedCount, 1);
  assert.equal(parsed.truncated, false);
  assert.deepEqual(
    parsed.lines.map((line) => line.kind),
    ["header", "header", "hunk", "context", "removed", "added", "context"],
  );
  assert.equal(parsed.lines[4]?.text, "-   2│ old");
});

test("diff-view：非 diff 输出返回 null（回退为普通信息行）", () => {
  assert.equal(parseEditDiffOutput("已替换 1 处（a.txt）："), null);
  assert.equal(parseEditDiffOutput("随便一段普通文本"), null);
  assert.equal(parseEditDiffOutput("--- a/a.txt\n+++ b/a.txt"), null, "没有 hunk 不算 diff");
});

test("diff-view：识别截断提示", () => {
  const parsed = parseEditDiffOutput(`${SAMPLE}\n…（还有 2 个改动块未显示；完整改动已写入文件）`);
  assert.ok(parsed !== null);
  assert.equal(parsed.truncated, true);
});

test("diff-view：clampDiffLines 截断渲染行数并给出隐藏数", () => {
  const parsed = parseEditDiffOutput(SAMPLE);
  assert.ok(parsed !== null);

  const capped = clampDiffLines(parsed.lines, 2);
  assert.equal(capped.lines.length, 2);
  assert.equal(capped.hidden, parsed.lines.length - 2);

  const all = clampDiffLines(parsed.lines);
  assert.equal(all.hidden, 0);
  assert.ok(parsed.lines.length <= MAX_DIFF_RENDER_LINES);
});

test("diff-view：formatDiffCounts 省略双零，保留单侧", () => {
  assert.equal(formatDiffCounts(0, 0), "");
  assert.equal(formatDiffCounts(3, 1), "+3 −1");
  assert.equal(formatDiffCounts(0, 2), "+0 −2");
});
