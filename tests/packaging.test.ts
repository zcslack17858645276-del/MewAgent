// S4-3 打包与启动：静态检查 bin / prepack / shebang 是否正确配置。
// 真正的 `npm link` / `npx .` 手工验证见 docs/testing.md S4-3（A 级记录在 HANDOFF §7 会话 31）。
// 这里只做不依赖网络与全局环境的回归：package.json 元数据与入口脚本首行。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readManifest(): PackageManifest {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(raw) as PackageManifest;
}

test("package.json 暴露 mewagent bin 且指向构建产物", () => {
  const manifest = readManifest();
  assert.equal(manifest.name, "mewagent");
  assert.equal(manifest.bin?.mewagent, "./dist/index.js");
});

test("prepack 会先构建，保证 npx/npm pack 的产物含 dist", () => {
  const manifest = readManifest();
  assert.equal(manifest.scripts?.prepack, "npm run build");
  assert.ok(manifest.scripts?.build !== undefined);
});

test("files 白名单包含 dist 与对外文档，避免把源码/测试打进 tarball", () => {
  const manifest = readManifest();
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files?.includes("dist"));
  assert.ok(manifest.files?.includes("README.md"));
  assert.ok(!manifest.files?.includes("tests"));
  assert.ok(!manifest.files?.includes("spikes"));
});

test("入口脚本带 node shebang（跨平台 bin 执行）", () => {
  const source = readFileSync(path.join(repoRoot, "src", "index.ts"), "utf8");
  assert.match(source, /^#!\/usr\/bin\/env node\r?\n/);
  assert.match(source, /process\.exitCode = await main\(/);
});

test("engines 声明 Node >= 22（与 README 一致）", () => {
  const manifest = readManifest();
  assert.equal(manifest.engines?.node, ">=22");
});
