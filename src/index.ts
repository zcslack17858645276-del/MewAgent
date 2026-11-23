// MewAgent CLI 入口：参数解析 → 配置校验 → 交互 / headless 分发。
//
// 边界（方案 §3.1）：本文件只做参数与 IO 编排，不直接调 LLM、不读输入循环；
// 交互 TUI 在 src/ui/（S1-4），真实 API 客户端在 src/llm/openai.ts（S1-2）；
// 本文件保证：`--help` / `--version` 可用、缺 key / 未知参数 / 无 TTY 的报错可操作、
// `--print` 走 headless（S1-5 接真实 API）、`--mock --print` 走离线两轮（S0-4）。

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { buildSystemPrompt } from "./agent/prompt.js";
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
import { createOpenAiLlmClient } from "./llm/openai.js";
import type { LlmClient, Message, ToolResult } from "./types.js";
import type { SendMessage } from "./ui/App.js";
import { startTui } from "./ui/start-tui.js";
import type { StartTuiOptions } from "./ui/start-tui.js";

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
  /** 交互 TUI 启动钩子；测试注入假实现，避免真的进入 Ink 渲染。 */
  startTui?: (options: StartTuiOptions) => Promise<void>;
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

/** 真实客户端：把 LlmClient.chat 适配成 TUI 需要的 SendMessage（流式回调 + abort）。 */
function createRealSend(client: LlmClient): SendMessage {
  return (messages, { signal, onDelta }) =>
    client.chat([...messages], [], { signal, onText: onDelta });
}

/**
 * mock 客户端：S1 还没有 Agent Loop（S2），这里用"脚本化两轮"代替
 * 工具调用 → 回填占位结果 → 最终文本，让 TUI 在无 key 时也能演示流式与中断。
 */
function createMockSend(client: LlmClient): SendMessage {
  return async (messages, { signal, onDelta }) => {
    const history: Message[] = [...messages];
    const first = await client.chat(history, [], { signal, onText: onDelta });
    if (first.toolCalls.length === 0) {
      return first;
    }

    const toolResults: Message[] = first.toolCalls.map((call) => ({
      role: "tool",
      toolCallId: call.id,
      content: `（S0-4 占位工具结果：${call.name} 将在 S2 实现）`,
    }));
    const withToolResults: Message[] = [
      ...history,
      { role: "assistant", content: first.content, toolCalls: first.toolCalls },
      ...toolResults,
    ];
    return client.chat(withToolResults, [], { signal, onText: onDelta });
  };
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
 * 读取 mock 慢速流式的块间延迟（毫秒）。仅交互 TUI 使用，供手工验收"流式观感/生成中中断"；
 * 未设置或非法值一律回落到 0（一次性发出），保持自动化测试与 --print 的确定性。
 */
function readMockDelayMs(env: NodeJS.ProcessEnv): number {
  const raw = env["MEWCODE_MOCK_DELAY_MS"];
  if (raw === undefined || raw.trim() === "") {
    return 0;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

    const client: LlmClient = config.mock
      ? createMockLlmClient({ chunkDelayMs: readMockDelayMs(env) })
      : createOpenAiLlmClient({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
        });
    const send = config.mock ? createMockSend(client) : createRealSend(client);
    const launchTui = deps.startTui ?? startTui;
    await launchTui({
      version,
      config,
      send,
      systemPrompt: buildSystemPrompt({ workspace: config.workspace }),
    });
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
