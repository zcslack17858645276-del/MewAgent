// 首次配置向导与入口接线：--setup 解析、配置优先级、main() 自动弹向导/取消/非 TTY 行为。
// 全程不联网、不进入 Ink 渲染（runSetupWizard 注入假实现）。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DEFAULT_BASE_URL,
  DEFAULT_SUGGESTED_MODEL,
  findMissingConfig,
  parseArgs,
  resolveConfig,
  resolveUserConfigPath,
  usage,
} from "../src/config.js";
import { main } from "../src/index.js";
import type { SetupOutcome, SetupWizardRequest } from "../src/ui/start-setup.js";
import type { StartTuiOptions } from "../src/ui/start-tui.js";

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mewagent-wizard-"));
}

/** 测试用的“用户配置目录”：指向不存在的路径，避免读到开发者本机 `~/.mewcode/config.json`。 */
const TEST_HOME_DIR = path.join(tmpdir(), `mewagent-wizard-home-${process.pid}`);

function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

interface WizardRunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  runSetupWizard?: (request: SetupWizardRequest) => Promise<SetupOutcome>;
  startTui?: (options: StartTuiOptions) => Promise<void>;
}

async function runMain(
  argv: string[],
  options: WizardRunOptions = {},
): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    env: { MEWCODE_HOME: TEST_HOME_DIR, ...(options.env ?? {}) },
    cwd: options.cwd,
    stdinIsTTY: options.stdinIsTTY ?? false,
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    readStdin: () => "",
    loadDotEnv: () => {},
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
  });
  return { code, out, err };
}

test("parseArgs：--setup 开关", () => {
  assert.equal(parseArgs(["--setup"]).setup, true);
  assert.equal(parseArgs([]).setup, false);
  assert.equal(parseArgs(["--print", "--setup"]).setup, true);
});

test("usage：包含 --setup 与首次配置说明", () => {
  const text = usage("0.1.0");
  assert.match(text, /--setup/);
  assert.match(text, /config\.json/);
  assert.match(text, /首次配置/);
  assert.match(text, /config\.json > 内置默认值/);
});

test("findMissingConfig：mock 不缺；env/stored 可以补足", () => {
  const plain = parseArgs([]);
  assert.deepEqual(findMissingConfig(plain, {}, {}), {
    model: true,
    apiKey: true,
  });
  assert.deepEqual(findMissingConfig(parseArgs(["--mock"]), {}, {}), {
    model: false,
    apiKey: false,
  });
  assert.deepEqual(
    findMissingConfig(plain, { MEWCODE_MODEL: "deepseek-chat" }, {}),
    { model: false, apiKey: true },
  );
  assert.deepEqual(
    findMissingConfig(plain, {}, { model: "m", apiKey: "sk-stored" }),
    { model: false, apiKey: false },
  );
});

test("resolveConfig：用户级 config.json 兜底，env/CLI 依次覆盖", () => {
  const cwd = makeTempDir();
  try {
    const stored = {
      baseUrl: "https://stored.example.com",
      model: "stored-model",
      apiKey: "sk-stored",
    };

    const fromStored = resolveConfig(parseArgs(["--print"]), {}, cwd, stored);
    assert.equal(fromStored.model, "stored-model");
    assert.equal(fromStored.baseUrl, "https://stored.example.com");
    assert.equal(fromStored.apiKey, "sk-stored");

    const fromEnv = resolveConfig(
      parseArgs(["--print"]),
      { MEWCODE_MODEL: "env-model", MEWCODE_API_KEY: "sk-env" },
      cwd,
      stored,
    );
    assert.equal(fromEnv.model, "env-model");
    assert.equal(fromEnv.apiKey, "sk-env");
    assert.equal(fromEnv.baseUrl, "https://stored.example.com");

    const fromCli = resolveConfig(
      parseArgs([
        "--print",
        "--model",
        "cli-model",
        "--base-url",
        "https://cli.example.com",
      ]),
      { MEWCODE_MODEL: "env-model", MEWCODE_API_KEY: "sk-env" },
      cwd,
      stored,
    );
    assert.equal(fromCli.model, "cli-model");
    assert.equal(fromCli.baseUrl, "https://cli.example.com");
    assert.equal(fromCli.apiKey, "sk-env");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：交互式缺配置 → 自动弹向导，保存结果用于启动 TUI", async () => {
  const cwd = makeTempDir();
  const home = path.join(cwd, "home");
  try {
    const requests: SetupWizardRequest[] = [];
    const tui: StartTuiOptions[] = [];
    const result = await runMain([], {
      cwd,
      env: { MEWCODE_HOME: home } as NodeJS.ProcessEnv,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      runSetupWizard: async (request) => {
        requests.push(request);
        return {
          kind: "saved",
          path: path.join(home, "config.json"),
          config: {
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-chat",
            apiKey: "sk-from-wizard",
          },
        };
      },
      startTui: async (options) => {
        tui.push(options);
      },
    });

    assert.equal(result.code, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.initial, {
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_SUGGESTED_MODEL,
      hasApiKey: false,
    });
    assert.equal(tui.length, 1);
    assert.equal(tui[0]?.config.model, "deepseek-chat");
    assert.equal(tui[0]?.config.apiKey, "sk-from-wizard");
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--setup 保存后打印路径并退出，不启动 TUI", async () => {
  const cwd = makeTempDir();
  const home = path.join(cwd, "home");
  try {
    const tui: StartTuiOptions[] = [];
    const configPath = path.join(home, "config.json");
    const result = await runMain(["--setup"], {
      cwd,
      env: { MEWCODE_HOME: home } as NodeJS.ProcessEnv,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      runSetupWizard: async () => ({
        kind: "saved",
        path: configPath,
        config: { model: "deepseek-chat", apiKey: "sk-setup" },
      }),
      startTui: async (options) => {
        tui.push(options);
      },
    });

    assert.equal(result.code, 0);
    assert.match(result.out, /配置已保存/);
    assert.ok(result.out.includes(configPath));
    assert.equal(tui.length, 0);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：向导取消 → 退出码 2 且提示可操作", async () => {
  const cwd = makeTempDir();
  const home = path.join(cwd, "home");
  try {
    const result = await runMain([], {
      cwd,
      env: { MEWCODE_HOME: home } as NodeJS.ProcessEnv,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      runSetupWizard: async () => ({ kind: "cancelled" }),
    });
    assert.equal(result.code, 2);
    assert.match(result.err, /取消/);
    assert.match(result.err, /--setup/);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：--setup 在非交互终端直接报错", async () => {
  const cwd = makeTempDir();
  const home = path.join(cwd, "home");
  try {
    const result = await runMain(["--setup"], {
      cwd,
      env: { MEWCODE_HOME: home } as NodeJS.ProcessEnv,
      stdinIsTTY: false,
      stdoutIsTTY: false,
    });
    assert.equal(result.code, 2);
    assert.match(result.err, /交互式终端/);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：非 TTY 缺配置不弹向导，报错里给出 --setup", async () => {
  const cwd = makeTempDir();
  try {
    const result = await runMain(["--print"], { cwd, env: {} });
    assert.equal(result.code, 2);
    assert.match(result.err, /--setup/);
    assert.match(result.err, /缺少(API key|模型名)/);
  } finally {
    removeTempDir(cwd);
  }
});

test("main：用户级 config.json 损坏只警告，有 env 配置时仍能启动 TUI", async () => {
  const cwd = makeTempDir();
  const home = path.join(cwd, "home");
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, "config.json"), "{ broken", "utf8");
    const tui: StartTuiOptions[] = [];
    const result = await runMain([], {
      cwd,
      env: {
        MEWCODE_HOME: home,
        MEWCODE_MODEL: "deepseek-chat",
        MEWCODE_API_KEY: "sk-env",
      } as NodeJS.ProcessEnv,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      runSetupWizard: async () => {
        throw new Error("损坏文件且有 env 配置时不应弹向导");
      },
      startTui: async (options) => {
        tui.push(options);
      },
    });
    assert.equal(result.code, 0);
    assert.match(result.err, /用户配置文件损坏/);
    assert.match(result.err, /--setup/);
    assert.equal(tui.length, 1);
    // 损坏文件不被误用；配置来自环境变量。
    assert.equal(tui[0]?.config.model, "deepseek-chat");
    assert.equal(resolveUserConfigPath({ MEWCODE_HOME: home } as NodeJS.ProcessEnv),
      path.join(home, "config.json"));
  } finally {
    removeTempDir(cwd);
  }
});
