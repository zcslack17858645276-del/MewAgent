# 03 桌面端：跨端框架 vs 原生（延伸调研）

> 定位：**延伸调研**。主线产品仍是 CLI Coding Agent，本文只回答一个问题："如果以后要给 MewCode 加桌面客户端，
> 跨端框架和原生语言各付什么代价？"
> 调研日期：2026-11-23。事实分级：`[已验证]` = 本次亲自抓到官方文档 / 仓库 / registry；`[社区说法]` = 广为流传但本次未复现；
> `[推断]` = 我的推理，可能错。所有数字都带日期与测量条件，不拼成"统一 benchmark"。

## 0. 先给结论（TL;DR）

1. **对 coding agent 这类产品，GUI 的难点不是"开窗口"，而是终端、代码编辑器、diff、预览。**
   这四样 Web 生态有一流现成实现：xterm.js 就是 VS Code 集成终端的内核 `[已验证 S20]`，Monaco/CodeMirror 同理。
   选原生基本等于"自己造终端 + 自己造 diff 查看器"，或者"在原生壳里嵌 WebView"——后者既付了跨端的成本，又多背一层原生。
2. **"跨端"省的是 UI 人力，不省分发成本。** Windows 代码签名/SmartScreen、自动更新、macOS 公证、Linux 打包，
   任何框架都躲不掉（见 §4.4）。跨端框架只把"写界面"这件事统一了。
3. **Electron vs Tauri 的核心差别是"运行时谁付账"。** Electron 自带 Chromium+Node（包大、内存高、三平台行为一致）；
   Tauri 用系统 WebView（包可小到 600 KB，但 Windows 依赖 WebView2、Linux 是 WebKitGTK，跨端一致性差一档）`[已验证 S6][S19]`。
4. **原生只在"Windows-only + 性能/系统集成是卖点 + 有 C#/C++ 人力"时更划算。**
   Flutter/Qt 做 IDE 类界面，等于把 Web 生态的优势扔掉，再自己补 IME、无障碍、文本渲染的坑
   （Flutter 中文 IME 有 2026 年的实证 bug，§2.2）`[已验证 S13]`。
5. **最优路径：核心做成"本地服务/库"，CLI/TUI 和 GUI 都只是客户端。**
   GUI 第一版用"本地 server + 浏览器"或 VS Code 扩展验证需求，确定要做独立 app 再包壳（§5）。

## 1. 必答三问（一句话版）

| 问题 | 结论 |
| --- | --- |
| CLI 优先的产品，什么时候值得做 GUI？ | 当"并行看多个长任务 + 审大量 diff/图片/网页 + 给非终端用户用 + 要托盘/通知/文件关联"这四条里**同时满足两条以上**时；如果只是"把终端包个窗口"，用 localhost Web 或编辑器扩展更便宜（§6.1）。 |
| 只做 Windows，哪条路最省？ | 按"总成本"排序：**本地 server+浏览器（试用）→ Electron（省人力）→ Tauri（省体积）→ WinUI3/Avalonia（省运行时但费人）**；纯 WPF/WinUI3 只在团队本来就有 C# 时最省（§6.2）。 |
| 跨端 vs 原生怎么取舍？ | 见 §6.3 的 5 条直白总结。 |

## 2. 方案速览（9 条路线）

| 方案 | 本质 | 界面从哪来 | 最适合 | 最大坑 |
| --- | --- | --- | --- | --- |
| Electron | Chromium + Node 自带运行时 | HTML/CSS/JS | 快速出货、TS 团队、行为要跨端一致 | 包体/内存最大；每 8 周一个 major 要跟 |
| Tauri 2 | Rust 主进程 + 系统 WebView | HTML/CSS/JS | 要小包体、桌面+移动同栈 | Win 依赖 WebView2、Linux WebKitGTK 分裂；Rust 门槛 |
| Wails 3 | Go 主进程 + 系统 WebView | HTML/CSS/JS | Go 团队、想要原生菜单/托盘/多窗口 | v3 刚稳定（2026-10），生态比 Tauri 小 |
| Flutter Desktop | Skia/Impeller 自绘 + Dart | Flutter Widget | 已用 Flutter 的移动团队 | 不是原生控件；IME/无障碍要自己填坑 |
| RN Windows/macOS | React → 平台原生控件 | React 组件映射 | 已有 RN 移动端、要原生手感 | 版本永远落后 RN core；构建链重（VS/C++） |
| 本地 server + 浏览器 | agent 起 HTTP 服务，浏览器当 UI | 任意 Web 框架 | 0 安装包、内测、远程/多端 | 没托盘/菜单/文件关联；localhost 安全要自己管 |
| .NET WPF | Windows 原生 XAML | XAML + 原生控件 | 纯 Windows、企业环境 | 生态偏老；跨平台无解 |
| WinUI3 / Avalonia | 现代 XAML；Avalonia 跨平台 | XAML + 自绘/原生混合 | Win 现代外观；Avalonia 想跨三平台 | WinUI3 绑定 Windows App SDK 节奏；Avalonia 生态小 |
| Qt(C++/PySide) / SwiftUI | 原生控件 | Qt Widget/QML；SwiftUI | 性能敏感、mac 专属精品 | Qt 许可与 C++ 人力；SwiftUI 只有 mac |

## 3. 交互设计：真正决定"像不像桌面应用"的细节

### 3.1 能力矩阵（对 coding agent 的实际用途）

| 能力 | Electron | Tauri 2 | Wails 3 | Flutter | RN Win/mac | localhost Web | 原生 .NET/Qt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 原生菜单栏 | 有（Menu API） | 有（window menu / 插件）`[S5]` | v3 明确支持原生菜单 `[S12]` | 靠插件 `[社区说法]` | 部分 | 无 | 有 |
| 系统托盘 | 有（Tray） | 插件 tray `[S5]` | v3 明确支持 `[S12]` | 靠插件 | 弱 | 无 | 有 |
| 多窗口 | 有 | 有 | v3 新增多窗口 `[S12]` | 靠插件 | 有 | 浏览器标签页 | 有 |
| 面板拖拽布局 | HTML5 DnD 自建 | 同左 | 同左 | 自建 | 自建 | 同左 | 需自建 |
| 文件拖入拿真实路径 | 需 `webUtils.getPathForFile` `[社区说法]` | 有 drag-drop 事件 | 有 | 有 | 部分 | 受限 | 天然有 |
| 全局快捷键 | 有 | 插件 global-shortcut | 有 | 插件 | 弱 | 无 | 有 |
| 深链接/文件关联 | 有 | 插件 deep-link | 有 | 插件 | 有 | 无 | 有 |

结论：**菜单/托盘/多窗口在 2026 年已经不是跨端的门槛**——Tauri 2 和 Wails 3 都把这几样补上了 `[已验证 S5][S12]`。
Electron 仍然是最"全"的，但差距在缩小；真正难的是下面的 IME、无障碍和终端。

### 3.2 中文 IME：最容易被低估的坑

- Chromium 系（Electron/Tauri/Wails）走系统 IME，桌面端中文输入在 VS Code 这类成熟产品里已被长期验证 `[社区说法]`；
  但**终端组件里**的候选词定位、组合态回显依赖隐藏 textarea + composition 事件，是 xterm.js 类项目的传统难点 `[社区说法]`。
- **Flutter 有实证 bug**：GitHub issue #190042（2026-07-26 提交，2026-08-18 被 bot 关闭）——
  Windows 11 build 26200 上、Flutter 3.47.x 的生产应用，中文输入法（Microsoft Pinyin、WeType）在窗口失焦几分钟再获焦后
  `WM_IME_COMPOSITION` 完全停止，只剩 `WM_KEYDOWN`；根因是 Flutter child HWND 的 IMM32→TSF 会话在焦点恢复后失效；
  workaround 是 `ImmAssociateContextEx(hwnd,nullptr,IACE_DEFAULT)`，issue 正文称当时 master 仍有问题 `[已验证 S13]`。
  → 结论：Flutter 桌面做中文输入的产品，要预留"IE 级 IME 填坑"预算；这不是配置问题，是 engine 与 Win32 输入栈的边界问题。
- 原生 .NET/Qt：直接吃系统 IME，最稳 `[推断]`；SwiftUI 在 macOS 上同理。

### 3.3 无障碍

- Electron 的无障碍 = 网页 a11y：有辅助技术（JAWS/VoiceOver）时 Chromium 自动开 accessibility tree，
  也可 `app.setAccessibilitySupportEnabled(enabled)` 强制开启；用好语义标签才有效 `[已验证 S3]`。
- 原生 .NET/Qt/SwiftUI 直接映射 UIA/NSAccessibility，**这是原生唯一明显赢的一条** `[推断]`。
- Flutter 要维护自己的 semantics 树并桥接到平台（RN 同理），质量取决于控件实现 `[推断]`。

### 3.4 终端 + 编辑器集成（决定"要不要自己做 GUI"）

- **终端**：跨平台 PTY 用 node-pty（Electron）/ portable-pty（Tauri）/ creack-pty（Go）；Windows 底层是 ConPTY。
  Microsoft 的 ConPTY 文档明确：宿主必须自己创建 pseudoconsole、建两条同步管道、**每条通道单独线程 drain，否则会死锁**，
  并且 `ClosePseudoConsole` 有额外死锁风险（2022-09-20 更新）`[已验证 S21]`。→ 这部分工作量在"选哪个 UI 框架"之外，
  任何方案都要写一遍（Web 方案可以直接复用 xterm.js + node-pty，是现成组合）。
- **编辑器**：Monaco/CodeMirror 是 Web 资产；WPF/WinUI/Qt 若要做代码编辑，要么嵌 WebView2，要么忍受自研高亮/折叠/多光标。
- **diff/大文件**：Claude Code 的桌面版在 2026-04-14 的重设计中专门写了"为 large changesets 重做了更快的 diff 查看器"，
  同时加入内置终端、内置文件编辑器、可拖拽面板、并行 session `[已验证 S22]`。
  这是"CLI 优先产品后来补 GUI"最现实的参考样本：**补的是并行编排和审阅，不是把 CLI 包一层**。

## 4. 渲染性能：只给能站得住的数字

### 4.1 公开可核查的数字（按测量对象拆开，不做跨项平均）

| 数字 | 测量对象 / 条件 | 来源与日期 |
| --- | --- | --- |
| 应用可小到 **600 KB** | Tauri 官方首页原文 "the size of a Tauri app can be as small as 600 KB"，指用系统 web renderer 的**最小示例级**包体，不等于真实产品 | tauri.app，2026-11-23 抓取 `[已验证 S6]` |
| Fixed Version WebView2 运行时 **"over 250 MB"**；Bootstrapper 约 **2 MB** | Microsoft 官方分发文档；Bootstrapper 是"下载器"不是运行时 | MS Learn，页面 2025-10-15 更新 `[已验证 S19]` |
| Electron **45.4.1**（2026-11-19 发布）；要求 **Node ≥ 22.12** | npm registry latest 标签 | registry.npmmirror.com，2026-11-23 抓取 `[已验证 S1]` |
| Electron **每 8 周**一个 major；官方只支持**最新 3 个** stable major；breaking change **至少保留 2 个 major** | 官方发布节奏文档（自 Electron 16 起，跟 Chromium 4 周节奏、取偶数 Chromium） | electronjs.org docs，2026-11-23 抓取 `[已验证 S2]` |
| Tauri CLI **2.12.6**（2026-11-18）；Tauri 2.0 stable **2024-10-02** | npm registry + 官方 2.0 发布博客 | registry / v2.tauri.app，2026-11-23 `[已验证 S10][S5]` |
| Wails **v3.0.0 = 2026-10-26**；**v3.1.0 = 2026-11-01**；v2 = 2022-09-22；v3 走**周更**节奏 | 官方博客列表 | wails.io/blog，2026-11-23 抓取 `[已验证 S12]` |
| Flutter 版本线 **3.47.x**（2026 年中）；Windows IME issue **#190042** 2026-07-26 提交 | GitHub issue 正文与复现环境（Win11 build 26200） | github.com/flutter/flutter，2026-11-23 `[已验证 S13]` |
| RN Windows **0.85.2**（2026-11-13 发布）；RN macOS **0.83.0**（2026-09-30 发布）；RN core 0.85.3 | npm registry 发布时间戳 | registry.npmmirror.com，2026-11-23 `[已验证 S14][S15]` |
| Qt **6.12.0 = 2026-09-30**，约**每 6 个月**一个 minor | Qt 官方 wiki 发布说明 | wiki.qt.io/Qt_6.12_Release，2026-11-23 `[已验证 S16]` |
| Avalonia **12.1.6**（2026-11-09）；Windows App SDK tags 到 **v2.7.0**（WinUI3 的 2.x 线） | GitHub releases/tags API | api.github.com，2026-11-23 `[已验证 S17][S18]` |
| VS Code = Electron 应用；xterm.js = VS Code 集成终端内核 | Electron README / xtermjs.org "Real-world uses" | 2026-11-23 抓取 `[已验证 S24][S20]` |

### 4.2 冷启动、内存基线、长列表：为什么这里**没有**公认数字

- Tauri 官方的 benchmark 站点（tauri-apps.github.io/benchmark_results）确实存在，但页面**只有图表、没有文本数字**；
  方法写得很清楚：GitHub Actions runner、hyperfine、3 次预热 + 10 次取平均、只测到 `DOMContentLoaded`；
  **内存/线程数/syscall 只在 Linux 上测**，二进制大小按 release 编译 `[已验证 S8]`。
  → 结论：引用它的"Tauri 比 Electron 快 N 倍"是不严谨的；它是**自家跑自家**、且指标只到首屏事件。
- Electron 官方从不发布"内存基线/冷启动"数字；社区流传的 "Electron 空窗口 100–200 MB" 取决于 Electron 版本、
  是否开 DevTools、渲染进程数量、平台，**不可当成产品级预算** `[社区说法]`。
- 对 coding agent 而言，真正的性能风险点不是空窗口，而是：**长对话/长日志的渲染**（建议虚拟列表 + 环形缓冲，
  不要一次 DOM 全量渲染）、**大 diff**（Monaco 的 diff 有虚拟化，但超大文件仍要分块/lazy）、
  **终端滚屏**（WebGL renderer 打开后可撑 10k+ 行 `[社区说法]`）。
- 可验证的因果关系（比数字更稳）：
  Electron 冷启动要初始化 Chromium + Node 主进程；Tauri 复用系统已安装的 WebView2（Win11 内置，§4.3），
  热启动通常更快 `[推断]`；Flutter 要初始化 engine + Dart isolate 再出首帧，冷启动通常慢于原生 `[推断]`；
  原生 .NET/Qt 直接创建窗口，首帧最快 `[推断]`。
  这些差异对"打开一个 agent 窗口看流式输出"的实际感知影响，**小于** UI 是否做了虚拟化和流式增量渲染 `[推断]`。

### 4.3 Windows 上的运行时依赖（比你选的框架更重要）

- WebView2 分发（Microsoft 官方，2025-10-15 更新）：
  Windows 11 自带 Evergreen Runtime；绝大多数 Windows 10 机器已安装；Evergreen 由微软自动更新、**多个应用共享一份**；
  Fixed Version 则是每个应用自带一份、体积 "over 250 MB"；应用应检测注册表并按需安装 `[已验证 S19]`。
  → Tauri/Wails 的"小包体"是**建立在用户机器已有 WebView2 之上**的；离线/内网/老旧 Win10 环境要自己兜底 `[推断]`。
- Electron 没有这个依赖问题（自带运行时），代价就是包体和内存 `[推断]`。

### 4.4 安装包体积：能说的和不能说的

- Tauri 官方首页给的是"最小示例 600 KB" `[S6]`；官方 App Size 文档（2025-11-04 更新）只教 Cargo 瘦身技巧，
  **没有给任何真实应用 MB 数** `[已验证 S7]`。
- Electron 官方同样不公布数字。公开可验证的是"Electron 应用要打包 Chromium + Node"这一事实 `[已验证 S1][S24]`；
  真实发行包在**几十到一百多 MB** 量级是行业常识，但具体数字随版本/压缩/架构变化，本文不编 `[社区说法]`。
- 对 MewCode 的现实含义：包体 20 MB 还是 150 MB，对开发者工具的用户流失影响远小于"安装要不要签名、要不要管理员权限、
  首次启动要不要下载运行时"；后者才是分发体验的分水岭 `[推断]`。

## 5. 长期维护：真正拖死项目的是这一节

### 5.1 大版本节奏与 breaking change

| 方案 | 节奏 | breaking change 的代价 |
| --- | --- | --- |
| Electron | **每 8 周一个 major**，只保最新 3 个 stable；升级窗口 ≈ 24 周 `[S2]` | 官方承诺 breaking 至少留 2 个 major 再删；但 Chromium/Node 升级会带来行为漂移（尤其原生模块 ABI、DevTools 协议）`[推断]` |
| Tauri | 1.0 (2022-06) → 2.0 (2024-10) 用了 2 年多；2.0 引入插件化、IPC 重写、移动端 `[S5]` | 1→2 是"插件几乎全换、权限模型重写"级别的大迁移，社区项目有较长迁移期 `[社区说法]` |
| Wails | v2 → v3 从 2021 拖到 2026-10 才 stable；v3 之后改**周更** `[S12]` | 周更意味着 API 还在动；跟最新版要能承受 changelog 阅读成本 `[推断]` |
| Flutter | 稳定版约季更；桌面 2022 起 stable `[社区说法]` | 升级通常平滑，但 plugin 生态（尤其桌面 plugin）滞后；IME/无障碍类 bug 要自己填 `[S13]` |
| RN Windows/macOS | 跟 RN core 走，但**常落后**：RN macos 0.83 vs RN core 0.85（2026-09 vs 2026-11）`[S14][S15]` | 版本绑定很硬：RNW 与 RN core、React 版本必须对齐；Windows 构建还要 VS/C++ 工具链 `[已验证 S14]` |
| Qt | minor 约每 6 个月（6.12 = 2026-09-30）`[S16]`；LTS 才有长期支持 | C++ ABI/Qt 版本迁移、商业许可与 LGPL 合规要提前设计 `[推断]` |
| .NET WPF/WinUI3/Avalonia | .NET 年度 LTS + Windows App SDK 2.x `[S18]` | WPF 稳定但"不再进化"；WinUI3 随 WASDK 有 breaking；Avalonia 12 仍在快速迭代 `[S17]` |
| SwiftUI/AppKit | 跟 macOS 年度版本 | 只有 mac 平台，跨端需求出现时无退路 `[推断]` |

### 5.2 生态 churn 与招人

- **Web 前端人才池最大**，Electron/Tauri/Wails 的 UI 层都是同一套 React/Vue/Svelte 技能，可复用 `[推断]`。
  这也是 Electron 长期"不好但没人不用"的根本原因：**人力便宜且可替换**。
- Tauri 的 UI 层一样是 Web，但**主进程要 Rust**；能用 Rust 写桌面业务逻辑的人明显少于前端 `[推断]`。
  Tauri 团队 113,169 stars（2026-11-23）说明生态健康，但"会 Rust"的招聘面窄 `[已验证 S11]`。
- Wails 用 Go：Go 人才多、单二进制分发爽；但 Wails 生态（插件、示例、问答）比 Tauri 小一个量级 `[推断]`。
- Flutter/Dart：移动端团队转桌面最顺；但"桌面 + 中文 IME + 无障碍"要自己填，招聘池小于 Web `[推断]`。
- Qt/C++：桌面工业界最成熟的栈，但 C++ 桌面人才贵、迭代慢；PySide 适合内部工具，不适合交付给终端用户的精致客户端 `[推断]`。
- SwiftUI：只适合 mac-only 精品；与 MewCode 的 Windows 优先目标不匹配 `[推断]`。

### 5.3 Windows 代码签名 + 自动更新（所有方案共同成本）

- 签名：Tauri 官方文档写得很直白——Windows 上不签名，浏览器下载会被 SmartScreen 拦；**2024 年起 Microsoft 取消了 EV 证书的
  "即时信誉"特权**，EV 和 OV 都要靠发布历史攒信誉；OV 更便宜、个人可申请；Windows 11 开了 Smart App Control 时
  **未签名 app 会被直接拦，用户不能单独放行，只能整个关掉** `[已验证 S9]`。
  → 不管选 Electron 还是 Tauri，这笔钱和流程都要付。
- 自动更新：
  - Electron 内置 `autoUpdater`（基于 Squirrel），官方还提供免费的 update.electronjs.org（要求公开 GitHub 仓库 + GitHub Releases；
    macOS 还要求签名），默认启动时检查、之后每 10 分钟检查一次；也可以自建 Hazel/Nuts/Nucleus `[已验证 S4]`。
  - Tauri 用 updater 插件：静态 JSON 或动态 server 都支持，Windows 有 install mode；签名与更新是两套配置 `[已验证 S5][社区说法]`。
  - Wails v3 自带 updater（发布说明列为 v3 的卖点之一）`[已验证 S12]`。
  - 结论：**自动更新在 2026 年是"库级问题"，不是差异化优势**；真正麻烦的是签名证书、CI 里的密钥管理、回滚策略 `[推断]`。
- macOS 公证需要 Apple Developer Program（约 $99/年，需企业/个人账号审核）`[社区说法]`；Linux 要出 deb/rpm/AppImage/Flatpak 中至少两种 `[推断]`。
- 三平台成本粗略排序（人力）：**Windows 签名+更新 < macOS 签名+公证 < Linux 发行版矩阵**；Web 壳方案能把 UI 成本压到一份，但发布流水线仍要三套 `[推断]`。

## 6. 架构复用：别让 GUI 逼你重写核心

### 6.1 推荐架构（对 MewCode 这种 CLI 优先产品）

```
            ┌──────────────── Agent Core（库/进程）────────────────┐
            │  会话/工具调用/权限/MCP/上下文管理/流式事件  —— 唯一真相 │
            └───────┬───────────────┬───────────────┬─────────────┘
                    │ 进程内调用      │ stdio/JSON-RPC │ HTTP+SSE (localhost)
              CLI (argv)          TUI (Ink/BubbleTea)   ├── 浏览器 UI（0 安装）
                                                       ├── 桌面壳（Electron/Tauri，加载同一份前端）
                                                       └── VS Code 扩展 / IDE 插件
```

- 关键约束：**核心不 import 任何 UI 框架**；UI 只消费"事件流 + 命令 API"。这样 GUI 只是第二个客户端。
- 反面教材（会逼你重写核心）：把 agent loop 写进 Electron 主进程的 IPC handler、写进 Flutter 的 Dart 业务层、
  写进 SwiftUI 的 ObservableObject。一旦绑定，换 UI = 重写 `[推断]`。
- Claude Code 的演化验证了这个方向：2026-04-14 的桌面重设计里，桌面版**与 CLI 插件行为对齐**，
  并复用同一条会话/插件体系，只是多了并行 session、内置终端、编辑器、diff、预览 `[已验证 S22]`。
  即"先有核心与 CLI，再补一个更强的客户端"，而不是"先做 GUI 再反推 CLI"。

### 6.2 哪些 GUI 方案会逼你重写核心

| 方案 | 是否逼你绑定 | 原因 |
| --- | --- | --- |
| Electron/Tauri/Wails + localhost 服务 | 不会 | 前端只发 HTTP/WS；CLI 与 GUI 共用同一服务 `[推断]` |
| Electron 但逻辑写在主进程 | 会 | 主进程 = Node 专属；CLI 复用要抽包 `[推断]` |
| Flutter | 会（若逻辑写 Dart） | Dart 生态与 TS/Go/Rust 核心不共享；只能把核心做成独立进程/FFI `[推断]` |
| RN Windows/macOS | 会（若逻辑写 JS 层） | 业务可共享 JS，但原生模块与构建链把桌面与移动绑在一起 `[推断]` |
| 原生 .NET/Qt/SwiftUI | 会（最重） | 终端/编辑器/diff 都要重写；核心只能用子进程/HTTP 调 `[推断]` |
| 本地 server + 浏览器 | 不会 | 核心即服务；UI 随便换 `[推断]` |

## 7. 决策建议

### 7.1 CLI 优先的产品，什么时候值得做 GUI

满足以下**两条以上**再做（否则先加 TUI 能力，或做 VS Code 扩展）：

1. **并行编排**：用户要同时跑多个长任务、跨仓库切换、随时插话/接管（Claude Code 桌面版的核心卖点就是这个）`[S22]`。
2. **审阅密集**：大量 diff、截图、PDF、网页预览，终端里看不舒服 `[S22]`。
3. **非终端用户**：产品/设计/管理者要看 agent 干了什么、点"批准"。
4. **系统集成**：托盘常驻、系统通知、右键"用 MewCode 打开"、文件关联。
5. **分发摩擦**：目标用户装 CLI 的成本高于装一个 app（Windows 上尤其明显）。

反之，**不要**为了"看起来像个产品"而做 GUI：把 CLI 包进 Electron 窗口，只会得到"更慢的终端"。

### 7.2 只做 Windows 时，哪条路最省

按"从 0 到能发给别人用"的总成本（人力 + 分发 + 维护）：

| 顺序 | 路径 | 省在哪 | 什么时候别选 |
| --- | --- | --- | --- |
| 1 | 本地 server + 浏览器（`http://127.0.0.1:PORT`，带一次性 token） | 0 安装包、0 签名、0 更新；核心直接复用；一两天能出原型 | 要托盘/通知/文件关联；用户不接受"开浏览器" |
| 2 | **Electron** | 生态最全：自动更新、崩溃上报、签名打包（Forge/electron-builder）都是现成；TS 团队零学习成本 | 在意包体/内存；团队没人愿意跟 8 周一个 major |
| 3 | **Tauri 2** | 包体小、内存低、托盘/菜单/多窗口/updater 齐；Windows 上 WebView2 基本白送 | 团队没有 Rust；要绝对一致的跨端渲染 |
| 4 | WinUI3 / Avalonia | 无 WebView 开销、系统集成最顺 | 你要自己写终端/编辑器/diff；WinUI3 跟 WASDK 节奏 |
| 5 | WPF | 团队已有 C#/.NET 时最省事，成熟稳定 | 想要现代外观/跨平台；新项目不建议从零选 |

如果**只做 Windows 且团队是 C#**：WinUI3 + WebView2 混合（壳用原生、终端/编辑器用 WebView2 嵌 Monaco+xterm.js）
是"体验最好/工作量可控"的折中；纯 WPF 只适合内部工具 `[推断]`。

### 7.3 "跨端 vs 原生" 5 条直白总结

1. **GUI 的护城河在终端/编辑器/diff/预览，这四样 Web 最强。** 选原生 = 自己造这四样，或用 WebView 嵌——那就不是原生了。
2. **跨端省 UI 人力，不省分发。** 签名、SmartScreen、更新、公证、Linux 打包，所有路线都要做一遍（§5.3）。
3. **Electron 与 Tauri 的分水岭是"运行时谁付账"**：Electron 自带 Chromium（大而一致），Tauri 用系统 WebView（小而分裂，
   Windows 靠 WebView2、Linux 靠 WebKitGTK）`[S6][S19]`。先问"目标用户机器上有没有 WebView2"，再问"团队有没有 Rust"。
4. **原生只在"Windows-only + 性能/系统集成是卖点 + 有 C#/C++ 人"时赢**；Flutter/Qt 做 IDE 类产品，是把 Web 生态优势换成
   "自己修 IME/无障碍/文本渲染"的账单（Flutter 的 2026 年 IME bug 就是账单样本）`[S13]`。
5. **架构上永远是"核心 > 客户端"。** 核心做成本地服务/库，CLI/TUI/GUI/Web/IDE 插件都只是消费者；
   先 localhost Web 验证，再决定包不包壳。这样 GUI 是加分项，不是重写核心的理由。

## 8. 最大的不确定性（诚实清单）

1. **没有可信的跨框架性能数字。** 官方 benchmark 只有图表且只测 Linux 内存（§4.2）；社区数字测量条件不明。
   若要做决策，应在自己的目标机器上用同一份前端代码分别跑 Electron/Tauri/本地 Web，测"冷启动到可交互""空载内存""1 万行日志滚动帧率"。
2. **Flutter 桌面 IME 是否已在 2026 年底修复未验证。** issue 被 bot 关闭不等于修复；需在 Win11 + 微软拼音/微信输入法上实测 `[推断]`。
3. **Tauri 2 的 Windows 行为一致性**（WebView2 版本差异、企业环境禁用、离线安装）没有官方量化数据；内网/离线场景要另做验证 `[推断]`。
4. **Electron 真实包体/内存数字** 未取到官方或可复现来源，本文只给量级判断 `[社区说法]`。
5. **Claude Code 桌面版的技术栈未知**（官方未公开）；本文只把它当"GUI 形态与功能取舍"的参考，不当作框架选型证据 `[推断]`。

## 9. 来源清单（抓取/发布日期）

- S1 Electron npm latest：https://registry.npmmirror.com/electron/latest（2026-11-19 发布，2026-11-23 抓取）
- S2 Electron 发布节奏：https://www.electronjs.org/docs/latest/tutorial/electron-timelines（2026-11-23 抓取）
- S3 Electron 无障碍：https://www.electronjs.org/docs/latest/tutorial/accessibility（2026-11-23 抓取）
- S4 Electron 自动更新：https://www.electronjs.org/docs/latest/tutorial/updates（2026-11-23 抓取）
- S5 Tauri 2.0 发布 + Windows 签名 + 托盘/菜单/多窗口：https://v2.tauri.app/blog/tauri-20/ 、https://v2.tauri.app/distribute/sign/windows/（2026-11-23 抓取）
- S6 Tauri 首页"600 KB"原文：https://tauri.app/（2026-11-23 抓取）
- S7 Tauri App Size 文档：https://v2.tauri.app/concept/size/（页面 2025-11-04 更新，2026-11-23 抓取）
- S8 Tauri 官方 benchmark：https://tauri-apps.github.io/benchmark_results/（2026-11-23 抓取）
- S9 Tauri Windows 签名文档（EV 2024 变化、Smart App Control）：https://v2.tauri.app/distribute/sign/windows/（2026-11-23 抓取）
- S10 Tauri CLI npm：https://registry.npmmirror.com/@tauri-apps/cli/latest（2.12.6，2026-11-18 发布）
- S11 tauri-apps/tauri 仓库元数据：https://api.github.com/repos/tauri-apps/tauri（113,169 stars，2026-11-23）
- S12 Wails 博客：https://wails.io/blog/（v3.0.0 2026-10-26、v3.1.0 2026-11-01、v3 beta 2026-08-02、v2 2022-09-22，2026-11-23 抓取）
- S13 Flutter Windows 中文 IME issue #190042：https://github.com/flutter/flutter/issues/190042（2026-07-26 提交，2026-08-18 关闭）
- S14 RN Windows npm：https://registry.npmmirror.com/react-native-windows/latest（0.85.2，2026-11-13 发布）
- S15 RN macOS npm：https://registry.npmmirror.com/react-native-macos/latest（0.83.0，2026-09-30 发布）
- S16 Qt 6.12 发布说明：https://wiki.qt.io/Qt_6.12_Release（6.12.0 = 2026-09-30，页面 2026-11-18 编辑）
- S17 Avalonia releases：https://api.github.com/repos/AvaloniaUI/Avalonia/releases（12.1.6 = 2026-11-09）
- S18 Windows App SDK tags：https://api.github.com/repos/microsoft/WindowsAppSDK/tags（v2.7.0）
- S19 WebView2 分发：https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution（页面 2025-10-15 更新）
- S20 xterm.js 首页（VS Code 终端使用）：https://xtermjs.org/（2026-11-23 抓取）
- S21 ConPTY 宿主实现：https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session（页面 2022-09-20 更新）
- S22 Claude Code 桌面版重设计：https://claude.com/resources/articles/claude-code-desktop-redesign（2026-04-14 发布）
- S23 Claude 桌面下载页（macOS/Windows/ARM64/Store/Linux 文档）：https://claude.com/download（2026-11-23 抓取）
- S24 Electron README（VS Code 使用 Electron）：https://github.com/electron/electron（2026-11-23 抓取）
