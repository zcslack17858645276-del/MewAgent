import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GIT_BASH_PATH,
  MAX_TIMEOUT_MS,
  bashTool,
  bashTools,
  decodeOutput,
  resolveShell,
  truncateUtf8,
} from "../src/tools/bash.js";
import { MAX_TOOL_OUTPUT_BYTES } from "../src/tools/fs.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolResult, ToolRunContext } from "../src/types.js";

const workspace = mkdtempSync(path.join(tmpdir(), "mewagent-bash-"));
const context: ToolRunContext = { workspace };

after(async () => {
  // 超时用例可能留下被 kill 的 shell 的孙进程（Windows 限制），它暂时占用 temp 目录作为 cwd，
  // 直接 rmSync 会 EPERM；重试几次给它退出时间。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(workspace, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
});

function expectOk(result: ToolResult): string {
  assert.equal(result.ok, true, result.output);
  return result.output;
}

function expectFail(result: ToolResult, ...fragments: readonly string[]): string {
  assert.equal(result.ok, false, result.output);
  for (const fragment of fragments) {
    assert.ok(result.output.includes(fragment), `期望输出包含 ${JSON.stringify(fragment)}：\n${result.output}`);
  }
  return result.output;
}

function run(args: Record<string, unknown>): Promise<ToolResult> {
  return bashTool.run(args, context);
}

/** 跨平台的长命令：cmd 用 ping，bash/shell 用 sleep（test 由 resolveShell 决定，不依赖 Git Bash 是否安装）。 */
function longRunningCommand(): string {
  const plan = resolveShell(process.platform, process.env);
  // 命令刻意选"孙进程寿命短"的：cmd 被 kill 后 ping 可能残留，-n 4 让它几秒内自然退出，
  // 避免测试结束后仍占用临时目录（Windows 上 kill 只杀直接子进程）。
  return plan.prependChcp ? "ping -n 4 127.0.0.1 >nul" : "sleep 60";
}

function normalizePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase();
}

test("bash：基本命令返回 stdout、退出码 0", async () => {
  const output = expectOk(await run({ command: 'node -e "console.log(\'bash-ok\')"' }));
  assert.ok(output.includes("bash-ok"), output);
  assert.ok(output.includes("退出码：0"), output);
  assert.ok(output.includes("stdout:"), output);
  assert.ok(output.includes("stderr:"), output);
});

test("bash：中文输出按 UTF-8 解码不乱码", async () => {
  const output = expectOk(await run({ command: 'node -e "console.log(\'你好，世界\')"' }));
  assert.ok(output.includes("你好，世界"), output);
  assert.ok(!output.includes("\uFFFD"), output);
});

test("bash：stderr 被单独捕获", async () => {
  const output = expectOk(await run({ command: 'node -e "console.error(\'警告信息\')"' }));
  assert.ok(output.includes("警告信息"), output);
  assert.ok(output.includes("stderr:"), output);
});

test("bash：非 0 退出码返回 ok:false 且带 stdout/stderr 与下一步", async () => {
  const output = expectFail(
    await run({ command: 'node -e "console.log(\'before-fail\'); process.exit(3)"' }),
    "Error: 命令退出码 3",
    "before-fail",
    "下一步",
  );
  assert.ok(output.includes("退出码：3"), output);
});

test("bash：超时命令被终止并返回超时错误", async () => {
  const startedAt = Date.now();
  const output = await run({ command: longRunningCommand(), timeout_ms: 1200 });
  const elapsed = Date.now() - startedAt;
  expectFail(output, "Error: 命令超时", "已被终止", "下一步");
  assert.ok(elapsed < 15_000, `超时后应在 15 秒内返回，实际 ${elapsed}ms`);
});

test("bash：超过 30KB 的输出被截断并提示", async () => {
  const output = expectOk(await run({ command: 'node -e "process.stdout.write(\'x\'.repeat(200000))"' }));
  assert.ok(output.includes("输出已截断"), "应提示输出已截断");
  assert.ok(Buffer.byteLength(output, "utf8") <= MAX_TOOL_OUTPUT_BYTES + 400, `截断后字节数应接近上限：${Buffer.byteLength(output, "utf8")}`);
  assert.ok(output.includes("read_file"), "应提示用 read_file 读取完整输出");
});

test("bash：截断不会切断多字节字符", async () => {
  const output = expectOk(await run({ command: 'node -e "process.stdout.write(\'中\'.repeat(20000))"' }));
  assert.ok(!output.includes("\uFFFD"), "截断不应产生替换字符");
  assert.ok(Buffer.byteLength(output, "utf8") <= MAX_TOOL_OUTPUT_BYTES + 400);
});

test("bash：cwd 固定为工作区", async () => {
  const output = expectOk(await run({ command: 'node -e "console.log(process.cwd())"' }));
  const lines = output.split("\n").map((line) => line.trim());
  assert.ok(
    lines.some((line) => normalizePath(line) === normalizePath(workspace)),
    `期望 stdout 中出现工作区路径 ${workspace}：\n${output}`,
  );
});

test("bash：command 缺失/为空/类型错误返回可操作错误", async () => {
  expectFail(await run({}), "参数 command 必须是字符串", "下一步");
  expectFail(await run({ command: "   " }), "参数 command 不能为空", "下一步");
  expectFail(await run({ command: 42 }), "参数 command 必须是字符串", "下一步");
});

test("bash：timeout_ms 越界返回可操作错误", async () => {
  expectFail(await run({ command: 'node -e "1"', timeout_ms: 500 }), "timeout_ms", "1000", "下一步");
  expectFail(await run({ command: 'node -e "1"', timeout_ms: MAX_TIMEOUT_MS + 1 }), "timeout_ms", "下一步");
  expectFail(await run({ command: 'node -e "1"', timeout_ms: "1000" }), "timeout_ms", "下一步");
});

test("bash：MEWCODE_SHELL 指向不存在的可执行文件时给出可操作错误", async () => {
  const previous = process.env["MEWCODE_SHELL"];
  process.env["MEWCODE_SHELL"] = path.join(workspace, "no-such-shell.exe");
  try {
    const output = expectFail(await run({ command: 'node -e "1"' }), "无法启动 shell", "下一步");
    assert.ok(output.includes("MEWCODE_SHELL"), output);
  } finally {
    if (previous === undefined) {
      delete process.env["MEWCODE_SHELL"];
    } else {
      process.env["MEWCODE_SHELL"] = previous;
    }
  }
});

test("bash：resolveShell 优先 MEWCODE_SHELL，其次 Windows Git Bash，最后 cmd", () => {
  const override = resolveShell("win32", { MEWCODE_SHELL: "C:\\tools\\bash.exe" }, () => false);
  assert.equal(override.command, "C:\\tools\\bash.exe");
  assert.deepEqual(override.args, ["-lc"]);

  const withGitBash = resolveShell("win32", {}, (candidate) => candidate === GIT_BASH_PATH);
  assert.equal(withGitBash.command, GIT_BASH_PATH);
  assert.deepEqual(withGitBash.args, ["-lc"]);

  const withoutGitBash = resolveShell("win32", { ComSpec: "C:\\Windows\\system32\\cmd.exe" }, () => false);
  assert.equal(withoutGitBash.command, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(withoutGitBash.args, ["/d", "/s", "/c"]);
  assert.equal(withoutGitBash.prependChcp, true);

  const posix = resolveShell("linux", { SHELL: "/bin/bash" }, () => false);
  assert.equal(posix.command, "/bin/bash");
  assert.deepEqual(posix.args, ["-c"]);
});

test("bash：decodeOutput 优先 UTF-8，失败回退 GBK；truncateUtf8 不切断代理对", () => {
  assert.equal(decodeOutput(Buffer.from("hello 你好", "utf8")), "hello 你好");
  assert.equal(decodeOutput(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), "你好");

  const exact = truncateUtf8("a😀b", 5);
  assert.deepEqual(exact, { text: "a😀", truncated: true });
  const whole = truncateUtf8("abc", 10);
  assert.deepEqual(whole, { text: "abc", truncated: false });
});

test("bash：readOnly=false，注册表集成可见 bash 工具", () => {
  assert.equal(bashTool.readOnly, false);
  assert.equal(bashTools.length, 1);
  assert.equal(bashTool.name, "bash");
  const registry = new ToolRegistry(bashTools);
  assert.deepEqual(registry.names(), ["bash"]);
  const spec = registry.specs()[0];
  assert.ok(spec !== undefined);
  assert.equal(spec.type, "function");
  assert.equal(spec.function.name, "bash");
  const required = spec.function.parameters["required"];
  assert.deepEqual(required, ["command"]);
});
