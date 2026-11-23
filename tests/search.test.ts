import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ToolRegistry } from "../src/tools/registry.js";
import { globTool, grepTool, searchTools } from "../src/tools/search.js";
import type { ToolDefinition, ToolResult, ToolRunContext } from "../src/types.js";

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "mewagent-search-"));
  writeFileSync(path.join(workspace, "README.md"), "hello mewcode\n", "utf8");
  mkdirSync(path.join(workspace, "src", "nested"), { recursive: true });
  writeFileSync(path.join(workspace, "src", "a.ts"), "export const a = 1;\n", "utf8");
  writeFileSync(path.join(workspace, "src", "nested", "b.ts"), "中文内容：你好 mewcode\n", "utf8");
  writeFileSync(path.join(workspace, "notes.txt"), "line1\nline2\nTODO first\nline4 TODO second\n", "utf8");
  writeFileSync(path.join(workspace, "a.txt"), "aaa\n", "utf8");
  writeFileSync(path.join(workspace, "b.txt"), "bbb\n", "utf8");
  writeFileSync(path.join(workspace, "c.txt"), "ccc\n", "utf8");
  mkdirSync(path.join(workspace, "node_modules", "dep"), { recursive: true });
  writeFileSync(path.join(workspace, "node_modules", "dep", "index.js"), "mewcode in deps\n", "utf8");
  mkdirSync(path.join(workspace, ".git"), { recursive: true });
  writeFileSync(path.join(workspace, ".git", "config"), "mewcode in git\n", "utf8");
  writeFileSync(path.join(workspace, "binary.bin"), Buffer.from([0x6d, 0x65, 0x00, 0x77, 0x63, 0x6f, 0x64, 0x65]));
  mkdirSync(path.join(workspace, "bulk"), { recursive: true });
  for (let index = 0; index < 250; index += 1) {
    writeFileSync(path.join(workspace, "bulk", `f${String(index).padStart(3, "0")}.txt`), "x\n", "utf8");
  }
  mkdirSync(path.join(workspace, "longnames"), { recursive: true });
  const longName = "l".repeat(180);
  for (let index = 0; index < 250; index += 1) {
    writeFileSync(path.join(workspace, "longnames", `${longName}${String(index).padStart(3, "0")}.txt`), "y\n", "utf8");
  }
  const manyHits = Array.from({ length: 130 }, (_, index) => `mewcode hit ${index + 1}`).join("\n") + "\n";
  writeFileSync(path.join(workspace, "many.txt"), manyHits, "utf8");
  const bigLines = Array.from({ length: 200_000 }, (_, index) => `noise line ${index + 1}`);
  bigLines[99_999] = "mewcode deep hit";
  writeFileSync(path.join(workspace, "big.log"), bigLines.join("\n") + "\n", "utf8");
  return workspace;
}

const workspace = createWorkspace();
const context: ToolRunContext = { workspace };

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function expectOk(result: ToolResult): string {
  assert.equal(result.ok, true, result.output);
  return result.output;
}

function expectFail(result: ToolResult, ...fragments: readonly string[]): string {
  assert.equal(result.ok, false, result.output);
  assert.ok(result.output.startsWith("Error:"), result.output);
  for (const fragment of fragments) {
    assert.ok(result.output.includes(fragment), `缺少「${fragment}」：\n${result.output}`);
  }
  return result.output;
}

async function run(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResult> {
  return tool.run(args, context);
}

function dataLines(output: string): string[] {
  // 跳过头部（含 pattern 原文，可能带 .txt 等字样）与尾部提示行。
  return output
    .split("\n")
    .slice(1)
    .filter((line) => /\.(ts|txt|md|log|js|bin)/.test(line) && !line.startsWith("…"));
}

test("search：glob 支持 * / ** / ? / 字符类", async () => {
  const all = expectOk(await run(globTool, { pattern: "**/*.ts" }));
  assert.ok(all.includes("src/a.ts"), all);
  assert.ok(all.includes("src/nested/b.ts"), all);
  assert.ok(all.includes("匹配到 2 个文件"), all);

  const topLevel = expectOk(await run(globTool, { pattern: "*.md" }));
  assert.ok(topLevel.includes("README.md"), topLevel);
  assert.ok(!topLevel.includes("src/"), topLevel);

  const singleLayer = expectOk(await run(globTool, { pattern: "src/*.ts" }));
  assert.ok(singleLayer.includes("src/a.ts"), singleLayer);
  assert.ok(!singleLayer.includes("src/nested/b.ts"), singleLayer);

  const midRecursive = expectOk(await run(globTool, { pattern: "src/**/b.ts" }));
  assert.ok(midRecursive.includes("src/nested/b.ts"), midRecursive);

  const charClass = expectOk(await run(globTool, { pattern: "[ab].txt" }));
  assert.ok(charClass.includes("a.txt"), charClass);
  assert.ok(charClass.includes("b.txt"), charClass);
  assert.ok(!charClass.includes("c.txt"), charClass);

  const wildcard = expectOk(await run(globTool, { pattern: "?.txt" }));
  assert.ok(wildcard.includes("a.txt"), wildcard);
  assert.ok(wildcard.includes("c.txt"), wildcard);
});

test("search：glob 跳过 .git 与 node_modules", async () => {
  const deps = expectOk(await run(globTool, { pattern: "**/index.js" }));
  assert.ok(deps.includes("没有匹配的文件"), deps);
  const git = expectOk(await run(globTool, { pattern: "**/config" }));
  assert.ok(!git.includes(".git/config"), git);
  const everything = expectOk(await run(globTool, { pattern: "**/*" }));
  assert.ok(!everything.includes("node_modules/"), everything);
  assert.ok(!everything.includes(".git/"), everything);
});

test("search：glob 200 条上限与 30KB 输出上限", async () => {
  const limited = expectOk(await run(globTool, { pattern: "bulk/*.txt" }));
  assert.ok(limited.includes("匹配到 250 个文件"), limited);
  assert.ok(limited.includes("只显示前 200 个"), limited);
  assert.ok(limited.includes(`结果超过 ${200} 条`), limited);
  assert.equal(dataLines(limited).length, 200);

  const longOutput = expectOk(await run(globTool, { pattern: "longnames/*.txt" }));
  assert.ok(longOutput.includes("输出已截断"), longOutput.slice(0, 200));
  assert.ok(Buffer.byteLength(longOutput, "utf8") <= 30 * 1024 + 300, `输出过大：${Buffer.byteLength(longOutput, "utf8")}`);
});

test("search：glob 无匹配与参数错误给可操作提示", async () => {
  const none = expectOk(await run(globTool, { pattern: "**/*.rs" }));
  assert.ok(none.includes("没有匹配的文件"), none);
  assert.ok(none.includes("下一步"), none);

  expectFail(await run(globTool, {}), "缺少参数 pattern", "下一步");
  expectFail(await run(globTool, { pattern: "" }), "缺少参数 pattern");
  expectFail(await run(globTool, { pattern: "**/*.ts", path: "../outside" }), "不安全的路径", "下一步");
  expectFail(await run(globTool, { pattern: "*.ts", path: "nope" }), "路径不存在", "下一步");
  expectFail(await run(globTool, { pattern: "*.ts", path: "README.md" }), "必须是目录");
});

test("search：grep 返回 文件:行号:内容 且支持中文与正则", async () => {
  const chinese = expectOk(await run(grepTool, { pattern: "你好" }));
  assert.ok(chinese.includes("src/nested/b.ts:1:中文内容：你好 mewcode"), chinese);
  assert.ok(chinese.includes("匹配到"), chinese);

  const regex = expectOk(await run(grepTool, { pattern: "TODO\\b" }));
  assert.ok(regex.includes("notes.txt:3:TODO first"), regex);
  assert.ok(regex.includes("notes.txt:4:line4 TODO second"), regex);
});

test("search：grep 跳过 .git / node_modules / 二进制文件", async () => {
  const skippedDirs = expectOk(await run(grepTool, { pattern: "mewcode in deps|mewcode in git" }));
  assert.ok(skippedDirs.includes("没有匹配的内容"), skippedDirs);

  const readme = expectOk(await run(grepTool, { pattern: "hello mewcode" }));
  assert.ok(readme.includes("README.md:1:hello mewcode"), readme);

  const binary = expectOk(await run(grepTool, { pattern: "mewcode", path: "binary.bin" }));
  assert.ok(binary.includes("没有匹配的内容"), binary);
  assert.ok(!binary.includes("binary.bin:1:"), binary);
});

test("search：grep 100 条上限", async () => {
  const limited = expectOk(await run(grepTool, { pattern: "mewcode hit" }));
  assert.ok(limited.includes("匹配到 100 处"), limited);
  assert.ok(limited.includes("只显示前 100 处"), limited);
  assert.ok(limited.includes("结果超过 100 处"), limited);
  assert.equal(limited.split("\n").filter((line) => line.includes("many.txt:")).length, 100);
});

test("search：grep 支持 path 限定到目录或单个文件", async () => {
  const inSrc = expectOk(await run(grepTool, { pattern: "mewcode", path: "src" }));
  assert.ok(inSrc.includes("src/a.ts") || inSrc.includes("src/nested/b.ts"), inSrc);
  assert.ok(!inSrc.includes("README.md"), inSrc);

  const singleFile = expectOk(await run(grepTool, { pattern: "TODO", path: "notes.txt" }));
  assert.ok(singleFile.includes("notes.txt:3:TODO first"), singleFile);
  assert.ok(!singleFile.includes("README.md"), singleFile);
});

test("search：grep 对 200k 行大文件也能快速收敛", async () => {
  const startedAt = Date.now();
  const output = expectOk(await run(grepTool, { pattern: "mewcode deep" }));
  const elapsedMs = Date.now() - startedAt;
  assert.ok(output.includes("big.log:100000:mewcode deep hit"), output);
  assert.ok(elapsedMs < 5000, `grep 耗时过长：${elapsedMs}ms`);
});

test("search：grep 正则错误与参数错误给可操作提示", async () => {
  expectFail(await run(grepTool, { pattern: "(" }), "正则表达式无效", "下一步");
  expectFail(await run(grepTool, {}), "缺少参数 pattern", "下一步");
  expectFail(await run(grepTool, { pattern: "mewcode", path: "../outside" }), "不安全的路径", "下一步");
  expectFail(await run(grepTool, { pattern: "mewcode", path: "nope-dir" }), "路径不存在", "下一步");
  const none = expectOk(await run(grepTool, { pattern: "绝对不存在的字符串xyz" }));
  assert.ok(none.includes("没有匹配的内容"), none);
  assert.ok(none.includes("下一步"), none);
});

test("search：只读标记与注册表集成", async () => {
  const registry = new ToolRegistry(searchTools);
  assert.deepEqual([...registry.names()], ["glob", "grep"]);
  assert.equal(registry.size, 2);
  const specs = registry.specs();
  for (const spec of specs) {
    assert.equal(spec.type, "function");
    assert.deepEqual(Object.keys(spec.function).sort(), ["description", "name", "parameters"]);
  }
  assert.equal(globTool.readOnly, true);
  assert.equal(grepTool.readOnly, true);
  const result = await registry.run(
    { id: "call-1", name: "glob", arguments: JSON.stringify({ pattern: "*.md" }) },
    context,
  );
  assert.equal(result.ok, true);
  assert.ok(result.output.includes("README.md"), result.output);
});
