# MewAgent 任务看板

> 唯一任务看板。会话开始时认领一个 task，结束后更新状态。
> 状态：`todo` → `doing` → `done`；被阻塞写 `blocked` 并在 HANDOFF §7 说明。
> 阶段与验收的完整说明见 [MewCode-TS实施方案.md](../MewCode-TS实施方案.md) §4。
> 每个 task 的测试步骤（AI 自动化 + 用户手工验收）见 [docs/testing.md](testing.md)，完成前按对应小节留证据。

**当前焦点：S2-8（手工验收 + 打 tag `v0.1-s2`）**
**最后更新：2026-11-24**

---

## S0 · 骨架与契约（0.5–1 天）

| ID | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|
| S0-1 | 初始化工程：`package.json` / `tsconfig.json` / `.gitignore` / `.env.example` / npm scripts；**先做 Ink 中文 IME spike** | 3h | done | `npm run typecheck` 0 错误；IME 结论写入 HANDOFF §7（判定 A，证据 `spikes/RESULT.md`） |
| S0-2 | `src/types.ts` 定契约（Message / ToolCall / ToolResult / ToolDefinition / LlmClient / Gate / AgentEvent） | 2h | done | 类型可编译；无 `any` 逃逸 |
| S0-3 | `src/config.ts` + `src/index.ts`：加载 `.env`、CLI 参数、`--help` / `--version` / `--print` 骨架 | 2h | done | `npm run dev -- --help` 输出用法；缺 key 报错可操作（证据见 HANDOFF §7 会话 5） |
| S0-4 | `src/llm/mock.ts` + 离线两轮验证 | 2h | done | `--mock --print "你好"` 走完"工具调用→最终文本"（证据见 HANDOFF §7 会话 6） |
| S0-5 | `AGENTS.md` / `CLAUDE.md` / `docs/spec.md` / `docs/checklist.md` + CI workflow | 2h | done | 文档 5 件齐备；CI 配置 `npm ci` → typecheck → test（本地模拟全绿，Actions 变绿见 HANDOFF §7 会话 7） |
| S0-6 | S0 收尾：跑全部验收、打 tag `v0.1-s0` | 0.5h | done | `git tag` 已推送（tag `v0.1-s0`；证据见 HANDOFF §7 会话 8） |

## S1 · 流式对话 + 最小 TUI（2 天）

| ID | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|
| S1-1 | `llm/sse.ts`：SSE 逐行解析（分块 / CRLF / `[DONE]` / 尾部残留）+ 测试 | 3h | done | 一行拆 3 块仍正确；`[DONE]` 不报错（证据见 HANDOFF §7 会话 9） |
| S1-2 | `llm/openai.ts`：`fetch` 流式客户端 + tool_calls 按 index 聚合 + abort | 4h | done | mock provider 下 text/tool_calls 都正确（`tests/openai.test.ts` 13 用例；证据见 HANDOFF §7 会话 10） |
| S1-3 | `agent/prompt.ts` + `messages.ts`：system prompt 与 API JSON 转换 | 2h | done | 消息角色/字段符合协议（`tests/messages.test.ts` 6 用例 + `tests/prompt.test.ts` 6 用例；证据见 HANDOFF §7 会话 11） |
| S1-4 | `ui/App.tsx`：消息列表、流式区、输入框、错误行；`<Static>` + 50ms 节流；Esc/Ctrl+C 行为 | 5h | done | 流式不闪屏；生成中可中断（代码 + `tests/ui.test.ts` 6 用例 + 假终端 TUI 冒烟；B 级 8 条已由用户验收通过，2026-11-23）。**补丁（2026-11-23）**：`MEWCODE_MOCK_DELAY_MS` 慢速流式（让 B 级能观察流式/Esc/中断）+ 自研多行输入 `ui/InputBox.tsx`（粘贴保留换行、Shift+Enter/Ctrl+J 换行、Kitty 协议自动协商、caret 多行定位），`tests/input-text.test.ts` 13 用例，全量 99/99；补丁项（多行粘贴 / Shift+Enter 生效）也已由用户确认 |
| S1-5 | `--print` 模式接真实 API | 1h | done | 无 TTY 下能跑一轮：headless 真实链路已接（system prompt 首位 → 一轮流式 → stdout 只放模型文本；`MEWCODE_DEBUG=1` 打印请求体；401/网络失败可读错误 + exit 1）。A 级：`tests/openai.test.ts` +1、`tests/config.test.ts` +4、`tests/mock.test.ts` 改写 1；全量 104/104；真实 API 冒烟先测到 HTTP 401（最初未配置 key），用户换有效 key 后 A 级复验通过：`"你好" \| npm run dev -- --print` → 中文回复 + exit 0、无 TTY 无 raw mode 报错、重定向 UTF-8 无乱码、假 key 401 + exit 1 且不泄露 key。证据见 HANDOFF §7 会话 13 / docs/testing.md S1-5 |
| S1-6 | 手工验收 + 打 tag `v0.1-s1` | 1h | done | 中文输入输出正常。全量验收：typecheck 0、`npm test` 104/104、`--help` 8 参数齐全、`--version` 0.1.0、`--mock --print` 幂等两轮、`npm run build` + dist 输出与 dev 一致、`any` 0；真实 API `--print 你好` → exit 0 + 中文回复；TUI 假终端冒烟 `SMOKE OK`；S1 手工回归由用户验收通过；tag `v0.1-s1` 已打并 push（证据见 HANDOFF §7 会话 14） |

## S2 · 工具系统 + Agent Loop（3 天）

| ID | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|
| S2-1 | `tools/paths.ts`：工作区边界校验 + 测试 | 2h | done | `../`、绝对越界均拒绝（证据见 HANDOFF §7 会话 15） |
| S2-2 | `tools/registry.ts`：注册表、JSON Schema、参数解析、异常兜底 | 3h | done | 非法 JSON / 未知工具不崩（证据见 HANDOFF §7 会话 16） |
| S2-3 | `tools/fs.ts`：read / write / edit（唯一性 + CRLF 兼容） | 4h | done | 0 次/多次匹配返回可操作错误（证据见 HANDOFF §7 会话 17） |
| S2-4 | `tools/search.ts`：glob / grep（条数上限、跳过 .git/node_modules） | 3h | done | 大仓库不卡死（glob 200 条 / grep 100 条上限；200k 行 grep 2s 内；证据见 HANDOFF §7 会话 18） |
| S2-5 | `tools/bash.ts`：shell 选择、超时 kill、30KB 截断、UTF-8/GBK | 4h | done | 超时能杀；中文输出不乱码（tests/bash.test.ts 14 例；全量 167/167；证据见 HANDOFF §7 会话 19） |
| S2-6 | `agent/loop.ts`：AgentEvent、多轮工具、maxSteps | 4h | done | mock：工具→文本；事件顺序正确（`tests/loop.test.ts` 19 例；全量 186/186；证据见 HANDOFF §7 会话 20） |
| S2-7 | UI 接线工具事件（tool_start / tool_end / 错误） | 3h | done | 工具调用可见、失败可读（`tests/tool-display.test.ts` 9 例；全量 195/195；假 stdin 冒烟 4 条工具历史 + Esc 中断；证据见 HANDOFF §7 会话 21；B 级 4 条手工项待用户） |
| S2-8 | 手工验收 + 打 tag `v0.1-s2` | 1h | todo | 能自主读 README 并总结 |

## S3 · 权限 + 会话 + 上下文压缩（2–3 天）

| ID | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|
| S3-1 | `safety/danger.ts` + `permissions.ts`：三道闸、会话白名单、headless 规则 | 4h | todo | `rm -rf` 硬拦；拒绝原因回填 |
| S3-2 | `ui/ApprovalPrompt.tsx`：y / a / n / Esc | 3h | todo | 选 a 后同类不再问；Esc 视为拒绝 |
| S3-3 | `session/store.ts`：每轮保存、启动恢复、`--new` | 3h | todo | 退出重进恢复上下文 |
| S3-4 | `context/tokens.ts` + `compress.ts`：按轮压缩 + 测试 | 4h | todo | system 保留、最新轮保留、无悬空 tool |
| S3-5 | 集成验收：50 轮不爆、恢复、拒绝后继续 + 打 tag `v0.1-s3` | 1h | todo | 全部通过 |

## S4 · 打磨与交付（2 天）

| ID | 任务 | 估时 | 状态 | 验收 |
|---|---|---|---|---|
| S4-1 | edit diff 展示 + 统一错误展示（网络/工具/权限/超步数） | 4h | todo | 错误信息带"下一步怎么做" |
| S4-2 | README（安装/配置/用法/架构/加工具教程）+ docs 收尾 | 3h | todo | 新人能照 README 跑起来 |
| S4-3 | 打包与启动验证（`npm link` 或 `npx .`，Windows 实测） | 2h | todo | 一条命令启动 |
| S4-4 | 10 条成功标准逐项验收 + 3 分钟 demo + tag `v0.1.0` | 3h | todo | HANDOFF §1 成功标准全勾 |

---

## 更新规则

1. 开始任务：状态改 `doing`，在 HANDOFF §7 记一句"开始 Sx-y"。
2. 完成条件：代码 + 测试 + 手工验收都过，状态才改 `done`。
3. 验收证据：把关键命令输出/截图路径写在 HANDOFF §7，不写进本表。
4. 新增任务：追加 ID（如 `S2-9`），不要改已有 ID 的含义。
5. 阶段完成：打 tag，并把 HANDOFF §4 的未定项核对一遍。
