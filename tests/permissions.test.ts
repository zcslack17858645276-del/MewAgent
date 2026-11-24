// S3-1 单测：权限三道闸（工具存在 → 路径边界 → readOnly → 危险命令 → 会话白名单 → 人工询问）。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPermissionGate,
  summarizeToolCall,
  type ApprovalPrompt,
  type ApprovalRequest,
} from "../src/safety/permissions.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolCall, ToolDefinition } from "../src/types.js";

const workspace = mkdtempSync(path.join(tmpdir(), "mewagent-perm-"));

function makeTool(name: string, readOnly: boolean): ToolDefinition {
  return {
    name,
    description: `${name} 测试工具`,
    parameters: {},
    readOnly,
    run: async () => ({ ok: true, output: `${name} ok` }),
  };
}

const registry = new ToolRegistry([
  makeTool("read_file", true),
  makeTool("glob", true),
  makeTool("write_file", false),
  makeTool("bash", false),
]);

function makeCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: "call_1", name, arguments: JSON.stringify(args) };
}

interface AskRecorder {
  readonly ask: ApprovalPrompt;
  readonly requests: ApprovalRequest[];
}

function makeAsk(choices: readonly ("y" | "a" | "n")[] = ["y"]): AskRecorder {
  const requests: ApprovalRequest[] = [];
  const queue = [...choices];
  const ask: ApprovalPrompt = async (request) => {
    requests.push(request);
    return queue.shift() ?? "n";
  };
  return { ask, requests };
}

test.after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test("permissions：只读工具自动放行，不触发询问", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("read_file", { path: "README.md" }));
  assert.deepEqual(result, { allow: true });
  assert.equal(requests.length, 0);
});

test("permissions：写工具触发审批，选 y 放行并带上工具名与参数摘要", async () => {
  const { ask, requests } = makeAsk(["y"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.deepEqual(result, { allow: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.toolName, "write_file");
  assert.match(requests[0]?.summary ?? "", /a\.txt/);
});

test("permissions：选 n 时拒绝，原因具体且含工具名", async () => {
  const { ask } = makeAsk(["n"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /用户拒绝/);
  assert.match(result.reason, /write_file/);
});

test("permissions：选 a 后同类工具本会话不再询问，其他工具仍询问", async () => {
  const { ask, requests } = makeAsk(["a", "y"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });

  const first = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.deepEqual(first, { allow: true });
  assert.deepEqual(gate.whitelistedTools(), ["write_file"]);

  const second = await gate.gate(makeCall("write_file", { path: "b.txt", content: "hi" }));
  assert.deepEqual(second, { allow: true });
  assert.equal(requests.length, 1, "已放行的工具不应再次询问");

  const third = await gate.gate(makeCall("bash", { command: "echo hi" }));
  assert.deepEqual(third, { allow: true });
  assert.equal(requests.length, 2, "不同工具仍需询问");
});

test("permissions：未知工具直接拒绝，不询问", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("delete_everything", {}));
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /未知工具/);
  assert.match(result.reason, /read_file/);
  assert.equal(requests.length, 0);
});

test("permissions：非法 JSON 参数直接拒绝，不询问", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate({ id: "call_1", name: "bash", arguments: "{oops" });
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /JSON/);
  assert.equal(requests.length, 0);
});

test("permissions：路径越界的写操作在审批前被拒绝", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("write_file", { path: "../evil.txt", content: "x" }));
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /路径越界/);
  assert.equal(requests.length, 0);
});

test("permissions：路径越界的读取同样被拒绝（边界先于 readOnly）", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("read_file", { path: "..\\secret.txt" }));
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /路径越界/);
  assert.equal(requests.length, 0);
});

test("permissions：危险命令硬拦截，且不弹审批", async () => {
  const { ask, requests } = makeAsk(["y"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("bash", { command: "rm -rf /" }));
  assert.equal(result.allow, false);
  if (result.allow) return;
  assert.match(result.reason, /危险命令/);
  assert.match(result.reason, /rm -rf/);
  assert.equal(requests.length, 0, "危险命令不应进入人工审批");
});

test("permissions：安全命令进入审批，选 y 放行", async () => {
  const { ask, requests } = makeAsk(["y"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("bash", { command: "echo 你好" }));
  assert.deepEqual(result, { allow: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.summary ?? "", /echo 你好/);
});

test("permissions：危险字样出现在文件内容里不算危险命令", async () => {
  const { ask } = makeAsk(["y"]);
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(
    makeCall("write_file", { path: "notes.txt", content: "rm -rf / 只是文档里的示例" }),
  );
  assert.deepEqual(result, { allow: true });
});

test("permissions：headless 模式只读工具放行", async () => {
  const { ask, requests } = makeAsk();
  const gate = createPermissionGate({ tools: registry, workspace, mode: "headless", ask });
  const result = await gate.gate(makeCall("glob", { pattern: "**/*.ts" }));
  assert.deepEqual(result, { allow: true });
  assert.equal(requests.length, 0);
});

test("permissions：headless 模式写工具与 bash 直接拒绝并说明", async () => {
  const gate = createPermissionGate({ tools: registry, workspace, mode: "headless" });
  const writeResult = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.equal(writeResult.allow, false);
  if (!writeResult.allow) assert.match(writeResult.reason, /headless/);

  const bashResult = await gate.gate(makeCall("bash", { command: "echo hi" }));
  assert.equal(bashResult.allow, false);
  if (!bashResult.allow) assert.match(bashResult.reason, /headless/);
});

test("permissions：headless 下危险命令仍按危险命令拒绝（原因优先）", async () => {
  const gate = createPermissionGate({ tools: registry, workspace, mode: "headless" });
  const result = await gate.gate(makeCall("bash", { command: "del /f /s /q C:\\data" }));
  assert.equal(result.allow, false);
  if (!result.allow) assert.match(result.reason, /危险命令/);
});

test("permissions：没有审批界面时写操作拒绝且说明原因", async () => {
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive" });
  const result = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.equal(result.allow, false);
  if (!result.allow) assert.match(result.reason, /审批界面/);
});

test("permissions：审批函数抛异常按拒绝处理", async () => {
  const ask: ApprovalPrompt = async () => {
    throw new Error("界面崩了");
  };
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive", ask });
  const result = await gate.gate(makeCall("write_file", { path: "a.txt", content: "hi" }));
  assert.equal(result.allow, false);
  if (!result.allow) assert.match(result.reason, /审批过程失败/);
});

test("permissions：glob 默认路径在工作区内可读；越界路径被拒", async () => {
  const gate = createPermissionGate({ tools: registry, workspace, mode: "interactive" });
  const inside = await gate.gate(makeCall("glob", { pattern: "**/*.ts" }));
  assert.deepEqual(inside, { allow: true });
  const outside = await gate.gate(makeCall("glob", { pattern: "**/*.ts", path: ".." }));
  assert.equal(outside.allow, false);
});

test("summarizeToolCall：bash 显示命令、路径工具显示路径与 pattern、超长截断", () => {
  assert.equal(summarizeToolCall("bash", { command: "echo hi" }), "$ echo hi");
  assert.equal(summarizeToolCall("read_file", { path: "src/index.ts" }), "src/index.ts");
  assert.equal(
    summarizeToolCall("grep", { pattern: "TODO", path: "src" }),
    "src · pattern: TODO",
  );
  assert.equal(summarizeToolCall("unknown_tool", {}), "（无参数）");
  const long = summarizeToolCall("bash", { command: "x".repeat(300) });
  assert.ok(long.length <= 161, `摘要应截断，实际 ${long.length}`);
  assert.ok(long.endsWith("…"));
});
