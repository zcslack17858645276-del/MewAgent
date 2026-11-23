import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  UnsafePathError,
  isInsideWorkspace,
  resolveInside,
  resolveWorkspace,
  toPosixPath,
  toWorkspaceRelative,
} from "../src/tools/paths.js";

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "mewagent-paths-"));
  mkdirSync(path.join(workspace, "src", "nested"), { recursive: true });
  mkdirSync(path.join(workspace, "中文 目录"), { recursive: true });
  writeFileSync(path.join(workspace, "src", "a.ts"), "export {};\n", "utf8");
  return workspace;
}

const workspace = createWorkspace();
const workspacePosix = toPosixPath(path.resolve(workspace));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function expectRejected(input: string): UnsafePathError {
  try {
    resolveInside(workspace, input);
  } catch (error) {
    assert.ok(error instanceof UnsafePathError, `expected UnsafePathError, got ${String(error)}`);
    assert.ok(error.message.includes("不安全的路径"), error.message);
    assert.ok(error.message.includes("下一步"), error.message);
    assert.equal(error.input, input);
    assert.equal(error.workspace, path.resolve(workspace));
    return error;
  }
  assert.fail(`expected path to be rejected: ${JSON.stringify(input)}`);
}

test("paths：拒绝 ../ 与 ..\\ 形式的越界", () => {
  assert.equal(expectRejected("../x").reason, "绝对路径在工作区外");
  if (process.platform === "win32") {
    assert.equal(expectRejected("..\\x").reason, "绝对路径在工作区外");
  } else {
    // POSIX 下反斜杠是合法文件名字符：`..\x` 是一个普通文件名，不会越界。
    assert.equal(resolveInside(workspace, "..\\x"), path.resolve(workspace, "..\\x"));
  }
  assert.equal(expectRejected("../../etc/passwd").reason, "绝对路径在工作区外");
  assert.equal(expectRejected("..").reason, "绝对路径在工作区外");
});

test("paths：拒绝工作区外的绝对路径（含 %TEMP%）", () => {
  const outsideFile = path.join(tmpdir(), `mewagent-outside-${process.pid}.txt`);
  assert.equal(expectRejected(outsideFile).reason, "绝对路径在工作区外");
  assert.equal(
    expectRejected(path.join(process.env["TEMP"] ?? tmpdir(), "evil.txt")).reason,
    "绝对路径在工作区外",
  );
});

test("paths：拒绝盘符绝对路径与盘符相对路径（Windows）", () => {
  if (process.platform !== "win32") {
    return;
  }
  assert.equal(
    expectRejected("C:\\Windows\\System32\\drivers\\etc\\hosts").reason,
    "绝对路径在工作区外",
  );
  assert.equal(expectRejected("C:evil.txt").reason, "不支持盘符相对路径");
});

test("paths：拒绝 %VAR% 与 ~ 展开写法", () => {
  assert.equal(expectRejected("%TEMP%\\evil.txt").reason, "不支持 %VAR% 环境变量展开");
  assert.equal(expectRejected("%USERPROFILE%/evil.txt").reason, "不支持 %VAR% 环境变量展开");
  assert.equal(expectRejected("~/evil.txt").reason, "不支持 ~ 用户目录展开");
  assert.equal(expectRejected("~\\evil.txt").reason, "不支持 ~ 用户目录展开");
});

test("paths：拒绝空输入、空白输入与 NUL 字符", () => {
  assert.equal(expectRejected("").reason, "输入为空");
  assert.equal(expectRejected("   ").reason, "输入为空");
  assert.equal(expectRejected("src/\0a.ts").reason, "路径包含 NUL 字符");
});

test("paths：允许工作区内相对路径并输出正斜杠绝对路径", () => {
  assert.equal(resolveInside(workspace, "src/a.ts"), `${workspacePosix}/src/a.ts`);
  assert.equal(resolveInside(workspace, "./a.ts"), `${workspacePosix}/a.ts`);
  // Windows 反斜杠是分隔符；POSIX 下它是合法文件名字符，输出不做斜杠替换。
  assert.equal(
    resolveInside(workspace, "src\\a.ts"),
    process.platform === "win32"
      ? `${workspacePosix}/src/a.ts`
      : path.resolve(workspace, "src\\a.ts"),
  );
  assert.equal(resolveInside(workspace, "src/../src/a.ts"), `${workspacePosix}/src/a.ts`);
  assert.equal(resolveInside(workspace, "."), workspacePosix);
});

test("paths：允许带空格与中文的文件名", () => {
  assert.equal(resolveInside(workspace, "中文 目录/文件.txt"), `${workspacePosix}/中文 目录/文件.txt`);
  assert.equal(resolveInside(workspace, "with space.txt"), `${workspacePosix}/with space.txt`);
});

test("paths：允许工作区内的绝对路径（保留原始大小写）", () => {
  const absolute = path.join(workspace, "src", "a.ts");
  assert.equal(resolveInside(workspace, absolute), toPosixPath(absolute));
});

test("paths：junction/symlink 指向工作区外时拒绝", (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), "mewagent-outside-"));
  const linkPath = path.join(workspace, "linked-outside");
  try {
    symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch {
    rmSync(outside, { recursive: true, force: true });
    t.skip("当前环境无法创建 junction/symlink");
    return;
  }
  try {
    assert.equal(expectRejected("linked-outside/evil.txt").reason, "路径通过符号链接/junction 指向工作区外");
    assert.equal(
      expectRejected("linked-outside/not-exists.txt").reason,
      "路径通过符号链接/junction 指向工作区外",
    );
  } finally {
    rmSync(linkPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("paths：isInsideWorkspace 与 toWorkspaceRelative", () => {
  const inside = path.join(workspace, "src", "a.ts");
  const outside = path.join(tmpdir(), "mewagent-not-here.txt");
  assert.equal(isInsideWorkspace(workspace, inside), true);
  assert.equal(isInsideWorkspace(workspace, workspace), true);
  assert.equal(isInsideWorkspace(workspace, outside), false);
  assert.equal(toWorkspaceRelative(workspace, inside), "src/a.ts");
  assert.equal(toWorkspaceRelative(workspace, workspace), ".");
  assert.equal(resolveWorkspace(workspace), path.resolve(workspace));
});
