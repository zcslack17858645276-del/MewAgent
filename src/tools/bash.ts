import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { ToolDefinition, ToolResult, ToolRunContext } from "../types.js";
import { MAX_TOOL_OUTPUT_BYTES } from "./fs.js";

/**
 * bash 工具（S2-5）：在工作区里执行一条前台命令。
 *
 * 设计约束：
 * - cwd 固定为 `ctx.workspace`，不接受任意 cwd 参数，避免绕过路径边界；
 * - 有强制超时（默认 120s，上限 600s），超时 kill；Windows 上 `child.kill` 只杀直接子进程，
 *   孙进程可能残留（方案 §6.10 已接受，输出里会提示）；
 * - 输出先按 UTF-8 解码，出现替换字符（U+FFFD）再回退 GBK —— 覆盖 cmd 里 GBK 输出的中文；
 * - 合并输出硬上限 30KB（与其它工具一致），截断处有提示，建议重定向到文件后用 read_file 读；
 * - 退出码非 0 也算"工具执行成功但命令失败"，返回 `{ok:false}` + `Error:` + "下一步"，
 *   把 stdout/stderr 一并带回，让模型能自己归因。
 */

/** 默认超时（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 允许的最大超时（毫秒）。 */
export const MAX_TIMEOUT_MS = 600_000;

/** 每个流最多缓冲的字节数（防止命令无限输出吃内存）；只用于截断前的采集。 */
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

/** Git for Windows 的默认安装路径（方案 §6.10 优先用它）。 */
export const GIT_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";

/** 计划用哪个 shell、怎么把命令文本拼进 argv。 */
export interface ShellPlan {
  /** shell 可执行文件。 */
  readonly command: string;
  /** shell 自己的参数（命令文本由调用方追加到末尾）。 */
  readonly args: readonly string[];
  /** 给用户看的 shell 名称。 */
  readonly label: string;
  /** 是否需要先 `chcp 65001`（只有 cmd 类 shell 需要）。 */
  readonly prependChcp: boolean;
  /**
   * 是否让 Node 原样拼接参数（不按 Windows 规则加引号/转义）。
   * cmd.exe 必须为 true：否则 `"…;…"`/`(…)` 这类命令会被 cmd 拆坏；
   * bash / PowerShell 保持 false，让 Node 正常加引号。
   */
  readonly verbatim: boolean;
}

/** 参数不合法：消息直接面向模型，必须带"下一步"。 */
class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

function inputError(message: string): ToolInputError {
  return new ToolInputError(message);
}

/** 按 shell 可执行文件名推断参数风格。 */
function planForShell(shellPath: string, windows: boolean): ShellPlan {
  const base = path.basename(shellPath).toLowerCase();
  if (base.includes("bash") || base === "sh" || base === "sh.exe" || base.endsWith("sh.exe")) {
    return { command: shellPath, args: ["-lc"], label: "bash", prependChcp: false, verbatim: false };
  }
  if (base.includes("powershell") || base === "pwsh" || base === "pwsh.exe") {
    return { command: shellPath, args: ["-NoProfile", "-Command"], label: "PowerShell", prependChcp: false, verbatim: false };
  }
  if (windows) {
    return { command: shellPath, args: ["/d", "/s", "/c"], label: "cmd", prependChcp: true, verbatim: true };
  }
  return { command: shellPath, args: ["-c"], label: "shell", prependChcp: false, verbatim: false };
}

/**
 * 选择 shell（方案 §6.10）：`MEWCODE_SHELL` 覆盖 > Windows Git Bash > cmd。
 * `exists` 参数只为测试注入，生产用 `existsSync`。
 */
export function resolveShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (candidate: string) => boolean = existsSync,
): ShellPlan {
  const override = env["MEWCODE_SHELL"]?.trim();
  if (override !== undefined && override !== "") {
    return planForShell(override, platform === "win32");
  }
  if (platform !== "win32") {
    const shell = env["SHELL"]?.trim();
    return { command: shell !== undefined && shell !== "" ? shell : "/bin/sh", args: ["-c"], label: "shell", prependChcp: false, verbatim: false };
  }
  if (exists(GIT_BASH_PATH)) {
    return { command: GIT_BASH_PATH, args: ["-lc"], label: "Git Bash", prependChcp: false, verbatim: false };
  }
  const comspec = env["ComSpec"]?.trim();
  return {
    command: comspec !== undefined && comspec !== "" ? comspec : "cmd.exe",
    args: ["/d", "/s", "/c"],
    label: "cmd",
    prependChcp: true,
    verbatim: true,
  };
}

/** 先 UTF-8，出现替换字符再试 GBK（Node 带 ICU 时可用）；都失败则保留 UTF-8 结果。 */
export function decodeOutput(buffer: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }
  try {
    const gbk = new TextDecoder("gbk").decode(buffer);
    return gbk.includes("\uFFFD") ? utf8 : gbk;
  } catch {
    return utf8;
  }
}

/** 按 UTF-8 字节数截断字符串，且不切断代理对/多字节字符。 */
export function truncateUtf8(text: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false };
  }
  const pieces: string[] = [];
  let used = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (used + size > maxBytes) {
      return { text: pieces.join(""), truncated: true };
    }
    pieces.push(char);
    used += size;
  }
  return { text: pieces.join(""), truncated: false };
}

interface ProcessOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly timedOut: boolean;
  readonly spawnError: Error | undefined;
}

/** 执行进程并收集输出（有超时与缓冲上限）。 */
function runProcess(plan: ShellPlan, command: string, cwd: string, timeoutMs: number): Promise<ProcessOutcome> {
  return new Promise<ProcessOutcome>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const finish = (outcome: ProcessOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.command, [...plan.args, command], {
        cwd,
        windowsHide: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsVerbatimArguments: plan.verbatim,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ exitCode: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: false, spawnError: new Error(message) });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // Windows 上 kill 只杀直接子进程，孙进程可能仍持有 stdout/stderr 管道导致 'close' 迟迟不来；
      // 超时场景给一个兜底，保证工具在有限时间内返回（残留孙进程的问题已在输出里提示）。
      setTimeout(() => {
        finish({ exitCode: null, signal: "SIGTERM", stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks), timedOut, spawnError: undefined });
      }, 500).unref?.();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < MAX_CAPTURE_BYTES) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_CAPTURE_BYTES) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    child.on("error", (error: Error) => {
      finish({ exitCode: null, signal: null, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks), timedOut, spawnError: error });
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      finish({ exitCode: code, signal, stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks), timedOut, spawnError: undefined });
    });
  });
}

/** 拼接命令输出：头部（命令/cwd/退出码）+ stdout + stderr，超 30KB 截断。 */
function formatOutcome(command: string, cwd: string, outcome: ProcessOutcome, timeoutMs: number): { readonly text: string; readonly note: string } {
  const stdout = decodeOutput(outcome.stdout).trimEnd();
  const stderr = decodeOutput(outcome.stderr).trimEnd();
  const lines: string[] = [
    `$ ${command}`,
    `工作区：${cwd}`,
    outcome.signal !== null ? `退出码：被信号 ${outcome.signal} 终止` : `退出码：${outcome.exitCode ?? "未知"}`,
    "",
    "stdout:",
    stdout === "" ? "(无输出)" : stdout,
    "",
    "stderr:",
    stderr === "" ? "(无输出)" : stderr,
  ];
  const body = lines.join("\n");
  const truncated = truncateUtf8(body, MAX_TOOL_OUTPUT_BYTES);
  const noteParts: string[] = [];
  if (truncated.truncated) {
    noteParts.push("（输出已截断：单次最多 30720 字节；完整输出请把命令重定向到文件，再用 read_file 读取）");
  }
  if (outcome.timedOut) {
    noteParts.push(`（命令超时：超过 ${timeoutMs} 毫秒仍未结束，已终止。下一步：缩小命令范围或显式调大 timeout_ms；Windows 上 kill 只终止直接子进程，孙进程可能残留）`);
  }
  return { text: truncated.text, note: noteParts.join("\n") };
}

/** 单次执行 + 失败信息组装。 */
async function runBash(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const commandValue = args["command"];
  if (typeof commandValue !== "string") {
    throw inputError("参数 command 必须是字符串。\n下一步：传要执行的 shell 命令文本，例如 \"node --version\"。");
  }
  const command = commandValue.trim();
  if (command === "") {
    throw inputError("参数 command 不能为空。\n下一步：传要执行的 shell 命令文本，例如 \"node --version\"。");
  }

  const timeoutValue = args["timeout_ms"];
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutValue !== undefined) {
    if (typeof timeoutValue !== "number" || !Number.isInteger(timeoutValue) || timeoutValue < 1000 || timeoutValue > MAX_TIMEOUT_MS) {
      throw inputError(`参数 timeout_ms 必须是 1000~${MAX_TIMEOUT_MS} 之间的整数（毫秒）。\n下一步：例如 {"command":"npm test","timeout_ms":300000}；不传则默认 ${DEFAULT_TIMEOUT_MS}。`);
    }
    timeoutMs = timeoutValue;
  }

  const plan = resolveShell(process.platform, process.env);
  const shellCommand = plan.prependChcp ? `chcp 65001 >nul && ${command}` : command;
  const outcome = await runProcess(plan, shellCommand, ctx.workspace, timeoutMs);

  if (outcome.spawnError !== undefined) {
    return {
      ok: false,
      output:
        `Error: 无法启动 shell（${plan.command}）：${outcome.spawnError.message}\n` +
        `下一步：检查 MEWCODE_SHELL 是否指向存在的可执行文件；或删除该环境变量，使用默认 shell（Windows 优先 Git Bash，其次 cmd.exe）。`,
    };
  }

  const formatted = formatOutcome(command, ctx.workspace, outcome, timeoutMs);
  const section = formatted.note === "" ? formatted.text : `${formatted.text}\n${formatted.note}`;

  if (outcome.timedOut) {
    return {
      ok: false,
      output: `Error: 命令超时（${timeoutMs} 毫秒），已被终止。\n\n${section}\n下一步：换更快的命令、缩小范围，或显式调大 timeout_ms（最大 ${MAX_TIMEOUT_MS}）。`,
    };
  }
  if (outcome.exitCode !== 0) {
    return {
      ok: false,
      output: `Error: 命令退出码 ${outcome.exitCode ?? "未知"}。\n\n${section}\n下一步：看上面的 stdout/stderr 定位失败原因；修好后重试，不要重复执行同一条失败命令。`,
    };
  }
  return { ok: true, output: section };
}

/** `bash` 工具定义。 */
export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "在工作区目录执行一条前台 shell 命令并返回退出码、stdout、stderr；有超时（默认 120 秒，最大 600 秒）与 30KB 输出截断。" +
    "Windows 默认用 Git Bash（未安装则 cmd.exe），可用 MEWCODE_SHELL 覆盖。适合跑测试、构建、git 查询等；需要读写文件时优先用专用工具。",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的 shell 命令文本，例如 \"npm test\" 或 \"git status --short\"。",
      },
      timeout_ms: {
        type: "integer",
        description: `超时毫秒数，默认 ${DEFAULT_TIMEOUT_MS}，范围 1000~${MAX_TIMEOUT_MS}。`,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  readOnly: false,
  async run(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
    try {
      return await runBash(args, ctx);
    } catch (error) {
      if (error instanceof ToolInputError) {
        return { ok: false, output: `Error: ${error.message}` };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output:
          `Error: 执行命令失败：${message}\n` +
          `下一步：检查命令本身与工作区是否可访问；如果 shell 配置有问题，可先运行 "node --version" 这类简单命令验证。`,
      };
    }
  },
};

/** 搜索/注册用：bash 工具数组（S2-5 起 6 工具齐全）。 */
export const bashTools: readonly ToolDefinition[] = [bashTool];
