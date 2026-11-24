// S0-3 配置层与入口骨架的自动化测试。
// 覆盖：参数解析、env/CLI 优先级、缺 key/缺模型/坏 workspace 的可操作报错、
// `.env` 加载、以及 `main()` 在 --help/--version/--print/无 TTY 下的行为。
// 全程不联网、不弹 UI、不读真实 stdin（readStdin 注入）。

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

/** 测试用的“用户配置目录”：指向不存在的路径，避免读到开发者本机 `~/.mewcode/config.json`。 */
const TEST_HOME_DIR = path.join(tmpdir(), `mewagent-test-home-${process.pid}`);

import {
  CliError,
  DEFAULT_BASE_URL,
  DEFAULT_MOCK_MODEL,
  applyEnvContent,
  loadDotEnv,
  loadDotEnvFallback,
  parseArgs,
  readPackageVersion,
  resolveConfig,
  resolveEnvFilePaths,
  resolveUserConfigDir,
  resolveUserEnvPath,
  usage,
} from "../src/config.js";
import { main } from "../src/index.js";
import type { FetchLike } from "../src/llm/openai.js";
import type { AgentEvent, Message } from "../src/types.js";
import type {
  SetupOutcome,
  SetupWizardRequest,
} from "../src/ui/start-setup.js";
import type { StartTuiOptions } from "../src/ui/start-tui.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mewagent-test-"));
}

function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface FetchStubOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: ReadableStream<Uint8Array> | null;
  /** 依次返回不同 body（用于多轮请求：工具调用 → 最终文本）。 */
  bodies?: readonly ReadableStream<Uint8Array>[];
  text?: () => Promise<string>;
  /** 抛出的错误（模拟断网/代理失败）。 */
  fail?: Error;
}

/** 假 fetch：记录请求体，默认返回一个空 SSE 流；测试全程不联网。 */
function createFetchStub(options: FetchStubOptions = {}): {
  fetchImpl: FetchLike;
  calls: { url: string; body: string }[];
} {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    if (options.fail !== undefined) throw options.fail;
    const queuedBody = options.bodies?.[calls.length - 1];
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      statusText: options.statusText ?? "OK",
      body: queuedBody ?? options.body ?? sseStream(["data: [DONE]\n\n"]),
      text: options.text ?? (async () => ""),
    };
  };
  return { fetchImpl, calls };
}

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  readStdin?: () => string;
  /** 注入交互 TUI 启动器：测试里不真的进入 Ink 渲染。 */
  startTui?: (options: StartTuiOptions) => Promise<void>;
  /** 注入真实 API 的 fetch：测试用假 SSE 流，避免联网。 */
  fetchImpl?: FetchLike;
  /** 覆盖 `.env` 加载钩子（默认空实现，测试不读真实 .env）。 */
  loadDotEnv?: (envPath: string) => void;
  /** 注入首次配置向导：默认返回取消，避免测试真的进入 Ink 渲染。 */
  runSetupWizard?: (request: SetupWizardRequest) => Promise<SetupOutcome>;
}

interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** 用注入的 IO 跑一次 `main()`，测试里不碰真实 stdout/stderr/.env。 */
async function runCli(argv: string[], options: RunOptions = {}): Promise<RunResult> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    env: { MEWCODE_HOME: TEST_HOME_DIR, ...(options.env ?? {}) },
    cwd: options.cwd,
    stdinIsTTY: options.stdinIsTTY ?? false,
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    readStdin: options.readStdin ?? (() => ""),
    loadDotEnv:
      options.loadDotEnv ??
      (() => {
        // 测试要完全确定：不读真实 .env。
      }),
    write: (text: string) => {
      out += text;
    },
    writeError: (text: string) => {
      err += text;
    },
    startTui: options.startTui ?? (async () => {}),
    runSetupWizard:
      options.runSetupWizard ??
      (async () => ({ kind: "cancelled" }) as SetupOutcome),
    fetchImpl: options.fetchImpl,
  });
  return { code, out, err };
}

test("parseArgs：帮助/版本/布尔开关", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["-v"]).version, true);

  const flags = parseArgs(["--mock", "--print", "--new"]);
  assert.equal(flags.mock, true);
  assert.equal(flags.print, true);
  assert.equal(flags.newSession, true);
  assert.equal(flags.prompt, "");
});

test("parseArgs：值参数支持空格与 = 两种写法", () => {
  const spaced = parseArgs([
    "--model",
    "deepseek-chat",
    "--base-url",
    "https://example.com/v1",
    "--workspace",
    "testbed",
  ]);
  assert.equal(spaced.model, "deepseek-chat");
  assert.equal(spaced.baseUrl, "https://example.com/v1");
  assert.equal(spaced.workspace, "testbed");

  const equals = parseArgs([
    "--model=m2",
    "--base-url=https://example.com/v2",
    "--workspace=src",
  ]);
  assert.equal(equals.model, "m2");
  assert.equal(equals.baseUrl, "https://example.com/v2");
  assert.equal(equals.workspace, "src");
});

test("parseArgs：位置参数拼成 prompt，-- 之后一律当文本", () => {
  assert.equal(parseArgs(["你好"]).prompt, "你好");
  assert.equal(parseArgs(["你好", "世界"]).prompt, "你好 世界");
  assert.equal(parseArgs(["--print", "--", "--foo", "bar"]).prompt, "--foo bar");
});

test("parseArgs：未知参数/缺少值/空值都抛可操作的 CliError", () => {
  assert.throws(
    () => parseArgs(["--foo"]),
    (error: unknown) =>
      error instanceof CliError &&
      error.message.includes("未知参数：--foo") &&
      error.message.includes("--help") &&
      error.exitCode === 2,
  );
  assert.throws(
    () => parseArgs(["--model"]),
    (error: unknown) =>
      error instanceof CliError && error.message.includes("--model 缺少值"),
  );
  assert.throws(
    () => parseArgs(["--model", "--mock"]),
    (error: unknown) =>
      error instanceof CliError && error.message.includes("--model 缺少值"),
  );
  assert.throws(
    () => parseArgs(["--workspace="]),
    (error: unknown) =>
      error instanceof CliError && error.message.includes("缺少值"),
  );
});

test("parseArgs：重复参数以最后一次为准", () => {
  const options = parseArgs(["--model", "first", "--model", "last"]);
  assert.equal(options.model, "last");
});

test("resolveConfig：CLI 参数覆盖环境变量，key 只来自环境变量", () => {
  const cwd = makeTempDir();
  const sub = path.join(cwd, "sub");
  try {
    mkdirSync(sub, { recursive: true });
    const config = resolveConfig(
      (() => {
        const options = parseArgs([
          "--model",
          "cli-model",
          "--base-url",
          "https://cli.example/v1/",
          "--workspace",
          "sub",
        ]);
        return options;
      })(),
      {
        MEWCODE_API_KEY: "sk-env-key",
        MEWCODE_MODEL: "env-model",
        MEWCODE_BASE_URL: "https://env.example/v1",
      },
      cwd,
    );
    assert.equal(config.model, "cli-model");
    assert.equal(config.baseUrl, "https://cli.example/v1");
    assert.equal(config.apiKey, "sk-env-key");
    assert.equal(config.workspace, path.join(cwd, "sub"));
    assert.equal(config.mock, false);
  } finally {
    removeTempDir(cwd);
  }
});

test("resolveConfig：环境变量生效，baseUrl 缺省用默认值", () => {
  const cwd = makeTempDir();
  try {
    const config = resolveConfig(
      parseArgs(["--mock"]),
      { MEWCODE_API_KEY: "sk-env-key", MEWCODE_MODEL: "env-model" },
      cwd,
    );
    assert.equal(config.model, "env-model");
    assert.equal(config.baseUrl, DEFAULT_BASE_URL);
    // --workspace 缺省 = 当前目录的绝对路径。
    assert.equal(config.workspace, path.resolve(cwd));
  } finally {
    removeTempDir(cwd);
  }
});

test("resolveConfig：--mock 不需要 key/模型名", () => {
  const cwd = makeTempDir();
  try {
    const config = resolveConfig(parseArgs(["--mock"]), {}, cwd);
    assert.equal(config.mock, true);
    assert.equal(config.apiKey, "");
    assert.equal(config.model, DEFAULT_MOCK_MODEL);
  } finally {
    removeTempDir(cwd);
  }
});

test("resolveConfig：缺 key 报错可操作且不含密钥", () => {
  const cwd = makeTempDir();
  try {
    assert.throws(
      () =>
        resolveConfig(
          parseArgs(["--print"]),
          { MEWCODE_MODEL: "deepseek-chat", MEWCODE_API_KEY: "  " },
          cwd,
        ),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.match(error.message, /缺少 API key/);
        assert.match(error.message, /下一步/);
        assert.match(error.message, /\.env\.example/);
        assert.doesNotMatch(error.message, /sk-/);
        assert.equal(error.exitCode, 2);
        return true;
      },
    );
  } finally {
    removeTempDir(cwd);
  }
});

test("resolveConfig：非 mock 缺模型名同样给出下一步", () => {
  const cwd = makeTempDir();
  try {
    assert.throws(
      () => resolveConfig(parseArgs([]), { MEWCODE_API_KEY: "sk-env-key" }, cwd),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("缺少模型名") &&
        error.message.includes("--model"),
    );
  } finally {
    removeTempDir(cwd);
  }
});

test("resolveConfig：workspace 不存在时报错", () => {
  const cwd = makeTempDir();
  try {
    const missing = path.join(cwd, "definitely-not-here");
    assert.throws(
      () => resolveConfig(parseArgs(["--mock", "--workspace", missing]), {}, cwd),
      (error: unknown) =>
        error instanceof CliError &&
        error.message.includes("工作区不存在") &&
        error.message.includes("--workspace"),
    );
  } finally {
    removeTempDir(cwd);
  }
});

test("loadDotEnv：读取 .env，文件缺失时静默跳过", () => {
  const dir = makeTempDir();
  const envKey = "MEWCODE_TEST_DOTENV_MARKER";
  const previous = process.env[envKey];
  try {
    const envPath = path.join(dir, ".env");
    writeFileSync(envPath, `${envKey}=来自文件\n`, "utf8");
    delete process.env[envKey];
    loadDotEnv(envPath);
    assert.equal(process.env[envKey], "来自文件");

    assert.doesNotThrow(() => loadDotEnv(path.join(dir, "missing.env")));
  } finally {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
    removeTempDir(dir);
  }
});

test("loadDotEnvFallback：老 Node 兜底解析（注释/空行/export/引号/CRLF/已有变量优先）", () => {
  const dir = makeTempDir();
  const keys = [
    "MEWCODE_TEST_FALLBACK_A",
    "MEWCODE_TEST_FALLBACK_B",
    "MEWCODE_TEST_FALLBACK_C",
    "MEWCODE_TEST_FALLBACK_D",
    "MEWCODE_TEST_FALLBACK_EXISTING",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    process.env.MEWCODE_TEST_FALLBACK_EXISTING = "已有值";
    const content = [
      "# 注释行忽略",
      "",
      "MEWCODE_TEST_FALLBACK_A=plain",
      "export MEWCODE_TEST_FALLBACK_B=exported",
      'MEWCODE_TEST_FALLBACK_C="带 空格 # 井号"',
      "MEWCODE_TEST_FALLBACK_D='单引号'",
      "MEWCODE_TEST_FALLBACK_EXISTING=文件值",
      "",
    ].join("\r\n");
    const envPath = path.join(dir, ".env");
    writeFileSync(envPath, content, "utf8");
    loadDotEnvFallback(envPath);
    assert.equal(process.env.MEWCODE_TEST_FALLBACK_A, "plain");
    assert.equal(process.env.MEWCODE_TEST_FALLBACK_B, "exported");
    assert.equal(process.env.MEWCODE_TEST_FALLBACK_C, "带 空格 # 井号");
    assert.equal(process.env.MEWCODE_TEST_FALLBACK_D, "单引号");
    assert.equal(process.env.MEWCODE_TEST_FALLBACK_EXISTING, "已有值");

    // 文件缺失时让 ENOENT 冒泡，由 loadDotEnv 统一静默处理。
    assert.throws(() => loadDotEnvFallback(path.join(dir, "missing.env")));
    assert.doesNotThrow(() =>
      loadDotEnv(path.join(dir, "missing.env"), loadDotEnvFallback),
    );
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    removeTempDir(dir);
  }
});

test("applyEnvContent：格式非法时报行号与下一步，且不回显值", () => {
  const secret = "sk-should-not-leak-123456";
  assert.throws(
    () => applyEnvContent(`OK=1\n${secret}\n`, "测试 .env"),
    (error: unknown) =>
      error instanceof CliError &&
      error.message.includes("第 2 行") &&
      error.message.includes("下一步：") &&
      !error.message.includes(secret),
  );
  assert.throws(
    () => applyEnvContent("1BAD=1\n", "测试 .env"),
    (error: unknown) =>
      error instanceof CliError && error.message.includes("变量名不合法"),
  );
});

test("resolveUserEnvPath / resolveEnvFilePaths：用户级 ~/.mewcode/.env 在前，项目 .env 在后", () => {
  const home = makeTempDir();
  const cwd = makeTempDir();
  try {
    assert.equal(resolveUserConfigDir({}), path.join(homedir(), ".mewcode"));
    assert.equal(
      resolveUserEnvPath({}),
      path.join(homedir(), ".mewcode", ".env"),
    );
    assert.equal(resolveUserConfigDir({ MEWCODE_HOME: home }), path.resolve(home));
    assert.equal(
      resolveUserEnvPath({ MEWCODE_HOME: home }),
      path.join(path.resolve(home), ".env"),
    );
    assert.deepEqual(resolveEnvFilePaths(cwd, { MEWCODE_HOME: home }), [
      path.join(path.resolve(home), ".env"),
      path.join(cwd, ".env"),
    ]);
    // 项目目录就是用户级目录时去重
    assert.deepEqual(resolveEnvFilePaths(home, { MEWCODE_HOME: home }), [
      path.join(path.resolve(home), ".env"),
    ]);
  } finally {
    removeTempDir(home);
    removeTempDir(cwd);
  }
});

test("main：依次加载用户级 .env 与项目 .env（用户级在前，项目优先）", async () => {
  const cwd = makeTempDir();
  const home = makeTempDir();
  try {
    const loaded: string[] = [];
    const result = await runCli(["--mock", "--print", "你好"], {
      cwd,
      env: { MEWCODE_HOME: home },
      loadDotEnv: (envPath) => loaded.push(envPath),
    });
    assert.equal(result.code, 0);
    assert.deepEqual(loaded, [
      path.join(path.resolve(home), ".env"),
      path.join(cwd, ".env"),
    ]);
  } finally {
    removeTempDir(cwd);
    removeTempDir(home);
  }
});

test("readPackageVersion：与 package.json 的 version 一致", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  assert.equal(typeof packageJson.version, "string");
  assert.equal(readPackageVersion(), packageJson.version);
});

test("usage：列出全部 CLI 参数与环境变量", () => {
  const text = usage("0.1.0");
  for (const flag of [
    "--model",
    "--base-url",
    "--workspace",
    "--new",
    "--mock",
    "--print",
    "--help",
    "--version",
  ]) {
    assert.ok(text.includes(flag), `usage 缺少 ${flag}`);
  }
  for (const envKey of [
    "MEWCODE_API_KEY",
    "MEWCODE_BASE_URL",
    "MEWCODE_MODEL",
    "MEWCODE_HOME",
    "MEWCODE_SHELL",
  ]) {
    assert.ok(text.includes(envKey), `usage 缺少 ${envKey}`);
  }
});

test("main：--help 输出用法并退出 0", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.err, "");
  assert.match(result.out, /用法：/);
  assert.match(result.out, /--model/);
  assert.match(result.out, /--print/);
});

test("main：--version 输出版本号并退出 0", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.out.trim(), readPackageVersion());
});

test("main：未知参数退出 2，stderr 指明下一步", async () => {
  const result = await runCli(["--foo"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /未知参数：--foo/);
  assert.match(result.err, /--help/);
});

test("main：缺 key 时 headless 报错可操作（退出 2）", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "你好"], {
      cwd,
      env: { MEWCODE_MODEL: "deepseek-chat" },
    });
    assert.equal(result.code, 2);
    assert.match(result.err, /缺少 API key/);
    assert.match(result.err, /下一步/);
    assert.equal(result.out, "");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--mock --print 走骨架输出（workspace/model/prompt 可见）", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--mock", "--print", "你好"], {
      cwd,
      env: {},
    });
    assert.equal(result.code, 0);
    assert.equal(result.err, "");
    assert.ok(result.out.includes(`workspace: ${path.resolve(cwd)}`));
    assert.ok(result.out.includes(`model: ${DEFAULT_MOCK_MODEL}`));
    assert.ok(result.out.includes("mock: true"));
    assert.ok(result.out.includes("prompt: 你好"));
  } finally {
    removeTempDir(cwd);
  }
});

test("main：非 TTY 交互模式报错并提示 --print（退出 2）", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--mock"], {
      cwd,
      env: {},
      stdinIsTTY: false,
      stdoutIsTTY: false,
    });
    assert.equal(result.code, 2);
    assert.match(result.err, /不是交互式终端/);
    assert.match(result.err, /--print/);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：TTY 下启动交互 TUI（注入 startTui，退出 0）", async () => {
  const cwd = makeTempDir();
  try {
    const captured: StartTuiOptions[] = [];
    const result = await runCli(["--mock"], {
      cwd,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async (options) => {
        captured.push(options);
      },
    });
    assert.equal(result.code, 0);
    const tui = captured[0];
    assert.ok(tui !== undefined);
    assert.equal(tui.config.mock, true);
    assert.equal(tui.config.workspace, path.resolve(cwd));
    assert.equal(tui.config.model, DEFAULT_MOCK_MODEL);
    assert.equal(tui.version, readPackageVersion());
    assert.ok(tui.toolNames.includes("read_file"));
    assert.equal(tui.toolNames.length, 6);

    // S2-7：TUI 的 runTurn 走完整 Agent Loop（mock 剧本：工具调用 → 真实执行 → 最终文本）。
    const events: AgentEvent[] = [];
    const turnResult = await tui.runTurn([{ role: "user", content: "你好" }], {
      signal: new AbortController().signal,
      emit: (event) => {
        events.push(event);
      },
    });
    assert.equal(turnResult.stopReason, "stop");
    assert.ok(events.some((event) => event.type === "tool_start"), "应有 tool_start 事件");
    assert.ok(events.some((event) => event.type === "tool_end"), "应有 tool_end 事件");
    assert.ok(
      events.some((event) => event.type === "assistant_text"),
      "应有 assistant_text 事件",
    );
    assert.equal(turnResult.messages[0]?.role, "system", "loop 应把 system prompt 放首位");
    const finalMessage = turnResult.messages.at(-1);
    assert.equal(finalMessage?.role, "assistant");
    if (finalMessage?.role === "assistant") {
      assert.match(finalMessage.content, /离线 mock|两轮/);
    }
  } finally {
    removeTempDir(cwd);
  }
});

test("main：TUI 启动时恢复上次会话（S3-3）", async () => {
  const cwd = makeTempDir();
  try {
    const sessionDir = path.join(cwd, ".mewcode");
    mkdirSync(sessionDir, { recursive: true });
    const oldMessages: Message[] = [
      { role: "user", content: "上一轮问题" },
      { role: "assistant", content: "上一轮回答", toolCalls: [] },
    ];
    const stored = {
      version: 1,
      workspace: path.resolve(cwd),
      model: "deepseek-chat",
      createdAt: "2026-11-20T00:00:00.000Z",
      updatedAt: "2026-11-20T00:00:00.000Z",
      messages: oldMessages,
    };
    writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(stored), "utf8");

    const captured: StartTuiOptions[] = [];
    const result = await runCli(["--mock"], {
      cwd,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async (options) => {
        captured.push(options);
      },
    });
    assert.equal(result.code, 0);
    const tui = captured[0];
    assert.ok(tui !== undefined);
    assert.equal(tui.restoredMessageCount, 2, "恢复条数应等于文件里的消息数");
    assert.deepEqual(tui.initialMessages, oldMessages);
    assert.equal(tui.sessionNotice, undefined);

    // 每轮结束的 persistMessages 应写回文件，并保留原有 createdAt。
    assert.ok(tui.persistMessages !== undefined);
    tui.persistMessages([
      ...oldMessages,
      { role: "user", content: "新问题" },
      { role: "assistant", content: "新回答", toolCalls: [] },
    ]);
    const saved = JSON.parse(
      readFileSync(path.join(sessionDir, "session.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(saved["createdAt"], stored.createdAt);
    assert.equal((saved["messages"] as readonly unknown[]).length, 4);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：会话文件损坏时提示并按新会话启动（S3-3）", async () => {
  const cwd = makeTempDir();
  try {
    const sessionDir = path.join(cwd, ".mewcode");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, "session.json"), "{ 坏 json", "utf8");

    const captured: StartTuiOptions[] = [];
    const result = await runCli(["--mock"], {
      cwd,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async (options) => {
        captured.push(options);
      },
    });
    assert.equal(result.code, 0);
    const tui = captured[0];
    assert.ok(tui !== undefined);
    assert.equal(tui.restoredMessageCount, 0);
    assert.deepEqual(tui.initialMessages, []);
    assert.match(tui.sessionNotice ?? "", /会话文件损坏/);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--new 忽略已有会话（S3-3）", async () => {
  const cwd = makeTempDir();
  try {
    const sessionDir = path.join(cwd, ".mewcode");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "session.json"),
      JSON.stringify({
        version: 1,
        workspace: path.resolve(cwd),
        model: "deepseek-chat",
        createdAt: "2026-11-20T00:00:00.000Z",
        updatedAt: "2026-11-20T00:00:00.000Z",
        messages: [
          { role: "user", content: "旧问题" },
          { role: "assistant", content: "旧回答", toolCalls: [] },
        ],
      }),
      "utf8",
    );

    const captured: StartTuiOptions[] = [];
    const result = await runCli(["--mock", "--new"], {
      cwd,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async (options) => {
        captured.push(options);
      },
    });
    assert.equal(result.code, 0);
    const tui = captured[0];
    assert.ok(tui !== undefined);
    assert.equal(tui.restoredMessageCount, 0, "--new 不应恢复历史");
    assert.deepEqual(tui.initialMessages, []);
    assert.equal(tui.sessionNotice, undefined);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--workspace 相对/绝对路径都生效", async () => {
  const cwd = makeTempDir();
  const nested = path.join(cwd, "nested");
  try {
    mkdirSync(nested, { recursive: true });
    const result = await runCli(["--mock", "--print", "hi", "--workspace", "nested"], {
      cwd,
      env: {},
    });
    assert.equal(result.code, 0);
    assert.ok(result.out.includes(`workspace: ${nested}`));
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--model/--base-url 覆盖环境变量", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(
      [
        "--mock",
        "--print",
        "hi",
        "--model",
        "cli-model",
        "--base-url",
        "https://cli.example/v1",
      ],
      { cwd, env: { MEWCODE_MODEL: "env-model" } },
    );
    assert.equal(result.code, 0);
    assert.ok(result.out.includes("model: cli-model"));
    assert.ok(result.out.includes("base-url: https://cli.example/v1"));
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--print 无位置参数且 stdin 非 TTY 时从 stdin 读 prompt", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--mock", "--print"], {
      cwd,
      env: {},
      stdinIsTTY: false,
      readStdin: () => "来自 stdin\n",
    });
    assert.equal(result.code, 0);
    assert.ok(result.out.includes("prompt: 来自 stdin"));
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--print 无 prompt 且 stdin 是 TTY 时报错", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--mock", "--print"], {
      cwd,
      env: {},
      stdinIsTTY: true,
    });
    assert.equal(result.code, 2);
    assert.match(result.err, /缺少 prompt/);
  } finally {
    removeTempDir(cwd);
  }
});

// ---- S1-5：--print 接真实 API（全部用假 fetch，不联网） ----

test("main：--print 真实 API 流式输出到 stdout（退出 0，system prompt 在首位）", async () => {
  const { fetchImpl, calls } = createFetchStub({
    body: sseStream([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  });
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "你好"], {
      cwd,
      env: {
        MEWCODE_API_KEY: "test-key",
        MEWCODE_MODEL: "test-model",
        MEWCODE_BASE_URL: "https://api.example.com",
      },
      fetchImpl,
    });

    assert.equal(result.code, 0);
    assert.equal(result.out, "你好\n", "stdout 只放模型文本，便于管道/重定向");
    assert.match(result.err, /headless · model: test-model/);
    assert.ok(!result.err.includes("内部错误"));

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call !== undefined);
    assert.equal(call.url, "https://api.example.com/chat/completions");
    const parsed: unknown = JSON.parse(call.body);
    assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
    const body = parsed as Record<string, unknown>;
    assert.equal(body["stream"], true);
    const messages = body["messages"];
    assert.ok(Array.isArray(messages));
    const firstMessage = messages[0] as Record<string, unknown> | undefined;
    assert.equal(firstMessage?.["role"], "system", "system prompt 必须在首位");
    const secondMessage = messages[1] as Record<string, unknown> | undefined;
    assert.equal(secondMessage?.["role"], "user");
    assert.equal(secondMessage?.["content"], "你好");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：MEWCODE_DEBUG=1 打印请求体（不含 apiKey）", async () => {
  const { fetchImpl } = createFetchStub();
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "你好"], {
      cwd,
      env: {
        MEWCODE_API_KEY: "sk-debug-secret",
        MEWCODE_MODEL: "test-model",
        MEWCODE_DEBUG: "1",
      },
      fetchImpl,
    });

    assert.equal(result.code, 0);
    assert.match(result.err, /\[debug\] 请求体：/);
    assert.match(result.err, /"role":"system"/);
    assert.ok(!result.err.includes("sk-debug-secret"), "调试输出不能泄露 API key");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：401 时退出 1，提示检查 key 且摘要脱敏", async () => {
  const { fetchImpl } = createFetchStub({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    body: null,
    text: async () =>
      JSON.stringify({ error: { message: "Incorrect API key provided: sk-bad-secret" } }),
  });
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "你好"], {
      cwd,
      env: { MEWCODE_API_KEY: "sk-bad-secret", MEWCODE_MODEL: "test-model" },
      fetchImpl,
    });

    assert.equal(result.code, 1);
    assert.match(result.err, /401/);
    assert.match(result.err, /下一步/);
    assert.match(result.err, /MEWCODE_API_KEY/);
    assert.match(result.err, /\[REDACTED\]/);
    assert.ok(!result.err.includes("sk-bad-secret"), "错误消息不能泄露 API key");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：网络失败时退出 1 并提示网络与代理", async () => {
  const { fetchImpl } = createFetchStub({ fail: new TypeError("fetch failed") });
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "你好"], {
      cwd,
      env: { MEWCODE_API_KEY: "test-key", MEWCODE_MODEL: "test-model" },
      fetchImpl,
    });

    assert.equal(result.code, 1);
    assert.match(result.err, /网络请求失败/);
    assert.match(result.err, /127\.0\.0\.1:7890/);
  } finally {
    removeTempDir(cwd);
  }
});

// ---- S3-1：headless 权限闸（写工具被拒 → 原因回填模型 → 模型换方案） ----

test("main：--print headless 拒绝写工具，拒绝原因回填给模型（退出 0 且不落文件）", async () => {
  const { fetchImpl, calls } = createFetchStub({
    bodies: [
      sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_w1","function":{"name":"write_file","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"x\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      sseStream([
        'data: {"choices":[{"delta":{"content":"无法写文件"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ],
  });
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--print", "写个文件"], {
      cwd,
      env: { MEWCODE_API_KEY: "test-key", MEWCODE_MODEL: "test-model" },
      fetchImpl,
    });

    assert.equal(result.code, 0);
    assert.equal(result.out, "无法写文件\n", "stdout 仍只放模型文本");
    assert.match(result.err, /\[工具\] write_file/);
    assert.match(result.err, /\[工具结果\] write_file 失败/);
    assert.match(result.err, /权限被拒绝/);
    assert.match(result.err, /headless/);

    assert.equal(calls.length, 2, "拒绝原因必须回填给模型，再跑一轮");
    const secondBody = calls[1]?.body ?? "";
    assert.match(secondBody, /"role":"tool"/);
    assert.match(secondBody, /权限被拒绝/);
    assert.match(secondBody, /headless/);
    assert.ok(!existsSync(path.join(cwd, "a.txt")), "headless 写工具必须真的不执行");
  } finally {
    removeTempDir(cwd);
  }
});
