import assert from "node:assert/strict";
import { test } from "node:test";

import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolDefinition, ToolResult, ToolRunContext } from "../src/types.js";

const ctx: ToolRunContext = { workspace: "D:/workplace/testbed" };

function ok(output: string): ToolResult {
  return { ok: true, output };
}

interface Seen {
  args?: Record<string, unknown>;
  ctx?: ToolRunContext;
}

function createEchoTool(seen?: Seen): ToolDefinition {
  return {
    name: "echo",
    description: "回显参数，仅用于测试注册表。",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    readOnly: true,
    run: async (args, runCtx) => {
      if (seen !== undefined) {
        seen.args = args;
        seen.ctx = runCtx;
      }
      return ok(`echo:${String(args["text"] ?? "")}`);
    },
  };
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} 测试工具`,
    parameters: { type: "object", properties: {} },
    readOnly: false,
    run: async () => ok(`${name} done`),
  };
}

test("registry：specs() 输出 OpenAI tools 格式", () => {
  const echo = createEchoTool();
  const registry = new ToolRegistry([echo, createTool("write_file")]);
  assert.deepEqual(registry.specs(), [
    {
      type: "function",
      function: {
        name: "echo",
        description: echo.description,
        parameters: echo.parameters,
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "write_file 测试工具",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  // 每项只能有 type/function 两个顶层字段，function 只含 name/description/parameters。
  for (const spec of registry.specs()) {
    assert.deepEqual(Object.keys(spec).sort(), ["function", "type"]);
    assert.deepEqual(Object.keys(spec.function).sort(), ["description", "name", "parameters"]);
  }
});

test("registry：空注册表 specs() 为空数组", () => {
  assert.deepEqual(new ToolRegistry().specs(), []);
});

test("registry：names / size / has / get 与注册顺序", () => {
  const registry = new ToolRegistry([createTool("read_file"), createTool("glob")]);
  assert.deepEqual(registry.names(), ["read_file", "glob"]);
  assert.equal(registry.size, 2);
  assert.equal(registry.has("read_file"), true);
  assert.equal(registry.has("nope"), false);
  assert.equal(registry.get("glob")?.name, "glob");
  assert.equal(registry.get("nope"), undefined);
});

test("registry：重复注册或非法定义直接抛错（实现方 bug）", () => {
  const registry = new ToolRegistry([createTool("read_file")]);
  assert.throws(() => registry.register(createTool("read_file")), /已注册/);

  assert.throws(() => new ToolRegistry([{ ...createTool("x"), name: "   " }]), /name 必须是非空字符串/);
  assert.throws(() => new ToolRegistry([{ ...createTool("x"), description: "" }]), /description/);
  assert.throws(
    () =>
      new ToolRegistry([
        { ...createTool("x"), parameters: [] as unknown as Record<string, unknown> },
      ]),
    /parameters/,
  );
  assert.throws(
    () =>
      new ToolRegistry([
        { ...createTool("x"), run: undefined as unknown as ToolDefinition["run"] },
      ]),
    /缺少 run/,
  );
});

test("registry：未知工具返回可读错误与可用工具列表", async () => {
  const registry = new ToolRegistry([createEchoTool()]);
  const result = await registry.run({ id: "call_1", name: "rm_rf", arguments: "{}" }, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.output.startsWith("Error:"), result.output);
  assert.match(result.output, /未知工具 "rm_rf"/);
  assert.match(result.output, /可用工具：echo/);
  assert.match(result.output, /下一步/);
});

test("registry：非法 JSON 返回 ok:false，不抛异常", async () => {
  const registry = new ToolRegistry([createEchoTool()]);
  const result = await registry.run({ id: "call_1", name: "echo", arguments: "{oops" }, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.output.startsWith("Error:"), result.output);
  assert.match(result.output, /工具 echo/);
  assert.match(result.output, /不是合法 JSON/);
  assert.match(result.output, /下一步/);
});

test("registry：参数是数组/字符串/数字时拒绝（必须是 JSON 对象）", async () => {
  const registry = new ToolRegistry([createEchoTool()]);
  const arrayResult = await registry.run({ id: "c", name: "echo", arguments: "[1,2]" }, ctx);
  assert.equal(arrayResult.ok, false);
  assert.match(arrayResult.output, /必须是 JSON 对象（收到 数组）/);

  const stringResult = await registry.run({ id: "c", name: "echo", arguments: '"x"' }, ctx);
  assert.equal(stringResult.ok, false);
  assert.match(stringResult.output, /必须是 JSON 对象（收到 string）/);

  const numberResult = await registry.run(
    { id: "c", name: "echo", arguments: 42 as unknown as string },
    ctx,
  );
  assert.equal(numberResult.ok, false);
  assert.match(numberResult.output, /arguments 不是字符串（收到 number）/);
});

test("registry：空 arguments 按 {} 处理并执行工具", async () => {
  const seen: Seen = {};
  const registry = new ToolRegistry([createEchoTool(seen)]);
  const result = await registry.run({ id: "c", name: "echo", arguments: "   " }, ctx);
  assert.equal(result.ok, true);
  assert.deepEqual(seen.args, {});
  assert.deepEqual(seen.ctx, ctx);
});

test("registry：合法参数解析后交给工具，结果原样返回", async () => {
  const seen: Seen = {};
  const registry = new ToolRegistry([createEchoTool(seen)]);
  const result = await registry.run(
    { id: "c", name: "echo", arguments: '{"text":"你好"}' },
    ctx,
  );
  assert.deepEqual(result, { ok: true, output: "echo:你好" });
  assert.deepEqual(seen.args, { text: "你好" });
  assert.equal(seen.ctx?.workspace, ctx.workspace);
});

test("registry：工具自己的 ok:false 原样透传", async () => {
  const failing: ToolDefinition = {
    ...createTool("write_file"),
    run: async () => ({ ok: false, output: "Error: 目标路径在工作区外" }),
  };
  const registry = new ToolRegistry([failing]);
  const result = await registry.run({ id: "c", name: "write_file", arguments: "{}" }, ctx);
  assert.deepEqual(result, { ok: false, output: "Error: 目标路径在工作区外" });
});

test("registry：工具抛 Error / 非 Error 都转成 ok:false", async () => {
  const throwing: ToolDefinition = {
    ...createTool("read_file"),
    run: async () => {
      throw new Error("磁盘满了");
    },
  };
  const registry = new ToolRegistry([throwing]);
  const result = await registry.run({ id: "c", name: "read_file", arguments: '{"path":"a"}' }, ctx);
  assert.equal(result.ok, false);
  assert.ok(result.output.startsWith("Error:"), result.output);
  assert.match(result.output, /执行失败：磁盘满了/);
  assert.match(result.output, /下一步/);

  const throwingString: ToolDefinition = {
    ...createTool("bash"),
    run: async () => {
      throw "字符串炸弹";
    },
  };
  const registry2 = new ToolRegistry([throwingString]);
  const result2 = await registry2.run({ id: "c", name: "bash", arguments: "{}" }, ctx);
  assert.equal(result2.ok, false);
  assert.match(result2.output, /字符串炸弹/);
});

test("registry：工具返回非法结构时转成 ok:false", async () => {
  const bad: ToolDefinition = {
    ...createTool("glob"),
    run: async () => ({ output: "missing ok" } as unknown as ToolResult),
  };
  const registry = new ToolRegistry([bad]);
  const result = await registry.run({ id: "c", name: "glob", arguments: "{}" }, ctx);
  assert.equal(result.ok, false);
  assert.match(result.output, /返回了非法结果/);
  assert.match(result.output, /下一步/);
});

test("registry：对畸形 call 也不崩", async () => {
  const registry = new ToolRegistry([createEchoTool()]);
  const result = await registry.run(null as unknown as Parameters<typeof registry.run>[0], ctx);
  assert.equal(result.ok, false);
  assert.ok(result.output.startsWith("Error:"), result.output);
});
