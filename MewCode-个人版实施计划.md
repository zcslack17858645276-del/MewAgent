# MewCode 个人版实施计划

> 照着网站里那个项目，做一个 2–3 周能跑起来、能写进简历、也能日常用的 CLI Coding Agent（精简版）。
> 配套阅读：[技术选型报告.md](技术选型报告.md)（开源盘点 / 跨端对比 / 语言掌握）
> 开发仓库：<https://github.com/zcslack17858645276-del/MewAgent>（私有）｜开工前先读 [HANDOFF.md](HANDOFF.md)

---

## 0. 一句话结论

- 网站里的 MewCode **不是**一个庞大工程：官方 FAQ 原话是"项目本身实现规模不大"，自己动手做一遍约 **3–4 周**，17 章、40w+ 字、Java/Go/Python/TS 四语言版本。
- 它功能对标 Claude Code 的 13 项能力，但**那是课程目标，不是首版目标**。个人开发砍到 **60% 功能（P0）**，2–3 周就能做出"能读代码、能改代码、能跑命令、动手前会问你"的版本。
- 首版默认栈：**TypeScript + Ink**（最快复刻、AI 生成质量最高、我最能帮上忙）；如果你要单 exe / 中文输入必须稳，直接选 **Go + Bubble Tea**，别中途重写。

---

## 1. 网站里的项目：是什么、什么规模

公开页面（2026-11-23 抓取）给出的信息：

| 项目 | 事实 |
|---|---|
| 定位 | 类 Claude Code 的终端编程 Agent（CLI Coding Agent），从 0 造一个 |
| 功能 | 13 项：6 工具、ReAct Agent Loop、MCP、Skill、Slash Command、Hook、5 层权限、上下文压缩、跨会话记忆、SubAgent、Git Worktree、Agent Teams、流式多轮对话 |
| 架构 | 5 层：交互层 / 引擎层 Core / 工具层 / 记忆层 / 安全层 |
| 教程 | 17 章、40w+ 字，每章"理论学习 + Vibe Coding 实战 + 源码分析"三件套 |
| 语言版本 | Java / Go / Python / TS **四个版本都实现了**，每个版本用各自生态里成熟的 TUI 框架；只学自己那门即可 |
| 学习方式 | 飞书图文文档，**无视频**；配答疑群；提供四语言源码 |
| 周期 | 只看理论 + 源码约 2 周；自己动手实现 + 面试准备约 3–4 周 |
| 开发方式 | 全程用 Claude Code 等 AI 工具 Vibe Coding；用 Spec 三件套（spec.md / tasks.md / checklist.md）+ CLAUDE.md 约束 AI |
| 规模 | 官方明确说"实现规模不大"，token 消耗不高；用 DeepSeek 等便宜模型也能做完 |
| 其他 | 50+ 道项目面试题、4 种简历写法（按语言）；课程不开源，源码随课程提供 |

**关键结论**：这个项目的"大"是**功能覆盖面大 + 教程字多**，不是代码量大。个人完全可以做同构的精简版。

---

## 2. 四语言版本：各自可能用什么 TUI 框架

课程公开页只写"每个版本都用各自生态里成熟的 TUI 框架"，**没有点名具体框架**。以下是按生态主流做的推断，标注置信度：

| 语言 | 最可能的 TUI 方案 | 依据 | 置信度 |
|---|---|---|---|
| TypeScript | **Ink**（React for CLI） | Claude Code 早期、Gemini CLI、Qwen Code 都用 Ink；TS 生态事实标准 | 高 [推断] |
| Go | **Bubble Tea**（+ Bubbles / Lip Gloss） | Go 生态最成熟的 TUI；社区学员复刻版多采用 | 高 [推断] |
| Python | **Textual**（或 prompt_toolkit + Rich） | 已发现学员复刻用 Textual（26★）；Textual 是 Python 最完整 TUI | 中 [推断] |
| Java | **JLine3**（行编辑/输入）+ Lanterna（全屏）或 JLine3 自绘 | Java 生态没有"开箱即用"的全屏 TUI 框架，通常两件套组合 | 中 [推断] |

> 说明：以上是生态推断，不是课程官方信息。你若买课，以课程为准；不买课也完全不影响自己实现——**选语言只看两件事：你熟不熟、该语言 TUI 框架成不成熟**（课程 FAQ 自己也是这么说的）。

---

## 3. 教程的"流程"长什么样（这才是可复用的部分）

### 3.1 每一章的固定节奏

```
理论学习（原理 + 图解）
   ↓
Vibe Coding 实战（按 spec.md → tasks.md → checklist.md 推进）
   ↓
源码分析（Java / Python / Go / TS 四版本对照）
```

### 3.2 开发流程 = Spec 驱动 + CLAUDE.md

这是课程最值得抄的方法论，和个人/团队无关：

1. `spec.md`：这个模块**做什么、不做什么、验收标准**（给 AI 的施工图纸）
2. `tasks.md`：拆成可勾选的小任务（每项 ≤ 半天）
3. `checklist.md`：做完逐项验收，防止 AI"看起来做了"
4. `CLAUDE.md`（或 AGENTS.md）：项目规则——目录约定、代码风格、禁止事项、常用命令

每一步只让 AI 做一个小任务，做完就跑、就验收。**这比"一句话让 AI 写个 Claude Code"靠谱一个数量级。**

### 3.3 模块顺序（从公开技能树归纳）

```
① 基础对话：System Prompt、LLM API、流式响应、多轮对话、对话管理器
② Agent 核心：Function Calling、工具系统、ReAct、Agent Loop、事件流
③ 能力扩展：MCP、Skill、Slash Command、Hook
④ 工程化：权限防御、上下文压缩、Token 管理、会话持久化、跨会话记忆
⑤ 多 Agent：SubAgent、Git Worktree、Agent Teams
⑥ AI 编程实战：Vibe Coding + Spec 开发模式 + CLAUDE.md
```

### 3.4 落地时的真实编码顺序（和架构图相反）

5 层架构图是"自下而上"画的（安全层/记忆层是地基），但**写代码必须从能跑开始**：

```
引擎 Loop → 工具 → 安全闸 → TUI 打磨 → 记忆/压缩 → 扩展（MCP/Skill/Hook）→ 多 Agent
```

先让"模型能调一个工具"跑通，再谈界面好看。这个顺序对个人开发尤其重要——**每周都有能演示的东西**，才不会烂尾。

---

## 4. 个人版范围：MewCode-lite

### 4.1 砍法

| 能力 | P0 首版（必做） | P1 二期（锦上添花） | P2 以后 / 不做 |
|---|---|---|---|
| 流式多轮对话 | ✅ | | |
| 6 大工具 | ✅ Read/Write/Edit/Bash 先做，Glob/Grep 同周补 | | |
| Agent Loop（ReAct） | ✅ 多轮 tool call + 终止条件 | | |
| 权限防御 | ✅ 简化 3 级：读自动 / 写与命令必确认 / 危险命令硬拦 | 会话内"总是允许" | 5 层纵深、工具过滤 |
| TUI | ✅ inline 模式 + 输入框 + 工具调用行 + diff + 审批 | 语法高亮、折叠、主题 | 动画、花哨面板 |
| Slash Command | ✅ /help /clear /model 三个 | /compact /init | 自定义命令加载 |
| 会话持久化 | ✅ JSON 落盘、启动恢复 | 多会话列表/切换 | 数据库 |
| 上下文压缩 | ✅ token 估算 + 超阈值摘要 + 工具结果截断 | 分层保留策略 | 精细注入/溢写 |
| 跨会话记忆 | | ✅ 一个 memory.md（项目级） | 用户级多层记忆 |
| MCP | | ✅ 官方 SDK 接 1 个 stdio server | 市场/多 server 管理 |
| Skill 技能包 | | | ✅ 有余力再做 |
| Hook 生命周期 | | | ✅ 有余力再做 |
| SubAgent | | | ✅ 有余力再做 |
| Git Worktree 隔离 | | | ❌ 个人项目 ROI 低 |
| Agent Teams | | | ❌ 同上 |
| Plan 模式 | | | ✅ 有余力再做 |

**P0 代码量估算：2,500–4,000 行**（含 TUI；核心 loop+工具约 1,000 行，UI 约 800 行，其余是配置/安全/会话）。按每天 3–4 小时有效开发，**10–15 天**。

### 4.2 与课程项目的差距

| 维度 | 课程项目 | 你的个人版 |
|---|---|---|
| 功能 | 13 项全量 | 先 8 项，够用 |
| 语言 | 四语言版本 | 只做 1 门 |
| 周期 | 3–4 周（自己实现） | 2–3 周 |
| 目标 | 面试考点全覆盖 | 跑通 + 能讲清 3 个设计决策 |
| 代码量 | 未公开，官方说"规模不大" | 3–4k 行 |

---

## 5. 技术栈怎么选（个人开发版）

### 5.1 三条选择规则

1. **用你最熟的语言**——AI 写的代码出问题时，你得能自己 debug。
2. **该语言必须有成熟 TUI 框架**——这是课程 FAQ 自己给的前提。
3. **首版不追性能**——渲染性能瓶颈在"流式高频 diff / IME / scrollback"，不在语言；先跑通再优化。

### 5.2 组合对比

| 组合 | 首版速度 | 中文 IME | 分发 | 长期维护 | 适合谁 |
|---|---|---|---|---|---|
| **TS + Ink** | ★★★★★ 最快 | ★★ 弱（Ink 的 IME 修复 PR 长期未合并） | npm/npx 容易 | ★★★ 中 | 有 JS/TS 基础、想最快看到 Claude Code 形态 |
| **Go + Bubble Tea v2** | ★★★★ 快 | ★★★★★ 最好 | 单二进制，最优 | ★★★★★ 好 | 想做成日常工具、要单 exe、中文输入必须稳 |
| Python + Textual | ★★★★ 快 | ★★★ 中（有修复 PR） | ★★ 打包麻烦 | ★★★ 中 | 熟 Python、快速验证想法 |
| Java + JLine3/Lanterna | ★★ 慢 | ★★★ 中（JLine3 修过 Windows 中文） | jar 可 | ★★★ 中 | Java 背景、主要为了写简历 |
| Rust + ratatui | ★★ 慢 | ★★★★ 好 | 单二进制 | ★★★★ 好 | 追求性能/分发且愿意慢慢写 |

### 5.3 我的默认建议

**选 TypeScript + Ink，如果你：**
- 写过 JS/TS（哪怕只是前端）；
- 想一周内看到"这不就是 Claude Code 嘛"的效果；
- 日常下指令可以接受中英混输。

理由：形态最像（Claude Code 早期就是 Ink/React）、AI 生成质量最高、npm 生态和示例最多、我最能直接帮你写和改。

**选 Go + Bubble Tea，如果你：**
- 想做成一个 exe 扔给朋友用；
- 主要用中文和 Agent 对话，不能接受输入法偶发问题；
- 愿意为此多花 3–5 天。

**Day 0 的 30 分钟 spike（先做这个再决定）：**
在 Windows Terminal 里用 Ink 写一个 10 行的输入框，用微软拼音输入中文，检查光标、候选框、删除是否正常。**坏了就选 Go**——这是唯一值得在第一天做的技术验证。

**不建议首版用 Java / Rust**：Java 的 TUI 生态最弱、开发最慢；Rust 学习曲线会吃掉你的热情。除非你本来就熟。

**不建议首版做桌面 GUI**：网站项目本身就是 TUI；GUI 以后用"核心做成库/本地服务 + 套壳"的方式补，成本最低。

---

## 6. 三周实施流程（每天做什么）

> 按每天 3–4 小时算；只有 2 周就把第 3 周的 D13–D15 砍掉。

### 第 1 周：能对话 + 能读代码

| 天 | 任务 | 验收 |
|---|---|---|
| D1 | 建项目、选模型 API、写 spec.md/tasks.md/checklist.md/CLAUDE.md、跑通 hello world | `npm run dev` 能启动 |
| D2 | LLM 流式客户端 + 多轮消息结构（OpenAI 兼容或 Anthropic 协议） | 终端里流式打印回复 |
| D3 | Ink TUI 骨架：消息列表 + 输入框 + 状态行（模型/token） | 能输入、能显示流式回复 |
| D4 | 工具注册表 + ReadFile / Glob / Grep（带工作区路径校验） | Agent 能读 README 并复述 |
| D5 | Agent Loop 第一版：单轮 tool call（模型要工具→执行→回填→再问模型） | 问"这个项目干嘛的"，它自己读文件后回答 |

**周验收**：能完成"读文件 + 回答"的完整闭环。

### 第 2 周：能改代码 + 安全

| 天 | 任务 | 验收 |
|---|---|---|
| D6 | Agent Loop 完整版：多轮 tool call、终止条件、错误回填 | 连续调 3 个工具完成一个任务 |
| D7 | WriteFile / EditFile（精确字符串替换）+ diff 展示 | 让它改一行代码，diff 正确 |
| D8 | Bash 工具：超时、输出截断（30KB）、危险命令黑名单（rm -rf / format / del /f 等） | 跑 `npm test` 并总结结果 |
| D9 | 权限审批 UI：y（本次）/ a（本会话总是）/ n（拒绝），拒绝后模型收到拒绝原因 | 拒绝后它不会硬来 |
| D10 | 会话持久化 + /help /clear /model | 重启后恢复上次对话 |

**周验收**：给它一个真实小 bug（改文件 + 跑测试），能端到端修好。

### 第 3 周：像个产品 + 收尾

| 天 | 任务 | 验收 |
|---|---|---|
| D11 | Token 估算 + 超阈值压缩：摘要旧消息、保留最近 N 轮、截断旧工具结果 | 连续聊 50 轮不爆上下文 |
| D12 | TUI 打磨：流式 markdown、工具调用折叠、错误红字、终端 resize 不崩 | 演示效果接近截图 |
| D13 | MCP 接入（官方 SDK + 1 个 stdio server 示例） | 能在 Agent 里调用外部 MCP 工具 |
| D14 | memory.md 记忆文件 + system prompt 迭代（含"先读再改""改前确认"规则） | 新会话记得项目约定 |
| D15 | 打包（npx 或单文件）+ README + 3 分钟 demo + 简历三句话 | 别人一条命令能跑 |

**最终验收**：见 §8 清单。

---

## 7. 代码结构（TS + Ink 版）

```
mewcode/
├─ package.json
├─ tsconfig.json
├─ CLAUDE.md                  # 给 AI 的项目规则
├─ docs/
│  ├─ spec.md                 # 需求与验收
│  ├─ tasks.md                # 任务拆解
│  └─ checklist.md            # 逐项验收
├─ src/
│  ├─ index.ts                # 入口：参数解析、启动 TUI
│  ├─ config.ts               # 模型、API key、工作区路径
│  ├─ llm/
│  │  ├─ client.ts            # 流式调用、重试、错误处理
│  │  └─ types.ts             # 消息/工具调用/停止原因
│  ├─ agent/
│  │  ├─ loop.ts              # Agent Loop 主循环
│  │  ├─ messages.ts          # 消息构造与 tool_result 回填
│  │  └─ prompt.ts            # system prompt
│  ├─ tools/
│  │  ├─ registry.ts          # 工具注册 + JSON Schema
│  │  ├─ readFile.ts  writeFile.ts  editFile.ts
│  │  ├─ bash.ts      glob.ts       grep.ts
│  │  └─ paths.ts             # 工作区边界校验（防 ../ 逃逸）
│  ├─ safety/
│  │  ├─ permissions.ts       # 审批闸门
│  │  └─ danger.ts            # 危险命令规则
│  ├─ context/
│  │  ├─ tokens.ts            # token 估算（js-tiktoken 粗算）
│  │  └─ compress.ts          # 摘要压缩
│  ├─ session/
│  │  └─ store.ts             # JSON 会话读写
│  └─ ui/
│     ├─ App.tsx              # Ink 根组件
│     ├─ Message.tsx  ToolCall.tsx  Diff.tsx
│     ├─ Approval.tsx         # 审批交互
│     └─ Input.tsx            # 输入框（IME 兼容处理）
└─ tests/
   ├─ tools.test.ts
   └─ loop.test.ts            # 用 mock LLM 测循环
```

**数据流（全部事件化）：**

```
用户输入 → messages[]
   → llm.stream() 产出事件：text_delta / tool_use / stop
   → TUI 实时渲染 text_delta
   → tool_use：权限闸门 → 执行 → tool_result 回填 messages
   → 回到 llm.stream()
   → 模型不再返回 tool_use ⇒ 本轮结束
```

**三个关键接口（先定协议，再写实现）：**

```ts
// 1) 工具统一形状：一句话描述 + JSON Schema + 执行函数
type Tool = {
  name: string;
  description: string;                 // 模型靠它决定用不用
  parameters: JSONSchema;              // 模型靠它填参数
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
};

// 2) Agent Loop：终止条件是协议判断，不是关键词匹配
while (true) {
  const res = await llm.stream(messages, tools);   // 流式
  if (res.stopReason !== "tool_use") break;        // 关键
  for (const call of res.toolCalls) {
    const verdict = await gate(call);              // 权限闸门
    const result = verdict.denied
      ? { ok: false, error: verdict.reason }       // 拒绝也要回填
      : await registry.run(call);
    messages.push(toolResult(call.id, result));
  }
}

// 3) 权限闸门：三道，按顺序
function gate(call: ToolCall): Promise<Verdict> | Verdict {
  if (!isInsideWorkspace(call)) return deny("路径越界");     // ① 硬边界
  if (isDangerous(call))        return deny("危险命令");     // ② 黑名单
  if (call.name === "ReadFile" || call.name === "Glob"
      || call.name === "Grep")  return allow();             // ③ 读操作放行
  return askUser(call);                                     // 写/命令必问
}
```

---

## 8. 从网站项目抄的 6 个关键设计决策

1. **Loop 终止条件用协议判断**：模型不再返回 `tool_use` 即结束，不要硬编码"完成"关键词。
2. **工具统一注册表 + JSON Schema**：新增工具只改注册表，不碰主循环。
3. **权限三道闸**：工作区边界 → 危险命令黑名单 → 写/命令人工确认；拒绝也要把原因回填给模型。
4. **上下文分层**：system prompt 常驻、最近 N 轮原文、旧工具结果截断、超阈值摘要压缩。
5. **session 与 memory 分离**：session 是本次对话，memory.md 是跨会话项目约定——不要混在一起。
6. **UI 事件驱动**：所有界面元素由事件流驱动，以后换 OpenTUI / Web / GUI 只换渲染层。

---

## 9. 验收清单（做完逐项打勾）

- [ ] 流式输出，Ctrl+C 能中断当前生成
- [ ] 6 个工具至少 4 个可用，路径不能逃出工作区
- [ ] Agent 能自主连续调多个工具完成一个任务
- [ ] 写文件/跑命令前必问，拒绝后不执行且模型知道被拒
- [ ] 危险命令（`rm -rf`、`format`、`del /f`）被硬拦
- [ ] 连续 50 轮对话上下文不爆（自动压缩生效）
- [ ] 重启后恢复上次会话
- [ ] Windows Terminal 下中文输入可用（至少不崩、不乱码）
- [ ] 一条命令能跑起来（npx / 单 exe）
- [ ] README + 3 分钟 demo
- [ ] 能讲清楚 3 个设计决策（面试用）

---

## 10. 常见坑（按出现概率排序）

| 坑 | 表现 | 解法 |
|---|---|---|
| 流式渲染整屏重绘 | 闪烁、滚动跳 | Ink 用 `<Static>` 放历史消息，只重绘动态区 |
| Windows 编码 | 中文乱码、路径报错 | 统一 UTF-8；`chcp 65001`；路径用 `path.resolve` |
| Bash 输出过大 | 上下文瞬间爆 | 截断 30KB + 只回传摘要，完整输出落盘 |
| token 估算不准 | 要么爆要么过度压缩 | js-tiktoken 粗算，阈值留 20% 余量 |
| 工具结果 JSON 太大 | 模型读不完 | 大结果落盘，只回传路径 + 前 N 行 |
| API 费用 | 开发期烧钱 | 开发用 DeepSeek/GLM，演示用强模型；限 max_tokens |
| 密钥泄漏 | key 进 git | .env + .gitignore，启动时校验 |
| Ink 中文 IME | 候选框错位/删字异常 | Day 0 先测；不行就转 Go |

---

## 11. 下一步

方案阶段到此为止，后续开发不在本会话进行。开工入口是 [HANDOFF.md](HANDOFF.md)：

1. 新会话先读 `HANDOFF.md`（当前状态、已定决策、Git 流程）和 `docs/tasks.md`（任务看板）；
2. 从 **S0-1** 开始：初始化工程 + Ink 中文 IME spike；
3. 每个 task 一个分支/提交，每阶段验收后打 tag（`v0.1-s0` … `v0.1.0`）；
4. 技术栈默认 **TS + Ink**（本文件与 [MewCode-TS实施方案.md](MewCode-TS实施方案.md) 都按此写）。若 IME 不可用决定转 Go，先更新 HANDOFF §4 与实施方案，不要两套并行。

仓库：<https://github.com/zcslack17858645276-del/MewAgent>（私有，`main` 分支，已有会话交接与任务板）。

---

## 附录 A：课程流程 vs 个人版流程

| | 课程 | 个人版 |
|---|---|---|
| 组织方式 | 17 章 × （理论 + 实战 + 源码分析） | 3 周 × 每日可验收任务 |
| 驱动方式 | Spec 三件套 + CLAUDE.md | 同左（直接抄） |
| 功能范围 | 13 项全量 | P0 8 项 |
| 语言 | 四版本对照 | 1 门 |
| 多 Agent | SubAgent / Worktree / Teams | 不做或最后做 |
| 产出 | 源码 + 面试题 + 简历 | 能跑的项目 + demo + 3 个设计决策 |

## 附录 B：事实来源与置信度

- MewCode 公开页面：<https://www.xiaolincoding.com/project/mewcode.html>（2026-11-23 抓取；项目定位、13 项功能、5 层架构、17 章/40w+ 字、四语言版本、3–4 周、无视频、Spec 三件套均为页面明示）
- 四语言 TUI 框架：课程未公开点名，本文件为 **生态推断 [推断]**；学员复刻版用 Textual 属 [社区说法]
- 性能/IME/分发对比：见 [技术选型报告.md](技术选型报告.md) §3 与 `research/02-tui-frameworks.md`
- 代码量与工期：**个人估算 [推断]**，按每天 3–4 小时有效开发
