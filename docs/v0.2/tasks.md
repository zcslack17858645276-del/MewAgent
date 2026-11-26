# MewAgent v0.2 任务看板

> 唯一任务状态来源。状态只允许：`todo` / `doing` / `blocked` / `done`。
> 规则：一次只把一个 task 置 `doing`；完成必须同时满足 [playbook.md](./playbook.md) 的 DoD 与 [testing.md](./testing.md) 对应章节；阶段结束打 tag 并回填 HANDOFF §7。
> 估时按"业余每天 2–3 小时"；冲刺模式约减半。依赖列写 task id；`—` 表示无。

## V2-0 · 准备（0.5–1 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-0-1 | 基线核对与开工准备 | HANDOFF §7 基线记录；`git status` 干净 | `v0.1.0-final` 存在且指向 `8bd74fb`；`npm test` 330（329+1skip）；记录 Node/npm 版本；确认从 `main` 开分支 | 0.5 天 | — | done |
| V2-0-2 | ADR-0001 依赖策略 | `docs/adr/0001-dependency-policy.md` | 写清 MCP SDK 版本/许可/体积/可移除性；口径"核心自研、周边用库"；不引入 LangChain | 0.5 天 | — | todo |
| V2-0-3 | 压缩验收剧本 | `tests/fixtures/long-conversation.md`；关键事实清单 | 60 轮剧本含：目标、否决方案、权限顺序、文件名、待办；清单 8–10 条可人工核对；不依赖真实 API | 0.5 天 | — | todo |

> **V2-0-1 证据（会话 40，2026-11-26）**：`v0.1.0-final` → `8bd74fb`；HEAD = origin/main = `6241382`；Node `v26.7.0` / npm `12.0.2`；`npm run typecheck` 0 错；`npm test` 330（329 pass + 1 skip + 0 fail）；分支 `v2/V2-0-1-baseline`；详见 HANDOFF §7 会话 40。

## V2-1 · LLM 摘要压缩（3–4 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-1-1 | 摘要器 `summarize.ts` | `src/context/summarize.ts` + 单测 | 输入旧轮 + 上一版摘要 → 结构化摘要（目标/约束/决策/文件/待办）；`SUMMARY_MAX_CHARS=2000`；超时/错误分类；mock LLM 单测 | 1 天 | V2-0-3 | todo |
| V2-1-2 | 摘要压缩策略 | `compress.ts` 扩展 + 单测 | 保留最近 2 轮；预算 70%；旧轮走摘要；摘要失败回退 v0.1 丢弃；`strategy`/`summarizedTurns` 统计正确 | 1 天 | V2-1-1 | todo |
| V2-1-3 | Loop 注入异步压缩 | `agent/loop.ts` 扩展 + 单测 | `AgentLoopOptions.compress` 可注入；await 期间 abort 生效；失败不中断整轮；`onCompress` 统计含摘要信息 | 0.5–1 天 | V2-1-2 | todo |
| V2-1-4 | 摘要落盘与重启复用 | `session/store.ts` v1→v2 迁移 + 单测 | `SessionFile.summary` 保存/读取；重启后不重复摘要同一批旧轮；旧文件迁移不丢消息 | 0.5–1 天 | V2-1-3 | todo |
| V2-1-5 | 阶段验收 + tag | 验收记录；tag `v0.2-s1` | 60 轮 B 级剧本能答关键事实；记录摘要调用次数/耗时；HANDOFF §7 回填 | 0.5 天 | V2-1-4 | todo |

## V2-2 · 多会话管理（3–4 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-2-1 | 会话存储 v2 | `session/store.ts` + 单测 | `.mewcode/sessions/<id>.json` + `index.json`；原子写；标题取首条 user 消息（≤60 字）；索引损坏可重建；v1 自动迁移并留 `.bak` | 1–1.5 天 | V2-1-4 | todo |
| V2-2-2 | CLI 参数与选择逻辑 | `config.ts` / `index.ts` + 单测 | `--resume`（无参进选择器/带 id 直接进）、`--list`（非交互表格）、`--new`；参数冲突有明确报错；usage 更新 | 0.5–1 天 | V2-2-1 | todo |
| V2-2-3 | 启动会话选择器 | `src/ui/SessionPicker.tsx` + B 级手测 | 最近 10 条（标题/时间/条数）；↑↓ 选择、Enter 进入、Esc 取消（按新会话启动）；空列表直接新会话 | 0.5–1 天 | V2-2-2 | todo |
| V2-2-4 | 会话生命周期贯通 | `/clear` + header 显示 + 保存恢复 | 新会话不覆盖旧文件；header 显示 id/标题；每轮保存到正确文件；损坏会话降级提示 | 1 天 | V2-2-3 | todo |
| V2-2-5 | 阶段验收 + tag | 验收记录；tag `v0.2-s2` | 同工作区 3 会话互不覆盖；重启恢复指定会话；迁移演练通过 | 0.5 天 | V2-2-4 | todo |

## V2-3 · Slash 命令（2–3 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-3-1 | 解析器与帮助文本 | `src/ui/commands.ts` + 单测 | `parseSlash` 纯函数；`/`、未知命令、多余空格、多参数、中文输入都有确定结果；帮助文本含快捷键 | 0.5 天 | V2-2-4 | todo |
| V2-3-2 | 执行器与模型控制器 | `commands.ts` + `index.ts` + 单测 | `/help` 列表；`/clear` 清空并开新会话；`/model` 查看/切换；切换后重建 LlmClient、会话 model 更新 | 1 天 | V2-3-1 | todo |
| V2-3-3 | App 接线与忙碌保护 | `ui/App.tsx` + B 级手测 | slash 不发给模型；提示进历史区；生成中拒绝并说明；中文 IME 下输入 `/` 正常 | 0.5–1 天 | V2-3-2 | todo |
| V2-3-4 | 阶段验收 + tag | 验收记录；tag `v0.2-s3` | 三条命令全可用；未知命令不产生请求；HANDOFF §7 回填 | 0.5 天 | V2-3-3 | todo |

## V2-4 · MCP 工具接入（4–5 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-4-1 | 依赖与配置 | `package.json`、`src/mcp/config.ts`、示例配置 + 单测 | `@modelcontextprotocol/sdk@1.32.2`；`.mewcode/mcp.json` 校验（command/args/env）；`MEWCODE_MCP=0` 关闭；记录 `npm ls` 与打包体积 | 0.5–1 天 | V2-3-4 | todo |
| V2-4-2 | 客户端管理 | `src/mcp/client.ts` + fixture 集成测试 | 连接（5s 超时）、`tools/list`、`callTool`（60s 超时）、`close`、单 server 失败隔离、状态上报 | 1–1.5 天 | V2-4-1 | todo |
| V2-4-3 | 工具适配器 | `src/mcp/adapter.ts` + 单测 | `mcp__<server>__<tool>` 命名/冲突处理；inputSchema 映射；`readOnlyHint`；结果 30KB 截断；错误映射为 `ok:false` | 1 天 | V2-4-2 | todo |
| V2-4-4 | 权限与 UI 集成 | gate/App/headless + 集成测试 | MCP 工具默认 ask；`trustReadOnly` 默认 false；headless 默认拒绝；header 显示 server 状态；工具名可读 | 1 天 | V2-4-3 | todo |
| V2-4-5 | 阶段验收 + tag | 验收记录；tag `v0.2-s4` | 真实 filesystem server 可列/可调；server 崩溃不拖垮本地工具；退出无孤儿进程 | 0.5–1 天 | V2-4-4 | todo |

## V2-5 · npm 发布与收尾（2–3 天）

| ID | 任务 | 产物 | 验收要点 | 估时 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| V2-5-1 | 发布配置 | `package.json` + `npm pack --dry-run` 记录 | `private:false`；license 已确认；`files` 收敛；`prepublishOnly` 跑 typecheck+test+build；版本 0.2.0；包体积有记录 | 0.5–1 天 | V2-4-5 | todo |
| V2-5-2 | 文档更新 | README / CHANGELOG / docs 索引 / HANDOFF | README 含新功能、`npx` 安装、MCP 配置与安全警告；CHANGELOG 记录 0.2.0；索引无死链 | 1 天 | V2-5-1 | todo |
| V2-5-3 | 安装验证 | 临时目录安装记录 | `npm i <tarball>` 后 `npx mewagent --mock --print` 成功；`npm link` 全局命令正常；Windows + Node 22 至少一例 | 0.5–1 天 | V2-5-2 | todo |
| V2-5-4 | 发布执行 | npm 包 + GitHub Release + tag `v0.2.0` | `npm view mewagent version`=0.2.0；`npx mewagent@0.2.0 --mock --print` 成功；Release notes 与 tag 对应 | 0.5 天 | V2-5-3 | todo |
| V2-5-5 | 最终验收与收尾 | checklist 全勾；HANDOFF 更新 | 12 条成功标准逐条有证据；v0.1 330 回归 + 新增全绿（≥420）；知识交接完成 | 0.5–1 天 | V2-5-4 | todo |

---

## 计划外任务

| ID | 任务 | 说明 |
|---|---|---|
| HF-* | 热修 | 只对已发布/已合并内容做最小修复；必须补测试并在 HANDOFF §7 记录；不夹带新功能 |

## 更新规则

1. 开工：把 task 置 `doing`，在 HANDOFF §7 写"会话 N 开工 V2-x-y"。
2. 完成：贴证据（测试命令/输出摘要/B 级记录），置 `done`；同时更新对应测试章节（若验收步骤变了）。
3. 阻塞：置 `blocked` 并写清"卡在哪、需要谁/什么"；不要静默跳过。
4. 阶段结束：跑 [testing.md](./testing.md) §4 回归，打 tag，回填 HANDOFF §7 与 §1。
5. 发现新需求：先记到 [plan.md](./plan.md) §4 非目标或本文件"计划外任务"候选，不直接开工。
