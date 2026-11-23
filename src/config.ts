// MewAgent 配置层（S0-3）：`.env` 加载、CLI 参数解析、默认值与校验。
//
// 边界（方案 §3.1）：
// - 本文件不打印任何内容、不读 stdin、不 import Ink；发现的用户错误统一抛 `CliError`。
// - 优先级：CLI 参数 > 环境变量（`.env` 或 shell）> 默认值。
// - 不新增依赖：`.env` 用 Node 内置 `process.loadEnvFile`（Node >= 22）。
// - key 只从环境变量/`.env` 读取，绝不通过 CLI 参数传入，也不出现在任何输出里。

import { readFileSync, statSync } from "node:fs";
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

/**
 * 加载 `.env`（Node 内置实现：已存在的环境变量优先，不会被文件覆盖）。
 * 文件不存在时静默跳过；文件存在但格式非法时转成可操作的 `CliError`。
 */
export function loadDotEnv(envPath: string): void {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
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
 * 合并 CLI 参数与环境变量，得到后续层可直接使用的配置。
 * 缺 API key / 缺模型名时抛 `CliError`，message 含下一步操作且不含密钥原文。
 */
export function resolveConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
): AppConfig {
  const workspace = path.resolve(cwd, options.workspace ?? ".");
  assertWorkspace(workspace);

  const model = firstNonEmpty(options.model, env.MEWCODE_MODEL);
  const baseUrl = normalizeBaseUrl(
    firstNonEmpty(options.baseUrl, env.MEWCODE_BASE_URL),
  );
  const apiKey = firstNonEmpty(env.MEWCODE_API_KEY);

  if (!options.mock && model === undefined) {
    throw new CliError(
      "缺少模型名。\n下一步：在 .env 里设置 MEWCODE_MODEL（例如 deepseek-chat），或加 --model <名字>；只想离线体验可以加 --mock。",
    );
  }
  if (!options.mock && apiKey === undefined) {
    throw new CliError(
      "缺少 API key。\n下一步：复制 .env.example 为 .env 并填写 MEWCODE_API_KEY（或设置同名环境变量）；只想离线体验可以加 --mock。",
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
    `mewagent ${version} — 终端里的 AI 编程助手（S0-3 骨架）`,
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
    "      --mock             使用离线 mock 模型：不联网、不需要 API key",
    '      --print            headless 模式：不启动 TUI，跑一轮后输出（prompt 取自位置参数或 stdin）',
    "  --                     其后的内容都当作 prompt 文本",
    "",
    "环境变量（也可写在项目根目录的 .env 里，.env 已加入 .gitignore）：",
    "  MEWCODE_API_KEY        API key（必需，--mock 时不需要）",
    `  MEWCODE_BASE_URL       API 根地址（默认 ${DEFAULT_BASE_URL}）`,
    "  MEWCODE_MODEL          模型名（必需，--mock 时不需要）",
    "  MEWCODE_DEBUG          设为 1 时把请求体打到 stderr（不含 key，可安全粘贴）",
    "  MEWCODE_MOCK_DELAY_MS  mock 离线模式的慢速流式块间延迟（毫秒，默认 0）",
    "  MEWCODE_SHELL          覆盖 Windows 下的 shell 选择（S2 使用）",
    "",
    "示例：",
    "  npm run dev -- --help",
    '  npm run dev -- --mock --print "你好"',
    '  npm run dev -- --print "你好"          # 真实 API：无 TTY 也能跑一轮',
    "  npm run dev -- --workspace D:\\work\\my-project",
    "",
  ].join("\n");
}
