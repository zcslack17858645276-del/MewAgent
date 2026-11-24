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
  - 证据：`tests/openai.test.ts` 14 用例（含 onRequest 请求体回调）、`tests/config.test.ts` 29 用例（含 4 个假 fetch 真实链路用例：输出仅模型文本、DEBUG 请求体不泄露 key、401 脱敏 + 下一步、网络失败代理提示）、`tests/mock.test.ts` 11 用例；`npm run typecheck` exit 0；全量 `npm test` 104/104；真实 API 冒烟 → HTTP 401（用户 `.env` key 被供应商判 invalid，错误链路真机验证；"真实输出文本"行待用户换有效 key 后复验），见 `docs/testing.md` S1-5 与 HANDOFF §7 会话 13。
- [x] 真实 API 冒烟（用户提供 key）：流式首字 < 2s、可中断、中文不乱码。
  - 证据：用户换有效 `MEWCODE_API_KEY` 后 A 级复验通过（`--print` 中文回复 + exit 0、无 TTY 无 raw mode、B3 重定向 UTF-8 无乱码、假 key 401 + exit 1）；TUI 侧真实流式/中断手感由用户在 S1-4 补丁验收（`MEWCODE_MOCK_DELAY_MS=80`）与 S1-5 真机复验中确认。详见 `docs/testing.md` S1-5、S1-6。
- [x] 单测 + 手工验收证据，更新文档、打 tag。
  - 证据：S1-6 全量验收 typecheck 0 / `npm test` 104/104 / `--help` 8 参数 / `--version 0.1.0` / `--mock --print` 幂等两轮 / `build` + dist 一致 / `any` 0 / 真实 API `--print` exit 0 中文 / TUI 冒烟 `SMOKE OK`；tag `v0.1-s1` 已打并 push（附注见 HANDOFF §7 会话 14、§5.3；证据文件 `spikes/.out/s1-6-acceptance.txt`）。

### S2 工具 + Agent Loop（目标：tag `v0.1-s2`）

- [x] `tools/paths.ts` 越界拦截（`..`、绝对路径、符号链接、Windows 盘符）单测。✅ 2026-11-23：`tests/paths.test.ts` 10 例（词法 + realpath 两层；盘符相对/`%VAR%`/`~` 一律拒绝），全量 114/114；TUI 级 B 级两项随 S2-6/S2-7 接线后验。
- [x] 6 个工具（read/write/edit/glob/grep/bash）参数校验、截断 30KB、`glob` ≤200 条。✅ 2026-11-24：read/write/edit（`tests/fs.test.ts` 15 例）、glob/grep（`tests/search.test.ts` 11 例）、bash（`tests/bash.test.ts` 14 例：shell 选择/超时 kill/30KB 截断/UTF-8→GBK/GBK 回退/cwd 固定工作区）；全量 `npm test` 167/167。
- [x] `tools/registry.ts` + `agent/loop.ts`：多工具连续调用、`maxSteps=30`、`turn_end` 原因正确。✅ 2026-11-24：loop 19 例（工具→文本事件顺序、多工具配对、maxSteps 默认 30、abort 三种时机、未知工具/坏 JSON/ok:false 回填、gate 拒绝/抛异常、system prompt 归一、非流式补发、signal 与 specs 透传、`createDefaultRegistry` 6 工具）；全量 186/186。B 级真实模型多工具任务随 S2-7 UI 接线后验。
- [x] 失败路径：bash 超时/kill（`tests/bash.test.ts` 超时用例，1000ms 超时约 1.5s 返回）、edit 多处匹配（`tests/fs.test.ts`）、读不存在文件（fs/search）、越界路径拒绝（`tests/paths.test.ts`）；审批级"无权限"交互随 S3-2 Gate 接线后验。
- [ ] mock 端到端 + 真实模型三步任务验收；更新文档、打 tag。

### S3 权限 + 会话 + 压缩（目标：tag `v0.1-s3`）

- [ ] `safety/danger.ts` 危险命令识别（`rm -rf /`、格式化、`git push --force` 等）单测。
- [ ] `safety/permissions.ts` Gate：写/命令必确认，拒绝原因回填模型并可继续。
- [ ] `session/store.ts`：`.mewcode/session.json` 保存/恢复/`--new`；损坏文件降级处理。
- [ ] `context/*`：按用户轮次压缩，50 轮模拟不超限、工具调用/结果配对不破坏。
- [ ] 更新文档、打 tag。

### S4 打磨与交付（目标：tag `v0.1.0`）

- [ ] README 快速开始（复制即跑）、3 分钟演示视频/脚本。
- [ ] 全量回归 + 十条成功标准逐条证据。
- [ ] 发布清单通过，打 tag `v0.1.0` 并 push。

## 3. v0.1 十条成功标准（发布前逐条勾选）

| # | 标准 | 验证方法 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | 流式回复、可中断、首字 < 2s | 真实 API 提问并掐表，Esc 中断 | 录屏/日志时间戳 | ⬜ |
| 2 | 6 工具可用 | `docs/testing.md` S2 工具小节 | 测试输出 | ⬜ |
| 3 | 多工具自主连续调用（≥3 步） | 让模型完成"读 README → 改一行 → 跑测试" | 会话记录 | ⬜ |
| 4 | 写/命令前确认，拒绝原因回填 | 拒绝一次 write，观察模型调整 | 会话截图 | ⬜ |
| 5 | 路径不越界 + 危险命令拦截 | 尝试读 `..\..\Windows`、`rm -rf` | 单测 + 实机 | ⬜ |
| 6 | 连续 50 轮不爆上下文 | 脚本灌 50 轮后继续提问 | token 统计 | ⬜ |
| 7 | 重启恢复会话 | 退出后用 `npm run dev` 继续 | 会话文件 diff | ⬜ |
| 8 | WT 中文输入输出不乱码 | Windows Terminal 输入中文提问 | S0-1 已验输入；S1 验输出 | 🚧 |
| 9 | 一条命令启动 | 新目录 `npm install && npm run dev` | 截图 | ✅ `npm run dev` |
| 10 | README + 测试 + 3 分钟演示 | 照 README 从零复现 | README 链接、演示文件 | ⬜ |

## 4. 阶段回归清单（每个阶段完成后跑一遍）

- [x] `npm ci`（或 `npm install`）+ `npm run typecheck` + `npm test` 全绿。（S0-5 干净副本 `npm ci` 52 packages；S1-6 重跑：typecheck exit 0、tests 104/104）
- [x] `npm run dev -- --help` / `--version` 正常，退出码 0。（S1-6：8 参数齐全、`0.1.0` exit 0）
- [x] `npm run dev -- --mock --print "你好"` 两轮正常，退出码 0。（S1-6 连跑两次幂等）
- [x] `npm run build && npm start` 正常。（S1-6：`npm run build` exit 0；`node dist/index.js --mock --print "你好"` 输出与 dev 一致）
- [x] Windows Terminal 下中文输入/输出一次（人工）。（S0-1 IME spike 在 WT 内完成中文输入与显示，证据 `spikes/.out/r1-03-committed.png`；S1-4 多行输入/Shift+Enter 与 S1-5 真实 API 中文输出均由用户在 WT 验收通过）
- [x] `git status` 干净、无敏感文件；远端 main 与本地一致。（S1-6 提交 tag 后核对；tag `v0.1-s0`/`v0.1-s1` 均已 push）

## 5. 发布清单（v0.1.0）

- [ ] `README.md` 快速开始可从零复制运行；包含环境要求、`.env` 说明、常用命令。
- [ ] `docs/spec.md` §13 阶段状态全部 ✅；§3 十条标准证据齐全。
- [ ] 全部 tag（`v0.1-s0` … `v0.1-s3`、`v0.1.0`）已 push 到远端。
- [ ] 3 分钟演示可复现；演示脚本/录屏路径写进 README。
- [ ] 已知限制清单（spec §11）与 `docs/tasks.md` 遗留项交给用户确认。
