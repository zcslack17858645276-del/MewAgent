import assert from "node:assert/strict";
import { after, test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ToolDefinition, ToolResult } from "../src/types.js";
import {
  DEFAULT_READ_LIMIT,
  MAX_TOOL_OUTPUT_BYTES,
  editFileTool,
  fsTools,
  readFileTool,
  writeFileTool,
} from "../src/tools/fs.js";
import { ToolRegistry } from "../src/tools/registry.js";

function createWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "mewagent-fs-"));
}

const workspace = createWorkspace();

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function runTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  targetWorkspace: string = workspace,
): Promise<ToolResult> {
  return tool.run(args, { workspace: targetWorkspace });
}

function expectOk(result: ToolResult): string {
  assert.equal(result.ok, true, result.output);
  return result.output;
}

function expectFail(result: ToolResult, ...fragments: string[]): string {
  assert.equal(result.ok, false, result.output);
  assert.ok(result.output.startsWith("Error:"), result.output);
  for (const fragment of fragments) {
    assert.ok(result.output.includes(fragment), `输出应包含 ${JSON.stringify(fragment)}：\n${result.output}`);
  }
  return result.output;
}

test("fs：write_file 自动创建父目录并写入内容", async () => {
  const result = await runTool(writeFileTool, { path: "src/nested/new.txt", content: "hello\nworld\n" });
  const output = expectOk(result);
  assert.ok(output.includes("已写入 src/nested/new.txt"), output);
  assert.ok(output.includes("12 字节，2 行"), output);
  assert.ok(output.includes("已创建目录：src/nested"), output);
  assert.equal(readFileSync(path.join(workspace, "src", "nested", "new.txt"), "utf8"), "hello\nworld\n");
});

test("fs：write_file 覆盖已有文件并把空内容写成空文件", async () => {
  await runTool(writeFileTool, { path: "overwrite.txt", content: "first\n" });
  const second = await runTool(writeFileTool, { path: "overwrite.txt", content: "second\n" });
  assert.ok(expectOk(second).includes("7 字节，1 行"), second.output);
  assert.equal(readFileSync(path.join(workspace, "overwrite.txt"), "utf8"), "second\n");

  const empty = await runTool(writeFileTool, { path: "empty.txt", content: "" });
  assert.ok(expectOk(empty).includes("0 字节，0 行"), empty.output);
  assert.equal(readFileSync(path.join(workspace, "empty.txt"), "utf8"), "");
});

test("fs：read_file 返回带行号内容（中文、CRLF 标记、空文件）", async () => {
  writeFileSync(path.join(workspace, "cn.txt"), "第一行\n第二行\n", "utf8");
  const chinese = expectOk(await runTool(readFileTool, { path: "cn.txt" }));
  assert.ok(chinese.includes("cn.txt（第 1–2 行，共 2 行）"), chinese);
  assert.ok(chinese.includes("    1│第一行"), chinese);
  assert.ok(chinese.includes("    2│第二行"), chinese);

  writeFileSync(path.join(workspace, "crlf-read.txt"), "a\r\nb\r\n", "utf8");
  const crlf = expectOk(await runTool(readFileTool, { path: "crlf-read.txt" }));
  assert.ok(crlf.includes("CRLF 换行"), crlf);

  const empty = expectOk(await runTool(readFileTool, { path: "empty.txt" }));
  assert.equal(empty, "empty.txt（空文件）");

  writeFileSync(path.join(workspace, "no-trailing.txt"), "a\nb", "utf8");
  const noTrailing = expectOk(await runTool(readFileTool, { path: "no-trailing.txt" }));
  assert.ok(noTrailing.includes("共 2 行"), noTrailing);
});

test("fs：read_file 支持 offset/limit 分段读取", async () => {
  const lines = Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join("\n") + "\n";
  writeFileSync(path.join(workspace, "ten.txt"), lines, "utf8");

  const output = expectOk(await runTool(readFileTool, { path: "ten.txt", offset: 3, limit: 2 }));
  assert.ok(output.includes("ten.txt（第 3–4 行，共 10 行）"), output);
  assert.ok(output.includes("    3│line3"), output);
  assert.ok(output.includes("    4│line4"), output);
  assert.ok(!output.includes("line1\n"), output);
  assert.ok(output.includes("还有 6 行未显示；用 offset=5 继续读取"), output);
});

test("fs：read_file 默认行数上限与单行字节截断都有提示", async () => {
  const manyLines = Array.from({ length: 600 }, (_, index) => `row ${index + 1}`).join("\n") + "\n";
  writeFileSync(path.join(workspace, "many.txt"), manyLines, "utf8");
  const limited = expectOk(await runTool(readFileTool, { path: "many.txt" }));
  assert.ok(limited.includes(`第 1–${DEFAULT_READ_LIMIT} 行，共 600 行`), limited);
  assert.ok(limited.includes("还有 100 行未显示；用 offset=501 继续读取"), limited);

  writeFileSync(path.join(workspace, "giant.txt"), "a".repeat(40_000), "utf8");
  const truncated = expectOk(await runTool(readFileTool, { path: "giant.txt" }));
  assert.ok(truncated.includes("输出已截断"), truncated);
  assert.ok(Buffer.byteLength(truncated, "utf8") <= MAX_TOOL_OUTPUT_BYTES + 300, `输出过大：${truncated.length}`);
});

test("fs：read_file 字节截断时续读 offset 按实际渲染行数给（不跳行）", async () => {
  const longLines = Array.from({ length: 600 }, (_, index) => `row ${index + 1} ` + "z".repeat(120)).join("\n") + "\n";
  writeFileSync(path.join(workspace, "long-lines.txt"), longLines, "utf8");
  const output = expectOk(await runTool(readFileTool, { path: "long-lines.txt" }));
  assert.ok(output.includes("输出已截断"), output);
  const match = /第 1–(\d+) 行，共 600 行/.exec(output);
  assert.ok(match !== null, output);
  const lastLine = Number(match[1]);
  assert.ok(lastLine < DEFAULT_READ_LIMIT, `应因字节预算提前截断，实际渲染到第 ${lastLine} 行`);
  assert.ok(output.includes(`还有 ${600 - lastLine} 行未显示；用 offset=${lastLine + 1} 继续读取`), output);
  const next = expectOk(await runTool(readFileTool, { path: "long-lines.txt", offset: lastLine + 1, limit: 2 }));
  assert.ok(next.includes(`第 ${lastLine + 1}–${lastLine + 2} 行，共 600 行`), next);
});

test("fs：read_file 对不存在/目录/offset 越界返回可操作错误", async () => {
  expectFail(await runTool(readFileTool, { path: "nope.txt" }), "文件不存在", "下一步", "glob");
  expectFail(await runTool(readFileTool, { path: "src" }), "是目录", "下一步");
  expectFail(await runTool(readFileTool, { path: "ten.txt", offset: 99 }), "超出文件总行数 10", "下一步");
});

test("fs：edit_file 唯一匹配替换并返回上下文", async () => {
  const content = ["line one", "line two", "line three", "line four", "line five", "line six", "line seven"]
    .map((line) => line + "\n")
    .join("");
  writeFileSync(path.join(workspace, "edit.txt"), content, "utf8");

  const output = expectOk(
    await runTool(editFileTool, { path: "edit.txt", old_string: "line four", new_string: "LINE FOUR" }),
  );
  assert.ok(output.includes("已替换 1 处（edit.txt，第 4 行附近）"), output);
  assert.ok(output.includes("    3│line three"), output);
  assert.ok(output.includes("    4│LINE FOUR"), output);
  assert.ok(output.includes("    5│line five"), output);
  assert.equal(
    readFileSync(path.join(workspace, "edit.txt"), "utf8"),
    content.replace("line four", "LINE FOUR"),
  );
});

test("fs：edit_file 0 匹配与空 old_string 返回可操作错误", async () => {
  expectFail(
    await runTool(editFileTool, { path: "edit.txt", old_string: "line eight", new_string: "x" }),
    "未找到匹配内容",
    "缩进/换行",
    "下一步",
  );
  expectFail(
    await runTool(editFileTool, { path: "edit.txt", old_string: "", new_string: "x" }),
    "old_string 不能为空",
    "下一步",
  );
});

test("fs：edit_file 多处匹配默认报错，replace_all 才全部替换", async () => {
  writeFileSync(path.join(workspace, "multi.txt"), "line\nline\nline\n", "utf8");
  expectFail(
    await runTool(editFileTool, { path: "multi.txt", old_string: "line", new_string: "row" }),
    "匹配到 3 处",
    "replace_all:true",
    "下一步",
  );

  const output = expectOk(
    await runTool(editFileTool, {
      path: "multi.txt",
      old_string: "line",
      new_string: "row",
      replace_all: true,
    }),
  );
  assert.ok(output.includes("已替换 3 处"), output);
  assert.equal(readFileSync(path.join(workspace, "multi.txt"), "utf8"), "row\nrow\nrow\n");
});

test("fs：edit_file 兼容 CRLF 文件且不把整文件改成 LF", async () => {
  writeFileSync(path.join(workspace, "crlf.txt"), "alpha\r\nbeta\r\ngamma\r\n", "utf8");

  const output = expectOk(
    await runTool(editFileTool, { path: "crlf.txt", old_string: "beta", new_string: "BETA" }),
  );
  assert.ok(output.includes("保留 CRLF 换行"), output);
  assert.equal(readFileSync(path.join(workspace, "crlf.txt"), "utf8"), "alpha\r\nBETA\r\ngamma\r\n");

  // old_string 用 LF 写法也应能匹配 CRLF 文件（统一成 \n 再找）。
  expectOk(
    await runTool(editFileTool, { path: "crlf.txt", old_string: "BETA\ngamma", new_string: "B\ngamma" }),
  );
  assert.equal(readFileSync(path.join(workspace, "crlf.txt"), "utf8"), "alpha\r\nB\r\ngamma\r\n");
});

test("fs：edit_file 对 LF 文件不引入 CRLF", async () => {
  writeFileSync(path.join(workspace, "lf.txt"), "x\ny\n", "utf8");
  expectOk(
    await runTool(editFileTool, { path: "lf.txt", old_string: "x", new_string: "x\r\nz" }),
  );
  assert.equal(readFileSync(path.join(workspace, "lf.txt"), "utf8"), "x\nz\ny\n");
});

test("fs：read/write/edit 都拒绝越界路径", async () => {
  expectFail(await runTool(readFileTool, { path: "../evil.txt" }), "不安全的路径", "下一步");
  expectFail(
    await runTool(writeFileTool, { path: "../evil.txt", content: "x" }),
    "不安全的路径",
    "下一步",
  );
  expectFail(
    await runTool(editFileTool, { path: "../evil.txt", old_string: "a", new_string: "b" }),
    "不安全的路径",
    "下一步",
  );
  const outside = path.join(tmpdir(), `mewagent-fs-outside-${process.pid}.txt`);
  expectFail(await runTool(readFileTool, { path: outside }), "不安全的路径");

  // 确认越界写入没有真的落到工作区外。
  assert.equal(existsSync(path.join(path.dirname(workspace), "evil.txt")), false);
});

test("fs：参数类型错误返回可操作错误", async () => {
  expectFail(await runTool(readFileTool, {}), "path 必须是字符串", "下一步");
  expectFail(await runTool(writeFileTool, { path: "a.txt" }), "content 必须是字符串");
  expectFail(
    await runTool(editFileTool, { path: "edit.txt", old_string: "x", new_string: 123 }),
    "new_string 必须是字符串",
  );
  expectFail(
    await runTool(editFileTool, { path: "edit.txt", old_string: "x", new_string: "y", replace_all: "yes" }),
    "replace_all 必须是布尔值",
  );
  expectFail(await runTool(readFileTool, { path: "edit.txt", offset: 0 }), "offset 必须是 ≥1 的整数");
  expectFail(await runTool(readFileTool, { path: "edit.txt", limit: 1.5 }), "limit 必须是 ≥1 的整数");
});

test("fs：只读标记与注册表集成", async () => {
  assert.equal(readFileTool.readOnly, true);
  assert.equal(writeFileTool.readOnly, false);
  assert.equal(editFileTool.readOnly, false);

  writeFileSync(path.join(workspace, "integrate.txt"), "hello\n", "utf8");
  const registry = new ToolRegistry(fsTools);
  assert.deepEqual(registry.names(), ["read_file", "write_file", "edit_file"]);
  const specs = registry.specs();
  assert.equal(specs.length, 3);
  for (const spec of specs) {
    assert.equal(spec.type, "function");
    assert.equal(spec.function.parameters["type"], "object");
  }

  const result = await registry.run(
    { id: "call_1", name: "read_file", arguments: JSON.stringify({ path: "integrate.txt" }) },
    { workspace },
  );
  assert.ok(expectOk(result).includes("integrate.txt（第 1–1 行，共 1 行）"), result.output);
});
