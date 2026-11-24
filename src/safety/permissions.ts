/**
 * 权限闸门（S3-1）。
 *
 * 判断顺序固定（方案 §6.6）：
 *   解析参数 → 工具存在? → 路径边界? → readOnly? → 危险命令? → 会话白名单? → 询问 y/a/n
 *
 * - `a` 只把**该工具名**加入本会话白名单（不按目录/命令前缀，v0.1 从简）；
 * - 询问中断/超时/异常一律按拒绝处理；
 * - headless（`--print`）只允许只读工具，其余直接拒绝并说明；
 * - 拒绝原因必须具体（例如"危险命令，已硬拦截：递归强制删除（rm -rf）"），
 *   这样模型才能在下一轮换方案，而不是无意义重试。
 *
 * 本文件不 import Ink / 不读 stdin；交互审批通过注入 `ask` 完成（S3-2 接 UI）。
 */
import { UnsafePathError, resolveInside } from "../tools/paths.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Gate, GateResult, ToolCall } from "../types.js";
import { checkDangerousCommand } from "./danger.js";

export type ApprovalChoice = "y" | "a" | "n";

export interface ApprovalRequest {
  readonly toolName: string;
  readonly readOnly: boolean;
  /** 参数摘要（单行、已截断），供审批界面显示。 */
  readonly summary: string;
  /** 额外原因（例如路径边界提示）；正常审批时为空。 */
  readonly reason?: string;
}

export type ApprovalPrompt = (request: ApprovalRequest) => Promise<ApprovalChoice>;

export interface PermissionGateOptions {
  readonly tools: ToolRegistry;
  readonly workspace: string;
  readonly mode: "interactive" | "headless";
  /** 交互审批函数；headless 或未接入 UI 时可省略（省略时写操作一律拒绝）。 */
  readonly ask?: ApprovalPrompt;
}

export interface PermissionGate {
  /** 传给 `runAgent({ gate })` 的闸门函数。 */
  readonly gate: Gate;
  /** 本会话已用 `a` 放行的工具名（测试/调试用）。 */
  whitelistedTools(): readonly string[];
}

/** 带 path 参数、需要做工作区边界预检的工具。 */
const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "glob", "grep"]);

const SUMMARY_MAX_CHARS = 160;

function truncate(text: string, maxChars = SUMMARY_MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

type ParsedArguments =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

function parseArguments(raw: string): ParsedArguments {
  if (raw.trim() === "") {
    return { ok: true, args: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "arguments 必须是 JSON 对象" };
  }
  return { ok: true, args: parsed as Record<string, unknown> };
}

/** 生成审批界面 / 错误回填用的一行参数摘要（最终整体截断到 SUMMARY_MAX_CHARS）。 */
export function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "bash") {
    const command = args["command"];
    if (typeof command === "string" && command.trim() !== "") {
      return truncate(`$ ${command}`);
    }
  }
  const path = args["path"];
  if (typeof path === "string" && path.trim() !== "") {
    const pattern = args["pattern"];
    const suffix =
      typeof pattern === "string" && pattern.trim() !== "" ? ` · pattern: ${truncate(pattern, 60)}` : "";
    return truncate(`${path}${suffix}`);
  }
  const keys = Object.keys(args);
  if (keys.length === 0) {
    return "（无参数）";
  }
  try {
    return truncate(JSON.stringify(args));
  } catch {
    return `（${keys.join("、")}）`;
  }
}

/** 路径越界预检：返回拒绝原因；通过返回 undefined。 */
function checkPathBounds(
  toolName: string,
  args: Record<string, unknown>,
  workspace: string,
): string | undefined {
  if (!PATH_TOOLS.has(toolName)) {
    return undefined;
  }
  const raw = args["path"];
  const input = typeof raw === "string" && raw.trim() !== "" ? raw : ".";
  try {
    resolveInside(workspace, input);
    return undefined;
  } catch (error) {
    if (error instanceof UnsafePathError) {
      return `路径越界（${toolName}）：${error.reason}（${error.input}）`;
    }
    return `路径校验失败（${toolName}）：${error instanceof Error ? error.message : String(error)}`;
  }
}

const deny = (reason: string): GateResult => ({ allow: false, reason });

export function createPermissionGate(options: PermissionGateOptions): PermissionGate {
  const allowed = new Set<string>();
  const workspace = options.workspace;

  const gate: Gate = async (call: ToolCall): Promise<GateResult> => {
    const parsed = parseArguments(call.arguments);
    if (!parsed.ok) {
      return deny(`参数不是合法的 JSON 对象（${parsed.error}）`);
    }
    const args = parsed.args;

    const tool = options.tools.get(call.name);
    if (tool === undefined) {
      const names = options.tools.names().join("、");
      return deny(
        `未知工具：${call.name}。可用工具：${names === "" ? "（无）" : names}`,
      );
    }

    const boundsReason = checkPathBounds(call.name, args, workspace);
    if (boundsReason !== undefined) {
      return deny(boundsReason);
    }

    if (tool.readOnly) {
      return { allow: true };
    }

    if (call.name === "bash") {
      const command = args["command"];
      if (typeof command === "string" && command.trim() !== "") {
        const danger = checkDangerousCommand(command);
        if (danger.dangerous) {
          return deny(`危险命令，已硬拦截：${danger.reason ?? "匹配危险模式"}`);
        }
      }
    }

    if (options.mode === "headless") {
      return deny(
        `headless（--print）模式只允许只读工具；${call.name} 会修改文件或执行命令，已拒绝`,
      );
    }

    if (allowed.has(call.name)) {
      return { allow: true };
    }

    const summary = summarizeToolCall(call.name, args);
    if (options.ask === undefined) {
      return deny(
        `需要人工审批，但当前会话没有可用的审批界面（S3-2 提供）；${call.name}（${summary}）已拒绝`,
      );
    }

    let choice: ApprovalChoice;
    try {
      choice = await options.ask({
        toolName: call.name,
        readOnly: tool.readOnly,
        summary,
      });
    } catch (error) {
      return deny(
        `审批过程失败：${error instanceof Error ? error.message : String(error)}，已按拒绝处理`,
      );
    }

    if (choice === "y") {
      return { allow: true };
    }
    if (choice === "a") {
      allowed.add(call.name);
      return { allow: true };
    }
    return deny(`用户拒绝了 ${call.name}（${summary}）`);
  };

  return {
    gate,
    whitelistedTools: () => [...allowed],
  };
}
