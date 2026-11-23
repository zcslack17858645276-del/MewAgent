// MewAgent CLI 入口：参数解析 → 配置校验 → 交互 / headless 分发。
//
// 边界（方案 §3.1）：本文件只做参数与 IO 编排，不直接调 LLM、不读输入循环；
// 真正的 TUI 在 S1、真实 API 客户端在 S1；本文件目前保证：
// `--help` / `--version` 可用、缺 key / 未知参数 / 无 TTY 的报错可操作、配置可验证；
// `--mock --print` 用离线 mock 客户端走完“工具调用 → 回填 → 最终文本”两轮（S0-4）。

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  CliError,
  loadDotEnv,
  parseArgs,
  readPackageVersion,
  resolveConfig,
  usage,
} from "./config.js";
import type { AppConfig } from "./config.js";
import { createMockLlmClient } from "./llm/mock.js";
import type { Message, ToolResult } from "./types.js";

/** 入口依赖（测试注入用）：默认全部走真实 `process` / 文件系统。 */
export interface MainDeps {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  write?: (text: string) => void;
  writeError?: (text: string) => void;
  /** `--print` 无位置参数且 stdin 不是 TTY 时调用，默认读 fd 0。 */
  readStdin?: () => string;
  /** 加载 `.env` 的钩子；测试传空函数即可让用例完全确定。 */
  loadDotEnv?: (envPath: string) => void;
}

function formatConfigLines(config: AppConfig): string[] {
  return [
    `workspace: ${config.workspace}`,
    `model: ${config.model}`,
    `base-url: ${config.baseUrl}`,
    `mock: ${String(config.mock)}`,
  ];
}

function formatPrintHeader(
  version: string,
  config: AppConfig,
  prompt: string,
  mode: string,
): string {
  return [
    `mewagent ${version} · headless（${mode}）`,
    ...formatConfigLines(config),
    `prompt: ${prompt}`,
    "",
  ].join("\n");
}

/**
 * S0-4 的两轮驱动骨架：只负责“调 mock → 回填占位工具结果 → 再调 mock”。
 * 真正的 Agent Loop（多轮、Gate、真实工具执行）在 S2 接入，这里不重复实现。
 */
async function runMockTwoRounds(
  prompt: string,
  write: (text: string) => void,
): Promise<void> {
  const client = createMockLlmClient();
  const messages: Message[] = [{ role: "user", content: prompt }];

  write("--- 第 1 轮：模型 → 工具调用 ---\n");
  const first = await client.chat(messages, []);
  messages.push({
    role: "assistant",
    content: first.content,
    toolCalls: first.toolCalls,
  });
  for (const call of first.toolCalls) {
    write(`tool_call: ${call.name} ${call.arguments}\n`);
    const placeholder: ToolResult = {
      ok: true,
      output: `（S0-4 占位工具结果：${call.name} 将在 S2 实现）`,
    };
    messages.push({
      role: "tool",
      toolCallId: call.id,
      content: placeholder.output,
    });
  }

  write("\n--- 第 2 轮：模型 → 最终文本 ---\n");
  const second = await client.chat(messages, []);
  write(`${second.content}\n`);
  write(`finish: ${second.finishReason}\n`);
}

function formatInteractiveOutput(version: string, config: AppConfig): string {
  return [
    `mewagent ${version}`,
    ...formatConfigLines(config),
    "（S0-3 骨架：TUI 将在 S1 实现；现在可直接用 --print 走 headless 模式）",
    "",
  ].join("\n");
}

function readPromptFromStdin(deps: MainDeps, stdinIsTTY: boolean): string {
  if (stdinIsTTY) {
    throw new CliError(
      '缺少 prompt。\n下一步：用 --print "你的问题" 直接传入；或从 stdin 管道输入，例如 echo "你的问题" | npm run dev -- --print。',
    );
  }
  const read = deps.readStdin ?? (() => readFileSync(0, "utf8"));
  const text = read().trim();
  if (text === "") {
    throw new CliError(
      'stdin 没有内容，缺少 prompt。\n下一步：用 --print "你的问题" 直接传入。',
    );
  }
  return text;
}

/**
 * CLI 主流程：返回进程退出码（0 成功；2 用法/配置错误；1 未预期错误）。
 * 不调用 `process.exit`，方便测试与被其他入口复用。
 */
export async function main(
  argv: readonly string[],
  deps: MainDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const write = deps.write ?? ((text: string) => void process.stdout.write(text));
  const writeError =
    deps.writeError ?? ((text: string) => void process.stderr.write(text));
  const stdinIsTTY = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutIsTTY = deps.stdoutIsTTY ?? Boolean(process.stdout.isTTY);

  try {
    const options = parseArgs(argv);

    // --help / --version 先于一切配置校验：不需要 .env、key 或 TTY。
    if (options.help) {
      write(usage(readPackageVersion()));
      return 0;
    }
    if (options.version) {
      write(`${readPackageVersion()}\n`);
      return 0;
    }

    const loadEnv = deps.loadDotEnv ?? loadDotEnv;
    loadEnv(path.join(cwd, ".env"));

    const config = resolveConfig(options, env, cwd);
    const version = readPackageVersion();

    if (!config.print && !(stdinIsTTY && stdoutIsTTY)) {
      throw new CliError(
        '当前不是交互式终端（TTY），无法启动 TUI。\n下一步：在 Windows Terminal 里运行 npm run dev；非交互场景请加 --print "你的问题"。',
      );
    }

    if (config.print) {
      const prompt =
        config.prompt !== ""
          ? config.prompt
          : readPromptFromStdin(deps, stdinIsTTY);
      if (config.mock) {
        write(formatPrintHeader(version, config, prompt, "mock 离线两轮"));
        await runMockTwoRounds(prompt, write);
        return 0;
      }
      write(
        formatPrintHeader(
          version,
          config,
          prompt,
          "真实 API 将在 S1 接入；现在可用 --mock 离线跑通两轮",
        ),
      );
      return 0;
    }

    write(formatInteractiveOutput(version, config));
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      writeError(`${error.message}\n`);
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeError(`内部错误：${message}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
const isDirectRun =
  entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url;

if (isDirectRun) {
  process.exitCode = await main(process.argv.slice(2));
}
