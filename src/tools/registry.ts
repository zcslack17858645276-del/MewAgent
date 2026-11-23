import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolRunContext,
  ToolSpec,
} from "../types.js";

/**
 * 工具注册表（S2-2）。
 *
 * 边界（§3.1 / §6.4）：
 * - 只做「名字 → 工具定义 → 解析 arguments → 执行 → 统一 ToolResult」；
 * - 不做权限判断（S3 的 Gate 在 loop 里）、不写 UI、不 import Ink、不 console；
 * - 任何模型输入（未知工具 / 坏 JSON / 非对象参数 / 工具抛异常）都必须**收敛成
 *   `{ ok:false, output:"Error: ..." }`**，绝不向 loop 抛异常，否则一次乱调用就能
 *   让整个 Agent Loop 崩掉；
 * - 错误文案带「可用工具 / 原因 / 下一步」，模型才能自我纠正。
 *
 * v0.1 不做 JSON Schema 的 required/type 深度校验：参数原样交给工具自己校验，
 * 避免在注册表层重复实现一份 schema（S2-3 起各工具会给出可操作错误）。
 */

/** 解析 arguments 的结果（内部用）。 */
type ParsedArguments =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把模型给的 arguments 字符串解析成对象；空串按 `{}` 处理（模型对无参工具常见）。 */
function parseArguments(raw: unknown): ParsedArguments {
  if (typeof raw !== "string") {
    return { ok: false, error: `arguments 不是字符串（收到 ${typeof raw}）` };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: true, args: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `arguments 不是合法 JSON：${reason}` };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: `arguments 必须是 JSON 对象（收到 ${Array.isArray(parsed) ? "数组" : typeof parsed}）`,
    };
  }
  return { ok: true, args: parsed };
}

/** 异常 → 可读的一行描述（非 Error 的抛出物也要能展示）。 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message === "" ? error.name : message;
  }
  return String(error);
}

/** 校验一个工具定义是否可注册；不合法属于**实现方**的 bug，直接抛错（不是模型输入）。 */
function assertValidTool(tool: ToolDefinition): void {
  if (typeof tool.name !== "string" || tool.name.trim() === "") {
    throw new Error("工具 name 必须是非空字符串。");
  }
  if (typeof tool.description !== "string" || tool.description.trim() === "") {
    throw new Error(`工具 ${tool.name} 的 description 必须是非空字符串。`);
  }
  if (!isPlainObject(tool.parameters)) {
    throw new Error(`工具 ${tool.name} 的 parameters 必须是 JSON Schema 对象。`);
  }
  if (typeof tool.readOnly !== "boolean") {
    throw new Error(`工具 ${tool.name} 的 readOnly 必须是布尔值。`);
  }
  if (typeof tool.run !== "function") {
    throw new Error(`工具 ${tool.name} 缺少 run 函数。`);
  }
}

/** 工具注册表：注册 → 导出 OpenAI tools 声明 → 执行模型发起的工具调用。 */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(tools: readonly ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** 注册工具；名字重复/定义不合法抛错（属于代码 bug，启动期就该暴露）。 */
  register(tool: ToolDefinition): void {
    assertValidTool(tool);
    const name = tool.name.trim();
    if (this.#tools.has(name)) {
      throw new Error(`工具 ${name} 已注册，不能重复注册。`);
    }
    this.#tools.set(name, tool);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  /** 已注册工具名（按注册顺序）。 */
  names(): readonly string[] {
    return [...this.#tools.keys()];
  }

  get size(): number {
    return this.#tools.size;
  }

  /** 发给模型的 OpenAI `tools` 声明（§6.4）。 */
  specs(): ToolSpec[] {
    return [...this.#tools.values()].map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * 执行一次模型工具调用。永不抛异常：所有失败都转成 `{ ok:false, output:"Error: ..." }`。
   */
  async run(call: ToolCall, ctx: ToolRunContext): Promise<ToolResult> {
    const rawName: unknown = call?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      return {
        ok: false,
        output:
          `Error: 未知工具 ${JSON.stringify(rawName ?? "")}。` +
          `可用工具：${this.names().join("、") || "（无）"}。\n` +
          `下一步：改用上列工具名重新调用，不要编造工具。`,
      };
    }

    const parsed = parseArguments(call.arguments);
    if (!parsed.ok) {
      return {
        ok: false,
        output: `Error: 工具 ${name} 的 ${parsed.error}。\n下一步：传合法 JSON 对象后重试。`,
      };
    }

    let result: unknown;
    try {
      result = await tool.run(parsed.args, ctx);
    } catch (error) {
      return {
        ok: false,
        output: `Error: 工具 ${name} 执行失败：${describeError(error)}\n下一步：根据错误原因修正参数或路径后重试，不要重复相同调用。`,
      };
    }

    if (!isPlainObject(result) || typeof result["ok"] !== "boolean" || typeof result["output"] !== "string") {
      return {
        ok: false,
        output: `Error: 工具 ${name} 返回了非法结果（缺少 ok/output）。\n下一步：这是工具实现的问题，请勿重复调用。`,
      };
    }
    return { ok: result["ok"], output: result["output"] };
  }
}
