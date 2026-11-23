import { openSync, readdirSync, readFileSync, closeSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { MAX_TOOL_OUTPUT_BYTES } from "./fs.js";
import { resolveInside, toPosixPath, toWorkspaceRelative } from "./paths.js";
import type { ToolDefinition, ToolResult, ToolRunContext } from "../types.js";

/**
 * 搜索工具（S2-4）：`glob` 按模式列文件、`grep` 按正则搜内容。
 *
 * 设计取舍：
 * - 不引第三方依赖，glob 用自写的段匹配（`*` / `?` / `**` / 字符类），行为可单测、跨平台稳定；
 * - 永远跳过 `.git` 与 `node_modules`（规划红线），不跟随符号链接目录（避免越界）；
 * - 结果条数硬上限（glob 200、grep 100），输出再套 30KB 硬上限——大仓库里"结果刷屏"比"没结果"更伤上下文；
 * - 路径一律先过 `resolveInside`，输出统一工作区相对的正斜杠路径。
 */

const GLOB_LIMIT = 200;
const GREP_LIMIT = 100;
const GREP_MAX_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;
const GREP_LINE_MAX_COLUMNS = 500;
const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);

class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

function inputError(message: string): ToolInputError {
  return new ToolInputError(message);
}

function stringArg(args: Record<string, unknown>, name: string, hint: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw inputError(`缺少参数 ${name}。\n下一步：${hint}`);
  }
  return value;
}

function optionalStringArg(args: Record<string, unknown>, name: string, hint: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw inputError(`参数 ${name} 必须是非空字符串。\n下一步：${hint}`);
  }
  return value;
}

function safeRun(action: string, fn: () => string): ToolResult {
  try {
    return { ok: true, output: fn() };
  } catch (error) {
    if (error instanceof ToolInputError) {
      return { ok: false, output: `Error: ${error.message}` };
    }
    if (error instanceof Error && error.name === "UnsafePathError") {
      return { ok: false, output: `Error: ${error.message}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error: ${action}失败：${message}\n下一步：确认工作区路径存在、权限可读后重试；必要时先用 glob 确认文件位置。`,
    };
  }
}

/** 把一个自然行渲染成输出行，同时维护 30KB 预算。 */
class OutputBuilder {
  readonly #lines: string[] = [];
  #bytes = 0;
  #truncated = false;

  push(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8") + (this.#lines.length === 0 ? 0 : 1);
    if (this.#bytes + bytes > MAX_TOOL_OUTPUT_BYTES) {
      this.#truncated = true;
      return;
    }
    this.#lines.push(line);
    this.#bytes += bytes;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  build(truncatedNote: string): string {
    const parts = [...this.#lines];
    if (this.#truncated) {
      parts.push(truncatedNote);
    }
    return parts.join("\n");
  }
}

// ---------------------------------------------------------------------------
// glob 匹配（`*` 单层、`?` 单字符、`**` 任意层、`[abc]`/`[!abc]` 字符类）
// ---------------------------------------------------------------------------

function normalizePattern(pattern: string): string[] {
  const normalized = toPosixPath(pattern.trim()).replace(/^\.\//, "").replace(/\/+$/, "");
  const segments = normalized.split("/").filter((segment) => segment !== "");
  return segments;
}

function normalizeSegmentChar(char: string): string {
  return process.platform === "win32" ? char.toLowerCase() : char;
}

/** 匹配单个路径段（不含 `/`）。 */
function matchSegment(pattern: string, name: string): boolean {
  const foldedPattern = process.platform === "win32" ? pattern.toLowerCase() : pattern;
  const foldedName = process.platform === "win32" ? name.toLowerCase() : name;
  let patternIndex = 0;
  let nameIndex = 0;
  let starIndex = -1;
  let starNameIndex = 0;

  while (nameIndex < foldedName.length) {
    const patternChar = foldedPattern[patternIndex];
    if (patternChar === "*") {
      starIndex = patternIndex;
      patternIndex += 1;
      starNameIndex = nameIndex;
      continue;
    }
    if (patternChar === "?") {
      patternIndex += 1;
      nameIndex += 1;
      continue;
    }
    if (patternChar === "[") {
      const classResult = matchCharacterClass(foldedPattern, patternIndex, foldedName[nameIndex] ?? "");
      if (classResult !== undefined) {
        if (classResult.matched) {
          patternIndex = classResult.nextIndex;
          nameIndex += 1;
          continue;
        }
        // 字符类不匹配：退回到 * 的下一位置重试，或直接失败。
        if (starIndex !== -1) {
          patternIndex = starIndex + 1;
          starNameIndex += 1;
          nameIndex = starNameIndex;
          continue;
        }
        return false;
      }
    }
    if (patternChar !== undefined && normalizeSegmentChar(patternChar) === normalizeSegmentChar(foldedName[nameIndex] ?? "")) {
      patternIndex += 1;
      nameIndex += 1;
      continue;
    }
    if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      starNameIndex += 1;
      nameIndex = starNameIndex;
      continue;
    }
    return false;
  }

  while (foldedPattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === foldedPattern.length;
}

/** 解析 `[...]` 字符类；`[` 未闭合时返回 undefined（按字面字符处理）。 */
function matchCharacterClass(
  pattern: string,
  startIndex: number,
  target: string,
): { matched: boolean; nextIndex: number } | undefined {
  const closeIndex = pattern.indexOf("]", startIndex + 1);
  if (closeIndex === -1) {
    return undefined;
  }
  let body = pattern.slice(startIndex + 1, closeIndex);
  let negated = false;
  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
  }
  let matched = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? "";
    if (char === "-" && index > 0 && index < body.length - 1) {
      const from = body[index - 1] ?? "";
      const to = body[index + 1] ?? "";
      if (target >= from && target <= to) {
        matched = true;
      }
      index += 1;
      continue;
    }
    if (char === target) {
      matched = true;
    }
  }
  return { matched: negated ? !matched : matched, nextIndex: closeIndex + 1 };
}

function matchGlobSegments(
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex: number,
  pathIndex: number,
): boolean {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegments.length;
  }
  const segment = patternSegments[patternIndex] ?? "";
  if (segment === "**") {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }
    for (let next = pathIndex; next <= pathSegments.length; next += 1) {
      if (matchGlobSegments(patternSegments, pathSegments, patternIndex + 1, next)) {
        return true;
      }
    }
    return false;
  }
  if (pathIndex >= pathSegments.length) {
    return false;
  }
  if (!matchSegment(segment, pathSegments[pathIndex] ?? "")) {
    return false;
  }
  return matchGlobSegments(patternSegments, pathSegments, patternIndex + 1, pathIndex + 1);
}

function matchGlob(patternSegments: readonly string[], relativePath: string): boolean {
  return matchGlobSegments(patternSegments, relativePath.split("/"), 0, 0);
}

// ---------------------------------------------------------------------------
// 文件遍历与工具实现
// ---------------------------------------------------------------------------

function* walkFiles(root: string): Generator<string> {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }
      yield* walkFiles(absolute);
      continue;
    }
    if (entry.isFile()) {
      yield absolute;
    }
  }
}

function assertExistingBase(workspace: string, input: string): { absolute: string; isDirectory: boolean } {
  const absolute = resolveInside(workspace, input);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    throw inputError(`路径不存在：${input}。\n下一步：先用 glob 确认工作区内有哪些文件，再指定 path。`);
  }
  return { absolute, isDirectory: stats.isDirectory() };
}

function isBinaryFile(absolute: string): boolean {
  const fd = openSync(absolute, "r");
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
    const bytesRead = readSync(fd, buffer, 0, BINARY_SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

function truncateGrepLine(line: string): string {
  return line.length > GREP_LINE_MAX_COLUMNS ? `${line.slice(0, GREP_LINE_MAX_COLUMNS)}…` : line;
}

export const globTool: ToolDefinition = {
  name: "glob",
  description:
    "按 glob 模式列出工作区内的文件（支持 *、?、**、[abc]；自动跳过 .git 与 node_modules，最多返回 200 条）。用来找文件位置，不要用它读文件内容。",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "glob 模式，相对 path；例如 **/*.ts、src/**/*.test.ts、*.md",
      },
      path: {
        type: "string",
        description: "搜索起点目录（相对工作区，默认工作区根）",
      },
    },
    required: ["pattern"],
  },
  readOnly: true,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> =>
    safeRun("列出文件", () => {
      const pattern = stringArg(
        args,
        "pattern",
        "例如 pattern: \"**/*.ts\"（* 只匹配一层，** 匹配任意层目录）。",
      );
      const patternSegments = normalizePattern(pattern);
      if (patternSegments.length === 0) {
        throw inputError("pattern 不能为空。\n下一步：传入形如 **/*.ts 的 glob 模式。");
      }
      const baseInput = optionalStringArg(args, "path", "path 是相对工作区的目录，例如 src。") ?? ".";
      const base = assertExistingBase(ctx.workspace, baseInput);
      if (!base.isDirectory) {
        throw inputError(`glob 的 path 必须是目录：${baseInput}。\n下一步：想按文件名找目录下的文件，pattern 传 \"*.ts\" 这类写法。`);
      }

      const matched: string[] = [];
      for (const absolute of walkFiles(base.absolute)) {
        const relativeToBase = toPosixPath(path.relative(base.absolute, absolute));
        if (matchGlob(patternSegments, relativeToBase)) {
          matched.push(toWorkspaceRelative(ctx.workspace, absolute));
        }
      }
      matched.sort((a, b) => a.localeCompare(b));

      const builder = new OutputBuilder();
      const truncatedByLimit = matched.length > GLOB_LIMIT;
      const shown = matched.slice(0, GLOB_LIMIT);
      if (shown.length === 0) {
        return (
          `没有匹配的文件（pattern: "${pattern}"，path: "${baseInput}"）。\n` +
          "下一步：检查模式写法（* 只匹配单层文件名、** 跨目录），或直接换用 grep 搜文件内容。"
        );
      }
      builder.push(
        `匹配到 ${matched.length} 个文件（pattern: "${pattern}"）${truncatedByLimit ? `：只显示前 ${GLOB_LIMIT} 个` : "："}`,
      );
      for (const file of shown) {
        builder.push(file);
      }
      const body = builder.build("");
      const notes: string[] = [];
      if (truncatedByLimit) {
        notes.push(`…（结果超过 ${GLOB_LIMIT} 条，已截断；请收窄 pattern 或 path 后重试）`);
      }
      if (builder.truncated) {
        notes.push(`…（输出已截断：单次最多 ${MAX_TOOL_OUTPUT_BYTES} 字节；请收窄 pattern 或 path）`);
      }
      return notes.length === 0 ? body : `${body}\n${notes.join("\n")}`;
    }),
};

export const grepTool: ToolDefinition = {
  name: "grep",
  description:
    "用正则表达式在工作区文件里搜索文本，返回 文件:行号:内容（最多 100 处；自动跳过 .git、node_modules、二进制文件与大于 5MB 的文件）。要读上下文请再用 read_file。",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "JavaScript 正则表达式源码，例如 mewcode|MewAgent、TODO\\b",
      },
      path: {
        type: "string",
        description: "搜索范围（相对工作区，默认工作区根；可以是单个文件）",
      },
    },
    required: ["pattern"],
  },
  readOnly: true,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> =>
    safeRun("搜索文件内容", () => {
      const pattern = stringArg(
        args,
        "pattern",
        "传入正则表达式源码，例如 mewcode|MewAgent；特殊字符记得转义。",
      );
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw inputError(`正则表达式无效：${message}\n下一步：检查括号/转义（例如 \\(\\）、字符组是否闭合后重试。`);
      }
      const baseInput = optionalStringArg(args, "path", "path 是相对工作区的文件或目录，例如 src 或 src/index.ts。") ?? ".";
      const base = assertExistingBase(ctx.workspace, baseInput);
      const files: string[] = base.isDirectory ? [...walkFiles(base.absolute)] : [base.absolute];

      const matches: string[] = [];
      let skippedBinary = 0;
      let skippedLarge = 0;
      let truncatedByLimit = false;

      for (const absolute of files) {
        if (matches.length >= GREP_LIMIT) {
          truncatedByLimit = true;
          break;
        }
        const stats = statSync(absolute);
        if (stats.size > GREP_MAX_FILE_BYTES) {
          skippedLarge += 1;
          continue;
        }
        if (isBinaryFile(absolute)) {
          skippedBinary += 1;
          continue;
        }
        const content = readFileSync(absolute, "utf8");
        const lines = content.split(/\r\n|\r|\n/);
        const relative = toWorkspaceRelative(ctx.workspace, absolute);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!regex.test(line)) {
            continue;
          }
          matches.push(`${relative}:${index + 1}:${truncateGrepLine(line)}`);
          if (matches.length >= GREP_LIMIT) {
            truncatedByLimit = true;
            break;
          }
        }
      }

      if (matches.length === 0) {
        return (
          `没有匹配的内容（pattern: "${pattern}"，path: "${baseInput}"）。\n` +
          "下一步：检查正则写法与大小写，或扩大 path 范围；也可以先用 glob 确认文件存在。"
        );
      }

      const builder = new OutputBuilder();
      builder.push(`匹配到 ${matches.length} 处（pattern: "${pattern}"）${truncatedByLimit ? `：只显示前 ${GREP_LIMIT} 处` : "："}`);
      for (const match of matches) {
        builder.push(match);
      }
      const notes: string[] = [];
      if (truncatedByLimit) {
        notes.push(`…（结果超过 ${GREP_LIMIT} 处，已截断；请收窄 pattern 或 path 后重试）`);
      }
      if (skippedLarge > 0) {
        notes.push(`…（跳过 ${skippedLarge} 个大于 5MB 的文件；如需搜索请缩小 path 范围）`);
      }
      if (skippedBinary > 0) {
        notes.push(`…（跳过 ${skippedBinary} 个二进制文件）`);
      }
      const body = builder.build("");
      if (builder.truncated) {
        notes.push(`…（输出已截断：单次最多 ${MAX_TOOL_OUTPUT_BYTES} 字节）`);
      }
      const output = notes.length === 0 ? body : `${body}\n${notes.join("\n")}`;
      return output.replace(/\n+$/, "");
    }),
};

export const searchTools: readonly ToolDefinition[] = [globTool, grepTool];
