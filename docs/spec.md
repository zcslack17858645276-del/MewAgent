# MewAgent v0.1 规格说明（spec）

> 状态：**S0 已完成并打 tag `v0.1-s0`；S1 进行中（S1-1 SSE、S1-2 流式客户端、S1-3 prompt 与消息转换、S1-4 Ink TUI 已完成，当前 S1-5 `--print` 接真实 API）**。CI 在 GitHub Actions 全绿，agent 用 `gh` CLI 独立复核。
> 来源：`MewCode-TS实施方案.md`（施工图纸）与已落地代码。契约以方案 §3.3 与 `src/types.ts` 为准；本文件与代码冲突时，以代码为准并回填本文件。
> 维护方式：每个阶段完成后，在「§13 阶段状态」与对应章节追加该阶段实际交付的「要什么 / 不要什么 / 验收 / 已知边界」。

## 1. 产品目标

一个跑在终端里的编程 Agent：**流式对话**、读写改文件、执行命令、动手前询问、重启恢复会话、`npm run dev` 一条命令启动；Windows Terminal 下中文输入输出不乱码。单人自用优先，代码保持可读、可测试、可维护。

## 2. 非目标（v0.1 明确不做）

MCP / Skill / Hook / SubAgent / Agent Teams / Git Worktree / 多模型路由 / 桌面 GUI / 团队协作 / 云同步 / 插件市场 / Plan 模式 / 自定义 slash 命令。

## 3. 成功标准（§1.4 十条，逐条可验收）

| # | 标准 | v0.1 目标 | 当前状态（2026-11-23） |
|---|---|---|---|
| 1 | 流式回复，可中断，首字 < 2s | 是 | 🔄 代码完成（SSE + OpenAI 客户端 + TUI 流式/中断已实现并有单测；真实 API 首字时延与手感待 S1-5 接线后复验） |
| 2 | 6 个工具可用：read/write/edit/glob/grep/bash | 是 | ⬜ 待 S2 |
| 3 | 多工具自主连续调用，能完成 3 步以上任务 | 是 | 🚧 mock 两轮链路已通（S0-4），真实执行待 S2 |
| 4 | 写文件与执行命令前必须人工确认，拒绝原因回填模型 | 是 | ⬜ 待 S3 |
| 5 | 文件系统不越界 + 危险命令拦截 | 是 | ⬜ 待 S2/S3 |
| 6 | 连续 50 轮不爆上下文 | 是 | ⬜ 待 S3 |
| 7 | 重启后恢复最近会话 | 是 | ⬜ 待 S3 |
| 8 | Windows Terminal 中文输入输出不乱码 | 是 | ✅ 输入已验证（S0-1 判定 A）；输出随 TUI 在 S1 复验 |
| 9 | 一条命令启动 | 是 | ✅ `npm run dev` |
| 10 | README 快速开始 + 测试 + 3 分钟演示 | 是 | 🚧 S0-5 起草文档，S4 完成演示 |

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
tests/                # node:test；当前 core/types/config/mock/sse/openai/messages/prompt/ui/input-text 十个文件
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

### 5.2 环境变量

```dotenv
MEWCODE_API_KEY=       # 必填（--mock 外）；只从环境读取，不进命令行、不打印
MEWCODE_BASE_URL=      # 可选，默认 https://api.deepseek.com
MEWCODE_MODEL=         # 可选；真实模式必填（如 deepseek-chat）
MEWCODE_SHELL=         # 可选，覆盖 bash 路径（S2 bash 工具使用）
```

优先级：**CLI 参数 > 环境变量 > 默认值**；`.env` 通过 Node 内置 `process.loadEnvFile` 加载（不引第三方依赖）。空字符串视为未设置。

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

真实 API：交互 TUI 已在非 mock 下调用 `createOpenAiLlmClient`（S1-4）；`--print` headless 的真实 API 接线属 S1-5，当前非 mock 的 `--print` 只打印占位说明。

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

## 8. 上下文与会话（S3）

- 压缩策略：按**用户轮次**淘汰最旧的历史，保留 system + 最近轮次；触发阈值按估算 token（§6.3）。
- 压缩后不可丢失当前轮次的工具调用/结果配对。
- 会话文件：`<workspace>/.mewcode/session.json`（已 gitignore）；`--new` 强制新会话；启动时默认恢复最近会话。

## 9. TUI（S1）

- 状态机：`idle | streaming | tool_running | awaiting_approval | error`（S1-4 已实现 `idle | streaming`，其余随 S2-7/S3-2 接入）。
- 历史用 Ink `<Static>` 渲染；流式文本按 50ms 节流重绘；`Esc`/`Ctrl+C` 中止当前请求。
- S1-4 实现：`src/ui/App.tsx`（输入框 + Static 历史 + 流式动态区 + 错误行 + 排队）、`src/ui/InputBox.tsx`（自研受控多行输入，纯逻辑在 `src/ui/input-text.ts`）、`src/ui/throttle.ts`（可注入时钟的 50ms 合并）、`src/ui/HistoryItem.tsx`、`src/ui/start-tui.tsx`、`src/ui/width.ts`（中英混排列宽）；`send` 函数注入（S2 换成 AgentEvent 事件源）；`exitOnCtrlC:false`，生成中 Ctrl+C 只 abort、空闲退出。
- 输入框（S1-4 补丁）：Enter 发送、**Shift+Enter 换行**（Kitty 键盘协议；终端不支持时 **Ctrl+J** 兜底）、粘贴多行保留换行、方向键/Home/End 编辑；中文 IME 判定 A（可输入、退格整字删除，候选框位置略偏可接受）。`ink-text-input` 已被替换（依赖暂留）。
- mock 慢速流式（S1-4 补丁）：`MEWCODE_MOCK_DELAY_MS` 控制块间延迟，便于手工观察流式/Esc/中断；默认 0 与真实行为一致。
- 终端要求 Windows Terminal；conhost 不做保证。

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

## 12. 测试与验收

- 自动化：`npm run typecheck` + `npm test`（node:test），CI 在 ubuntu-latest / Node 22 跑同样三条命令。
- 手工：`docs/testing.md` 按 task 分 A/B/C 级；P0 未过不得标 done。
- 发布前逐条勾选 `docs/checklist.md`。

## 13. 阶段状态（2026-11-23）

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0-1 | 工程初始化 + Ink 中文 IME spike（判定 A，继续 TS） | ✅ |
| S0-2 | `src/types.ts` 契约定稿（无 any 逃逸） | ✅ |
| S0-3 | `src/config.ts` + `src/index.ts` CLI 骨架（help/version/缺 key/非 TTY） | ✅ |
| S0-4 | `src/llm/mock.ts` + `--mock --print` 离线两轮 | ✅ |
| S0-5 | AGENTS.md / CLAUDE.md / docs/spec.md / docs/checklist.md + CI | ✅（Actions 3 runs 全绿，证据 `docs/evidence/s0-5-ci-actions.png`） |
| S0-6 | 全量验收 + tag `v0.1-s0` | ✅（typecheck 0 / tests 39 / help+version / mock 幂等 / build+dist；tag 已 push） |
| S1 | SSE + OpenAI 兼容客户端 + Ink TUI | 🔁 进行中（S1-1 ~ S1-4 完成，当前 S1-5） |
| S2 | 6 工具 + 工具注册表 + Agent Loop | ⬜ |
| S3 | 权限确认 + 会话持久化 + 上下文压缩 | ⬜ |
| S4 | 打磨、文档、演示、发布 v0.1.0 | ⬜ |

已知边界（v0.1）：

- 仅支持 OpenAI 兼容协议；不保证其他 provider 的差异字段。
- 无 MCP/插件扩展点；工具集固定 6 个。
- 会话压缩为启发式，不保证无损；超长对话可能丢失早期细节。
- 候选词数字键选字、alternate-screen 全屏 TUI 下的 IME 行为未在 S0 验证，S1 实测。
