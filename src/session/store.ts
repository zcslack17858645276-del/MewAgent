// S3-3：会话持久化（方案 §6.8）。
//
// 路径固定为 `<workspace>/.mewcode/session.json`（已 gitignore）。
// 只存 user / assistant / tool 消息，system prompt 每次启动重建，不进文件。
// 加载失败（文件缺失 / JSON 损坏 / 版本不认识 / 单条消息结构无效）一律降级为
// "new session"，由调用方决定是否提示用户；保存失败只返回错误，不抛异常——
// 持久化是体验增强，不能阻塞对话。
//
// 边界（方案 §3.1）：本模块只做文件读写与数据校验，不碰 UI、不碰 LLM。

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Message, ToolCall } from "../types.js";

/** 会话文件格式版本；不认识的版本按损坏处理（宁可新会话，也不猜旧格式）。 */
export const SESSION_VERSION = 1;
/** 会话目录名（相对工作区）。 */
export const SESSION_DIR = ".mewcode";
/** 会话文件名。 */
export const SESSION_FILE = "session.json";

/** 落盘的会话文件结构（与方案 §6.8 一致）。 */
export interface SessionFile {
  readonly version: number;
  readonly workspace: string;
  readonly model: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly Message[];
}

/** 加载结果：缺失 / 已加载 / 损坏三种状态，调用方据此决定提示。 */
export type SessionLoadResult =
  | { readonly kind: "empty" }
  | {
      readonly kind: "loaded";
      readonly messages: readonly Message[];
      readonly createdAt: string;
      readonly model: string;
    }
  | { readonly kind: "corrupt"; readonly reason: string };

/** 保存结果；失败只用于警告，不抛异常。 */
export type SessionSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface LoadSessionOptions {
  /** `--new` 时跳过加载（不读文件，直接新会话）。 */
  readonly forceNew?: boolean;
}

export interface SaveSessionOptions {
  /** 已有会话的创建时间；不传则用当前时间（新会话）。 */
  readonly createdAt?: string | undefined;
  /** 测试注入的当前时间。 */
  readonly now?: Date;
}

/** 会话文件绝对路径：`<workspace>/.mewcode/session.json`。 */
export function resolveSessionPath(workspace: string): string {
  return path.join(path.resolve(workspace), SESSION_DIR, SESSION_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolCall(value: unknown): value is ToolCall {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["arguments"] === "string"
  );
}

/**
 * 校验并还原一条落盘消息。
 * 返回 `null` 表示结构无效（整个文件按损坏处理），返回 `"skip"` 表示应静默丢弃（system）。
 */
function parseStoredMessage(value: unknown): Message | "skip" | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = value["role"];
  if (role === "system") {
    return "skip";
  }

  if (role === "user" || role === "assistant" || role === "tool") {
    const content = value["content"];
    if (typeof content !== "string") {
      return null;
    }

    if (role === "user") {
      return { role: "user", content };
    }

    if (role === "tool") {
      const toolCallId = value["toolCallId"];
      if (typeof toolCallId !== "string") {
        return null;
      }
      return { role: "tool", toolCallId, content };
    }

    // assistant：toolCalls 可缺省，但存在时必须是合法的 ToolCall 数组。
    const rawCalls = value["toolCalls"];
    if (rawCalls === undefined) {
      return { role: "assistant", content, toolCalls: [] };
    }
    if (!Array.isArray(rawCalls)) {
      return null;
    }
    const toolCalls: ToolCall[] = [];
    for (const item of rawCalls) {
      if (!isToolCall(item)) {
        return null;
      }
      toolCalls.push({ id: item.id, name: item.name, arguments: item.arguments });
    }
    return { role: "assistant", content, toolCalls };
  }

  return null;
}

/**
 * 读取工作区会话。
 *
 * - 文件不存在 → `empty`（正常首次启动）；
 * - `--new` → 不读文件，直接 `empty`；
 * - 任何解析/校验失败 → `corrupt` + 可读原因，由调用方提示"已按新会话启动"。
 */
export function loadSession(
  workspace: string,
  options: LoadSessionOptions = {},
): SessionLoadResult {
  if (options.forceNew === true) {
    return { kind: "empty" };
  }

  const filePath = resolveSessionPath(workspace);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return { kind: "empty" };
    }
    return { kind: "corrupt", reason: `无法读取会话文件：${describeError(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "corrupt", reason: `会话文件不是合法 JSON：${describeError(error)}` };
  }

  if (!isRecord(parsed)) {
    return { kind: "corrupt", reason: "会话文件顶层不是对象。" };
  }

  const version = parsed["version"];
  if (version !== SESSION_VERSION) {
    return {
      kind: "corrupt",
      reason: `不支持的会话版本：${String(version)}（期望 ${SESSION_VERSION}）。`,
    };
  }

  const rawMessages = parsed["messages"];
  if (!Array.isArray(rawMessages)) {
    return { kind: "corrupt", reason: "会话文件的 messages 不是数组。" };
  }

  const messages: Message[] = [];
  for (let index = 0; index < rawMessages.length; index += 1) {
    const parsedMessage = parseStoredMessage(rawMessages[index]);
    if (parsedMessage === null) {
      return { kind: "corrupt", reason: `第 ${index + 1} 条消息结构无效。` };
    }
    if (parsedMessage === "skip") {
      continue;
    }
    messages.push(parsedMessage);
  }

  const createdAtRaw = parsed["createdAt"];
  const modelRaw = parsed["model"];
  const createdAt =
    typeof createdAtRaw === "string" ? createdAtRaw : new Date().toISOString();
  const model = typeof modelRaw === "string" ? modelRaw : "";

  return { kind: "loaded", messages, createdAt, model };
}

/**
 * 保存会话（每轮结束后调用；失败只返回原因，由调用方决定是否警告）。
 *
 * 写临时文件再 `rename`，避免进程中途退出留下半个 JSON。
 * 空历史不落盘（不产生无意义文件）。
 */
export function saveSession(
  workspace: string,
  model: string,
  messages: readonly Message[],
  options: SaveSessionOptions = {},
): SessionSaveResult {
  const persisted = messages.filter((message) => message.role !== "system");
  if (persisted.length === 0) {
    return { ok: true };
  }

  const now = options.now ?? new Date();
  const filePath = resolveSessionPath(workspace);
  const file: SessionFile = {
    version: SESSION_VERSION,
    workspace: path.resolve(workspace),
    model,
    createdAt: options.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    messages: persisted,
  };

  const tempPath = `${filePath}.tmp`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    renameSync(tempPath, filePath);
    return { ok: true };
  } catch (error) {
    // 清理可能残留的临时文件；清理失败不影响主流程。
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // ignore：临时文件残留比抛异常更可接受。
    }
    return { ok: false, reason: describeError(error) };
  }
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
