// S3-3 会话持久化：加载/保存/损坏降级/--new 的纯函数测试。
//
// 不依赖真实 TUI 或 LLM：全部在 mkdtemp 临时工作区里读写 session.json。

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_VERSION,
  loadSession,
  resolveSessionPath,
  saveSession,
} from "../src/session/store.js";
import type { Message } from "../src/types.js";

const root = mkdtempSync(path.join(tmpdir(), "mewagent-session-"));
let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(path.join(root, "ws-"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

const SAMPLE: readonly Message[] = [
  { role: "user", content: "读一下 README" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"README.md"}' }],
  },
  { role: "tool", toolCallId: "call_1", content: "# MewAgent" },
  { role: "assistant", content: "README 只有一行标题", toolCalls: [] },
];

test("resolveSessionPath：工作区下的 .mewcode/session.json", () => {
  const sessionPath = resolveSessionPath(workspace);
  assert.equal(sessionPath, path.join(workspace, ".mewcode", "session.json"));
});

test("保存后再加载：消息往返一致，文件字段符合 §6.8", () => {
  const saved = saveSession(workspace, "deepseek-chat", SAMPLE, {
    now: new Date("2026-11-24T03:00:00.000Z"),
  });
  assert.deepEqual(saved, { ok: true });

  const filePath = resolveSessionPath(workspace);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  assert.equal(raw["version"], SESSION_VERSION);
  assert.equal(raw["workspace"], path.resolve(workspace));
  assert.equal(raw["model"], "deepseek-chat");
  assert.equal(raw["createdAt"], "2026-11-24T03:00:00.000Z");
  assert.equal(raw["updatedAt"], "2026-11-24T03:00:00.000Z");
  assert.deepEqual(raw["messages"], SAMPLE);

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind !== "loaded") return;
  assert.deepEqual(loaded.messages, SAMPLE);
  assert.equal(loaded.createdAt, "2026-11-24T03:00:00.000Z");
  assert.equal(loaded.model, "deepseek-chat");
});

test("保存时剥离 system，且 assistant 的 toolCalls 原样保留", () => {
  const withSystem: Message[] = [
    { role: "system", content: "旧 prompt" },
    ...SAMPLE,
  ];
  assert.deepEqual(saveSession(workspace, "m", withSystem), { ok: true });

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind !== "loaded") return;
  assert.equal(loaded.messages.some((item) => item.role === "system"), false);
  const assistantWithCalls = loaded.messages[1];
  assert.equal(assistantWithCalls?.role, "assistant");
  if (assistantWithCalls?.role !== "assistant") return;
  assert.deepEqual(assistantWithCalls.toolCalls, [
    { id: "call_1", name: "read_file", arguments: '{"path":"README.md"}' },
  ]);
});

test("createdAt 可保留：已有会话追加保存时传入旧值", () => {
  saveSession(workspace, "m", SAMPLE, { createdAt: "2026-01-01T00:00:00.000Z" });
  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind !== "loaded") return;
  assert.equal(loaded.createdAt, "2026-01-01T00:00:00.000Z");
});

test("空消息不落盘，但返回成功", () => {
  assert.deepEqual(saveSession(workspace, "m", []), { ok: true });
  assert.deepEqual(loadSession(workspace), { kind: "empty" });
});

test("没有会话文件时加载为空会话", () => {
  assert.deepEqual(loadSession(workspace), { kind: "empty" });
});

test("--new（forceNew）跳过已有文件", () => {
  saveSession(workspace, "m", SAMPLE);
  assert.deepEqual(loadSession(workspace, { forceNew: true }), { kind: "empty" });
  // 文件仍在：forceNew 只是不加载，不删除
  assert.equal(loadSession(workspace).kind, "loaded");
});

test("损坏 JSON → corrupt 且原因可读", () => {
  const filePath = resolveSessionPath(workspace);
  mkdirSyncFor(filePath);
  writeFileSync(filePath, "{ 不是 JSON", "utf8");

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "corrupt");
  if (loaded.kind !== "corrupt") return;
  assert.match(loaded.reason, /不是合法 JSON/);
});

test("不认识的版本 → corrupt", () => {
  const filePath = resolveSessionPath(workspace);
  mkdirSyncFor(filePath);
  writeFileSync(
    filePath,
    JSON.stringify({ version: 99, messages: [] }),
    "utf8",
  );

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "corrupt");
  if (loaded.kind !== "corrupt") return;
  assert.match(loaded.reason, /不支持的会话版本：99/);
});

test("messages 不是数组 → corrupt", () => {
  const filePath = resolveSessionPath(workspace);
  mkdirSyncFor(filePath);
  writeFileSync(
    filePath,
    JSON.stringify({ version: SESSION_VERSION, messages: {} }),
    "utf8",
  );

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "corrupt");
  if (loaded.kind !== "corrupt") return;
  assert.match(loaded.reason, /messages 不是数组/);
});

test("单条消息结构无效 → corrupt 并指出序号", () => {
  const filePath = resolveSessionPath(workspace);
  mkdirSyncFor(filePath);
  writeFileSync(
    filePath,
    JSON.stringify({
      version: SESSION_VERSION,
      messages: [{ role: "tool", content: "没有 toolCallId" }],
    }),
    "utf8",
  );

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "corrupt");
  if (loaded.kind !== "corrupt") return;
  assert.match(loaded.reason, /第 1 条消息结构无效/);
});

test("手动文件里混入 system：加载时跳过而不是报错", () => {
  const filePath = resolveSessionPath(workspace);
  mkdirSyncFor(filePath);
  writeFileSync(
    filePath,
    JSON.stringify({
      version: SESSION_VERSION,
      createdAt: "2026-02-02T00:00:00.000Z",
      model: "m",
      messages: [
        { role: "system", content: "旧 system" },
        { role: "user", content: "你好" },
      ],
    }),
    "utf8",
  );

  const loaded = loadSession(workspace);
  assert.equal(loaded.kind, "loaded");
  if (loaded.kind !== "loaded") return;
  assert.deepEqual(loaded.messages, [{ role: "user", content: "你好" }]);
  assert.equal(loaded.createdAt, "2026-02-02T00:00:00.000Z");
});

test("保存成功不残留 .tmp 文件", () => {
  saveSession(workspace, "m", SAMPLE);
  const dir = path.join(workspace, ".mewcode");
  assert.deepEqual(readdirSync(dir), ["session.json"]);
});

test("保存失败（父路径是文件）返回 ok:false 而不是抛异常", () => {
  const blocker = path.join(workspace, "blocker");
  writeFileSync(blocker, "x", "utf8");
  const result = saveSession(blocker, "m", SAMPLE);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.notEqual(result.reason, "");
});

/** 在会话文件路径上建好 .mewcode 目录（写坏文件的测试用）。 */
function mkdirSyncFor(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}
