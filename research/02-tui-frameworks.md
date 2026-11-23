# 02 · TUI 框架横向对比：交互设计 / 渲染性能 / 长期维护

> **抓取日期：2026-11-23（Asia/Shanghai）**。所有 star / release / issue 数字均为此日抓取，来源逐条标注。
> 事实分级：`[已验证]` = 亲自 fetch 到源码 / registry / 官方文档；`[社区说法]` = 博客、逆向、二手资料；`[推断]` = 基于证据的判断。
> 视角：**Claude Code 类 CLI Coding Agent** —— 多行输入编辑器 + 流式 Markdown + diff + 工具审批弹窗 + 长任务 + **中文 IME**。
> 对比对象：Ink(TS)、Bubble Tea + Lip Gloss/Bubbles(Go)、Textual + Rich + prompt_toolkit(Python)、Ratatui(Rust)、JLine3/Lanterna(Java)；FTXUI/Notcurses 作原生高性能参照。

---

## 0. 一句话结论

- **真实瓶颈不在"能不能画"，而在三处**：①流式输出时每帧的 diff/布局成本；②输入路径上的 IME 光标定位（中文预编辑字符要显示在正确坐标）；③屏幕所有权（alternate screen 吃掉 scrollback，还是 inline 保留历史）。终端一次只显示 24–50 行，10 万行本身不慢，慢在"把 10 万行当 widget 每帧重排"。
- **中文 + 长任务 + 频繁审批，最稳的是 Bubble Tea（Go）**：默认 inline 保留 scrollback、渲染器有帧率上限且空闲停帧、CJK 宽度修复集中在 Bubbles v2.2.2、无 IME 专项 bug 报告、单二进制分发。**Ratatui（Rust）技术上限更高但开发成本最高**。
- **Ink 是"最像 Claude Code"的选择**（Claude Code、Gemini CLI 都用），但也是**中文 IME 风险最高**的选择：两个 IME 相关 PR 至今未合并，Claude Code 自身仍有中文 IME 回归 issue。走这条路必须自带 IME/光标兜底方案。
- **Textual 全屏体验最好但吃 scrollback**，且 419 个 open issue、最近发版停在 2026-06-30，长期维护信心一般；**JLine3 行编辑最成熟（Windows 中文专门修过），但没有全屏多面板组件库**。

---

## 1. 速查表（数据均抓取于 2026-11-23）

| 框架 | 语言 | 最新版本（发布日） | Star | 最近 push | open issues | 渲染架构一句话 | 屏幕模式 | 中文/IME 可靠度 |
|---|---|---|---|---|---|---|---|---|
| **Ink** | TypeScript | v8.0.0（2026-10-03） | 40,319 | 2026-11-21 | 33 | React reconciler + Yoga flexbox，整棵树渲染成 ANSI 字符串后按行 diff | inline 为主，可选 alternate screen | ⚠️ 低：IME 修复未合并 |
| **Bubble Tea**（+Lip Gloss / Bubbles） | Go | v2.1.2（2026-11-18） | 45,843 | 2026-11-22 | 235 | Elm 式 Model-Update-View，View 返回整屏字符串，渲染器做行级 diff | 默认 inline，`WithAltScreen` 才全屏 | ✅ 较稳：无 IME 专项 bug，CJK 宽度持续修 |
| **Textual**（+Rich） | Python | v8.2.8（2026-06-30） | 37,716 | 2026-11-09 | 419 | 保留式 DOM + CSS + compositor，按 damage 区域重绘 | 默认全屏 alt-screen，支持 "Run inline" | 🟡 中：IME 支持已合并，仍有光标/双宽 bug |
| **Rich** | Python | v15.0.0（2026-04-12） | 57,852 | 2026-11-13 | 408 | 渲染库（非 TUI），把 Markdown/表格/语法高亮变成 ANSI | 无（写到 stdout） | ✅ 好：纯输出，不接管输入 |
| **prompt_toolkit** | Python | 3.0.53（2026-07-26） | 10,631 | 2026-10-20 | 793 | 行编辑器 + 布局引擎，`patch_stdout` 处理流式输出 | 默认 inline，可 full_screen | 🟡 中：老 bug 已修，超长行截断仍 open |
| **Ratatui** | Rust | v0.30.2（2026-06-19） | 23,397 | 2026-11-22 | 174 | 立即模式，双 Buffer 逐 cell 比较，只发变化的单元格 | 默认 Fullscreen，支持 `Viewport::Inline` | ✅ 较高：宽度精确，IME 交给终端 |
| **JLine3** | Java | 4.7.0（2026-11-12） | 1,813 | 2026-11-19 | 24 | LineReader 行编辑 + 终端抽象（JNA/Jansi/ffm），无全屏 widget 层 | inline（行编辑） | ✅ 高：WriteConsoleW 修过 Windows 中文 |
| **Lanterna** | Java | 无 GitHub release；tag 3.2.0-alpha1，稳定 3.1.5 | 2,636 | 2026-07-07 | 98 | 纯 Java 全屏 widget 工具包（Screen/Window/Label/Table） | 全屏 | ❓ 未获取（社区案例极少） |
| **FTXUI**（参照） | C++ | v7.0.3（2026-08-06） | 10,907 | 2026-11-22 | 25 | 立即模式 + DOM，C++20 | 全屏，支持非 alt-screen | ❓ 未获取 |
| **Notcurses**（参照） | C | v3.0.17（2025-10-28） | 4,779 | 2026-11-21 | 331 | 多平面（plane）+ 高带宽写入，支持图片/视频 | 全屏 | ❓ 未获取；单维护者 331 open |

> 星数≠质量：JLine3 只有 1.8k 星，但它是 JVM 世界行编辑的事实底层；Lanterna 星更少、且维护节奏明显偏慢。
> 屏幕模式一列指"不显式配置时的默认值" `[推断]`：Ratatui 的 `Viewport::Inline(u16)` 属官方文档明确能力、Textual 的 inline 运行有官方文档 "Run inline" 小节，这两项为 `[已验证]`；其余框架的默认/可选模式来自发版说明与通用用法 `[社区说法/推断]`。

---

## 2. 必答问题一：真实瓶颈在哪？

**结论：瓶颈是"每帧要做多少工作 × 每秒做多少帧"，以及"键盘输入能不能被正确回显"，不是终端画不画得动。**

### 2.1 帧节奏：流式 token 把渲染器逼成高频 diff

- Claude Code 类产品在流式输出时，每秒可能有 20–60 次内容更新；如果框架每次都全量重排，CPU 会随着对话变长而线性上涨。
- Ink 的代价最直观：**PR #564**（merged 2023-07-16）记录 50 个 spinner 同时转时"一个 CPU 核心 100%、渲染明显卡"，改写渲染路径后降到约 40% 单核 `[已验证]`（https://github.com/vadimdemedes/ink/pull/564）。v8.0.0 还专门修了 "unbounded text caches"（#986），说明缓存会无界增长 `[已验证]`（https://github.com/vadimdemedes/ink/releases/tag/v8.0.0）。
- Bubble Tea 把这件事做进了架构：**PR #1132**（merged 2024-10-30）把每帧 `EraseEntireLine` 改为"光标回帧首覆写 + EraseLineRight"，消除闪烁 `[已验证]`（https://github.com/charmbracelet/bubbletea/pull/1132）；v2.1.2（2026-11-18）进一步做到**空闲时不重绘、约 0.5s 后停帧**，且视图未变化时跳过重绘 `[已验证]`（https://github.com/charmbracelet/bubbletea/releases/tag/v2.1.2）。
- Ratatui 用**双 Buffer 逐 cell 比较**，理论上每帧只写变化单元格，是大 diff 场景最省 IO 的做法 `[推断，基于其立即模式 + Buffer diff 的公开设计]`。
- Textual 走 **damage 区域重绘**（只重绘变化区域），方向与 Ratatui 类似，但 DOM/CSS 布局本身有成本 `[推断]`；本次未检索到可直接引用的 Textual 性能 issue（"performance" 检索 60 条命中里没有有效项）`[已验证：检索结果为空]`。

### 2.2 输入路径：IME 是"光标坐标"问题，不是"编码"问题

中文输入法在终端里跑的是**终端自己的预编辑行**；框架要做的是两件事：

1. 把终端光标放到输入框光标的真实屏幕坐标上（否则候选窗出现在错误位置、预编辑字符错位）；
2. 不要用 alternate screen 把终端的预编辑显示盖掉。

证据（详见 §5 表）：Textual 2023 年合并 **PR #3408**，给 App 加 `cursor_position`，让 Input/TextArea 把终端光标移到正确坐标，专门修 IME 弹窗位置 `[已验证]`（https://github.com/Textualize/textual/pull/3408）。Ink 侧对应的两条路（synchronized update 修 IME、side-channel cursor 元素）**都还没合并** `[已验证]`（https://github.com/vadimdemedes/ink/pull/846 、https://github.com/vadimdemedes/ink/pull/1004）。连 Claude Code 自己都还在出 IME bug：`[社区说法]` https://github.com/anthropics/claude-code/issues/57759（CJK 候选词数字键被拦截）、https://github.com/anthropics/claude-code/issues/93281（全屏 TUI 中文 IME 输入被丢弃/清空）。

### 2.3 屏幕所有权：scrollback 是要不要"把历史还给终端"

- **inline（保留 scrollback）**：UI 只占底部若干行，上面的输出进入终端历史，用户可以用终端自己的回滚、`less`、复制粘贴。代价是框架必须支持"在视口上方追加输出"。
- **alternate screen（全屏）**：UI 独占屏幕，退出后恢复原样；交互可以做得很像桌面应用（面板、弹窗、鼠标），**但用户失去历史**，长任务结束后只能看到最后一屏。
- Claude Code 类产品的真实用法是"跑命令 → 看长输出 → 翻回去复制"；**这决定了 inline 能力是硬指标，而不是审美偏好**。Ratatui 为此提供 `Viewport::Inline(u16)` + `Terminal::insert_before`（在 UI 上方打印）`[已验证]`（https://docs.rs/ratatui/latest/ratatui/enum.Viewport.html）；Bubble Tea 有 `insertAbove`（v2.1.2 修了行宽测量）`[已验证]`；Ink 有 `<Static>` 但历史上多次丢 scrollback，v8.0.0 才修 "Preserve scrollback when clearing the viewport"（#994）与 "Preserve terminal history after clear()" `[已验证]`（release notes 同上）。

---

## 3. 必答问题二：中文 + 长任务 + 频繁审批，谁最稳？

**结论：Bubble Tea（Go）> Ratatui（Rust）> JLine3（Java，仅输入层）> Textual（Python）> Ink（TS）> Lanterna（Java 全屏）。**

| 维度 | Bubble Tea | Ratatui | JLine3 | Textual | Ink | Lanterna |
|---|---|---|---|---|---|---|
| 中文 IME 证据 | 无 IME 专项 issue；CJK 宽度在 Bubbles v2.2.2 集中修 `[已验证]` | 宽度用 unicode-width 精确；v0.30.2 修宽字符尾随单元格 #2587 `[已验证]` | Windows 中文用 WriteConsoleW 专门修过（2017）`[已验证]` | IME 支持已合并（2023），但 #6082、#6357 仍 open `[已验证]` | IME PR 均未合并；Claude Code 自身有 IME bug `[已验证/社区说法]` | 未获取 |
| 长输出/大 diff | viewport 需自行窗口化；粘贴慢 bug #831 已关 `[已验证]` | cell diff 最优；inline + insert_before 天然适合长输出 `[已验证]` | 只负责行编辑，长输出靠你自己的分页器 | 全屏滚动区域；damage 重绘 | `<Static>` + 窗口化，否则 CPU 高（#564） | 全屏，历史在内存 |
| 频繁审批弹窗 | 无内置 modal，`overlay` 需 Lip Gloss 手搭 `[推断]` | 无内置 modal，可用 `Clear` + 居中布局 `[推断]` | 无（需自研） | 最成熟：Screen/Modal/Toast 一等公民 `[已验证：widget 列表]` | 中等：Box 绝对定位可做 | 窗口/对话框是内置能力 |
| 维护信号（2026-11-23） | 45.8k★、235 open、前一日有推送 | 23.4k★、174 open、前一日有推送 | 1.8k★、**24 open**、4.7.0 刚发 | 37.7k★、**419 open**、release 停在 2026-06-30 | 40.3k★、33 open、v8 刚发 | 2.6k★、98 open、4 个月无推送 |
| 交付形态 | 单静态二进制（Go 的杀手锏） | 单静态二进制 | JAR + JVM | 需 Python 运行时 + venv | 需 Node 20+ | JAR + JVM |

**为什么把 Bubble Tea 排第一**[推断，理由如下]：①默认 inline，天然保留 scrollback；②渲染器有帧率上限 + 空闲停帧，流式输出不会空转；③CJK 宽度问题在 Bubbles/ Lip Gloss 层集中修复（textarea 的 CharLimit 从"按显示宽度"改为"按 rune 数"，官方原话是 "a CJK character no longer counts double"）`[已验证]`（https://github.com/charmbracelet/bubbles/releases/tag/v2.2.2）；④组件齐全（textinput/textarea/viewport/list/table），做审批弹窗、任务列表够用；⑤Go 交叉编译 + 单文件分发，对"给用户装一个 CLI"最友好。

**为什么 Ink 排最后（仅就中文场景）**：它的生态与 Claude Code 的形态最贴（React 组件化、Markdown 渲染库多），但中文用户会遇到两类硬伤：IME 修复长期未合并、以及必须自己在 `<Static>` 与全量重排之间做取舍。如果团队是前端背景且优先"先跑起来"，Ink 仍是合理第一站——**但要预留 IME 兜底与 Windows 测试**。

---

## 4. 必答问题三：什么情况选哪个？

| 你的情况 | 推荐 | 理由 / 代价 |
|---|---|---|
| 想最快复刻 Claude Code 的形态，团队是 React/TS | **Ink v8** | 组件化最快；Claude Code 用它、Gemini CLI 用其第三方 fork。代价：中文 IME 要自己兜底，长输出要 `<Static>` + 窗口化 |
| 要长期维护、单二进制、跨平台（尤其 Windows 中文用户） | **Bubble Tea v2 + Lip Gloss/Bubbles** | 综合最稳（见 §3 表）；代价：没有内置 Markdown/diff 组件，需要 glamour 之类的库，编辑器要自己拼 |
| 追求极致渲染性能、大 diff、愿意付 Rust 成本 | **Ratatui** | cell diff + Inline viewport + insert_before 是最"干净"的终端模型；代价：组件最少、开发最慢 |
| 已有 Python 生态（模型 SDK、脚本、内部工具） | **Textual**（全屏）/ **prompt_toolkit**（行编辑） | Textual 的 widget 与 Screen/Modal 最像应用框架；代价：默认吃 scrollback、419 open issue、发版节奏变慢 |
| 企业 Java 栈、必须 JVM | **JLine3** 做输入层 + 自研渲染；**Lanterna** 谨慎 | JLine 行编辑最成熟（24 open issue、刚发 4.7.0）；代价：没有 Claude Code 式全屏多面板层，Lanterna 维护偏弱（LGPL、无 release） |
| 极端性能 / 原生参照（图片、超高频刷新） | FTXUI（C++）/ Notcurses（C） | Notcurses 能力强但单维护者 + 331 open；对 coding agent 属于杀鸡用牛刀 |

**给 MewCode 的直接建议**[推断]：若目标用户包含中文 Windows 用户、且要长期维护 → **Bubble Tea v2（Go）** 为第一选择，Ink 为"前端栈/快速原型"备选；若跟小林 coding 课程的四语言版本走，则 Java 版建议 **JLine3（输入层）+ 自研面板渲染**（Lanterna 仅作参考实现），Python 版建议 **Textual**（注意 inline 模式的取舍），Go 版直接 Bubble Tea，TS 版直接 Ink。

### 4.1 交互能力逐项对照（任务轴 A）

> 下表按各框架官方组件清单/文档与本次检索归纳 `[推断/文档归纳]`，**未逐项实测**；空白代表"需自研或社区第三方"。

| 能力 | Ink | Bubble Tea | Textual | prompt_toolkit | Ratatui | JLine3 |
|---|---|---|---|---|---|---|
| 多行输入编辑器 | 无内置（ink-text-input 仅单行） | Bubbles textarea（无 vim 模式） | TextArea 组件 | 内置多行 + history + 补全 | 需自研（无官方 textarea） | LineReader 多行 + history + 补全 |
| 命令补全 / 历史 | 自研 | Bubbles list + 自研 | Input suggester / CommandPalette | 内置 | 自研 | 内置（强项） |
| 粘贴大段文本 | 需自行处理 bracketed paste | bracketed paste 支持；Bubbles #831 粘贴慢已关（2024） | Paste 事件 | 支持 bracketed paste | 依赖 backend（crossterm） | 支持 |
| 流式 Markdown | ink-markdown 已停更（2023），需自研 | glamour（Crush 在用） | 内置 Markdown / MarkdownViewer | 无（用 Rich 渲染） | 需自研 | 无 |
| diff 高亮 | 自研（可配 diff/lowlight 库） | 自研 | 自研 | 自研（Rich 上色） | 自研 | 无 |
| 工具审批弹窗 | Box 绝对定位 | Lip Gloss overlay | Screen/Modal 一等公民 | 无（只有 prompt 对话框） | `Clear` + 居中 Rect | 无 |
| 鼠标事件 | 部分支持（v8 过滤未识别序列） | v2 支持 | 支持 | 支持 | 支持（backend 提供） | 支持 |
| 主题 | 自研 | Lip Gloss 自适应配色 | 内置 themes | 需配置 | 自研 | 需配置 |
| resize | 有 `useWindowSize`（v8） | WindowSizeMsg | Resize 事件 | 自动 | 自动 autoresize | 有 |

**解读**：真正拉开差距的是"流式 Markdown + diff + 审批弹窗"这类 Claude Code 专属组件——**没有一个框架原生自带全部**，都要在框架之上自研一层；因此选型的关键不是"组件多不多"，而是**在哪个框架上自研这层最省力**（Textual 的组件基座最好，但被全屏模式绑住；Bubble Tea 的组件与样式系统最平衡；Ink 的 React 心智最省前端人力）。

### 4.2 语言运行时对交互的制约（任务轴 D）

> 未做本机 benchmark（本报告不提供统一测量数字，避免误导）；以下是量级判断 `[推断]`，如需精确数字建议 Lead 另测。

- **Node/TypeScript（Ink）**：V8 + React 首次渲染使启动在百毫秒量级；单线程事件循环让"渲染 diff"与"流式解析/网络"抢同一主线程，大 diff 时输入回显会延迟。优势是前端人才与组件生态。
- **Go（Bubble Tea）**：编译为单静态二进制、启动毫秒级；goroutine 让流式读取、工具子进程与渲染天然并发；无运行时依赖，Windows/CI 分发最省心。
- **Python（Textual / prompt_toolkit）**：解释器 + import 启动常在百毫秒级；GIL 下渲染与模型 SDK 调用共享线程，长 diff 需 Worker/线程池（Textual 有 Worker API）。适合已有 Python 生态的团队。
- **Rust（Ratatui）**：无 GC、启动最快、单二进制；代价是借用检查让"流式 + 增量渲染"的状态机设计成本高，开发速度最慢——这是选 Ratatui 最大的隐性成本，不是性能。
- **Java（JLine3 / Lanterna）**：JVM 启动 + JIT 预热使冷启动明显偏慢、常驻内存偏高；对"命令行工具秒开"是硬伤，对企业内常驻/受管环境可接受。

**关于"AI 能不能替你写出来"**：本报告不评语言掌握度（属 Lead 汇总与 `04-language-mastery.md` 范围），只提示：**框架越"重"（Textual 的 CSS/DOM、Ratatui 的立即模式状态机），越依赖对框架惯用法的理解；Bubble Tea 的 Elm 结构最简单，最容易让 AI 一次写对** `[推断]`。

---

## 5. 中文 / IME 证据明细

| 框架 | 证据 | 状态 | 结论 |
|---|---|---|---|
| Ink | PR #846 为 IME 加 synchronized update（CSI ?2026 BSU/ESU）；正文记录 tmux/Zellij 中拼音预编辑字符右移、输入延迟 200–500ms、候选窗重复 | **closed 未合并**（2026-01-10→2026-02-08）https://github.com/vadimdemedes/ink/pull/846 | `[已验证]` IME 问题被识别，但主分支未采纳 |
| Ink | PR #1004 增加 side-channel inline Cursor 元素（解决光标定位 #870/#251） | **closed 未合并**（2026-09-19→2026-10-29）https://github.com/vadimdemedes/ink/pull/1004 | `[已验证]` 同上 |
| Ink | v8.0.0 只新增 Kitty keyboard protocol 解析与宽字符保留样式/列修复 | 已发布 | `[已验证]` 仍未解决"光标坐标"这一层 |
| Claude Code（基于 Ink） | #57759 CJK 候选词数字键被拦截；#93281 全屏 TUI 中文 IME 被丢弃/清空 | 状态与日期未获取（core API 限流） | `[社区说法]` 事实标准实现也踩坑 |
| Bubble Tea | 未检索到 IME 专项 issue（"chinese" 12 条命中均非 IME） | — | `[已验证]` 检索结果 |
| Bubble Tea | issue #1017 viewport 内长文本换行导致可视区错乱、GotoBottom 失效 | **open**（2024-05-13，更新 2026-11-20）https://github.com/charmbracelet/bubbletea/issues/1017 | `[已验证]` 是"测量宽度"问题，不是 IME |
| Bubbles | v2.2.2：textarea 按 rune 计数、按 grapheme 移动删除、textinput 宽字符光标正确 | 已发布（2026-11-20） | `[已验证]` CJK 体验的直接改善 |
| Textual | PR #3408 加 `cursor_position` 让 Input/TextArea 定位终端光标 → 修 IME/emoji 弹窗位置（fixes #1469/#3404） | **merged** 2023-10-05 | `[已验证]` 有官方 IME 机制 |
| Textual | #6082 `Input` 初始光标位置错误（reopened，2025-08-29） | open | `[已验证]` 光标定位仍有 bug |
| Textual | #6357 CJK 双宽字符 Toast 与边框重叠时消失（resize 可复现） | open（2026-02-08） | `[已验证]` 双宽字符重绘仍有缺陷 |
| prompt_toolkit | #389 Windows 下输入"开"无响应（2016，已关闭） | closed | `[已验证]` 很旧、已修 |
| prompt_toolkit | #1483 `patch_stdout` 超长行被截断（Windows Terminal 实测） | open（2021，更新 2023）https://github.com/prompt-toolkit/python-prompt-toolkit/issues/1483 | `[已验证]` 流式长输出要自己包行 |
| JLine3 | PR #168 用 WriteConsoleW 绕过 Windows 代码页写 Unicode（修中文乱码） | **merged** 2017-09-19 https://github.com/jline/jline3/pull/168 | `[已验证]` 最扎实的 Windows 中文方案 |
| JLine3 | #486 "如果我在 Windows 上用 jline，中文输入很乱" | closed 2020-04-08 https://github.com/jline/jline3/issues/486 | `[已验证]` 曾长期打磨 |
| JLine3 | 4.7.0 修半角片假名浊音/半浊音符号显示宽度（#2435） | 已发布 2026-11-12 | `[已验证]` 仍在修 CJK 宽度 |
| Ratatui | v0.30.2 修宽字符尾随单元格更新（#2587） | 已发布 2026-06-19 | `[已验证]` 双宽字符处理细致 |
| Ratatui | 未检索到 IME 专项 issue；IME 由终端负责，框架只需正确放置光标 | — | `[推断]` inline 模式下风险较低 |

**IME 可靠度排序（[推断]）**：JLine3 ≥ Ratatui ≈ Bubble Tea > Textual > prompt_toolkit > Ink。核心变量不是语言，而是"框架是否把终端光标还给输入框、是否避免 alternate screen 掩盖预编辑"。

---

## 6. 10 万行长输出 / 大 diff 的渲染卡顿风险

**结论：终端的物理显示只有几十行，"10 万行"的风险 100% 来自框架把全部内容当活动对象反复处理。** 选架构时看三点：能否**窗口化**（只渲染可见行）、能否**追加式输出**（历史一次性写入 scrollback）、能否**懒测量**（避免每帧重新计算所有行的宽度/换行）。

| 风险点 | 证据 | 应对 |
|---|---|---|
| 全量重排 | Ink PR #564：50 spinner 就吃掉 100% 单核 `[已验证]` | 用 `<Static>` 输出历史，只在视口里渲染活动部分 |
| 缓存无界增长 | Ink v8.0.0 "Fix unbounded text caches"（#986）`[已验证]` | 固定内容加 key、及时卸载旧节点 |
| 粘贴/大段写入 O(n²) | Bubble Tea #831：textarea 粘贴大文本逐字符写入、越大越慢（closed 2024-01-22）`[已验证]` | 批量写入、粘贴走独立路径 |
| 闪烁（每帧清屏） | Bubble Tea #1132（2024-10-30）根因是每帧 EraseEntireLine `[已验证]` | 选择已修复的版本；避免自己每帧清屏 |
| 流式长行被截断 | prompt_toolkit #1483（open）`[已验证]` | 自己按终端宽度包行，别依赖 `patch_stdout` |
| 双宽字符重绘错位 | Textual #6357；Bubbles v2.2.2 修复 `[已验证]` | 布局不要假设"1 char = 1 column"，用 width 感知的库 |

**工程上的量化建议**[推断]：把"会话历史"与"当前视口"分开存储——历史是 append-only 的纯文本/ANSI，超过 N 行（如 2000）就折叠或落盘；视口只保留最后 1–2 屏 + 正在流式的消息。做不到这一点，任何框架都会在几百 KB 输出后开始掉帧。

---

## 7. scrollback vs alternate screen：取舍表

| 框架 | 默认 | 保留 scrollback？ | 在 UI 上方追加输出的机制 | 备注 |
|---|---|---|---|---|
| Bubble Tea | inline | ✅ 是 | `insertAbove`（v2.1.2 修宽度测量）`[已验证]` | 符合 CLI 工具直觉 |
| Ink | inline | ✅ 是（v8 才修好 clear 丢历史） | `<Static>` | v8.0.0 修 #994 / #1012 `[已验证]` |
| Ratatui | Fullscreen | ❌ 默认否 | `Viewport::Inline` + `Terminal::insert_before` `[已验证]` | 官方明确写了 inline 用途 |
| Textual | 全屏 alt-screen | ❌ 默认否 | `run(inline=True)` + `:inline` 伪类 `[已验证：官方 docs "Run inline"/"Style Inline Apps"]` | 全屏是最舒适路径，inline 是二等公民 |
| prompt_toolkit | inline | ✅ 是 | 直接 print + `patch_stdout` | 长行需自己包 |
| JLine3 | inline（行编辑） | ✅ 是 | 直接 print | 无全屏，天然保留 |
| Lanterna | 全屏 | ❌ 否 | 需自己实现 | 传统 curses 风格 |

**对 Claude Code 类产品的建议**[推断]：主界面用 **inline + 底部固定输入区**（保留历史、兼容 `git diff | less`），长任务输出进入 scrollback 或独立 pager；审批弹窗用**临时覆盖视口底部若干行**，而不是切全屏。这样既保留 CLI 的"可管道、可复制"优势，又能做富交互。

---

## 8. 逐个框架卡片（架构 + 生产案例 + 对我们的意义）

### 8.1 Ink（TypeScript）
- 架构：React 组件 → Yoga flexbox 布局 → 渲染为 ANSI 字符串 → 与上一帧按行 diff。v8.0.0 新增 `incrementalRendering`（跳过未变行前缀）与 `contentOffsetX/Y`（可滚动视口）`[已验证]`。
- 生产：Claude Code `[社区说法]`（https://mintlify.wiki/nirholas/claude-code/architecture/state-and-ui#ui-layer ）；Gemini CLI `[已验证]` 用 `"ink": "npm:@jrichman/ink@6.6.9"`——**注意是第三方 fork，不是官方 Ink**（https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json ）。
- 生态：`ink-markdown` 最后发布 2023-10-02（peer ink>=2，已停更）`[已验证]`；`ink-text-input` 6.0.0（2024-05-14，无多行/vim 模式）`[已验证]`（https://registry.npmmirror.com/ink-markdown 、https://registry.npmmirror.com/ink-text-input ）。**做 Claude Code 类产品要自己写输入编辑器与 Markdown 增量渲染。**
- 意义：最快做出形似 Claude Code 的产品，但中文 IME 与长输出是两块要额外投入的硬骨头。

### 8.2 Bubble Tea + Lip Gloss + Bubbles（Go）
- 架构：Elm 式 Model/Update/View；View 返回整屏字符串，渲染器做行级 diff、有帧率上限、空闲停帧（v2.1.2）`[已验证]`。Lip Gloss v2.1.1（2026-11-15）负责样式/布局；Bubbles v2.2.2（2026-11-20）提供 textinput/textarea/viewport/list/table 等组件 `[已验证]`。
- 生产：Charm 自家 Crush（`charm.land/bubbletea/v2 v2.1.1` + bubbles v2.2.1 + lipgloss v2.0.6 + glamour v2.0.1）`[已验证]`（https://github.com/charmbracelet/crush/blob/main/go.mod ）；其余 CLI 工具大量使用 Lip Gloss `[社区说法]`。
- 意义：组件与设计系统最完整，中文宽度修复积极，分发简单——**综合最稳的工程选择**。

### 8.3 Textual + Rich（Python）
- 架构：保留式 DOM + CSS（Textual CSS）+ compositor，按 damage 重绘；渲染基于 Rich（Rich v15.0.0 已发布、丢弃 Python 3.8）`[社区说法：Textual 依赖 Rich；发版信息已验证]`。默认全屏，但官方支持 inline 运行 `[已验证]`（https://textual.textualize.io/guide/app/ ）。
- 生产：官方 widget gallery 与社区应用为主，**具体大型生产案例未获取** `[未获取]`。
- 意义：做全屏 dashboard 最舒服；但对 Claude Code 类"长输出 + 复制粘贴"的流，全屏是逆潮流。419 open issue + release 停在 2026-06-30 是维护信号。

### 8.4 prompt_toolkit（Python）
- 架构：行编辑器 + 布局系统；`patch_stdout` 用于流式输出时保留提示行 `[已验证]`。不是全屏应用框架。
- 生产：IPython、aider 等 REPL/编码助手 `[社区说法]`（aider 的 pyproject 依赖是 dynamic，未直接列出，故未升级为已验证）。
- 意义：如果只需要"一个靠谱的多行输入框 + 流式输出"，它是最省事的；但 793 个 open issue 说明历史包袱重。

### 8.5 Ratatui（Rust）
- 架构：立即模式 + 双 Buffer cell diff `[社区说法/推断：其公开设计，本次未读源码]`；`Viewport::{Fullscreen, Inline, Fixed}`，`Terminal::insert_before` 支持在 UI 上方打印（官方文档原文：inline 用于 "the UI should live inside a larger CLI flow, with normal terminal output above it"）`[已验证]`（https://docs.rs/ratatui/latest/ratatui/enum.Viewport.html ）。
- 生产：OpenAI Codex CLI `[社区说法]`（https://mintlify.wiki/openai/codex/architecture/tui 、https://github.com/bgauryy/open-docs/blob/main/docs/codex_cli/12-ui-layer.md ）；gitui 等 Rust TUI `[社区说法]`。
- 意义：渲染模型最干净、性能上限最高；但 widget 与生态需要自己补，开发速度最慢。

### 8.6 JLine3（Java）
- 架构：LineReader 行编辑（历史、补全、多行）+ 终端抽象（JNA/Jansi/ffm 多 provider），4.7.0 做了延迟加载优化启动 `[已验证]`。**没有全屏 widget 层**。
- 生产：Groovy shell、Gradle、Spring Shell、JBang 等 JVM 工具 `[社区说法]`。
- 意义：Java 栈做 CLI 的输入层首选；要做 Claude Code 式面板/弹窗必须自研渲染或用 Lanterna。

### 8.7 Lanterna（Java，参照）
- 架构：纯 Java 全屏 widget 工具包（Screen/Window/Label/Table/TextBox），传统 curses 风格 `[已验证：README/API 结构]`。
- 维护：无 GitHub release，稳定 tag 3.1.5，最后 push 2026-07-07；LGPL-3.0 `[已验证]`。
- 意义：只适合内部工具/教学参考；商业化产品注意 LGPL 与维护风险。

### 8.8 FTXUI / Notcurses（原生参照）
- FTXUI v7.0.3（2026-08-06）：立即模式 + DOM，支持非 alternate screen（v7.0.3 修该模式鼠标位置）`[已验证]`。
- Notcurses v3.0.17（2025-10-28）：plane 架构、可渲染图片/高带宽输出；单维护者、331 open issue `[已验证]`。
- 意义：给"性能天花板"提供参照，但对 coding agent 属于过度工程。

---

## 9. 横向评分（[推断]，供决策参考）

| 维度（权重） | Ink | Bubble Tea | Textual | prompt_toolkit | Ratatui | JLine3 | Lanterna |
|---|---|---|---|---|---|---|---|
| 交互/组件完备（25%） | 4 | 4 | **5** | 3 | 3 | 3 | 3 |
| 渲染性能/长输出（25%） | 2 | 4 | 3 | 4 | **5** | 3 | 2 |
| 中文/IME（20%） | 2 | **5** | 3 | 4 | 5 | 5 | 2 |
| 长期维护（15%） | 4 | **5** | 3 | 3 | 4 | 4 | 2 |
| 学习/开发成本（15%） | **4** | 4 | 3 | 4 | 2 | 2 | 2 |

> 权重按"Claude Code 类产品 + 中文用户 + 长期维护"设定；分数是判断不是测量，**不构成统一 benchmark**。

---

## 10. 不确定点与数据局限（务必和 Lead 的汇总交叉核验）

1. **GitHub 未认证 API 限流（IP 112.22.168.39，core 60/h）**：部分依赖文件未取到——Aider 的 `requirements.txt`、OpenAI Codex 的 `codex-rs/tui/Cargo.toml`、Ratatui scrollback 检索、Claude Code 两个 IME issue 的日期/状态。相应结论已降级为 `[社区说法]`。
2. **raw.githubusercontent.com 不可达**：README 里的 "Requirements/Production users" 段未逐一取原文；生产案例多为二手来源。
3. **Java 版 MewCode 用的框架未获取**：搜索到 `xiangxiang62/MewCodeAgent`（Java，1★）、`bug-free-bug-free/mewcode-agent`（Java，6★），但未取到 pom/gradle 依赖；`Tianba0116/mewcode`（Python，描述提及 Textual，26★）与 `chenpan979/MewCode`（Python，描述含 "Chinese IME support"，5★）来自 GitHub 搜索元数据 `[已验证：搜索 API]`。
4. **没有统一 benchmark**：所有性能结论来自 issue/PR 中的个案描述（如 Ink #564 的 50 spinner），不能横向等比。
5. **Lanterna / FTXUI / Notcurses 的 CJK 与生产案例未获取**，表里标 ❓；不要据此下强结论。

---

## 11. 来源清单（按抓取顺序，均 2026-11-23）

- GitHub 仓库元数据（stars/pushed/open issues/license）：`https://api.github.com/repos/{vadimdemedes/ink, charmbracelet/bubbletea, charmbracelet/lipgloss, charmbracelet/bubbles, Textualize/textual, Textualize/rich, prompt-toolkit/python-prompt-toolkit, ratatui/ratatui, jline/jline3, mabe02/lanterna, ArthurSonzogni/FTXUI, dankamongmen/notcurses}`
- 最新 release：`https://api.github.com/repos/<owner>/<repo>/releases/latest`；Lanterna 返回 404（无 release），以 `https://github.com/mabe02/lanterna/tags` 为准
- 依赖核实：`https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json`、`https://github.com/charmbracelet/crush/blob/main/go.mod`、`https://github.com/Aider-AI/aider/blob/main/pyproject.toml`
- npm 元数据：`https://registry.npmmirror.com/ink-markdown`、`https://registry.npmmirror.com/ink-text-input`
- 官方文档：`https://docs.rs/ratatui/latest/ratatui/enum.Viewport.html`、`https://textual.textualize.io/guide/app/`、`https://textual.textualize.io/how-to/style-inline-apps/`
- issue / PR：Ink #846、#1004、#564；Bubble Tea #1132、#831、#1017；Textual #3408、#6082、#6357；prompt_toolkit #389、#1483；JLine3 #168、#486；Claude Code #57759、#93281（链接见正文）
- 生产使用（二手）：Claude Code Ink 架构页、Codex TUI 架构页、aider I/O 文档（链接见 §8）
