# MewAgent v0.2 实施方案（plan）

> 状态：草案（2026-11-26）｜适用基线：v0.1.0（冻结锚点 `v0.1.0-final` → `8bd74fb`）
> 配套文档：[tasks.md](./tasks.md)、[testing.md](./testing.md)、[playbook.md](./playbook.md)、[checklist.md](./checklist.md)
> 阅读顺序：先看 §1 一页结论，再看 §3 范围与 §6 关键决策；动手前读 tasks 与 testing。

---

## 1. 一页结论

v0.1.0 已经是一个"能跑通完整闭环"的个人 CLI Coding Agent：流式对话、6 个内置工具、Agent Loop、三道权限闸、会话持久化、上下文压缩、红绿 diff、headless 模式、npm link 全局命令，330 个自动化测试全绿。

v0.2 不再扩"大而全"，只做五件事，把 v0.1 从"能演示"推进到"能日常用、能安装给别人用、能接外部工具"：

| # | 功能 | 一句话价值 | 主要风险 |
|---|---|---|---|
| 1 | **LLM 摘要压缩** | 长对话不再"整轮丢掉"，保留目标/决策/文件线索 | 摘要成本与失真 |
| 2 | **多会话管理** | 一个工作区可保留多个会话，`--resume` 随时接上 | 旧数据迁移 |
| 3 | **Slash 命令** | `/help` `/clear` `/model` 不离开键盘就能操作 | 中文 IME 下输入 `/` |
| 4 | **MCP 工具接入** | 接社区 MCP server，工具能力不再写死在仓库里 | 子进程、安全、体积 |
| 5 | **npm 发布** | `npx mewagent` 零安装体验，版本可回滚 | 包名、2FA、发布事故 |

**不做**：多模型路由/fallback、SubAgent、Skill/Hook、Agent Teams、Git Worktree、桌面 GUI、OpenTUI 迁移、远程 MCP（HTTP/SSE）、图片多模态。

**预计**：24 个 task，业余每天 2–3 小时约 3–4 周；冲刺模式 10–14 天。阶段 tag：`v0.2-s1` … `v0.2-s4`，最终 `v0.2.0`。

---

## 2. 起点、目标与成功标准

### 2.1 起点（v0.1.0 事实）

| 项 | 数值 |
|---|---|
| 发布点 | tag `v0.1.0` → 提交 `3cdf699`；收尾锚点 `v0.1.0-final` → `8bd74fb` |
| 规模 | `src/` 38 个文件约 6,855 行；`tests/` 30 个文件约 5,574 行 |
| 测试 | 330 例：329 pass + 1 skip（无失败） |
| 会话/task | 34 个会话、29 个 task + 1 个计划外 HF |
| 运行依赖 | 仅 3 个：ink 8.0.0 / react 19.3.1 / ink-text-input 6.0.0 |
| 已知限制 | 单会话、压缩只丢弃、网络错误不重试、`child.kill` 不杀进程树、无 MCP/Slash |

### 2.2 目标

1. **更长的对话可用**：同样的上下文预算下，保留更多"之前做过什么、为什么"。
2. **一个工作区多个任务**：修 bug、写功能、临时提问可以分开保存，随时切回。
3. **常用操作不打断心流**：清楚当前模型、清空上下文、看帮助，都不需要退出重开。
4. **工具可扩展**：接 MCP server 就能多出工具，核心 Loop 不改。
5. **可分发**：任何人有 Node 22 就能 `npx mewagent` 跑起来；发布可验证、可回滚。

### 2.3 v0.2 成功标准（12 条，逐条可验收）

| # | 标准 | 验收方式 |
|---|---|---|
| 1 | 长对话（≥60 轮）触发压缩后，仍能复述早前目标与关键决策 | B 级手工：固定剧本 + 提问 |
| 2 | 摘要压缩失败时自动回退到 v0.1 丢弃策略，本轮不失败 | A 级：mock LLM 抛错 |
| 3 | 摘要结果落盘，重启后不重复摘要同一批旧轮 | A 级：重启后检查摘要调用次数 |
| 4 | `.mewcode/sessions/` 下多会话可列出、恢复、新建；旧 `session.json` 自动迁移 | A 级 + B 级重启 |
| 5 | `--resume` 无参数时出现选择器；`--resume <id>` 直接进入；`--list` 非交互输出 | A 级解析 + B 级 TUI |
| 6 | `/help` `/clear` `/model` 可用；未知命令有提示且不发给模型 | A 级执行器 + B 级 TUI |
| 7 | `/model` 切换后下一轮真的用新模型；会话文件记录新模型 | A 级 + B 级真实 API 冒烟 |
| 8 | 至少一个真实 MCP stdio server 能列出工具并调用成功 | B 级：filesystem server |
| 9 | MCP server 启动失败/崩溃不影响本地 6 工具与对话 | A 级：fixture 崩溃 |
| 10 | MCP 工具默认仍走权限闸；headless 下默认拒绝 | A 级集成测试 |
| 11 | `npm pack` 产物在干净临时目录可安装并 `--mock --print` 跑通 | A 级脚本 + B 级 npx |
| 12 | v0.1 的 330 例回归全绿，且新增测试总数 ≥ 420 | A 级 `npm test` |

---

## 3. 范围与验收

### 3.1 LLM 摘要压缩

**问题**：v0.1 的压缩是"按 user 轮整轮丢弃"，长任务里早前的需求、文件名、已否决方案会丢，模型容易重复犯错。

**做法**：滚动摘要。保留最近 2 个 user 轮原文；更早的轮次交给同一模型生成结构化摘要（目标、约束、已做决定、涉及文件、未完成项），与上一版摘要合并；摘要作为一条 `system` 消息注入请求，但**不写进消息历史**（存 session 的 `summary` 字段）。

**验收**：60 轮剧本后能答出"我们为什么不用 LangGraph""权限闸的顺序"；摘要缓存命中时一轮对话不额外调用模型。

### 3.2 多会话管理

**问题**：v0.1 每个工作区只有一份 `session.json`，`--new` 会把旧会话覆盖掉。

**做法**：`.mewcode/sessions/<id>.json` + `sessions/index.json`；id 形如 `20261126-143005-a1b2`；`--resume`（无参数弹选择器 / 带参数直接进）、`--list`、`--new`；旧 `session.json` 首次启动自动迁移并保留备份。

**验收**：同一工作区建 3 个会话，标题/时间/消息数正确；重启后能恢复指定会话；迁移后旧消息完整。

### 3.3 Slash 命令

**问题**：v0.1 想清空上下文只能重启加 `--new`，想看当前模型只能看启动 banner。

**做法**：在 TUI 输入层识别以 `/` 开头的整行；纯函数解析 + 执行器；`/help` 帮助与快捷键、`/clear` 清空当前上下文并开新会话、`/model` 查看/切换模型。生成中拒绝执行，避免与流式状态打架。

**验收**：三条命令可用；`/model deepseek-chat` 后下一轮请求体 model 改变；未知命令只显示提示。

### 3.4 MCP 工具接入

**问题**：v0.1 的工具写死在 `src/tools/`，加一个工具要改代码、发版。

**做法**：只支持 stdio MCP server；配置文件 `.mewcode/mcp.json`；启动时连接、`tools/list`、把每个工具适配成 `ToolDefinition`（命名 `mcp__<server>__<tool>`），注册进现有 `ToolRegistry`；Loop、权限闸、UI 事件全部复用。服务器失败只降级，不影响本地工具。`MEWCODE_MCP=0` 可整体关闭。

**验收**：接 `@modelcontextprotocol/server-filesystem`，模型能调用 `mcp__filesystem__read_file`；server 崩溃后本地工具仍可用；退出后无残留子进程。

### 3.5 npm 发布

**问题**：现在只能 `npm link`，别人用不了；`private: true` 挡住发布。

**做法**：`private: false`、确认 license（建议 MIT）、`files` 收敛、`prepublishOnly` 强制 typecheck+test+build、版本 0.2.0；`npm pack --dry-run` 检查内容与体积；发布后 `npx mewagent@0.2.0 --mock --print` 验证。

**验收**：干净目录 `npx --yes <tarball> --mock --print "你好"` 成功；`npm view mewagent version` 为 0.2.0；发布失败有 deprecate/unpublish 预案。

---

## 4. 非目标（v0.2 明确不做）

| 不做 | 原因 | 何时考虑 |
|---|---|---|
| 多模型路由/失败回退 | 当前单模型足够；先把压缩与工具做扎实 | v0.3 以后，且先做 1 天 spike |
| SubAgent / Agent Teams | 单层子 loop 才 100–200 行，但不是 v0.2 的瓶颈 | v0.3 |
| Skill / Hook / Slash 插件化 | Slash 先做内置三条，插件机制等真实需求 | v0.3 |
| Git Worktree 隔离 | 单人开发，分支已够用 | 多 Agent 并行时 |
| 远程 MCP（HTTP/SSE） | stdio 覆盖 90% 本地场景，安全模型更简单 | 有远程需求时 |
| 图片/多模态 | 会牵动 Message 契约与 UI，收益不匹配当前阶段 | 单独设计 |
| 自动重试/断线续传 | 先记录限制，不引入隐式行为 | 有稳定复现的需求 |
| 桌面 GUI / OpenTUI | Ink 在中文 Windows 上已够用；GUI 是另一个客户端项目 | v0.3 评估 |

---

## 5. 架构影响

### 5.1 分层（v0.2）

```
┌─────────────────────────────────────────────────────────────┐
│ 入口层 src/index.ts                                          │
│  CLI 解析 · 配置 · 会话选择 · 模型控制器 · 启动 TUI/headless   │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
┌───────────────▼──────────────┐  ┌───────────▼───────────────┐
│ 交互层 src/ui/               │  │ MCP 层 src/mcp/（新增）     │
│  App · InputBox · commands   │  │  config · client · adapter │
│  只消费 AgentEvent           │  │  适配成 ToolDefinition     │
└───────────────┬──────────────┘  └───────────┬───────────────┘
                │                             │
┌───────────────▼─────────────────────────────▼───────────────┐
│ 引擎层 src/agent/loop.ts                                     │
│  messages → 压缩（可注入）→ LLM → tool_calls → gate → run    │
└───────┬───────────────────┬───────────────────┬─────────────┘
        │                   │                   │
┌───────▼───────┐  ┌────────▼────────┐  ┌───────▼─────────────┐
│ 上下文压缩     │  │ 工具层           │  │ 安全层               │
│ compress +     │  │ registry + 6 工具│  │ permissions/danger   │
│ summarize(新)  │  │ + MCP 适配器     │  │                     │
└───────┬───────┘  └─────────────────┘  └─────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│ 记忆层 src/session/store.ts（v2：sessions/ + index + 摘要）  │
└─────────────────────────────────────────────────────────────┘
```

数据流关键点：

1. 会话恢复：`index.ts` → `loadSession` → `App(initialMessages)` → 每轮结束 `saveSession`（含 `summary`）。
2. 每轮请求：`loop` → `compress(messages, contextTokens)`（可能调 LLM 生成摘要）→ `llm.chat`。
3. 工具调用：`loop` → `registry.run`；MCP 工具只是 registry 里的另一个 `ToolDefinition`，gate/UI/事件不变。
4. Slash：`App.handleSubmit` 先 `parseSlash`；命中则本地执行，不进入 `runTurn`。

### 5.2 契约变更（`src/types.ts`）

| 契约 | v0.1 | v0.2 | 兼容性 |
|---|---|---|---|
| `Message` | 4 种 role | **不变** | 完全兼容 |
| `ToolCall` / `ToolResult` / `ToolDefinition` | 现有形状 | **不变** | MCP 适配器复用 |
| `AgentEvent` | 4 种事件 | **不变** | UI 不改事件模型 |
| `AgentLoopOptions` | `contextTokens?`、`onCompress?` | 新增 `compress?: CompressFn` | 可选，缺省走 v0.1 规则 |
| `CompressResult` | 位于 `context/compress.ts` | 增加 `summary?: string`、`strategy: "drop"\|"summary"`、`summarizedTurns: number` | 字段只增不改 |
| `SessionFile` | v1 单文件 | v2：`version: 2`、`id`、`title`、`summary?: string` | 读 v1 自动迁移 |
| `ToolSpec` | 现有 | **不变** | MCP 工具的 inputSchema 直接映射 |

新增类型（不放进 `types.ts` 的运行时模块）：

- `src/context/compress.ts`：`CompressFn = (messages, contextTokens, signal?) => Promise<CompressResult>`
- `src/session/store.ts`：`SessionMeta`、`SessionIndexFile`
- `src/ui/commands.ts`：`SlashCommand`、`SlashContext`、`SlashOutcome`
- `src/mcp/config.ts`：`McpServerConfig`、`McpConfigFile`

### 5.3 新增/改动模块

| 路径 | 动作 | 说明 |
|---|---|---|
| `src/context/summarize.ts` | 新增 | 摘要 prompt、滚动合并、长度控制、失败分类 |
| `src/context/compress.ts` | 改 | 增加摘要策略与 `createCompressor` 工厂；保留纯函数与常量 |
| `src/agent/loop.ts` | 改 | 支持注入异步 `compress`；abort 传给摘要调用 |
| `src/session/store.ts` | 改 | v2 存储、index、迁移、摘要字段 |
| `src/ui/commands.ts` | 新增 | slash 解析与执行（纯函数为主） |
| `src/ui/App.tsx` | 改 | 提交前拦截 slash；忙碌保护；提示入历史区 |
| `src/index.ts` | 改 | `--resume`/`--list`；模型控制器；MCP 启动/关闭；注入 compressor |
| `src/config.ts` | 改 | 新 CLI 参数、usage、MCP 配置路径 |
| `src/mcp/config.ts` | 新增 | 读取/校验 `mcp.json` |
| `src/mcp/client.ts` | 新增 | 连接、列出、调用、关闭、状态 |
| `src/mcp/adapter.ts` | 新增 | MCP 工具 → `ToolDefinition` |
| `src/tools/index.ts` | 改 | `createDefaultRegistry` 接受额外工具（MCP） |
| `package.json` | 改 | MCP 依赖、发布字段、脚本 |

### 5.4 兼容与迁移

- CLI：v0.1 的参数全部保留；`--resume`/`--list` 新增，不冲突。
- 配置：`.env` / 用户级 `config.json` 不变；MCP 用独立 `mcp.json`，避免污染现有配置。
- 会话：`.mewcode/session.json` 首次启动迁移到 `sessions/<id>.json`，原文件改名 `session.json.bak`；索引缺失时扫描重建。
- 包结构：`dist/index.js` 仍是 bin；新增模块都编译进 dist，无额外启动步骤。

---

## 6. 关键设计决策

> 格式：决策 → 理由 → 代价/边界。后续若推翻，必须补一条 ADR 并更新本节。

### D1 摘要用"滚动摘要"，不做"全量重摘要"

- **决策**：每次只把"新掉出保留窗口的旧轮"并入上一版摘要，生成新摘要。
- **理由**：全量重摘要在长对话里输入越来越大、成本不可控；滚动摘要在同样效果下输入稳定。
- **代价**：摘要会随时间"压缩失真"，早期细节可能只剩结论。用结构化模板（目标/约束/决策/文件/待办）缓解，并在测试里固定剧本检查关键事实。

### D2 保留最近 2 个 user 轮原文，预算仍按 70%

- **决策**：最近 2 轮不摘要；请求预算 = `contextTokens × 0.7`；摘要正文上限 2,000 字符。
- **理由**：最近一轮决定"下一步做什么"，上一轮常含用户修正；70% 预算给输出与工具结果留空间。
- **代价**：极长单轮仍会被截断（沿用 v0.1 的 2,000/4,000 字符上限）。

### D3 摘要失败必须回退，绝不让对话失败

- **决策**：摘要超时（默认 15s）、报错、返回空 → 记一条 debug 警告，回退 v0.1 的整轮丢弃，`strategy: "drop"`。
- **理由**：压缩是"优化"，不是"前置条件"；不能因为省 token 把主流程弄挂。
- **代价**：极端情况下上下文体感退回 v0.1。

### D4 多会话用"目录 + 索引"，索引可重建

- **决策**：事实来源是每个 `sessions/<id>.json`；`index.json` 只是加速列表，损坏/缺失时扫描目录重建。
- **理由**：索引与数据双写必然有不一致；把索引降级为缓存，数据就不会因索引损坏而丢。
- **代价**：会话很多时启动扫描变慢（v0.2 不做分页，超过 200 个再优化）。

### D5 会话 id 用本地时间 + 短随机

- **决策**：`YYYYMMDD-HHMMSS-<4hex>`，例如 `20261126-143005-a1b2`。
- **理由**：人眼可排序、可手写进 `--resume`；短随机避免同秒冲突。
- **代价**：跨时区/改系统时间可能乱序；列表仍按 `updatedAt` 排序。

### D6 Slash 命令放 UI 层，纯函数解析

- **决策**：`parseSlash` + `executeSlash` 不依赖 Ink；App 只在提交前调用；生成中直接拒绝。
- **理由**：可单测、可被将来 Web/GUI 复用；不污染 Agent Loop 与消息历史。
- **代价**：命令不能"排队到本轮之后"执行（v0.2 不需要）。

### D7 `/model` 只切运行时，不改用户配置

- **决策**：切换后重建 `LlmClient`，更新当前会话 `model` 字段；不写 `~/.mewcode/config.json`。
- **理由**：避免一次误输入永久改掉默认模型；想改默认值走 `--setup` 或 `--model`。
- **代价**：下次启动回到配置默认模型（会话文件里记录的是上次用的模型，恢复会话时以会话为准）。

### D8 MCP 只支持 stdio，命名加前缀，默认仍审批

- **决策**：`mcp__<server>__<tool>`；`readOnlyHint` 只用于展示与"可信只读"开关，默认不绕过 gate；`trustReadOnly` 默认 `false`。
- **理由**：MCP server 是第三方代码，默认信任等于把权限系统拆了；前缀避免与内置 6 工具重名。
- **代价**：接很多工具时审批会变频繁；用户可在 `mcp.json` 里对单个 server 开 `trustReadOnly`。

### D9 MCP 失败隔离：启动告警、单 server 失败不拖垮全局

- **决策**：每个 server 独立连接、独立超时（连接 5s、调用 60s）；失败的 server 标记 `failed`，工具不注册；UI 显示状态。
- **理由**：一个坏配置不能让整个 CLI 起不来。
- **代价**：用户可能没注意到某 server 没连上——启动 banner 与 `/help` 都要显示 MCP 状态。

### D10 发布先手动，自动化后置

- **决策**：v0.2.0 由维护者本机 `npm publish`；CI 只做 `pack --dry-run` 与测试，不持有发布 token。
- **理由**：首次发布要处理 2FA、包名、license 等一次性决策；自动化发布等流程稳定后再加。
- **代价**：发布依赖本机环境；用 checklist 固定步骤。

---

## 7. 阶段与排期

| 阶段 | 内容 | task 数 | 估时（业余） | 完成标志 |
|---|---|---|---|---|
| V2-0 | 基线、ADR、契约变更 | 3 | 0.5–1 天 | `docs/adr/0001-dependency-policy.md` + 基线回归记录 |
| V2-1 | LLM 摘要压缩 | 5 | 3–4 天 | tag `v0.2-s1` |
| V2-2 | 多会话管理 | 5 | 3–4 天 | tag `v0.2-s2` |
| V2-3 | Slash 命令 | 4 | 2–3 天 | tag `v0.2-s3` |
| V2-4 | MCP 工具接入 | 5 | 4–5 天 | tag `v0.2-s4` |
| V2-5 | npm 发布与收尾 | 5 | 2–3 天 | tag `v0.2.0` + npm 可见 |

合计 27 个 task（含 3 个准备/收尾），按每天 2–3 小时约 3–4 周；完整清单见 [tasks.md](./tasks.md)。

---

## 8. 依赖、成本与体积

| 项 | 决策 | 说明 |
|---|---|---|
| MCP SDK | `@modelcontextprotocol/sdk@1.32.2`（精确版本） | 2026-11-26 查询 npm 最新；engines >=18；间接依赖较多，V2-4-1 要记录 `npm ls` 与打包体积 |
| 摘要模型 | 复用当前 `LlmClient` | 不引入第二个供应商；摘要 prompt 约 1.5k 输入 + 300 输出 token，仅在触发压缩时产生 |
| LangChain/LangGraph | 不引入 | 沿用"核心自研、周边用库"；见 `docs/adr/0001-dependency-policy.md` |
| npm 包名 | `mewagent`（当前未注册，2026-11-26 查询 404） | 发布前再确认一次；被占用则回退 `@zcslack/mewagent` |
| license | 建议 MIT（当前 `UNLICENSED`） | 发布前由维护者拍板；改 license 要同步 README 与 package.json |
| Node | >=22（不变） | CI 固定 22，开发机 26 也可 |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 摘要失真导致模型重复犯错 | 中 | 高 | 结构化摘要模板；60 轮固定剧本回归；保留最近 2 轮原文 |
| 摘要调用让每轮变慢/变贵 | 中 | 中 | 只在超预算时触发；滚动合并；15s 超时回退；debug 打印调用次数 |
| 旧会话迁移丢数据 | 低 | 高 | 迁移前 `session.json.bak`；失败不删除源文件；迁移测试覆盖损坏文件 |
| slash 在中文 IME 下输入异常 | 中 | 中 | `/` 是 ASCII，风险低于中文候选；B 级手测；不行则提示用 `--new` 兜底 |
| MCP 子进程泄漏/孤儿 | 中 | 中 | 统一 `close()`；SIGINT/SIGTERM/exit 清理；fixture 测进程退出 |
| MCP server 携带恶意命令 | 中 | 高 | 默认审批；`trustReadOnly` 默认关；README 安全警告；不自动安装 server |
| npm 包名被抢/2FA 失败 | 低 | 中 | 发布前查询；备选 scope；发布 checklist 含失败回滚 |
| 范围蔓延（顺手做 SubAgent） | 高 | 中 | §4 非目标写死；新需求进 v0.3 候选，不在本阶段开工 |

---

## 10. 发布与回滚

- 版本：`0.1.0` → `0.2.0`（minor，新增功能，无破坏性变更）。
- 阶段 tag：`v0.2-s1`…`v0.2-s4`；发布 tag：`v0.2.0`。
- 分支：每个 task 从 `main` 开 `v2/<task-id>-<slug>`，PR squash 合并；发布前打 tag。
- 回滚：
  - 代码回滚：`git reset --hard v0.1.0-final`（或 `release/v0.1.0` 分支）。
  - npm 回滚：72 小时内可 `npm unpublish mewagent@0.2.0`；超过则 `npm deprecate` 并尽快发 0.2.1。
  - 会话回滚：v0.2 会迁移 `session.json`，但保留 `.bak`；降级回 v0.1 时把 `.bak` 改回 `session.json` 即可。
- 发布后验证：`npm view mewagent version`、干净目录 `npx mewagent@0.2.0 --mock --print "你好"`、GitHub Release 资产。

---

## 11. 验收清单（摘要）

完整版见 [checklist.md](./checklist.md)。发布前必须同时满足：

1. v0.1 的 330 例回归全绿，新增测试后总数 ≥420。
2. `npm run typecheck`、`npm run build`、`npm test` 全 0。
3. 12 条成功标准逐条有证据（A 级日志或 B 级记录）。
4. `npm pack --dry-run` 内容符合预期，包体积有记录。
5. README、CHANGELOG、HANDOFF、docs 索引全部更新。
6. tag `v0.2.0` 指向发布提交，`v0.1.0-final` 保持不动。

---

## 12. 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-11-26 | 初稿 | v0.2 启动；范围定为"精简版 + MCP"；不做多模型协同 |
