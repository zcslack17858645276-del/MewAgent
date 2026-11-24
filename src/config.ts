// MewAgent 配置层（S0-3）：`.env` 加载、CLI 参数解析、默认值与校验。
//
// 边界（方案 §3.1）：
// - 本文件不打印任何内容、不读 stdin、不 import Ink；发现的用户错误统一抛 `CliError`。
// - 优先级：CLI 参数 > 环境变量（`.env` 或 shell）> 用户级 config.json > 默认值。
// - 不新增依赖：`.env` 优先用 Node 内置 `process.loadEnvFile`（Node >= 22），
//   老版本 Node（< 20.12）缺少该 API 时退回本文件内的最小解析器（行为对齐，仍不新增依赖）。
// - key 只从环境变量/`.env` 读取，绝不通过 CLI 参数传入，也不出现在任何输出里。

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

/** OpenAI 兼容接口的默认根地址（`.env.example` 会覆盖它）。 */
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/** `--mock` 且未配置模型名时的占位模型名，避免下载/调用任何真实模型。 */
export const DEFAULT_MOCK_MODEL = "mock";

/**
 * 用法/配置类错误的统一类型：入口捕获后打印 message 并以 `exitCode` 退出。
 * 约定：message 里必须包含“下一步怎么做”，不要包含任何密钥原文。
 */
export class CliError extends Error {
  readonly exitCode = 2;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliError";
  }
}

/** `--help` / `--version` 之外的 CLI 参数解析结果（纯数据，不碰 IO）。 */
export interface CliOptions {
  help: boolean;
  version: boolean;
  /** headless：不启动 TUI，跑一轮后输出；prompt 取自位置参数或 stdin。 */
  print: boolean;
  /** 离线 mock 模型：不联网、不需要 API key。 */
  mock: boolean;
  /** 开始新会话（S3 会话层使用，S0-3 只解析和透传）。 */
  newSession: boolean;
  /** 强制运行首次配置向导（TUI 之外的独立小向导；非交互终端会报错）。 */
  setup: boolean;
  workspace?: string;
  model?: string;
  baseUrl?: string;
  /** 位置参数拼成的 prompt 文本；没有位置参数时为空串。 */
  prompt: string;
}

/** 校验完成、可以直接交给后续层（LLM / Agent Loop / TUI）的配置。 */
export interface AppConfig {
  /** 绝对路径。 */
  workspace: string;
  model: string;
  /** 已去掉结尾斜杠的根地址。 */
  baseUrl: string;
  apiKey: string;
  mock: boolean;
  newSession: boolean;
  print: boolean;
  prompt: string;
}

type ValueKey = "model" | "baseUrl" | "workspace";

const VALUE_FLAGS: Readonly<Record<string, ValueKey>> = {
  "--model": "model",
  "--base-url": "baseUrl",
  "--workspace": "workspace",
};

function unknownFlagError(token: string): CliError {
  return new CliError(
    `未知参数：${token}\n下一步：运行 npm run dev -- --help 查看可用参数。`,
  );
}

function missingValueError(flag: string): CliError {
  return new CliError(
    `参数 ${flag} 缺少值。\n下一步：例如 npm run dev -- ${flag} <值>；或运行 npm run dev -- --help 查看用法。`,
  );
}

/** 解析 CLI 参数。纯函数：不读 `process.env`、不碰文件系统；出错抛 `CliError`。 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
    print: false,
    mock: false,
    newSession: false,
    setup: false,
    prompt: "",
  };
  const positionals: string[] = [];
  let optionsEnded = false;
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }
    index += 1;

    if (optionsEnded) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      options.version = true;
      continue;
    }
    if (token === "--new") {
      options.newSession = true;
      continue;
    }
    if (token === "--mock") {
      options.mock = true;
      continue;
    }
    if (token === "--print") {
      options.print = true;
      continue;
    }
    if (token === "--setup") {
      options.setup = true;
      continue;
    }

    // `--flag=value` 形式。
    if (token.startsWith("--")) {
      const equalsIndex = token.indexOf("=");
      if (equalsIndex > 2) {
        const flag = token.slice(0, equalsIndex);
        const key = VALUE_FLAGS[flag];
        if (key === undefined) {
          throw unknownFlagError(token);
        }
        const value = token.slice(equalsIndex + 1);
        if (value === "") {
          throw missingValueError(flag);
        }
        options[key] = value;
        continue;
      }
    }

    // `--flag value` 形式。
    const valueKey = VALUE_FLAGS[token];
    if (valueKey !== undefined) {
      const value = argv[index];
      if (value === undefined || value === "--" || value.startsWith("--")) {
        throw missingValueError(token);
      }
      options[valueKey] = value;
      index += 1;
      continue;
    }

    if (token.startsWith("-") && token !== "-") {
      throw unknownFlagError(token);
    }
    positionals.push(token);
  }

  options.prompt = positionals.join(" ");
  return options;
}

/** `.env` 加载器：默认优先 Node 内置实现，老版本 Node 退回内置兜底解析器。 */
export type EnvFileLoader = (envPath: string) => void;

/**
 * 加载 `.env`（已存在的环境变量优先，不会被文件覆盖）。
 * 文件不存在时静默跳过；文件存在但格式非法时转成可操作的 `CliError`。
 * `loader` 仅用于测试注入；正常运行由 `resolveEnvFileLoader()` 选择实现。
 */
export function loadDotEnv(
  envPath: string,
  loader: EnvFileLoader = resolveEnvFileLoader(),
): void {
  try {
    loader(envPath);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `读取 .env 失败：${envPath}\n原因：${reason}\n下一步：检查文件是否为每行 KEY=VALUE 的纯文本；或先改名该文件排查。`,
      { cause: error },
    );
  }
}

/**
 * 选择 `.env` 加载器：Node >= 20.12 有 `process.loadEnvFile`，直接用；
 * 更老的 Node（如 18.x）没有该 API，退回本文件内实现，避免整个 CLI 起不来。
 */
function resolveEnvFileLoader(): EnvFileLoader {
  const builtin = (process as { loadEnvFile?: (envPath: string) => void })
    .loadEnvFile;
  if (typeof builtin === "function") {
    return (envPath) => builtin(envPath);
  }
  return loadDotEnvFallback;
}

/**
 * 老版本 Node 的 `.env` 兜底解析：逐行读 KEY=VALUE 写入 `process.env`。
 * 对齐内置实现的语义——已存在的环境变量优先；忽略空行与 `#` 注释；
 * 支持 `export ` 前缀与成对的单/双引号（值内不做转义处理，避免误伤 Windows 路径）。
 */
export function loadDotEnvFallback(envPath: string): void {
  // 文件不存在时让 ENOENT 冒泡，由 loadDotEnv 统一静默跳过。
  applyEnvContent(readFileSync(envPath, "utf8"), envPath);
}

/** 解析并应用 `.env` 文本；格式非法时抛带行号的 `CliError`（不打印值，避免泄露密钥）。 */
export function applyEnvContent(content: string, source = ".env"): void {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const body = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separator = body.indexOf("=");
    if (separator <= 0) {
      throw new CliError(
        `读取 .env 失败：${source}\n原因：第 ${index + 1} 行不是 KEY=VALUE 格式。\n下一步：改成每行一个 KEY=VALUE；值里含空格时用双引号包起来。`,
      );
    }
    const key = body.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new CliError(
        `读取 .env 失败：${source}\n原因：第 ${index + 1} 行的变量名不合法。\n下一步：变量名只能用字母、数字、下划线，且不能以数字开头。`,
      );
    }
    const value = stripQuotes(body.slice(separator + 1).trim());
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 用户级配置目录名（位于用户主目录下，默认 `~/.mewcode`）。 */
export const USER_CONFIG_DIR_NAME = ".mewcode";

/**
 * 解析用户级配置目录：`MEWCODE_HOME` 优先（可指向任意目录），否则 `~/.mewcode`。
 * 用于跨目录全局使用（`npm link` 安装后在任何目录启动）时共享 key/模型配置。
 */
export function resolveUserConfigDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = firstNonEmpty(env.MEWCODE_HOME);
  if (override !== undefined) {
    return path.resolve(override);
  }
  return path.join(homedir(), USER_CONFIG_DIR_NAME);
}

/** 用户级 `.env` 路径：`<用户配置目录>/.env`（默认 `~/.mewcode/.env`）。 */
export function resolveUserEnvPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveUserConfigDir(env), ".env");
}

/**
 * 按优先级返回要加载的 `.env` 路径：先用户级、后项目根目录（cwd）。
 * 加载器「已存在的环境变量优先」，因此最终优先级是：
 * shell 环境变量 > 项目 `.env` > 用户级 `.env` > 内置默认值。
 */
export function resolveEnvFilePaths(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const userEnv = resolveUserEnvPath(env);
  const localEnv = path.join(cwd, ".env");
  if (path.resolve(userEnv) === path.resolve(localEnv)) {
    return [localEnv];
  }
  return [userEnv, localEnv];
}

/** 用户级结构化配置（首次启动向导写入 `<用户配置目录>/config.json`）。 */
export interface UserConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

/** 用户级结构化配置文件名（与 `.env` 同目录，默认 `~/.mewcode/config.json`）。 */
export const USER_CONFIG_FILE_NAME = "config.json";

/** 首次启动向导建议预填的模型名（仅作输入框默认值，不参与校验）。 */
export const DEFAULT_SUGGESTED_MODEL = "deepseek-chat";

/** 用户级 `config.json` 的路径。 */
export function resolveUserConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveUserConfigDir(env), USER_CONFIG_FILE_NAME);
}

/** `readUserConfig` 的三态结果：缺失 / 已加载 / 损坏（损坏不阻断启动，由调用方决定提示）。 */
export type UserConfigReadResult =
  | { kind: "missing"; path: string }
  | { kind: "loaded"; path: string; config: UserConfig }
  | { kind: "corrupt"; path: string; reason: string };

/** 读取用户级 `config.json`；缺失返回 missing，JSON/结构非法返回 corrupt。 */
export function readUserConfig(
  env: NodeJS.ProcessEnv = process.env,
): UserConfigReadResult {
  const filePath = resolveUserConfigPath(env);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return { kind: "missing", path: filePath };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "corrupt", path: filePath, reason: `读不了文件：${reason}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: "corrupt",
      path: filePath,
      reason: `不是合法 JSON（${reason}）`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      kind: "corrupt",
      path: filePath,
      reason: "顶层必须是 JSON 对象",
    };
  }

  const config: UserConfig = {};
  for (const key of ["baseUrl", "model", "apiKey"] as const) {
    const value = parsed[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        config[key] = trimmed;
      }
    }
  }
  return { kind: "loaded", path: filePath, config };
}

/**
 * 合并写入用户级 `config.json`：已有字段会保留，`undefined`/空串视为“保留旧值”。
 * 目录不存在会自动创建；文件权限尽量收紧到 0600（Windows 上权限位语义有限）。
 */
export function saveUserConfig(
  env: NodeJS.ProcessEnv,
  config: UserConfig,
): { ok: true; path: string } | { ok: false; reason: string } {
  const filePath = resolveUserConfigPath(env);
  const existing = readUserConfig(env);
  const merged: UserConfig = {
    ...(existing.kind === "loaded" ? existing.config : {}),
  };
  for (const key of ["baseUrl", "model", "apiKey"] as const) {
    const value = config[key];
    if (value !== undefined && value.trim() !== "") {
      merged[key] = value.trim();
    }
  }

  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows 上 chmod 语义有限，失败不影响可用性。
    }
    return { ok: true, path: filePath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

/** 启动时缺哪些配置（用于决定是否弹首次配置向导）。 */
export interface MissingConfig {
  model: boolean;
  apiKey: boolean;
}

/** 计算还缺哪些配置：`--mock` 模式什么都不缺。 */
export function findMissingConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
  stored: UserConfig = {},
): MissingConfig {
  if (options.mock) {
    return { model: false, apiKey: false };
  }
  const model = firstNonEmpty(options.model, env.MEWCODE_MODEL, stored.model);
  const apiKey = firstNonEmpty(env.MEWCODE_API_KEY, stored.apiKey);
  return { model: model === undefined, apiKey: apiKey === undefined };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return undefined;
}

function normalizeBaseUrl(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_BASE_URL;
  }
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed === "" ? DEFAULT_BASE_URL : trimmed;
}

function assertWorkspace(workspace: string): void {
  let isDirectory = false;
  try {
    isDirectory = statSync(workspace).isDirectory();
  } catch {
    throw new CliError(
      `工作区不存在或不可访问：${workspace}\n下一步：检查 --workspace 指向的目录是否存在（相对路径按当前目录解析）。`,
    );
  }
  if (!isDirectory) {
    throw new CliError(
      `工作区不是目录：${workspace}\n下一步：--workspace 需要指向一个目录。`,
    );
  }
}

/**
 * 合并 CLI 参数、环境变量与用户级 `config.json`，得到后续层可直接使用的配置。
 * 优先级：CLI 参数 > 环境变量（shell / `.env`）> 用户级 `config.json` > 默认值。
 * 缺 API key / 缺模型名时抛 `CliError`，message 含下一步操作且不含密钥原文。
 */
export function resolveConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
  stored: UserConfig = {},
): AppConfig {
  const workspace = path.resolve(cwd, options.workspace ?? ".");
  assertWorkspace(workspace);

  const model = firstNonEmpty(options.model, env.MEWCODE_MODEL, stored.model);
  const baseUrl = normalizeBaseUrl(
    firstNonEmpty(options.baseUrl, env.MEWCODE_BASE_URL, stored.baseUrl),
  );
  const apiKey = firstNonEmpty(env.MEWCODE_API_KEY, stored.apiKey);

  if (!options.mock && model === undefined) {
    throw new CliError(
      "缺少模型名。\n下一步：运行 mewagent --setup 用向导配置（推荐），或在项目根目录 .env（模板见 .env.example）/ 用户级配置 %USERPROFILE%\\.mewcode\\.env（~/.mewcode/.env）里设置 MEWCODE_MODEL（例如 deepseek-chat），或加 --model <名字>；只想离线体验可以加 --mock。",
    );
  }
  if (!options.mock && apiKey === undefined) {
    throw new CliError(
      "缺少 API key。\n下一步：运行 mewagent --setup 用向导配置（推荐），或在项目根目录 .env（模板见 .env.example）/ 用户级配置 %USERPROFILE%\\.mewcode\\.env（~/.mewcode/.env）里设置 MEWCODE_API_KEY（或设置同名环境变量）；只想离线体验可以加 --mock。",
    );
  }

  return {
    workspace,
    model: model ?? DEFAULT_MOCK_MODEL,
    baseUrl,
    apiKey: apiKey ?? "",
    mock: options.mock,
    newSession: options.newSession,
    print: options.print,
    prompt: options.prompt,
  };
}

/** 从本文件的上一级读取 `package.json`：`src/` 与 `dist/` 都能解析到仓库根。 */
const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取 `package.json` 的 version（`--version` 与 help 标题共用）。 */
export function readPackageVersion(): string {
  let raw: string;
  try {
    raw = readFileSync(PACKAGE_JSON_URL, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `无法读取版本号：找不到或读不了 package.json。\n原因：${reason}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `无法读取版本号：package.json 不是合法 JSON。\n原因：${reason}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new CliError("无法读取版本号：package.json 顶层不是对象。");
  }
  const version = parsed["version"];
  if (typeof version !== "string" || version.trim() === "") {
    throw new CliError("无法读取版本号：package.json 缺少 version 字段。");
  }
  return version;
}

/** `--help` 的完整用法文本。 */
export function usage(version: string): string {
  return [
    `mewagent ${version} — 终端里的 AI 编程助手（v0.1）`,
    "",
    "用法：",
    "  mewagent [选项] [prompt...]",
    "  npm run dev -- [选项] [prompt...]",
    "",
    "选项：",
    "  -h, --help             显示本帮助并退出",
    "  -v, --version          显示版本号并退出",
    "      --model <name>     模型名（覆盖环境变量 MEWCODE_MODEL）",
    "      --base-url <url>   OpenAI 兼容 API 根地址（覆盖 MEWCODE_BASE_URL）",
    "      --workspace <dir>  工作区目录（默认当前目录，相对路径按当前目录解析）",
    "      --new              开始新会话（忽略历史会话）",
    "      --setup            运行首次配置向导（base-url / 模型 / API key，保存到用户级 config.json）",
    "      --mock             使用离线 mock 模型：不联网、不需要 API key",
    '      --print            headless 模式：不启动 TUI，跑一轮后输出（prompt 取自位置参数或 stdin）',
    "  --                     其后的内容都当作 prompt 文本",
    "",
    "环境变量（也可写在项目根目录 .env 或用户级 .env 里；两处都会加载）：",
    "  优先级：shell 环境变量 > 项目根目录 .env > 用户级 .env > 用户级 config.json > 内置默认值。",
    "  用户级 .env 默认是 ~/.mewcode/.env（Windows：%USERPROFILE%\\.mewcode\\.env），",
    "  全局安装后在任何目录都能用同一份 key/模型；目录可用 MEWCODE_HOME 覆盖。",
    "  交互式首次启动（或运行 --setup）会弹出配置向导，并把结果写入同一目录的 config.json。",
    "  MEWCODE_API_KEY        API key（必需，--mock 时不需要）",
    `  MEWCODE_BASE_URL       API 根地址（默认 ${DEFAULT_BASE_URL}）`,
    "  MEWCODE_MODEL          模型名（必需，--mock 时不需要）",
    "  MEWCODE_HOME           用户级配置目录（默认 ~/.mewcode，里面放 .env）",
    "  MEWCODE_DEBUG          设为 1 时把请求体打到 stderr（不含 key，可安全粘贴）",
    "  MEWCODE_MOCK_DELAY_MS  mock 离线模式的慢速流式块间延迟（毫秒，默认 0）",
    "  MEWCODE_CONTEXT_TOKENS 上下文预算（token，默认 128000；调小可观察压缩行为）",
    "  MEWCODE_SHELL          覆盖 Windows 下的 shell 选择（默认 Git Bash，其次 cmd.exe）",
    "",
    "示例：",
    "  npm run dev -- --help",
    '  npm run dev -- --mock --print "你好"',
    '  npm run dev -- --print "你好"          # 真实 API：无 TTY 也能跑一轮',
    "  npm run dev -- --workspace D:\\work\\my-project",
    '  mewagent --setup                        # 重新运行首次配置向导',
    '  mewagent --print "你好"                 # npm link 全局安装后任意目录可用',
    "",
  ].join("\n");
}
