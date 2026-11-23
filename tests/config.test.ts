// S0-3 配置层与入口骨架的自动化测试。
// 覆盖：参数解析、env/CLI 优先级、缺 key/缺模型/坏 workspace 的可操作报错、
// `.env` 加载、以及 `main()` 在 --help/--version/--print/无 TTY 下的行为。
// 全程不联网、不弹 UI、不读真实 stdin（readStdin 注入）。

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

import {
  CliError,
  DEFAULT_BASE_URL,
  DEFAULT_MOCK_MODEL,
  loadDotEnv,
  parseArgs,
  readPackageVersion,
  resolveConfig,
  usage,
} from "../src/config.js";
import { main } from "../src/index.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mewagent-test-"));
}

function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  readStdin?: () => string;
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
    env: options.env ?? {},
    cwd: options.cwd,
    stdinIsTTY: options.stdinIsTTY ?? false,
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    readStdin: options.readStdin,
    loadDotEnv: () => {
      // 测试要完全确定：不读真实 .env。
    },
    write: (text: string) => {
      out += text;
    },
    writeError: (text: string) => {
      err += text;
    },
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

test("main：TTY 下交互模式打印 S1 骨架横幅（退出 0）", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runCli(["--mock"], {
      cwd,
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });
    assert.equal(result.code, 0);
    assert.match(result.out, /TUI 将在 S1 实现/);
    assert.ok(result.out.includes(`workspace: ${path.resolve(cwd)}`));
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
