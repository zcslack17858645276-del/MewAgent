import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MAX_HUNKS,
  createUnifiedDiff,
  formatDiffLine,
  formatHunkHeader,
  type DiffLine,
} from "../src/tools/diff.js";

/** 生成 N 行文本（行号从 1 开始）。 */
function lines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n") + "\n";
}

test("diff：单行替换生成一个 hunk，行号与增删计数正确", () => {
  const before = `${lines(3)}old value\n${lines(2, "tail")}`;
  const after = `${lines(3)}new value\n${lines(2, "tail")}`;
  const diff = createUnifiedDiff("src/a.ts", before, after, { contextLines: 1 });

  assert.equal(diff.path, "src/a.ts");
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.truncated, false);
  assert.equal(diff.hiddenHunks, 0);

  const hunk = diff.hunks[0];
  assert.ok(hunk !== undefined);
  assert.equal(formatHunkHeader(hunk), `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
  assert.equal(
    diff.text,
    ["--- a/src/a.ts", "+++ b/src/a.ts", formatHunkHeader(hunk), ...hunk.lines.map(formatDiffLine)].join("\n"),
  );
  assert.ok(diff.text.includes("-   4│ old value"), diff.text);
  assert.ok(diff.text.includes("+   4│ new value"), diff.text);
  // 只保留改动前后各 1 行上下文（第 3、5 行）。
  assert.ok(diff.text.includes("    3│ line 3"), diff.text);
  assert.ok(diff.text.includes("    5│ tail 1"), diff.text);
  assert.ok(!diff.text.includes("    2│ line 2"), diff.text);
});

test("diff：插入与删除只产生单侧计数", () => {
  const inserted = createUnifiedDiff("a.txt", "a\nb\n", "a\nX\nb\n", { contextLines: 0 });
  assert.equal(inserted.addedCount, 1);
  assert.equal(inserted.removedCount, 0);
  assert.ok(inserted.text.includes("+   2│ X"), inserted.text);

  const removed = createUnifiedDiff("a.txt", "a\nb\nc\n", "a\nc\n", { contextLines: 0 });
  assert.equal(removed.addedCount, 0);
  assert.equal(removed.removedCount, 1);
  assert.ok(removed.text.includes("-   2│ b"), removed.text);
});

test("diff：相距很远的改动拆成多个 hunk，相近的改动合并", () => {
  const before = lines(40);
  const afterFar = lines(40)
    .replace("line 2\n", "line 2 changed\n")
    .replace("line 30\n", "line 30 changed\n");
  const far = createUnifiedDiff("far.txt", before, afterFar, { contextLines: 2 });
  assert.equal(far.hunks.length, 2);
  assert.deepEqual(
    far.hunks.map((hunk) => hunk.oldStart),
    [1, 28],
  );

  const afterNear = lines(12)
    .replace("line 3\n", "line 3 changed\n")
    .replace("line 5\n", "line 5 changed\n");
  const near = createUnifiedDiff("near.txt", lines(12), afterNear, { contextLines: 2 });
  assert.equal(near.hunks.length, 1, "间距 <= 2*context 的改动应合并");
});

test("diff：CRLF 输入按行处理，不把 \\r 当成内容", () => {
  const diff = createUnifiedDiff("crlf.txt", "a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n", { contextLines: 1 });
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.removedCount, 1);
  assert.ok(diff.text.includes("-   2│ b"), diff.text);
  assert.ok(diff.text.includes("+   2│ B"), diff.text);
  assert.ok(!diff.text.includes("\r"), diff.text);
});

test("diff：末尾换行差异不算改动", () => {
  const diff = createUnifiedDiff("tail.txt", "a\nb\n", "a\nb");
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.removedCount, 0);
  assert.equal(diff.hunks.length, 0);
  assert.equal(diff.text, "--- a/tail.txt\n+++ b/tail.txt");
});

test("diff：空文件变有内容 / 内容清空", () => {
  const added = createUnifiedDiff("new.txt", "", "第一行\n第二行\n");
  assert.equal(added.addedCount, 2);
  assert.equal(added.removedCount, 0);
  assert.equal(added.hunks.length, 1);

  const removed = createUnifiedDiff("gone.txt", "第一行\n第二行\n", "");
  assert.equal(removed.addedCount, 0);
  assert.equal(removed.removedCount, 2);
});

test("diff：hunk 数超过 maxHunks 时截断并提示还有多少块", () => {
  const beforeLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  const afterLines = [...beforeLines];
  for (let index = 0; index < 20; index += 2) {
    afterLines[index] = `changed ${index + 1}`;
  }
  const diff = createUnifiedDiff(
    "many.txt",
    beforeLines.join("\n") + "\n",
    afterLines.join("\n") + "\n",
    { contextLines: 0, maxHunks: 3, maxLines: 1_000 },
  );
  assert.equal(diff.hunks.length, 3);
  assert.equal(diff.truncated, true);
  assert.ok(diff.hiddenHunks > 0);
  assert.ok(diff.text.includes(`还有 ${diff.hiddenHunks} 个改动块未显示`), diff.text);
  // 计数不受截断影响：10 处替换 = 10 增 10 删。
  assert.equal(diff.addedCount, 10);
  assert.equal(diff.removedCount, 10);
});

test("diff：默认 maxHunks 生效，超大改动块按粗略 diff 截断不崩", () => {
  const before = lines(600, "before");
  const after = lines(600, "after");
  const diff = createUnifiedDiff("big.txt", before, after);
  assert.equal(diff.addedCount, 600);
  assert.equal(diff.removedCount, 600);
  assert.ok(diff.hunks.length <= DEFAULT_MAX_HUNKS);
  assert.equal(diff.truncated, true);
});

test("diff：formatDiffLine 的行号列固定 4 位，null 行号留空", () => {
  const context: DiffLine = { kind: "context", oldLine: 12, newLine: 13, text: "x" };
  const removed: DiffLine = { kind: "removed", oldLine: 12, newLine: null, text: "y" };
  const added: DiffLine = { kind: "added", oldLine: null, newLine: 13, text: "z" };
  assert.equal(formatDiffLine(context), "   12│ x");
  assert.equal(formatDiffLine(removed), "-  12│ y");
  assert.equal(formatDiffLine(added), "+  13│ z");
});
