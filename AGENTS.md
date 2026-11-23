# AGENTS.md — MewAgent 项目规则（所有 AI 编码代理必读）

> 仓库：MewAgent（私有，`https://github.com/zcslack17858645276-del/MewAgent`）；本地目录名仍为 `MewCode`。
> 产品名最终以用户拍板为准；**新代码、新文档统一用 MewAgent**，历史方案文档不重命名。

## 0. 开工前必读（按顺序）

1. `HANDOFF.md` —— 已定决策、Git 流程、S0–S4 红线、当前状态与会话交接（每次新会话第一件事）。
2. `docs/tasks.md` —— **唯一任务看板**；一次只做一个 task，状态 `todo → doing → done`。
3. `docs/testing.md` —— 当前 task 的 A/B/C 测试步骤与证据要求。
4. `MewCode-TS实施方案.md` —— 施工图纸（§3 架构与契约、§4 阶段任务、§5 工作流、§6 关键模块细节）。

## 1. 技术栈

- TypeScript + Node ≥ 22 + Ink 8 + React 19；构建 `tsc`、开发 `tsx`、测试 `node:test`。
- LLM 协议只做 OpenAI 兼容的 `chat/completions`；原生 `fetch` + 手写 SSE（S1 起），不用 LangChain / Vercel AI SDK / 各家 SDK。
- 依赖锁定精确版本，`package-lock.json` 进仓；**不引入新依赖**，除非 spec 明确要求并说明理由。
- 本地 Node 实测 v26.7.0；CI 固定 Node 22（`.github/workflows/ci.yml`）。

## 2. 常用命令

```powershell
npm run dev                      # 开发入口（当前为 CLI 骨架）
npm run dev -- --mock            # 离线模式（不依赖 API key / 网络）
npm run dev -- --mock --print "你好"   # headless 单次问答（S0-4 起走 mock 两轮）
npm run typecheck                # tsc --noEmit，必须 0 错误
npm test                         # node --import tsx --test tests/*.test.ts
npm run build && npm start       # 产物运行
```

## 3. 架构边界（必须遵守）

- `src/types.ts` 是**唯一契约文件**：`Message` / `ToolCall` / `ToolResult` / `ToolDefinition` / `ToolSpec` / `LlmClient` / `Gate` / `AgentEvent`。改契约必须先改方案 §3.3、更新 `docs/spec.md` 并在 `HANDOFF.md` §7 说明原因。
- `src/ui/**` 只消费 `AgentEvent`，不直接调 LLM 或工具。
- `src/agent/loop.ts` 不 import Ink、不 `console.log`、不读 stdin；只做循环编排。
- `src/tools/**` 不弹 UI，只通过 `ctx.workspace` 访问文件；路径一律走 `tools/paths.ts`，禁止手拼路径。
- `src/llm/**` 只负责协议（SSE / tool_calls 聚合 / mock），不执行工具。
- 工具执行结果统一 `{ ok, output }`；失败时 `output` 以 `Error:` 开头，保证模型能看到原因。
- 工具输出必须截断（单次 30KB）；`glob` 上限 200 条。

## 4. 代码风格

- strict TS；`noUncheckedIndexedAccess` / `noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` / `NodeNext` 全开。
- **禁止 `any` 逃逸**：外部数据用 `unknown` + 收窄；确实需要时在 PR 说明里写清原因。
- import 带 `.js` 后缀（NodeNext）；类型用 `import type`。
- 错误必须返回或抛出可读信息，禁止静默 `catch`；面向用户的错误要带「下一步」提示（见 `CliError`）。
- 注释只解释「为什么」，不解释「是什么」；中文注释/文档为主。
- 不修改无关文件；一次 task 一个主题的提交。

## 5. 完成定义（DoD）

- 本次改动：`npm run typecheck` 0 错误 + `npm test` 全绿 + 当前 task 的手工验收项通过。
- 按 `docs/testing.md` 对应小节留证据（命令、退出码、关键输出）。
- 更新 `docs/tasks.md` 状态、`HANDOFF.md` §6/§7；新增行为必须有测试（至少包含一个失败路径）。
- 按 `HANDOFF.md` §5 走 Git 流程：`task/*` 分支 → push 分支（保留原始提交）→ squash 进 `main` → push `main` → 删本地分支。
- 阶段验收通过后打 tag（`v0.1-s0` → `v0.1-s1` → `v0.1-s2` → `v0.1-s3` → `v0.1.0`）。

## 6. 本机环境注意事项（Windows）

- 本机只有 **Windows PowerShell 5.1**（无 `pwsh` 7）；脚本命令需兼容 PS 5.1。PS 5.1 读无 BOM 的 UTF-8 `.ps1` 会按 GBK 解码，脚本请保持纯 ASCII 或写 BOM。
- 终端用 **Windows Terminal**（IME 候选框位置比 conhost 好）；S0-1 的 Ink 中文 IME spike 判定 **A**（可正常输入/退格，候选框略偏可接受），不转 Go。
- 外网命令需要代理 `http://127.0.0.1:7890`（`HTTP_PROXY` / `HTTPS_PROXY`）；`npmmirror.com` 可直连。
- 本机装有 `cc-safety-net` 策略层，以下操作会被拦截且**不要绕过**：读写 `.env`、在会话工作区外递归删除、`git push --delete`（删远端分支须由用户手动执行）、`git branch -D`（用 `-d`）。
- 前端/桌面 GUI 类操作会打扰用户：默认不做；必须做时先确认用户空闲，结束后把焦点还给 DSH 窗口。

## 7. 红线

- 不提交 `.env`、密钥、`node_modules/`、`spikes/.out/`、`dist/`。
- 不跳过 `typecheck + test`；不在 `main` 上直接开发（文档/一行配置除外）。
- 一次只做一阶段一 task；不顺手重构未要求的部分。
- 不擅自改技术选型、架构分层与契约；有疑问先写进 `HANDOFF.md` §4 待用户拍板。
