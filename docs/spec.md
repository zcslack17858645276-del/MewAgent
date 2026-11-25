# MewAgent v0.1 规格说明（spec）

> 状态：**S0 已完成并打 tag `v0.1-s0`；S1 已完成并打 tag `v0.1-s1`（SSE、流式客户端、prompt 与消息转换、Ink TUI + 多行输入、`--print` headless 真实 API 全部完成）；S2 已完成并打 tag `v0.1-s2`（6 工具 + 注册表 + Agent Loop + TUI 工具事件；全量 204/204，真实模型自主读 README 验收通过）；S3 进行中：S3-1 已完成（权限三道闸 + headless 只读；全量 232/232）、S3-2 已完成（交互审批 UI；全量 241/241，B 级 4 条已由用户实测通过）、S3-3 已完成（会话持久化 `<workspace>/.mewcode/session.json`：每轮保存 / 启动恢复 / `--new` / 损坏降级；全量 258/258）、S3-4 已完成（`context/tokens.ts` + `context/compress.ts` 按轮压缩：system 常驻、最新轮保留、旧轮整轮丢弃、最新轮超预算截断；`MEWCODE_CONTEXT_TOKENS` 可调窗口、`MEWCODE_DEBUG=1` 输出 `[压缩]` 统计；全量 277/277）、S3-5 已完成（S3 集成验收：50 轮不爆上下文 / 重启恢复 / 审批拒绝后继续 / 危险命令硬拦；全量回归 277/277、`INTEGRATION OK`），**S3 已完成并打 tag `v0.1-s3`（已 push）**；S4-1 已完成（edit diff 红绿展示 + `errors.ts` 统一错误描述，全量 296/296；B 级 3 条已由用户 2026-11-24 实测通过）；S4-2 已完成（README 重写：安装/配置/命令/架构图/3 步加工具教程等齐全，`--help` banner 改 v0.1；A 级：仓库克隆到新目录仅照 README 跑通 install → typecheck → 296/296 → `--mock` → build → dist），已由用户 2026-11-24 在另一台机器实测通过；S4-3 已完成（打包与启动：`package.json` 增 `bin.mewagent` / `prepack` / `files`，入口 shebang + realpath 直跑判断；`npm link` 后任意目录可用、`npx .` 可运行、含空格+中文路径正常、`npm unlink -g` 无残留、`npm pack` 产物 77 项/230KB；`tests/packaging.test.ts` 5 例，全量 303/303）；HF-1 已完成（首次启动配置向导：交互式缺配置时弹 3 步向导 base-url/模型/API key，可测试连接后保存到用户级 `config.json`（0600）；`--setup` 重跑、非 TTY 不弹；`resolveConfig` 优先级 CLI > env > 用户 `config.json` > 默认；`tests/setup.test.ts` 9 例 + `tests/user-config.test.ts` 6 例 + `tests/setup-wizard.test.ts` 10 例，全量 330/330（1 skip），E2E 证明用户级 `config.json` 生效），S4-4 已完成（10 条成功标准逐项验收：真实 API 首字 1314ms、多工具 3 次调用、审批拒绝回填；`docs/demo.md` 3 分钟演示脚本 + README 链接；全量 330/330、冒烟三项、`INTEGRATION OK`），**v0.1.0 已发布（tag `v0.1.0` 已 push）**。HF-2（2026-11-25，一键安装）已完成：新增 `scripts/install.ps1`/`scripts/install.sh`（一行安装），`prepack`→`prepare`，A 级脚本端到端通过、全量 330/330（B 级待用户）。CI 在 GitHub Actions 全绿，agent 用 `gh` CLI 独立复核。
> 来源：`MewCode-TS实施方案.md`（施工图纸）与已落地代码。契约以方案 §3.3 与 `src/types.ts` 为准；本文件与代码冲突时，以代码为准并回填本文件。
> 维护方式：每个阶段完成后，在「§13 阶段状态」与对应章节追加该阶段实际交付的「要什么 / 不要什么 / 验收 / 已知边界」。

## 1. 产品目标

一个跑在终端里的编程 Agent：**流式对话**、读写改文件、执行命令、动手前询问、重启恢复会话、`npm run dev` 一条命令启动；Windows Terminal 下中文输入输出不乱码。单人自用优先，代码保持可读、可测试、可维护。

## 2. 非目标（v0.1 明确不做）

MCP / Skill / Hook / SubAgent / Agent Teams / Git Worktree / 多模型路由 / 桌面 GUI / 团队协作 / 云同步 / 插件市场 / Plan 模式 / 自定义 slash 命令。

## 3. 成功标准（§1.4 十条，逐条可验收）

| # | 标准 | v0.1 目标 | 当前状态（2026-11-24，v0.1.0 发布） |
|---|---|---|---|
| 1 | 流式回复，可中断，首字 < 2s | 是 | ✅ 真实 API 首字时延 **1314ms**（<2000ms，spikes/.out/s4-4-real-api.txt）；SSE + OpenAI 客户端 + TUI 流式/中断（S1-4 B 级用户验收通过） |
| 2 | 6 个工具可用：read/write/edit/glob/grep/bash | 是 | ✅ 6 工具 + 注册表（S2）；ALL TOOLS OK（S4-4 冒烟：steps=7 / toolCalls=6） |
| 3 | 多工具自主连续调用，能完成 3 步以上任务 | 是 | ✅ 真实模型 3 次工具调用（read_file→grep→bash）、**4 轮 LLM**、stop（S4-4 真实 API 验收） |
| 4 | 写文件与执行命令前必须人工确认，拒绝原因回填模型 | 是 | ✅ S3-1/S3-2 权限闸 + 审批 y/a/n；S4-4 真实 API：询问 1 次、拒绝原因回填、文件未创建、模型继续 |
| 5 | 文件系统不越界 + 危险命令拦截 | 是 | ✅ S2-1 路径边界、S3-1 13 类危险命令硬拦；S3-5 集成 m -rf / asked=0 |
| 6 | 连续 50 轮不爆上下文 | 是 | ✅ S3-4 按轮压缩；S3-5 集成：50 轮全部 stop、历史 101 条、maxDropped=41 |
| 7 | 重启后恢复最近会话 | 是 | ✅ S3-3 .mewcode/session.json（用户 B 级通过 + S3-5 集成恢复 2→4） |
| 8 | Windows Terminal 中文输入输出不乱码 | 是 | ✅ 输入 S0-1 判定 A（用户实测）；输出 S4-4 真实 API 中文 7 字无 `�` + TUI 冒烟 |
| 9 | 一条命令启动 | 是 | ✅ `npm run dev`；S4-3 起全局 `mewagent`（npm link）与 `npx .` 也可一条命令启动 |
| 10 | README 快速开始 + 测试 + 3 分钟演示 | 是 | ✅ README 重写（S4-2，用户另一台机器实测通过）+ 30 文件 330 例测试 + [docs/demo.md](demo.md) 3 分钟演示（README §7 链接） |

## 4. 架构

### 4.1 分层（方案 §3.1）

```
UI（Ink）──消费──> AgentEvent <──产出── Agent Loop ──调用──> LlmClient（协议）
                                          │
                                          └──调用──> ToolDefinition（工具）
                                                        │
                                             安全层（paths / danger / Gate）
```

- **UI** 只消费 `AgentEvent`，不直接调 LLM 或工具。
- **Agent Loop** 负责编排：调模型 → 执行工具 → 回填结果 → 再调模型，直到 `stop` 或达到 `maxSteps`。
- **LlmClient** 只负责协议（SSE 解析、tool_calls 聚合、mock）。
- **工具** 只通过 `ctx.workspace` 访问文件系统，不弹 UI。
- **安全层** 在工具执行前提供路径校验与 `Gate` 确认。

### 4.2 目录结构

```text
src/
  index.ts            # CLI 入口（参数/配置/help/version/--print）；已实现
  config.ts           # .env + CLI 参数解析与校验；已实现
  types.ts            # 唯一契约文件；已实现
  llm/
    mock.ts           # 离线两轮剧本；已实现
    sse.ts            # 手写 SSE 解析（S1）
    openai.ts         # OpenAI 兼容 chat/completions（S1）
    index.ts          # 按配置选择 mock / openai（S1）
  agent/
    prompt.ts         # system prompt（S2）
    messages.ts       # 消息裁剪/压缩（S3）
    loop.ts           # 单 Agent Loop，maxSteps=30（S2）
  tools/
    paths.ts          # 工作区路径边界（S2）
    registry.ts       # 工具注册表（S2）
    fs.ts             # read/write/edit/glob/grep（S2）
    search.ts         # grep/glob 细节（S2）
    bash.ts           # 命令执行与截断（S2）
    index.ts          # 导出六个工具（S2）
  safety/
    danger.ts         # 危险命令识别（S3）
    permissions.ts    # Gate 确认（S3）
  context/
    tokens.ts         # token 估算（S3）
    compress.ts       # 用户轮次压缩（S3）
  session/
    store.ts          # <workspace>/.mewcode/session.json（S3）
  ui/
    App.tsx           # TUI 根组件（S1）
    HistoryItem.tsx   # 历史条目（S1）
    ApprovalPrompt.tsx# 确认框（S3）
tests/                # node:test；当前 core/types/config/mock/sse/openai/messages/prompt/ui/input-text/paths/registry/fs/search/bash/loop/tool-display/stream-lines/danger/permissions/approval/session/compress/diff/errors/diff-view 二十六个文件
docs/                 # tasks / testing / spec / checklist
.github/workflows/ci.yml
spikes/               # 一次性验证脚本与证据（.out/ 已 gitignore）
```

### 4.3 核心契约（`src/types.ts`）

| 类型 | 要点 |
|---|---|
| `Message` | 四分支判别联合：`system` / `user` / `assistant{content,toolCalls}` / `tool{toolCallId,content}` |
| `ToolCall` | `{ id, name, arguments: string }`，`arguments` 保持模型返回的原始 JSON 字符串 |
| `ToolResult` | `{ ok: boolean, output: string }`；失败时 `output` 以 `Error:` 开头 |
| `ToolDefinition` | `{ name, description, parameters: Record<string,unknown>, readOnly, run(args, ctx) }`；`readOnly` 决定是否需要确认 |
| `ToolSpec` | 发给模型的 OpenAI 工具定义 `{ type:"function", function:{name,description,parameters} }` |
| `LlmClient` | `chat(messages, tools, opts?: { signal?, onText? })` → `{ content, toolCalls, finishReason }` |
| `Gate` | `(call: ToolCall) => Promise<GateResult>`；`{allow:true}` 或 `{allow:false,reason}`，拒绝原因回填给模型 |
| `AgentEvent` | `assistant_text{delta}` / `tool_start{call,args}` / `tool_end{call,result,durationMs}` / `turn_end{reason}` |

契约变更规则：先改方案 §3.3 与本文件 → 更新 `src/types.ts` → 补测试 → 在 `HANDOFF.md` §7 记录原因。

### 4.4 一次请求时序（S2 起真实生效；S0-4 的 mock 已按此形状跑通）

1. UI 收到用户输入，转成 `Message{role:"user"}` 追加到历史。
2. Loop 调 `LlmClient.chat(messages, tools, {onText})`；流式文本通过 `onText` 转成 `assistant_text` 事件。
3. 若返回 `toolCalls`：对每个 call 产出 `tool_start` → 过 `Gate`（只读工具可免确认）→ 执行 `ToolDefinition.run`（路径校验 + 输出截断）→ 产出 `tool_end`，结果以 `role:"tool"` 回填历史，回到第 2 步。
4. 若无 toolCalls（`finishReason="stop"`），产出 `turn_end`，本轮结束。
5. 循环上限 `maxSteps=30`；超限产出 `turn_end{reason:"max_steps"}` 并提示用户。

## 5. CLI 与配置（S0-3 / S0-4 已实现）

### 5.1 用法

```text
npm run dev -- [选项] [prompt]

--model <name>       模型名（默认取 MEWCODE_MODEL）
--base-url <url>     API 地址（默认 https://api.deepseek.com，客户端拼 /chat/completions）
--workspace <dir>    工作区（默认当前目录）
--new                新建会话（S3 起生效）
--mock               离线模式，不发网络请求，使用 mock 剧本
--print [prompt]     headless 单次问答（不启动 TUI）
--help / --version   用法 / 版本号
```

`--` 之后的全部内容作为 prompt 文本；也可以直接写位置参数（以空格拼接）。

### 5.2 环境变量与 `.env`

```dotenv
MEWCODE_API_KEY=          # 必填（--mock 外）；只从环境/.env 读取，不进命令行、不打印
MEWCODE_BASE_URL=         # 可选，默认 https://api.deepseek.com
MEWCODE_MODEL=            # 可选；真实模式必填（如 deepseek-chat）
MEWCODE_DEBUG=            # 可选，1 时打印请求体（不含 key）与压缩日志
MEWCODE_MOCK_DELAY_MS=    # 可选，mock 慢速流式块间延迟
MEWCODE_CONTEXT_TOKENS=   # 可选，上下文预算（默认 128000，压缩取 70%）
MEWCODE_SHELL=            # 可选，覆盖 bash 工具使用的 shell
MEWCODE_HOME=             # 可选，用户级配置目录（默认 ~/.mewcode）
```

配置文件（启动时依次加载，加载器不覆盖已存在变量）：

1. **用户级**：`~/.mewcode/.env`（Windows `%USERPROFILE%\.mewcode\.env`），目录可用 `MEWCODE_HOME` 覆盖；全局安装后跨目录共用一份 key/模型（2026-11-24 hotfix）。
2. **项目级**：当前工作目录下的 `.env`（`--workspace` 不改变 cwd 的 `.env` 查找；不向上查找）。

优先级：**CLI 参数 > shell 环境变量 > 项目 `.env` > 用户级 `.env` > 用户级 `config.json` > 内置默认值**。`.env` 优先用 Node 内置 `process.loadEnvFile` 加载，Node < 20.12 时自动回退内置解析器；空字符串视为未设置。

**用户级 `config.json` 与首启向导（HF-1，2026-11-24）**：

- 位置：`resolveUserConfigPath(env)` = `~/.mewcode/config.json`（Windows `%USERPROFILE%\.mewcode\config.json`），`MEWCODE_HOME` 可改目录；权限 0600（POSIX），Windows 继承用户 profile ACL。
- 格式：`{ "baseUrl"?: string, "model"?: string, "apiKey"?: string }`；`readUserConfig` 区分 missing / loaded / corrupt（损坏只警告并忽略，不阻断启动）；`saveUserConfig` 与已有内容合并、空串视为保留旧值、原子性由 `mkdirSync` + `writeFileSync` 保证。
- 触发：交互式终端（非 `--print` 且 stdin/stdout 均为 TTY）且 `findMissingConfig` 判定缺 model 或 apiKey 时自动弹向导；`--setup` 强制重跑；非 TTY 下 `--setup` 报错（exit 2），普通非交互运行不弹窗、仍走 env/.env 配置。
- 向导：3 步（base-url → 模型名 → API key），确认页 Enter = 先用 `probeConnection` 测试 `/chat/completions` 再保存（10s 超时；HTTP/网络/超时错误给「下一步」，不回显 key），`s` = 跳过测试直接保存，`e` = 重填，Esc = 取消；保存成功后打印路径并退出（`--setup` 场景）或继续启动 TUI。
- 相关导出：`UserConfig`、`findMissingConfig(options, env, stored)`、`resolveConfig(options, env, cwd, stored)`（第 4 参为用户配置）；`src/setup/probe.ts` 的 `probeConnection`。


### 5.3 退出码与错误

- `0` 成功；`2` 用户/配置错误（`CliError`）；`1` 非预期内部错误。
- 错误信息必须可操作，形如「问题。\n下一步：…」，且不得回显 API key。
- 非 `--print` 模式必须在真实 TTY 中运行，否则报错并提示改用 `--print`。

### 5.4 headless 输出（S0-4）

`npm run dev -- --mock --print "你好"` 输出两轮 mock：

```text
mewagent 0.1.0 · mock 离线两轮（S0-4：验证工具调用 → 最终文本链路）
workspace: …  model: mock  base-url: …  mock: true
prompt: 你好
--- 第 1 轮：模型 → 工具调用 ---
tool_call: read_file {"path":"README.md"}
（S0-4 占位工具结果：read_file 将在 S2 实现）
--- 第 2 轮：模型 → 最终文本 ---
<MOCK_FINAL_TEXT>
finish: stop
```

真实 API：交互 TUI 已在非 mock 下调用 `createOpenAiLlmClient`（S1-4）；`--print` headless 的真实 API 链路已在 S1-5 接通——system prompt 首位、一轮流式输出到 stdout、诊断走 stderr，`MEWCODE_DEBUG=1` 打印请求体，401/网络失败给可读"下一步"并退出码 1。真实 API 的 A 级复验已于 2026-11-23 通过（用户换有效 key 后：中文回复 + exit 0；假 key 401 + exit 1）；流式首字/中断手感留 S1-6 手工回归。

## 6. 工具系统（S2）

| 工具 | 参数 | 只读 | 关键约束 |
|---|---|---|---|
| `read_file` | `path` | 是 | 单文件输出截断；超长提示分段读取 |
| `write_file` | `path`、`content` | 否 | 必须确认；禁止越界；写前显示 diff 摘要 |
| `edit` | `path`、`old_string`、`new_string` | 否 | 必须确认；多次匹配报错；保留缩进 |
| `glob` | `pattern` | 是 | 上限 200 条 |
| `grep` | `pattern`、`path?` | 是 | 限制结果行数与字符数 |
| `bash` | `command` | 否 | 必须确认；危险命令拦截；单次输出 30KB 截断 |

共同约定：路径一律 `path.resolve` + 相对工作区校验；工具不抛异常给 UI，统一返回 `ToolResult`。

## 7. 权限与安全（S3）

- 三道闸：**路径边界**（`tools/paths.ts`）→ **危险命令识别**（`safety/danger.ts`）→ **人工确认 Gate**（`safety/permissions.ts`）。
- 只读工具（`readOnly: true`）可配置免确认；写文件与 bash 必须确认。
- 拒绝时 `reason` 回填为 `role:"tool"` 结果，模型需据此调整方案。
- 红线：不提交 `.env`；不把 key 写进日志/输出。
- S3-1 已实现（2026-11-24）：`safety/danger.ts` 规则表（13 类危险命令 + 包装器剥壳，最多 4 层）/ `safety/permissions.ts` 的 `createPermissionGate`（顺序：arguments 解析 → 未知工具 → 路径边界 → readOnly → 危险命令 → headless → 会话白名单 → `ask` y/a/n；异常按拒绝）；`src/index.ts` 交互分支已接 gate（暂无审批 UI → 写操作拒绝并提示 S3-2，只读放行）；`runRealHeadless` 升级为 Agent Loop + 只读工具 + headless 闸。拒绝原因统一回填 `Error: 权限被拒绝：<原因>\n下一步：…`，不破坏 assistant/tool 配对。
- S3-2 已实现（2026-11-24）：`src/ui/approval.ts` 审批桥（`ask` 返回挂起 Promise，`subscribe`/`current`/`respond`，同一时刻仅一个 pending，重叠请求抛错）；`src/ui/ApprovalPrompt.tsx` 只接受单字符 `y`/`a`/`n`，`Esc` → 拒绝，其它键忽略；App 增加 `pendingApproval` 展示态（`awaiting_approval`）：审批时输入框失焦（`InputBox active=false`）、App 的 `useInput` 让位（仅 Ctrl+C 仍可中断整轮）、光标隐藏、状态行显示「等待审批：y 允许 · a 本会话总是允许 · n/Esc 拒绝」；`start-tui`/`index.ts` 把 controller 传给 gate 的 `ask`；headless 不变（无 ask，写操作直接拒绝）。
- S3-3 已实现（2026-11-24）：`src/session/store.ts` 提供 `resolveSessionPath` / `loadSession(workspace, {forceNew?})` / `saveSession(workspace, model, messages, {createdAt?, now?})`；会话路径 `<workspace>/.mewcode/session.json`，格式 `{version:1, workspace, model, createdAt, updatedAt, messages}`；只存 user/assistant/tool（system 每次重建、加载时静默跳过）；保存先写 `.tmp` 再 `rename` 原子替换、空历史不落盘、失败返回 `{ok:false}` 不抛异常；加载出错（坏 JSON/未知版本/非法消息）降级为 `corrupt` + 可读原因；`src/index.ts` 交互分支启动加载并注入 `initialMessages`/`restoredMessageCount`/`sessionNotice`，每轮结束（含中断）调 `persistMessages` 落盘，失败仅警告；headless 不读写会话；`.mewcode/` 已在 `.gitignore`。

## 8. 上下文与会话（S3）

- 压缩策略：按**用户轮次**淘汰最旧的历史，保留 system + 最近轮次；触发阈值按估算 token（§6.3）。
- 压缩后不可丢失当前轮次的工具调用/结果配对。
- 会话文件：`<workspace>/.mewcode/session.json`（已 gitignore）；`--new` 强制新会话；启动时默认恢复最近会话。
- S3-4 已实现（2026-11-24）：`src/context/tokens.ts` 提供 `estimateTextTokens` / `estimateMessageTokens` / `estimateMessagesTokens` / `computeBudgetTokens`（CJK ≈1.1 token/字、其他 ≈1/4、每条消息 +8，预算 = `contextTokens × 0.7`）；`src/context/compress.ts` 的 `compressMessages` 按 user 轮分组：system 常驻、最新轮必留、从新到旧累加到预算、旧轮**整轮**丢弃（保住 assistant.toolCalls 与 tool 结果配对）、最新轮自身超预算时截断 tool 到 2000 字符 / assistant 到 4000 字符、结果不以 tool 开头；`src/agent/loop.ts` 增 `contextTokens`/`onCompress`，**只压缩发给模型的副本**，返回的 `messages` 仍是完整历史（供会话持久化与 UI）；`src/index.ts` 读 `MEWCODE_CONTEXT_TOKENS`（默认 128000），`MEWCODE_DEBUG=1` 时把 `[压缩] 丢弃 N 轮，tokens X → Y` 打到 stderr。

## 9. TUI（S1）

- 状态机：`idle | streaming | tool_running | awaiting_approval | error`（S1-4 实现 `idle | streaming`；S2-7 增加 `tool_running`；S3-2 增加 `awaiting_approval` 展示态；`error` 随后续错误展示增强）。
- 历史用 Ink `<Static>` 渲染；流式文本按 50ms 节流重绘；`Esc`/`Ctrl+C` 中止当前请求。
- S1-4 实现：`src/ui/App.tsx`（输入框 + Static 历史 + 流式动态区 + 错误行 + 排队）、`src/ui/InputBox.tsx`（自研受控多行输入，纯逻辑在 `src/ui/input-text.ts`）、`src/ui/throttle.ts`（可注入时钟的 50ms 合并）、`src/ui/HistoryItem.tsx`、`src/ui/start-tui.tsx`、`src/ui/width.ts`（中英混排列宽）；S2-7 起改为注入 `runTurn`（`(messages, {signal, emit}) => runAgent(...)`），UI 只消费 `AgentEvent`；`exitOnCtrlC:false`，生成中 Ctrl+C 只 abort、空闲退出。
- 工具事件（S2-7）：`tool_start` → 动态区状态行 `⚙ 工具运行中：<name> {参数摘要}…（Esc 中断）`；`tool_end` → 历史项 `✅/❌ <name> {参数摘要} · <耗时>[ · Error: 首行]`（参数摘要截断 120 码点、错误首行截断 160，`src/ui/tool-display.ts` 纯函数）；`turn_end` 的 `aborted`/`max_steps` 追加提示；`runTurn` 抛非中断错误 → 错误行 + 输入框下方"下一步"提示。
- 输入框（S1-4 补丁）：Enter 发送、**Shift+Enter 换行**（Kitty 键盘协议；终端不支持时 **Ctrl+J** 兜底）、粘贴多行保留换行、方向键/Home/End 编辑；中文 IME 判定 A（可输入、退格整字删除，候选框位置略偏可接受）。`ink-text-input` 已被替换（依赖暂留）。
- 流式渲染（2026-11-24 修复）：完整行立即提交 `<Static>`（渲染一次、永不重绘），动态区只渲染未完成尾行（≤800 码点，超出显示 `…` 前缀；CRLF 的 `\r` 不显示）；实现见 `src/ui/stream-lines.ts`。原因：长输出整段留在动态区时，动态区高度超过终端后旧帧无法擦除、残留 scrollback，用户滚动时表现为同一段输出反复叠加。
- mock 慢速流式（S1-4 补丁）：`MEWCODE_MOCK_DELAY_MS` 控制块间延迟，便于手工观察流式/Esc/中断；默认 0 与真实行为一致。
- 终端要求 Windows Terminal；conhost 不做保证。
- diff 展示（S4-1）：`edit_file` 输出「头行 + 行级 unified diff」（`--- a/`、`+++ b/`、`@@ -o,n +o,n @@`、`<标记><4 位行号>│ 内容`，生成器 `src/tools/diff.ts`，hunk ±3 行、最多 8 块 / 240 行）；UI 侧 `src/ui/diff-view.ts` 解析为历史条目，按行着色（删除红 / 新增绿 / hunk 青 / 文件头暗 / 上下文默认），最多渲染 80 行，超出提示还有多少行。
- 错误展示（S4-1）：统一由 `src/errors.ts` 产出「发生了什么 + 下一步」——HTTP 401/403/404/429/5xx、网络失败（含代理提示）、中断、工具失败、权限拒绝、超步数；TUI 历史项与输入框下方提示行都带「下一步」，headless `--print` 同源复用；`max_steps` 追加"回复'继续'让我接着做，或把任务拆小后重发"。错误不崩溃，可继续对话。

## 10. Windows 专项（§6.10）

- shell 选择顺序：`MEWCODE_SHELL` → Git Bash（`C:\Program Files\Git\bin\bash.exe`）→ `cmd.exe /d /s /c`；cmd 下先 `chcp 65001`，UTF-8 → GBK 回退。
- 路径边界用 `path.resolve` + `relative` 判断，禁止字符串前缀判断。
- `child.kill` 只杀直接子进程（v0.1 已知限制，不做进程树管理）。
- 本机只有 PowerShell 5.1；脚本勿依赖 pwsh 7。

## 11. 错误处理与限制（v0.1）

- 网络错误/超时：提示原因，保留当前会话，不自动重试（重试策略留到 v0.2）。
- SSE 断流：`turn_end{reason:"error"}`，UI 显示可读错误。
- 工具输出超过 30KB 截断并注明「已截断」。
- 单轮工具调用上限 30 步；超限停止并提示。
- 错误提示统一带「下一步」：HTTP 状态、网络失败、中断、工具失败、权限拒绝、超步数均有可执行建议（`src/errors.ts`，S4-1）；错误不崩溃、会话可继续。

## 12. 测试与验收

- 自动化：`npm run typecheck` + `npm test`（node:test），CI 在 ubuntu-latest / Node 22 跑同样三条命令。
- 手工：`docs/testing.md` 按 task 分 A/B/C 级；P0 未过不得标 done。
- 发布前逐条勾选 `docs/checklist.md`。
- 新用户可照 `README.md` 从 clone 到跑通（S4-2 A 级已在克隆副本验证，B 级已由用户在另一台机器通过；README 含安装、配置、命令、架构图、加工具教程）。
- 打包与启动（S4-3）：`package.json` 配 `bin` / `prepare`（HF-2 起；原为 `prepack`）/ `files`，入口带 shebang；`npm link`、`npx .`、含空格/中文路径启动、`npm unlink -g` 清理均在 Windows 实测（A 级；`tests/packaging.test.ts` 5 例回归）。
- 一键安装（HF-2，2026-11-25）：`scripts/install.ps1`（UTF-8 BOM，PS 5.1）与 `scripts/install.sh`——Node ≥ 22 检查 → git clone（无 git 回退下载 `archive/refs/heads|tags/<ref>.zip|tar.gz`）→ `npm install` + `npm run build` → `npm pack` 后 `npm install -g`（避免 npm 12 的 `npm install -g .` junction 在清理临时目录后悬空）→ 清理旧 shim → `mewagent --version` 校验；`package.json` 增 `repository`/`homepage`/`bugs`；npm 12 默认禁 git/remote 依赖（`allow-git=none`），`npm install -g github:…` 需 `--allow-git=all`（npm 11 及更早无需），故以脚本为主、npm 命令为备选。

## 13. 阶段状态（2026-11-25）

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0-1 | 工程初始化 + Ink 中文 IME spike（判定 A，继续 TS） | ✅ |
| S0-2 | `src/types.ts` 契约定稿（无 any 逃逸） | ✅ |
| S0-3 | `src/config.ts` + `src/index.ts` CLI 骨架（help/version/缺 key/非 TTY） | ✅ |
| S0-4 | `src/llm/mock.ts` + `--mock --print` 离线两轮 | ✅ |
| S0-5 | AGENTS.md / CLAUDE.md / docs/spec.md / docs/checklist.md + CI | ✅（Actions 3 runs 全绿，证据 `docs/evidence/s0-5-ci-actions.png`） |
| S0-6 | 全量验收 + tag `v0.1-s0` | ✅（typecheck 0 / tests 39 / help+version / mock 幂等 / build+dist；tag 已 push） |
| S1-1 | `src/llm/sse.ts`：SSE 逐行解析（分块 / CRLF / `[DONE]` / 尾部残留 / BOM / UTF-8 切断） | ✅（`tests/sse.test.ts` 13 例） |
| S1-2 | `src/llm/openai.ts`：fetch 流式客户端 + `tool_calls` 按 index 聚合 + abort + 错误映射 | ✅（`tests/openai.test.ts` 13 例；B 级模块级用户已复核） |
| S1-3 | `src/agent/prompt.ts` + `src/agent/messages.ts`：system prompt 与 API JSON 转换 | ✅（`tests/messages.test.ts` + `tests/prompt.test.ts` 共 12 例） |
| S1-4 | `src/ui/App.tsx`：Ink TUI（Static 历史 / 50ms 节流 / 排队 / Esc·Ctrl+C）；补丁：多行输入 `ui/InputBox.tsx` + `MEWCODE_MOCK_DELAY_MS` | ✅（`tests/ui.test.ts` 6 例 + `tests/input-text.test.ts` 13 例；8 条 B 级由用户验收通过） |
| S1-5 | `--print` headless 接真实 API（stdout 只放文本 / `MEWCODE_DEBUG` / 401·网络错误可读） | ✅（真实 API A 级复验通过；假 fetch 单测 5 例） |
| S1-6 | S1 全量验收 + 打 tag `v0.1-s1` | ✅（typecheck 0 / tests 104 / help+version / mock 幂等 / build+dist / 真实 API 中文 / TUI 冒烟；tag 已 push） |
| S2-1 | `src/tools/paths.ts`：工作区边界校验（词法 + 真实路径两层；拒绝 `..`、越界绝对路径、盘符相对、`%VAR%`、`~`、symlink/junction 逃逸） | ✅（`tests/paths.test.ts` 10 例，全量 114/114；B 级 TUI 两项随 S2-6/S2-7 接线后验） |
| S2-2 | `src/tools/registry.ts`：工具注册表 + OpenAI tools 声明 + arguments 解析 + 异常兜底 | ✅（`tests/registry.test.ts` 13 例，全量 127/127；未知工具/坏 JSON/非对象/抛异常全部转 `ok:false` 不崩；"6 工具齐全"待 S2-3~S2-5 工具接入后验） |
| S2-3 | `src/tools/fs.ts`：`read_file`（行号/offset/limit/30KB 截断）/ `write_file`（自动建目录）/ `edit_file`（唯一性 + `replace_all` + CRLF 兼容） | ✅（`tests/fs.test.ts` 15 例，全量 142/142；B 级 6/7 已由用户实测通过，3–5 随 loop/TUI/审批接线后验） |
| S2-4 | `src/tools/search.ts`：`glob`（`*`/`?`/`**`/字符类，200 条 + 30KB 截断）/ `grep`（正则逐行，100 条，跳过 .git/node_modules/二进制/5MB） | ✅（`tests/search.test.ts` 11 例，全量 153/153；B 级 2–4 待 loop/TUI 接线后验） |
| S2-5 | `src/tools/bash.ts`：shell 选择（`MEWCODE_SHELL` > Git Bash > cmd）/ 超时 kill + 兜底 / 30KB 截断 / UTF-8→GBK / cwd 固定工作区 | ✅（`tests/bash.test.ts` 14 例，全量 167/167；B 级 2–5 待 loop/TUI 接线后验） |
| S2-6 | `src/agent/loop.ts`：`AgentEvent` 事件流、多轮工具、`maxSteps=30`、`turn_end` 原因、Gate 预留；`src/tools/index.ts` 默认注册表 | ✅（`tests/loop.test.ts` 19 例，全量 186/186；B 级 3–5 待 S2-7 UI 接线后验） |
| S2-7 | `src/ui/App.tsx`：消费 `AgentEvent`（`assistant_text`/`tool_start`/`tool_end`/`turn_end`），工具历史 `✅/❌` + 参数摘要 + 耗时；`runTurn` 注入；`src/ui/tool-display.ts` 纯函数 | ✅（`tests/tool-display.test.ts` 9 例，全量 195/195；假 stdin 冒烟 SMOKE OK；B 级 4 条已由用户 2026-11-24 实测通过；补丁：`src/ui/stream-lines.ts` 修复流式叠字 + `tests/stream-lines.test.ts` 9 例，全量 204/204） |
| S2-8 | S2 全量验收 + 真实模型自主读 README 并总结 + tag `v0.1-s2` | ✅（typecheck 0 / tests 204/204 / help+version / mock 幂等 / build+dist 一致 / any 0 / TUI 冒烟 SMOKE OK / 6 工具 loop 演示 ALL TOOLS OK / 真实 API exit 0；真实模型 README 任务 2 工具 3 步 `README ACCEPTANCE OK`；tag 已 push） |
| S2 | 6 工具 + 工具注册表 + Agent Loop | ✅（tag `v0.1-s2` 已 push） |
| S3-1 | `src/safety/danger.ts` + `src/safety/permissions.ts`：危险命令识别（13 类 + 包装器剥壳）+ 权限三道闸（路径边界 → readOnly → 危险 → 白名单 → 审批）+ headless 只读规则 | ✅（`tests/danger.test.ts` 9 例 + `tests/permissions.test.ts` 18 例 + `tests/config.test.ts` headless 端到端 1 例，全量 232/232；B 级 5/6/8 已由用户 2026-11-24 实测通过） |
| S3-2 | `src/ui/approval.ts` + `src/ui/ApprovalPrompt.tsx`：y/a/n/Esc 交互审批、会话白名单、`awaiting_approval` 展示态 | ✅（`tests/approval.test.ts` 9 例，全量 241/241；假 stdin 审批冒烟 `APPROVAL SMOKE OK`；B 级 4 条已由用户 2026-11-24 实测通过） |
| S3-3 | `src/session/store.ts`：`.mewcode/session.json` 每轮保存 / 启动恢复 / `--new` / 损坏降级 | ✅（`tests/session.test.ts` 14 例 + `tests/config.test.ts` 3 例启动/恢复/损坏/`--new` 端到端，全量 258/258；B 级 2–5 已由用户 2026-11-24 实测通过） |
| S3-4 | `src/context/tokens.ts` + `src/context/compress.ts`：token 估算（CJK 1.1/字、其他 1/4、每条 +8、预算 ×0.7）+ 按轮压缩（system 常驻 / 最新轮必留 / 旧轮整轮丢弃 / 最新轮超预算截断 tool 2000·assistant 4000 / 去掉开头悬空 tool）；loop 增 `contextTokens`/`onCompress`，`MEWCODE_CONTEXT_TOKENS` 调窗口、`MEWCODE_DEBUG=1` 输出 `[压缩]` | ✅（`tests/compress.test.ts` 17 例 + `tests/loop.test.ts` 压缩接线 2 例，全量 277/277；B 级 2–4 已由用户 2026-11-24 实测通过） |
| S3-5 | S3 集成验收：全量回归 + 脚本化集成（50 轮压缩 / 会话重启恢复 / 审批拒绝后继续 / 危险命令硬拦）+ tag `v0.1-s3` | ✅（typecheck 0 / tests 277/277 / help+version / mock 幂等 / build+dist 一致 / any 0；TUI 冒烟 `SMOKE OK` / 审批冒烟 `APPROVAL SMOKE OK` / 6 工具 `ALL TOOLS OK`；脚本化集成 25 项断言 `INTEGRATION OK`；tag 已 push） |
| S3 | 权限确认 + 会话持久化 + 上下文压缩 | ✅（tag `v0.1-s3` 已 push） |
| S4-1 | `src/tools/diff.ts` 行级 unified diff + `edit_file` 输出 diff + `src/ui/diff-view.ts`/`HistoryItem` 红绿 diff 条目（带行号、最多 80 行）+ `src/errors.ts` 统一错误描述（HTTP/网络/中断/工具失败/超步数，均带「下一步」）+ headless 复用 | ✅（`tests/diff.test.ts` 9 例 + `tests/errors.test.ts` 4 例 + `tests/diff-view.test.ts` 5 例；ui/fs/tool-display 断言更新；全量 296/296；TUI 冒烟 `SMOKE OK`；B 级 3 条已由用户 2026-11-24 实测通过） |
| S4-2 | `README.md` 重写（定位/特性/环境要求/安装/配置/快速开始/命令与参数/架构图+数据流/目录结构/6 工具表/3 步加工具教程/权限与安全/会话与压缩/错误展示/测试与 CI/Windows 注意/已知限制与 Roadmap/文档索引）；`src/config.ts` 的 `--help` banner 改「（v0.1）」、`MEWCODE_SHELL` 说明更新 | ✅（A 级：仓库克隆到临时目录后仅照 README 跑通 `npm install`（52 包/4s）→ typecheck 0 → 296/296 → `--mock` 0 → build 0 → dist 0；B 级 3 条已由用户 2026-11-24 在另一台机器实测通过） |
| S4-3 | 打包与启动：`package.json` 增 `bin.mewagent=./dist/index.js` / `prepare`（HF-2 起；原 `prepack`）构建 / `files` 白名单；`src/index.ts` 加 shebang，直跑判断改用 realpath（修 junction 下静默退出） | ✅（`npm link` 后任意目录 `--version`/`--help`/`--mock --print` 0（含空格+中文路径）、`npx . --mock --print hello` 0、`npm unlink -g mewagent` 无残留、`npm pack` 77 项/230KB；`tests/packaging.test.ts` 5 例，全量 303/303；B 级 4 条已由用户 2026-11-24 实测通过） |
| hotfix | 用户级 `.env`（2026-11-24）：启动时先加载 `~/.mewcode/.env`（`MEWCODE_HOME` 可改目录）再加载项目 `.env`；缺 key/模型提示两处路径；优先级 shell 环境变量 > 项目 `.env` > 用户级 `.env` > 默认值 | ✅（`tests/config.test.ts` 35/35、全量 305/305、build 0；cc-safety-net 拦 `.env` 创建/读取，端到端已由用户 2026-11-24 实测通过） |
| HF-1 | 首启配置向导（2026-11-24，用户追加）：交互式缺配置时弹 3 步向导（base-url / 模型 / API key），可测试连接后保存到用户级 `config.json`（0600）；`--setup` 重跑、非 TTY 不弹；`src/setup/probe.ts` 连接测试；`resolveConfig` 第 4 参与新优先级 CLI > env > 用户 config.json > 默认 | ✅（`tests/setup.test.ts` 9 例 + `tests/user-config.test.ts` 6 例 + `tests/setup-wizard.test.ts` 10 例，全量 330/330（1 skip），build 0；E2E：无 cwd `.env` 时从用户级 `config.json` 读取 model/key/base-url；B 级 4 条已由用户 2026-11-24 实测通过） |
| HF-2 | 一键安装（2026-11-25，用户追加）：`scripts/install.ps1`/`scripts/install.sh`（Node ≥ 22、git clone 或 zip/tar.gz 回退、npm install/build、`npm pack` 后全局安装并清理旧 shim、`mewagent --version` 校验）；`package.json` 增 `repository`/`homepage`/`bugs`，`prepack`→`prepare`；README「一键安装」章节 + npm 备选命令 | ✅（A 级：两脚本本机对本地仓库端到端 exit 0、任意目录 `mewagent --version` = 0.1.0、`--mock` 正常、全局为真实目录拷贝；typecheck 0、全量 330/330、build 0；`tests/packaging.test.ts` 断言 `prepare` 且无 `prepack`；B 级 4 条待用户） |
| S4-4 | 10 条成功标准逐项验收 + 3 分钟演示 + 发布 v0.1.0：`docs/demo.md`（4 段演示脚本，README §7 与文档索引链接）；README 测试计数更新 30 文件/330 例；全量回归 + 真实 API 验收（首字时延/多工具/审批拒绝） | ✅（全量 330/330（329 pass + 1 skip）、typecheck 0、build 0、`--mock` 幂等、dist 一致、any 0、冒烟 `SMOKE OK`/`APPROVAL SMOKE OK`/`ALL TOOLS OK`；真实 API 首字 **1314ms**、3 次工具调用（4 轮 LLM）、审批拒绝原因回填；`INTEGRATION OK`；tag `v0.1.0` 已 push；B 级 4 条已由用户 2026-11-24 实测通过） |
| S4 | 打磨、文档、演示、发布 v0.1.0 | ✅（tag `v0.1.0` 已 push；10 条成功标准全部打勾，见 §3；发布后追加 HF-2 一键安装，2026-11-25） |

已知边界（v0.1）：

- 仅支持 OpenAI 兼容协议；不保证其他 provider 的差异字段。
- 无 MCP/插件扩展点；工具集固定 6 个。
- 会话压缩为启发式，不保证无损；超长对话可能丢失早期细节。
- 候选词数字键选字、alternate-screen 全屏 TUI 下的 IME 行为未在 S0 验证，S1 实测。
