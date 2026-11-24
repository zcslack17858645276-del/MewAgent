# MewAgent 验收清单（checklist)

> 用法：每个 task 完成时、每个阶段验收时、发布前逐条勾选。
> 证据写到 `HANDOFF.md` §7 会话记录或本表「证据」列；详细步骤见 `docs/testing.md` 对应小节。
> 规则：P0 项未过不得标 done；勾选必须附命令/输出/commit，不接受「应该没问题」。

## 1. 每个 task 的通用 DoD（Definition of Done）

- [ ] 本次改动范围内 `npm run typecheck` 退出码 0。
- [ ] `npm test` 全绿（记录 tests/pass/fail 数量）。
- [ ] `docs/testing.md` 对应小节的 A 级项全部通过；B 级项交用户复核（写明未做项）。
- [ ] 新增行为有测试，且至少覆盖一个失败路径（参数错误/权限拒绝/网络错误等）。
- [ ] 无 `any` 逃逸（`Select-String '\bany\b' src` 应为 0）；无新增依赖，或已在 HANDOFF 说明理由。
- [ ] `docs/tasks.md` 状态更新为 done，并改「当前焦点」。
- [ ] `HANDOFF.md` §6 状态行、§7 本次会话记录已更新（含提交哈希、坑、下次第一步）。
- [ ] Git 流程：`task/*` 分支 → push 保留原始提交 → squash 进 `main` → push `main` → 删本地分支。
- [ ] `git status` 干净；`git diff --stat` 不含 `.env`、密钥、`node_modules/`、`spikes/.out/`、`dist/`。
- [ ] 产物可运行（`npm run build && npm start` 或对应入口无报错）。

## 2. 阶段清单

### S0 工程骨架与验证（目标：tag `v0.1-s0`）

- [x] **S0-1** 工程初始化（package/tsconfig/build/test/gitignore/.env.example）+ Ink 中文 IME spike 判定 A，证据 `spikes/RESULT.md`。
- [x] **S0-2** `src/types.ts` 契约齐全、可编译、无 `any`；4 条负例 `@ts-expect-error`。
- [x] **S0-3** CLI 骨架：`--help` 全参数、`--version`、缺 key 友好报错不泄露 key、未知参数报错、`--print`/TTY 分支、25 个单测。
- [x] **S0-4** `src/llm/mock.ts` 离线两轮：`--mock --print "你好"` 输出工具调用→最终文本，断代理可跑，39 个测试全绿。
- [x] **S0-5** `AGENTS.md` / `CLAUDE.md` / `docs/spec.md` / `docs/checklist.md` / `.github/workflows/ci.yml`；CI 在 GitHub Actions 变绿（用户复核确认，2026-11-23）。
  - 证据：Actions 全部运行 success，agent 已用 `gh run list/view` 独立复核 —— run `45144911048`（`9acc5b5`，task 分支）、`45144932628`（`688b832` main）、`45144982815`（`29b5178` main）、`45149633152`（`2068dac` main，证据提交后再次通过）；`45144982815` 的步骤 Checkout/Setup Node.js/Install dependencies/Typecheck/Test 全 success，测试日志 `# tests 39 / # pass 39 / # fail 0`；截图 `docs/evidence/s0-5-ci-actions.png`；本地模拟 `npm ci` + `typecheck` + `test`（39/39）见 HANDOFF §7 会话 7。
- [x] **S0-6** 全量验收（typecheck/test/`--help`/`--version`/`--mock --print` 幂等重跑）→ `docs/checklist.md` §3 全部勾选 → 打 tag `v0.1-s0` 并 push。
  - 证据：`npm run typecheck` exit 0；`npm test` exit 0（tests 39 / pass 39 / fail 0）；`npm run dev -- --help` exit 0 且 8 个参数齐全；`--version` exit 0 输出 `0.1.0`；`--mock --print "你好"` 连跑两次 exit 0 且输出完全一致（幂等）；`npm run build` exit 0、`node dist/index.js --mock --print "你好"` 与 dev 输出一致；`src/` 中 `any` 匹配 0；tag `v0.1-s0` 已打并 push（证据文件 `spikes/.out/s0-6-acceptance.txt`，gitignored；摘要见 HANDOFF §7 会话 8）。B 级复核（`git log` 历史 + tasks/HANDOFF 状态 + tag 一致性）已由用户于 2026-11-23 确认通过。

### S1 SSE + TUI（目标：tag `v0.1-s1`）

- [x] `src/llm/sse.ts`：一行拆多块、`[DONE]`、空行、跨 chunk 半行、CRLF、`data:` 前缀解析（单测覆盖，方案 §7.1）。
  - 证据：`tests/sse.test.ts` 13 用例全过（分块、UTF-8 截断、CRLF、注释、多行 data、无空格 data、`[DONE]`、尾部残留、BOM、空 data、AbortError）；`npm run typecheck` exit 0；全量 `npm test` 52/52（原 39 + 新增 13），见 `docs/testing.md` S1-1 与 HANDOFF §7 会话 9。B 级复核（抽查边界用例，9 个非 happy path）已由用户于 2026-11-23 确认通过。
- [x] `src/llm/openai.ts`：`tools` 转 `ToolSpec`、`tool_calls` 增量聚合、错误映射、`AbortSignal` 中止。
  - 证据：`tests/openai.test.ts` 13 用例全过（聚合分片/乱序 index/空 delta/首次 id-name/缺 id 占位、`toApiMessages` 四角色、文本流 + `onText` + 请求体/请求头断言、`tool_calls` 流式聚合、401 脱敏、预中止 `AbortError`、坏 JSON、无 body）；`npm run typecheck` exit 0；全量 `npm test` 65/65（原 52 + 新增 13），见 `docs/testing.md` S1-2 与 HANDOFF §7 会话 10。B 级模块级复核（抽查用例边界、mutation 检验、CI 65/65 日志）已由用户于 2026-11-23 完成；真实 API 三行（流式/Esc/错 key 实机）留到 S1-4/S1-5 联调。
- [x] `src/agent/prompt.ts` + `src/agent/messages.ts`：system prompt、`Message[]` → OpenAI 线上格式（tool 角色 / `tool_call_id` / `assistant.toolCalls` 配对）。
  - 证据：`tests/messages.test.ts` 6 用例（四角色转换、assistant 无 toolCalls 不带 `tool_calls`、tool 消息字段、空数组与入参不被修改、`toAssistantMessage` 两种结果）+ `tests/prompt.test.ts` 6 用例（身份/工作区/工具提示、确定性、`withSystemPrompt` 首位且唯一 / 替换旧 system / 不改入参）；`npm run typecheck` exit 0；全量 `npm test` 77/77，见 `docs/testing.md` S1-3 与 HANDOFF §7 会话 11。`toApiMessages` 自 S1-2 迁入 `src/agent/messages.ts`。B 级复核（用户 2026-11-23 已完成）已确认。
- [x] `src/ui/App.tsx`（S1-4）：输入框 + `<Static>` 历史 + 流式动态区 + 错误行 + 排队；50ms 节流；Esc/Ctrl+C 中断/退出；mock 两轮剧本与真实客户端 send 注入。
  - 证据：`tests/ui.test.ts` 6 用例（宽字符宽度、节流首次立即/50ms 合并/flush/cancel/空 delta、`HistoryItem` 中文渲染）；`npm run typecheck` exit 0；`npm run build` exit 0（`.tsx` 正常进 dist）；全量 `npm test` 83/83；假 stdin/stdout 驱动 Ink 的 TUI 冒烟 `SMOKE OK`（启动横幅/工作区/就绪、提交"你好"→ mock 两轮文本进历史、排队提示、空闲 Ctrl+C 退出）。8 条 B 级手工项（中文输入、闪烁、Esc、Ctrl+C、缩放、粘贴、空回车、连发）**已由用户于 2026-11-23 验收通过**，见 `docs/testing.md` S1-4 与 HANDOFF §7 会话 12；状态机当前只有 `idle|streaming`，`tool_running/awaiting_approval/error` 随 S2-7/S3-2 接入。
  - 补丁（2026-11-23）：`src/ui/InputBox.tsx` 多行输入（粘贴保留换行、Shift+Enter/Ctrl+J 换行、Kitty 协议协商、caret 多行定位）+ `MEWCODE_MOCK_DELAY_MS` 慢速流式；`tests/input-text.test.ts` 13 用例、`tests/mock.test.ts` 11 用例、全量 `npm test` 99/99；假终端冒烟覆盖多行粘贴 / Shift+Enter / Ctrl+J → `SMOKE OK`。B 级补丁项（用户 2026-11-23 确认）：多行粘贴保留换行、Shift+Enter 换行生效（WT 1.25 Kitty 协议）、`MEWCODE_MOCK_DELAY_MS=80` 慢速流式可观察。
- [x] `--print` 接真实 API（S1-5）：headless 真实链路（system prompt 首位 → 一轮流式 → stdout 只放模型文本）、`MEWCODE_DEBUG=1` 请求体调试、401/网络失败可读错误 + 退出码 1。
  - 证据：`tests/openai.test.ts` 14 用例（含 onRequest 请求体回调）、`tests/config.test.ts` 29 用例（含 4 个假 fetch 真实链路用例：输出仅模型文本、DEBUG 请求体不泄露 key、401 脱敏 + 下一步、网络失败代理提示）、`tests/mock.test.ts` 11 用例；`npm run typecheck` exit 0；全量 `npm test` 104/104；真实 API 冒烟 → HTTP 401（用户 `.env` key 被供应商判 invalid，错误链路真机验证；"真实输出文本"行已由用户 2026-11-24 用有效 key 复验通过），见 `docs/testing.md` S1-5 与 HANDOFF §7 会话 13。
- [x] 真实 API 冒烟（用户提供 key）：流式首字 < 2s、可中断、中文不乱码。
  - 证据：用户换有效 `MEWCODE_API_KEY` 后 A 级复验通过（`--print` 中文回复 + exit 0、无 TTY 无 raw mode、B3 重定向 UTF-8 无乱码、假 key 401 + exit 1）；TUI 侧真实流式/中断手感由用户在 S1-4 补丁验收（`MEWCODE_MOCK_DELAY_MS=80`）与 S1-5 真机复验中确认。详见 `docs/testing.md` S1-5、S1-6。
- [x] 单测 + 手工验收证据，更新文档、打 tag。
  - 证据：S1-6 全量验收 typecheck 0 / `npm test` 104/104 / `--help` 8 参数 / `--version 0.1.0` / `--mock --print` 幂等两轮 / `build` + dist 一致 / `any` 0 / 真实 API `--print` exit 0 中文 / TUI 冒烟 `SMOKE OK`；tag `v0.1-s1` 已打并 push（附注见 HANDOFF §7 会话 14、§5.3；证据文件 `spikes/.out/s1-6-acceptance.txt`）。

### S2 工具 + Agent Loop（目标：tag `v0.1-s2`）

- [x] `tools/paths.ts` 越界拦截（`..`、绝对路径、符号链接、Windows 盘符）单测。✅ 2026-11-23：`tests/paths.test.ts` 10 例（词法 + realpath 两层；盘符相对/`%VAR%`/`~` 一律拒绝），全量 114/114；TUI 级 B 级两项随 S2-6/S2-7 接线后验。
- [x] 6 个工具（read/write/edit/glob/grep/bash）参数校验、截断 30KB、`glob` ≤200 条。✅ 2026-11-24：read/write/edit（`tests/fs.test.ts` 15 例）、glob/grep（`tests/search.test.ts` 11 例）、bash（`tests/bash.test.ts` 14 例：shell 选择/超时 kill/30KB 截断/UTF-8→GBK/GBK 回退/cwd 固定工作区）；全量 `npm test` 167/167。
- [x] `tools/registry.ts` + `agent/loop.ts`：多工具连续调用、`maxSteps=30`、`turn_end` 原因正确。✅ 2026-11-24：loop 19 例（工具→文本事件顺序、多工具配对、maxSteps 默认 30、abort 三种时机、未知工具/坏 JSON/ok:false 回填、gate 拒绝/抛异常、system prompt 归一、非流式补发、signal 与 specs 透传、`createDefaultRegistry` 6 工具）；全量 186/186。B 级真实模型多工具任务随 S2-7 UI 接线后验。
- [x] 失败路径：bash 超时/kill（`tests/bash.test.ts` 超时用例，1000ms 超时约 1.5s 返回）、edit 多处匹配（`tests/fs.test.ts`）、读不存在文件（fs/search）、越界路径拒绝（`tests/paths.test.ts`）；审批级"无权限"交互随 S3-2 Gate 接线后验。
- [x] `ui/App.tsx` 事件接线（S2-7，2026-11-24）：`runTurn` 注入 + `AgentEvent` 消费（`assistant_text`/`tool_start`/`tool_end`/`turn_end`）；工具历史 `✅/❌ <name> {参数摘要} · 耗时[ · Error: 首行]`；`tool_running` 状态行；`src/ui/tool-display.ts` 纯函数 9 例；全量 `npm test` 195/195；假 stdin 冒烟 `SMOKE OK`。B 级 4 条（工具可见/失败可读/连发 3 工具/长参数截断）已由用户 2026-11-24 实测通过。补丁（2026-11-24）：`src/ui/stream-lines.ts` 完整行提交 Static + 动态区尾巴 ≤800 码点，修复长输出滚动叠字，`tests/stream-lines.test.ts` 9 例、全量 204/204、冒烟 `SMOKE OK`（长输出每行只出现一次）。
- [x] mock 端到端 + 真实模型三步任务验收；更新文档、打 tag。
  - 证据（S2-8，2026-11-24）：自动验收 `npm run typecheck` exit 0、全量 `npm test` **204/204**、`--help` 8 参数、`--version 0.1.0`、`--mock --print` 两次输出一致、`build` + `dist` 与 dev 一致、`src/` `any` 0、TUI 假终端冒烟 `SMOKE OK`、6 工具 loop 演示 `ALL TOOLS OK`、真实 API `--print` exit 0；真实模型自主任务：`read_file` + `glob` 读 README 并总结 `README ACCEPTANCE OK`（2 工具 3 步）；S2 全部 B 级手工项已由用户 2026-11-24 实测通过（会话 A/B）；tag `v0.1-s2` 已打并 push（见 HANDOFF §7 会话 22、`docs/testing.md` S2-8）。

### S3 权限 + 会话 + 压缩（目标：tag `v0.1-s3`）

- [x] `safety/danger.ts` 危险命令识别（`rm -rf /`、格式化、`git push --force` 等）单测。
  - 证据（S3-1，2026-11-24）：`tests/danger.test.ts` **9 例**通过（`rm -rf`/`rmdir`/`del /f /s /q`/`format`/`shutdown`/`diskpart`/`disk`/`dd`/`bcdedit`/注册表系统 hive/写系统目录/fork 炸弹；包装器 `sudo`/`env`/`powershell -Command` 等剥壳后识别；正常命令不误杀）；全量 232/232。
- [x] `safety/permissions.ts` Gate：写/命令必确认，拒绝原因回填模型并可继续。
  - 证据（S3-1，2026-11-24）：`tests/permissions.test.ts` **18 例**通过（只读放行、写需审批、y/a/n、白名单、路径越界先于审批、危险命令硬拦、headless 只读规则、审批异常按拒绝、`summarizeToolCall` 摘要）；`tests/config.test.ts` headless 拒绝写工具端到端（模型收到 `权限被拒绝` 后改用文本回答、文件未创建）；交互审批 UI 随 S3-2。
  - 证据（S3-2，2026-11-24）：`src/ui/approval.ts` 审批桥 + `src/ui/ApprovalPrompt.tsx`（y/a/n/Esc、Esc=拒绝、a 本会话白名单）、`awaiting_approval` 展示态（审批时输入框失焦、仅 Ctrl+C 可中断）；`tests/approval.test.ts` **9 例**通过（controller/白名单/拒绝原因/弹窗渲染）；假 stdin 审批冒烟 `APPROVAL SMOKE OK`（y 放行 / a 后同类不问 / Esc 拒绝且文件未改 / 非 y·a·n 键被忽略 / Ctrl+C 退出）；全量 `npm test` 241/241。B 级 4 条已由用户 2026-11-24 实测通过。
- [x] `session/store.ts`：`.mewcode/session.json` 保存/恢复/`--new`；损坏文件降级处理。
  - 证据（S3-3，2026-11-24）：`tests/session.test.ts` **14 例**通过（路径、保存→加载往返与 `{version:1,workspace,model,createdAt,updatedAt,messages}` 字段、system 剥离、toolCalls 保留、空历史不落盘、无文件→empty、`--new` 跳过、坏 JSON/未知版本/messages 非数组/单条消息非法→corrupt + 原因、临时文件无残留、保存失败返回 `{ok:false}` 不抛）；`tests/config.test.ts` 新增 3 例端到端（TUI 启动恢复 `restoredMessageCount`/`initialMessages`/`persistMessages` 保留 createdAt、损坏文件提示并按新会话、`--new` 忽略已有会话）；全量 `npm test` **258/258**。B 级 2–5（重启恢复/`--new`/损坏降级/`git status` 不跟踪）已由用户 2026-11-24 实测通过。
- [x] `context/*`：按用户轮次压缩，50 轮模拟不超限、工具调用/结果配对不破坏。
  - 证据（S3-4，2026-11-24）：`src/context/tokens.ts`（CJK 1.1/字、其他 1/4、每条 +8、预算 = contextTokens×0.7）+ `src/context/compress.ts`（按 user 分轮、system 常驻、最新轮必留、旧轮整轮丢弃保持 assistant.toolCalls↔tool 配对、最新轮超预算截断 tool 2000/assistant 4000、去掉开头悬空 tool）；`src/agent/loop.ts` 增 `contextTokens`/`onCompress`（请求前压缩副本、历史完整保留）；`src/index.ts` 读 `MEWCODE_CONTEXT_TOKENS`（默认 128000）、`MEWCODE_DEBUG=1` 输出 `[压缩]`；`tests/compress.test.ts` **17 例** + `tests/loop.test.ts` 压缩接线 2 例通过；全量 `npm test` **277/277**；`npm run build` exit 0；`src/context/*` `any` 0。B 级 2–4（50 轮不超限、`[压缩]` 统计、压缩后追问）已由用户 2026-11-24 实测通过。
- [x] 更新文档、打 tag。
  - 证据（S3-5，2026-11-24）：`docs/tasks.md` S3-5 done/焦点 S4-1、`docs/testing.md` S3-5 已完成小节、`docs/spec.md` §13 S3-5 ✅ 与 S3 行 ✅、本清单 S3 全项 `[x]`、`HANDOFF.md` §7 会话 27；tag `v0.1-s3`（annotated，S3 收尾提交，已 push）。

### S4 打磨与交付（目标：tag `v0.1.0`）

- [x] README 快速开始（复制即跑）与 README 重写（S4-2，2026-11-24）。README 覆盖安装、配置（`.env.example` + 环境变量表 + 代理）、快速开始（mock/TUI/真实 API/workspace/build）、命令参数、架构图 + 数据流、目录结构、6 工具表、3 步加工具教程（`ToolDefinition` 代码 + 注册 + 测试）、权限与安全、会话与压缩、错误展示、测试与 CI、Windows 注意、已知限制/Roadmap；`--help` banner 改「（v0.1）」。A 级：仓库克隆到临时目录仅照 README 跑通 `npm install`（52 包/4s）→ `npm run typecheck` 0 → `npm test` **296/296** → `npm run dev -- --mock --print "你好"` 0 → `npm run build` 0 → `node dist/index.js --mock --print "你好"` 0。3 分钟演示视频/脚本待 S4-4。
- [x] 打包与启动（S4-3，2026-11-24）。`package.json` 增 `bin.mewagent=./dist/index.js`、`prepack` 构建、`files` 白名单；入口 shebang + realpath 直跑判断（修复 junction 下静默退出）；`tests/packaging.test.ts` 5 例。A 级：`npm link` 后任意目录 `mewagent --version/--help/--mock --print` 均 0（含空格+中文路径）、`npx . --mock --print hello` 0、`npm unlink -g mewagent` 无残留、`npm pack` 产物仅含 dist+README+docs（77 项/230KB），全量 **303/303**。B 级 4 条已由用户 2026-11-24 实测通过。
- [x] diff 与错误展示（S4-1，2026-11-24）。
  - 证据：`edit_file` 输出行级 unified diff（`src/tools/diff.ts`，`--- a/`/`+++ b/`/`@@`/4 位行号）→ TUI 解析为红删/绿增/青 hunk 历史条目（`src/ui/diff-view.ts` + `HistoryItem`，最多 80 行）；HTTP（401/403/404/429/5xx）、网络（含代理提示）、中断、工具失败、权限拒绝、超步数统一由 `src/errors.ts` 产出「发生了什么 + 下一步」，TUI 与 headless 共用；`formatTurnEndNote` 的 max_steps 也带下一步。
  - 测试：`tests/diff.test.ts` 9 例 + `tests/errors.test.ts` 4 例 + `tests/diff-view.test.ts` 5 例，ui/fs/tool-display 断言同步更新，全量 **296/296**（26 个测试文件）；`npm run typecheck` 0、`build` 0、TUI 冒烟 `SMOKE OK`、`src/` 无 `any`；B 级 3 条已由用户 2026-11-24 实测通过（`docs/testing.md` S4-1 小节）。
- [x] 首次启动配置向导（HF-1，2026-11-24）。交互式缺配置时弹 3 步向导（base-url / 模型 / API key），可测试连接后保存到用户级 `config.json`（0600），`--setup` 重跑、非 TTY 不弹；`resolveConfig` 优先级 CLI > env > 用户 `config.json` > 默认。
  - 证据：`src/config.ts`（`UserConfig`/`readUserConfig`/`saveUserConfig`/`findMissingConfig`）、`src/setup/probe.ts`（10s 超时连接测试、错误带下一步、不回显 key）、`src/ui/SetupWizard.tsx` + `src/ui/start-setup.tsx`、`src/index.ts` 接入；`tests/setup.test.ts` 9 例 + `tests/user-config.test.ts` 6 例 + `tests/setup-wizard.test.ts` 10 例，全量 **330/330**（1 skip），build 0；E2E 证明无 cwd `.env` 时从用户级 `config.json` 读取 model/key/base-url；B 级 4 条已由用户 2026-11-24 实测通过（`docs/testing.md` HF-1 小节）。
- [x] 10 条成功标准逐项验收 + 3 分钟 demo + tag `v0.1.0`（S4-4，2026-11-24）。十条标准见 §3 全部 ✅；`docs/demo.md` 演示脚本 + README §7/文档索引链接；全量 330/330、冒烟三项、真实 API 首字 1314ms/多工具 3 步/审批拒绝回填、`INTEGRATION OK`；tag `v0.1.0` 已 push。
- [x] 全量回归 + 十条成功标准逐条证据（S4-4，2026-11-24）。typecheck 0 / tests **330/330**（329 pass + 1 skip，30 文件）/ build 0 / `--help`+`--version` / `--mock` 幂等 / dist 一致 / any 0 / 冒烟 `SMOKE OK`+`APPROVAL SMOKE OK`+`ALL TOOLS OK`；真实 API：首字 1314ms、3 次工具调用（4 轮 LLM）、审批拒绝回填；`INTEGRATION OK`；证据 `spikes/.out/s4-4-*.txt`、`docs/testing.md` S4-4。
- [x] 发布清单通过，打 tag `v0.1.0` 并 push（见 §5 与 HANDOFF §5.3）。

## 3. v0.1 十条成功标准（发布前逐条勾选）

| # | 标准 | 验证方法 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 流式回复、可中断、首字 < 2s | 真实 API 提问并掐表，Esc 中断 | 日志时间戳 | ✅ 2026-11-24 真实 API 首字 **1314ms**（`spikes/.out/s4-4-real-api.txt`）；S1-4 用户 B 级验收含 Esc 中断 |
| 2 | 6 工具可用 | `docs/testing.md` S2 工具小节 | 测试输出 | ✅（6 工具单测 + 真实模型 TUI 调用均通过，2026-11-24） |
| 3 | 多工具自主连续调用（≥3 步） | 让模型完成“读 README → 改一行 → 跑测试” | 会话记录 | ✅ 2026-11-24 真实 API：3 次工具调用（read_file→grep→bash）、4 轮 LLM、stop；S2-8 真实模型读 README 也通过 |
| 4 | 写/命令前确认，拒绝原因回填 | 拒绝一次 write，观察模型调整 | 会话截图 | ✅ 2026-11-24 真实 API：审批询问 1 次、拒绝原因回填、文件未创建、模型继续；S3-2 用户 B 级 y/a/n 已验 |
| 5 | 路径不越界 + 危险命令拦截 | 尝试读 `..\..\Windows`、`rm -rf` | 单测 + 实机 | ✅ 单测（paths 10 / danger 9 / permissions 18）+ 用户实测危险命令与 headless 写拒绝；S3-5 集成 `rm -rf /` asked=0 |
| 6 | 连续 50 轮不爆上下文 | 脚本灌 50 轮后继续提问 | token 统计 | ✅（S3-4 代码 + S3-5 集成：`spikes/.out/s3-5-integration.ts` 50 轮全部 `stopReason=stop`、内存历史 101 条完整、压缩 50 次 `maxDropped=41`、末次请求 18 条且 system 首位、tool 配对完整；用户 2026-11-24 50 轮 mock B 级通过） |
| 7 | 重启恢复会话 | 退出后用 `npm run dev` 继续 | 会话文件 diff | ✅（S3-3：`session/store.ts` 每轮保存/启动恢复/`--new`/损坏降级 + `tests/session.test.ts` 14 例 + `tests/config.test.ts` 3 例端到端；B 级 2–5 已由用户 2026-11-24 实测通过；S3-5 集成脚本复验 2→4 条消息、createdAt 保留） |
| 8 | WT 中文输入输出不乱码 | Windows Terminal 输入中文提问 | S0-1 输入；S4-4 输出 | ✅ 输入 S0-1（用户实测）；输出 2026-11-24 真实 API 中文无乱码 + TUI 冒烟 |
| 9 | 一条命令启动 | 新目录 `npm install && npm run dev` | 截图 | ✅ `npm run dev`；S4-3 起全局 `mewagent`（`npm link`）与 `npx .` 也已实测（任意目录、含空格/中文路径） |
| 10 | README + 测试 + 3 分钟演示 | 照 README 从零复现 | README 链接、演示文件 | ✅ README 重写（S4-2 用户另一台机器实测通过）；测试 330/330；[`docs/demo.md`](demo.md) 3 分钟演示（README §7 链接） |

## 4. 阶段回归清单（每个阶段完成后跑一遍）

- [x] `npm ci`（或 `npm install`）+ `npm run typecheck` + `npm test` 全绿。（S0-5 干净副本 `npm ci` 52 packages；S1-6 重跑：typecheck exit 0、tests 104/104；S2-8：typecheck exit 0、tests **204/204**；S3-4：typecheck exit 0、tests **277/277**；S3-5 复跑同 277/277；S4-1：typecheck 0、tests **296/296**、build 0；S4-2 克隆副本：`npm install`（52 包/4s）→ typecheck 0 → tests **296/296** → `--mock` 0 → build 0 → dist 0；S4-4：typecheck 0、tests **330/330**、build 0）
- [x] `npm run dev -- --help` / `--version` 正常，退出码 0。（S1-6：8 参数齐全、`0.1.0` exit 0；S2-8 同；S3-5 复跑同）
- [x] `npm run dev -- --mock --print "你好"` 两轮正常，退出码 0。（S1-6 连跑两次幂等；S2-8：两次输出一致；S3-5 复跑一致）
- [x] `npm run build && npm start` 正常。（S1-6：`npm run build` exit 0；`node dist/index.js --mock --print "你好"` 输出与 dev 一致；S2-8 同；S3-5 复跑一致）
- [x] Windows Terminal 下中文输入/输出一次（人工）。（S0-1 IME spike 在 WT 内完成中文输入与显示，证据 `spikes/.out/r1-03-committed.png`；S1-4 多行输入/Shift+Enter 与 S1-5 真实 API 中文输出均由用户在 WT 验收通过；S2-8 用户 TUI 实测 glob/grep/bash 中文输出正常）
- [x] `git status` 干净、无敏感文件；远端 main 与本地一致。（S1-6 提交 tag 后核对；S2 收尾后核对：tag `v0.1-s0`/`v0.1-s1`/`v0.1-s2` 均已 push；S3-5 收尾后：tag `v0.1-s3` 已 push、main 与远端一致）

## 5. 发布清单（v0.1.0）

- [x] `README.md` 快速开始可从零复制运行；包含环境要求、`.env` 说明、常用命令。（S4-2 克隆副本 A 级 + 用户另一台机器实测通过）
- [x] `docs/spec.md` §13 阶段状态全部 ✅（S4 行 ✅）；§3 十条标准证据齐全（2026-11-24）。
- [x] 全部 tag（`v0.1-s0` … `v0.1-s3`、`v0.1.0`）已 push 到远端（见 HANDOFF §5.3）。
- [x] 3 分钟演示可复现；演示脚本路径已写进 README §7 与文档索引（[`docs/demo.md`](demo.md)）。
- [x] 已知限制清单（spec §11）与 `docs/tasks.md` 遗留项已交用户确认——用户 2026-11-24 完成最终测试复核，未提出需要变更的项。
