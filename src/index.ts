// MewAgent CLI 入口：参数解析 → 配置校验 → 交互 / headless 分发。
//
// 边界（方案 §3.1）：本文件只做参数与 IO 编排，不直接调 LLM、不读输入循环；
// 交互 TUI 在 src/ui/（S1-4），真实 API 客户端在 src/llm/openai.ts（S1-2）；
// 本文件保证：`--help` / `--version` 可用、缺 key / 未知参数 / 无 TTY 的报错可操作、
// `--print` 走 headless（S1-5：mock 两轮 / 真实 API 流式）、TUI 走交互渲染。

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runAgent } from "./agent/loop.js";
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
import { createOpenAiLlmClient, LlmHttpError } from "./llm/openai.js";
import type { FetchLike } from "./llm/openai.js";
import { createPermissionGate } from "./safety/permissions.js";
import type { LlmClient, Message, ToolResult } from "./types.js";
import { createDefaultRegistry } from "./tools/index.js";
import type { RunAgentTurn } from "./ui/App.js";
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
  /** 真实 API 的 fetch 注入；测试用假 SSE 流，避免联网。 */
  fetchImpl?: FetchLike;
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

/** `MEWCODE_DEBUG=1/true/yes` 时把请求体打到 stderr（不含 apiKey，可安全粘贴）。 */
function readDebugEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env["MEWCODE_DEBUG"];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** 把 HTTP 状态码翻译成"下一步怎么做"，避免用户只看到一串英文。 */
function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "检查 .env 里的 MEWCODE_API_KEY 是否有效、是否还有余额。";
  }
  if (status === 404) {
    return "检查 MEWCODE_BASE_URL 是否正确（DeepSeek 为 https://api.deepseek.com，OpenAI 兼容服务通常以 /v1 结尾）。";
  }
  if (status === 429) {
    return "供应商限流或额度不足：稍后重试，或检查账户额度。";
  }
  if (status >= 500) {
    return "供应商服务暂时不可用：稍后重试。";
  }
  return "检查 API key、base-url 与模型名后重试。";
}

/** 区分"网络层失败"（代理/断网）与程序错误，给出可操作提示。 */
function isNetworkFailure(error: unknown): error is TypeError {
  return (
    error instanceof TypeError &&
    /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(
      error.message,
    )
  );
}

/**
 * S1-5 / S3-1 的 headless 真实链路：Agent Loop + 只读工具 + headless 权限闸。
 *
 * stdout 只放模型文本（便于管道/重定向）；诊断、工具状态与错误都走 stderr。
 * headless 规则：只读工具放行；写文件 / bash / 危险命令由 `permissions.ts` 直接拒绝，
 * 拒绝原因回填给模型让它换方案（S3-1 验收第 8 条）。
 */
async function runRealHeadless(
  prompt: string,
  config: AppConfig,
  version: string,
  write: (text: string) => void,
  writeError: (text: string) => void,
  deps: MainDeps,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const debug = readDebugEnabled(env);
  const client = createOpenAiLlmClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    fetchImpl: deps.fetchImpl,
    onRequest: debug
      ? ({ url, body }) => {
          writeError(`[debug] POST ${url}\n[debug] 请求体：${body}\n`);
        }
      : undefined,
  });

  const tools = createDefaultRegistry();
  const systemPrompt = buildSystemPrompt({
    workspace: config.workspace,
    toolNames: tools.names(),
  });
  const permissions = createPermissionGate({
    tools,
    workspace: config.workspace,
    mode: "headless",
  });

  writeError(
    `mewagent ${version} · headless · model: ${config.model} · base-url: ${config.baseUrl}\n`,
  );

  let streamed = "";
  const result = await runAgent({
    llm: client,
    tools,
    workspace: config.workspace,
    messages: [{ role: "user", content: prompt }],
    systemPrompt,
    gate: permissions.gate,
    emit: (event) => {
      if (event.type === "assistant_text") {
        streamed += event.delta;
        write(event.delta);
        return;
      }
      if (event.type === "tool_start") {
        writeError(`[工具] ${event.call.name} ${event.call.arguments || "{}"}\n`);
        return;
      }
      if (event.type === "tool_end") {
        const status = event.result.ok ? "成功" : "失败";
        writeError(`[工具结果] ${event.call.name} ${status}（${event.durationMs}ms）\n`);
        if (!event.result.ok) {
          const firstLine = event.result.output.split("\n")[0] ?? "";
          writeError(`  ${firstLine}\n`);
        }
      }
    },
  });

  if (streamed !== "" && !streamed.endsWith("\n")) {
    write("\n");
  }
  if (streamed === "") {
    writeError("（模型没有返回任何文本）\n");
  }
  if (result.stopReason === "max_steps") {
    writeError(`（已达到最大步数 ${result.steps}，已停止）\n`);
  } else if (result.stopReason === "aborted") {
    writeError("（已中断）\n");
  }
  return 0;
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
      return await runRealHeadless(
        prompt,
        config,
        version,
        write,
        writeError,
        deps,
        env,
      );
    }

    const client: LlmClient = config.mock
      ? createMockLlmClient({ chunkDelayMs: readMockDelayMs(env) })
      : createOpenAiLlmClient({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
        });
    // S2-7：TUI 不再直接调 LLM，而是注入"跑一轮 Agent Loop"的函数；
    // UI 只消费 AgentEvent（assistant_text / tool_start / tool_end / turn_end）。
    const tools = createDefaultRegistry();
    const systemPrompt = buildSystemPrompt({
      workspace: config.workspace,
      toolNames: tools.names(),
    });
    // S3-1：交互模式接权限闸。S3-1 还没有审批 UI（S3-2 接入），因此写操作会
    // 被拒绝并回填原因，只读工具照常放行——这是过渡行为，不是最终形态。
    const permissions = createPermissionGate({
      tools,
      workspace: config.workspace,
      mode: "interactive",
    });
    const runTurn: RunAgentTurn = (messages, { signal, emit }) =>
      runAgent({
        llm: client,
        tools,
        workspace: config.workspace,
        messages: [...messages],
        systemPrompt,
        signal,
        emit,
        gate: permissions.gate,
      });
    const launchTui = deps.startTui ?? startTui;
    await launchTui({
      version,
      config,
      runTurn,
      toolNames: tools.names(),
    });
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      writeError(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof LlmHttpError) {
      writeError(`${error.message}\n下一步：${describeHttpFailure(error.status)}\n`);
      return 1;
    }
    if (isNetworkFailure(error)) {
      writeError(
        `网络请求失败：${error.message}\n下一步：检查网络连接与代理（本机可用 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890）后重试。\n`,
      );
      return 1;
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
