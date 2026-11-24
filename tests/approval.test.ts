// S3-2 审批桥 + 审批弹窗的单元测试。
//
// 这里不驱动真实终端按键（那属于 B 级手工验收）：ApprovalPrompt 的按键映射
// 由 Ink 的 useInput 提供，单测用 renderToString 验证「显示了什么」；「按了
// 之后发生什么」通过 controller 与真实 permission gate 的集成来验证。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "ink";

import { createPermissionGate } from "../src/safety/permissions.js";
import type { ApprovalRequest } from "../src/safety/permissions.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolDefinition, ToolResult } from "../src/types.js";
import { createApprovalController } from "../src/ui/approval.js";
import { ApprovalPrompt } from "../src/ui/ApprovalPrompt.js";

const workspace = mkdtempSync(path.join(tmpdir(), "mewagent-approval-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function okResult(): ToolResult {
  return { ok: true, output: "ok" };
}

function makeWriteTool(name: string): ToolDefinition {
  return {
    name,
    description: "测试用写工具",
    parameters: { type: "object" },
    readOnly: false,
    run: async () => okResult(),
  };
}

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    toolName: "write_file",
    readOnly: false,
    summary: 'write_file {"path":"a.txt"}',
    ...overrides,
  };
}

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

describe("approval controller", () => {
  test("ask 暴露 pending、respond 解决为 y 并清空", async () => {
    const controller = createApprovalController();
    let notified = 0;
    controller.subscribe(() => {
      notified += 1;
    });

    const pending = controller.ask(request());
    assert.equal(notified, 1);
    assert.equal(controller.current()?.toolName, "write_file");
    assert.equal(controller.respond("y"), true);
    assert.equal(controller.current(), null);
    assert.equal(await pending, "y");
  });

  test("respond a / n 原样返回；没有 pending 时 respond 返回 false", () => {
    const controller = createApprovalController();
    assert.equal(controller.respond("y"), false);

    void controller.ask(request({ toolName: "edit_file" }));
    assert.equal(controller.respond("a"), true);
    assert.equal(controller.current(), null);
    assert.equal(controller.respond("n"), false);
  });

  test("subscribe 返回的取消函数生效", () => {
    const controller = createApprovalController();
    let notified = 0;
    const unsubscribe = controller.subscribe(() => {
      notified += 1;
    });
    unsubscribe();
    void controller.ask(request());
    assert.equal(notified, 0);
  });

  test("重叠审批请求被拒绝（agent loop 串行，真重叠说明有 bug）", async () => {
    const controller = createApprovalController();
    const first = controller.ask(request());
    await assert.rejects(controller.ask(request({ toolName: "bash" })));
    controller.respond("n");
    assert.equal(await first, "n");
  });
});

describe("approval controller × permission gate", () => {
  function makeGate() {
    const tools = new ToolRegistry([makeWriteTool("write_file"), makeWriteTool("bash")]);
    const controller = createApprovalController();
    const gate = createPermissionGate({
      tools,
      workspace,
      mode: "interactive",
      ask: controller.ask,
    });
    return { controller, gate, tools };
  }

  test("选 a 后同类操作不再询问（白名单生效）", async () => {
    const { controller, gate } = makeGate();
    const call = {
      id: "call_1",
      name: "write_file",
      arguments: '{"path":"a.txt","content":"x"}',
    };

    const first = gate.gate(call);
    // 让 ask 进入 pending。
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(controller.current()?.toolName, "write_file");
    // 路径类工具的摘要只显示路径本身（具体工具名在 request.toolName 里）。
    assert.match(controller.current()?.summary ?? "", /a\.txt/);
    controller.respond("a");
    assert.deepEqual(await first, { allow: true });

    // 第二次同类调用：直接放行，不再产生 pending。
    const second = gate.gate(call);
    assert.deepEqual(await second, { allow: true });
    assert.equal(controller.current(), null);
    assert.deepEqual(gate.whitelistedTools(), ["write_file"]);
  });

  test("选 n 拒绝并把具体工具/摘要回填", async () => {
    const { controller, gate } = makeGate();
    const call = { id: "call_2", name: "bash", arguments: '{"command":"echo hi"}' };

    const pending = gate.gate(call);
    await new Promise((resolve) => setImmediate(resolve));
    controller.respond("n");
    const decision = await pending;
    assert.equal(decision.allow, false);
    assert.match(decision.allow === false ? decision.reason : "", /用户拒绝了 bash/);
    assert.match(decision.allow === false ? decision.reason : "", /echo hi/);
  });

  test("审批前 abort（Esc 由 UI 映射为 n）也走拒绝路径", async () => {
    const { controller, gate } = makeGate();
    const pending = gate.gate({
      id: "call_3",
      name: "write_file",
      arguments: '{"path":"b.txt","content":"x"}',
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.respond("n");
    const decision = await pending;
    assert.equal(decision.allow, false);
  });
});

describe("ApprovalPrompt 渲染", () => {
  test("显示工具名、摘要、写操作标记与四个按键提示", () => {
    const output = stripAnsi(
      renderToString(createElement(ApprovalPrompt, { request: request(), onDecision: () => {} })),
    );
    assert.match(output, /需要审批/);
    assert.match(output, /write_file/);
    assert.match(output, /写操作/);
    assert.match(output, /a\.txt/);
    assert.match(output, /y/);
    assert.match(output, /本会话总是允许此工具/);
    assert.match(output, /Esc/);
  });

  test("只读请求显示只读；reason 存在时展示", () => {
    const output = stripAnsi(
      renderToString(
        createElement(ApprovalPrompt, {
          request: request({ toolName: "glob", readOnly: true, reason: "路径越界提示" }),
          onDecision: () => {},
        }),
      ),
    );
    assert.match(output, /只读/);
    assert.match(output, /路径越界提示/);
  });
});
