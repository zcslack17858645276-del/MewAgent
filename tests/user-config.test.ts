// 用户级结构化配置（`<用户配置目录>/config.json`）的读写测试。
// 覆盖：路径解析、缺失/损坏/已加载三态、合并写入、0600 权限（POSIX）。

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  USER_CONFIG_FILE_NAME,
  readUserConfig,
  resolveUserConfigDir,
  resolveUserConfigPath,
  saveUserConfig,
} from "../src/config.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mewagent-usercfg-"));
}

test("resolveUserConfigPath：默认在 ~/.mewcode，MEWCODE_HOME 可覆盖", () => {
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: dir } as NodeJS.ProcessEnv;
    assert.equal(resolveUserConfigDir(env), path.resolve(dir));
    assert.equal(
      resolveUserConfigPath(env),
      path.join(path.resolve(dir), USER_CONFIG_FILE_NAME),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readUserConfig：文件不存在返回 missing", () => {
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: dir } as NodeJS.ProcessEnv;
    const result = readUserConfig(env);
    assert.equal(result.kind, "missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveUserConfig/readUserConfig：写入并读回，目录自动创建", () => {
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: path.join(dir, "nested", "home") } as NodeJS.ProcessEnv;
    const saved = saveUserConfig(env, {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-test-value",
    });
    assert.equal(saved.ok, true);
    const result = readUserConfig(env);
    assert.equal(result.kind, "loaded");
    if (result.kind !== "loaded") return;
    assert.deepEqual(result.config, {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-test-value",
    });
    // 文件内容是合法 JSON，且只包含三个字段。
    const raw = readFileSync(result.path, "utf8");
    assert.deepEqual(Object.keys(JSON.parse(raw) as object).sort(), [
      "apiKey",
      "baseUrl",
      "model",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveUserConfig：合并旧配置，空串视为保留旧值", () => {
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: dir } as NodeJS.ProcessEnv;
    saveUserConfig(env, { baseUrl: "https://a.example.com", apiKey: "sk-old" });
    const saved = saveUserConfig(env, { model: "deepseek-chat", apiKey: "" });
    assert.equal(saved.ok, true);
    const result = readUserConfig(env);
    assert.equal(result.kind, "loaded");
    if (result.kind !== "loaded") return;
    assert.equal(result.config.baseUrl, "https://a.example.com");
    assert.equal(result.config.model, "deepseek-chat");
    assert.equal(result.config.apiKey, "sk-old");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readUserConfig：非法 JSON / 顶层非对象 / 字段类型不对都能降级", () => {
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: dir } as NodeJS.ProcessEnv;
    const filePath = resolveUserConfigPath(env);

    writeFileSync(filePath, "{ not json", "utf8");
    const brokenJson = readUserConfig(env);
    assert.equal(brokenJson.kind, "corrupt");

    writeFileSync(filePath, "[]", "utf8");
    const notObject = readUserConfig(env);
    assert.equal(notObject.kind, "corrupt");

    writeFileSync(
      filePath,
      JSON.stringify({ model: 123, baseUrl: "", apiKey: "  sk-trim-me  " }),
      "utf8",
    );
    const filtered = readUserConfig(env);
    assert.equal(filtered.kind, "loaded");
    if (filtered.kind !== "loaded") return;
    assert.deepEqual(filtered.config, { apiKey: "sk-trim-me" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveUserConfig：POSIX 上尽量收紧为 0600", (t) => {
  if (process.platform === "win32") {
    t.skip("Windows 上权限位语义有限");
    return;
  }
  const dir = makeTempDir();
  try {
    const env = { MEWCODE_HOME: dir } as NodeJS.ProcessEnv;
    const saved = saveUserConfig(env, { apiKey: "sk-perm" });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const mode = statSync(saved.path).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
