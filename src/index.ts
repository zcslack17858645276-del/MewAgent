#!/usr/bin/env node
// MewAgent CLI 入口：参数解析 → 配置校验 → 交互 / headless 分发。
//
// 边界（方案 §3.1）：本文件只做参数与 IO 编排，不直接调 LLM、不读输入循环；
// 交互 TUI 在 src/ui/（S1-4），真实 API 客户端在 src/llm/openai.ts（S1-2）；
// 本文件保证：`--help` / `--version` 可用、缺 key / 未知参数 / 无 TTY 的报错可操作、
// `--print` 走 headless（S1-5：mock 两轮 / 真实 API 流式）、TUI 走交互渲染。

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runAgent } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/prompt.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SUGGESTED_MODEL,
  CliError,
  findMissingConfig,
  loadDotEnv,
  parseArgs,
  readPackageVersion,
  readUserConfig,
  resolveConfig,
  resolveEnvFilePaths,
  saveUserConfig,
  usage,
} from "./config.js";
import type { AppConfig, UserConfig } from "./config.js";
import type { CompressResult } from "./context/compress.js";
import { DEFAULT_CONTEXT_TOKENS } from "./context/tokens.js";
import { describeFailure, describeHttpStatus, describeToolFailure, isNetworkFailure } from "./errors.js";
import { createMockLlmClient } from "./llm/mock.js";
import { createOpenAiLlmClient, LlmHttpError } from "./llm/openai.js";
import type { FetchLike } from "./llm/openai.js";
import { createPermissionGate } from "./safety/permissions.js";
import { loadSession, saveSession } from "./session/store.js";
import type { LlmClient, Message, ToolResult } from "./types.js";
import { createDefaultRegistry } from "./tools/index.js";
import type { RunAgentTurn } from "./ui/App.js";
import { createApprovalController } from "./ui/approval.js";
import { runSetupWizard } from "./ui/start-setup.js";
import type { SetupOutcome, SetupWizardRequest } from "./ui/start-setup.js";
import { startTui } from "./ui/start-tui.js";
import type { StartTuiOptions } from "./ui/start-tui.js";
import { probeConnection } from "./setup/probe.js";

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
  /** 首启配置向导钩子；测试注入假实现，避免真的进入 Ink 渲染。 */
  runSetupWizard?: (request: SetupWizardRequest) => Promise<SetupOutcome>;
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

/**
 * 读取上下文窗口大小（token）。默认 {@link DEFAULT_CONTEXT_TOKENS}；
 * `MEWCODE_CONTEXT_TOKENS` 可覆盖（小窗口便于手工观察压缩，S3-4 B 级验收）。
 */
function readContextTokens(env: NodeJS.ProcessEnv): number {
  const raw = env["MEWCODE_CONTEXT_TOKENS"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_CONTEXT_TOKENS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_CONTEXT_TOKENS;
}

/**
 * 压缩统计回调：只在 `MEWCODE_DEBUG=1` 时输出，且只报告"真的发生了压缩"的情况，
 * 满足 S3-4 B 级第 3 项「观察压缩前后 token 估算」。
 */
function createCompressionReporter(
  debug: boolean,
  writeError: (text: string) => void,
): ((info: CompressResult) => void) | undefined {
  if (!debug) {
    return undefined;
  }
  return (info) => {
    if (info.droppedTurns === 0 && !info.truncated) {
      return;
    }
    const note = info.truncated ? "（截断最新轮）" : "";
    writeError(
      `[压缩] 丢弃 ${info.droppedTurns} 轮，tokens ${info.beforeTokens} → ${info.afterTokens}${note}\n`,
    );
  };
}

/** 把 HTTP 状态码翻译成"下一步怎么做"的映射在 `errors.ts` 里（S4-1 起 UI 与 headless 共用）。 */

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
  const contextTokens = readContextTokens(env);
  const onCompress = createCompressionReporter(debug, writeError);
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
    contextTokens,
    onCompress,
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
          // S4-1：失败时连"下一步"一起打出来，headless 用户也能自己修。
          const failure = describeToolFailure(event.result.output);
          writeError(`  ${failure.what}\n`);
          if (failure.next !== null) {
            writeError(`  下一步：${failure.next}\n`);
          }
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
    writeError(
      `（已达到最大步数 ${result.steps}，已停止）\n` +
        '下一步：回复"继续"让我接着做，或把任务拆小后重发。\n',
    );
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

    // 加载两处 .env：用户级（默认 ~/.mewcode/.env，供全局安装跨目录使用）在前，
    // 项目根目录 .env 在后；加载器不覆盖已存在的环境变量，因此项目配置优先。
    const loadEnv = deps.loadDotEnv ?? loadDotEnv;
    for (const envPath of resolveEnvFilePaths(cwd, env)) {
      loadEnv(envPath);
    }

    // 用户级结构化配置（首次配置向导写入的 config.json）；损坏只警告，不阻断启动。
    let stored: UserConfig = {};
    const storedRead = readUserConfig(env);
    if (storedRead.kind === "loaded") {
      stored = storedRead.config;
    } else if (storedRead.kind === "corrupt") {
      writeError(
        `警告：用户配置文件损坏，已忽略（${storedRead.path}）。\n原因：${storedRead.reason}\n下一步：运行 mewagent --setup 重新生成，或删除该文件后重试。\n`,
      );
    }

    const version = readPackageVersion();
    const interactive = !options.print && stdinIsTTY && stdoutIsTTY;
    if (options.setup && !interactive) {
      throw new CliError(
        "--setup 需要交互式终端（TTY）。\n下一步：在 Windows Terminal 等终端里运行 mewagent --setup；非交互场景请改用环境变量或 .env 配置。",
      );
    }

    const missing = findMissingConfig(options, env, stored);
    if (options.setup || (interactive && (missing.model || missing.apiKey))) {
      const existingKey =
        (env.MEWCODE_API_KEY ?? "").trim() !== ""
          ? env.MEWCODE_API_KEY?.trim()
          : stored.apiKey;
      const initialBaseUrl =
        (
          options.baseUrl ??
          env.MEWCODE_BASE_URL ??
          stored.baseUrl ??
          DEFAULT_BASE_URL
        )
          .trim()
          .replace(/\/+$/, "") || DEFAULT_BASE_URL;
      const initialModel =
        (options.model ?? env.MEWCODE_MODEL ?? stored.model)?.trim() ||
        DEFAULT_SUGGESTED_MODEL;
      const wizard = deps.runSetupWizard ?? runSetupWizard;
      const outcome = await wizard({
        version,
        initial: {
          baseUrl: initialBaseUrl,
          model: initialModel,
          hasApiKey: existingKey !== undefined,
        },
        probe: (draft) =>
          probeConnection({
            baseUrl: draft.baseUrl,
            model: draft.model,
            apiKey: draft.apiKey !== "" ? draft.apiKey : (existingKey ?? ""),
            fetchImpl: deps.fetchImpl,
          }),
        onSubmit: (draft) => {
          const toSave: UserConfig = {
            baseUrl: draft.baseUrl,
            model: draft.model,
            ...(draft.apiKey === "" ? {} : { apiKey: draft.apiKey }),
          };
          return saveUserConfig(env, toSave);
        },
      });
      if (outcome.kind === "cancelled") {
        throw new CliError(
          "已取消首次配置向导。\n下一步：重新运行 mewagent 再试；或运行 mewagent --setup；也可以改用环境变量或 .env 配置（见 README）。",
        );
      }
      stored = { ...stored, ...outcome.config };
      if (options.setup) {
        write(
          `配置已保存：${outcome.path}\n下一步：运行 mewagent 开始对话（在任何目录都可以）；想重新配置再运行 mewagent --setup。\n`,
        );
        return 0;
      }
    }

    const config = resolveConfig(options, env, cwd, stored);

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
    // S3-2：交互审批桥——gate 的 ask 挂起，App 渲染 ApprovalPrompt，按键后 respond。
    const approvals = createApprovalController();
    const permissions = createPermissionGate({
      tools,
      workspace: config.workspace,
      mode: "interactive",
      ask: approvals.ask,
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
        contextTokens: readContextTokens(env),
        onCompress: createCompressionReporter(readDebugEnabled(env), writeError),
      });
    // S3-3：启动时恢复上次会话（`--new` 跳过）；损坏时按新会话启动并提示原因。
    const session = loadSession(config.workspace, { forceNew: config.newSession });
    const initialMessages = session.kind === "loaded" ? session.messages : [];
    const restoredMessageCount = session.kind === "loaded" ? session.messages.length : 0;
    const sessionNotice =
      session.kind === "corrupt"
        ? `会话文件损坏，已按新会话启动（${session.reason}）`
        : undefined;
    const sessionCreatedAt =
      session.kind === "loaded" ? session.createdAt : new Date().toISOString();
    const persistMessages = (messages: readonly Message[]): void => {
      const saved = saveSession(config.workspace, config.model, messages, {
        createdAt: sessionCreatedAt,
      });
      if (!saved.ok) {
        writeError(`警告：会话保存失败：${saved.reason}\n`);
      }
    };
    const launchTui = deps.startTui ?? startTui;
    await launchTui({
      version,
      config,
      runTurn,
      toolNames: tools.names(),
      approvals,
      initialMessages,
      restoredMessageCount,
      sessionNotice,
      persistMessages,
    });
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      writeError(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof LlmHttpError) {
      writeError(`${error.message}\n下一步：${describeHttpStatus(error.status)}\n`);
      return 1;
    }
    if (isNetworkFailure(error)) {
      const failure = describeFailure(error);
      writeError(`${failure.what}\n下一步：${failure.next}\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeError(`内部错误：${message}\n下一步：可先重试一次；仍失败请把上面的错误信息与操作步骤反馈给维护者。\n`);
    return 1;
  }
}

// 直接运行时才启动 CLI。比较真实路径而不是字面 URL：
// `npm link` / `npx` 会把 dist/index.js 通过 junction/symlink 暴露出去，
// 此时 process.argv[1] 是链接路径，而 import.meta.url 已被 Node 解析为真实路径。
function isDirectRun(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) {
    return false;
  }
  try {
    const entryReal = realpathSync(path.resolve(entryPath));
    const moduleReal = realpathSync(fileURLToPath(import.meta.url));
    return path.resolve(entryReal) === path.resolve(moduleReal);
  } catch {
    return pathToFileURL(entryPath).href === import.meta.url;
  }
}

if (isDirectRun()) {
  process.exitCode = await main(process.argv.slice(2));
}
