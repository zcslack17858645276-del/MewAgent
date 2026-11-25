# MewAgent

> 终端里的个人版 CLI Coding Agent：和模型对话，让它读你的仓库、改文件、跑命令——每条写操作都先问过你。

MewAgent 是一个类 Claude Code 的命令行编程助手，用 TypeScript + [Ink](https://github.com/vadimdemedes/ink) 写成。v0.1 已经能完成完整的「对话 → 调工具 → 看结果 → 继续对话」闭环，并带权限审批、会话恢复、上下文压缩和红绿 diff 展示。

- 运行环境：Windows Terminal + Node.js ≥ 22（macOS / Linux 也可用，CI 在 Ubuntu 上跑）
- 模型：任意 OpenAI 兼容的 `/chat/completions`（DeepSeek、OpenAI、GLM、MiniMax、OpenRouter 等）
- 状态：v0.1.0，个人自用项目，尚未发布到 npm

**导航**：特性 · 快速开始 · 配置 · 命令与参数 · 架构 · 工具 · 加工具教程 · 权限与安全 · 测试 · 已知限制

---

## 特性

- **对话式编程**：流式输出，边生成边显示；Esc 中断当前请求，Ctrl+C 退出。
- **6 个内置工具**：`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`bash`，覆盖读、写、找、搜、跑。
- **写操作先审批**：交互模式下每次写文件/执行命令都弹 `y / a / n`；危险命令（如 `rm -rf /`）直接硬拦，不询问。
- **edit 显示红绿 diff**：`edit_file` 成功后显示带行号的 unified diff（删除红、新增绿），不只给一句“已替换”。
- **会话可恢复**：每轮自动存 `.mewcode/session.json`，重开继续；`--new` 开新会话。
- **上下文按轮压缩**：超出预算时整轮丢弃旧对话、保留 system 与最新轮，避免 50 轮后爆上下文。
- **统一的错误说明**：网络、HTTP、工具、权限、超步数错误都带“发生了什么 + 下一步怎么办”。
- **两种入口**：交互 TUI，或 `--print` headless（便于脚本化/CI）；`--mock` 可完全离线跑通。
- **工作区边界**：所有文件工具限制在 `--workspace` 内，拒绝 `../`、越界绝对路径、`%VAR%`、`~`、盘符相对路径与 junction 逃逸。

## 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | **≥ 22（推荐）**；开发机实测 v26.7.0。低于 20.12 的 Node 缺少 `process.loadEnvFile`，程序会自动退回内置 `.env` 解析（已兜底，`--mock` 可跑），但未做完整兼容验证，建议升级到 Node 22 LTS |
| npm | 随 Node 提供 |
| 终端 | **Windows 建议 Windows Terminal**（cmd / 旧版 PowerShell 窗口的 TUI 观感与中文输入体验较差） |
| 真实 API | 任意 OpenAI 兼容的 `/chat/completions` 端点与 API key |
| 网络 | 国内环境：npm 可用 npmmirror 镜像；访问 GitHub 通常需要代理 |
| git | 仅"从 GitHub 一行安装"需要（脚本用它拉取源码；无 git 时脚本会退回下载 zip/tar.gz）；用源码开发时本来就需要 |

> 中文输入法提示：在 Windows Terminal + 微软拼音下可正常输入中文（候选框位置略有偏移，可接受）。详见 `spikes/RESULT.md`。

## 一键安装（不需要手动 clone）

如果你只是想用，不打算改代码，用一行安装脚本（会检查 Node ≥ 22、下载源码、安装依赖、构建并全局安装）：

**Windows（PowerShell）**

```powershell
irm https://raw.githubusercontent.com/zcslack17858645276-del/MewAgent/main/scripts/install.ps1 | iex
```

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/zcslack17858645276-del/MewAgent/main/scripts/install.sh | bash
```

脚本最后会打印 `mewagent --version` 供确认。装好后任意目录：

```bash
mewagent --version        # 0.1.0
mewagent                  # 首次运行弹出配置向导：base-url / 模型 / API key
mewagent --mock --print "你好"   # 没有 API key 也能先验证安装
```

- **升级**：重新执行同一条安装命令（会重新拉取 main 并构建）；卸载：`npm uninstall -g mewagent`。
- **固定版本**：`MEWAGENT_REF=v0.1.0`（PowerShell 用 `$env:MEWAGENT_REF='v0.1.0'`，bash 用 `MEWAGENT_REF=v0.1.0`）。
- **备选（直接用 npm 装 GitHub 仓库）**：
  ```bash
  npm install -g --allow-git=all github:zcslack17858645276-del/MewAgent
  ```
  npm 12+ 默认禁用 git 依赖，所以需要 `--allow-git=all`；npm 11 及更早版本可省略该参数。它同样会触发 `prepare` 自动构建。
- 下面的 1~7 节是"从源码开发/调试"的方式；只想使用的话到本节为止就够。

## 快速开始

### 1. 离线跑通（不需要 API key，30 秒）

```bash
git clone https://github.com/zcslack17858645276-del/MewAgent.git
cd MewAgent
npm install
npm run dev -- --mock --print "你好"
```

输出示例：

```text
mewagent 0.1.0 · headless（mock 离线两轮）
workspace: D:\work\my-project
model: mock
base-url: https://api.deepseek.com
mock: true
prompt: 你好
--- 第 1 轮：模型 → 工具调用 ---
tool_call: read_file {"path":"README.md"}

--- 第 2 轮：模型 → 最终文本 ---
你好！我是 MewAgent 的离线 mock。两轮链路已跑通：第一轮我请求调用 read_file，
第二轮收到工具结果后给出这段总结。真实工具执行在 S2 接入。
finish: stop
```

### 2. 交互界面（离线 mock 也能玩）

```bash
npm run dev -- --mock
```

示意（不是真实截图）：

```text
┌─ MewAgent 0.1.0 ────────────────────────────────────────────┐
│ > 帮我看看 src/index.ts 的入口逻辑                          │
│                                                             │
│ ⚙ 工具运行中 read_file                                     │
│ ✅ read_file (12ms)                                        │
│ src/index.ts 的入口按顺序做三件事：解析参数、加载 .env、…    │
│                                                             │
│ > █                                                         │
└─────────────────────────────────────────────────────────────┘
```

- 输入中文/英文均可；输入框支持多行（`Shift+Enter` 换行，`Enter` 发送）。
- 写文件/执行命令时会弹出审批：`y` 允许一次，`a` 允许同类操作本次会话，`n` 拒绝。
- `Esc` 中断正在进行的请求（或清空提示），`Ctrl+C` 退出。

### 3. 接真实模型

```bash
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env，至少填 MEWCODE_API_KEY 与 MEWCODE_MODEL
npm run dev
```

headless 跑一轮（适合脚本）：

```bash
npm run dev -- --print "解释 src/index.ts 的入口逻辑"
```

### 4. 指定工作区

所有文件工具只作用于工作区目录：

```bash
npm run dev -- --workspace D:\work\my-project
```

### 5. 构建后运行

```bash
npm run build
npm start -- --mock --print "你好"
npm start                      # 交互 TUI（dist 版本）
```

> Windows PowerShell 5.1 的 `>` 重定向会写成 UTF-16LE；需要保存输出时建议用 `cmd /c "... > out.txt"`，或直接看终端。

### 6. 全局命令（`npm link` / `npx`）

本仓库已在 `package.json` 配置 `bin`（`mewagent` → `dist/index.js`）。在仓库根目录执行：

```bash
npm link              # 构建 dist 并把 mewagent 链接到全局（Windows 默认 %APPDATA%\npm，无需管理员）

mewagent --help       # 任意目录可用
mewagent --mock --print "你好"
```

不想装全局时，可以直接让 npm 从本目录打包运行（`prepare` 会在安装/打包前自动构建）：

```bash
npx . --mock --print "你好"   # 从仓库根目录执行
npx .                          # 交互 TUI（--mock 离线）
```

卸载全局链接：

```bash
npm unlink -g mewagent
```

> 如果 `mewagent` 提示找不到命令，确认 `%APPDATA%\npm`（或 `npm prefix -g` 的输出）在 `PATH` 中；重新打开终端即可刷新。

### 7. 3 分钟演示

跟着 [`docs/demo.md`](docs/demo.md) 走一遍，可以在 3 分钟内看到：流式对话与中断 → 多工具读项目回答架构问题 → 改真实文件（红绿 diff）+ 跑测试 → 审批、危险命令拦截与会话恢复。没有 API key 时可全程加 `--mock` 离线演示。

## 配置

配置优先级：**命令行参数 > 环境变量 > 项目 `.env` > 用户级 `.env` > 用户级 `config.json` > 内置默认值**。两处 `.env` 都会被加载（加载时不会覆盖已存在的环境变量），`.env` 已在 `.gitignore` 中，别提交真实 key。

**首次启动向导**（推荐，尤其是 `npm link`/`npx` 全局安装后）：在交互式终端里第一次运行 `mewagent`（且当前没有可用配置）会自动弹出 3 步向导：

1. API 地址（默认 `https://api.deepseek.com`）
2. 模型名（例如 `deepseek-chat`）
3. API key（输入时不显示；已有 key 时可留空保留）

确认页可以按 Enter **先测试连接再保存**，或按 `s` 跳过测试直接保存。结果写入用户级 `config.json`（Windows `%USERPROFILE%\.mewcode\config.json`，`MEWCODE_HOME` 可改目录），之后在任何目录启动都会自动使用，不必手写 `.env`。想重新配置运行：

```bash
mewagent --setup
```

非交互终端（`--print`、CI）不会弹向导，仍可用环境变量 / `.env` 配置。

**项目级**（适合单个项目内使用）：

```bash
copy .env.example .env
```

**用户级 / 全局**（推荐给全局安装：配一次，任何目录都能用真实模型）：

- Windows：`%USERPROFILE%\.mewcode\.env`
- macOS / Linux：`~/.mewcode/.env`

文件格式与 `.env.example` 一致，至少写 `MEWCODE_API_KEY` 与 `MEWCODE_MODEL`。配置后可在任意目录直接运行（不必在仓库目录）：

```bash
mewagent --print "你好"
```

项目目录里的 `.env` 仍会覆盖用户级配置；想换用户级配置目录可设 `MEWCODE_HOME`（如 `MEWCODE_HOME=D:\my-config` → 读取 `D:\my-config\.env`）。

Windows PowerShell 创建示例：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.mewcode" | Out-Null
@"
MEWCODE_API_KEY=sk-你的密钥
MEWCODE_BASE_URL=https://api.deepseek.com
MEWCODE_MODEL=deepseek-flash
"@ | Set-Content -Encoding UTF8 "$env:USERPROFILE\.mewcode\.env"
```

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MEWCODE_API_KEY` | 真实 API 必填 | — | API key；`--mock` 时不需要 |
| `MEWCODE_BASE_URL` | 否 | `https://api.deepseek.com` | OpenAI 兼容根地址；OpenAI 官方需写 `https://api.openai.com/v1` |
| `MEWCODE_MODEL` | 真实 API 必填 | 无（mock 用内置 `mock` 模型） | 模型名；也可用 `--model` 覆盖 |
| `MEWCODE_DEBUG` | 否 | 空 | 设为 `1` 时把请求体打到 stderr（不含 key）；压缩时打印 `[压缩] 丢弃 N 轮，tokens X → Y` |
| `MEWCODE_MOCK_DELAY_MS` | 否 | `0` | mock 慢速流式块间延迟（毫秒），用于观察流式/中断 |
| `MEWCODE_CONTEXT_TOKENS` | 否 | `128000` | 上下文预算（token）× 0.7 为压缩阈值；调小（如 `300`）可观察压缩行为 |
| `MEWCODE_SHELL` | 否 | 自动 | 覆盖 `bash` 工具使用的 shell（Windows 默认 Git Bash，其次 `ComSpec`） |
| `MEWCODE_HOME` | 否 | `~/.mewcode` | 用户级配置目录；程序读取其中的 `.env`（全局安装后跨目录共用配置，见上） |

国内网络提示：安装依赖如遇 `registry.npmjs.org` 超时，可先设置代理（开发机使用 Clash mixed-port）：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
npm install
```

## 命令与参数

```text
mewagent [选项] [prompt...]
npm run dev -- [选项] [prompt...]
```

| 选项 | 说明 |
| --- | --- |
| `-h, --help` | 显示帮助并退出 |
| `-v, --version` | 显示版本号并退出 |
| `--model <name>` | 模型名（覆盖 `MEWCODE_MODEL`） |
| `--base-url <url>` | OpenAI 兼容 API 根地址（覆盖 `MEWCODE_BASE_URL`） |
| `--workspace <dir>` | 工作区目录（默认当前目录） |
| `--new` | 开始新会话（忽略历史会话文件） |
| `--mock` | 离线 mock 模型：不联网、不需要 API key |
| `--print` | headless 模式：不启动 TUI，跑一轮后输出（prompt 取自位置参数或 stdin） |
| `--setup` | 运行首次配置向导（base-url / 模型 / API key，保存到用户级 `config.json`）；需要交互式终端 |
| `--` | 其后的内容都当作 prompt 文本 |

示例：

```bash
npm run dev -- --help
npm run dev -- --mock --print "你好"
npm run dev -- --print "总结这个仓库"            # 真实 API，无 TTY 也能跑
npm run dev -- --workspace D:\work\my-project
npm run dev -- --print -- --help                # prompt 就是 "--help" 这两个字符
mewagent --setup                                 # 重新配置 API 地址/模型/key
```

> `--` 是 POSIX 的“选项结束”标记，由**紧挨着它的程序**消费。经 `npm run dev` 时 shell 先把参数传给 npm，npm 用第一个 `--` 传给脚本；如果 prompt 本身要以 `-` 开头，需要再写一个 `--`（`-- -- -rf`）。原则：包装几层，就写几个 `--`。

## 架构

```text
┌────────────────────────────────────────────────────────────────────┐
│  src/index.ts（入口：解析参数 / 加载 .env / 分派 TUI 或 headless）  │
└───────────────┬────────────────────────────────────────────────────┘
                │
      ┌─────────┴──────────┐
      ▼                    ▼
┌──────────────┐    ┌──────────────────────┐
│ src/ui/*.tsx │    │ runRealHeadless      │
│ Ink TUI      │    │ （--print，流式 stdout）│
└──────┬───────┘    └──────────┬───────────┘
       │ AgentEvent（单一事件流）│
       ▼                        ▼
┌──────────────────────────────────────────┐
│ src/agent/loop.ts（Agent Loop，maxSteps=30）│
└──────┬──────────────────────┬────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐      ┌────────────────────────┐
│ LlmClient    │      │ ToolRegistry           │
│ openai.ts    │      │ 6 工具（fs/search/bash）│
│  + sse.ts    │      └──────────┬─────────────┘
└──────────────┘                 │ 写操作/命令
                                 ▼
                        ┌──────────────────┐
                        │ Gate 权限闸       │
                        │ safety/*.ts       │
                        └──────────────────┘

辅助模块：
  src/agent/messages.ts     消息 ↔ OpenAI 格式
  src/agent/prompt.ts       系统提示词
  src/session/store.ts      会话持久化（.mewcode/session.json）
  src/context/tokens.ts     上下文 token 估算
  src/context/compress.ts   按轮压缩
  src/errors.ts             错误 →「发生了什么 + 下一步」统一描述
  src/ui/diff-view.ts       edit diff 解析与渲染
```

数据流（一次对话）：

1. 用户输入 → `runAgent(messages, options)`；
2. Loop 把消息（必要时先压缩）发给 `LlmClient.chat()`，SSE 增量文本通过 `assistant_text` 事件推给 UI；
3. 模型返回 `tool_calls` → Loop 对每个调用先过 Gate（读工具自动放行，写工具弹审批），再交给 `ToolRegistry.run()`；
4. 工具结果作为 `tool` 消息回填，继续下一轮；工具失败/被拒也会回填，模型能看到原因；
5. 达到 `stop`、`max_steps` 或中断时发 `turn_end`；UI 更新历史并持久化会话。

### 目录结构

```text
MewAgent/
├── src/
│   ├── index.ts            入口：参数、.env、TUI/headless 分派
│   ├── config.ts           CLI 解析、默认值、usage
│   ├── types.ts            全部公共契约（Message/Tool/LlmClient/AgentEvent…）
│   ├── errors.ts           HTTP/网络/工具错误 →「发生了什么 + 下一步」
│   ├── agent/
│   │   ├── loop.ts         Agent Loop（工具调用循环、事件流）
│   │   ├── messages.ts     消息 ↔ OpenAI 请求格式
│   │   └── prompt.ts       系统提示词构建
│   ├── llm/
│   │   ├── openai.ts       OpenAI 兼容客户端（tool_calls 聚合、错误脱敏）
│   │   ├── sse.ts          SSE 流解析（手写）
│   │   └── mock.ts         离线 mock 模型（两轮剧本）
│   ├── tools/
│   │   ├── registry.ts     工具注册与执行（永不抛异常）
│   │   ├── index.ts        默认 6 工具组装
│   │   ├── paths.ts        工作区内路径解析与拒绝
│   │   ├── fs.ts           read_file / write_file / edit_file
│   │   ├── search.ts       glob / grep
│   │   ├── bash.ts         bash 命令执行（超时、截断）
│   │   └── diff.ts         行级 unified diff 生成
│   ├── safety/
│   │   ├── danger.ts       危险命令识别
│   │   └── permissions.ts  权限闸（白名单、审批、headless 只读）
│   ├── session/store.ts    会话持久化与恢复
│   ├── context/            token 估算 + 按轮压缩
│   └── ui/                 Ink TUI（App、输入框、历史、审批、diff 渲染）
├── tests/                  node:test 单元/集成测试（30 个文件，330 例）
├── docs/                   spec / tasks / testing / checklist
├── .github/workflows/ci.yml
├── HANDOFF.md              交接文档（阶段状态、决策、会话记录）
├── MewCode-TS实施方案.md    总体实施方案（S0~S4 拆解）
└── MewAgent-v0.1.0-开发复盘.md   v0.1.0 收尾复盘（规划/执行/设计/复现）
```

## 工具

| 工具 | 作用 | 只读 | 关键行为 |
| --- | --- | --- | --- |
| `read_file` | 读文件 | ✅ | 输出行号；支持 `offset`/`limit`；单次最多 30KB，截断时给出续读提示 |
| `write_file` | 写文件（覆盖/新建） | ❌ 需审批 | 自动建父目录；先写临时文件再原子替换 |
| `edit_file` | 精确替换文本 | ❌ 需审批 | 默认要求唯一匹配；支持 `replace_all`；保留 CRLF；成功后输出红绿 diff |
| `glob` | 按模式找文件 | ✅ | 支持 `*`/`?`/`**`/`[abc]`；跳过 `.git`、`node_modules`；最多 200 条 |
| `grep` | 按正则搜内容 | ✅ | `文件:行号:内容`；跳过二进制与 >5MB 文件；最多 100 条 |
| `bash` | 执行 shell 命令 | ❌ 需审批 | 工作区内执行；超时 kill；输出最多 30KB；Windows 默认 Git Bash，其次 cmd |

工具调用示例（模型侧 JSON，用户无需手写）：

```json
{"name":"grep","arguments":"{\"pattern\":\"runAgent\\\\(\",\"include\":\"*.ts\"}"}
```

每个工具都会把异常收敛成 `{ ok: false, output: "Error: …\n下一步：…" }`，模型和用户都能看到可操作的下一步。

## 加工具教程

以新增一个 `hello` 工具为例，3 步。

### 第 1 步：写工具定义

新建 `src/tools/hello.ts`：

```ts
import type { ToolDefinition, ToolResult, ToolRunContext } from "../types.js";

export const helloTool: ToolDefinition = {
  name: "hello",
  // 模型据此判断什么时候用：写清楚“做什么 / 不做什么”。
  description: "向指定名字打招呼。仅用于演示新增工具，不做其它事。",
  // JSON Schema，模型靠它填参数。
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "要问候的名字，例如 Ada" },
    },
    required: ["name"],
  },
  // 只读工具自动放行；写文件/执行命令必须设 false，让权限闸接手。
  readOnly: true,
  run: async (args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> => {
    const name = args["name"];
    if (typeof name !== "string" || name.trim() === "") {
      return {
        ok: false,
        output: 'Error: 缺少参数 name。\n下一步：传入形如 {"name":"Ada"} 的参数。',
      };
    }
    return { ok: true, output: `Hello, ${name}!（workspace: ${ctx.workspace}）` };
  },
};
```

约定：

- 工具必须自己校验参数并返回 `{ ok: false, output: "Error: 原因\n下一步：…" }`；
- 文件路径一律用 `src/tools/paths.ts` 的 `resolveInside(ctx.workspace, input)` 解析，不要自己拼绝对路径；
- 输出超过 30KB 要自己截断（参考 `src/tools/fs.ts` 的 `MAX_TOOL_OUTPUT_BYTES` 与 `OutputBuilder`）；
- 复杂逻辑用 `safeRun` 包起来，保证异常不会冒泡到 Loop（Loop 也有兜底，但错误信息不如工具自己给的清楚）。

### 第 2 步：注册到默认工具集

编辑 `src/tools/index.ts`：

```ts
import { helloTool } from "./hello.js";

export const defaultTools: readonly ToolDefinition[] = [
  ...fsTools,
  ...searchTools,
  ...bashTools,
  helloTool,
];
```

想临时裁剪工具集（例如 headless 只留只读），自己 `new ToolRegistry([...])` 传入即可。

### 第 3 步：加测试并验证

新建 `tests/hello.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { helloTool } from "../src/tools/hello.js";

test("hello 工具返回问候", async () => {
  const result = await helloTool.run({ name: "Ada" }, { workspace: process.cwd() });
  assert.equal(result.ok, true);
  assert.match(result.output, /Hello, Ada/);
});
```

然后：

```bash
npm run typecheck
npm test
npm run dev -- --mock --print "用 hello 工具向 Ada 问好"
```

如果新工具需要新的 UI 展示（例如自定义卡片），再扩展 `src/types.ts` 的 `AgentEvent` 与 `src/ui/HistoryItem.tsx`；一般情况下直接复用 `tool_start` / `tool_end` 即可。

## 权限与安全

- **审批**：交互模式下写文件/执行命令会弹出 `y / a / n`：
  - `y` 只允许这一次；
  - `a` 允许本次会话内同类操作（如所有 `write_file`）；
  - `n` 拒绝；被拒绝的原因会回填给模型，模型可以换一种方式继续。
- **危险命令硬拦**：`rm -rf /`、`del /f /s`、`format`、`shutdown`、`diskpart`/`mkfs`/`cipher /w`、`dd` 写设备、`bcdedit`、删除注册表 SYSTEM/SAM/SECURITY 等，直接拒绝且不询问（会剥掉 `sudo`、`cmd /c`、`powershell -c` 等包装再判断）。
- **headless 只读**：`--print` 模式下写工具与命令被直接拒绝，避免脚本无人值守时误改文件。
- **工作区边界**：`../`、工作区外绝对路径、`%TEMP%` 这类环境变量展开、`~`、`C:foo` 盘符相对路径、指向工作区外的符号链接/junction 全部拒绝，并在错误里说明原因与下一步。
- **密钥安全**：`.env` 被 git 忽略；HTTP 错误信息里的 key 会被替换成 `[REDACTED]`；`MEWCODE_DEBUG=1` 打印的请求体不含 key，可安全粘贴。

> 安全建议：模型生成的命令仍可能出错，审批时请看一眼；不要在有生产凭据的目录里随意授权。

## 会话与上下文压缩

- **会话文件**：`.mewcode/session.json`（当前工作区），每轮 `finally` 落盘，只保存 user/assistant/tool 消息；损坏时自动降级为“新会话”并提示。
- **恢复**：默认启动时读取上次会话并提示“已恢复 N 条消息”；`--new` 忽略历史。
- **压缩**：发送给模型前，按“用户轮次”分组；system 永远保留，最新一轮无条件保留，从新到旧累加，直到预算（`MEWCODE_CONTEXT_TOKENS × 0.7`，默认 89600）用完，装不下的旧轮**整轮丢弃**；最新一轮自身超预算时，tool 结果截到 2000 字符、assistant 文本截到 4000 字符。
- **可观察**：`MEWCODE_CONTEXT_TOKENS=300 MEWCODE_DEBUG=1` 时可以立刻看到 `[压缩] 丢弃 N 轮，tokens X → Y`。
- **说明**：压缩只作用于“发给模型的副本”，UI 历史与磁盘会话始终保留完整内容；不做 LLM 摘要（v0.2 候选）。

## 错误展示

所有错误都按“发生了什么 + 下一步”输出，TUI 与 headless 共用同一套描述（`src/errors.ts`）：

| 场景 | 示例提示 |
| --- | --- |
| HTTP 401/403 | `LLM 请求失败（HTTP 401）：…` + `下一步：检查 MEWCODE_API_KEY 是否有效` |
| HTTP 404 | 检查 `MEWCODE_BASE_URL` 是否正确（注意 `/v1`） |
| HTTP 429 | 触发限流，稍后重试 |
| 网络错误 | `网络请求失败：fetch failed` + 代理提示 |
| 工具失败 | `Error: …` + 工具自己的“下一步” |
| 权限拒绝 | `权限被拒绝：…` + 换一种被允许的方式 |
| 达到最大步数 | `（已达到最大步数 30，已停止）` + 回复“继续”或拆小任务 |
| 用户中断 | `（已中断）如果您还要继续，重新输入问题即可。` |

## 测试与 CI

```bash
npm run typecheck     # tsc --noEmit（strict）
npm test              # node:test，30 个测试文件 / 330 个用例
npm run build         # 输出 dist/
```

- 测试覆盖：SSE 解析、OpenAI 客户端、消息格式、Agent Loop（含压缩/中断/超步数）、6 个工具、路径边界、危险命令、权限闸、审批、会话、diff 生成与解析、TUI 组件辅助函数等。
- CI：`.github/workflows/ci.yml`，Ubuntu + Node 22，执行 `npm ci` → `npm run typecheck` → `npm test`；每次 push 全绿。
- 分级验收与手工清单见 `docs/testing.md`（A 级自动化、B 级手工）与 `docs/checklist.md`（10 条成功标准）。

## Windows 注意事项

1. **终端**：用 Windows Terminal。cmd/旧版 PowerShell 窗口下 TUI 的重绘与中文输入体验差。
2. **中文输入**：微软拼音可正常输入、候选、退格；候选框位置略有偏移（已知且可接受），详见 `spikes/RESULT.md`。
3. **代理**：访问 GitHub / npm 官方源需要代理时，设置 `HTTP_PROXY`/`HTTPS_PROXY`（例如 `http://127.0.0.1:7890`）。
4. **重定向**：PowerShell 5.1 的 `>` 会写 UTF-16LE；保存程序输出请用 `cmd /c`，或用 `Get-Content -Encoding UTF8` 读。
5. **`--` 规则**：经 `npm run dev` 传参时，npm 会吃掉第一个 `--`；prompt 以 `-` 开头时要再加一个 `--`。
6. **shell**：`bash` 工具默认优先 Git Bash；没有 Git Bash 时退回 `cmd.exe`，可用 `MEWCODE_SHELL` 指定。

## 已知限制与 Roadmap

当前限制：

- 一个工作区同一时间只有**一个会话**（多会话需要不同 `--workspace`）；
- 无 MCP、无子 Agent、无插件系统、无图片/多模态输入；
- 上下文压缩是“整轮丢弃”，没有 LLM 摘要；
- TUI 为纯文本渲染，没有 Markdown 语法高亮；
- 工具单次输出上限 30KB、glob 200 条、grep 100 条；
- 主要在 Windows 上开发与验收，macOS/Linux 仅保证 CI 单测通过；
- Node < 20.12 时没有 `process.loadEnvFile`，程序会自动改用内置 `.env` 解析（已模拟验证）；其他 Node 22 相关差异未逐一适配。
- `.env` 只在两处查找：**当前工作目录**与用户级配置目录（`~/.mewcode/.env`，可用 `MEWCODE_HOME` 改）；从项目子目录启动时不会自动向上查找仓库根目录的 `.env`（可改用 `--workspace` 或用户级配置）。
- 首次配置向导只在**交互式终端**弹出；`--print`、管道、CI 等非交互场景不会弹（仍可用环境变量 / `.env` 配置）。

v0.2 候选（尚未排期）：

- MCP 工具接入；
- 子 Agent / 并行任务；
- 多会话管理与会话切换；
- 基于 LLM 摘要的压缩；
- 更细粒度的 diff（行内/词级高亮）；
- 发布到 npm（`npx mewagent`）。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/spec.md](docs/spec.md) | 规格说明：架构、模块、CLI、TUI、工具、安全、测试 |
| [docs/tasks.md](docs/tasks.md) | 任务看板与验收标准（唯一任务列表） |
| [docs/testing.md](docs/testing.md) | 分级验收（A 自动化 / B 手工）与各任务结果 |
| [docs/demo.md](docs/demo.md) | 3 分钟演示脚本（可复现） |
| [docs/checklist.md](docs/checklist.md) | 10 条成功标准与阶段回归清单 |
| [HANDOFF.md](HANDOFF.md) | 交接文档：当前状态、已定决策、关键文件、会话记录 |
| [MewCode-TS实施方案.md](MewCode-TS实施方案.md) | 总体实施方案（S0~S4 拆分与风险） |
| [MewAgent-v0.1.0-开发复盘.md](MewAgent-v0.1.0-开发复盘.md) | v0.1.0 收尾复盘：规划、执行、设计取舍、踩坑与复现指南 |

## License

仓库已于 2026-11-24 由 private 转为 **public**（便于在不同机器上 `git clone`）；代码 `UNLICENSED`（未授予使用/分发许可，仅个人使用）；仓库内不要提交真实 API key 或 `.env`（`.env` 已被 `.gitignore` 忽略，只有 `.env.example` 会入库）。
