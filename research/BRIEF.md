# 团队简报：MewCode 类 CLI Coding Agent 技术选型调研

## 背景与目标

用户想在 `D:\workplace\AIAgent\MewCode` 从零实现一个类似 Claude Code 的 **CLI Coding Agent**
（参考项目：小林coding《MewCode Agent》 https://www.xiaolincoding.com/project/mewcode.html ——
该项目为付费课程，已实现 Java / Go / Python / TS 四个版本，每个版本用各自生态的成熟 TUI 框架；
课程本身不开源，不得抓取/复制付费内容，只可作为"参考架构"提及）。

用户要的是一份**技术选型决策依据**，共三问：

1. **盘点现有开源项目使用的技术栈**（语言、运行时、TUI/GUI 框架、分发方式、维护状态）。
2. **对比跨端框架与原生语言**在 **交互设计、渲染性能、长期维护** 上的优劣；
   并说明 **我（AI Agent）对相应语言的掌握程度**，方便用户判断"AI 能否替我把它写出来"。
3. 用**清晰直白的语言**说明各自优劣，方便用户做判断。

## 交付物与分工（写入范围严格隔离）

| 文件 | 负责人 | 内容 |
|---|---|---|
| `research/01-oss-survey.md` | 队友 A | 开源 CLI Coding Agent 技术栈盘点 |
| `research/02-tui-frameworks.md` | 队友 B | TUI 框架横向对比（交互/渲染/维护） |
| `research/03-desktop-frameworks.md` | 队友 C | 桌面端"跨端框架 vs 原生"延伸对比 |
| `技术选型报告.md` | Lead | 汇总、交叉核验、决策矩阵与最终建议 |

**只写自己名下的文件，不要修改他人文件或 BRIEF。**

## 写作要求

- 中文为主，专有名词保留英文（Ink、Bubble Tea、Ratatui…）。
- 先给**结论/表格**，再给论据与细节；每条关键事实带 **来源 URL** 与信息日期。
- 事实分级标注：`[已验证]`（亲自 fetch 到源码/README/registry 数据）、`[社区说法]`（博客/逆向/二手）、`[推断]`（基于证据的合理推断）。不确定就写不确定。
- 数字（star 数、release 日期、内存/启动耗时）必须带抓取/发布日期；测得的性能数字注明条件，不要假装有统一 benchmark。
- 重点回答"**对做一个 Claude Code 类产品意味着什么**"，不要写成框架 API 文档。
- Markdown 表格 + 短段落；总长 ≤ 400 行/文件。

## 环境与工具

- 当前日期：**2026-11-23**（时区 Asia/Shanghai）。研究"当前状态"以此为准。
- 外网需代理：`http://127.0.0.1:7890`（Clash，HTTP/HTTPS/SOCKS 同一端口）。
  - `web_search` / `web_fetch` 工具可直接用（优先）。
  - 需要 `curl`/`Invoke-WebRequest`/`npm view` 时，在 pwsh 里设置
    `$env:HTTP_PROXY='http://127.0.0.1:7890'; $env:HTTPS_PROXY='http://127.0.0.1:7890'`。
  - 内置 pwsh 在默认沙箱下会 0xC0000142 崩溃，**必须带 `sandbox_permissions: "danger-full-access"`**。
- 直连可用：`api.github.com`（README/仓库元数据）、`registry.npmmirror.com`（npm 元数据）。
- 判断项目技术栈时，**别只信记忆**：去 fetch 仓库的 `package.json` / `Cargo.toml` / `go.mod` /
  `pyproject.toml` / README 的 Requirements 段。模型训练数据可能过时。

## 完成后

1. 写入自己文件；
2. `team_task_update` 把自己的任务 complete；
3. `send_message` 给 `lead`：3–8 行摘要（核心结论 + 你最不确定的 1–2 点 + 文件路径）。
