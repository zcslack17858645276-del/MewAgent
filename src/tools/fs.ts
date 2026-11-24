import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ToolDefinition, ToolResult, ToolRunContext } from "../types.js";
import { createUnifiedDiff } from "./diff.js";
import { UnsafePathError, resolveInside, toWorkspaceRelative } from "./paths.js";

/**
 * 文件工具（S2-3）：read_file / write_file / edit_file。
 *
 * 设计约束：
 * - 所有路径必须先过 `resolveInside`（唯一入口，见 `tools/paths.ts`），禁止手拼路径；
 * - 输出有硬上限（30KB），超长截断并提示用 offset/limit 继续读，避免一次 cat 把上下文打爆；
 * - 可预期的失败（参数不对、文件不存在、匹配 0/多处）返回 `{ok:false, output:"Error: ..."}` 且带
 *   "下一步"，让模型能自我修正；不可预期错误也收敛成可读失败，不向 loop 抛异常；
 * - `edit_file` 精确保留原文件换行风格（CRLF 文件不会被整文件改成 LF），规则见方案 §6.5。
 */

/** 单次工具输出上限（字节）。 */
export const MAX_TOOL_OUTPUT_BYTES = 30 * 1024;

/** `read_file` 默认最多返回的行数；超过时提示用 offset/limit 继续读。 */
export const DEFAULT_READ_LIMIT = 500;

/** 参数不合法/可预期失败：消息直接面向模型，必须带"下一步"。 */
class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

function inputError(message: string): ToolInputError {
  return new ToolInputError(message);
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** 按行把文本裁到字节上限内（`edit_file` 的 diff 也遵守 30KB 工具输出上限）。 */
function clampBytes(text: string, limit: number, note: string): string {
  if (byteLength(text) <= limit) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const lineBytes = byteLength(line) + 1;
    if (bytes + lineBytes > limit) break;
    kept.push(line);
    bytes += lineBytes;
  }
  kept.push(note);
  return kept.join("\n");
}

/** 统一收敛所有异常，保证工具永远返回 ToolResult。 */
async function safeRun(action: string, fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UnsafePathError || error instanceof ToolInputError) {
      return { ok: false, output: `Error: ${error.message}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output:
        `Error: ${action}失败：${message}\n` +
        `下一步：检查路径是否正确、文件/目录是否存在、是否有读写权限；路径一律用相对工作区的写法（如 src/index.ts）。`,
    };
  }
}

function stringArg(args: Record<string, unknown>, name: string, hint: string): string {
  const value = args[name];
  if (typeof value !== "string") {
    throw inputError(`参数 ${name} 必须是字符串。\n下一步：${hint}`);
  }
  return value;
}

function nonEmptyStringArg(args: Record<string, unknown>, name: string, hint: string): string {
  const value = stringArg(args, name, hint);
  if (value.trim() === "") {
    throw inputError(`参数 ${name} 不能为空。\n下一步：${hint}`);
  }
  return value;
}

function integerArg(args: Record<string, unknown>, name: string, hint: string): number | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw inputError(`参数 ${name} 必须是 ≥1 的整数。\n下一步：${hint}`);
  }
  return value;
}

function booleanArg(args: Record<string, unknown>, name: string, hint: string): boolean | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw inputError(`参数 ${name} 必须是布尔值。\n下一步：${hint}`);
  }
  return value;
}

/** 展示用路径：工作区内相对路径（正斜杠）；绝对路径原样兜底。 */
function displayPath(workspace: string, absolutePosix: string): string {
  try {
    return toWorkspaceRelative(workspace, absolutePosix);
  } catch {
    return absolutePosix;
  }
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** 统计 needle 在 haystack 中的非重叠出现次数与首次下标。 */
function countOccurrences(haystack: string, needle: string): { count: number; firstIndex: number } {
  if (needle === "") {
    return { count: 0, firstIndex: -1 };
  }
  let count = 0;
  let firstIndex = -1;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) {
      break;
    }
    count += 1;
    if (firstIndex === -1) {
      firstIndex = index;
    }
    from = index + needle.length;
  }
  return { count, firstIndex };
}

interface NumberedLines {
  readonly text: string;
  readonly lastLine: number;
  readonly truncatedByBytes: boolean;
}

/** 把若干行渲染成 `   N│内容`，超过字节上限时截断当前行并停止。 */
function buildNumberedLines(lines: readonly string[], startLine: number): NumberedLines {
  const parts: string[] = [];
  let bytes = 0;
  let lastLine = startLine - 1;
  let truncatedByBytes = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = startLine + index;
    const prefix = `${String(lineNo).padStart(5, " ")}│`;
    const prefixBytes = byteLength(prefix);
    const sepBytes = parts.length === 0 ? 0 : 1;
    const room = MAX_TOOL_OUTPUT_BYTES - bytes - sepBytes;
    const line = lines[index] ?? "";
    const lineBytes = byteLength(line);

    if (prefixBytes + lineBytes <= room) {
      parts.push(prefix + line);
      bytes += sepBytes + prefixBytes + lineBytes;
      lastLine = lineNo;
      continue;
    }

    // 单行就超出剩余预算：按字符裁剪，保留前缀与省略号。
    const bodyBudget = Math.max(0, room - prefixBytes - 3);
    let cut = "";
    for (const char of line) {
      if (byteLength(cut + char) > bodyBudget) {
        break;
      }
      cut += char;
    }
    parts.push(`${prefix}${cut}…`);
    lastLine = lineNo;
    truncatedByBytes = true;
    break;
  }

  return { text: parts.join("\n"), lastLine, truncatedByBytes };
}

/** 统计文本行数：末尾换行不产生额外的空行（空内容记 0 行）。 */
function countTextLines(text: string): number {
  if (text === "") {
    return 0;
  }
  const parts = text.split(/\r\n|\r|\n/);
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/** read_file：读文本文件，带行号；支持 offset/limit 与大文件截断。 */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "读取工作区内的文本文件，返回带行号的内容（行号从 1 起）。大文件或长输出会被截断，可用 offset/limit 分段读取；不确定路径时先用 glob 查找。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的文件路径，例如 src/index.ts" },
      offset: { type: "integer", description: "起始行号（从 1 起，默认 1）", minimum: 1 },
      limit: { type: "integer", description: `最多读取的行数（默认 ${DEFAULT_READ_LIMIT}）`, minimum: 1 },
    },
    required: ["path"],
  },
  readOnly: true,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> =>
    safeRun("读取文件", () => {
      const rawPath = nonEmptyStringArg(args, "path", '例如 "src/index.ts"（相对工作区）。');
      const absolute = resolveInside(ctx.workspace, rawPath);
      const rel = displayPath(ctx.workspace, absolute);
      const offset = integerArg(args, "offset", "offset 是 1 起算的起始行号，例如 120。") ?? 1;
      const limit =
        integerArg(args, "limit", "limit 是本次最多读取的行数，例如 200。") ?? DEFAULT_READ_LIMIT;

      if (!existsSync(absolute)) {
        throw inputError(
          `文件不存在：${rel}。\n下一步：先用 glob 找到正确路径，或确认文件名/大小写是否正确。`,
        );
      }
      if (statSync(absolute).isDirectory()) {
        throw inputError(
          `${rel} 是目录，read_file 只能读取文件。\n下一步：用 glob 列出该目录下的文件，或换一个文件路径。`,
        );
      }

      const raw = readFileSync(absolute, "utf8");
      if (raw === "") {
        return { ok: true, output: `${rel}（空文件）` };
      }

      const isCrlf = raw.includes("\r\n");
      const allLines = raw.split(/\r\n|\n/);
      let lineCount = allLines.length;
      if (raw.endsWith("\n")) {
        lineCount -= 1;
      }

      if (offset > lineCount) {
        throw inputError(
          `offset ${offset} 超出文件总行数 ${lineCount}（${rel}）。\n下一步：把 offset 调到 1–${lineCount} 之间再读。`,
        );
      }

      const start = offset;
      const end = Math.min(lineCount, offset + limit - 1);
      const slice = allLines.slice(start - 1, end);
      const built = buildNumberedLines(slice, start);

      const header =
        `${rel}（第 ${start}–${built.lastLine} 行，共 ${lineCount} 行${isCrlf ? "，CRLF 换行" : ""}）`;
      const notes: string[] = [];
      if (built.truncatedByBytes) {
        notes.push(`…（输出已截断：单次最多 ${MAX_TOOL_OUTPUT_BYTES} 字节）`);
      }
      // 续读位置按"实际渲染到的行"算，而不是按 limit 算：字节截断时二者不同，
      // 按 limit 给 offset 会跳过中间从未展示过的行。
      if (built.lastLine < lineCount) {
        notes.push(`…（还有 ${lineCount - built.lastLine} 行未显示；用 offset=${built.lastLine + 1} 继续读取）`);
      }

      return { ok: true, output: [header, built.text, ...notes].filter((part) => part !== "").join("\n") };
    }),
};

/** write_file：整文件写入（自动创建目录）。 */
export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "把完整内容写入工作区内的文件（覆盖已有文件）；父目录不存在会自动创建。修改已有文件里的一小段请优先用 edit_file，避免整文件覆盖。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的文件路径，例如 src/new.ts" },
      content: { type: "string", description: "要写入的完整文本（可为空字符串表示清空文件）" },
    },
    required: ["path", "content"],
  },
  readOnly: false,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> =>
    safeRun("写入文件", () => {
      const rawPath = nonEmptyStringArg(args, "path", '例如 "src/new.ts"（相对工作区）。');
      const content = stringArg(
        args,
        "content",
        "content 是要写入的完整文本；如果要清空文件，传空字符串。",
      );
      const absolute = resolveInside(ctx.workspace, rawPath);
      const rel = displayPath(ctx.workspace, absolute);

      let createdDirectory: string | undefined;
      if (!existsSync(path.dirname(absolute))) {
        mkdirSync(path.dirname(absolute), { recursive: true });
        // 只报告相对工作区的父目录：mkdirSync 的返回值在 Windows 上可能带 \\?\ 前缀，不便展示。
        createdDirectory = path.dirname(absolute);
      }
      writeFileSync(absolute, content, "utf8");

      const bytes = byteLength(content);
      const lineCount = countTextLines(content);
      const lines = [`已写入 ${rel}（${bytes} 字节，${lineCount} 行）。`];
      if (createdDirectory !== undefined) {
        lines.push(`已创建目录：${displayPath(ctx.workspace, createdDirectory)}`);
      }
      return { ok: true, output: lines.join("\n") };
    }),
};

/** edit_file：精确字符串替换（0 次/多处匹配都返回可操作错误；保留原文件换行风格）。 */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "在工作区文件里做精确字符串替换：old_string 必须在文件中出现一次（或用 replace_all:true 全部替换）；0 次/多处匹配会返回可操作错误。会保留原文件的换行风格（CRLF/LF）。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的文件路径，例如 src/index.ts" },
      old_string: { type: "string", description: "要被替换的原文片段（需精确匹配，含缩进）" },
      new_string: { type: "string", description: "替换后的文本（空字符串表示删除该片段）" },
      replace_all: {
        type: "boolean",
        description: "为 true 时替换全部匹配（默认 false：多处匹配会报错）",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
  readOnly: false,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> =>
    safeRun("编辑文件", () => {
      const rawPath = nonEmptyStringArg(args, "path", '例如 "src/index.ts"（相对工作区）。');
      const oldString = stringArg(args, "old_string", "old_string 是要被替换的原文片段。");
      const newString = stringArg(args, "new_string", "new_string 是替换后的文本（可为空字符串）。");
      const replaceAll = booleanArg(args, "replace_all", "replace_all 只接受 true/false。");
      if (oldString === "") {
        throw inputError(
          "old_string 不能为空。\n下一步：先用 read_file 查看要替换的原文，再把包含足够上下文的片段作为 old_string。",
        );
      }

      const absolute = resolveInside(ctx.workspace, rawPath);
      const rel = displayPath(ctx.workspace, absolute);
      if (!existsSync(absolute)) {
        throw inputError(
          `文件不存在：${rel}。\n下一步：先用 glob 找到正确路径，或确认文件名/大小写是否正确。`,
        );
      }
      if (statSync(absolute).isDirectory()) {
        throw inputError(
          `${rel} 是目录，edit_file 只能编辑文件。\n下一步：指定具体文件路径（可用 glob 列出目录内容）。`,
        );
      }

      const raw = readFileSync(absolute, "utf8");
      const isCrlf = raw.includes("\r\n");

      // 先按原样找；找不到时把两边统一成 \n 再找（Windows 兼容，方案 §6.5）。
      let searchText = raw;
      let searchOld = oldString;
      let searchNew = newString;
      let found = countOccurrences(searchText, searchOld);
      if (found.count === 0) {
        searchText = normalizeToLf(raw);
        searchOld = normalizeToLf(oldString);
        searchNew = normalizeToLf(newString);
        found = countOccurrences(searchText, searchOld);
      }

      if (found.count === 0) {
        throw inputError(
          `未找到匹配内容（${rel}），请检查缩进/换行/是否已被修改。\n` +
            "下一步：先用 read_file 确认原文（注意行首缩进与换行符），再用完全一致的 old_string 重试。",
        );
      }
      if (found.count > 1 && replaceAll !== true) {
        throw inputError(
          `匹配到 ${found.count} 处（${rel}），请提供更多上下文或 replace_all:true。\n` +
            "下一步：把 old_string 扩到包含前后各 1–2 行不重复的内容；如果确实要全部替换，传 replace_all:true。",
        );
      }

      let replaced: string;
      if (replaceAll === true) {
        replaced = searchText.split(searchOld).join(searchNew);
      } else {
        replaced =
          searchText.slice(0, found.firstIndex) + searchNew + searchText.slice(found.firstIndex + searchOld.length);
      }

      // 写回时保留原文件换行风格：CRLF 文件 → 全部 CRLF；LF 文件 → 全部 LF。
      const finalContent = isCrlf
        ? normalizeToLf(replaced).replace(/\n/g, "\r\n")
        : normalizeToLf(replaced);

      writeFileSync(absolute, finalContent, "utf8");

      const header =
        `已替换 ${found.count} 处（${rel}${isCrlf ? "；保留 CRLF 换行" : ""}）：`;
      // S4-1：返回带行号的红绿 diff（UI 会解析并着色，模型也据此确认改动位置）。
      const diff = createUnifiedDiff(rel, normalizeToLf(searchText), normalizeToLf(replaced));
      const output = clampBytes(
        `${header}\n${diff.text}`,
        MAX_TOOL_OUTPUT_BYTES,
        `…（diff 输出已截断：单次最多 ${MAX_TOOL_OUTPUT_BYTES} 字节）`,
      );
      return { ok: true, output };
    }),
};

/** 文件工具集合（S2-5 的 `createDefaultRegistry` 会把它注册进去）。 */
export const fsTools: readonly ToolDefinition[] = [readFileTool, writeFileTool, editFileTool];
