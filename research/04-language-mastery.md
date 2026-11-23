# Lead 自评：我对各语言的掌握程度（用于判断"AI 能不能替我写出来"）

> 说明：这是**行为预测式的自评**，不是考试分数。判断依据是：我在这门语言里"能否一次写对"、
> "出错后能否靠编译器/测试自己收敛"、"要几轮才能跑通"、"生态 API 我是否真的熟"。
> 结论会受任务类型影响极大——写业务逻辑 vs 写 TUI 渲染 vs 写并发/系统编程，差距很大。
> 评估日期：2026-11-23。

## 一句话结论

> **TS ≈ Python > Go > Rust > Java**（就"从 0 做出一个 Claude Code 类 CLI 并持续迭代"这件事而言）。
> 差距主要不在语法，而在三件事：**生态是否一等公民（LLM/MCP/TUI SDK）、我能否快速自证正确（类型+测试+热重载）、
> 失败时调试成本**。

## 分级与依据

### 1. TypeScript / Node.js —— 最强（高置信）

- **能独立完成**：完整 Ink/React 终端应用（流式 Markdown、diff、审批弹窗、多行编辑器）、
  Anthropic/OpenAI SDK 流式 tool_use 循环、MCP 官方 SDK 客户端与服务端、zod 工具参数校验、
  npm 打包与 `npx` 分发、Bun 编译单文件可执行程序。
- **为什么最强**：训练数据密度最高；类型系统能在运行前抓掉大量低级错；生态与你目标产品完全同源
  （Claude Code、Gemini CLI、Cline、opencode 的 TS 部分都在这条线上）；`tsx`/`bun` 热迭代快。
- **失败模式**：跨 5+ 文件的大重构容易产生类型连锁错误，需要多轮 `tsc` 收敛；
  对 Bun/Deno 的边缘 API、Node 版本差异（如 `node:sqlite`、`--experimental-strip-types`）可能记错，
  需要现场查文档；React 状态与异步流交错的 bug（闭包、effect 依赖）是我最容易写错的一类。
- **迭代速度**：极快（秒级重跑）。**生态熟悉度**：Ink/React、MCP TS SDK、Anthropic SDK = 一等公民。

### 2. Python —— 很强（高置信）

- **能独立完成**：asyncio 流式 Agent Loop、Rich/Textual/prompt_toolkit TUI、pydantic 工具 schema、
  MCP Python SDK、Aider 式仓库地图（tree-sitter/ripgrep）、打包（uv/pipx；PyInstaller 需额外调）。
- **为什么强**：语言简单、生态巨大、我写起来 token 效率高；类型注解 + pyright/mypy 可补足动态类型风险；
  AI 生态（OpenAI/Anthropic SDK、LangChain 类库）最丰富。
- **失败模式**：打包分发是硬伤（PyInstaller 体积/杀软误报/跨平台）；GIL 下的并发模型容易写出假并发；
  大型重构时类型信息弱于 TS，容易漏改；TUI 高帧率场景（Textual 60fps、巨量 diff）需实测。
- **迭代速度**：很快。**生态熟悉度**：Textual/Rich 熟；prompt_toolkit 细节需查文档。

### 3. Go —— 较强（中高置信）

- **能独立完成**：Bubble Tea + Lip Gloss TUI、goroutine/channel 并发 Agent Loop、MCP Go 社区 SDK、
  PTY 执行（creack/pty）、交叉编译单二进制分发（Windows/macOS/Linux 一个文件）。
- **为什么强**：语言小、编译快、错误处理显式；单二进制对"装完就能用"的 CLI 是碾压级优势；
  Bubble Tea 生态我在训练里见得多（Crush、Glow、GitHub CLI 周边都在这条线上）。
- **失败模式**：泛型/接口抽象设计容易写得啰嗦或过度；`context` 取消传播漏写导致 goroutine 泄漏；
  Windows 下 PTY/信号处理细节（ConPTY）需查资料；复杂 TUI 状态机不如 React 心智模型顺手。
- **迭代速度**：快（编译秒级）。**生态熟悉度**：Bubble Tea 高；MCP Go SDK 中（社区实现，成熟度低于 TS/Python）。

### 4. Rust —— 中等偏上（中置信）

- **能独立完成**：Tokio 异步 Agent Loop、ratatui TUI、serde 配置/协议、clap CLI、
  cargo 交叉编译与 release 分发；Codex CLI / uv / ripgrep 式工程结构我能照着搭。
- **为什么不是"强"**：借用检查器 + 生命周期 + async trait/`Send` 约束会让我**反复编译失败**，
  每次失败都是分钟级编译等待；跨 crate 重构成本高；我对 2025–2026 新 crate 的 API 记忆不可靠，
  必须现场读 docs.rs。写"小而清晰的模块"很稳，写"大而互相引用的状态机"容易卡住。
- **失败模式**：过度克隆/`Arc<Mutex>` 掩盖设计问题；错误类型层层包装（anyhow/thiserror）写乱；
  Windows 交叉编译与链接（MSVC）细节易错。
- **迭代速度**：慢（编译 + 借用检查）。**生态熟悉度**：ratatui/tokio 高；生态 crate 版本 API 中。

### 5. Java —— 中等（中置信）

- **能独立完成**：JDK 21 并发/虚拟线程、JLine3 或 Lanterna TUI、Maven/Gradle 工程、
  Anthropic/OpenAI Java SDK（官方或社区）、MCP Java SDK（2025 起有官方 Java SDK，但生态较新）。
- **为什么只是中等**：代码啰嗦 → 同样功能 token 消耗约为 Go 的 1.5–2 倍，出错面更大；
  TUI 生态（Lanterna/JLine3）我见得少，组件/渲染细节要现查；Gradle 配置、JPMS、native-image 是常见坑；
  启动慢、内存大，做 CLI 的"手感"天生吃亏。
- **失败模式**：依赖/构建配置写错（版本冲突）；泛型与继承体系过度设计；TUI 按键/终端能力细节。
- **迭代速度**：中（编译/启动慢）。**生态熟悉度**：Spring/JDK 高；TUI 低。

### 6. 其他语言（如你考虑）

- **C# / .NET**：中等。语法现代、Avalonia/WPF 桌面能做，但跨平台 CLI 分发与 TUI 生态弱，我实战样本少。
- **C / C++**：低–中且风险高。内存安全 + 构建系统 + 跨平台终端差异，迭代慢、返工多；
  除非目标是"性能极限/嵌入"，不建议用它做第一版。
- **Zig / Bun 原生插件（OpenTUI 路线）**：低。能做但生态太新，我主要靠读源码，交付风险高。

## 排序背后的三个真实变量

1. **自证能力**：TS（类型+测试+热重载）、Python（pytest 快）、Go（编译+表驱动测试）能让我在无人盯的情况下
   自己跑通；Rust 编译期反馈强但慢；Java 反馈链最长。
2. **生态贴合度**：这个产品的关键依赖是 LLM SDK、MCP SDK、TUI 框架、PTY、diff/Markdown 渲染。
   TS/Python 在这些依赖上都是一等公民；Go 是"TUI 一等、MCP 二等"；Rust 是"性能一等、生态二等"；
   Java 是"MCP 三等、TUI 三等"。
3. **失败成本**：TS/Python 写错了改一行重跑；Rust 写错了可能重构类型签名；Java 写错了可能调依赖树。

## 怎么验证我不是在吹牛（建议你做的 1 天 spike）

给每个候选栈一个**同样的验收脚本**，让我在 1 天内各交一个最小可运行版，你亲眼看：

| 验收项 | 通过标准 |
|---|---|
| 流式对话 | 模型输出逐字/逐块渲染，不闪烁，Ctrl+C 可中断 |
| 工具调用 | 至少 ReadFile/EditFile/Bash 三个工具，带审批弹窗 |
| 长输出 | 连续输出 1000 行 Markdown + 300 行 diff，滚动流畅 |
| 中文输入 | 终端里中文 IME 输入、粘贴、方向键编辑正常 |
| 分发 | 一条命令安装/运行（npx 或单二进制），Windows 可跑 |
| 可维护 | 有测试、有 README、二次改动（加一个工具）≤30 分钟 |

**我的预测**：TS 与 Go 会最先全部通过；Python 卡在"分发"；Rust 卡在"1 天"但 3 天能过；
Java 卡在"长输出流畅度 + 启动速度"。这个预测本身也是你可以用来检验我的样本。

## 给你的用法建议

- 如果你要**最快看到成品、后续还要大量加功能**：让我用 TS 写，你重点 review"架构边界"（哪些层解耦）。
- 如果你要**单文件分发、给非程序员用**：Go。
- 如果你要**性能/超长会话/低内存，且不赶时间**：Rust（预留 1.5–2 倍工期）。
- 如果目标是**学 Agent 工程 + 面试 Java 岗**：Java，但 TUI 体验预期降低，接受"功能优先、手感其次"。
