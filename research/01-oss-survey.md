# 01 · 开源 CLI Coding Agent 技术栈盘点

> 抓取日期：**2026-11-23**（Asia/Shanghai）。所有 star / 包体 / release 日期均为该日实测值。
> 证据分级：**[已验证]** = 直接读到仓库元数据或依赖清单（package.json / Cargo.toml / go.mod / pyproject.toml / requirements.txt，或 npm/pypi 注册表 manifest）；**[社区说法]** = 第三方逆向分析，未自证；**[推断]** = 由已验证证据推理得出。
> 写作目的：为"做一个 Claude Code 类终端 Coding Agent"提供选型依据，因此每个项目只保留**可迁移的架构决策**，不做功能罗列。

---

## 0. 结论先行（TL;DR）

1. **语言上没有共识，但有清晰分层**：头部项目呈 TypeScript（6 个）> Rust（3 个）> Python（3 个）> Go（2 个）分布；而**"分发层语言"与"实现语言"已解耦**——5 个顶级产品都改用「npm 薄壳 + 平台原生二进制」（Claude Code 壳 205KB、opencode 8KB、Codex 13KB、Copilot CLI 15KB、Cline CLI 17KB）[已验证]。
2. **TUI 框架正在换代**：老一代是 Ink/React（Gemini CLI、Qwen Code）与 Bubble Tea（Crush）、ratatui（Codex）、Textual（SWE-agent / Trae Agent）、prompt-toolkit+rich（Aider）；**新一代是 OpenTUI**（opencode 用 `@opentui/solid`，Cline / Codebuff 用 `@opentui/react`，Qwen Code 已把 `@opentui/*` 放进 devDeps 准备迁移）[已验证]。**若今天从零开始，TUI 选型要在 OpenTUI 与 Ink 之间决断，而不是凭记忆选 Ink。**
3. **MCP 已成标配而非卖点**：16 个项目里凡是 2026 年仍在发版的，全部接入 MCP；官方 SDK 成熟度排序 **TypeScript ≥ Rust > Python > Go**（Rust `rmcp` 已 53.7M 下载 / 74 个版本；TS 已进入 v2 双包时代）[已验证]。MCP **不是差异化点**，是入场券。
4. **架构分水岭是"有没有独立 server 层"**：Codex（`app-server` JSON-RPC + `codex exec --remote`）、opencode（Hono server + `opencode service`）、Qwen Code（`qwen serve` ACP + HTTP/SSE）、Cline（同仓库扩展/桌面/CLI/SDK 四产物）——**这些项目都做到了"同一 Agent 核心被 TUI / IDE / Web / 移动端复用"**。只做终端交互的项目（Aider、Crush）架构更简单，但天花板也更低。
5. **上下文压缩从"截断"变成一等公民**：Codex 有 `ThreadCompactStartParams` 协议方法，opencode 有默认开启的 background compaction，Goose 有 context-window viewer + auto-compaction 阈值，Cline 有 `/compact`，Claude Code 侧对应 `/compact` [已验证]。
6. **维护风险比技术差异更致命**：Aider（2026-02 后无 release）、Plandex（2025-10 停更）、Trae Agent（2026-02 停）、Roo Code（2026-05 停）、Amazon Q CLI（2025-11 停发版）——**"当年最火"不代表"现在可依赖"**。参见 §1 维护风险列。
7. **最值得参考的三个项目**：**Codex CLI**（工程上限：crate 化 + ratatui + app-server 三层）、**opencode**（产品形态最完整：client-server + OpenTUI/Solid + Effect + LSP/MCP/Code Mode）、**Crush**（最小可维护成本：Go 单二进制 + Bubble Tea v2 + 官方 Go MCP SDK）。理由见 §4。

---

## 1. 总览表（16 个开源/半开源项目 + Claude Code 参照）

| # | 项目 | 仓库 | ★@11-23 | License | 主语言 | TUI/GUI 框架 | 分发方式 | 最近 release | 近 12 月节奏 | 维护风险 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | opencode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | 228,668 | MIT | TypeScript(Bun) | **OpenTUI + SolidJS** | npm 薄壳+12 平台二进制 | v2.3.2 · 2026-11-18 | 2.x 近乎每日 | 低（但 4k+ open issues） |
| 2 | Codex CLI | [openai/codex](https://github.com/openai/codex) | 136,173 | Apache-2.0 | Rust | **ratatui + crossterm** | npm 薄壳+6 平台二进制 / curl / brew | 0.171.0 · 2026-11-20 | 每日多 alpha | 低 |
| 3 | Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | 109,009 | Apache-2.0 | TypeScript | **Ink（fork: @jrichman/ink 6.6.9）+ React 19** | npm 整包（98.5MB）/ brew / npx | 0.70.0 · 2026-11-19 | 每周 stable + 每日 nightly | **中高（产品转向企业）** |
| 4 | OpenHands | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 94,112 | MIT | TypeScript+Python | Web/Electron GUI | Docker / pip / 云 | 未抓 | 高（pushed 11-23） | 低（但非终端产品） |
| 5 | Cline | [cline/cline](https://github.com/cline/cline) | 71,836 | Apache-2.0 | TypeScript | CLI=**OpenTUI+React**；IDE=VS Code webview(React) | 四产物并行发版 | v4.1.27 / CLI 3.0.75 · 2026-11-21 | 每日 | 低 |
| 6 | Goose | [aaif-goose/goose](https://github.com/aaif-goose/goose) | 56,886 | Apache-2.0 | Rust | **rustyline + cliclack（非全屏 TUI）** | 单二进制 + Electron 桌面 | v1.60.2 · 2026-11-20 | 每周 1–2 次 | 低 |
| 7 | Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | 50,225 | Apache-2.0 | Python | **prompt-toolkit 3.0.52 + rich 14.3.3** | pip | v0.86.3.dev · **2026-02-12** | **停更** | **高（弃维护）** |
| 8 | Qwen Code | [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | 30,879 | Apache-2.0 | TypeScript | **Ink 7.0.3 + React 19（正在迁 OpenTUI）** | npm 整包(162.9MB)/brew/脚本 | 0.28.3 · 2026-11-21 | 高 | 低（Gemini CLI v0.8.2 fork，已独立） |
| 9 | Crush | [charmbracelet/crush](https://github.com/charmbracelet/crush) | 29,166 | **NOASSERTION/Other** | Go | **Bubble Tea v2.1.1 + Bubbles v2.2.1** | 单二进制（7 OS + deb/rpm/apk/cosign） | v0.102.0 · 2026-11-19 | 每周 + nightly | 低 |
| 10 | Roo Code | [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) | 24,239 | 未取证 | TypeScript | VS Code webview（React 18.3.1 + Radix + shiki） | VS Code 扩展 | 未抓 | **pushed 2026-05-15** | **中高（6 个月+无推送）** |
| 11 | SWE-agent | [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | 20,855 | MIT | Python | **Textual ≥1.0** | pip / Docker | v1.1.0 · **2025-05-22** | 研究型，发版极少 | 中（代码活跃、release 停滞） |
| 12 | Plandex | [plandex-ai/plandex](https://github.com/plandex-ai/plandex) | 15,930 | MIT | Go | 未取证（topics 含 terminal-ui） | 源码/单二进制 | 无新 release | **pushed 2025-10-03** | **高（停更 13 个月）** |
| 13 | Codebuff | [CodebuffAI/freebuff](https://github.com/CodebuffAI/freebuff) | 14,253 | 未取证 | TypeScript(Bun) | **OpenTUI 0.3.4 + React** | bun 编译单二进制 | CLI 1.0.0（pushed 11-20） | 中高 | 中（改名/重定位中） |
| 14 | Trae Agent | [bytedance/trae-agent](https://github.com/bytedance/trae-agent) | 12,215 | 未取证 | Python | **Textual ≥0.50** | pip / PyInstaller | v0.1.0 | **pushed 2026-02-05** | **高（9 个月无推送）** |
| 15 | Copilot CLI | [github/copilot-cli](https://github.com/github/copilot-cli) | 11,457 | Other/NOASSERTION | 闭源原生 | 未公开 | npm 15KB 壳 + 8 平台二进制 / brew / winget | 1.0.114 · 2026-11-18 | 高 | 低（但**非开源**，仓库仅 issue tracker） |
| 16 | Amazon Q CLI | [aws/amazon-q-developer-cli](https://github.com/aws/amazon-q-developer-cli) | 1,985 | Apache-2.0 | Rust | **自研 crossterm UI（`chat-cli-ui` crate）** | 单二进制 / brew / 安装脚本 | v1.19.7 · **2025-11-17** | **停发版（pushed 2026-08-24）** | **高** |
| — | *Claude Code（闭源，参照）* | *npm `@anthropic-ai/claude-code`* | — | "SEE LICENSE" | *闭源原生二进制* | *[社区说法] Ink/Yoga 血统* | *npm 205KB 壳 + 8 平台二进制* | *2.1.330 · 2026-11-20* | *2026 年内 500+ 版本，近月每 1–3 天一个 patch* | *不适用* |

> 备注：opencode 仓库已从 `sst/opencode` 迁移至 `anomalyco/opencode`；Goose 从 `block/goose` 迁移至 `aaif-goose/goose`；OpenHands 从 `All-Hands-AI/OpenHands` 迁移至 `OpenHands/OpenHands`；Codebuff 从 `CodebuffAI/codebuff` 更名为 `CodebuffAI/freebuff`。以上均为 GitHub 重定向后的 canonical 地址 [已验证]。

---

## 2. 逐项架构要点（只写可迁移的部分）

### 2.1 Rust 系：Codex / Goose / Amazon Q

**Codex CLI（openai/codex）** — 工程上限的参照物
- **TUI = ratatui + crossterm**，features 开了 `scrolling-regions` / `unstable-backend-writer` / `unstable-rendered-line-info` / `unstable-widget-ref`；配 `syntect`+`two-face` 高亮、`pulldown-cmark` 渲染 markdown [已验证 `codex-rs/tui/Cargo.toml`]。
- **真正的分层不是 TUI/核心两层，而是三层**：`tui` ↔ `codex-app-server-protocol`（JSON-RPC schema，含 `ThreadCompactStartParams`、`ApplyPatchApprovalParams`、`TurnDiffUpdatedNotification`、`ThreadTokenUsageUpdatedNotification`）↔ `codex-app-server-client` / `codex-app-server-daemon`。VSCode 扩展、`codex exec`、远程 TUI 全部走同一协议 [已验证]。
- crate 拆到极细：`codex-sandboxing`（平台沙箱：Windows sandbox service / Linux transparent TCP routing / macOS signer-service）、`codex-utils-approval-presets`（审批档位）、`codex-state`、`codex-rollout`、`codex-mermaid`、`codex-connectors`、`codex-plugin`、`codex-uds` [已验证]。
- 交互：`/statusline`（含自定义 MCP 扩展）、TUI workspace（文档预览、图片预览、subagent transcript 与主对话并列）、`/rc` + `/remote`（本地远程控制与设备配对码）[已验证 release notes]。
- **可借鉴**：①把「审批」「沙箱」「压缩」「diff 事件」全部下沉为协议消息而非 UI 逻辑；②crate 边界=团队边界；③同一 TUI 二进制既能本地跑也能当远程客户端。

**Goose（aaif-goose/goose）** — 反面参照：**没有全屏 TUI 也能做 Agent**
- **无 ratatui**。TUI 实际是 **rustyline 19（REPL 行编辑 + 历史）+ cliclack 0.5（交互式选择）+ console/indicatif/comfy-table/bat** 组合 [已验证 `crates/goose-cli/Cargo.toml`]。这意味着它走的是"REPL + 富文本输出"路线，而不是"全屏差分重绘"。
- 架构正在重构为 **GDK（Goose Development Kit）/ `oi-kit`**：把 Skill / SlashCommand / BangCommand / Steering / ToolExecution / ApprovalHook 拆成独立 operation crate；`goose-acp` 单独发布 [已验证 release notes，v1.58–v1.60 系列]。
- 上下文压缩：v1.60.1 明确"Compaction 时丢掉 Claude 模型拒绝的 `<analysis>` scratchpad"；v1.58.0 引入 context relevance operation、context-window 报告与查看器、阈值触发 auto-compaction [已验证]。
- MCP：deferred MCP tools、form elicitation、platform extensions 与 MCP runtime 分离、HTTP MCP header 环境变量 [已验证]。
- 分发：单二进制 + **Electron 45.2.3 桌面端**；`cargo` feature 开关极多（`code-mode` / `tree-sitter` / `local-inference`(cuda/vulkan/mlx) / `live-voice` / `otel` / `bundled-mcp` / `scheduler` / `acp-http`）[已验证]。**MSRV 因 rustyline 19 提升到 1.95.0**——依赖升级会直接抬 MSRV，是 Rust 项目长期维护的隐性成本。

**Amazon Q Developer CLI（aws/amazon-q-developer-cli）** — 已停止发版的教训
- **自研 crossterm UI 层（`chat-cli-ui` crate）+ rustyline + dialoguer + indicatif + syntect + spinners + similar(diff)**，无 ratatui [已验证 `crates/chat-cli/Cargo.toml`]。
- 权限模型细：`deny_by_default` 作用于 bash 工具、builtin tool namespace 级权限、危险命令模式拦截、`find -fls` 因安全原因禁用 [已验证 release notes]。
- MCP + `rmcp` + HTTP MCP header 环境变量支持；Rust 工作区分 `agent` / `chat-cli` / `chat-cli-ui` crate [已验证]。
- **风险判据**：release 停在 v1.19.7（2025-11-17），但仓库到 2026-08-24 仍有推送 → **"代码活着、产品已弃"** 是开源 Agent 的常见终局，选型时必须同时看 release 节奏与 pushed_at。

### 2.2 TypeScript 系：opencode / Gemini CLI / Qwen Code / Cline / Codebuff / Roo Code

**opencode（anomalyco/opencode）** — 产品形态最完整的开源实现
- **TUI = `@opentui/core 0.9.4` + `@opentui/solid 0.9.4` + `@opentui/keymap 0.9.4` + `solid-js 1.9.17`**——不是 Ink，也不是 Bubble Tea [已验证 root `package.json` v2.3.2]。
- 底座：**Effect-TS 4.1.0**（并发/资源/错误）、**Hono 4.13.13**（内嵌 server）、drizzle-orm + SQLite（会话持久化）、zod 4.6.7、shiki 4.4.3、`@pierre/diffs`、`@lydell/node-pty`、`@modelcontextprotocol/client@2.4.0`（MCP v2 客户端包，打了 patch）[已验证]。
- **client-server 架构是核心**：`opencode service get password`、`OPENCODE_TUI_CHANNEL`、`dev:desktop` / `dev:web` / `dev:site` → TUI 只是诸多前端之一 [已验证 scripts]。**Code Mode**（模型直接写 JS 程序批量调工具，含 bytecode VM 实验开关）是最激进的 Agent Loop 形态 [已验证 release notes]。
- 兼容策略值得抄：无 `AGENTS.md` 时读 `CLAUDE.md` 与 `~/.claude/CLAUDE.md`，`OPENCODE_DISABLE_CLAUDE_CODE` 可关；prompt 缓存优化把 GPT-6.2 的 uncached input 从 ~14,000 tokens/step 降到 3 [已验证]。
- npm 分发：8KB 壳 + 12 个平台包（含 `-baseline` CPU 变体与 musl 变体）→ 典型 Bun compile 产物特征 [推断]。

**Gemini CLI（google-gemini/gemini-cli）** — Ink 路线的最大样本，也是最大警示
- **TUI = Ink，但是 fork**：`"ink": "npm:@jrichman/ink@6.6.9"` + `react 19.2.4`；`@modelcontextprotocol/sdk 1.32.2`；`@agentclientprotocol/sdk 0.16.1`（ACP）；`@google/genai 1.30.0`；`highlight.js` + `lowlight`；`diff 8.0.3`；`fzf`；engines node>=20 [已验证 `packages/cli/package.json`]。**fork Ink 说明上游 Ink 满足不了大型 CLI 的性能/渲染需求**。
- 分发代价：npm 包 **unpackedSize 98.5MB**、fileCount 455、tarball 20.8MB，`bin` 直接指向 `bundle/gemini.js` [已验证]。
- **产品定位已变**：免费个人额度与 Google AI Pro/Ultra 于 **2026-06-18 迁移至 Antigravity CLI（`agy`）**；本仓库转为"企业 Code Assist 专用"，不再为 Gemini 4+ 优化 [已验证 npm README]。→ **技术选型可参考，产品路线不可模仿**。
- 能力面（可作 checklist）：MCP servers、`GEMINI.md` 上下文文件、checkpointing、token caching、sandboxing、trusted folders、`--output-format json|stream-json`、IDE 集成、Docker 沙箱镜像 `config.sandboxImageUri` [已验证]。

**Qwen Code（QwenLM/qwen-code）** — "fork 后独立演进"的最佳案例
- 源头是 **Gemini CLI v0.8.2 fork**，v0.1 起停止同步上游 → 现在已完全独立（SubAgents、Agent Teams、Agent Arena、Dynamic Workflows(JS)、Goals、Skills、Auto-Memory、Hooks、LSP、Plan Mode + 4 档审批、Sandbox、Git worktrees）[已验证 npm README]。
- TUI 仍是 **Ink 7.0.3 + React 19**，但 **devDeps 已出现 `@opentui/core 0.5.10` + `@opentui/react 0.5.10`** → 迁移已在路上 [已验证]。
- 多前端野心最大：终端 / Desktop / `qwen serve --open`（Web）/ VS Code / Zed / JetBrains / **10+ IM channels（telegram、feishu、wecom、weixin、dingtalk、email、github、gitlab、qqbot、webhook，各为独立 workspace 包）**；`qwen serve` 是 HTTP+SSE(ACP) daemon，默认 `127.0.0.1:4170` **无 bearer 认证**（README 自带风险提示）[已验证]。
- 分发代价最大：npm **unpackedSize 162.9MB**、fileCount 1,484、`dependencies:{}`（全 bundle）、optionalDeps 里塞了 `@oven/bun-*` 4 个平台包 [已验证]。**163MB 的 Node 包是 Ink 路线难以为继的直接证据**。

**Cline（cline/cline）** — 同仓库四产物并行
- CLI（`apps/cli`，`@cline/cli` 3.0.75）：**`@opentui/core 0.4.3` + `@opentui/react 0.4.3`** + react 19.2.4、`@agentclientprotocol/sdk 0.16.1`、`@clack/prompts`、commander 14、engines node>=22；devDeps 有 `@microsoft/tui-test` + `tuistory` → **TUI 自动化测试进了 CI** [已验证]。
- IDE 侧是 VS Code 扩展 + React webview；另有 Desktop（Electron）与 SDK（`@cline/{core,shared,llms,agents,ui}`）[已验证 release notes]。
- 交互：one-shot 默认 yolo（无人审批）、`--auto-approve`、plan mode、`/team` prompts、`Ctrl+O` Local/Cloud 切换、`Ctrl+K` 选 repo/branch、云端会话 [已验证]。
- **模型目录来自 `models.dev`，7,621 个模型 / 94 个 provider** —— 这是"多模型支持"最省力的实现方式 [已验证]。
- 坑：npm 上 `@cline/cli` 仍是 **0.0.13（EXPERIMENTAL，2026-05-07）**，来自另一个仓库 `cline/sdk`，bin 名 `clite` → **分发包落后于仓库 6 个月，说明 CLI 分发仍在早期** [已验证]。

**Codebuff（CodebuffAI/freebuff）**
- TUI = **`@opentui/core 0.3.4` + `@opentui/react 0.3.4`** + react ^19；`engines: {bun: 1.3.14}`，`build:binary` 用 Bun 编译单二进制 [已验证 `cli/package.json`]。
- 依赖 `@codebuff/sdk`（workspace）+ commander/zustand/pino → **SDK 与 CLI 同仓、CLI 极薄** 的典型结构。

**Roo Code（RooCodeInc/Roo-Code）**
- **只有 VS Code 扩展路线**：`webview-ui/package.json` = React 18.3.1 + Radix UI + `@vscode/webview-ui-toolkit` + tailwindcss 4 + mermaid + shiki + react-markdown + vite 6.3.6 [已验证]。无终端 TUI。
- 风险：**pushed 2026-05-15，已 6 个月无推送**。

### 2.3 Python 系：Aider / SWE-agent / Trae Agent

**Aider（Aider-AI/aider）** — 已停更，但架构最"纯"
- **TUI = prompt-toolkit 3.0.52 + rich 14.3.3**（+pygments）；核心是 `litellm 1.82.3`（统一模型层）、`tree-sitter-language-pack` + **`grep-ast`（repo map）**、`diskcache`、`gitpython`（自动 commit）、`typer`、`tiktoken`；browser 模式走 fastapi+starlette+watchfiles；还带语音（sounddevice/soundfile）与遥测（posthog/mixpanel）[已验证 `requirements.txt`]。
- `requires-python = ">=3.10,<3.15"` → **Python 版本上界是真实维护成本** [已验证 `pyproject.toml`]。
- **停更证据**：最新 release `v0.86.3.dev` @ 2026-02-12；pushed 2026-05-22 [已验证]。**不要再把 Aider 当活体参考**，但 repo map 与"每轮自动 commit"两个设计仍然值得抄。

**SWE-agent（SWE-agent/SWE-agent）** — Textual 路线 + 学术基准
- **TUI = Textual ≥1.0**（附 rich），核心 `litellm` + **`swe-rex >=1.4.0`（ACI 沙箱：把 shell 会话本身当工具）**；web 前端用 flask + flask-socketio；数据集走 `datasets` + `unidiff` [已验证 `pyproject.toml`]。
- release 停在 **v1.1.0 (2025-05-22)**，但仓库活跃到 2026-11-16 → **"研究仓库发版少"**，SWE-bench 分数从 release 与 README 取，不要拿发版节奏判断死活。
- 可借鉴：**ACI（Agent-Computer Interface）抽象**——把"能给 Agent 看的窗口化文件视图"做成可配置 tool bundle（`windowed` / `review_on_submit_m` 等），而不是硬编码 read/edit 工具。

**Trae Agent（bytedance/trae-agent）** — 已停滞的 Textual 样本
- **`textual>=0.50` + rich**、**`mcp==1.12.2`（官方 Python MCP SDK，锁死版本）**、`tree-sitter-languages` + `tree-sitter==0.21.3`、`pyinstaller==6.15.0`（PyInstaller 打包二进制）、openai/anthropic/google-genai/ollama 多 provider、click + asyncclick [已验证 `pyproject.toml`]。
- `requires-python >=3.12`；**pushed 2026-02-05，9 个月无推送** → 只作"Python 系如何接 MCP + 如何用 PyInstaller 分发"的样本。

### 2.4 Go 系：Crush / Plandex

**Crush（charmbracelet/crush）** — 单位人力产出最高的架构
- **TUI = `charm.land/bubbletea/v2 v2.1.1` + `bubbles/v2 v2.2.1` + `lipgloss/v2 v2.0.6` + `glamour/v2`（markdown 渲染）+ `ultraviolet`（终端渲染）+ `chroma/v2`（高亮）** [已验证 go.mod，`go 1.27.4`]。
- 模型层自研 `charm.land/fantasy v0.48.1` 抽象多 provider（anthropic-sdk-go / openai-go / genai / aws-sdk-go-v2 全接）；**MCP 用官方 `github.com/modelcontextprotocol/go-sdk v1.8.0`** [已验证]。
- 工具侧面：`go-git/v5`、`mvdan.cc/sh/v3`（shell 解析）、sqlite（modernc + ncruces）[已验证]。
- 分发是最大优势：**单二进制覆盖 Linux/Darwin/Windows/FreeBSD/NetBSD/OpenBSD/Android(apk) × 多架构 + deb/rpm/pkg.tar.zst + cosign 签名**，无 Node/Python 运行时 [已验证 release 资产]。
- 交互细节直接可抄：`shift+tab` 切权限档位（yolo / sysadmin 分档）、tool 计时、skills 开关、MCP channels（与 Claude Channels 同协议）、client-server 模式、prompt 可自定义（主/子 agent/planning/compaction/session 标题）[已验证 release notes]。

**Plandex（plandex-ai/plandex）**
- Go，topics 含 `terminal-ui`；**root `go.mod` 零依赖（只有 module 行）→ CLI 在独立子模块，TUI 框架无法从根模块取证** [已验证]。已停更 13 个月（pushed 2025-10-03），不再深入。

### 2.5 闭源/半开源对照：GitHub Copilot CLI

- 仓库 `github/copilot-cli` 只有 500KB，是 **issue tracker + 文档**，实现完全闭源 [已验证]。
- npm `@github/copilot@1.0.114`：**15KB 壳（`npm-loader.js`）+ 8 个平台包**（linux/win32/darwin × x64/arm64 + linuxmusl × 2），`deps: detect-libc`，`copilotRuntime.linuxOpenSSL: "system"` [已验证]。
- 产品面（可作需求基线）：默认模型 **Claude Sonnet 4.5**、`/model` 可切 Claude Sonnet 4 / GPT-5；**自带 GitHub MCP server 默认启用**；**LSP 支持**（`~/.copilot/lsp-config.json`、`.github/lsp.json`、`/lsp`）；`Shift+Tab` 循环模式含 Autopilot；另有 `ghcr.io/github/copilot-cli` 作 SDK 的 headless server [已验证 README]。

### 2.6 Claude Code（闭源，仅作参照）

- **当前形态是原生二进制**：`@anthropic-ai/claude-code@2.1.330` 的 `bin` 是 `bin/claude.exe`，**unpackedSize 仅 205KB、fileCount 7、`dependencies: {}`**（零运行时依赖），`postinstall: node install.cjs`，`engines: node>=22`，外加 **8 个平台 optionalDeps**（linux/win32/darwin × x64/arm64 + 2 个 musl）[已验证 `registry.npmmirror.com/@anthropic-ai/claude-code/latest`]。
- **历史形态是 Node bundle**：0.2.x–2.0.x 时代 `bin: cli.js`、fileCount 13、unpackedSize ≈32.4MB、tarball ≈12MB、engines node>=18、optionalDeps 仅 `@img/sharp-*` [已验证同一响应中的 versions/time]。
- → **结论：2026 年内完成了"JS bundle → 原生二进制 + 平台分包"的迁移**。这是本报告最重要的单一事实：**Claude Code 自己已经不靠 Node 跑**。
- TUI 技术栈官方从未公开。社区对其旧版 bundle 的逆向普遍认为基于 **Ink（React for CLI）+ Yoga 布局引擎**，并对其做了大量定制（自定义 reconciler、增量重绘、滚动区域）——**这些均为 [社区说法]，无 Anthropic 官方确认**，可引用：
  - <https://github.com/thtskaran/claude-code-analysis>（含 `01-architecture/ink-rendering-engine-deep-dive.md`、`terminal-ui-deep-dive.md`）
  - <https://github.com/jung-wan-kim/claude-code-reverse-engineering>
  - 用法建议：只把它当"如果做 Ink 路线会遇到哪些问题的清单"，不要当事实依据引用到对外文档。
- 发版节奏：2025-02 首发 → 2026-11-20 共 **500+ 个版本**；2026-10→11 约每 1–3 天一个 patch（2.1.317 11-02、2.1.321 11-09、2.1.323 11-12、2.1.326 11-16、2.1.327 11-17、2.1.328 11-18、2.1.329 11-19、2.1.330 11-20）[已验证]。

---

## 3. 横向结论

### 3.1 语言分布（16 个开源/半开源项目）

| 语言 | 数量 | 项目 |
|---|---|---|
| TypeScript / JS | 6 | opencode、Gemini CLI、Qwen Code、Cline、Codebuff、Roo Code（+ OpenHands 前端） |
| Rust | 3 | Codex CLI、Goose、Amazon Q CLI |
| Python | 3 | Aider、SWE-agent、Trae Agent |
| Go | 2 | Crush、Plandex |
| 闭源原生 | 1 | Copilot CLI（+ Claude Code 参照） |

- **TS 数量最多，但集中在"fork/克隆 Claude Code 形态"的阵营**（Gemini CLI → Qwen Code 的血缘链最典型）；**Rust 在 2026 年拿下最强三个产品位置**（Codex、Goose、Amazon Q），**Go 用最少代码拿到最好的分发体验**（Crush）。
- **没有"正确的语言"，只有"匹配的交付方式"**：要单二进制+免运行时 → Go/Rust；要最快堆功能+Web 前端复用 → TS；要做研究/评测 → Python。

### 3.2 TUI 框架分布

| 框架 | 项目 | 评价 |
|---|---|---|
| **OpenTUI**（`@opentui/{core,react,solid}`） | opencode(Solid)、Cline(React 0.4.3)、Codebuff(React 0.3.4)、Qwen Code(0.5.10 已进 devDeps) | **2026 年的上升者**，React/Solid 双绑定、自带 keymap；版本号还很小（0.3–0.9），API 未稳定 |
| **Ink + React** | Gemini CLI（fork `@jrichman/ink@6.6.9`）、Qwen Code（ink 7.0.3） | 生态最成熟但**体积代价高**（98MB / 163MB 包）；大项目会 fork |
| **Bubble Tea v2 + Lipgloss v2** | Crush | Go 生态唯一成熟答案，配 glamour 做 markdown、ultraviolet 做终端渲染 |
| **ratatui + crossterm** | Codex CLI | Rust 生态事实标准；精细控制（scrolling-regions、widget-ref） |
| **Textual** | SWE-agent、Trae Agent | Python 生态最完整；但两项目都不是高频交付产品 |
| **prompt-toolkit + rich** | Aider | 低成本、无全屏状态；适合 REPL 型 Agent |
| **rustyline + cliclack / 自研 crossterm** | Goose、Amazon Q CLI | "不是 TUI 的 TUI"：REPL + 交互式选择 + 富文本，**维护成本最低** |
| **VS Code webview (React)** | Cline、Roo Code | 只覆盖 IDE 场景，不是终端方案 |

关键判断：**TUI 框架的选择正在被"要不要多前端"倒逼**。凡是做了 client-server 的项目（Codex、opencode、Qwen Code、Cline），TUI 都退化成一个可替换的渲染客户端；只有单机单前端的项目才需要纠结框架本身。**对 MewCode 而言：先定"要不要 server 层"，再定 TUI 框架——顺序反了会白写一遍。**

### 3.3 MCP SDK 各语言成熟度（官方 `modelcontextprotocol/*`）

| 语言 | 包 | 版本@2026-11-23 | 成熟度信号 | 谁在用 |
|---|---|---|---|---|
| TypeScript | `@modelcontextprotocol/sdk` | 1.32.2（v1 维护线） | **已进入 v2 双包时代**：v2（2026-07-27 起 stable）拆为 `@modelcontextprotocol/server` + `@modelcontextprotocol/client`，支持 2026-07-28 spec；v1.x 承诺 v2 发布后至少 6 个月继续修 bug/安全；MIT，作者 Anthropic | Gemini CLI(1.32.2)、Qwen Code(^1.32.2)、opencode(`client@2.4.0` patched) |
| Rust | `rmcp` | 3.11.0 · 2026-11-17 | **累计下载 53,713,218、近期 31,618,898、74 个版本**、Apache-2.0、48,694 行、MSRV 1.88；2.0.0(2026-06-29)、3.0.0-beta.1(2026-07-23) 连续大版本；feature 覆盖 client/server、streamable-http、child-process transport、auth/OAuth | Codex CLI、Goose、Amazon Q CLI |
| Python | `mcp` | 1.12.2（被 Trae 锁定） | 生态在用但**本报告中未见一线产品作为主依赖**（Aider/SWE-agent 清单里都没有它） | Trae Agent |
| Go | `go-sdk` | v1.8.0 | 版本号仍低，但已是 Crush 的直接依赖，配 `streamable-http` | Crush |
| Java / C# | — | **未取证** | 本报告不作结论（避免无证据推断） | — |

- **对 MewCode 的含义**：如果主语言选 TS 或 Rust，MCP 接入是"照文档做"；选 Go 需要接受 SDK 还在 v1；选 Python 则要自己承担"官方 SDK 版本与上游 spec 的错位"（Trae 直接锁 `mcp==1.12.2` 就是这个信号）。
- **反向事实**：Rust 的 `rmcp` 下载量（53.7M）与 TS SDK 的版本号（1.32.2 / v2）共同说明 **MCP 已经是基础设施，不再有"我支持 MCP"的营销价值**。

### 3.4 分发方式对启动/安装体验的影响（实测包体）

| 分发形态 | 代表 | 安装体积 | Node 要求 | 启动/安装代价 | 备注 |
|---|---|---|---|---|---|
| **npm 薄壳 + 平台原生二进制** | Claude Code(205KB 壳/8 包)、opencode(8KB/12 包)、Codex(13KB/6 包)、Copilot CLI(15KB/8 包)、Cline CLI(17KB/6 包) | 壳极小，实际由 optionalDeps 决定 | 仅壳需 node（Claude Code 要 >=22） | **安装快、启动快**；但需解决 8–12 个平台的交叉编译、签名、musl/baseline 变体 | **2026 年的主流答案** |
| **单二进制 + 包管理器** | Crush、Goose、Amazon Q CLI、Codex(也提供) | 十几–几十 MB | **无** | 最快启动；brew/winget/apt 覆盖好 | Go/Rust 的天然优势 |
| **Node 整包 bundle** | **Gemini CLI 98.5MB**、**Qwen Code 162.9MB**（fileCount 1,484，`dependencies:{}` 全内联） | **百 MB 级** | node>=20 / >=22 | 安装慢、CI 缓存贵、**首屏启动受 V8 冷启动影响** | Ink 路线的直接代价 |
| **pip** | Aider、SWE-agent、Trae Agent | 中 | 需 Python（Aider 3.10–3.14） | 依赖解析慢、跨平台（Windows）体验差 | 研究/内部工具可接受 |
| **Docker / 云** | OpenHands、Gemini CLI 沙箱、Qwen Code 沙箱 | GB 级 | 无 | 首启最重，但隔离最好 | 适合"给 Agent 一个安全执行环境" |

**三个可直接落地的结论**：
1. **"用 TS 写"不等于"用户要装 Node"**——5 个头部产品证明了「TypeScript 编写 + Bun/其它编译成平台二进制 + npm 薄壳分发」是可行且已普及的组合 [推断，基于包结构]。
2. **包体大小是可观测的产品指标**：98MB(Gemini) / 163MB(Qwen) 与 8KB(opencode 壳)、205KB(Claude Code 壳) 的对比，说明 **bundle 一切** 的做法已经到极限。
3. **平台矩阵比语言更花时间**：opencode 12 个包（含 3 个 baseline + 2 个 musl）、Claude Code 8 个、Copilot 8 个 —— 这是必须提前排期的工程量，不是发版时才想的事。

### 3.5 最值得参考的 2–3 个项目

**① Codex CLI（openai/codex）——"架构上限"参照**
选它的理由不是 Rust，而是**它把 Agent 拆成了可远程、可嵌入的协议**：`codex-app-server-protocol` 里 `ThreadCompactStartParams` / `ApplyPatchApprovalParams` / `TurnDiffUpdatedNotification` / `ThreadTokenUsageUpdatedNotification` 这套 schema，正好是"上下文压缩 / 审批 / diff 流 / token 计费"四个最难的 UI 需求对应的**协议级答案** [已验证]。再叠加 `codex exec --remote`、`/rc`、sandbox 分层（Windows/Linux/macOS 三套独立实现），它是目前**唯一一个把"同一 Agent 供 TUI/IDE/远程/无人值守四种消费方式"全部跑通的开源项目**。**MewCode 应抄它的协议分层，而不是抄它的 TUI。**

**② opencode（anomalyco/opencode）——"产品形态"参照**
它是开源阵营里**功能面最宽**的一个：client-server（Hono + service 密码 + TUI channel）、Code Mode（模型写 JS 程序调工具）、background compaction、MCP 连接池、permission prompt（含嵌套 subagent）、LSP、automations、worktree 运行、`CLAUDE.md` 兼容 [已验证]。技术栈（Effect 4 + Drizzle/SQLite + OpenTUI/Solid + zod）也证明了**函数式副作用管理可以撑起大型 CLI**。**MewCode 应抄它的"多前端 + 多入口"产品结构，以及 Code Mode 这类 Agent Loop 变体。**

**③ Crush（charmbracelet/crush）——"成本最优"参照**
Go + Bubble Tea v2 + `modelcontextprotocol/go-sdk` + 单二进制 7 OS/多架构 + cosign 签名，用最少的人做到了极高的交付质量；release 节奏每周一次且 nightly 不断 [已验证]。**如果 MewCode 的目标是"先做一个能装、能跑、能天天更的终端 Agent"，Crush 是唯一一个看完就能估算出工作量的样本。** 反例是它没做 server 层、也没做多前端——这恰好是它的低成本原因。

> 附：**不推荐作为主要参照**的项目及原因 —— Aider（停更）、Gemini CLI（产品转向企业，免费额度已迁 Antigravity CLI）、Plandex（停更 13 个月）、Trae Agent（停 9 个月）、Roo Code（停 6 个月）、Amazon Q CLI（停发版）、SWE-agent（研究型、release 停在 2025-05）、Copilot CLI（闭源）。

---

## 4. 对 MewCode 的直接含义（选型建议）

1. **先定交付形态，再定语言**。若要"单二进制、无运行时、安装即用"→ Go（Crush 路线）或 Rust（Codex 路线）；若要"复用 Web/桌面前端、快速迭代"→ TS + **编译成平台二进制 + npm 薄壳**（opencode 路线），**不要**发 100MB+ 的 Node 整包。
2. **TUI 别默认选 Ink**。2026 年的实际分布是：Ink 仍是最大存量，但**新一代项目（opencode/Cline/Codebuff）已经集体转向 OpenTUI**，Qwen Code 正在迁移。若选 TS，应评估 OpenTUI（React 绑定）；若选 Go/Rust，答案是 Bubble Tea v2 / ratatui，没有悬念。
3. **把上下文压缩、审批、diff、token 计量做成"协议事件"**（Codex 的做法），而不是散落在 UI 回调里——这是后续加 IDE/Web/远程能力的前提。
4. **MCP 直接接官方 SDK**，不要自研协议层；但要预留"deferred tools / 连接池 / OAuth"三项，因为 Codex、Goose、opencode 都已踩过。
5. **从第一天就做多 provider 抽象**：Cline 用 `models.dev` 目录（7,621 模型/94 provider）、Crush 用 `fantasy`、Aider 用 litellm、Qwen/Gemini 用自家 SDK —— 不要硬编码单一厂商。
6. **交互上最值得先做的三件事**（按各项目 release notes 出现频率排序）：①审批档位（per-call / auto-edit / YOLO 或 yolo/sysadmin）；②流式 markdown + diff 高亮渲染；③`shift+tab` / `ctrl+o` 之类的模式与视图切换。
7. **维护风险要写进选型评分**：本报告 16 个项目里 **6 个已明显停滞**（Aider、Plandex、Trae Agent、Roo Code、Amazon Q CLI、SWE-agent 发版停滞），而它们大多曾是某年的"最热项目"。**"star 数"与"是否值得依赖"在本领域几乎无关。**

---

## 5. 数据获取方法与失败记录（可复现性）

- **元数据**：`https://api.github.com/repos/<owner>/<repo>`（直连可用；未认证限流 60 次/小时，抓取中途触发 **HTTP 403 `API rate limit exceeded for 112.22.168.39`**，之后改用 `https://ungh.cc/repos/<owner>/<repo>` 补 star/pushed_at，但 ungh **不返回 license 与 language**，故个别项目 license 标注"未取证"）。
- **依赖清单**：经 `https://gh-proxy.com/https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` 读取（直连 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 均 **fetch failed**，需代理而本会话禁止提权）；Go 项目用 `https://proxy.golang.org/<module>/@v/<ver>.mod`；npm 项目用 `https://registry.npmmirror.com/<pkg>/latest`。
- **release 日期**：`https://gh-proxy.com/https://github.com/<owner>/<repo>/releases.atom`（Atom feed 体积远小于 releases API；`ghproxy.net` 返回 429 不可用）。**未逐个取证 release 的项目**：OpenHands、Roo Code、Plandex、Codebuff —— 改用 `pushed_at` 作为活跃度代理，已在表中标注。
- **Rust crate 清单**：`crates.io/api/v1/crates/rmcp` 可用；具体项目（codex/goose/amazon-q）的 Cargo.toml 一律通过 gh-proxy 读取，**未使用 crates.io 反查**。
- **本会话环境限制**：内置 pwsh 在默认沙箱下以 `0xC0000142` 退出且本会话禁止提权，因此 **未执行任何本地命令**；全部证据来自上述 HTTP 抓取，无一条来自记忆。
- **未证实的点（明确列出）**：①Claude Code 的 TUI 技术栈仅有 [社区说法]；②Roo Code / Codebuff / Plandex / Trae Agent 的 license 因 ungh 缺字段而未取证；③Gemini CLI 的 Ink 依赖来自 `packages/cli/package.json`（nightly 版本 0.71.0-nightly.20261118），与 npm 稳定版 0.70.0 可能存在差异；④各项目"近 12 个月发版节奏"以最近可见 release 推断，未逐月统计全部 release。
