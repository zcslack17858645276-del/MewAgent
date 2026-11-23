import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * 工作区边界校验（S2-1）。
 *
 * 所有工具接到用户/模型给的路径后都必须先经过这里：既做词法解析（`..`、绝对路径、
 * 盘符相对路径、`%VAR%`、`~`），也做真实路径校验（symlink / junction 指向工作区外时拒绝）。
 * 输出统一正斜杠、保留用户原始大小写，便于日志、UI 和历史里稳定显示。
 *
 * 边界原则：**宁可拒绝，不可越界**。拒绝时抛 `UnsafePathError`，消息里带"下一步"。
 */

export type PathRejectionReason =
  | "输入为空"
  | "路径包含 NUL 字符"
  | "不支持 %VAR% 环境变量展开"
  | "不支持 ~ 用户目录展开"
  | "不支持盘符相对路径"
  | "绝对路径在工作区外"
  | "路径通过符号链接/junction 指向工作区外";

/** 路径被边界校验拒绝时抛出的错误（消息面向模型/用户，带下一步提示）。 */
export class UnsafePathError extends Error {
  override readonly name = "UnsafePathError";
  readonly input: string;
  readonly workspace: string;
  readonly reason: PathRejectionReason;

  constructor(input: string, workspace: string, reason: PathRejectionReason) {
    super(
      `不安全的路径：${JSON.stringify(input)}（${reason}）。\n` +
        `下一步：改用工作区内的相对路径（如 src/index.ts），或通过 --workspace 指定包含该文件的工作区。`,
    );
    this.input = input;
    this.workspace = workspace;
    this.reason = reason;
  }
}

/** 把路径统一成正斜杠形式（仅用于输出/展示，不用于文件系统调用比较）。 */
export function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

/** 解析工作区为绝对路径（不做存在性检查，`config.ts` 已保证目录存在）。 */
export function resolveWorkspace(workspace: string): string {
  return path.resolve(workspace);
}

function isWindows(): boolean {
  return process.platform === "win32";
}

/** 用于包含比较的规范化：绝对路径 + Windows 下转小写（大小写不敏感）。 */
function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return isWindows() ? resolved.toLowerCase() : resolved;
}

/** parent 是否包含 child（含相等）。两边都必须已 resolve 成绝对路径。 */
function isWithin(parent: string, child: string): boolean {
  const parentNorm = normalizeForCompare(parent);
  const childNorm = normalizeForCompare(child);
  if (childNorm === parentNorm) {
    return true;
  }
  const prefix = parentNorm.endsWith(path.sep) ? parentNorm : parentNorm + path.sep;
  return childNorm.startsWith(prefix);
}

/** 真实路径；不存在/无权限时返回 undefined（用于向上找最近的已存在祖先）。 */
function tryRealPath(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}

/**
 * 求"真实路径"：若路径本身不存在，则找到最近的已存在祖先目录取真实路径，
 * 再把剩余不存在的部分拼回去——这样 `junction/new-file.txt` 也能按 junction 解析。
 */
function canonicalizeWithAncestors(value: string): string {
  const absolute = path.resolve(value);
  const missingParts: string[] = [];
  let current = absolute;
  for (;;) {
    const real = tryRealPath(current);
    if (real !== undefined) {
      return path.join(real, ...missingParts);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return absolute;
    }
    missingParts.unshift(path.basename(current));
    current = parent;
  }
}

const DRIVE_RELATIVE_RE = /^[a-zA-Z]:(?![\\/])/;
const ENV_VAR_RE = /%[^%\\/\s]+%/;
const HOME_PREFIX_RE = /^~(?=$|[\\/])/;

/**
 * 把用户/模型给的路径解析为工作区内的绝对路径；越界或不支持的写法一律拒绝。
 */
export function resolveInside(workspace: string, input: string): string {
  const workspaceAbs = path.resolve(workspace);

  if (typeof input !== "string" || input.trim() === "") {
    throw new UnsafePathError(input, workspaceAbs, "输入为空");
  }
  if (input.includes("\0")) {
    throw new UnsafePathError(input, workspaceAbs, "路径包含 NUL 字符");
  }
  if (ENV_VAR_RE.test(input)) {
    throw new UnsafePathError(input, workspaceAbs, "不支持 %VAR% 环境变量展开");
  }
  if (HOME_PREFIX_RE.test(input)) {
    throw new UnsafePathError(input, workspaceAbs, "不支持 ~ 用户目录展开");
  }
  if (isWindows() && DRIVE_RELATIVE_RE.test(input)) {
    throw new UnsafePathError(input, workspaceAbs, "不支持盘符相对路径");
  }

  const resolved = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceAbs, input);

  // 第一层：词法包含（成本低，先挡住明显的 ../ 与越界绝对路径）。
  if (!isWithin(workspaceAbs, resolved)) {
    throw new UnsafePathError(input, workspaceAbs, "绝对路径在工作区外");
  }

  // 第二层：真实路径包含（挡住 symlink / junction 指向工作区外）。
  const workspaceCanonical = canonicalizeWithAncestors(workspaceAbs);
  const resolvedCanonical = canonicalizeWithAncestors(resolved);
  if (!isWithin(workspaceCanonical, resolvedCanonical)) {
    throw new UnsafePathError(input, workspaceAbs, "路径通过符号链接/junction 指向工作区外");
  }

  return toPosixPath(resolved);
}

/** 判断某个绝对路径是否在工作区内（词法 + 真实路径，含相等）。 */
export function isInsideWorkspace(workspace: string, target: string): boolean {
  const workspaceAbs = path.resolve(workspace);
  const targetAbs = path.resolve(target);
  if (!isWithin(workspaceAbs, targetAbs)) {
    return false;
  }
  const workspaceCanonical = canonicalizeWithAncestors(workspaceAbs);
  const targetCanonical = canonicalizeWithAncestors(targetAbs);
  return isWithin(workspaceCanonical, targetCanonical);
}

/** 工作区内的绝对路径 → 相对工作区的正斜杠路径；工作区根返回 "."。 */
export function toWorkspaceRelative(workspace: string, target: string): string {
  const relative = path.relative(path.resolve(workspace), path.resolve(target));
  if (relative === "") {
    return ".";
  }
  return toPosixPath(relative);
}
