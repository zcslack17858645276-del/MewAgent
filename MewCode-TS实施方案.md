# MewCode TS 版实施方案（Vibe Coding 执行手册）

> 目标：用 TypeScript + Ink 从零做出一个可日常使用、可独自维护的 CLI Coding Agent（MewCode-lite）。
> 这份文档是"施工图纸"，不是代码版本：给出架构、接口契约、阶段拆解、每一步给 AI 的提示词、验收标准。
> 配套：[MewCode-个人版实施计划.md](MewCode-个人版实施计划.md)（范围与排期）、[技术选型报告.md](技术选型报告.md)（选型依据）。
> 仓库：<https://github.com/zcslack17858645276-del/MewAgent>（私有）｜会话交接、已定决策与 Git 规范见 [HANDOFF.md](HANDOFF.md)

---

## 0. 这份方案怎么用

**不要**把整份方案丢给 AI 说"帮我实现 MewCode"。正确用法：

0. 新会话先读 [HANDOFF.md](HANDOFF.md)：当前状态、已定决策、Git 流程、上次交接；
1. 按 §4 的阶段顺序推进，一次只做一个阶段；
2. 每个阶段先把该阶段的 `spec.md` 片段写清楚（要什么、不要什么、验收标准）；
3. 让 AI 把 spec 拆成 3–6 个 task（每个 task ≤ 半天）；
4. **一个 task 一次会话**，让 AI 实现一个 task，完成后本地跑 `typecheck + test`；
5. 你手动验收（按阶段验收项），通过后按 HANDOFF §5 提交（任务分支 + commit + PR/tag）；
6. 再开下一个 task。

方案里所有代码块都是**契约/伪代码**，用于和 AI 对齐结构，不是让你照抄实现。

---

## 1. 目标与边界

### 1.1 产品目标（v0.1）

一个终端里的编程 Agent：能流式对话、能读/写/改文件、能执行命令、动手前会问人、重启能恢复会话、一条命令启动。

### 1.2 学习目标（优先级高于功能数量）

做完必须能讲清楚这 7 件事：

1. 消息协议长什么样（system/user/assistant/tool 四种角色如何组装）
2. 流式响应怎么解析（SSE、增量 delta、tool_calls 分片聚合）
3. Function Calling 的完整链路（模型返回 tool_call → 本地执行 → tool 结果回填 → 再请求）
4. Agent Loop 的终止条件为什么不靠关键词
5. 工具系统怎么设计（注册表 + JSON Schema + 统一结果）
6. 上下文为什么会爆、压缩怎么保信息
7. 权限闸门如何做到"有能力但不失控"

### 1.3 非目标（v0.1 明确不做）

MCP、Skill 技能包、Hook、SubAgent、Git Worktree、Agent Teams、多模型路由、桌面 GUI、团队协作、云同步、插件市场、Plan 模式、自定义 slash 命令加载。

### 1.4 成功标准（全部可验收）

- [ ] 流式输出，生成中可中断（Esc）
- [ ] 6 个工具：`read_file` `write_file` `edit_file` `bash` `glob` `grep`
- [ ] 模型能自主连续调用多个工具完成一个任务
- [ ] 写文件/执行命令前必须人工确认；拒绝后模型收到拒绝原因并调整
- [ ] 路径不能逃出工作区；危险命令硬拦截
- [ ] 连续 50 轮对话不爆上下文（自动压缩生效）
- [ ] 重启后自动恢复上次会话
- [ ] Windows Terminal 下中文输入、中文输出不乱码
- [ ] `npm run dev` 或 `npx mewcode` 一条命令启动
- [ ] 有 README、有测试、能 3 分钟演示

---

## 2. 技术选型（已定，不再纠结）

| 层 | 选择 | 版本（2026-11-23 核对） | 理由 |
|---|---|---|---|
| 语言/运行时 | TypeScript + Node | Node ≥ 22 | 训练数据最密、AI 生成质量最高、开发迭代快 |
| TUI | **Ink** + React | ink 8.0.0 / react 19.3.1 | React 心智模型、生态最大、Claude Code 同路线 |
| 输入框 | ink-text-input | 6.0.0 | 省掉光标/退格/粘贴的重复实现 |
| 开发运行 | tsx | 4.23.15 | 免编译热跑 |
| 构建 | tsc | 7.0.2（native） | 零配置；若遇兼容问题回退 5.9.x |
| 测试 | node:test + tsx | Node 内置 | 不加测试框架依赖 |
| HTTP | 原生 `fetch` + 手写 SSE | — | 学习价值 + 零依赖；200 行以内 |
| 存储 | JSON 文件 | — | v0.1 够用，可读可调试 |

**明确不用**：LangChain / Vercel AI SDK / OpenAI SDK —— 它们是黑盒，会遮住你要学的协议细节；而且版本变动快，个人维护成本高。

**已知风险**：Ink 的 Windows 中文 IME 兼容性（见 §9）。S0 阶段用 30 分钟 spike 验证，坏了转 Go（见 §9.1）。

**为什么不是其他**：
- 不用 OpenTUI：更新、示例少，等 v0.2 需要更强渲染时再换（UI 事件化后替换成本可控）。
- 不用 Rust/Go：你已选 TS；且个人项目首版拼的是迭代速度，不是运行时性能。
- 不用 Electron/Web GUI：TUI 是这个产品的形态，GUI 以后套壳。

---

## 3. 架构设计

### 3.1 分层

```
┌─────────────────────────────────────────────┐
│  UI 层（Ink）：历史消息 / 流式区 / 审批 / 输入框  │
└───────────────┬─────────────────────────────┘
                │ AgentEvent（单向事件流）
┌───────────────▼─────────────────────────────┐
│  Agent Loop：模型 ⇄ 工具 的循环 + 终止判断       │
└───────┬───────────────────────┬─────────────┘
        │                       │
┌───────▼────────┐     ┌────────▼────────────┐
│ LLM Client     │     │ Tool Registry       │
│ 流式/SSE/聚合   │     │ 6 个工具 + JSON Schema│
└────────────────┘     └────────┬────────────┘
                                │
                       ┌────────▼────────────┐
                       │ Permission Gate     │
                       │ 只读放行/写与命令审批 │
                       └────────┬────────────┘
                                │
              ┌─────────────────▼─────────────────┐
              │ Context Manager / Session Store    │
              │ token 估算 / 按轮压缩 / JSON 持久化  │
              └───────────────────────────────────┘
```

**边界规则（给 AI 的硬约束）**：
- UI 不直接调 LLM 或工具，只消费 `AgentEvent`；
- Agent Loop 不 `console.log`、不读 `process.stdin`，通过回调发事件；
- 工具不弹 UI、不读全局状态，只接收 `ctx.workspace`；
- LLM Client 只负责协议，不负责重试策略之外的业务。

这样做的收益：Agent Loop 可以脱离 TUI 用 mock LLM 做单元测试；以后换 OpenTUI/Web 只换 UI 层。

### 3.2 目录结构

```
mewcode/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ AGENTS.md                  # AI 协作规则（Claude Code 用 CLAUDE.md 引入）
├─ CLAUDE.md
├─ docs/
│  ├─ spec.md                 # 总需求与验收（按阶段追加）
│  ├─ tasks.md                # task 清单与状态
│  └─ checklist.md            # 手工验收清单
├─ src/
│  ├─ index.ts                # 入口：参数解析、--help、--print、启动 TUI
│  ├─ config.ts               # .env 加载、CLI 参数、默认值、校验
│  ├─ types.ts                # 全部共享类型（先定契约）
│  ├─ llm/
│  │  ├─ sse.ts               # SSE 行解析（纯函数，可测）
│  │  ├─ openai.ts            # OpenAI 兼容流式客户端 + tool_calls 聚合
│  │  ├─ mock.ts              # 离线 mock，用于 UI/循环测试
│  │  └─ index.ts             # createLlm(config)
│  ├─ agent/
│  │  ├─ prompt.ts            # system prompt 构造
│  │  ├─ messages.ts          # Message ⇄ API JSON 转换
│  │  └─ loop.ts              # Agent Loop
│  ├─ tools/
│  │  ├─ paths.ts             # 工作区边界校验
│  │  ├─ registry.ts          # ToolRegistry + JSON 参数解析
│  │  ├─ fs.ts                # read/write/edit
│  │  ├─ search.ts            # glob/grep
│  │  ├─ bash.ts              # 命令执行、超时、截断、编码
│  │  └─ index.ts             # createDefaultRegistry()
│  ├─ safety/
│  │  ├─ danger.ts            # 危险命令规则
│  │  └─ permissions.ts       # 交互/headless 两种 Gate
│  ├─ context/
│  │  ├─ tokens.ts            # 粗略 token 估算
│  │  └─ compress.ts          # 按“轮”压缩
│  ├─ session/
│  │  └─ store.ts             # 会话 JSON 读写
│  └─ ui/
│     ├─ App.tsx              # 状态机与事件订阅
│     ├─ HistoryItem.tsx      # 已提交历史渲染
│     └─ ApprovalPrompt.tsx   # y/a/n 审批
└─ tests/
   └─ core.test.ts            # sse/paths/edit/loop/compress
```

### 3.3 核心契约（先定这个，再让 AI 写实现）

```ts
type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

interface ToolCall {
  id: string;          // 模型给的调用 id，回填 tool 消息时必须原样带回
  name: string;
  arguments: string;   // 原始 JSON 字符串，由 registry 解析
}

interface ToolResult {
  ok: boolean;
  output: string;      // 回填给模型的文本（错误也走这里，带 "Error:" 前缀）
}

interface ToolDefinition {
  name: string;
  description: string;                 // 模型据此决定用哪个工具
  parameters: Record<string, unknown>; // JSON Schema
  readOnly: boolean;                   // 只读工具自动放行
  run(args: Record<string, unknown>, ctx: { workspace: string }): Promise<ToolResult>;
}

interface LlmClient {
  chat(
    messages: Message[],
    tools: ToolSpec[],
    opts?: { signal?: AbortSignal; onText?: (delta: string) => void },
  ): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }>;
}

type GateResult = { allow: true } | { allow: false; reason: string };
type Gate = (call: ToolCall) => Promise<GateResult>;

type AgentEvent =
  | { type: "assistant_text"; delta: string }
  | { type: "tool_start"; call: ToolCall; args: Record<string, unknown> | null }
  | { type: "tool_end"; call: ToolCall; result: ToolResult; durationMs: number }
  | { type: "turn_end"; reason: string };
```

**契约变更规则**：`types.ts` 是合同。任何阶段想改它，必须先在 `docs/spec.md` 写明原因，再一次性改完并跑测试；不许 AI 在实现某个 task 时顺手改契约。

### 3.4 一次请求的完整时序

```
用户输入
  → messages.push(user)
  → [压缩] 按轮裁剪到 token 预算内
  → llm.chat(messages, tools)           # 流式
       ├─ text delta        → onText → UI 追加
       └─ tool_calls 分片   → 聚合成完整调用
  → messages.push(assistant)
  → 对每个 tool_call：
       ├─ gate(call)                    # 只读放行 / 写与命令审批 / 危险拦截
       ├─ tools.run(call)               # 执行 + 截断
       └─ messages.push(tool)           # 成功/拒绝/异常都回填
  → 回到 llm.chat(...)                  # 直到没有 tool_calls 或达到 maxSteps
  → UI 提交本轮，保存会话
```

错误分支（都必须在方案里定好，否则 AI 会漏）：
- HTTP 非 2xx：显示状态码 + 响应前 500 字，不重试（或仅 429 重试一次）
- 流中断：保留已输出文本，提示"连接中断，可重发"
- 工具参数 JSON 非法：回填 `Error: invalid JSON arguments`，让模型重试
- 工具抛异常：回填 `Error: ...`，不崩进程
- 用户拒绝：回填 `Error: Permission denied by user: <原因>`
- 达到 maxSteps：停止并提示，避免死循环

### 3.5 十条关键设计决策（附理由）

| # | 决策 | 理由 |
|---|---|---|
| 1 | Loop 终止条件 = 模型本轮不再返回 `tool_calls` | 协议层判断，不靠"完成"关键词；模型自己知道何时停 |
| 2 | 所有工具结果统一 `{ok, output}` 并原样回填 | 模型能读到失败原因并自我修正，而不是静默失败 |
| 3 | 权限三道闸：路径边界 → 危险命令 → 人工确认 | 先做机器能判的，再问人；降低误问和误放行 |
| 4 | 上下文按"轮"（user 开始）压缩，不按单条消息 | 保住 assistant.toolCalls 与 tool 结果的配对，避免 API 报错 |
| 5 | session（本次对话）与 memory（跨会话）从第一天就分开 | 混在一起后很难拆；v0.1 只做 session，memory 留接口 |
| 6 | UI 只消费事件，不参与决策 | 换 UI 成本最低；测试不需要 TTY |
| 7 | tool_calls 按 `index` 聚合增量分片 | 流式协议规定如此，不聚合会得到半个 JSON |
| 8 | 只做 OpenAI 兼容协议 | DeepSeek/OpenAI/GLM/MiniMax/OpenRouter 全覆盖，一套代码 |
| 9 | 单线程 + AbortController，不引入 worker | v0.1 的瓶颈是网络与终端渲染，不是 CPU；简单优先 |
| 10 | 工具输出统一截断（单次 ≤ 30KB，超长落盘给路径） | 防止一次 `cat` 把上下文打爆 |

---

## 4. 分阶段实施（S0–S4）

> 每个阶段给：目标、交付物、tasks、给 AI 的提示词要点、验收。按顺序做，不跳阶段。

### S0 · 骨架与契约（0.5–1 天）

**目标**：项目能跑 `--help`，契约定稿，测试链路通。

**交付物**：
- 目录结构 + `package.json` + `tsconfig.json` + `.gitignore` + `.env.example`
- `src/types.ts`（§3.3 全部类型）
- `src/config.ts`：读 `.env` + CLI 参数（`--model` `--base-url` `--workspace` `--new` `--mock` `--print`），缺 key 时给友好报错
- `src/index.ts`：`--help` / `--version` / 无 TTY 时报错；`--print` 走 headless
- `src/llm/mock.ts`：脚本化回复（第一轮发一个 `read_file` 调用，第二轮给总结），用于离线验证
- `tests/core.test.ts` 骨架（先放一个 `assert.ok(true)`）
- `AGENTS.md` / `CLAUDE.md` / `docs/spec.md` / `docs/tasks.md` / `docs/checklist.md`

**给 AI 的提示词要点**：
> 读 AGENTS.md 和 docs/spec.md 的 S0 部分。只做 S0，不写任何 TUI 代码。先给出你将创建的文件清单和每个文件的职责，等我确认后再写。完成后运行 `npm run typecheck` 和 `npm test`。

**验收**：
- `npm run typecheck` 0 错误
- `npm test` 通过
- `npm run dev -- --help` 输出用法
- `npm run dev -- --mock --print "你好"` 能走通 mock 的两轮循环

---

### S1 · 流式对话 + 最小 TUI（2 天）

**目标**：终端里能输入、能流式看回复、能中断；mock 和真实 API 都能跑。

**交付物**：
- `llm/sse.ts`：逐行解析 `data:`，处理分块、CRLF、`[DONE]`、尾部残留
- `llm/openai.ts`：`fetch` + SSE + text delta + tool_calls 聚合 + abort
- `ui/App.tsx`：消息列表、输入框、流式区、错误行、状态行
- `agent/prompt.ts`：system prompt（先简版）
- `index.ts`：`--print` 模式先跑通，再接 TUI
- 测试：SSE 分块（把一行拆成 3 段喂进去）、`[DONE]`、空行

**给 AI 的提示词要点**：
> 只实现 S1。SSE 解析必须写成纯函数并对"一行被拆成多块"写测试。TUI 用 Ink + ink-text-input。流式渲染做 50ms 节流，不要每个 token setState。Ctrl+C/Esc 的行为：生成中中断，空闲时退出。不要调用真实 API 跑测试，用 mock。

**验收（手工）**：
- 输入"你好"，文字逐段出现，不闪屏
- 生成中点 Esc 能停，已输出内容保留
- 无 key 启动给出可操作提示
- `--mock --print` 能跑

---

### S2 · 工具系统 + Agent Loop（3 天）

**目标**：模型能自主调工具完成任务；6 个工具可用；事件流驱动 UI。

**交付物**：
- `tools/paths.ts`：`resolveInside(workspace, input)`，拒绝 `../` 和越界绝对路径
- `tools/registry.ts`：注册表、JSON Schema 输出、参数解析、异常兜底
- `tools/fs.ts`：read（行号+截断）、write（建目录）、edit（唯一性检查 + CRLF 兼容）
- `tools/search.ts`：glob（限制 200 条，跳过 node_modules/.git）、grep（限制 100 条）
- `tools/bash.ts`：shell 选择、超时、输出截断、UTF-8/GBK 解码
- `tools/index.ts`：`createDefaultRegistry(workspace)`
- `agent/loop.ts`：完整循环 + `AgentEvent` + maxSteps
- `ui/App.tsx`：消费事件（流式/工具开始/工具结束/错误）
- 测试：path 越界、edit 唯一性、loop 用 mock LLM（先返回工具调用，再返回文本）

**给 AI 的提示词要点**：
> 只实现 S2。loop.ts 不允许 import Ink 或 console。工具函数单元测试放 tests/core.test.ts。`bash` 在 Windows 上优先用 Git Bash（存在时），否则 cmd.exe；输出做 30KB 截断；超时 kill。`edit_file` 找不到/多处匹配都要返回可操作的错误，不要静默。先写 registry 和 loop 的测试，再写 UI 接线。

**验收（手工）**：
- 问"这个项目是干嘛的"，Agent 自己读 README/package.json 后回答
- 让它改一行代码，先看到 write/edit 调用，再看到结果
- 让它跑 `npm test` 并总结
- 连续调 3+ 工具不崩

---

### S3 · 权限 + 会话 + 上下文压缩（2–3 天）

**目标**：安全可控；重启能恢复；长对话不爆。

**交付物**：
- `safety/danger.ts`：`rm -rf`、`format`、`del /f`、`shutdown`、写系统目录等规则
- `safety/permissions.ts`：交互 Gate（y/a/n）、会话白名单、headless Gate（只读放行）
- `ui/ApprovalPrompt.tsx`：显示工具名、参数摘要、三个选项；Esc = 拒绝
- `session/store.ts`：`.mewcode/session.json`，每轮保存、启动加载、`--new` 跳过
- `context/tokens.ts`：CJK 按 1.1 token/字、其他按 1/4 字符估算 + 每条消息开销
- `context/compress.ts`：按轮分组、system 常驻、保留最新若干轮、单轮过大时截断工具输出、丢弃轮次时清掉开头的悬空 tool 消息
- 测试：拒绝后 loop 继续、compression 保留最新轮且 system 在最前、session 读写

**给 AI 的提示词要点**：
> 只实现 S3。权限判断顺序固定：工具存在 → 路径边界 → 只读放行 → 危险命令拦截 → 会话白名单 → 人工询问。拒绝必须回填 `Error: Permission denied by user: ...` 给模型。压缩按"user 消息"切轮，绝不拆散 assistant.toolCalls 与对应 tool 结果。压缩先写测试用例再实现。

**验收（手工）**：
- 让它删一个文件，弹审批；选 n 后它不会硬来
- 选 a 后本会话同类操作不再问
- `rm -rf /` 直接被拦，不弹窗
- 连续 50 轮对话不报上下文超限
- 退出重进，能恢复上下文

---

### S4 · 打磨与交付（2 天）

**目标**：像个产品，能演示、能给自己日常用。

**交付物**：
- `edit_file` 的 diff 展示（行号 + 红绿）
- 统一错误展示（网络/工具/权限/超步数）
- 流式 markdown 基础渲染（粗体/代码块可后置）
- README（安装、配置、命令、架构图、加工具教程）
- `docs/checklist.md` 全部勾选
- 打包：`npm link` 或 `npx .` 可用；Windows 下验证
- 3 分钟演示脚本 + 录屏

**验收**：
- §1.4 成功标准全部勾选
- 你的日常小任务（改 bug、读代码）能交给它做

**阶段依赖**：S1 依赖 S0；S2 依赖 S1；S3 依赖 S2；S4 依赖 S3。**不许并行**，否则契约会乱。

---

## 5. Vibe Coding 工作流（核心方法）

### 5.1 每个 task 的固定循环（照着做）

```
1. 从 docs/tasks.md 取一个 task（≤ 半天）
2. 在 docs/spec.md 补 5 行：输入/输出/边界/验收
3. 新开一个 AI 会话，发“任务提示词”（§5.6 模板）
4. 让 AI 先给计划，你确认
5. 让 AI 实现，限制改动文件范围
6. 本地跑 npm run typecheck && npm test
7. 手动验收（阶段验收项）
8. git add -A && git commit -m "S2: registry + read_file"
9. 更新 docs/tasks.md 状态
```

**一次会话只做一件事**。会话变长后 AI 会开始"发挥"，这时候 `/clear` 重开比继续聊更省时间。

### 5.2 AGENTS.md 模板（直接可用）

```markdown
# MewCode 项目规则

## 技术栈
- TypeScript + Node ≥22 + Ink 8 + React 19；构建 tsc，开发 tsx，测试 node:test。
- 不引入新依赖，除非 spec 里明确要求并说明理由。

## 常用命令
- npm run dev / npm run dev -- --mock
- npm run typecheck
- npm test
- npm run build && npm start

## 架构边界（必须遵守）
- src/ui/** 只消费 AgentEvent，不直接调 LLM 或工具。
- src/agent/loop.ts 不 import Ink，不 console.log，不读 stdin。
- src/tools/** 不弹 UI，只通过 ctx.workspace 访问文件。
- src/types.ts 是契约；改它之前必须先更新 docs/spec.md 并说明原因。

## 代码风格
- strict TS，禁止 any 逃逸（确实需要时用 unknown + 收窄）。
- 错误必须返回或抛出可读信息，禁止静默 catch。
- 路径一律走 tools/paths.ts，禁止直接拼路径。
- 注释只解释“为什么”，不解释“是什么”。

## 完成定义（DoD）
- 本次改动：typecheck 0 错误 + test 通过 + 手动验收项通过。
- 更新 docs/tasks.md 状态；不修改无关文件。
- 新增行为必须有测试（至少一个失败路径）。
```

### 5.3 docs/spec.md 模板（按阶段追加）

```markdown
## S2 · 工具系统与 Agent Loop
### 要什么
- 6 个工具，统一 ToolDefinition 契约；只读工具标记 readOnly。
- Loop 支持多轮 tool_calls，终止条件 = 本轮无 tool_calls；maxSteps=30。
### 不要什么
- 不做 MCP、不做并行工具调用、不做工具重试。
### 验收
- mock LLM 两轮：工具调用 → 最终文本，事件顺序正确。
- 真实模型能完成“读 README 并总结”。
### 已知边界
- glob 上限 200 条；bash 输出截断 30KB；edit 只支持精确字符串替换。
```

### 5.4 docs/tasks.md 模板

```markdown
| ID | 阶段 | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|---|
| S2-1 | S2 | paths.ts + 越界测试 | 2h | done | test 通过 |
| S2-2 | S2 | registry + JSON 参数解析 | 2h | todo | 非法 JSON 不崩 |
| S2-3 | S2 | read/write/edit 三工具 | 3h | todo | 手工验收 |
```

### 5.5 docs/checklist.md 模板

把 §1.4 的 10 条成功标准逐条抄进去，每条留 `[ ]`、验收命令/步骤、证据（截图/日志路径）。

### 5.6 提示词模板库

**① 新模块（最常用）**
```
读 AGENTS.md 和 docs/spec.md 的 <阶段> 部分。
本次只做 task <ID>：<一句话描述>。
先不要写代码：给出 1) 涉及文件清单 2) 数据结构 3) 实现步骤 4) 测试用例，等我确认。
确认后：只改清单内的文件；完成后运行 npm run typecheck && npm test，并汇报失败原因。
```

**② 修 bug**
```
现象：<命令/输入> 得到 <实际>，期望 <预期>，复现步骤：<...>。
先定位根因（贴出相关文件行号），不要改无关代码。
修复后用最小测试覆盖该场景；如果根因在类型契约，先停下来说明。
```

**③ 加一个工具**
```
参照 src/tools/fs.ts 里 read_file 的写法，新增 <tool_name>：
用途 <...>，参数 JSON Schema <...>，只读/需审批 <...>，输出格式 <...>。
必须注册到 createDefaultRegistry，并在 tests 里覆盖成功 + 参数非法两条路径。
不要动 loop 和 UI。
```

**④ 写测试**
```
给 <模块> 补测试，覆盖：<正常路径>、<边界>、<失败路径>。
只用 node:test + node:assert，不引新依赖，不 mock 文件系统以外的全局。
测试要能在 Windows 和 Linux 都跑。
```

**⑤ Review diff**
```
审查当前 git diff：1) 是否违反 AGENTS.md 的架构边界 2) 是否有静默 catch/未处理 null 3) 是否有路径越界风险 4) 是否漏了失败路径测试。
只列问题，不要直接改；按严重程度排序。
```

**⑥ 学习式追问（学原理用）**
```
用 5 句话解释这段实现里 <概念> 的作用，并指出如果我把它去掉会发生什么。
再用一个类比说明，最后给我一个可以手改验证的小实验。
```

### 5.7 防跑偏七条

1. 一次一个 task，绝不"顺手把下一个也做了"。
2. 契约先行；实现阶段改 `types.ts` 一律拒绝。
3. 先写失败测试，再写实现（至少对 loop/权限/压缩）。
4. 每步保持可运行，不做"大爆炸式重构"。
5. 新依赖必须写进 spec 并说明理由（v0.1 目标是零依赖增长）。
6. AI 说"已完成"不算数，以 `typecheck + test + 你手动验收` 为准。
7. 会话超过约 30 轮就重开，把当前 spec 和错误贴过去。

### 5.8 Git 工作流（与 HANDOFF §5 同源）

- **分支**：`main` 始终可运行；每个 task 建 `task/sx-y-slug`，完成后 push → PR → squash merge；纯文档可直提 `main`。
- **commit**：`type(scope): 摘要`（feat/fix/test/docs/chore/refactor），一个 task 一个 commit，正文写"为什么"。
- **tag**：每阶段验收通过打 `v0.1-s0` … `v0.1-s3`，S4 完成打 `v0.1.0`，作为回滚点。
- **回滚**：已推送用 `git revert <hash>`；未推送才用 `git reset --hard`；禁止 force-push `main`。
- **提交前**：`npm run typecheck && npm test && git status`，确认无 `.env`/`node_modules`。
- **CI**：S0 添加 GitHub Actions（typecheck + test），PR 必须绿。
- 完整命令、排障与文档更新义务见 [HANDOFF.md](HANDOFF.md) §5。

---

## 6. 关键模块设计细节

### 6.1 SSE 解析（`llm/sse.ts`）

输入是 `ReadableStream<Uint8Array>`，输出是逐条 `data:` 字符串。要点：

- 用 `TextDecoder(..., {stream:true})` 处理多字节字符被切断；
- 维护 buffer，按 `\n` 切行，行尾 `\r` 去掉；
- 忽略空行、`:` 注释行；
- `data: [DONE]` 作为结束信号，不送 JSON.parse；
- 流结束后处理 buffer 里最后一行（无换行结尾的情况）；
- 写成 async generator，便于测试时用假 ReadableStream 喂分块。

### 6.2 tool_calls 增量聚合（`llm/openai.ts`）

流式响应里 `delta.tool_calls` 是数组，每片只带部分字段：

```
index（稳定） → { id?, function.name?, function.arguments? }
```

规则：按 `index` 建 Map；`id`/`name` 只取第一次出现的非空值；`arguments` 字符串**累加**；结束后按 index 排序，过滤掉没有 name 的项。`finish_reason` 为 `tool_calls` 时确定本轮有工具调用；若 provider 返回 `stop` 但确实有 tool_calls，以实际数据为准。

### 6.3 Agent Loop（伪代码）

```
async function runAgent(messages, deps):
  for step in 1..maxSteps:
    res = await deps.llm.chat(messages, deps.tools.specs(), { signal, onText })
    messages.push({ role:"assistant", content:res.content, toolCalls:res.toolCalls })
    if res.toolCalls.length == 0:
      emit turn_end(res.finishReason); return messages
    for call in res.toolCalls:
      emit tool_start(call)
      if signal.aborted: result = {ok:false, output:"Aborted by user."}
      else:
        decision = await deps.gate(call)
        result = decision.allow ? await deps.tools.run(call)
                                : {ok:false, output:`Permission denied: ${decision.reason}`}
      messages.push({ role:"tool", toolCallId:call.id, content: result.ok ? result.output : `Error: ${result.output}` })
      emit tool_end(call, result)
  throw new Error("max steps exceeded")
```

要点：拒绝/异常也走同一条回填路径；`call.id` 必须原样使用；不要用 `name` 当 tool_call_id。

### 6.4 工具注册表（`tools/registry.ts`）

- `specs()` 输出 OpenAI tools 格式（`{type:"function", function:{name,description,parameters}}`）；
- `run(call)`：找工具 → `JSON.parse(call.arguments)`（必须是对象）→ 调 `run` → 捕获异常转 `{ok:false}`；
- 未知工具返回可读错误 + 可用工具列表；
- 工具执行加超时保护（bash 自己处理，其他工具 v0.1 不加）。

### 6.5 edit_file 精确替换（最容易踩坑）

规则：
1. 读文件，检测 `\r\n`；
2. 先按原样找 `old_string`；找不到时把两边统一成 `\n` 再找（Windows 兼容）；
3. 出现 0 次 → 错误："未找到，请检查缩进/换行/是否已修改"；
4. 出现 >1 次且未传 `replace_all` → 错误："匹配到 N 处，请提供更多上下文或 replace_all:true"；
5. 替换后写回，保留原文件的换行风格；
6. 返回替换点前后各 3 行（带行号）作为结果，便于模型确认。

### 6.6 权限闸门顺序（`safety/permissions.ts`）

```
parse args → 工具存在? → 路径边界? → readOnly? → 危险命令? → 会话白名单? → 询问 y/a/n
```

- `a` 只把**该工具名**加入本会话白名单（不按目录/不按命令前缀，v0.1 从简）；
- 询问超时/中断一律按拒绝处理；
- headless（`--print`）只允许只读工具，其余直接拒绝并说明；
- 拒绝原因要具体（"该命令匹配危险模式 rm -rf"），模型才能换方案。

### 6.7 上下文压缩（`context/compress.ts`）

按"轮"分组：每条 `user` 开始一轮，直到下一条 `user` 之前的所有 assistant/tool 消息属于该轮。

算法：
1. system 常驻，不计入可丢部分；
2. 从最新一轮往前累加，直到超过 `budget = contextTokens × 0.7`；
3. 被丢弃的轮次整体移除（不要留半轮）；
4. 如果最新一轮本身就超预算：保留该轮，但把其中 tool 消息截断到 2,000 字符、assistant 内容截断到 4,000 字符；
5. 结果开头不能是 `tool` 消息（悬空结果会被 API 拒绝）。

token 估算（够用即可）：CJK 字符 ≈1.1 token/字；其他字符 ≈1/4 token；每条消息 +8；工具调用的 arguments 按字符串算。**预算是保险丝，不是精确计费**。

### 6.8 会话持久化（`session/store.ts`）

路径：`<workspace>/.mewcode/session.json`

```json
{
  "version": 1,
  "workspace": "D:\\...",
  "model": "deepseek-chat",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "messages": [ ... ]
}
```

- 每轮结束后异步保存（失败只警告，不阻塞对话）；
- 启动时若存在且未传 `--new`，加载并在 UI 顶部提示"已恢复 N 条消息"；
- 只存 user/assistant/tool，不存 system（每次重建）；
- 加 `.mewcode/` 到 `.gitignore`。

### 6.9 TUI 状态机（`ui/App.tsx`）

状态：`idle | streaming | tool_running | awaiting_approval | error`

- 用 `<Static items={committed}>` 渲染已提交历史 + 动态区渲染流式文本/工具状态/审批/输入框；
- 流式文本 50ms 节流 setState，避免每 token 重渲染；
- 审批时输入框失焦，`y/a/n/Esc` 由 `ApprovalPrompt` 处理；
- `exitOnCtrlC:false`：生成中 Ctrl+C 只 abort；空闲时 Ctrl+C 保存并退出；
- 工具结束立刻提交为历史项（避免审批后界面滞留）；
- 所有 UI 文本用中文，错误信息给"下一步怎么做"。

### 6.10 Windows 专项

- **shell 选择**：检测 `C:\Program Files\Git\bin\bash.exe`，存在则用 `bash -lc`；否则 `cmd.exe /d /s /c`；允许 `MEWCODE_SHELL` 覆盖。
- **编码**：cmd 下先 `chcp 65001`；读输出先 UTF-8，出现替换字符再尝试 GBK 解码。
- **路径**：统一 `path.resolve` + `path.relative` 判边界；输出统一正斜杠；保留用户原始大小写。
- **超时**：`child.kill()` 在 Windows 只杀直接子进程，孙进程可能残留；v0.1 接受，文档注明；v0.2 用 `taskkill /T /F`。
- **终端**：推荐 Windows Terminal（IME 支持比 conhost 好）。

---

## 7. 测试与验收

### 7.1 自动化测试（`tests/core.test.ts`）

| 用例 | 断言 |
|---|---|
| SSE 一行拆 3 块 | 事件完整、顺序正确 |
| SSE `[DONE]` | 不抛 JSON 错误，正常结束 |
| SSE 尾部无换行 | 最后一条不丢 |
| 路径越界 `../x`、`C:\Windows` | 抛错/拒绝 |
| edit 0 次匹配 | `ok:false` 且提示可操作 |
| edit 多处匹配 | 未传 replace_all 时失败 |
| loop：mock LLM 工具→文本 | messages 角色顺序正确、事件顺序正确 |
| loop：用户拒绝 | tool 消息含 `Permission denied`，循环继续 |
| compress：3 轮超预算 | system 保留、最新轮保留、无悬空 tool |
| session 读写 | 字段与消息数一致 |

### 7.2 手工验收脚本（10 个场景）

1. 流式输出 + Esc 中断
2. "读 README 并总结"（只读工具链）
3. "把 X 文件第 N 行改成 Y"（edit + 审批）
4. "跑 npm test 并告诉我结果"（bash + 截断）
5. 拒绝一次写操作，观察模型换方案
6. `rm -rf` 被硬拦
7. 连续 50 轮对话不报错
8. 退出重进恢复会话
9. 无 API key 启动的报错是否可操作
10. 中文输入/输出/错误信息不乱码

### 7.3 演示脚本（3 分钟）

- 30s：展示流式对话
- 60s：让它读项目并回答架构问题（多工具）
- 60s：让它改一个真实小 bug + 跑测试
- 30s：展示审批与危险命令拦截 + 会话恢复

### 7.4 成本与性能基线

- 开发期用 DeepSeek/GLM 等便宜模型，单轮日常任务通常 < 2 万 token；
- 演示用强模型；设 `maxSteps=30` 防失控；
- 首屏启动 < 1s；流式首字延迟取决于 provider；工具输出必须截断。

---

## 8. 排期（两种节奏）

### 8.1 业余版（每天 2–3 小时，3 周）

| 周 | 内容 | 里程碑 |
|---|---|---|
| 第 1 周 | S0（1 天）+ S1（2–3 天） | M1：能流式对话 |
| 第 2 周 | S2（4–5 天） | M2：能自主读改代码、跑命令 |
| 第 3 周 | S3（3 天）+ S4（2 天） | M3：安全/可恢复 → M4：可日常用 |

### 8.2 冲刺版（每天 5–6 小时，10 天）

| 天 | 内容 |
|---|---|
| D1 | S0 |
| D2–D3 | S1 |
| D4–D6 | S2 |
| D7–D8 | S3 |
| D9–D10 | S4 + 演示 |

**只做 2 周版**：S0+S1+S2+S3 的压缩版，砍 S4 的 markdown/diff 打磨，保留 README 和演示。

---

## 9. 风险与应对

| 风险 | 概率/影响 | 应对 | 触发换方案的信号 |
|---|---|---|---|
| Ink 中文 IME 异常（候选框错位/删字） | 中/高 | S0 花 30 分钟做 spike：10 行输入框用微软拼音实测 | 中文无法正常输入 → 转 Go + Bubble Tea（§9.1） |
| Windows 输出乱码 | 高/中 | UTF-8→GBK 回退、chcp 65001、Windows Terminal | 仍乱码 → 统一英文输出 |
| 流式渲染卡顿/闪烁 | 中/中 | Static 历史 + 50ms 节流 + 只重绘动态区 | 10 万行输出卡死 → 工具输出强制截断 |
| 上下文爆掉 | 高/高 | 按轮压缩 + 工具输出截断 + 预算告警 | 频繁 400 → 降预算/提前压缩 |
| 工具死循环 | 中/高 | maxSteps=30 + 相同工具连调检测（v0.2） | 连续 5 次同工具同参数 → 中断 |
| API 费用超预期 | 中/中 | 开发用便宜模型 + maxSteps + 截断 | 单任务 > 5 万 token → 检查 prompt/工具输出 |
| 密钥泄漏 | 中/高 | `.env` + `.gitignore` + 启动校验 + 不打印 key | 误提交 → 立即吊销重发 |
| 依赖升级破坏 | 中/中 | 锁版本（package-lock 提交）；不追新 | Ink 大版本升级 → 先跑测试再升 |
| 需求蔓延 | 高/高 | 严格按 §1.3 非目标；新想法写进 roadmap 不实现 | 想加 MCP/多 Agent → 停，记 backlog |

### 9.1 换 Go 的决策规则（只针对 IME）

- 如果 S0 spike 中，Windows Terminal + 微软拼音在 Ink 输入框里**无法正常输入中文或退格错乱**，且 30 分钟内找不到绕过方案 → 立即切 Go + Bubble Tea；
- 切换成本：S0/S1 约 2 天（loop/LLM 逻辑可照搬设计），越早切越便宜；
- 如果只是"候选框位置略偏但能输入"，可继续 TS，日常用英文下指令规避。

---

## 10. 后续扩展路线（v0.2+，做完 v0.1 再碰）

| 优先级 | 功能 | 增量设计 | 估时 |
|---|---|---|---|
| P1 | MCP 客户端 | 官方 SDK + stdio server 发现/调用，工具动态注册 | 0.5–1 天 |
| P1 | memory.md | 项目级记忆文件，system prompt 注入 + `/remember` 命令 | 0.5 天 |
| P2 | 自定义 slash 命令 | `~/.mewcode/commands/*.md`，模板替换后当 user 消息 | 0.5 天 |
| P2 | Hook | 工具前后/会话开始结束执行脚本，事件总线 | 0.5–1 天 |
| P2 | SubAgent | 子 loop + 独立上下文，结果回填主 loop | 1–2 天 |
| P3 | OpenTUI 迁移 | UI 事件化后只换渲染层 | 2–3 天 |
| P3 | Web/桌面壳 | 把 core 包成本地 server，Web/Electron 做客户端 | 3–5 天 |
| 不做 | Worktree / Agent Teams | 个人场景 ROI 低 | — |

---

## 11. 学习地图（每阶段对应什么原理）

| 阶段 | 学到的概念 | 能回答的面试/自测问题 |
|---|---|---|
| S0 | 项目结构、配置注入、mock 测试 | "你怎么在没有 API 的情况下开发 Agent？" |
| S1 | 消息协议、SSE、流式渲染、abort | "流式响应怎么解析？tool_calls 为什么是分片的？" |
| S2 | Function Calling、ReAct、工具设计、事件流 | "Agent 怎么知道任务做完了？工具结果怎么回填？" |
| S3 | 权限模型、上下文窗口、token 估算、压缩 | "上下文超了怎么办？怎么防止 rm -rf？" |
| S4 | 产品化、可观测性、打包 | "怎么让用户一条命令跑起来？" |

**面试讲法三句话**（做完就能说）：
1. "我的 Agent Loop 用协议层信号判断终止：模型本轮不返回 tool_call 就结束，不靠关键词。"
2. "工具系统是注册表 + JSON Schema + 统一结果，新增工具不改主循环。"
3. "上下文按 user 轮次分组压缩，保证 assistant.toolCalls 和 tool 结果不被拆散，否则 API 会拒绝。"

---

## 12. 附录

### A. 术语

| 术语 | 人话 |
|---|---|
| Agent Loop | 模型思考→调工具→看结果→再思考的循环 |
| Function Calling | 模型按 JSON Schema 输出"要调哪个工具、参数是什么" |
| SSE | 服务器单向流式推送文本的协议，`data: {...}` 一行一条 |
| tool_calls | 模型返回的工具调用请求，流式下分片到达，需按 index 聚合 |
| readOnly 工具 | 不改文件、不执行命令的工具，可自动放行 |
| 压缩 | 丢弃/截断旧对话，把 token 控制在预算内 |
| headless | 不启动 TUI，直接跑一轮（`--print`），用于测试/管道 |

### B. 参考实现（读源码优先看这三个）

- **Codex CLI**（Rust）：app-server JSON-RPC 三层、审批/压缩/diff/token 四类协议事件——最值得抄架构。
- **opencode**（TS）：client-server 拆分、多前端、Code Mode——最值得抄工程组织。
- **Crush**（Go）：单二进制、Bubble Tea 事件循环——最值得抄分发与 TUI 结构。

### C. 一页纸启动清单

- [ ] Node ≥22、npm 可用、Windows Terminal
- [x] 建仓库（MewAgent，私有）+ `HANDOFF.md` + `docs/tasks.md`；目录与 `AGENTS.md` 在 S0 做
- [ ] 定契约（`types.ts`）
- [ ] S0 验收：`--help` / mock 循环
- [ ] S1 验收：流式 + 中断
- [ ] S2 验收：自主读改代码
- [ ] S3 验收：审批 + 压缩 + 恢复
- [ ] S4 验收：10 条成功标准
- [ ] 录 3 分钟 demo + 更新简历/笔记
