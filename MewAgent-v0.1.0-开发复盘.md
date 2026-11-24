# MewAgent v0.1.0 开发复盘

> 从「想做一个类 Claude Code 的 CLI Agent」到 v0.1.0 发布，这个项目在 2026-11-23 ~ 11-24 两个自然日里，用 **34 个会话、96 次提交** 走完了调研、选型、方案、实现、测试、发布。
>
> 这份文档不是 API 手册，而是一次「施工回放」：当时怎么想、为什么这样拆、每一步怎么验收、哪里踩了坑、如果重来会改什么，以及你可以怎样复现。
>
> **适合**：自己复习 / 讲给别人听 / 照着重做。
> **配套**：`HANDOFF.md`（会话流水）、`docs/spec.md`（规格）、`docs/tasks.md`（任务看板）、`docs/testing.md`（测试手册）、`docs/demo.md`（演示脚本）。

---

## 0. 怎么读这份文档

| 你的目的 | 建议阅读 |
|---|---|
| 10 分钟了解全貌 | §1 → §4 → §7 |
| 学技术设计 | §3、§5、§6 |
| 照着复现 | §10，再配合 `README.md` 与 `docs/testing.md` |
| 准备面试 / 向别人介绍 | §11 + §9 的数字 |
| 了解当时怎么排计划 | §2、§3、§4 |

---

## 1. 结果先行：v0.1.0 是什么

**一句话**：MewAgent 是运行在终端里的个人版 Coding Agent。你用自然语言提需求，模型自己决定读文件、搜代码、改文件、跑命令；写操作和命令执行前必须经过你批准；改完能看到红绿 diff；退出再进能接着聊；对话太长会自动压缩。

### 1.1 现在能做什么

- **流式对话**：回复逐字出现，生成中可 `Esc` 中断，`Ctrl+C` 退出；等待时还能输入下一句排队。
- **6 个工具**：`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`bash`。
- **Agent Loop**：模型连续调用多个工具完成任务，最多 30 步，终止条件是「这一轮不再调用工具」。
- **权限三道闸**：路径边界 → 危险命令硬拦 → 人工审批（`y` 本次 / `a` 本会话同类 / `n` 拒绝）；拒绝原因会回填给模型，模型可以换个方式继续。
- **会话恢复**：每轮保存到 `.mewcode/session.json`，重启提示「已恢复 N 条消息」。
- **上下文压缩**：按「用户轮次」丢弃旧对话，保留 system 与最新轮；50 轮对话不爆上下文。
- **TUI 体验**：工具调用有 `✅/❌` 历史、参数摘要和耗时；`edit_file` 显示带行号的红绿 diff；错误统一写成「发生了什么 + 下一步」。
- **两种入口**：交互 TUI，或 `--print` headless（适合脚本/CI）。
- **离线可玩**：`--mock` 不需要 API key，两轮固定剧本演示完整链路。
- **一条命令启动**：`mewagent`（`npm link`）或 `npx .`；首次启动还有 3 步配置向导。

### 1.2 数字快照

| 指标 | 数值 |
|---|---|
| 版本 / 仓库 | `v0.1.0` / <https://github.com/zcslack17858645276-del/MewAgent>（2026-11-24 起公开） |
| 开发周期 | 2026-11-23 ~ 2026-11-24，两个自然日 |
| 会话 / 提交 | 34 个会话 / 96 次提交 |
| 任务 | 计划 29 个 + 追加 1 个（HF-1 首启向导） |
| 阶段 tag | `v0.1-s0` → `v0.1-s1` → `v0.1-s2` → `v0.1-s3` → `v0.1.0` |
| 源码 | 38 个文件，约 6,855 行（含空行） |
| 测试 | 30 个文件，约 5,574 行，**330 个用例（329 通过 + 1 skip）** |
| 运行时依赖 | 3 个：`ink 8.0.0`、`react 19.3.1`、`ink-text-input 6.0.0`（该包已不实际使用，仅保留便于回退） |
| 开发依赖 | 4 个：`typescript 7.0.2`、`tsx 4.23.15`、`@types/node`、`@types/react` |
| CI | GitHub Actions（Ubuntu + Node 22）：typecheck + test；发布时全绿 |
| 真实 API 验收 | 首字 **1314ms**；3 次工具调用 / 4 轮 LLM；审批拒绝原因成功回填 |

### 1.3 它明确不是什么

v0.1 不做：MCP、Skill、Hook、SubAgent、Git Worktree、Agent Teams、桌面 GUI、多会话管理、LLM 摘要式压缩。
这些不是「漏了」，而是首版主动砍掉的边界，理由见 §3.2。仓库里保留了扩展点，v0.2 可以逐步加。

---

## 2. 起点：为什么最后选了这条路

### 2.1 参考对象与真实约束

起点是 xiaolincoding 的 MewCode 课程项目——一个类 Claude Code 的 CLI Coding Agent，13 项能力、5 层架构、Java/Go/Python/TS 四个语言版本。但它是一个「完整课程项目」，而我们的约束是：

- 个人开发，不是团队；
- 主要跑 Windows；
- 希望 2~3 周能做出能日常用的首版；
- 目标不只是「跑起来」，还要能讲清楚每个设计（学习价值）。

所以问题不是「怎么复刻 13 项能力」，而是「**哪 8 项能力构成一个完整闭环，其余先不做**」。

### 2.2 调研阶段得到的四个关键判断

开工前做了开源项目盘点、TUI 框架对比、桌面框架对比（详见 `research/`）。真正影响决策的是这四条：

1. **TypeScript 是 CLI Coding Agent 的主流实现语言**，且 Claude Code、Codex、Copilot、Cline 等头部产品都采用「npm 薄壳 + 平台原生二进制」分发——说明「用 TS 写」和「做得专业」不冲突。
2. **TUI 正在换代**：Ink/Textual 之后，OpenTUI（Solid/React）在 opencode、Cline 等项目中兴起；但换代意味着生态还在动，首版不宜赌太新的框架。
3. **真正的技术瓶颈不在「终端画得快不快」**，而在三处：流式输出的高频 diff、中文 IME 的光标坐标、scrollback 所有权。选框架时要优先验证这三件事。
4. **跨端 GUI 是另一个战场**：省的是 UI 人力，不省分发（签名、SmartScreen、自动更新、公证）；对个人首版来说，CLI 是投入产出比最高的形态。

### 2.3 技术选型：为什么是 TypeScript + Ink

| 选择 | 理由 |
|---|---|
| TypeScript + Node ≥22 | 我最熟；生态最全；类型契约能把「模型层/工具层/UI 层」隔开；出错时编译期就能拦一批 |
| Ink 8 + React 19 | 用 React 组件模型写终端 UI，最快做出「消息列表 + 流式区 + 输入框」；社区案例多，遇到问题能搜到 |
| 原生 `fetch` + 手写 SSE | 只需支持 OpenAI 兼容协议；不引 LangChain / AI SDK，核心链路 300~500 行就能控制住，调试和教学都更透明 |
| 单 Agent Loop | 首版不做多 Agent 编排；一个循环 + 6 个工具已经能完成「读→想→改→验」闭环 |
| `node:test` + `tsx` | 零额外测试框架依赖；`tsx` 直接跑 TS，开发反馈快 |

**反方风险也提前想了**：Ink 的中文 IME 在社区里有 issue，Claude Code 自己也踩过 CJK 输入问题。所以方案里写死一条：**S0 第一件事先做 IME spike；判定不过就换 Go + Bubble Tea**。

结果：spike 判定 A——中文能正常输入、退格正常、候选框位置略偏但可接受（详见 `spikes/RESULT.md`）。这条风险被提前关掉，后面 30 多个会话没有再为「要不要换语言」分心。

### 2.4 为什么不用 LangChain

这是后来被明确问过的问题，答案也写进了选型逻辑：

- 本项目真正需要的只有三件事：**OpenAI 兼容流式请求、`tool_calls` 聚合与循环、上下文/会话管理**；
- 这三件事手写约 300~500 行，换来完全可控的流式中断、工具调用配对、权限闸门和错误提示；
- LangChain 的价值在「多模型/多向量库/RAG/追踪/复杂图编排」，v0.1 一个都用不上；引入后反而多一层版本与调试成本；
- 结论不是「不用库」，而是「**核心循环自研，周边成熟轮子照用**」。`LlmClient` 留了适配口，未来要换 SDK 或加 LangGraph 不必重写核心。

---

## 3. 规划：把「做一个 Agent」翻译成可执行任务

### 3.1 先拆架构，再谈选型

课程里的 5 层架构被简化成一条清晰的边界：

```text
交互层（Ink TUI / headless）
        │  AgentEvent（单一事件流）
引擎层（Agent Loop：模型 ↔ 工具 的循环）
        │
工具层（registry + 6 tools）── 安全层（路径 / 危险命令 / 审批）
        │
记忆层（session JSON + 上下文压缩）
```

关键判断：**语言和框架的选择只影响「交互层 + 运行时」；引擎、工具、安全、记忆的本质是协议与状态机，换语言也要重写一遍。** 所以选型不需要纠结「哪个语言更高级」，只需要问「哪个组合能最快把闭环做稳」。

### 3.2 范围裁剪：P0 只留 8 项

| 保留（P0） | 砍掉（P1/P2） |
|---|---|
| 流式多轮对话 | MCP 工具接入 |
| 6 个核心工具 | Skill 技能包 |
| Agent Loop | Hook 机制 |
| 简化 3 级权限 + 审批 | SubAgent / Agent Teams |
| 基础 TUI（历史/流式/审批/diff） | Git Worktree 隔离 |
| CLI 入口（`--mock` / `--print`） | 多会话管理 |
| JSON 会话持久化 | 桌面 GUI |
| 按轮上下文压缩 | LLM 摘要压缩、图片/多模态 |

> 说明：原 P0 清单里的 `/help`、`/clear`、`/model` 三个 slash 命令在 v0.1 没有实现（全仓无引用），已移入 v0.2 候选；上表按实际交付列出。

原则：**先做「能安全地改真实代码」的最小闭环，再谈能力扩展。** 一个不能安全写文件的 Agent 功能再多也不可用；一个能安全改代码的 Agent 已经能每天用。

### 3.3 五阶段拆分

| 阶段 | 目标 | 任务数 | 计划估时 | 完成标志 |
|---|---|---|---|---|
| S0 骨架与契约 | 工程能跑、契约定死、离线 mock、CI | 6 | 0.5–1 天 | `v0.1-s0`，39 测试 |
| S1 流式对话 + 最小 TUI | SSE、OpenAI 客户端、Ink TUI、headless | 6 | 2 天 | `v0.1-s1`，104 测试 |
| S2 工具 + Agent Loop | 路径安全、注册表、6 工具、循环、UI 事件 | 8 | 3 天 | `v0.1-s2`，204 测试 |
| S3 权限 + 会话 + 压缩 | 三道闸、审批 UI、会话恢复、上下文压缩 | 5 | 2–3 天 | `v0.1-s3`，277 测试 |
| S4 打磨与交付 | diff/错误、README、打包、发布验收 | 4 + HF-1 | 2 天 | `v0.1.0`，330 测试 |

每个阶段都有一个硬性出口：**全量 typecheck + 全量测试 + 手工验收 + tag**。阶段没过，不进入下一阶段。

### 3.4 任务颗粒度：一个 task 就是一次会话

29 个任务平均 2~5 小时，每个任务都必须有：

1. 一句可验收的完成标准（例如「`../` 与绝对越界均拒绝」）；
2. 对应的测试小节（在 `docs/testing.md` 里）；
3. 独立的提交（task 分支 → squash 进 main）；
4. 收尾时更新看板与 HANDOFF。

这样做的好处是：**任何一次会话都可以独立开始、独立结束、独立回滚**；坏处是任务切换成本高，所以每个任务都尽量围绕一个文件或一个机制。

### 3.5 测试手册：把「AI 自测」和「人验收」分开

`docs/testing.md` 是一份 127KB 的手册，为 29 个任务逐条写测试步骤，并分三级：

- **A 级（自动化）**：AI 跑，`npm test` / 脚本 / 冒烟；
- **B 级（手工）**：只能由用户在真实终端做，例如中文输入、流式观感、审批交互、真实 API；
- **C 级（回归）**：阶段收尾时重跑。

优先级分 P0/P1/P2。这个设计解决了一个真实问题：**模型自测能覆盖代码层，但覆盖不了「中文 IME 候选框在哪」「流式有没有闪烁」「审批弹窗是否抢焦点」**。把这些明确交给人，既诚实，也避免「测试全绿但体验是坏的」。

### 3.6 工程规则：让下一个人（或下一个 AI）能接手

- `HANDOFF.md`：每次会话结束记录「做了什么 / 提交号 / 当前可运行状态 / 坑 / 下次第一步」，新会话第一件事读它。
- `AGENTS.md`：所有 AI 代理的统一规则（开工顺序、技术栈、边界、DoD、红线）。
- `docs/tasks.md`：唯一任务看板，状态 `todo → doing → done`。
- `docs/spec.md`：规格与十条成功标准；`docs/checklist.md`：验收清单与发布清单。
- Git：任务分支 → push → squash 进 `main` → push；阶段打 annotated tag；主分支永远可运行。
- CI：Ubuntu + Node 22，`npm ci → typecheck → test`，push 即跑。

### 3.7 风险预案

| 风险 | 预案 |
|---|---|
| Ink 中文 IME 不可用 | S0 第一件事 spike；不行就转 Go + Bubble Tea |
| 范围蔓延 | P0 清单锁死；新增能力必须先写进 v0.2 候选 |
| Windows 环境坑 | 所有命令/编码问题当场记录进 HANDOFF，测试优先用可注入依赖规避 |
| 真实 API 费用/不稳定 | 全链路先走 `--mock`；真实 API 只做少量验收 |
| 会话中断丢上下文 | HANDOFF + 任务看板 + 每轮 session 落盘 |

---

## 4. 执行全景：34 个会话是怎么走的

### 4.1 阶段时间线

| 日期 | 阶段 | 会话 | 关键结果 | tag |
|---|---|---|---|---|
| 11-23 | 调研/方案/建仓 | 1 | 选型报告、个人版计划、TS 实施方案、GitHub 仓库 | — |
| 11-23 | S0 | 2–8 | 工程骨架、契约、CLI、mock、文档、CI | `v0.1-s0`（39 测试） |
| 11-23 | S1 | 9–14 | SSE、OpenAI 客户端、Ink TUI、headless | `v0.1-s1`（104 测试） |
| 11-24 | S2 | 15–22 | 路径安全、注册表、6 工具、Loop、UI 事件 | `v0.1-s2`（204 测试） |
| 11-24 | S3 | 23–27 | 三道闸、审批、会话、压缩、集成验收 | `v0.1-s3`（277 测试） |
| 11-24 | S4 + 热修 | 28–34 | diff/错误、README、打包、配置向导、发布 | `v0.1.0`（330 测试） |

### 4.2 测试数增长曲线

```text
S0   39  ███
S1  104  ████████
S2  204  ████████████████
S3  277  ██████████████████████
S4  330  ██████████████████████████
```

这条曲线比「代码行数」更能说明项目的健康度：**每加一层能力，都有一批新测试托底**，而不是最后一次性补。

### 4.3 一个会话的标准流程

1. 读 `HANDOFF.md`（状态 + 上次交接 + 坑）；
2. 核对 `git status`、`main` 与远端同步、tag 是否存在；
3. 读 `docs/tasks.md` 认领一个 task（`todo → doing`）；
4. 读 `docs/testing.md` 对应测试小节；
5. 先给实现计划（复杂任务先等用户确认）；
6. 写代码 + 测试，跑 `npm run typecheck && npm test`；
7. 按手册做 A 级验收，把 B 级项留给用户在真实终端确认；
8. 提交 → push → squash 合并 → 更新看板/HANDOFF → 阶段末打 tag。

### 4.4 计划 vs 实际：哪些对上了，哪些变了

**对上的**：阶段顺序、任务边界、验收方式、tag 节奏。29 个任务全部按计划完成，没有把 P1 功能偷偷塞进 v0.1。

**变了的**：

- **追加了 2 个热修 + 1 个新任务**：Node < 20.12 的 `.env` 兼容、用户级 `.env` 支持，以及首启配置向导（HF-1）；另外把仓库转为公开。这些都是用户真实使用后暴露的需求，属于「计划外的正确」。
- **测试数比预期多**：计划只写「每个 task 有测试」，实际做到了 330 例、30 个文件。
- **文档量比预期大**：`docs/testing.md` 127KB、`spec` 34KB、`checklist` 25KB。好处是交接和复现成本低，代价是维护量大（见 §7.2）。

**要特别说明的**：计划里的「10–15 天」是**人类独立开发的估时**；这次是 AI 结对 + 用户验收，实际两个自然日完成。两者不能直接比较。如果你自己从零重写，仍建议按 2~4 周准备（见 §10）。

---

## 5. 逐阶段复盘

### 5.1 S0：先定契约，再写功能

**做了什么**：工程初始化、Ink 中文 IME spike、`src/types.ts` 核心契约、`config.ts`/`index.ts`、离线 mock、AGENTS/spec/checklist/CI。

**关键设计**：

- `types.ts` 里定了 7 类契约：`Message`（四分支判别联合）、`ToolCall`、`ToolResult`、`ToolDefinition`、`LlmClient`、`Gate`、`AgentEvent`。后面 30 个会话几乎没人改过契约——**先定协议，后面所有模块都围着它长**。
- `ToolCall.arguments` 故意保留为**原始 JSON 字符串**，由注册表负责解析；这样模型给坏 JSON 时，错误收敛点只有一处。
- `Gate` 只做「判断」不弹 UI：拒绝必须返回可回填模型的 `reason`。这让权限层和 TUI 解耦。
- IME spike 用真实 GUI 注入，而不是模拟：中文组合期 Ink 收不到事件，但选词上屏、退格、ASCII 基线都正常；候选框在输入框下方 3~4 行，可接受。判定 A，继续 TS。

**踩的坑**：

- 本机只有 Windows PowerShell 5.1（无 pwsh 7）：无 BOM 的 UTF-8 `.ps1` 会按 GBK 解码，脚本里只写 ASCII；
- PowerShell 下 `"你好" | npm run dev -- --print` 会把 `--print` 当成 npm 参数（`EUNKNOWNCONFIG`），要用 `cmd /c` 或直接跑 `node`；
- 一次 squash 提交标题被 `Set-Content` 写出 BOM，`git log` 看不见但确实存在——此后提交消息统一用 write 工具生成无 BOM 文件 + `git commit -F`；
- `--print` 无条件读 stdin，导致测试子进程永不 EOF 挂死；修复为「有 prompt 就不读 stdin」。

**验收**：39 个测试、`--help`/`--version`/`--mock --print` 幂等、build + dist 一致、CI 绿。tag `v0.1-s0`。

### 5.2 S1：把「模型说的话」变成「屏幕上流动的字」

**做了什么**：SSE 解析、OpenAI 流式客户端（含 `tool_calls` 聚合）、system prompt/消息转换、Ink TUI、headless 真实 API。

**关键设计**：

- SSE 解析器只负责「字节流 → 每条 `data:` 字符串」，不做 JSON 解析；分块、CRLF、多行 data、注释、`[DONE]`、BOM、UTF-8 多字节切断都覆盖。**协议层保持纯粹，业务层才好测**。
- `tool_calls` 按 `index` 聚合：`id`/`name` 只取首次非空，`arguments` 累加，结束时按 index 排序；缺 id 用 `call_<index>` 占位。这是流式工具调用最容易写错的地方。
- TUI 用 `<Static>` 放「已提交历史」（不重绘），动态区只渲染正在流式的文本；50ms 节流合并重绘。后来长输出叠字问题也是靠「完整行立即进 Static、未完成尾巴只留 ≤800 码点」修掉的（S2-7 补丁）。
- 输入框最后是自研的多行 `InputBox`：粘贴保留换行、`Shift+Enter` 换行（Kitty 协议）、`Ctrl+J` 兜底。`ink-text-input` 在中文/多行场景不够用。

**踩的坑**：TS 对 `AbortSignal.aborted` 的收窄导致重复比较报 TS2367；假 stdin 必须实现 `_read()`；向假 stdin 写「文字+回车」要分两次 `push`，否则 Ink 当成整段粘贴；PowerShell 5.1 下 npm 的管道会吞参数。

**验收**：104 个测试；真实 API `--print` 中文回复、401/网络错误可读且不泄露 key；TUI 8 条手工项由用户验收。tag `v0.1-s1`。

### 5.3 S2：给 Agent 装上手，也装上「不越界」的护栏

**做了什么**：路径边界、工具注册表、文件/搜索/bash 工具、Agent Loop、TUI 工具事件。

**关键设计**：

- **路径唯一入口**：所有工具路径都走 `resolveInside`，两层校验——词法层拦 `..`/越界绝对路径；真实路径层用 `realpathSync` 找最近已存在祖先，拦 symlink/junction 逃逸。`%VAR%`、`~`、盘符相对路径一律拒绝，不做展开。
- **注册表 `run()` 永不抛异常**：未知工具、坏 JSON、非对象、工具抛错、返回非法结构，全部收敛成 `{ok:false, output:"Error: …下一步…"}`。模型能看懂错误并自我修正，Loop 不会因为一个工具崩掉。
- **每个工具有明确上限**：read 30KB、glob 200 条、grep 100 条、bash 30KB/120s、write 原子替换、edit 唯一匹配 + `replace_all` + CRLF 保真。
- **Loop 的两处有意偏差**：`maxSteps` 用尽不 throw，而是发 `turn_end("max_steps")` 正常返回（UI 要保留上下文）；Abort 收敛为 `turn_end("aborted")`，工具阶段中止时给剩余每个 `tool_call` 回填「已中断」，保证 assistant/tool 消息配对——否则下一轮 OpenAI 会 400。

**踩的坑**：

- **跨平台语义**：Windows 下 `..\x` 是越界路径，POSIX 下反斜杠是合法文件名字符。S2-1 和 S3-1 都因此让 CI 红过，修法是测试按 `process.platform` 分支、`toPosixPath` 只在 Windows 替换。
- `read_file` 字节截断时，续读 `offset` 原先按 `offset+limit` 算，会跳过未展示的行；改为按实际渲染的最后一行算。
- `cmd.exe` 下 Node 默认参数转义会把含 `;`/`(` 的命令拆坏，必须 `windowsVerbatimArguments: true`。
- 流式长输出向上滚动时同一段文字反复叠加：根因是动态区超过终端高度，旧帧无法清除。改为按行提交 Static + 尾巴限长。

**验收**：204 个测试；6 工具 loop 演示 `ALL TOOLS OK`；真实模型自主读 README 并总结 `README ACCEPTANCE OK`。tag `v0.1-s2`。

### 5.4 S3：安全、记忆与「不忘事」

**做了什么**：危险命令识别 + 权限三道闸、交互审批 UI、会话持久化、上下文压缩、集成验收。

**关键设计**：

- **权限顺序是固定的**：解析 arguments → 未知工具 → 路径边界 → 只读放行 → 危险命令硬拦 → headless 拒绝写 → 会话白名单 → `ask`。顺序错一个，就可能出现「先问用户、再发现越界」的糟糕体验。
- **危险命令先剥壳再判断**：`sudo`、`env`、`bash -c`、`powershell -Command` 等最多剥 4 层；13 类规则命中直接拒绝，不弹审批。安全默认是「宁可错拦」。
- **审批三键**：`y` 本次、`a` 本会话同类、`n`/`Esc` 拒绝；审批时输入框失焦，避免按键漏进输入框。
- **会话文件原子写**：先写 `.tmp` 再 `rename`；只存 user/assistant/tool，system 每次重建；坏 JSON 降级为「新会话」并提示，不崩。
- **压缩按轮整轮丢弃**：system 常驻、最新轮必留、旧轮从旧到新丢弃，保持 tool 配对；最新轮自身超预算时截断工具结果 2000 / assistant 文本 4000 字符。**v0.1 不做 LLM 摘要**，因为「整轮丢弃」行为可预测、可测试，先保证不爆上下文。

**踩的坑**：`PermissionGate` 是对象不是函数，传参写错类型；`git switch` 后 CRLF 规范化会让 edit 报「file changed since it was read」，要先 read 再改；token 估算的测试期望值算错（CJK 1.1、其他 1/4）；集成脚本首版 3 个断言过严/漏消息。

**验收**：277 个测试；脚本化集成 25 项断言全过（50 轮压缩、重启恢复、拒绝后继续、危险命令硬拦）；tag `v0.1-s3`。

### 5.5 S4：把「能跑」变成「能交付」

**做了什么**：diff 与统一错误、README 重写、打包与全局命令、Node 兼容热修、用户级配置、首启向导、十条标准验收与 demo。

**关键设计**：

- **diff 自己写**：剥公共前后缀 + LCS，超 25 万格退化整段替换；UI 按删除红/新增绿/hunk 青着色，最多 80 行。`edit_file` 成功后直接给 diff，而不是只说「已替换」。
- **错误统一为「发生了什么 + 下一步」**：HTTP 401/403/404/429/5xx、网络、中断、工具失败、超步数都有对应文案；TUI 与 headless 共用 `src/errors.ts`。
- **打包三件套**：`bin` + `prepack` + `files` 白名单；入口加 shebang；直跑判断从字面比较改为 `realpath` 比较——否则 `npm link`/`npx` 经 junction 启动时会静默 exit 0。
- **配置优先级**：CLI > 环境变量/`.env` > 用户 `config.json` > 默认；用户级 `.env` 和首启向导解决「全局安装后不在仓库目录就没有 key」的问题。

**踩的坑**：PowerShell 函数名 `Rd` 命中内置别名 `rd`，误删 `docs/tasks.md`（用 `git show HEAD:... >` 恢复）；`$home` 是只读自动变量，测试配置一度写到用户目录；ambient 用户 `config.json` 污染测试（修法：测试注入临时 `MEWCODE_HOME`）；POSIX 0600 断言在 Windows skip。

**验收**：330 个测试（1 skip）；十条成功标准全部 ✅；真实 API 首字 1314ms、3 工具/4 轮、审批拒绝回填；`INTEGRATION OK`、三项冒烟全过；tag `v0.1.0`。

---

## 6. 系统是怎么跑起来的

### 6.1 分层与目录

```text
src/index.ts                 入口：解析参数 / 装配置 / 分派 TUI 或 headless
  ├─ config.ts               CLI 解析、优先级、用户配置
  ├─ types.ts                全部公共契约
  ├─ errors.ts               错误 →「发生了什么 + 下一步」
  ├─ llm/                    sse.ts / openai.ts / mock.ts
  ├─ agent/                  loop.ts / prompt.ts / messages.ts
  ├─ tools/                  registry.ts / paths.ts / fs.ts / search.ts / bash.ts / diff.ts
  ├─ safety/                 danger.ts / permissions.ts
  ├─ context/                tokens.ts / compress.ts
  ├─ session/store.ts        会话 JSON
  ├─ setup/probe.ts          首启连接测试
  └─ ui/                     App / InputBox / HistoryItem / ApprovalPrompt / diff-view / SetupWizard
```

### 6.2 一次对话的完整生命周期

1. 用户输入 → `runAgent(messages, options)`；
2. Loop 先把消息压缩成「预算内的副本」，再调 `LlmClient.chat()`；
3. SSE 增量文本通过 `assistant_text` 事件推给 UI；
4. 模型返回 `tool_calls` → 每个调用先过 `Gate`（只读自动放行，写操作问用户）；
5. 工具结果作为 `tool` 消息回填，继续下一轮；
6. 某一轮没有 `tool_calls` → `turn_end(stop)`，UI 更新历史；
7. 每轮结束把完整历史写 session；
8. 用户中断 → `turn_end(aborted)`，已生成内容保留。

### 6.3 几个「为什么这样设计」

| 设计 | 为什么 |
|---|---|
| 单一 `AgentEvent` 事件流 | UI 只消费事件，不 import LLM/工具；mock 与真实链路共用同一套 UI |
| 工具只返回 `{ok, output}` | 成功/失败都当文本喂回模型；模型能读懂错误并重试 |
| 拒绝也要回填 `reason` | 让模型知道「为什么不行」，能换路径/换命令继续，而不是卡死 |
| session 只存对话，不存 system | system prompt 可随版本升级；避免旧提示词污染新会话 |
| 压缩只作用于「发给模型的副本」 | UI 历史与落盘会话保持完整，用户回看不会丢内容 |
| 每阶段打 tag | 任何阶段都能 `git checkout v0.1-s2` 得到可运行状态，方便对比与回滚 |
| 文档先于代码 | 契约、测试步骤、验收标准先写，写代码时不需要反复「猜要什么」 |

### 6.4 安全模型

- **路径安全**：所有文件工具走同一入口，两层校验（词法 + realpath），拒绝 `..`、越界绝对路径、环境变量展开、`~`、盘符相对路径、symlink/junction 逃逸。
- **命令安全**：13 类危险规则 + 包装剥壳；命中直接拒绝，不询问。
- **操作安全**：写文件/跑命令必须审批；headless 模式只允许只读工具。
- **密钥安全**：key 只从环境变量/`.env`/用户配置读；HTTP 错误信息里替换为 `[REDACTED]`；`--debug` 请求体不含 key。

---

## 7. 工程方法复盘：什么起作用了，什么有代价

### 7.1 真正起作用的七件事

1. **先定契约**：`types.ts` 定死后，LLM、工具、UI、权限可以并行开发，联调成本极低。
2. **先做致命风险 spike**：IME 一天内验证，避免「写了三周才发现中文不能输入」。
3. **任务小且验收明确**：每个 task 2~5 小时、一句验收、一个测试小节，避免「大任务烂尾」。
4. **测试分层**：A 级自动化保证代码正确，B 级手工覆盖体验，C 级回归保证阶段不倒退。
5. **文档即状态**：HANDOFF 让 34 个会话可以接力；tasks/spec/checklist 让「做到哪、还差什么」一目了然。
6. **CI 跨平台**：Ubuntu 跑测试，逼出了两处 Windows/POSIX 语义差异——本地全绿不代表跨平台正确。
7. **tag + 分支 + 可运行 main**：任何阶段都能回滚/对比；squash 让 main 历史清晰，任务分支保留原始提交。

### 7.2 付出的代价

- **文档维护量大**：`docs/testing.md` 127KB，每次实现调整都要同步；后期出现 HANDOFF 头部状态陈旧、需要专门审计修正。
- **流程开销**：每个 task 都要建分支、push、squash、回填哈希、更新看板；小改动也走完整流程，速度会慢。
- **B 级验收依赖用户**：中文体验、审批交互、真实 API 只能人验；用户不在时，任务只能停在「A 级通过」。
- **命名不统一**：仓库叫 MewAgent，历史文档仍写 MewCode；目录名 `MewCode` 与仓库名 `MewAgent` 不一致，靠 HANDOFF 解释。
- **一次交接提交被 revert**：会话 9 的交接条目提交后被撤销，留下 `Revert` 提交；提醒「交接文档也要走审查」。

### 7.3 如果重来一次，会改什么

1. **第一天就锁死产品名**（MewAgent），避免后面到处解释。
2. **状态只维护一处**：HANDOFF 头部、tasks 焦点、spec 阶段状态三处容易不同步；可以生成或只保留一处。
3. **跨平台测试从 S2 开始就本地跑一遍 Linux 语义**（或用 WSL），不要等 CI 红。
4. **文档瘦身**：测试手册按阶段拆文件，减少单文件体积与合并冲突。
5. **更早引入「真实使用」反馈**：用户级 `.env`、首启向导都是使用后才发现的；如果 S2 就做一次真实日常使用，能更早暴露。
6. **显式记录成本**：本次只验证了功能与质量，没有统计 token 费用；v0.2 可加成本基线。

---

## 8. 踩坑清单（按类别）

| 类别 | 现象 | 根因 | 修法 / 教训 |
|---|---|---|---|
| Windows 环境 | 脚本乱码、执行策略拦截 | PS 5.1 按 GBK 解码无 BOM UTF-8；`RemoteSigned` | 脚本只写 ASCII；`-ExecutionPolicy Bypass` |
| Windows 管道 | `"你好" \| npm run dev -- --print` 报 `EUNKNOWNCONFIG` | `npm` 是 `npm.ps1`，管道调用吞掉 `--` | 用位置参数或 `cmd /c` |
| 提交信息 | `git log` 标题前有不可见字符 | `Set-Content -Encoding UTF8` 写 BOM | 用 write 工具生成无 BOM 文件 + `git commit -F` |
| 测试挂死 | `npm test` 卡住 | `--print` 无条件读 stdin，子进程 pipe 不 EOF | 有 prompt 就不读 stdin |
| Ink / 假终端 | 冒烟测试不触发提交 | 一次 `push` 被当成整段粘贴；假 stdin 缺 `_read()` | 分两次 push；实现 `_read()` |
| 流式渲染 | 长输出向上滚动时文字叠字 | 动态区超过终端高度，旧帧进 scrollback | 完整行进 `<Static>`，尾巴限长 |
| 协议 | 工具调用流式聚合错乱 | 多分片 `arguments` 需要按 index 累加 | 按 index 聚合、id/name 只取首次、结束排序 |
| 协议 | 中断后下一轮 400 | assistant.toolCalls 与 tool 消息不配对 | 中止时为剩余每个 call 回填「已中断」 |
| 跨平台 | CI 红、本地绿 | Windows 反斜杠是分隔符，POSIX 是合法文件名字符 | 测试按平台分支；路径转换只在 Windows 做 |
| 跨平台 | 行尾被改、diff 抖动 | `core.autocrlf=true` + 文本编辑 | 提交前统一 LF；编辑大段文本用 `[IO.File]` + 正则 |
| 打包 | `mewagent --version` 静默退出 | `npm link` 经 junction 启动，字面路径比较失败 | 直跑判断改 realpath 比较 |
| 配置 | 测试读到本机真实配置 | ambient `~/.mewcode/config.json` 污染 | 测试注入临时 `MEWCODE_HOME` |
| 兼容 | 老 Node 启动报 `loadEnvFile is not a function` | Node < 20.12 没有该 API | 内置逐行 `.env` 解析兜底 + 文档说明 |
| 安全网 | `.env` 无法读写、命令被拦 | cc-safety-net 策略 | 不绕行；端到端验证交用户，或改用只读路径 |
| 工具内容 | `read_file` 续读跳行 | offset 按 `offset+limit` 算而非实际渲染行 | 按最后渲染行计算 |
| 命令执行 | `cmd.exe` 下含 `;` 的命令被拆坏 | Node 默认参数转义 | `windowsVerbatimArguments: true` |

---

## 9. 数据与证据

### 9.1 规模与质量

| 维度 | 数据 | 来源 |
|---|---|---|
| 提交 | 96 次（含文档回填） | `git rev-list --count HEAD` |
| 阶段 tag | 5 个 | `git tag` |
| 源码 | 38 文件 / 6,855 行 | `src/**/*.ts(x)` 统计 |
| 测试 | 30 文件 / 5,574 行 / 330 例（329 pass + 1 skip） | `tests/` 统计 + CI 日志 |
| 文档 | README 544 行；HANDOFF 656 行；spec 34KB；testing 127KB；checklist 25KB；demo 4KB | 文件统计 |
| 真实 API | 首字 1314ms；3 工具 / 4 轮；拒绝回填 | `docs/spec.md` §3、`docs/testing.md` S4-4 |
| 集成验收 | 25 项断言 `INTEGRATION OK` | `docs/testing.md` S3-5 |

### 9.2 十条成功标准（全部通过）

1. 流式回复可中断，首字 < 2s；
2. 6 个工具可用；
3. 多工具自主连续调用，能完成 3 步以上任务；
4. 写文件/执行命令前人工确认，拒绝原因回填；
5. 文件系统不越界 + 危险命令拦截；
6. 连续 50 轮不爆上下文；
7. 重启恢复最近会话；
8. Windows Terminal 中文输入输出不乱码；
9. 一条命令启动；
10. README 快速开始 + 测试 + 3 分钟演示。

逐条证据见 `docs/spec.md` §3 与 `docs/testing.md` S4-4。

### 9.3 能力 → 任务 → 代码 → 证据

| 能力 | 任务 | 核心文件 | 证据 |
|---|---|---|---|
| 流式对话与中断 | S1-1/2/4 | `llm/sse.ts`、`llm/openai.ts`、`ui/App.tsx` | `tests/sse.test.ts`、`openai.test.ts`、TUI 冒烟 |
| 6 工具 | S2-1~S2-5 | `tools/*` | `tests/paths/registry/fs/search/bash.test.ts`、`ALL TOOLS OK` |
| Agent Loop | S2-6 | `agent/loop.ts` | `tests/loop.test.ts`（19 例） |
| 权限与审批 | S3-1/2 | `safety/*`、`ui/ApprovalPrompt.tsx` | `tests/danger/permissions/approval.test.ts`、`APPROVAL SMOKE OK` |
| 会话恢复 | S3-3 | `session/store.ts` | `tests/session.test.ts`（14 例） |
| 上下文压缩 | S3-4 | `context/*` | `tests/compress.test.ts`（17 例）+ 50 轮集成 |
| diff 与错误 | S4-1 | `tools/diff.ts`、`errors.ts`、`ui/diff-view.ts` | `tests/diff/errors/diff-view.test.ts` |
| 配置与首启 | S4-3/HF-1 | `config.ts`、`setup/*`、`ui/SetupWizard.tsx` | `tests/setup/user-config.test.ts`、E2E |
| 发布验收 | S4-4 | `docs/demo.md` | 十条标准 + 真实 API 记录 |

---

## 10. 复现指南

### 10.1 路线 A：直接跑起来（5 分钟）

```powershell
git clone https://github.com/zcslack17858645276-del/MewAgent.git
cd MewAgent
npm install
npm run dev -- --mock --print "你好"    # 离线两轮，不需要 key
npm run dev                            # 交互 TUI（mock）
```

接真实模型（两种任选）：

```powershell
# 方式 1：项目级 .env
copy .env.example .env    # 填 MEWCODE_API_KEY / MEWCODE_MODEL

# 方式 2：首次启动向导（全局安装后推荐）
npm link
mewagent --setup
mewagent
```

然后跟着 `docs/demo.md` 走一遍 3 分钟演示。

### 10.2 路线 B：照着学（推荐给复习/复现）

阅读顺序（每一步都先看测试，再看实现）：

1. `src/types.ts` —— 先理解契约，尤其 `Message`、`ToolCall`、`AgentEvent`；
2. `src/llm/sse.ts` + `tests/sse.test.ts` —— 学「字节流 → 事件」的边界处理；
3. `src/llm/openai.ts` + `tests/openai.test.ts` —— 学 `tool_calls` 流式聚合；
4. `src/tools/registry.ts` + `paths.ts` —— 学「模型输入的唯一收敛点」与路径安全；
5. `src/tools/fs.ts` / `search.ts` / `bash.ts` —— 学工具如何把错误变成可读文本；
6. `src/agent/loop.ts` + `tests/loop.test.ts` —— 学状态机、终止条件、事件顺序；
7. `src/safety/permissions.ts` —— 学「先边界、再危险、最后问人」的顺序；
8. `src/context/compress.ts` —— 学按轮压缩与 tool 配对；
9. `src/session/store.ts` —— 学原子写与损坏降级；
10. `src/ui/App.tsx` —— 学 Static/动态区/节流/审批状态机；
11. `src/index.ts` —— 最后看入口，把前面所有模块串起来。

每个阶段的「自检点」：

- S0：能跑 `--mock --print` 两轮，类型契约无 `any`；
- S1：TUI 里中文输入正常、流式不闪、Esc 能中断；
- S2：能让模型连续调 3 个工具，工具报错不崩；`../` 被拒；
- S3：写文件弹审批、拒绝后模型能继续；50 轮不爆；重启恢复；
- S4：`mewagent --version` 一条命令可用；README 从零能跑通；十条标准逐条打勾。

### 10.3 路线 C：从零重写（建议 2~4 周）

最小垂直切片（先跑通再扩展）：

1. **契约 + mock 两轮**：先让「模型说 → 工具结果 → 最终文本」跑通，不接真实 API；
2. **SSE + OpenAI 客户端**：用假流测试，接真实 API 只做一次冒烟；
3. **一个工具（read_file）+ Loop**：先证明「模型能读文件并回答」；
4. **TUI**：Streaming + 输入框 + 中断；先不管 diff/审批；
5. **写工具 + 权限 + 审批**：这一层必须早做，否则「能改代码」不安全；
6. **session + 压缩**：长对话与恢复；
7. **diff/错误/打包/README**：交付体验。

每步都保持「typecheck + 测试 + 手工验收」三件套；不要等最后补测试。

### 10.4 自测题（检验是否真的理解）

1. 为什么 `ToolCall.arguments` 存原始 JSON 字符串，而不是解析后的对象？
2. 为什么 `Agent Loop` 的终止条件是「本轮没有 tool_calls」，而不是「模型说完成」？
3. 权限闸的顺序为什么是「路径 → 危险命令 → 人工」？调换会怎样？
4. 为什么压缩要「整轮丢弃」而不是删单条消息？
5. 为什么 TUI 的已提交历史要用 `<Static>`，流式区要节流？
6. 为什么 `edit_file` 要求唯一匹配，并提供 `replace_all`？
7. 为什么 `npm link` 后入口判断要用 realpath？
8. 为什么 headless 模式只允许只读工具？
9. 为什么会话文件要先写 `.tmp` 再 `rename`？
10. 如果要加 MCP，应该接在哪一层？为什么不该改 `Agent Loop`？

（答案都能在前面的章节和源码注释里找到。）

---

## 11. 怎么讲这个项目（面试/分享素材）

### 11.1 三句话版本

> 我用 TypeScript + Ink 写了一个类 Claude Code 的 CLI Coding Agent，支持流式对话、6 个工具、Agent Loop、权限审批、会话恢复和上下文压缩。
> 它最大的特点是把「模型能安全地改真实代码」这件事做完整了：路径两道校验、危险命令硬拦、写操作人工审批、拒绝原因回填模型。
> 项目 330 个测试、5 个阶段 tag、CI 全绿，真实 API 首字 1.3 秒，能连续 50 轮对话不爆上下文。

### 11.2 五个可以深挖的技术点

1. **流式工具调用聚合**：SSE 分块 + `index` 聚合 + 中断配对；
2. **Agent 安全模型**：路径 realpath 校验、危险命令剥壳、审批三键、headless 只读；
3. **上下文压缩**：按用户轮次整轮丢弃，保持 tool 配对，预算是「保险丝」；
4. **TUI 渲染**：Static/动态区、50ms 节流、长输出叠字修复、中文 IME；
5. **工程化**：契约先行、A/B/C 测试分级、HANDOFF 交接、阶段 tag、跨平台 CI。

### 11.3 常见追问

- **为什么不用 LangChain？** 核心只需三件事，手写 300~500 行更可控；周边库按需引入，核心契约不变。
- **为什么用 Ink？** React 模型最快做出 TUI；IME 风险已 spike 验证；备选 Go + Bubble Tea。
- **怎么保证安全？** 三道闸 + 工作区边界 + 危险命令硬拦 + headless 只读 + key 脱敏。
- **怎么测 TUI？** 假 stdin/stdout 驱动 Ink 冒烟 + 纯逻辑抽成函数单测 + 用户 B 级手工验收。
- **最难的部分？** 不是写功能，而是「流式/中断/配对」和「跨平台/环境坑」；这两类问题占了大部分调试时间。

---

## 12. 后续路线（v0.2 候选）

| 优先级 | 方向 | 说明 |
|---|---|---|
| 高 | LLM 摘要压缩 | 替代「整轮丢弃」，长对话保留更多语义 |
| 高 | 多会话管理 | `.mewcode/sessions/<id>.json` + `--resume` |
| 中 | Slash 命令 | `/help` `/clear` `/model`，含命令解析与帮助文本 |
| 中 | MCP 工具接入 | 官方 SDK，放工具层，不动 Loop |
| 中 | SubAgent | 单层子 loop 先自研（100~200 行），复杂图再考虑 LangGraph |
| 中 | npm 发布 | `npx mewagent` 零安装体验 |
| 低 | OpenTUI 迁移 | 等生态稳定后再评估，当前 Ink 够用 |
| 低 | 桌面 GUI | 核心已是本地库/服务，GUI 只是另一个客户端 |

依赖引入规则（沿用之前的讨论）：**核心自研、周边用库**；是否引入看五点——是否学习目标/差异化、是否侵入核心数据流、能否装在 adapter 后、成熟度/许可证/体积/安全、移除成本；先做 1 天 spike。

---

## 附录 A：34 个会话索引

| 会话 | 主题 | 结果 |
|---|---|---|
| 1 | 调研、方案、建仓 | 选型报告 + 实施方案 + 仓库 |
| 2 | S0-1 工程初始化 + IME spike | 判定 A，继续 TS |
| 3 | 测试手册 | `docs/testing.md` 526 行 |
| 4 | S0-2 核心契约 | `types.ts`，6 测试 |
| 5 | S0-3 配置与入口 | `config.ts`/`index.ts`，31 测试 |
| 6 | S0-4 离线 mock | 两轮剧本，39 测试 |
| 7 | S0-5 规则文档 + CI | AGENTS/spec/checklist/CI |
| 8 | S0-6 验收 + tag | `v0.1-s0` |
| 9 | S1-1 SSE 解析 | 13 例 |
| 10 | S1-2 OpenAI 客户端 | `tool_calls` 聚合 |
| 11 | S1-3 prompt/messages | 12 例 |
| 12 | S1-4 Ink TUI | 流式 + 多行输入补丁 |
| 13 | S1-5 headless 真实 API | 401/网络错误可读 |
| 14 | S1-6 验收 + tag | `v0.1-s1`，104 测试 |
| 15 | S2-1 路径边界 | 两层校验，CI 跨平台修复 |
| 16 | S2-2 工具注册表 | 永不抛异常 |
| 17 | S2-3 文件工具 | read/write/edit，CRLF |
| 18 | S2-4 搜索工具 | glob 200 / grep 100 |
| 19 | S2-5 bash | shell 选择/超时/编码 |
| 20 | S2-6 Agent Loop | 19 例，事件流 |
| 21 | S2-7 UI 事件 | 工具历史 + 叠字修复 |
| 22 | S2-8 验收 + tag | `v0.1-s2`，204 测试 |
| 23 | S3-1 权限三道闸 | 232 测试 |
| 24 | S3-2 审批 UI | `APPROVAL SMOKE OK` |
| 25 | S3-3 会话持久化 | 258 测试 |
| 26 | S3-4 上下文压缩 | 277 测试 |
| 27 | S3-5 集成验收 + tag | `INTEGRATION OK`，`v0.1-s3` |
| 28 | S4-1 diff 与错误 | 红绿 diff，296 测试 |
| 29 | S4-2 README 重写 | 仅照 README 跑通 |
| 30 | 热修 Node < 20.12 | 298 测试 |
| 31 | S4-3 打包与启动 | `npm link`/`npx`，303 测试 |
| 32 | 热修用户级 `.env` | 305 测试 |
| 33 | HF-1 首启向导 | 330 测试 |
| 34 | S4-4 十条验收 + tag | `v0.1.0` |

## 附录 B：文件地图

| 目录/文件 | 作用 |
|---|---|
| `src/index.ts` | 入口、参数、TUI/headless 分派 |
| `src/config.ts` | CLI 解析、配置优先级、用户配置 |
| `src/types.ts` | 全部公共契约 |
| `src/errors.ts` | 错误 →「发生了什么 + 下一步」 |
| `src/llm/` | SSE、OpenAI 客户端、mock |
| `src/agent/` | Loop、system prompt、消息格式转换 |
| `src/tools/` | 注册表、路径、文件、搜索、bash、diff |
| `src/safety/` | 危险命令规则、权限闸 |
| `src/context/` | token 估算、按轮压缩 |
| `src/session/` | 会话 JSON 读写 |
| `src/setup/` | 首启连接测试 |
| `src/ui/` | Ink 组件与纯逻辑 |
| `tests/` | 30 个测试文件 / 330 例 |
| `docs/` | spec/tasks/testing/checklist/demo/evidence |
| `spikes/` | IME spike 与一次性验证脚本（产物 gitignored） |

## 附录 C：文档索引

| 文档 | 用途 |
|---|---|
| `README.md` | 安装、配置、使用、架构、加工具教程 |
| `HANDOFF.md` | 会话交接、已定决策、Git 流程 |
| `MewCode-TS实施方案.md` | 施工图纸（契约、S0–S4、提示词、验收） |
| `MewCode-个人版实施计划.md` | 个人版范围与排期 |
| `docs/spec.md` | v0.1 规格与十条成功标准 |
| `docs/tasks.md` | 任务看板与验收 |
| `docs/testing.md` | 逐 task 测试手册（A/B/C） |
| `docs/checklist.md` | 验收清单与发布清单 |
| `docs/demo.md` | 3 分钟演示脚本 |
| `技术选型报告.md` | 开源盘点与语言/框架对比 |

## 附录 D：术语表

| 术语 | 解释 |
|---|---|
| Agent Loop | 「模型 → 工具 → 模型」的循环，直到模型不再调用工具 |
| Tool Call | 模型请求调用某个工具的结构化指令（名称 + JSON 参数） |
| SSE | Server-Sent Events，流式响应的文本协议 |
| Gate | 权限判断层：决定放行、拒绝还是询问用户 |
| Static | Ink 中不重绘的已提交历史区域 |
| IME | 输入法（中文/日文等）组合输入 |
| tool 配对 | assistant 的 `tool_calls` 与后续 `tool` 消息必须一一对应 |
| 整轮压缩 | 以「一个 user 轮次」为单位丢弃旧对话，保持工具配对 |

---

> 最后更新：2026-11-24 ｜ 对应版本：`v0.1.0`（tag `v0.1.0`）
> 如果这份文档与代码不一致，以 `main` 分支代码和 `docs/spec.md` 为准。
