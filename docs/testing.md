# MewAgent 测试手册

> 配套：[docs/tasks.md](tasks.md)（任务看板）｜[MewCode-TS实施方案.md](../MewCode-TS实施方案.md)（设计契约）
> 用途：每个 task 完成后，AI 先跑自动化测试，**用户按本文件对应小节逐条复验**。
> 原则：模型自测只能证明"代码跑通"，交互手感、中文输入、视觉、真实模型效果、破坏性操作必须由人验。
> 最后更新：2026-11-24 ｜ 对应任务数：29（S0-1 … S4-4）
> **当前进度**：**S0 阶段已完成（tag `v0.1-s0` 已推送）；S1 阶段已完成（tag `v0.1-s1` 已推送）——S1-1（SSE 逐行解析）、S1-2（流式客户端 + `tool_calls` 聚合）、S1-3（system prompt + 消息转换）、S1-4（Ink TUI + 多行输入补丁，8 条 B 级已由用户验收通过）、S1-5（`--print` 接真实 API：headless 真实链路 + `MEWCODE_DEBUG=1` + 401/网络错误可读提示，A 级真机复验已通过）、S1-6（S1 全量验收 + tag `v0.1-s1`）全部完成；S2-1（`tools/paths.ts` 工作区边界校验 + `tests/paths.test.ts` 10 例）、S2-2（`tools/registry.ts` 工具注册表 + `tests/registry.test.ts` 13 例：未知工具/坏 JSON/非对象/抛异常全部转 `ok:false` 不崩）已完成；S2-3（`tools/fs.ts` 文件工具 + `tests/fs.test.ts` 15 例：read 行号/截断/续读不跳行、write 建目录、edit 唯一性 + CRLF 兼容）已完成（B 级 6/7 条已由用户实测通过，3–5 条随 loop/TUI/审批后验）；S2-4（`tools/search.ts` glob/grep + `tests/search.test.ts` 11 例：`*`/`?`/`**`/字符类、跳过 .git/node_modules/二进制/5MB、glob 200 条 + 30KB 截断、grep 100 条 + 大文件不卡死）已完成，全量 153/153；S2-5（`tools/bash.ts`：shell 选择 `MEWCODE_SHELL` > Git Bash > cmd、超时 kill + 500ms 兜底、30KB 截断、UTF-8→GBK 回退、cwd 固定工作区 + `tests/bash.test.ts` 14 例）已完成，全量 167/167；S2-6（`agent/loop.ts` Agent Loop：`AgentEvent` 事件流、多轮工具、`maxSteps=30`、`turn_end` 原因、Gate 预留 + `tests/loop.test.ts` 19 例）已完成，全量 186/186；S2-7（UI 接线 `AgentEvent`：工具历史 `✅/❌` + 参数摘要 + 耗时、`tool_running` 状态行、`runTurn` 注入、mock 也走真 loop + `tests/tool-display.test.ts` 9 例）已完成，全量 195/195，下一任务 S2-8（S2 收尾 + tag `v0.1-s2`）；S2-7 补丁：流式输出滚动叠字修复（`src/ui/stream-lines.ts` 完整行按行提交 Static + 动态区尾巴上限，`tests/stream-lines.test.ts` 9 例，全量 204/204）；S3-1（`safety/danger.ts` 危险命令识别 + `safety/permissions.ts` 权限三道闸：路径边界 → readOnly → 危险命令 → 会话白名单 → 审批/headless；`tests/danger.test.ts` 9 例 + `tests/permissions.test.ts` 18 例 + `tests/config.test.ts` headless 拒绝写工具端到端 1 例，全量 232/232；B 级 5/6/8 已由用户 2026-11-24 实测通过）、S3-2（`src/ui/approval.ts` 审批桥 + `src/ui/ApprovalPrompt.tsx` 审批弹窗：y/a/n/Esc、a 加白名单、Esc=拒绝、审批时输入框失焦、`awaiting_approval` 展示态；`tests/approval.test.ts` 9 例 + 假 stdin 审批冒烟 `APPROVAL SMOKE OK`，全量 241/241）；S3-3（`src/session/store.ts` 会话持久化：`<workspace>/.mewcode/session.json` 原子写、加载校验与损坏降级、`--new` 跳过恢复；`tests/session.test.ts` 14 例 + `tests/config.test.ts` 3 例启动/恢复/损坏/`--new` 端到端，全量 **258/258**）；S3-4（`src/context/tokens.ts` token 估算：CJK 1.1/字、其他 1/4、每条 +8、预算 = contextTokens×0.7；`src/context/compress.ts` 按 user 轮分组压缩：system 常驻、从最新往前累加到预算、旧轮整轮丢弃、最新轮超预算时截断 tool 2000 字符/assistant 4000 字符、结果不以 tool 开头；`tests/compress.test.ts` 17 例 + loop 压缩接线 2 例（请求前压缩、历史完整保留）；`MEWCODE_CONTEXT_TOKENS` 可调窗口、`MEWCODE_DEBUG=1` 输出 `[压缩]` 统计；全量 **277/277**；下一任务 S3-5）；S3-5（S3 集成验收脚本 4 场景 25 断言全过 + 全量 277/277 + tag `v0.1-s3` 已推送）、S4-1（edit diff 红绿展示 + 统一错误展示：`src/tools/diff.ts`、`src/errors.ts`、`src/ui/diff-view.ts`；A 级 296/296；B 级 3 条已由用户 2026-11-24 实测通过）已完成；S4-2（README 与文档收尾：重写 `README.md`（特性/安装/配置/快速开始/命令参数/架构图/目录结构/工具表/加工具教程/权限与安全/会话与压缩/错误展示/测试与 CI/Windows 注意/已知限制与 Roadmap/文档索引），`--help` banner 改为「（v0.1）」；A 级：仓库克隆到新目录后仅照 README 跑通 `npm install`（52 包/4s）→ `npm run typecheck` 0 → `npm test` 296/296 → `npm run dev -- --mock --print "你好"` 0 → `npm run build` 0 → `node dist/index.js --mock --print "你好"` 0；B 级 3 条已由用户 2026-11-24 在另一台机器实测通过）、S4-3（打包与启动：`package.json` 增 `bin.mewagent` / `prepack` / `files`，入口加 shebang 且直跑判断改用 realpath（修 `npm link`/`npx` 经 junction 启动时静默退出的问题）；A 级：`npm link` 后任意目录 `mewagent --version/--help/--mock --print`（含空格+中文路径）exit 0、`npx . --mock --print hello` exit 0、`npm unlink -g mewagent` 无残留、`npm pack --dry-run` 产物仅含 dist+README+docs（77 项/230KB）；`tests/packaging.test.ts` 5 例，全量 303/303）已完成，下一任务 S4-4**。CI 在 GitHub Actions 全绿（agent 用 `gh` CLI 独立复核）；S1-6 全量验收证据见下方 S1-6 小节与 HANDOFF §7 会话 14，S2-1/S2-2 见下方对应小节与 HANDOFF §7 会话 15/16。本手册从 S0-2 起用于每个 task 的"完成前验收"；已完成章节保留为复验/回归用途。

---

## 0. 测试分级与分工

| 级别 | 谁做 | 内容 | 能否跳过 |
|---|---|---|---|
| **A 自动化** | AI 执行，用户抽查 | `typecheck`、单元测试、mock 端到端、CI | 不能；失败即 task 未完成 |
| **B 手工** | **只能用户做** | 中文 IME、视觉/布局、真实模型、审批交互、危险命令、恢复体验 | 不能；这是本手册的核心 |
| **C 回归** | AI 跑 + 用户抽查 | 每阶段结束跑全量自动化 + 阶段手工回归清单 | 不能；阶段 tag 前必须过 |

**判定规则**：
- 标 **P0** 的检查项，任何一项失败 → task 不能标 `done`，阶段不能打 tag。
- 标 **P1** 的项失败 → 记录，本阶段结束前修；不阻塞当前 task。
- 标 **P2** 的项失败 → 只记录，进 backlog。

**AI 自测报告必须包含**：执行的命令、退出码、关键输出（失败时贴完整报错），不能只说"测试通过"。

---

## 1. 用户 5 分钟起步（每个新会话先跑一遍）

```powershell
Set-Location D:\workplace\AIAgent\MewCode
git pull
node -v                    # 必须 >= 22
npm install                # 首次或依赖变化后；装包需带 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890 或改用 npmmirror
npm run typecheck          # 0 错误
npm test                   # 全绿
npm run build              # 能出 dist/（可选，交付前必跑）
```

以上是**最终形态**；按阶段取用：S0 期间 `--mock` / `--print` 尚未实现（S0-4 / S1-5 落地），此时只跑到 `npm test` 为止。

全部通过后，再按本次 task 的章节继续。**如果只做一件事**：把当前阶段可用的命令跑一遍，任何一条失败就先修环境，不要进入业务测试。

真实模型冒烟（明确要花钱，一次即可）：

```powershell
$env:MEWCODE_DEBUG="1"     # 若已实现调试开关
npm run dev -- --print "用一句话回答：1+1 等于几？"
```

---

## 2. 测试环境与测试数据

### 2.1 环境基线

| 项 | 要求 | 检查命令 |
|---|---|---|
| 系统 | Windows 10/11（本机 Windows 11 26200） | `winver` |
| 终端 | Windows Terminal（首选，本机 1.25.3131.0）；conhost 仅用于对比 IME | `$env:WT_SESSION` 非空 |
| Shell | Windows PowerShell 5.1（本机**没有 pwsh 7**）；未签名 `.ps1` 需 `-ExecutionPolicy Bypass` | `Get-Host` / `Get-ExecutionPolicy` |
| Node | ≥ 22（本机 26.7.0，npm 12.0.2） | `node -v` / `npm -v` |
| 网络 | 外网走代理 `http://127.0.0.1:7890` | `curl.exe -sS -m 10 -o NUL -w "%{http_code}" https://api.deepseek.com` |
| 密钥 | 只在 `.env`，不进仓库 | `git check-ignore -v .env` 应有输出 |

### 2.2 `.env` 模板（不要提交真 key）

```dotenv
# 任选一个 OpenAI 兼容供应商
MEWCODE_API_KEY=sk-xxxx
MEWCODE_BASE_URL=https://api.deepseek.com
MEWCODE_MODEL=deepseek-chat
# 可选：关闭颜色 / 调试
# MEWCODE_DEBUG=1
```

启动校验：把 `MEWCODE_API_KEY` 临时改空，启动应报"缺少 API key，请复制 .env.example 并填写"，且**不打印你的 key**。

### 2.3 三种运行模式

| 模式 | 命令 | 用途 | 花钱 |
|---|---|---|---|
| 交互 TUI | `npm run dev` | 手工验收主战场 | 是 |
| 离线 mock | `npm run dev -- --mock` | UI/循环/工具接线，确定性 | 否 |
| Headless | `npm run dev -- --print "..."` | 管道、CI、快速回归 | 是 |

### 2.4 测试沙盒（重要）

涉及写文件、删文件、执行命令的测试，**一律在独立目录**做，不要拿本项目当小白鼠：

```powershell
$root = "D:\workplace\AIAgent\mewagent-testbed"
if (Test-Path $root) { Remove-Item $root -Recurse -Force }
New-Item -ItemType Directory -Force -Path $root | Out-Null
New-Item -ItemType Directory -Force -Path "$root\src\nested" | Out-Null

Set-Content -Path "$root\sample.txt" -Value @("line1", "line2", "line3")
Set-Content -Path "$root\中文-测试.txt" -Value @("你好，世界", "第二行中文")
[System.IO.File]::WriteAllText("$root\crlf.txt", "a`r`nb`r`nc`r`n")
Set-Content -Path "$root\src\nested\app.ts" -Value "export const x = 1;"
1..5000 | ForEach-Object { "2026-11-23 INFO line $_ " + ("x" * 80) } |
  Set-Content -Path "$root\big.log"
```

约定：每次测试前重建 testbed；TUI 里先 `/cd D:\workplace\AIAgent\mewagent-testbed`（若已实现）或启动时加 `--workspace`。
以上脚本在 Windows PowerShell 5.1 下可直接粘贴运行（本机没有 pwsh 7）；创建后可用 `Get-ChildItem $root -Recurse` 核对文件。

### 2.5 费用控制

- 能用 mock 证明的，不用真模型。
- 真实 API 只测"流式/真实工具调用/真实错误"这三类，单次提示词尽量短，`max_tokens` 设小。
- 每天真实验收控制在 20 次调用以内；跑 50 轮压缩测试优先用 mock 长文本。

### 2.6 测试后清理

```powershell
Remove-Item "D:\workplace\AIAgent\mewagent-testbed" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item ".mewcode\session.json" -Force -ErrorAction SilentlyContinue   # 需要重测"首次启动"时
git status --short        # 确认没有把测试产物提交
```

---

## 3. 每个 task 的测试明细

> 约定：`npm test` 跑全部用例；单文件用 `node --import tsx --test tests/<file>.test.ts`。
> 测试文件名是实现时定的，本表列"预期文件"；若实际不同，以 `tests/` 目录和 `package.json` 为准。
> 进度：✅ S0-1 ｜ ✅ S0-2 ｜ ✅ S0-3 ｜ ✅ S0-4 ｜ ✅ S0-5 ｜ ✅ S0-6（tag `v0.1-s0` 已推送）｜ ✅ S1-1 ｜ ✅ S1-2 ｜ ✅ S1-3 ｜ ✅ S1-4（实现 + A 级冒烟 + 补丁；8 条 B 级已由用户验收通过）｜ ✅ S1-5（headless 真实 API，A 级真机复验通过）｜ ✅ S1-6（tag `v0.1-s1` 已推送）｜ ✅ S2-1（`tests/paths.test.ts` 10 例；全量 114/114；B 级 TUI 两项随 S2-6/S2-7 接线后验）｜ ✅ S2-2（`tests/registry.test.ts` 13 例；全量 127/127；specs 格式已验、"6 工具齐全"随 S2-3~S2-5）｜ ✅ S2-3（`tests/fs.test.ts` 15 例；全量 142/142；B 级 6/7 已由用户实测通过、3–5 随接线后验）｜ ✅ S2-4（`tests/search.test.ts` 11 例；全量 153/153；B 级 2–4 待 loop/TUI 接线后验）｜ ✅ S2-5（`tests/bash.test.ts` 14 例；全量 167/167；B 级 2–6 待 loop/TUI 接线后验）｜ ✅ S2-6（`tests/loop.test.ts` 19 例；全量 186/186；B 级 3–5 待 S2-7 UI 接线后验）｜ ✅ S2-7（`tests/tool-display.test.ts` 9 例；全量 195/195；B 级 4 条待用户；补丁 stream-lines 9 例、全量 204/204）｜ ✅ S2-8（tag `v0.1-s2` 已推送）｜ ✅ S3-1（`tests/danger.test.ts` 9 例 + `tests/permissions.test.ts` 18 例；全量 232/232；B 级 5/6/8 已由用户 2026-11-24 通过，2–4/7 随 S3-2 验）｜ ✅ S3-2（`tests/approval.test.ts` 9 例；全量 241/241；假 stdin 审批冒烟 `APPROVAL SMOKE OK`；B 级 4 条已由用户 2026-11-24 通过）｜ ✅ S3-3（`tests/session.test.ts` 14 例 + config 3 例端到端；全量 258/258；B 级 2–5 已由用户 2026-11-24 通过）｜ ✅ S3-4（`tests/compress.test.ts` 17 例 + loop 压缩接线 2 例；全量 277/277；B 级 2–4 待用户）｜ ✅ S3-5（集成脚本 4 场景 25 断言 + 全量 277/277 + tag `v0.1-s3` 已推送）｜ ✅ S4-1（`tests/diff.test.ts` 9 例 + `tests/errors.test.ts` 4 例 + `tests/diff-view.test.ts` 5 例 + ui/fs 断言更新；全量 296/296；B 级 3 条已由用户 2026-11-24 实测通过）｜ ✅ S4-2（`README.md` 重写：安装/配置/命令/架构图/加工具教程等齐全，`--help` banner 改 v0.1；A 级：克隆副本 `npm install` → typecheck 0 → 296/296 → `--mock` 0 → build 0 → dist 0；B 级 3 条已由用户 2026-11-24 在另一台机器实测通过）｜ ✅ S4-3（`tests/packaging.test.ts` 5 例 + `npm link`/`npx .`/中文路径/unlink A 级验证；全量 303/303；B 级 4 条待用户）｜ 🔄 S4-4（当前）。

### S0 · 骨架与契约

#### S0-1 初始化工程 + Ink 中文 IME spike（已完成 2026-11-23，判定 A）

> 本节作为**复验/回归**用途，不再作为新任务执行。证据：`spikes/RESULT.md`、`spikes/.out/ime-log.jsonl`、`spikes/.out/summary.json`、14 张截图。

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | A | `npm install`；`npm run typecheck` | 退出码 0，无错误 | P0 |
| 2 | A | `node -v` | ≥ 22（本机 26.7.0） | P0 |
| 3 | A | `npm test` | 通过（当前含 `tests/core.test.ts` 占位用例） | P0 |
| 4 | B | 手工复验：`npx tsx spikes/ime-spike.tsx`，用**微软拼音**输入 `nihao` → 空格选首候选 → Enter | 上屏"你好"，无丢字/重复；候选条偏移但不遮挡 | P0 |
| 5 | B | 同一窗口逐项测：退格、左右方向键、粘贴中文、Shift 切英文再切回 | 退格每次删一个完整汉字；英文逐键可用 | P0 |
| 6 | A | 一键 GUI 复现：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes\run-ime-spike.ps1` | 生成 jsonl/截图/summary，结论仍为 A | P1 |
| 7 | B | 确认已知限制：候选条偏 3~4 行、数字键从候选选词有风险（S1 用 `useCursor` 缓解） | 已记入 HANDOFF §4/§7 | P2 |

**通过标准**：1–3 全过；4–5 无回归；若 IME 在新环境失效 → 记录并重新评估 §9.1（是否转 Go）。
**证据**：`typecheck` 输出 + IME 复验结果（贴 `spikes/.out/summary.json` 或截图路径）。

#### S0-2 `src/types.ts` 契约（已完成 2026-11-23）

> 自动化已由 AI 跑完，本小节保留为复验/回归用途。证据：`src/types.ts`、`tests/types.test.ts`、HANDOFF §7 会话 4。

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | A | `npm run typecheck` | 0 错误 | P0 |
| 2 | A | `npm test` | 6 passed / 0 failed（含 `tests/types.test.ts` 3 个契约用例；负例由 `@ts-expect-error` 在 typecheck 阶段锁住） | P0 |
| 3 | A | 搜索 `src/types.ts` 中 `\bany\b` | 无匹配（无类型逃逸，不确定数据用 `unknown`） | P0 |
| 4 | B | 对照实施方案 §3.3，检查类型是否齐全：`Message`/`ToolCall`/`ToolResult`/`ToolDefinition`/`ToolSpec`/`LlmClient`/`Gate`/`AgentEvent` | 一个不少，字段名一致；`ToolSpec` 为 §3.3 补定义 | P0 |
| 5 | B | 抽查 `tests/types.test.ts` 中的假对象实现 `ToolDefinition` / `LlmClient` / `Gate` | 契约可直接实现，写法可读 | P1 |

**证据**：`npm run typecheck` 退出码 0、`npm test` 6/6 全绿输出、`types.ts` diff（见 HANDOFF §7 会话 4）。

#### S0-3 config + 入口骨架（已完成 2026-11-23）

> 本小节保留为复验/回归用途。证据：`src/config.ts`、`src/index.ts`、`tests/config.test.ts`、HANDOFF §7 会话 5。

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | A | `npm run typecheck` | 0 错误 | P0 |
| 2 | A | `npm test` | 31 passed / 0 failed（`tests/config.test.ts` 25 个用例 + 既有 6 个） | P0 |
| 3 | A | `npm run dev -- --help` | 输出用法，含 `--model --base-url --workspace --new --mock --print`；退出 0 | P0 |
| 4 | A | `npm run dev -- --version` | 输出 `0.1.0`，退出 0 | P0 |
| 5 | A | 清空 API key 后 `npm run dev`（`$env:MEWCODE_API_KEY=''`，模型名保留） | stderr 含"缺少 API key"和"下一步怎么做"，退出 2，不打印 key | P0 |
| 6 | B | `npm run dev -- --workspace D:\workplace\AIAgent\mewagent-testbed --mock --print "hi"` | 输出 `workspace: D:\workplace\AIAgent\mewagent-testbed`、`model: mock`；退出 0（工具读文件在 S2 体现） | P1 |
| 7 | B | 传入未知参数 `--foo` | stderr `未知参数：--foo` + "下一步"，退出 2，不静默忽略 | P1 |
| 8 | B | 环境变量/`.env` 里设置 `MEWCODE_MODEL` 后启动（`--mock --print`） | `model:` 行为该值（`.env` 载入由单测 `loadDotEnv` 覆盖；手工改 `.env` 需用户执行） | P1 |
| 9 | A | `"hi" \| node --import tsx src/index.ts --mock --print` | 输出 `prompt: hi`（stdin 读取），退出 0 | P1 |

**验收证据**（2026-11-23 AI 实测）：
- `npm run dev -- --help` → 完整用法（8 个参数 + 4 个环境变量 + 3 条示例），exit 0。
- `npm run dev -- --version` → `0.1.0`，exit 0。
- `$env:MEWCODE_MODEL='deepseek-chat'; $env:MEWCODE_API_KEY=''; npm run dev -- --print "hi"` → stderr `缺少 API key。` + `下一步：复制 .env.example 为 .env 并填写 MEWCODE_API_KEY（或设置同名环境变量）；只想离线体验可以加 --mock。`，exit 2。
- `npm run dev -- --foo` → stderr `未知参数：--foo` + `下一步：运行 npm run dev -- --help 查看可用参数。`，exit 2。
- `npm run dev -- --mock`（无 TTY）→ stderr `当前不是交互式终端（TTY），无法启动 TUI。` + `下一步：在 Windows Terminal 里运行 npm run dev；非交互场景请加 --print "你的问题"。`，exit 2。
- testbed 命令 → `workspace:`/`model: mock`，exit 0；stdin 命令 → `prompt: hola-stdin`，exit 0。
- 已知限制：本机 AI agent 安全策略禁止读写 `.env`，第 8 项的手工 `.env` 复验由用户执行；`loadDotEnv` 正确性已有单测。

**通过标准**：1–5 全过；6–9 无回归。

#### S0-4 mock 离线两轮（已完成 2026-11-23）

复验命令与预期（P0 = 必须全过）：

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | A | `npm run dev -- --mock --print "你好"` | 第 1 轮输出 `tool_call: read_file {"path":"README.md"}`，第 2 轮输出最终文本 + `finish: stop`，退出 0 | P0 |
| 2 | A | `npm test` | 含 `tests/mock.test.ts` 8 个用例，全量 39/39 通过 | P0 |
| 3 | B | 把代理环境变量指到无效端口（`$env:HTTP_PROXY='http://127.0.0.1:1'; $env:HTTPS_PROXY='http://127.0.0.1:1'`）后重跑第 1 项 | 仍成功（mock 不依赖网络） | P0 |
| 4 | B | 观察 stdout | 两轮用 `--- 第 1 轮/第 2 轮 ---` 分隔、可区分；无旧骨架文案、无 `Error:` 噪音 | P1 |

**实测证据（2026-11-23）**：命令 1 输出两轮、`exit: 0`；命令 3 在 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:1` 下同样成功；`npm test` → `tests 39 / pass 39 / fail 0`（原 31 + 8 mock）；`npm run typecheck` 退出 0；stdin 变体 `"你好" | node --import tsx src/index.ts --mock --print` 也走完两轮。

**已知限制**：S0-4 的工具执行是**占位**（回填 `（S0-4 占位工具结果：read_file 将在 S2 实现）`），真实工具/注册表在 S2 接入；真实 API 客户端在 S1。mock 客户端已实现 `LlmClient` 契约（含 `onText` / `AbortSignal`），S1 的 Agent Loop 可直接复用。

#### S0-5 文档 + CI（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | A | 检查文件存在：`AGENTS.md` `CLAUDE.md` `docs/spec.md` `docs/checklist.md` `.github/workflows/ci.yml` | 全部存在 | P0 |
| 2 | A | `npm run typecheck` + `npm test` | 0 错误、39/39 通过 | P0 |
| 3 | A | 本地模拟 CI：复制 `package.json` / `package-lock.json` / `tsconfig*.json` / `src` / `tests` 到临时目录，依次 `npm ci` → `typecheck` → `test` | 三步全绿，证明 CI 命令在干净环境可用 | P0 |
| 4 | B | push 分支后在 GitHub 打开 Actions（或由 agent 用 `gh run list/view` 查询） | `CI` workflow 变绿，日志可见 `npm ci` / `npm run typecheck` / `npm test`（✅ 已确认：全部运行 success，`gh` 复核日志 `# tests 39 / pass 39 / fail 0`，run `45144982815`；截图 `docs/evidence/s0-5-ci-actions.png`） | P0 |
| 5 | B | 读 `AGENTS.md` | 含技术栈/常用命令/架构边界/代码风格/DoD（另含开工必读、本机环境、红线） | P1 |
| 6 | B | 读 `docs/spec.md` / `docs/checklist.md` | spec 覆盖目标/非目标/十条标准/架构/CLI/工具/权限/TUI/Windows/阶段状态；checklist 含通用 DoD、S0–S4 清单、十条标准证据表、回归与发布清单 | P1 |

**实测证据（2026-11-23）**：5 个文件全部创建（`AGENTS.md` 7 节、`CLAUDE.md` 薄入口、`docs/spec.md` 13 节、`docs/checklist.md` 5 节、`ci.yml` 1 job）；本地模拟 CI 在 `spikes/.out/ci-local` 干净副本中 `npm ci`（52 packages，2s）→ `npm run typecheck` 退出 0 → `npm test` 39/39 通过（250ms，模拟后删除临时目录）；仓库本身 `typecheck` 0、`npm test` 39/39。

**CI 设计**：`.github/workflows/ci.yml` 触发 `push`（`main` / `task/**` / `fix/**` / `docs/**`）与 `pull_request`（`main`）；`ubuntu-latest` + Node 22（`actions/setup-node@v4` 带 npm cache）；步骤固定为 `npm ci` → `npm run typecheck` → `npm test`；`permissions: contents: read`、并发组 `ci-${{ github.ref }}` 自动取消旧运行。

**已知限制与自查能力**：本机已装 `gh` CLI 2.105.0（`C:\Program Files\GitHub CLI\gh.exe`）且处于已登录状态（keyring，账号 `zcslack17858645276-del`），agent 可直接 `gh run list` / `gh run view <id> --json jobs|--log` 只读查询 Actions，**不需要再靠用户截图**；本次已独立复核 4 次运行全部 success（run `45144911048` / `45144932628` / `45144982815` / `45149633152`），并确认 `45144982815` 的步骤与 `# tests 39 / # pass 39 / # fail 0` 日志。注意该 token 含 `repo`/`workflow` 写权限，agent 仅使用只读命令、不通过 gh 做任何 push/删除；PR 仍建议用户手动开（或明确授权后再由 agent 操作）。

#### S0-6 S0 收尾（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `git tag -l`；`git ls-remote --tags origin` | 有 `v0.1-s0`，远端也存在 | P0 | ✅ 本地/远端均有 `v0.1-s0` |
| 2 | B | `git log --oneline -10` | S0 任务都有对应 commit，无"大杂烩"提交 | P1 | ✅ 每 task 独立 commit + squash 记录；用户已复核（2026-11-23） |
| 3 | B | 更新 HANDOFF §7 与 tasks 状态 | 状态为 done | P1 | ✅ tasks S0-6=done、HANDOFF §7 会话 8；用户已复核（2026-11-23） |

**S0-6 全量验收证据（2026-11-23 17:53，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0
- `npm test` → exit 0，`tests 39 / pass 39 / fail 0`（281ms）
- `npm run dev -- --help` → exit 0，含 `--model --base-url --workspace --new --mock --print --help --version`
- `npm run dev -- --version` → exit 0，stdout `0.1.0`
- `npm run dev -- --mock --print "你好"` 连跑两次 → 均 exit 0，输出逐字节一致（幂等）
- `npm run build` → exit 0；`node dist/index.js --mock --print "你好"` exit 0 且输出与 dev 一致
- `src/` 中 `\bany\b` 匹配 0
- 完整记录：`spikes/.out/s0-6-acceptance.txt`（gitignored）

**B 级复核（用户，2026-11-23，已完成）**：用户已按表格第 2、3 行自行执行并通过 —— 提交历史清晰（S0 各 task 独立提交 + squash 记录，无大杂烩）、`docs/tasks.md` S0-6=done 且 `HANDOFF.md` §7 会话 8 已更新；另核对 tag `v0.1-s0` 本地与远端一致。

**已知限制**：无（S0 阶段）；tag 之后的 `S1-1` 起按新小节执行。

---

### S1 · 流式对话 + 最小 TUI

#### S1-1 SSE 解析（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `node --import tsx --test tests/sse.test.ts` | 全绿 | P0 | ✅ tests 13 / pass 13 / fail 0（384ms） |
| 2 | A | 覆盖用例：一行拆 3 块、UTF-8 多字节被切断、`\r\n`、空行、`:` 注释、`[DONE]`、无结尾换行 | 全部断言通过 | P0 | ✅ 13 个用例覆盖全部场景，另加 BOM / 多行 data / 无空格 data / 空 data / AbortError |
| 3 | B | 抽查测试代码，确认不是"只测 happy path" | 至少 3 个失败/边界用例 | P1 | ✅ 失败与边界用例 9 个（分块、UTF-8 截断、CRLF 拆分、注释、`[DONE]`、尾部残留、BOM、空 data、AbortError）；用户已复核（2026-11-23） |

**实测证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0
- `node --import tsx --test tests/sse.test.ts` → exit 0，`tests 13 / pass 13 / fail 0`（384ms）
- 全量 `npm test` → exit 0，`tests 52 / pass 52 / fail 0`（335ms；原 39 + 新增 13）
- 完整记录：`spikes/.out/s1-1-test.txt`（gitignored）

**已知限制**：只解析 OpenAI 兼容流式响应需要的 `data:` 字段；`event:`/`id:`/`retry:` 按设计忽略（本项目用不到），S1-2 负责负载 JSON 解析与错误映射。

#### S1-2 流式客户端 + tool_calls 聚合（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | 聚合函数单测：分片 `id/name/arguments` 多段到达、乱序 index、空 delta | 聚合结果与完整 JSON 一致 | P0 | ✅ `tests/openai.test.ts` 13 用例全过：分片拼接、乱序 index、空 delta、id/name 只取首次、缺 id 占位、`toApiMessages` 四角色、文本流 + `onText` + 请求体/请求头、`tool_calls` 流式聚合、401 脱敏、预中止 `AbortError`、坏 JSON、无 body |
| 2 | B | 真实 API：`npm run dev`，输入"你好" | 文字逐段出现，不是一次性蹦出 | P0 | ✅ **用户已实测通过（2026-11-24，A2）**：TUI 里真实 API 逐段出现 |
| 3 | B | 生成中点 Esc | 流停止，已输出内容保留，无报错崩溃 | P0 | ✅ **用户已实测通过（2026-11-24，A2）**：Esc 后已输出内容保留、无崩溃 |
| 4 | B | 故意填错 key | 显示 401 + 供应商返回摘要，不泄露 key | P0 | ✅ 单测（假 fetch 返回 401 且响应体含 key，断言 `LlmHttpError.status=401`、message 含供应商摘要且 key 被替换为 `[REDACTED]`）；真实 API 复验留到 S1-5 |
| 5 | B | 断网后重试 | 显示网络错误，不无限卡死 | P1 | ✅ **用户已实测通过（2026-11-24，A2）**：`MEWCODE_BASE_URL` 指到不可达端口后显示网络错误、不卡死 |

**实测证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0
- `node --import tsx --test tests/openai.test.ts` → exit 0，`tests 13 / pass 13 / fail 0`（386ms）
- 全量 `npm test` → exit 0，`tests 65 / pass 65 / fail 0`（397ms；原 52 + 新增 13）
- 完整记录：`spikes/.out/s1-2-openai-test.txt`、`spikes/.out/s1-2-full-test.txt`（gitignored）
- CI（gh 只读复核）：run `45181232133`（分支 `3248708`）、`45181303071`（main `28177f7`）、`45181346659`（main `43ff69c`）全部 success；`45181346659` 的 job `typecheck + test (Node 22)` 步骤 Checkout / Setup Node.js / Install dependencies / Typecheck / Test 全 success，日志 `# tests 65 / # pass 65 / # fail 0`

**已知限制**：客户端未接进 `src/index.ts`（真实 API 的 `--print` 属 S1-5，TUI 属 S1-4），所以 B 级"真实 API"三行本次只做了单测级验证；消息转换暂时放在 `openai.ts` 内（S1-3 若迁到 `agent/messages.ts` 需同步更新 HANDOFF §4 决策与引用）。

**B 级复核（模块级，用户 2026-11-23 已完成）**：抽查 `tests/openai.test.ts` 13 用例边界；mutation 检验（把 `entry.arguments +=` 改成 `=` 后测试应变红，`git checkout --` 恢复）；CI 日志 `# tests 65 / # pass 65 / # fail 0`。端到端四行（真实流式 / Esc / 真实 401 / 断网）按上表留 S1-4、S1-5、S1-6 回归。

#### S1-3 prompt 与消息转换（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | 单测：Message → API JSON，tool 角色、tool_call_id、assistant.toolCalls 配对 | 与 OpenAI 规范一致 | P0 | ✅ `tests/messages.test.ts` 6 用例 |
| 2 | B | 真实请求（短提示） | 模型知道自己是 CLI 编程助手、知道工具可用 | P1 | ⏳ 真实 API 接线属 S1-5，随 S1-5/S1-6 联调 |
| 3 | B | `MEWCODE_DEBUG=1` 时查看请求体 | system prompt 在首位且不重复 | P2 | ⏳ 请求体日志接线属 S1-5；`withSystemPrompt` 单测已覆盖"首位且唯一" |

**实测证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0
- `node --import tsx --test tests/messages.test.ts tests/prompt.test.ts` → exit 0，`tests 12 / pass 12 / fail 0`（375ms）
- 全量 `npm test` → exit 0，`tests 77 / pass 77 / fail 0`（499ms；原 65 + 新增 12）
- 完整记录：`spikes/.out/s1-3-target-test.txt`、`spikes/.out/s1-3-full-test.txt`（gitignored）

**已知限制**：`buildSystemPrompt()` / `withSystemPrompt()` 尚未接进 `src/index.ts`（`--print` 接真实 API 属 S1-5，TUI 属 S1-4）；`toApiMessages` 已从 `openai.ts` 迁入 `src/agent/messages.ts`（`tests/openai.test.ts` 的引用同步更新，HANDOFF §4 已回填）。

**B 级复核（用户 2026-11-23 已完成）**：抽查 `tests/messages.test.ts` + `tests/prompt.test.ts` 共 12 用例的失败/边界路径（assistant 无 toolCalls 时不带字段、tool 消息字段不多不少、`withSystemPrompt` 首位且唯一）；mutation 检验 `tool_call_id` 与 system 去重逻辑；CI 日志 `# tests 77 / # pass 77 / # fail 0`。真实请求与请求体日志两行按上表留 S1-5 联调。

#### S1-4 TUI 流式与中断（实现 2026-11-23 完成；补丁同日晚完成：慢速流式 + 多行输入；8 条 B 级手工项待用户验收）

> 本节没有 A 级验收项（按方案 §4，TUI 的手感/中文/闪烁只能人工判断）。AI 侧补充了两类自动化证据：纯逻辑单测 + 用假 stdin/stdout 驱动 Ink 的 TUI 冒烟。下表 8 条仍请用户逐条手工复验。

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | B | 输入中文问题并提交 | 中文正常上屏、不乱码、不吞字 | P0 |
| 2 | B | 观察流式渲染 | 无整屏闪烁、无历史重复、滚动不跳 | P0 |
| 3 | B | 生成中按 Esc，再输入第二条 | 可继续对话，历史完整 | P0 |
| 4 | B | 空闲时 Ctrl+C | 进程退出；生成中 Ctrl+C 只中断不退出 | P0 |
| 5 | B | 拉大/缩小终端窗口 | 布局不错位，输入框仍可用 | P1 |
| 6 | B | 粘贴多行文本（≥10 行） | 不触发多次提交、内容完整 | P1 |
| 7 | B | 空输入直接回车 | 无请求、无报错 | P1 |
| 8 | B | 连续快速发 3 条 | 不串轮、不丢消息 | P1 |

**A 级自动化证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0；`npm run build` → exit 0（`.tsx` 进 dist 正常，`node dist/index.js --mock --print "hi"` 两轮输出正常）
- `node --import tsx --test tests/ui.test.ts` → 6 用例全绿（`displayWidth` 7 断言、`ThrottledEmitter` 首次立即/50ms 合并/flush/cancel/空 delta、`HistoryItem` 中文渲染）
- 全量 `npm test` → exit 0，`tests 83 / pass 83 / fail 0`（原 77 + 新增 6）
- TUI 冒烟（假 stdin/stdout 驱动 Ink，`spikes/.out/tui-smoke.tsx`，gitignored）：启动横幅/工作区/就绪状态、提交"你好"→ mock 两轮最终文本进历史、排队消息提示、空闲 Ctrl+C 触发 `waitUntilExit` → `SMOKE OK`
- 完整记录：`spikes/.out/s1-4-targeted.txt`、`spikes/.out/s1-4-full.txt`、`spikes/.out/s1-4-smoke.txt`、`spikes/.out/s1-4-dist.txt`、`spikes/.out/s1-4-notty.txt`（均 gitignored）
- CI（gh 只读）：`45187554538`（task/s1-4-tui, `864bcb6`）、`45187577002`（main, `a687cc7`）、`45187642953`（main, `e0d420c`）全部 success；`45187642953` job `typecheck + test (Node 22)` 的 Checkout / Setup Node.js / Install dependencies / Typecheck / Test 步骤全 success，日志 `# tests 83 / # pass 83 / # fail 0`。

**S1-4 补丁（2026-11-23 晚：慢速流式 + 多行输入）**：

- 目的：上面第 2/3/4 条需要"可观察的慢速流式"；原 mock 一次性返回，导致流式闪烁、生成中 Esc、生成中 Ctrl+C 无法验证。
- 慢速流式用法：`$env:MEWCODE_MOCK_DELAY_MS="80"; npm run dev -- --mock`（每块 4 个码点、块间间隔 80ms；默认 0 = 一次性返回，与补丁前行为一致；不需要配置 key/网络）。
- 多行输入：`src/ui/InputBox.tsx` + `src/ui/input-text.ts` 替换单行 `ink-text-input`；粘贴多行保留换行（bracketed paste → `normalizePastedText`）；Enter 发送、**Shift+Enter 换行**（Kitty 键盘协议，Windows Terminal 1.25 支持；终端不支持时用 **Ctrl+J** 兜底）；caret 按行号 + 列显示宽度用 `measureElement` + `useCursor` 定位。
- A 级自动化证据：`tests/input-text.test.ts` 13 用例（CRLF/Tab/控制符规范化、代理对删除、换行合并、上下移动/行首行尾、`lineAndColumn`）；`tests/mock.test.ts` 11 用例（慢速流式按块、abort 保留已发前缀、`MEWCODE_MOCK_DELAY_MS` 生效）；全量 `tests 99 / pass 99 / fail 0`；TUI 冒烟（假 stdin/stdout）覆盖多行粘贴、Shift+Enter（`ESC[13;2u`）、Ctrl+J、Esc 中断、空闲 Ctrl+C → `SMOKE OK`；`npm run build` exit 0、`node dist/index.js --mock --print "hi"` exit 0。
- 完整记录：`spikes/.out/s1-4b-targeted.txt`、`s1-4b-full.txt`、`s1-4b-smoke.txt`、`s1-4b-build.txt`、`s1-4b-dist.txt`、`s1-4b-notty.txt`（均 gitignored）。
- CI（gh 只读）：`45190701975`（task/s1-4b-input, `ade8248`）、`45190737489`（main, `a47c8d1`）success；`45190737489` job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 99 / # pass 99 / # fail 0`。
- 补丁已知限制：Shift+Enter 依赖终端 Kitty 键盘协议（本机 WT 1.25 preview 支持；不响应 `CSI ? u` 查询的终端请用 Ctrl+J）；`MEWCODE_KITTY_KEYBOARD=0` 可关闭协议协商。

**已知限制**：TUI 尚未消费 `AgentEvent`（S2-7 接线工具事件）；`--mock` 的"两轮"是 S1 临时剧本（S2 起换成真正的 Agent Loop）；真实 API 的流式观感需 S1-5 接线后复验。

**B 级复核（用户 2026-11-23 已完成）**：8 条手工项全部通过（中文输入、流式无闪烁、生成中 Esc、空闲/生成中 Ctrl+C、缩放、多行粘贴、空回车、连发 3 条）；补丁项同时确认——Shift+Enter 换行生效（WT 1.25 Kitty 协议）、多行粘贴保留换行、`MEWCODE_MOCK_DELAY_MS=80` 下能观察慢速流式与中断。

#### S1-5 `--print` headless（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `"你好" \| npm run dev -- --print` | 输出最终文本，退出 0 | P0 | ✅ 真机复验（2026-11-23 22:2x，用户换有效 key 后）：stdout 中文回复"你好，我是 MewAgent…"、exit 0，stderr 只有 npm notice + `mewagent 0.1.0 · headless · model: deepseek-flash · base-url: …` 头部行，无其它噪音 |
| 2 | A | 无 TTY 环境（管道/CI） | 不报 "raw mode" 之类错误 | P0 | ✅ `main()` 注入 IO 全程无 TTY；真实 pwsh/cmd 管道下运行无 raw mode 错误（stderr 扫描 `raw mode`/`setRawMode` 无匹配） |
| 3 | B | 输出重定向到文件再打开 | 中文无乱码 | P1 | ✅ 复验：`… > spikes\.out\s1-5-a1-out.txt 2> …-err.txt`，用 read 工具确认文件为合法 UTF-8 中文、无乱码 |
| 4 | A | 错误 key 下运行 | 非 0 退出码 + 可读错误 | P1 | ✅ 真机实测：DeepSeek 返回 HTTP 401 → stderr `LLM 请求失败（HTTP 401）…` + `下一步：检查 .env 里的 MEWCODE_API_KEY…`，exit 1，供应商摘要已脱敏；复测（`MEWCODE_API_KEY=sk-invalid-test-000` 临时覆盖）同样 exit 1、输出无完整 key |

**A 级自动化证据（2026-11-23，本地 Node v26.7.0）**：

- `src/llm/openai.ts` 新增只读调试钩子 `onRequest?: (info: { url; body })`：请求体在 fetch 前回调一次、不含 apiKey；`tests/openai.test.ts` 增 1 例（回调一次、body 与实际发送一致、无 key）。
- `src/index.ts`：`--print` 非 mock 分支接真实链路 `runRealHeadless`（system prompt 首位 → 一轮流式 chat → stdout 只放模型文本、诊断走 stderr）；`MEWCODE_DEBUG=1` 打印 `[debug] POST <url>` 与请求体；`LlmHttpError` → 状态码 + `describeHttpFailure` 下一步、exit 1；网络失败 → 代理/网络提示、exit 1。
- `tests/config.test.ts` 增 4 例（假 fetch 全离线）：真实流式 stdout 只含模型文本且 system 在首位、`MEWCODE_DEBUG=1` 请求体不泄露 key、401 → exit 1 + `[REDACTED]`、网络失败 → exit 1 + 代理提示；`tests/mock.test.ts` 原"非 mock --print 占位"改为"真实 API 单轮流式（假 fetch）"。
- `npm run typecheck` exit 0；全量 `npm test` → **tests 104 / pass 104 / fail 0**（原 99 + 新增 5）；`npm run build` exit 0。
- 真实 API 冒烟（用户 `.env`：`deepseek-flash` / `https://api.deepseek.com`）：容器外无代理也能直达 DeepSeek，返回 HTTP 401（key 无效）——证明 headless 接线、请求体（system 首位）与错误链路端到端可用。
- **真实 API A 级复验（2026-11-23 22:2x，用户配置有效 key 后）**：
  - A1 `cmd /c "chcp 65001 >nul && echo 你好 | npm run dev -- --print"` → exit 0，stdout 为中文回复（`你好，我是 MewAgent，当前在 D:\workplace\AIAgent\MewCode 工作。…`），stderr 仅 npm notice 与头部行；证据 `spikes/.out/s1-5-a1-out.txt` / `s1-5-a1-err.txt`（gitignored）。
  - A2 同一运行无 TTY 环境，stderr 无 `raw mode`/`setRawMode` 报错。
  - A4 `MEWCODE_API_KEY=sk-invalid-test-000 npm run dev -- --print hi` → exit 1，stderr `LLM 请求失败（HTTP 401）…` + `下一步：…`，输出无完整 key；证据 `spikes/.out/s1-5-a4-*.txt`。
  - B3 重定向输出文件为合法 UTF-8 中文（read 工具复核，无乱码）。
- **Windows PowerShell 5.1 注意**：`"你好" | npm run dev -- --print` 在 PS 5.1 会报 `npm error code EUNKNOWNCONFIG` / `Unknown cli flag: --print`（`npm` 实际解析到 `npm.ps1`，管道调用时 `--` 被吞，npm 把 `--print` 当成自己的 flag）——这不是程序 bug。等价可用写法：①`npm run dev -- --print "你好"`（位置参数，最简，推荐）；②`cmd /c "chcp 65001 >nul && echo 你好 | npm run dev -- --print"`（真正的 stdin 管道）；③`"你好" | node --import tsx src/index.ts --print`（PS 5.1 需先设 `[Console]::OutputEncoding = $OutputEncoding = New-Object System.Text.UTF8Encoding($false)` 防中文乱码）。`npm run dev -- --print "你好"` 与 `cmd /c …` 两种写法均已在 2026-11-23 真机验证出口 0 + 中文回复。
- CI（gh 只读）：`45192982541`（task/s1-5-headless, `c29ede0`）、`45193019580`（main, `60f0cb2`）全部 success；`45193019580` job `typecheck + test (Node 22)` 的 Checkout / Setup Node.js / Install dependencies / Typecheck / Test 步骤全 success，日志 `# tests 104 / # pass 104 / # fail 0`。

**已知限制**：headless 只跑一轮、不执行工具（S2 Agent Loop 后再扩展）；`--print` 不处理 SIGINT（管道场景直接结束进程）；`MEWCODE_DEBUG` 输出可能较长，勿在公开场合粘贴；真实 API 的"流式首字/中断"手感留到 S1-6 手工回归。

#### S1-6 S1 收尾（已完成 2026-11-23，tag `v0.1-s1` 已推送）

| # | 检查项 | 预期 | 结果 |
|---|---|---|---|
| 1 | 全量验收重跑（typecheck / test / `--help` / `--version` / `--mock --print` 幂等 / build + dist / `any` 扫描） | 全部退出码 0、输出符合预期 | ✅ 见下 |
| 2 | 真实 API `--print` 一轮（中文正常） | exit 0 + 中文输出 | ✅ `node --import tsx src/index.ts --print 你好` → exit 0，stdout 415B 中文、stderr 只有 headless 头部行 |
| 3 | TUI 假终端冒烟（`spikes/.out/tui-smoke.tsx`） | `SMOKE OK`、exit 0 | ✅ exit 0，输出含 `SMOKE OK` 与"排队消息"提示 |
| 4 | S1 手工回归（真实流式/中断/中文/管道/错误 key） | 与 S1-4/S1-5 记录一致 | ✅ 由用户在 S1-4 补丁验收 + S1-5 A 级复验中完成 |
| 5 | tag `v0.1-s1` | annotated tag 指向 S1 收尾提交并 push 到远端 | ✅ tag 对象已 push，`git rev-parse "v0.1-s1^{commit}"` == 收尾提交 |

**全量验收证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0；`npm test` → exit 0，**tests 104 / pass 104 / fail 0**（duration_ms ≈ 996）
- `npm run dev -- --help` → exit 0，8 个参数（`--model --base-url --workspace --new --mock --print --help --version`）齐全
- `npm run dev -- --version` → exit 0，输出 `0.1.0`
- `npm run dev -- --mock --print 你好` 连跑两次 → exit 0 且去掉 npm notice 后输出完全一致（幂等），含"第 1 轮 / 第 2 轮"
- `npm run build` → exit 0；`node dist/index.js --mock --print 你好` 输出与 dev 完全一致
- `src/` 中 `\bany\b` 匹配 0
- 真实 API：`node --import tsx src/index.ts --print 你好` → exit 0、stdout 415B 中文、stderr 仅 `mewagent 0.1.0 · headless · model: deepseek-flash · base-url: https://api.deepseek.com`
- 记录文件：`spikes/.out/s1-6-acceptance.txt`、`s1-6-test.txt`、`s1-6-help.txt`、`s1-6-version.txt`、`s1-6-mock1.txt`/`s1-6-mock2.txt`、`s1-6-build.txt`、`s1-6-dist.txt`、`s1-6-real*.txt`、`s1-6-smoke.txt`（均 gitignored）

**S1-5 B 级复核（用户 2026-11-23 已完成）**：用户按 S1-5 小节完成 `--print` 真实一轮、无 TTY 无 raw mode、重定向 UTF-8 无乱码（B3，cmd 重定向 → `Get-Content -Encoding UTF8` → `Format-Hex` 字节验证）、假 key 401 可读报错；PS 5.1 管道写法问题一并确认（详见 S1-5「Windows PowerShell 5.1 注意」段）。

---

### S2 · 工具系统 + Agent Loop

#### S2-1 路径边界（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `tests/paths.test.ts`：`../x`、`..\x`、绝对路径、盘符路径、`%TEMP%` | 全部拒绝 | P0 | ✅ `UnsafePathError` + `下一步` 文案，10 例全绿 |
| 2 | A | 合法：`src/a.ts`、`./a.ts`、带空格/中文文件名 | 全部允许 | P0 | ✅ 输出正斜杠绝对路径、保留原始大小写 |
| 3 | B | TUI 里让它"读取 ../secret.txt" | 工具返回拒绝原因，模型不会硬读 | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：TUI 里读 `../secret.txt` 与 `%TEMP%` 外部路径均返回拒绝原因，模型未硬读** |
| 4 | B | 创建 junction/symlink 指向 testbed 外，再让它读 | 拒绝或明确提示不支持 | P1 | ✅ **用户实测通过（2026-11-24，会话 A）：`linked-outside/secret.txt` 被拒，错误含「符号链接/junction 指向工作区外」；单元级亦覆盖** |

**A 级证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` exit 0
- `node --import tsx --test tests/paths.test.ts` → **tests 10 / pass 10 / fail 0**（306.9ms）
- 全量 `npm test` → **tests 114 / pass 114 / fail 0**（1360.97ms；原 104 + 新增 10）
- 完整记录：`spikes/.out/s2-1-typecheck.txt`、`spikes/.out/s2-1-paths.txt`、`spikes/.out/s2-1-full.txt`（均 gitignored）
- CI（gh 只读）：首轮 `45198168375`/`45198187978` **failure**（ubuntu 下 `..\x` 是合法文件名，测试按 Windows 语义断言拒绝；且 `toPosixPath` 无条件替换反斜杠）→ 修复 `dd49988` 后 `45198455287`（fix 分支）、`45198470990`（main, `e6fcbc2`）success，job `typecheck + test (Node 22)` 全步骤 success，日志 `# tests 114 / # pass 114 / # fail 0`。教训：涉及反斜杠的断言必须按 `process.platform` 分支。

**实现要点**：`resolveInside(workspace, input)` 做两层包含校验——先按 `path.resolve` + 前缀比较拦 `..`/越界绝对路径，再用 `realpathSync` 向上找最近已存在祖先做真实路径比较，拦 symlink/junction 逃逸；拒绝时抛 `UnsafePathError`（含 reason 与"下一步"），输出统一正斜杠、保留用户原始大小写。**已知限制**：`%VAR%`/`~`/Windows 盘符相对路径一律拒绝（不做展开），这是有意的安全默认；B 级第 3、4 行的 TUI 级复验要等工具真正接入 TUI。

#### S2-2 工具注册表（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | 单测：未知工具、非法 JSON、参数不是对象、工具内部抛异常 | 都返回 `{ok:false, output:"Error: ..."}`，进程不崩 | P0 | ✅ `tests/registry.test.ts` 13 例全绿 |
| 2 | A | `specs()` 输出 | 符合 OpenAI tools 格式，6 个工具齐全 | P0 | ✅ 格式单测；"6 个工具齐全" **用户已实测通过（2026-11-24，A1）**：`createDefaultRegistry().names()` 输出 read_file/write_file/edit_file/glob/grep/bash |
| 3 | B | 抽查某个工具 description | 能让人看懂"什么时候用它" | P1 | ✅ **用户已抽查通过（2026-11-24，A1）** |

**A 级证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` exit 0
- `node --import tsx --test tests/registry.test.ts` → **tests 13 / pass 13 / fail 0**（332.7ms）
- 全量 `npm test` → **tests 127 / pass 127 / fail 0**（1350.4ms；原 114 + 新增 13）
- 完整记录：`spikes/.out/s2-2-typecheck.txt`、`s2-2-registry.txt`、`s2-2-full.txt`、`s2-2-typecheck-final.txt`、`s2-2-full-final.txt`（均 gitignored）
- CI（gh 只读）：`45199605857`（task/s2-2-registry, `2fe4998`）、`45199640913`（main, `f2b58e0`）全部 success；job `typecheck + test (Node 22)` 步骤成功，日志 `# tests 127 / # pass 127 / # fail 0`。

**实现要点**：`ToolRegistry` 提供 `register`/`has`/`get`/`names`/`size`/`specs()`/`run(call, ctx)`。`run` 是模型输入的唯一收敛点：未知工具 → 可读错误 + 可用工具列表；`arguments` 空串按 `{}`、非法 JSON/非对象/非字符串 → 明确错误 + "下一步"；工具抛异常（含非 Error）→ `Error: 工具 X 执行失败：…`；工具返回非法结构 → `Error: … 返回了非法结果`；**任何情况都不向 loop 抛异常**。重复注册/非法定义属于实现方 bug，`register` 直接抛错（启动期暴露）。**已知限制**：v0.1 不在注册表层做 JSON Schema 的 required/type 深度校验（各工具自己校验并给可操作错误）；工具执行超时由 `bash` 工具自己处理（§6.4）；`createDefaultRegistry`（`tools/index.ts`）等 S2-3~S2-5 工具就位后再加。

#### S2-3 文件工具（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `tests/fs.test.ts`：edit 唯一匹配、0 匹配、多匹配（无 replace_all）、多匹配（有 replace_all） | 行为与实施方案 §6.5 一致 | P0 | ✅ 14 例覆盖四种分支 |
| 2 | A | CRLF 文件 edit、write 自动建目录、read 带行号、超长截断 | 通过 | P0 | ✅ 单测全过 |
| 3 | B | testbed 里："读 sample.txt 并复述" | 内容正确、带行号 | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：TUI 读 `sample.txt` 带行号复述正确** |
| 4 | B | "把 sample.txt 第 2 行改成 line-two" | 审批后文件真的变了，`Get-Content` 确认 | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：TUI 里 `edit_file` 后 `Get-Content` 确认第 2 行落盘；审批交互待 S3-2** |
| 5 | B | "把文件里所有的 line 换成 row" | 提示多处匹配，要求 replace_all | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：多匹配先返回可操作错误（提示 `replace_all:true`），模型重试后全部替换为 row** |
| 6 | B | 对 crlf.txt 做同样 edit | 不因 `\r\n` 失败，且不整文件改成 LF | P1 | ✅ 用户已实测通过（2026-11-23，fs-manual-driver 演示：LF 写法命中 + 写回仍 CRLF） |
| 7 | B | 让 read 一个大文件 | 输出被截断，有"已截断/落盘"提示 | P1 | ✅ 用户已实测通过（2026-11-23；字节截断时续读 offset 不跳行） |

**B 级复核（用户，2026-11-23）**：#6（CRLF 保真）与 #7（大文件截断 + 续读提示）已由用户用 `spikes/.out/fs-manual-driver.ts` 实测通过；#3–#5（testbed 读文件、改第 2 行、全部 line→row）需 loop/TUI/审批（S2-6/S2-7/S3）接线后补验。

**A 级自动化证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` → exit 0；`node --import tsx --test tests/fs.test.ts` → **tests 15 / pass 15 / fail 0（605.6ms）**；全量 `npm test` → **tests 142 / pass 142 / fail 0（1449.4ms）**；`src/` 中 `\bany\b` 0 匹配
- 覆盖点：write 自动建目录 + 字节/行数、覆盖与空文件；read 中文行号/CRLF 标记/空文件/无尾换行行数、offset/limit 分段、默认 500 行上限与单行 40_000 字符的 30KB 字节截断；edit 唯一匹配 + ±3 行上下文、0 匹配、空 old_string、多匹配默认报错、`replace_all` 全替换、CRLF 文件原样与 LF 写法两种匹配、LF 文件不引入 CRLF；三个工具都拒绝 `../evil.txt` 等越界路径；参数类型错误；`readOnly` 标记与 `ToolRegistry(fsTools)` 集成
- 完整记录：`spikes/.out/s2-3-typecheck.txt`、`s2-3-fs.txt`、`s2-3-full.txt`、`s2-3-fix-fs.txt`、`s2-3-fix-full.txt`（均 gitignored）
- CI（gh 只读）：`45201159170`（task/s2-3-fs, `fb495d6`）、`45201176216`（main, `03ae006`）全部 success；修复后 `45202219673`（fix/s2-3-read-offset, `d41b8ed`）、`45202237093`（main, `54e5976`）success；job `typecheck + test (Node 22)` 日志 `# tests 142 / # pass 142 / # fail 0`

**已知限制**：`read_file` 的截断按行裁剪（超长单行会在行内截断加 `…`）；`edit_file` 只做精确字符串替换（§6.5），不支持行号 patch 或正则；`write_file` 会整文件覆盖、不做追加；三个工具目前只被 `tests/` 直接调用，尚未接入 loop/TUI（S2-6/S2-7 接线，S3 加审批）。

#### S2-4 搜索工具（已完成 2026-11-23）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `tests/search.test.ts`：glob 模式、跳过 .git/node_modules、200 条上限、grep 正则、中文内容 | 全部通过 | P0 | ✅ 11 例全过 |
| 2 | B | "列出 src 下所有 ts 文件" | 结果 ≤200，路径可读 | P1 | ✅ **用户实测通过（2026-11-24，会话 A/六工具测试）：glob 结果路径可读且 ≤200** |
| 3 | B | "搜索 mewcode 出现在哪些文件" | 返回 `文件:行号:内容` | P1 | ✅ **用户实测通过（2026-11-24）：grep 返回 `文件:行号:内容`** |
| 4 | B | 对 big.log 搜索 | 不卡死，结果有上限 | P1 | ✅ **用户实测通过（2026-11-24，会话 A）：10 万行 big.log 搜索数秒内返回、有上限** |

**A 级自动化证据（2026-11-23，本地 Node v26.7.0）**：

- `npm run typecheck` exit 0
- `node --import tsx --test tests/search.test.ts` → **tests 11 / pass 11 / fail 0**（2085.9ms）
- 全量 `npm test` → **tests 153 / pass 153 / fail 0**（1972.9ms；原 142 + 新增 11）
- 覆盖点：glob `*.md`/`src/*.ts`/`src/**/b.ts`/`[ab].txt`/`?.txt`，`**/*` 结果不含 node_modules 与 .git；250 个文件时头部"只显示前 200 个"+ 恰好 200 行、250 个长文件名时"输出已截断"且 ≤30KB；无匹配/缺参/越界路径/不存在/路径是文件；grep 中文 `文件:行号:内容`、`TODO\b` 正则、跳过 node_modules/.git/二进制、130 行命中截断到 100 且有注、`path` 限定目录/单文件、200000 行 big.log 命中（断言 <5s）、坏正则/参数错误、`readOnly` + `ToolRegistry(searchTools)` 集成
- 完整记录：`spikes/.out/s2-4-typecheck.txt`、`s2-4-search.txt`、`s2-4-full.txt`（均 gitignored）
- CI（gh 只读）：`45204620484`（task/s2-4-search, `b523dec`）、`45204654597`（main, `929d3ca`）全部 success；job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 153 / # pass 153 / # fail 0`

**实现要点**：`walkFiles` 用 `readdirSync` 排序遍历、只 yield 文件、不跟随 symlink，`SKIP_DIR_NAMES` 跳过 node_modules/.git；glob 段级匹配支持 `*`/`?`/`**`（段级回溯）/`[abc]`/`[!abc]`，win32 下大小写不敏感；`OutputBuilder` 统一 30KB 字节预算。grep 逐文件先 `stat` 判 5MB、读前 8KB 判 NUL 二进制；命中行超 500 字符截断，结果上限 100 处。两工具均 `readOnly:true`，失败统一 `Error: …` + "下一步"。

**已知限制**：v0.1 不做"替换式 grep"（找到后由 `edit_file` 修改）；glob 不支持 `{}` 展开与 `!` 排除；grep 是逐行匹配、不支持多行；只给匹配行、不给上下文（需上下文用 `read_file`）；已接入 loop/TUI（S2-6/S2-7），B 级 2–4 条已由用户 2026-11-24 实测通过。

#### S2-5 bash 工具（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `tests/bash.test.ts`：超时 kill、输出 >30KB 截断、非 0 退出码、中文输出 | 通过 | P0 | ✅ 14 例 |
| 2 | B | "运行 npm test 并总结结果" | 有输出摘要，不是原样倒 500 行 | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：模型跑命令后给出摘要** |
| 3 | B | "运行一个 10 秒不结束的命令"（如 `ping -n 10 127.0.0.1`） | 到超时被终止，提示超时 | P0 | ✅ **用户已实测通过（2026-11-24，A4）**：bash-manual-driver + `timeout_ms=3000` 约 3.5s 返回超时提示 |
| 4 | B | "输出 big.log 的内容" | 截断到 30KB 左右并有提示，上下文没爆 | P0 | ✅ **用户已实测通过（2026-11-24，A4）**：截断注 `30720 字节`、不撑爆 |
| 5 | B | 中文命令/输出（`echo 你好`） | 不乱码 | P1 | ✅ **用户已实测通过（2026-11-24，A4）**：`echo 你好` 中文正常 |
| 6 | B | 检查子进程是否残留（任务管理器看 node/ping） | 无大量残留；已知 Windows 孙进程限制要记录 | P2 | ✅ 已记录限制（见下）+ 超时 500ms 兜底 |

**A 级证据（2026-11-24，本地 Node v26.7.0；本机未安装 Git Bash，走 cmd 分支）**：

- `npm run typecheck` → exit 0；`node --import tsx --test tests/bash.test.ts` → **tests 14 / pass 14 / fail 0（约 4.7s）**；全量 `npm test` → **tests 167 / pass 167 / fail 0（4793ms；原 153 + 新增 14）**
- 覆盖点：基本命令（stdout/退出码/stderr 分段）、中文输出 UTF-8 不乱码、stderr 单独捕获、非 0 退出码（exit 3）→ `ok:false` 带 stdout/stderr + 下一步、**超时 kill**（1000ms 超时 ~1.5s 返回并提示）、**30KB 截断**（200KB 输出 → ≤上限 + 提示用 read_file）、截断不切断多字节字符、cwd 固定工作区、command 缺失/空/类型错误、timeout_ms 越界、`MEWCODE_SHELL` 指向不存在文件 → 可读错误；`resolveShell` 优先级（MEWCODE_SHELL > Git Bash > cmd）、`decodeOutput` UTF-8→GBK 回退、`truncateUtf8` 代理对安全、readOnly=false + 注册表集成
- 手工演示（`spikes/.out/bash-manual-driver.ts`，gitignored）：中文命令输出正常；`ping -n 4` + `timeout_ms=1000` → `ok=false elapsed=1544ms`，输出含"命令超时（1000 毫秒），已被终止"+ 孙进程提示；60000 字符输出被截断
- 完整记录：`spikes/.out/s2-5-typecheck.txt`、`s2-5-bash.txt`、`s2-5-full.txt`（均 gitignored）
- CI（gh 只读）：`45304592450`（task/s2-5-bash, `a075f72`）、`45304612323`（main, `32f43e6`）全部 success；job `typecheck + test (Node 22)` 的 Checkout / Setup Node.js / Install dependencies / Typecheck / Test 步骤全 success，日志 `# tests 167 / # pass 167 / # fail 0`。

**结果**：行 1 ✅（14 例）；行 2–5 ✅ 已由用户在 TUI 里实测通过（2026-11-24，会话 A；A4 另覆盖行 3/4/5 的驱动级验证）；行 6 ✅ 已记录 Windows 孙进程限制（`child.kill` 只杀直接子进程，输出里有提示，超时场景 500ms 兜底返回）。

**实现要点**：`resolveShell(platform, env, exists)` 返回 `{command,args,label,prependChcp,verbatim}`——`MEWCODE_SHELL` 覆盖 > Windows Git Bash（`C:\Program Files\Git\bin\bash.exe`，`-lc`）> `cmd.exe /d /s /c`（带 `chcp 65001 >nul &&` 前缀）；**cmd 分支必须 `windowsVerbatimArguments:true`**（否则含 `;`/`(` 的命令会被 cmd 拆坏，开发中实测踩坑）。输出先 UTF-8 解码，出现 U+FFFD 再试 GBK。超时 `child.kill()` 后 500ms 兜底 resolve，避免孙进程占管道导致卡死；stdout/stderr 各 4MB 采集上限，合并输出按 UTF-8 字节安全截断到 30KB。

**已知限制**：Windows 上 `child.kill` 不杀孙进程（v0.1 接受，方案 §6.10；v0.2 改 `taskkill /T /F`）；`bash -lc` 分支本机未安装 Git Bash、未真机验证（CI 为 Linux `sh -c`，已覆盖 `-c` 分支）；已接入 loop/TUI（S2-6/S2-7），B 级 2–5 条已由用户 2026-11-24 实测通过。

#### S2-6 Agent Loop（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | A | `tests/loop.test.ts`：mock 先返回工具调用再返回文本；事件顺序；maxSteps 触发；abort；工具错误回填 | 全绿 | P0 | ✅ 19 例 |
| 2 | A | 断言 messages 中 assistant.toolCalls 与 tool 结果一一配对 | 无悬空 tool 消息 | P0 | ✅ 多工具/中断/未知工具用例均配对 |
| 3 | B | 真实模型："读 package.json，告诉我 scripts，然后运行 typecheck，最后总结" | 至少 3 次工具调用，顺序合理 | P0 | ✅ **用户实测通过（2026-11-24，会话 A）：真实模型多步工具调用顺序合理（S2-8 另用 README 任务复验 2 工具 3 步）** |
| 4 | B | 观察事件 UI | 工具开始/结束有状态，不是干等 | P1 | ✅ **用户实测通过（2026-11-24）：`⚙ 工具运行中` + `✅/❌` 历史项可见** |
| 5 | B | 中途 Esc | 循环停止，无后续工具调用 | P0 | ✅ **用户实测通过（2026-11-24）：生成中 Esc 后停止且历史标 `（已中断）`** |

**A 级证据（2026-11-24，本地 Node v26.7.0）**：

- `npm run typecheck` exit 0
- `node --import tsx --test tests/loop.test.ts` → **tests 19 / pass 19 / fail 0（203.7ms）**
- 全量 `npm test` → **tests 186 / pass 186 / fail 0（4108.8ms；原 167 + 新增 19）**
- 覆盖：纯文本流式单轮（逐段 `assistant_text` → `turn_end` stop）；工具→文本事件顺序（`tool_start` → `tool_end` → `assistant_text` → `turn_end`）与 assistant/tool 配对；一轮多工具；`maxSteps=3` 与默认 30；signal 启动前中止（0 次 `chat`）；工具执行中途中止（剩余工具回填中断 `Error:` 且配对完整、不再请求 LLM）；LLM 抛 AbortError 收敛；未知工具/坏 JSON 回填不崩且不双前缀；`ok:false` 自动补 `Error:`；gate 拒绝与 gate 抛异常；`systemPrompt` 归一；非流式 content 补发；signal 与 `registry.specs()` 透传；`createDefaultRegistry` 6 工具；`maxSteps=0` 拒绝。
- 手工演示（`spikes/.out/loop-demo.ts`，gitignored）：假 LLM 剧本「`read_file` package.json → 总结」，用真实文件工具跑 `runAgent`；事件序列 `tool_start` → `tool_end(ok=true)` → `assistant_text` → `turn_end: stop`；`stopReason=stop steps=2 toolCallCount=1`，messages `system → user → assistant → tool → assistant`，输出 `DEMO OK`。
- 记录：`spikes/.out/s2-6-typecheck.txt`、`s2-6-loop.txt`、`s2-6-full.txt`、`s2-6-demo.txt`（均 gitignored）。
- CI（gh 只读）：`45305819855`（task/s2-6-loop, `d5c36b0`）、`45305826165`（main, `a80c60f`）全部 success；job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 186 / # pass 186 / # fail 0`。

**实现要点**：`runAgent` 注入 `llm/tools/workspace/emit/gate/maxSteps/signal`；事件顺序 `assistant_text* → (tool_start → tool_end)* → … → turn_end`；`tool_start.args` 解析失败为 `null`（契约）；tool 消息失败保证单个 `Error:` 前缀；Gate 预留（S3 接线）；`max_steps` / `aborted` 以事件 + 返回值收敛而非抛异常；非中断 LLM 错误向上抛。

**已知限制**：loop 自身不写日志（只发事件）；B 级 3–5 已由用户 2026-11-24 实测通过（S2-7 接线后）；并行工具调用仍按顺序串行执行（v0.1 从简）。

#### 跨任务 A 组 B 级补验（用户，2026-11-24，已通过）

用户按上一轮 A 组指南完成并确认通过：A1（`createDefaultRegistry()` 6 工具名与 description）、A2（TUI 真实 API 流式 / 生成中 Esc / 断网错误）、A4（bash 中文、超时 kill、30KB 截断）。A3（`MEWCODE_DEBUG=1` 请求体 + "工具可用"）因依赖 S2-7 接线，留到 S2-7 完成后复验。对应小节：S1-2 行 2/3/5、S2-2 行 2/3、S2-5 行 3/4/5 已标 ✅。

#### S2-7 UI 接线（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | B | 触发一次 read 工具 | 显示工具名 + 参数摘要 + 成功/失败 + 耗时 | P0 | ✅ **用户实测通过（2026-11-24）：`✅ read_file {"path":…} · Nms`** |
| 2 | B | 触发一次失败工具（读不存在的文件） | 错误可见、可读，不崩 | P0 | ✅ **用户实测通过（2026-11-24）：`❌ … · Error: 文件不存在：…` 可读且不崩** |
| 3 | B | 连续 3 个工具 | 历史区按顺序增长，不覆盖 | P1 | ✅ **用户实测通过（2026-11-24）：历史按序增长不覆盖** |
| 4 | B | 长参数（超长路径/命令） | 参数摘要截断，不撑爆布局 | P1 | ✅ **用户实测通过（2026-11-24）：超长参数出现 `…` 截断、布局正常** |

**A 级证据（2026-11-24，本地 Node v26.7.0）**：
- `npm run typecheck` exit 0
- `node --import tsx --test tests/tool-display.test.ts` → **tests 9 / pass 9 / fail 0**
- 全量 `npm test` → **tests 195 / pass 195 / fail 0（4388.7ms；原 186 + 新增 9）**
- 假 stdin/stdout 驱动 Ink 冒烟（`spikes/.out/tui-smoke.tsx`）：`SMOKE OK`（exit 0）——启动横幅含 6 工具列表；一轮 4 次工具调用（成功/失败/成功/长参数）历史按序增长；失败行带可读 `Error:`；长参数截断出现 `…`；生成中 Esc → 历史 `（已中断）`；多行粘贴/Shift+Enter/Ctrl+J/空闲 Ctrl+C 均正常。
- 记录：`spikes/.out/s2-7-typecheck.txt`、`s2-7-targeted.txt`、`s2-7-full.txt`、`s2-7-smoke.txt`（gitignored）。
- CI（gh 只读）：`45309525895`（task/s2-7-ui-events, `3496e79`）、`45309557707`（main, `a527565`）全部 success；job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 195 / # pass 195 / # fail 0`。

**实现要点**：新增 `src/ui/tool-display.ts`（纯函数：参数摘要截断 120 码点、错误首行截断 160、耗时 ms/s、`turn_end` 提示）；`App` 改为注入 `runTurn: RunAgentTurn`（`(messages, { signal, emit }) => runAgent({...})`），消费 `assistant_text`（50ms 节流）/`tool_start`（状态行"⚙ 工具运行中"）/`tool_end`（历史项 ✅/❌）/`turn_end`；`StartTuiOptions` 改为 `{ version, config, runTurn, toolNames }`；`src/index.ts` 交互分支创建 `createDefaultRegistry()` + 带工具名的 system prompt + `runAgent` 闭包，删除 S1 临时 `createRealSend`/`createMockSend`（mock 也走真 loop、真工具真执行）；状态机现为 `idle | streaming | tool_running`（`awaiting_approval`/`error` 随 S3-2）。

**已知限制**：loop 抛非中断错误时消息历史不追加本轮 assistant 回复（重试会出现连续 user 消息，OpenAI 兼容接口可接受）；并行工具仍串行；`readOnly` 仅元数据（Gate 在 S3-2）。

**补丁（2026-11-24，流式输出滚动叠字）**：用户反馈"流式输出时向上滚动窗口 → 同一段输出反复叠加"。根因：流式文本整段留在 Ink 动态区，长输出时动态区高度超过终端，超出屏幕的旧帧无法被清除、残留进 scrollback，滚动时可见。修复：`src/ui/stream-lines.ts`（`splitCompletedLines` 完整行立即提交 `<Static>`；`clampDynamicTail` 未完成尾巴只留最后 ≤800 码点；CRLF 行尾 `\r` 剥离），`App` 改为按行提交、动态区只渲染尾巴；新增 `tests/stream-lines.test.ts` 9 例，冒烟增加"60 行长输出每行只出现一次"断言。验证：`npm run typecheck` exit 0；全量 `npm test` **204/204（195 + 9）**；冒烟 `SMOKE OK`（exit 0）。记录：`spikes/.out/bugfix-typecheck.txt`、`bugfix-stream-lines.txt`、`bugfix-full.txt`、`bugfix-smoke.txt`（gitignored）。CI（gh 只读）：`45310862547`（fix/s2-7-stream-overlap, `4be728d`）、`45310880670`（main, `0e5df46`）全部 success，日志 `# tests 204 / # pass 204 / # fail 0`。

#### S2 B 级复核（用户，2026-11-24，全部通过）

用户按上面各小节手工项在 Windows Terminal 里完成并确认通过：S2-1 #3/#4（TUI 里 `../secret.txt` 与 junction 均被拒）、S2-3 #3（读 sample.txt 带行号）、#4（edit 落盘）、#5（多匹配保护 → 重试后 replace_all 成功）、S2-4 #2/#3/#4（glob 可读、grep `文件:行号:内容`、大文件不卡死）、S2-5 #2–#5、S2-6 #3–#5、S2-7 #1–#4。A 组补验（A1/A2/A4）见上段；A3（`MEWCODE_DEBUG=1` + 工具可用）已在 S2-7 接线后复验通过。

#### S2-8 S2 收尾（已完成 2026-11-24）

tag `v0.1-s2` 已打并 push；跑 S0–S2 全部自动化；按 §4 S2 回归清单手工过一遍。证据（`spikes/.out/` 均 gitignored）：

**自动验收（2026-11-24，本地 Node v26.7.0）**：

| # | 项 | 结果 |
|---|---|---|
| 1 | `npm run typecheck` | ✅ exit 0 |
| 2 | `npm test` 全量 | ✅ **ℹ tests 204 / pass 204 / fail 0** |
| 3 | `npm run dev -- --help` / `--version` | ✅ 8 参数齐全 / `0.1.0` exit 0 |
| 4 | `--mock --print hello` 连跑两次 | ✅ 两次输出完全一致（幂等） |
| 5 | `npm run build` + `node dist/index.js --mock --print hello` | ✅ build exit 0，dist 与 dev 输出一致 |
| 6 | `src/` 中 `\bany\b` 扫描 | ✅ 0 匹配 |
| 7 | TUI 假终端冒烟 / 6 工具 loop 演示 | ✅ `SMOKE OK` / `ALL TOOLS OK` |
| 8 | 真实 API `--print hello` | ✅ exit 0（457B 中文；headless 无工具属预期） |

- 完整记录：`spikes/.out/s2-8-acceptance.txt`、`s2-8-readme.txt`（gitignored）。
- CI（gh 只读）：`45316372561`（task/s2-8-acceptance, `d7c2445`）、`45316383746`（main, `f5c5d6f`）全部 success；job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 204 / # pass 204 / # fail 0`。
- **真实模型 README 验收（S2-8 核心）**：`spikes/.out/readme-acceptance.ts` 用真实 API + 真 `runAgent`/`createDefaultRegistry`，模型自主 `read_file README.md` → `glob **/README*` → 如实总结"README 只有一行标题、无实质内容"；`stopReason=stop steps=3 toolCalls=2`，输出 `README ACCEPTANCE OK`。
- **回归**：§4 S2 回归清单六项按 `docs/checklist.md` 更新（含用户 TUI 实测 glob/grep/bash、中文输出、B 级全通过）。
- **tag**：`v0.1-s2`（annotated，S2 收尾提交，已 push 远端；见 HANDOFF §5.3 与 §7 会话 22）。

---

### S3 · 权限 + 会话 + 上下文压缩

#### S3-1 权限三道闸（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 结果 | 级别 |
|---|---|---|---|---|---|
| 1 | A | `tests/permissions.test.ts`：只读自动放行；写操作需询问；路径越界拒绝；危险命令拦截；headless 写拒绝 | 全绿 | ✅ 18 例通过（另有 `tests/danger.test.ts` 9 例、`tests/config.test.ts` headless 端到端 1 例；全量 232/232） | P0 |
| 2 | B | testbed 里让它"删除 sample.txt" | 弹审批，显示工具与参数 | ✅ 用户实测通过（2026-11-24，S3-2 审批 UI）：弹审批并显示工具与参数 | P0 |
| 3 | B | 选 `n` | 文件还在；模型收到拒绝并换方案/说明 | ✅ 用户实测通过（2026-11-24）：选 n 文件仍在、模型收到拒绝 | P0 |
| 4 | B | 选 `y` | 文件删除成功 | ✅ 用户实测通过（2026-11-24）：选 y 删除成功 | P0 |
| 5 | B | 让它执行 `rm -rf D:\workplace\AIAgent\mewagent-testbed` | 不弹审批，直接硬拦，提示危险 | ✅ 用户实测通过（2026-11-24）：不弹审批、直接硬拦（`danger.ts` 9 例；TUI 走 bash → gate 返回 `权限被拒绝：危险命令…`） | P0 |
| 6 | B | 让它 `del /f /s /q`、`format`、`shutdown` | 均硬拦 | ✅ 用户实测通过（2026-11-24）：三条均硬拦（规则覆盖） | P0 |
| 7 | B | 同类写操作先选一次 `a`，再做第二次 | 本会话不再询问 | ✅ 用户实测通过（2026-11-24）：选 a 后同类不再问（白名单按工具名） | P1 |
| 8 | B | `--print` 模式下让它写文件 | 直接拒绝并说明 headless 限制 | ✅ 用户实测通过（2026-11-24）+ `tests/config.test.ts` 端到端覆盖（假 fetch 剧本：write_file → 拒绝原因回填 → 模型改用文本回答；文件未创建） | P0 |

**A 级证据（2026-11-24）**：`npm run typecheck` exit 0；`tests/danger.test.ts` 9/9、`tests/permissions.test.ts` 18/18；定向 config+mock+danger+permissions 68/68（994.6ms）；全量 `npm test` **232/232**（4056.4ms）。记录文件 `spikes/.out/s3-1-typecheck4.txt`、`s3-1-targeted.txt`、`s3-1-full2.txt`（gitignored）。CI（GitHub Actions, ubuntu Node 22）：`45318939161`（fix 分支）/`45318945962`（main, `899a60b`）success，日志 `# tests 232 / # pass 232 / # fail 0`；首轮曾因测试写死反斜杠路径在 POSIX 上红，已由 `tests/permissions.test.ts` 改用 `path.join("..", "secret.txt")` 修复。

**实现要点**：危险规则 13 条 + 包装器剥壳（`sudo`/`env`/`nohup`/`time`/`command`/`sh`/`bash`/`powershell`/`cmd`，最多 4 层）；gate 顺序见方案 §6.6（arguments → 未知工具 → 路径边界 → readOnly → 危险命令 → headless → 白名单 → `ask`）；拒绝文案带具体原因与"下一步"；`runRealHeadless` 升级为 loop + 只读工具，`[工具]`/`[工具结果]` 走 stderr。

**已知限制**：交互审批 UI 属 S3-2，当前 TUI 写操作一律拒绝（提示 S3-2）；headless 仅只读；fork 炸弹等只按文本特征检测（不执行）。

**B 级复核（用户，2026-11-24，第 5/6/8 行通过）**：危险命令（`rm -rf` testbed、`del /f /s /q`、`format`、`shutdown`）不弹审批直接硬拦；`--print` 模式写文件被直接拒绝并说明 headless 限制。

**B 级复核（用户，2026-11-24，第 2/3/4/7 行通过）**：在 S3-2 审批 UI 上实测——删除 testbed 文件弹审批并显示工具与参数、选 `n` 文件仍在且模型收到拒绝、选 `y` 删除成功、选 `a` 后同类不再询问。

#### S3-2 审批 UI（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 结果 | 级别 |
|---|---|---|---|---|---|
| 1 | B | 审批出现时输入框是否失焦 | 不会把 y/n 输进对话 | ✅ 用户实测通过（2026-11-24）：审批时输入框失焦、y/n 不进对话 | P0 |
| 2 | B | 按 Esc | 等同拒绝，UI 恢复可用 | ✅ 用户实测通过（2026-11-24）：Esc 等同拒绝、UI 恢复可用 | P0 |
| 3 | B | 按其它键 | 被忽略或提示可用键，不误操作 | ✅ 用户实测通过（2026-11-24）：其它键被忽略 | P1 |
| 4 | B | 参数很长时 | 摘要可读，不刷屏 | ✅ 用户实测通过（2026-11-24）：长参数摘要可读 | P1 |

**A 级证据（2026-11-24）**：`npm run typecheck` exit 0；`tests/approval.test.ts` 9/9（controller `ask`/`respond`/订阅、重叠请求拒绝、a 白名单、n 拒绝原因、Esc→拒绝、ApprovalPrompt 渲染含工具名/摘要/选项）；全量 `npm test` **241/241**（4130.6ms，`spikes/.out/s3-2-full.txt`）；假 stdin 审批冒烟 `APPROVAL SMOKE OK`（`spikes/.out/approval-smoke.tsx`，证据 `spikes/.out/s3-2-smoke3.txt`）：y 允许 → 文件创建；a → 同类第二次不再问；Esc → 拒绝且文件未改、模型收到拒绝并回复；非 y/a/n 键被忽略；空闲 Ctrl+C 退出。CI（GitHub Actions, ubuntu Node 22）：`45320602743`（task 分支, `19f3dd9`）/`45320608950`（main, `f90763b`）success，日志 `# tests 241 / # pass 241 / # fail 0`。

**实现要点**：`src/ui/approval.ts` 审批桥（`ask` 返回挂起 Promise，`subscribe`/`current`/`respond`；重叠审批抛错）；`src/ui/ApprovalPrompt.tsx` 只接受单字符 y/a/n，Esc→n；App 用 `awaiting_approval` 展示态（`pendingApproval` 非空时隐藏光标、输入框失焦、状态行常驻提示）；`start-tui`/`index.ts` 透传 controller 给 gate 的 `ask`；headless 不变（无 ask，写操作直接拒绝）。

**已知限制**：审批摘要对路径工具只显示路径（工具名在标题），参数超长截断；审批期间整轮只能被 Ctrl+C 中断（不提供"暂停"）；同一时刻只允许一个 pending 审批。

**B 级复核（用户，2026-11-24，4 行全部通过）**：审批时输入框失焦（y/n 不进对话）、Esc 等同拒绝且 UI 恢复可用、其它键被忽略、长参数摘要可读不刷屏。

#### S3-3 会话持久化（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 结果 | 级别 |
|---|---|---|---|---|---|
| 1 | A | `tests/session.test.ts`：保存/加载往返、版本字段、损坏 JSON 回退、`--new` | 全绿 | ✅ 14 例通过（另有 `tests/config.test.ts` 3 例启动/恢复/损坏/`--new` 端到端；全量 258/258） | P0 |
| 2 | B | TUI 聊 2 轮 → 退出 → 重开 | 顶部提示"已恢复 N 条消息"，上下文连续 | ✅ 用户实测通过（2026-11-24）：恢复提示出现、上下文连续 | P0 |
| 3 | B | 重开时加 `--new` | 全新会话，不加载旧记录 | ✅ 用户实测通过（2026-11-24）：`--new` 全新开始 | P0 |
| 4 | B | 手动把 `.mewcode/session.json` 改坏再启动 | 不崩溃，提示损坏并新建 | ✅ 用户实测通过（2026-11-24）：不崩溃、提示「会话文件损坏，已按新会话启动」 | P0 |
| 5 | B | `git status` | `.mewcode/` 未被跟踪 | ✅ 用户实测通过（2026-11-24）：`.mewcode/` 未出现在 git status | P0 |

**A 级证据（2026-11-24）**：`npm run typecheck` exit 0；`tests/session.test.ts` 14/14；定向 `tests/config.test.ts`+`tests/session.test.ts` 47/47；全量 `npm test` **258/258**（`spikes/.out/s3-3-full2.txt`）；`npm run build` exit 0；`src/session/store.ts` `\bany\b` 0 匹配。记录文件 `spikes/.out/s3-3-typecheck4.txt`、`s3-3-targeted2.txt`、`s3-3-full2.txt`、`s3-3-build.txt`（gitignored）。

**CI 证据**：`45322608903`（task 分支, `49d6f03`）、`45322616714`（main, `da13fc2`）success；job `typecheck + test (Node 22)` 日志 `# tests 258 / # pass 258 / # fail 0`。

**B 级复核（用户，2026-11-24，2–5 行全部通过）**：聊 2 轮退出重开出现恢复提示且上下文连续、`--new` 全新会话、改坏 session.json 不崩溃且提示损坏、`.mewcode/` 未被 git 跟踪。另外记录当前设计边界：**每个 workspace 只有一个会话**（固定路径 `.mewcode/session.json`，每轮覆盖保存）；需要多个并行会话请用不同 `--workspace` 目录；命名会话/`--resume` 属 v0.2 候选（见 HANDOFF §4 待定项）。

**实现要点**：`src/session/store.ts` 导出 `resolveSessionPath` / `loadSession(workspace, {forceNew?})` / `saveSession(workspace, model, messages, {createdAt?, now?})`；路径 `<workspace>/.mewcode/session.json`；格式 `{version:1, workspace, model, createdAt, updatedAt, messages}`；只存 user/assistant/tool（system 每次启动重建、加载时静默跳过）；保存先写 `.tmp` 再 `rename` 原子替换，空历史不落盘，失败返回 `{ok:false, reason}` 不抛异常；加载 ENOENT→空会话、坏 JSON/未知版本/非法消息→`corrupt`+可读原因；`src/index.ts` 交互分支启动时加载并注入 `initialMessages`/`restoredMessageCount`/`sessionNotice`，每轮结束（含中断）调用 `persistMessages` 落盘，失败仅打 `警告：会话保存失败：…`；headless 不读写会话。

**已知限制**：会话文件只存消息与元信息，不含 UI 历史项（工具 ✅/❌ 行不恢复，只恢复对话消息）；同一工作区只有一个会话文件（多开互相覆盖，v0.2 再做多会话）；`updatedAt` 用本机时间，不保证跨机一致。

#### S3-4 上下文压缩（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 结果 | 级别 |
|---|---|---|---|---|---|
| 1 | A | `tests/compress.test.ts`：3 轮超预算；system 保留；最新轮保留；不产生悬空 tool；单轮超长截断 | 全绿 | ✅ 17 例通过（另有 `tests/loop.test.ts` 压缩接线 2 例；全量 277/277） | P0 |
| 2 | B | mock 长文本连续 50 轮（或真实 15 轮短对话） | 无 400 上下文超限；对话仍连贯 | ✅ 用户实测通过（2026-11-24）：50 轮 mock 长对话无上下文超限、对话连贯 | P0 |
| 3 | B | `MEWCODE_CONTEXT_TOKENS=300` + `MEWCODE_DEBUG=1` 观察压缩前后 token 估算 | 压缩确实发生，system 未被丢 | ✅ 用户实测通过（2026-11-24）：stderr 出现 `[压缩] 丢弃 N 轮，tokens X → Y`，system 行仍在最前 | P1 |
| 4 | B | 压缩后继续问早期信息 | 模型会说"不记得"，但能基于压缩摘要/最近轮回答 | ✅ 用户实测通过（2026-11-24，P2）：模型表示早期信息已不在上下文中 | P2 |

**A 级证据（2026-11-24）**：`npm run typecheck` exit 0；`tests/compress.test.ts` **17/17**；定向 `tests/loop.test.ts`+`tests/compress.test.ts` **38/38**；全量 `npm test` **277/277**（`spikes/.out/s3-4-full2.txt`）；`npm run build` exit 0（`s3-4-build2.txt`）；`src/context/*.ts` `\bany\b` 0 匹配。记录文件 `spikes/.out/s3-4-typecheck2.txt`、`s3-4-compress.txt`、`s3-4-targeted.txt`、`s3-4-full2.txt`、`s3-4-build2.txt`（gitignored）。

**CI 证据（2026-11-24）**：`45326578269`（task/s3-4-context, `01f28ba`）与 `45326599856`（main, `80a8b82`）均 success；job `typecheck + test (Node 22)` 步骤全 success，日志 `# tests 277 / # pass 277 / # fail 0`。

**实现要点**：`src/context/tokens.ts` 导出 `estimateTextTokens` / `estimateMessageTokens` / `estimateMessagesTokens` / `computeBudgetTokens`，常量 `DEFAULT_CONTEXT_TOKENS=128000`、`DEFAULT_BUDGET_RATIO=0.7`、`MESSAGE_OVERHEAD_TOKENS=8`（CJK 1.1/字、其他 1/4、tool_calls 的 id/name/arguments 计入）；`src/context/compress.ts` 导出 `groupIntoTurns`（system 单列、每条 user 起一轮）与 `compressMessages`（最新轮必留、从新到旧累加到 `contextTokens×0.7`、旧轮**整轮**丢弃、最新轮超预算时截断 tool 到 2000 字符 / assistant 到 4000 字符、结果不以 tool 开头；返回 `{messages, droppedTurns, keptTurns, beforeTokens, afterTokens, truncated}`）；`src/agent/loop.ts` 增 `contextTokens` / `onCompress`，**只在请求前替换发给模型的副本**，返回的 `messages` 仍完整（供会话持久化/UI 展示）；`src/index.ts` 从 `MEWCODE_CONTEXT_TOKENS` 读窗口（默认 128000），`MEWCODE_DEBUG=1` 时通过 `onCompress` 把 `[压缩]` 统计打到 stderr；`.env.example` / `--help` 补充该变量。

**已知限制**：估算是字符级"保险丝"（非真实分词，CJK 1.1/字为经验值，不做精确计费）；被丢弃的旧轮**不会生成摘要**，模型会真的不记得早期细节（只保留 system 与最近若干轮）；工具输出已由工具层截到 30KB，压缩层再对最新轮 tool 截 2000 字符；预算不含 tools schema 的 token（靠 30% 余量吸收）；`MEWCODE_CONTEXT_TOKENS` 只影响压缩阈值，不改变模型真实窗口。

**B 级复核**：✅ 2–4 行已由用户 2026-11-24 实测通过（50 轮 mock 不超限；`[压缩]` 统计出现且 system 保留；压缩后追问早期信息模型表示不记得）。

#### S3-5 S3 集成验收（已完成 2026-11-24，tag `v0.1-s3`）

按 §4 S3 回归清单逐项过。

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 全量回归（typecheck / test） | ✅ `npm run typecheck` exit 0；全量 `npm test` **277/277 pass、fail 0** |
| 2 | CLI 回归（`--help` / `--version` / `--mock --print` ×2 / `build`+`dist`） | ✅ 8 个参数齐全；`0.1.0` exit 0；两次 `--mock --print 你好` 输出完全一致；`npm run build` exit 0 且 `node dist/index.js --mock --print 你好` 与 dev 输出一致 |
| 3 | 50 轮不爆上下文（脚本化集成） | ✅ `spikes/.out/s3-5-integration.ts`：50 轮全部 `stopReason=stop`；内存历史 101 条完整；压缩发生 50 次、`maxDropped=41`；末次请求 18 条（system 首位、不以 tool 开头）；tool 配对完整 |
| 4 | 重启恢复会话（脚本化集成） | ✅ 保存 → `loadSession` → 继续一轮 → 再保存：消息 2 → 4 条、`createdAt` 保留、磁盘文件 4 条 |
| 5 | 审批拒绝后继续（脚本化集成） | ✅ 审批询问 1 次（`write_file:deny.txt`）；文件未创建；`tool_end` 失败；模型收到 `权限被拒绝` 回填并继续给出文本；`stopReason=stop` |
| 6 | 危险命令硬拦（脚本化集成） | ✅ `rm -rf /` 未弹审批（`asked=0`），模型收到"危险命令"原因，loop 继续 |
| 7 | TUI / 审批 / 全工具冒烟回归 | ✅ `SMOKE OK`、`APPROVAL SMOKE OK`、`ALL TOOLS OK` |
| 8 | 源码无 `any` / 工作树干净 | ✅ `src/**` `\bany\b` 0 匹配；提交前 `git status` 仅文档改动 |

**证据**：`spikes/.out/s3-5-integration.txt`（25 项断言以 `INTEGRATION OK` 结束）、`s3-5-typecheck.txt`、`s3-5-full.txt`、`s3-5-help.txt`、`s3-5-version.txt`、`s3-5-mock1.txt`/`s3-5-mock2.txt`、`s3-5-build.txt`、`s3-5-dist.txt`、`s3-5-tui-smoke.txt`、`s3-5-approval-smoke.txt`、`s3-5-all-tools.txt`（均 gitignored）。

**B 级**：S3 各任务 B 级已由用户实测通过（S3-1 第 2/3/4/7、S3-2 4 条、S3-3 2–5、S3-4 2–4）；用户还可按方案 §4 S3 手工清单在 TUI 里再过一遍（删文件弹审批、n 不硬来、a 后同类不再问、`rm -rf /` 直接拦、连续 50 轮、退出重进恢复）。

**CI**：main run `45328300984`（`0440c19`）与 task 分支 run `45328290294`（`fab49a5`）均 success，日志均为 `# tests 277 / # pass 277 / # fail 0`。

**tag**：`v0.1-s3`（annotated，打在 S3 收尾提交，已 push）。

---

### S4 · 打磨与交付

#### S4-1 diff 与错误展示（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | B | 触发一次 edit | 显示带行号的红绿 diff | P0 | ✅ 用户实测通过（2026-11-24）（A 级：`tests/fs.test.ts` 断言 diff 文本、`tests/diff-view.test.ts` 解析、`tests/ui.test.ts` 渲染红绿行） |
| 2 | B | 错误场景逐个触发：错 key、断网、工具异常、权限拒绝、maxSteps | 每种都有"发生了什么 + 下一步怎么办" | P0 | ✅ 用户实测通过（2026-11-24）（A 级：`tests/errors.test.ts` 覆盖 HTTP 401/403/404/429/5xx、网络、中断、通用；工具失败提取「下一步」；`formatTurnEndNote` max_steps 带下一步） |
| 3 | B | 错误后继续对话 | 进程不崩，UI 可继续使用 | P0 | ✅ 用户实测通过（2026-11-24）（A 级：工具失败/权限拒绝/LlmHttpError 均只产生历史项与提示行，loop/App 不抛异常） |

**A 级自动化证据**（2026-11-24）：
- `npm run typecheck` exit 0；全量 `npm test` → **tests 296 / pass 296 / fail 0**（26 个测试文件；S3-5 的 277 例 + 新增 19 例）
- 新增 `tests/diff.test.ts` 9 例：单行替换 hunk 行号与计数、插入/删除单侧计数、远距离拆分/近距离合并 hunk、CRLF 按行处理、末尾换行不算改动、空文件/清空、maxHunks 截断提示、超大改动粗略 diff 不崩、`formatDiffLine` 行号列
- 新增 `tests/errors.test.ts` 4 例：HTTP 状态映射、`isNetworkFailure` 边界、`describeFailure`（HTTP/网络/中断/通用）、`describeToolFailure` 提取首行与下一步
- 新增 `tests/diff-view.test.ts` 5 例：edit 输出解析为可着色行、非 diff 返回 null、截断提示识别、渲染行数裁剪、`+N −M` 格式化
- `tests/fs.test.ts` edit_file 断言改为 diff 格式（`已替换 1 处（edit.txt）：` + `--- a/` + `@@ -1,7 +1,7 @@` + `-   4│ line four` / `+   4│ LINE FOUR`）；`tests/tool-display.test.ts` 更新 `formatTurnEndNote`；`tests/ui.test.ts` 新增 diff 条目渲染
- 冒烟：`spikes/.out/tui-smoke.tsx` → `SMOKE OK`；`npm run build` exit 0、`node dist/index.js --mock --print "你好"` 正常；`src/` 无 `any` 匹配
- **CI**：task 分支 run `45338908280`（`2a7316b`）与 main run `45338929774`（`8e8109a`）均 success，日志均为 `# tests 296 / # pass 296 / # fail 0`

**实现要点**：
- `src/tools/diff.ts`：行级 unified diff 生成器（剥公共前后缀 → LCS，超 25 万格退化为整段替换；hunk ±3 行、`maxHunks=8`、`maxLines=240` 截断；格式 `--- a/` / `+++ b/` / `@@ -o,n +o,n @@` / `<标记><4 位行号>│ 内容`）
- `src/tools/fs.ts`：`edit_file` 输出改为"头行 + diff"，仍受 30KB 工具输出上限约束（`clampBytes`）
- `src/ui/diff-view.ts` + `HistoryItem` 的 `diff` 条目：解析后按 red/green/cyan/dim 渲染，最多渲染 80 行
- `src/errors.ts`：`describeHttpStatus` / `isNetworkFailure` / `describeFailure` / `describeToolFailure`；`App.tsx` 与 `index.ts`（headless）共用，所有失败都带「下一步」
- `formatTurnEndNote`：`max_steps` 提示追加下一步（"回复'继续'…或把任务拆小后重发"）

**B 级复核（用户，已完成 2026-11-24）**：用户已在 Windows Terminal 实测 3 条全部通过——①实时模型触发 `edit_file`，看到带行号的红绿 diff；②错 key / 断网 / 工具异常 / 权限拒绝等错误均有「发生了什么 + 下一步」；③错误后继续对话，进程不崩、输入框可用。


#### S4-2 README 与文档（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | B | 把仓库 clone 到新目录，只照 README 操作 | 能安装、配置、`--mock` 跑通 | P0 | ✅ 用户实测通过（2026-11-24，另一台机器；A 级：克隆副本已跑通） |
| 2 | B | README 是否含：安装、配置、命令、架构图、加工具教程 | 五项齐全 | P1 | ✅ 用户实测通过（2026-11-24，另一台机器；A 级：五项齐全） |
| 3 | B | `docs/checklist.md` | 10 条成功标准可逐项打勾 | P1 | ✅ 用户实测通过（2026-11-24，另一台机器） |

**A 级验收（2026-11-24）**：把仓库克隆到临时目录 `%TEMP%\mewagent-readme-check-142449`，仅照 README「快速开始」执行：`npm install` exit 0（52 包 / 4.0s；npm 对 esbuild postinstall 的 allowScripts 提示不影响运行）；`npm run typecheck` exit 0；`npm test` → `tests 296 / pass 296 / fail 0`（4.4s）；`npm run dev -- --mock --print "你好"` exit 0（无 `.env` 时 mock 模型显示 `model: mock`）；`npm run build` exit 0；`node dist/index.js --mock --print "你好"` exit 0；`--help` 首行 `mewagent 0.1.0 — 终端里的 AI 编程助手（v0.1）`。README 覆盖：定位/特性、环境要求、安装、配置（`.env.example` + 环境变量表 + 代理）、快速开始（mock / TUI / 真实 API / workspace / build）、命令参数表、架构图（ASCII）+ 数据流、目录结构、6 工具表、3 步加工具教程（`ToolDefinition` 代码片段 + 注册 + 测试）、权限与安全、会话与上下文压缩、错误展示表、测试与 CI、Windows 注意、已知限制与 Roadmap、文档索引。

**CI（2026-11-24）**：task 分支 run `45340842266`（`67a7013`）与 main run `45340852106`（`7518d8f`）均 success，日志均 `# tests 296 / # pass 296 / # fail 0`。

**B 级复核（用户，已完成 2026-11-24）**：用户已在另一台机器上完成——①按 README 从新目录 clone 并跑通（终端为 Windows PowerShell；此前 Node < 20.12 的 `.env` 加载问题已由热修 `79ed275` 兜底）；②核对五项齐全；③对照 `docs/checklist.md` 逐项打勾。
#### S4-3 打包与启动（已完成 2026-11-24）

| # | 类型 | 步骤 | 预期 | 级别 | 结果 |
|---|---|---|---|---|---|
| 1 | B | `npm link` 后在任意目录执行 `mewagent --help` | 能找到命令并输出用法 | P0 | ⏳ 待用户（A 级：`npm link` 后在 `%TEMP%` 普通目录与含空格的目录均可用） |
| 2 | B | `npx . --mock --print "你好"` | 可运行 | P0 | ⏳ 待用户（A 级：`npx . --mock --print hello` exit 0） |
| 3 | B | 从含空格/中文的路径启动 | 路径处理正常 | P0 | ⏳ 待用户（A 级：`%TEMP%\mew agent 中文 目录` 下 `--version`/`--mock --print` 均 exit 0） |
| 4 | B | 卸载/清理（`npm unlink -g mewagent`） | 无残留 | P2 | ⏳ 待用户（A 级：unlink 后 shim 与 `node_modules/mewagent` 均已移除） |

**A 级验收（2026-11-24）**：
- 打包配置：`package.json` 增 `bin.mewagent = ./dist/index.js`、`prepack = npm run build`、`files = [dist, README.md, docs, AGENTS.md, .env.example]`；`src/index.ts` 首行加 `#!/usr/bin/env node`（`tsc` 保留到 `dist/index.js`）。
- 修复：直跑判断由「`pathToFileURL(process.argv[1])` 与 `import.meta.url` 字面比较」改为「两端 `realpathSync` 后比较」——`npm link`/`npx` 经 junction 启动时 `argv[1]` 是链接路径、`import.meta.url` 是真实路径，旧实现会 `isDirectRun=false` 并静默 exit 0（命令“能跑”但无任何输出）。
- 回归：新增 `tests/packaging.test.ts` 5 例（bin 指向 dist、prepack 为构建、files 白名单不含 tests/spikes、shebang、engines>=22）。
- 实测：typecheck 0；全量 `npm test` **303/303**（27 个测试文件）；`npm run build` 0；`npm pack --dry-run` 77 项 / 230KB / 解包 650KB，含 `dist/`、README、docs，不含 `tests/`、`spikes/`；`npm link` 后 `mewagent --version` → `0.1.0`、`--help` 首行 `mewagent 0.1.0 — 终端里的 AI 编程助手（v0.1）`，在 `%TEMP%\mewagent-link-check` 与 `%TEMP%\mew agent 中文 目录` 下 `--mock --print "你好"` 均 exit 0；`npx . --mock --print hello` exit 0（两轮 mock 完整）；`npm unlink -g mewagent` 后 `Get-Command mewagent` 为空、全局 `node_modules/mewagent` junction 已删除。
- 证据：`spikes/.out/s4-3-typecheck2.txt`、`s4-3-full2.txt`、`s4-3-build2.txt`、`s4-3-pack.json`、`s4-3-link.txt`、`s4-3-global-help.txt`、`s4-3-plain-path-mock.txt`、`s4-3-cn-path-mock.txt`、`s4-3-npx.txt`、`s4-3-unlink.txt`（均 gitignored）。

**B 级复核（待用户）**：①`npm link` 后在任意目录 `mewagent --help`；②`npx . --mock --print "你好"`（可先 `npm run build`，`prepack` 也会自动构建）；③从含空格/中文的路径启动一次；④`npm unlink -g mewagent` 确认清理干净。
#### S4-4 十条成功标准 + demo

逐条对照 [个人版实施计划](../MewCode-个人版实施计划.md) §1.4 / 实施方案 §1.4，在 `docs/checklist.md` 打勾。额外：

| # | 类型 | 步骤 | 预期 | 级别 |
|---|---|---|---|---|
| 1 | B | 连续 50 轮 | 不爆上下文、不崩 | P0 |
| 2 | B | 3 分钟演示脚本从头走一遍 | 不翻车，时间够 | P0 |
| 3 | B | 记录一次真实任务的全过程 | 能完成（改 bug/读代码） | P0 |
| 4 | B | 成本记录：3 个任务的 token 数 | 在可接受范围 | P1 |

---

## 4. 阶段回归清单（打 tag 前必跑）

### S0 回归

- [ ] `npm install && npm run typecheck && npm test`
- [ ] `npm run dev -- --help` / `--version` / 缺 key 报错
- [ ] `npm run dev -- --mock --print "你好"`
- [ ] IME spike 结论已记录且为"可用"（或已转 Go）

### S1 回归

- [x] S0 全部（S1-6 重跑通过：typecheck 0 / tests 104 / `--help` / `--version` / `--mock --print` 幂等 / build + dist 一致）
- [x] `npm test`（含 SSE 用例）→ 104/104，其中 `tests/sse.test.ts` 13 例
- [x] 真实流式对话 1 次：中文、逐段、Esc 中断（用户 S1-4 补丁验收：`MEWCODE_MOCK_DELAY_MS=80` 慢速流式 + Esc 中断；真实 API 中文输出在 S1-5 A1 / S1-6 复验）
- [x] `--print` 管道 1 次（cmd 管道 + 位置参数两种写法均 exit 0；PS 5.1 原生管道见 S1-5「Windows PowerShell 5.1 注意」）
- [x] 错误 key 1 次（可读报错）（假 key → HTTP 401 + `下一步` + exit 1，不泄露 key）

### S2 回归

- [ ] S1 全部
- [ ] 多工具任务 1 个（读 → 改 → 跑命令）
- [ ] 越界读取被拒 1 次
- [ ] 大输出截断 1 次（big.log）
- [ ] 工具失败不崩 1 次

### S3 回归

- [x] S2 全部（S2-8 验收已覆盖：多工具真实任务、越界拒绝、大输出截断、工具失败不崩；S3-5 再做全量回归 + `ALL TOOLS OK` 复验）
- [x] 写审批 y / n / a 各 1 次（S3-2 B 级用户实测通过）
- [x] 危险命令硬拦（rm -rf / del /f / format）（S3-1 B 级 + S3-5 集成脚本 `rm -rf /` 硬拦断言）
- [x] 退出重进恢复；`--new` 不恢复（S3-3 B 级用户实测通过；S3-5 集成脚本复验 2→4 条）
- [x] 50 轮不爆上下文（mock 或真实）（S3-5 集成脚本：50 轮全部 stop、历史 101 条、maxDropped=41；S3-4 B 级用户 mock 50 轮）
- [x] headless 写拒绝 1 次（S3-1 A 级 `tests/permissions.test.ts` + headless 端到端用例）
- [x] `git status` 无 `.env`/`.mewcode/`（S3-5 提交前工作树仅文档改动；`.env`、`.mewcode/` 均 gitignored）

### S4 回归

- [ ] S3 全部
- [ ] clone 到新目录按 README 跑通（S4-2 已在克隆副本验证：install 4s / typecheck 0 / 296/296 / `--mock` 0 / build 0 / dist 0；S4-4 时再按用户视角走一遍）
- [x] 全局命令 + `npx .` 各 1 次（S4-3：`npm link` 后任意目录 `mewagent --version/--help/--mock --print` 均 0；`npx . --mock --print hello` 0；`npm unlink -g mewagent` 后无残留）
- [ ] 10 条成功标准全勾
- [ ] 3 分钟演示成功
- [ ] tag `v0.1.0` 已推送

---

## 5. 记录模板

### 5.1 单 task 测试记录（追加到 HANDOFF §7 或独立日志）

```text
### S2-3 文件工具 · 2026-11-24
- 自动化：npm test → 18 passed, 0 failed（输出已贴）
- 手工：
  - [P0] 读 sample.txt：通过
  - [P0] edit 第 2 行：通过（附 Get-Content 输出）
  - [P0] 多处匹配提示：通过
  - [P1] CRLF：失败 —— edit 后整个文件变 LF，见缺陷 #3
- 结论：P0 全过，P1 有缺陷 → 状态 doing，缺陷修复后 done
```

### 5.2 缺陷记录

```text
# 缺陷 3：CRLF 文件 edit 后换行风格被改变
- 发现于：S2-3 手工测试
- 复现：testbed 建 crlf.txt → 让 Agent 改 a→A → Format-Hex 检查
- 期望：保留 CRLF；实际：全部变 LF
- 影响：Windows 用户 diff 噪音大（P1）
- 关联文件：src/tools/fs.ts
```

### 5.3 AI 自测报告要求（可直接作为提示词）

```text
完成实现后，按 docs/testing.md 的 <task ID> 小节执行：
1) 跑完所有“自动化”项，贴命令 + 退出码 + 失败输出；
2) 不要替我勾选手工项；
3) 若某项无法自动验证，写“需人工验证 + 验证步骤”；
4) 最后给出：P0 是否全过、哪些 P1 失败、下一步建议。
```

---

## 6. 常见问题

| 现象 | 排查 |
|---|---|
| `npm test` 找不到测试 | 检查 `package.json` 的 test 脚本与 `tests/*.test.ts` 是否存在 |
| TUI 不渲染/乱码 | 换 Windows Terminal；`chcp 65001`；确认 `NODE_OPTIONS` 无奇怪项 |
| 真实请求 401 | `.env` key/模型名/供应商匹配；是否有空格；是否走了错误 baseURL |
| 429/超时 | 降低频率；检查代理；换便宜模型；确认 maxSteps 未失控 |
| 中文输出乱码 | cmd 用 UTF-8/GBK 回退；检查 `bash` 工具解码逻辑 |
| IME 候选框错位 | 记录终端/输入法版本 → 按 HANDOFF §4 未定项处理 |
| 测试污染工作区 | 只在 testbed 做写/删测试；`git status` 检查 |
| CI 红但本地绿 | 看 Node 版本、路径大小写、CRLF、缺依赖（`npm ci`） |

---

## 7. AI 不能替代的测试（重点）

以下项目**必须**由用户亲自做，AI 自测结论一律不算数：

1. 中文输入法与候选框（Windows Terminal / conhost 各一遍）
2. 流式渲染的视觉感受（闪烁、滚动、历史错位）
3. 真实模型的任务完成质量（是否"看起来像那么回事"）
4. 审批交互的信任感（是否每次都能看懂将要发生什么）
5. 危险命令拦截（要故意"使坏"去试）
6. 长任务体感与中断恢复
7. 从零 clone 的安装体验
8. 成本感受（真实任务花多少钱）

---

## 附录 A：测试数据脚本

见 §2.4（每次测试前重建 testbed）。

## 附录 B：IME spike（已有脚本，直接复验）

S0-1 已把脚本提交进仓库，**不要另建 scratch 文件**：

| 用途 | 命令/文件 |
|---|---|
| 手工复验 | `npx tsx spikes/ime-spike.tsx` |
| 全自动 GUI 驱动（真实按键/截图） | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes\run-ime-spike.ps1` |
| 结果报告 | `spikes/RESULT.md` |
| 证据 | `spikes/.out/ime-log.jsonl`、`spikes/.out/summary.json`、`spikes/.out/*.png`（已 gitignore） |

> 注意：本机执行策略 `RemoteSigned`，直接 `& spikes\run-ime-spike.ps1` 会被拒绝，必须加 `-ExecutionPolicy Bypass`。

判定表（复验时逐项对照）：

| 检查项 | 通过 | 失败表现 |
|---|---|---|
| 候选框位置 | 光标附近（略偏可接受） | 跑到左上角/遮挡输入 |
| 选词上屏 | 内容正确 | 丢字/多字/顺序乱 |
| 退格 | 一次删一个字 | 删半个字/多删 |
| 左右键 | 光标可移动 | 无法移动/跳错 |
| 粘贴中文 | 内容完整 | 截断/乱码 |
| Shift 切换 | 中文↔英文直通 | 无法切换/卡组合态 |

任一 P0 项失败：按实施方案 §9.1 评估转 Go，并把结论写进 HANDOFF §4/§7。

判定表：

| 检查项 | 通过 | 失败表现 |
|---|---|---|
| 候选框位置 | 在光标附近 | 跑到左上角/错位 |
| 选词上屏 | 内容正确 | 丢字/多字/顺序乱 |
| 退格 | 一次删一个字 | 删半个字/多删 |
| 左右键 | 光标可移动 | 无法移动/跳错 |
| 粘贴中文 | 内容完整 | 截断/乱码 |
| Esc | 退出 | 无响应 |

任一 P0 项失败：按实施方案 §9.1 评估转 Go，并把结论写进 HANDOFF §4/§7。

## 附录 C：任务 → 测试文件矩阵

| Task | 预期测试文件/方式 |
|---|---|
| S0-1 ✅ | typecheck + `tests/core.test.ts`；IME 复验见附录 B |
| S0-2 ✅ | typecheck + `tests/types.test.ts`（`npm test`） |
| S0-3 ✅ | typecheck + `tests/config.test.ts`（`npm test`）+ 手工命令集 |
| S0-4 ✅ | typecheck + `tests/mock.test.ts`（`npm test`）+ `--mock --print` 端到端 |
| S0-5 ✅ | 文档文件存在性 + typecheck/test + 本地模拟 CI（`npm ci` → typecheck → test）+ GitHub Actions 变绿（用户确认） |
| S1-1 ✅ | typecheck + `tests/sse.test.ts`（`npm test`，13 用例） |
| S1-2 ✅ | typecheck + `tests/openai.test.ts`（`npm test`，13 用例）；真实流式联调见 S1-5 |
| S1-3 ✅ | typecheck + `tests/messages.test.ts` + `tests/prompt.test.ts`（`npm test`，各 6 用例） |
| S1-4 ✅ | 手工 TUI 清单（8 条 B 级已由用户验收）+ UI 单测 `tests/ui.test.ts` + 补丁 `tests/input-text.test.ts` / `tests/stream-lines.test.ts` |
| S1-5 ✅ | 管道命令 + 假 fetch 单测 `tests/config.test.ts` / `tests/openai.test.ts`（真实 API A 级复验已通过） |
| S2-1 ✅ | typecheck + `tests/paths.test.ts`（10 用例；全量 `npm test` 114/114；B 级 TUI 项随 S2-6/S2-7 后验） |
| S2-2 ✅ | typecheck + `tests/registry.test.ts`（13 用例；全量 127/127；"6 工具齐全"随 S2-3~S2-5 后验） |
| S2-3 ✅ | typecheck + `tests/fs.test.ts`（14 用例；全量 141/141；testbed 手工 B 级 3–5 条随 loop/TUI/审批接线后验） |
| S2-4 ✅ | typecheck + `tests/search.test.ts`（11 用例；全量 153/153；B 级 2–4 随 loop/TUI 接线后验） |
| S2-5 ✅ | typecheck + `tests/bash.test.ts`（14 用例；全量 167/167；B 级 2–5 随 loop/TUI 接线后验） |
| S2-6 ✅ | typecheck + `tests/loop.test.ts`（19 用例；全量 186/186；B 级 3–5 随 S2-7 UI 接线后验） |
| S2-7 ✅ | 手工 UI + `tests/tool-display.test.ts`（9 用例）+ 补丁 `tests/stream-lines.test.ts`（9 用例；全量 204/204） |
| S3-1 ✅ | typecheck + `tests/danger.test.ts`（9 例）+ `tests/permissions.test.ts`（18 例）+ `tests/config.test.ts` headless 端到端 1 例（全量 232/232）；B 级 5/6/8 可先验，2–4/7 待 S3-2 审批 UI |
| S3-2 ✅ | 手工审批（y/a/n/Esc）+ `tests/approval.test.ts`（9 用例）+ 假 stdin 豁免 `APPROVAL SMOKE OK` |
| S3-3 ✅ | typecheck + `tests/session.test.ts`（14 例）+ `tests/config.test.ts`（3 例启动恢复/损坏/`--new` 端到端；全量 258/258；B 级 2–5 待用户重启验证） |
| S3-4 ✅ | `tests/compress.test.ts`（17 例）+ loop 压缩接线 2 例 + 50 轮 B 级（用户已验） |
| S3-5 ✅ | 集成脚本 4 场景 25 断言 + 全量回归 277/277 + tag `v0.1-s3` 已推送 |
| S4-1 ✅ | 手工 diff/错误 + `tests/diff.test.ts`（9 例）/`tests/errors.test.ts`（4 例）/`tests/diff-view.test.ts`（5 例）+ ui/fs/tool-display 断言更新（全量 296/296）；B 级 3 条已由用户 2026-11-24 实测通过 |
| S4-2 ✅ | 新目录按 README 跑 + 五项齐全 | A 级：克隆副本 `npm install` 4s / typecheck 0 / 296/296 / `--mock` 0 / build 0 / dist 0；B 级 3 条待用户 |
| S4-3 ✅ | `npm link` / `npx .` | A 级：link 后任意目录可用（含空格+中文路径）、`npx .` 可运行、unlink 无残留、`tests/packaging.test.ts` 5 例、全量 303/303；B 级 4 条待用户 |
| S4-4 | 10 条标准 + demo |

## 附录 D：更新记录

| 日期 | 变更 |
|---|---|
| 2026-11-23 | 首版：覆盖 S0–S4 全部 29 个 task；定义 A/B/C 分工、测试沙盒、阶段回归清单 |
| 2026-11-23 | 对齐 S0-1 完成后的实际仓库：补 PowerShell 5.1 / WT 1.25 / Node 26.7 实测环境；S0-1 章节改为复验步骤；IME 脚本改为引用已提交的 `spikes/`；命令按阶段可用性标注 |
| 2026-11-23 | S0-2 完成：`src/types.ts` 契约落地（回填 `ToolSpec`）、新增 `tests/types.test.ts`；S0-2 章节改为复验步骤，进度切到 S0-3 |
| 2026-11-23 | S0-3 完成：`src/config.ts` + `src/index.ts`（`.env` / CLI 参数 / TTY 检查 / `--print` headless 骨架）落地、新增 `tests/config.test.ts` 25 用例（全量 31）；S0-3 章节改为复验步骤并附实测证据，进度切到 S0-4 |
| 2026-11-23 | S0-4 完成：新增 `src/llm/mock.ts`（离线两轮剧本）+ `src/index.ts` 两轮驱动骨架 + `tests/mock.test.ts` 8 用例（全量 39）；`--mock --print "你好"` 不依赖网络走完两轮；S0-4 章节改为复验步骤并附实测证据，进度切到 S0-5 |
| 2026-11-23 | S0-5 完成：新增 `AGENTS.md`、`CLAUDE.md`、`docs/spec.md`、`docs/checklist.md`、`.github/workflows/ci.yml`（Node 22，`npm ci` → typecheck → test）；本地模拟 CI 全绿（52 packages / typecheck 0 / 39 测试通过）；S0-5 章节改为复验步骤并附实测证据，进度切到 S0-6 |
| 2026-11-23 | S0-6 完成：S0 全量验收通过（typecheck 0 / tests 39 pass 39 / --help 8 参数 / --version 0.1.0 / --mock --print 两次输出一致 / build+dist 一致 / any 匹配 0）；打 tag `v0.1-s0` 并 push；S0-6 章节改为已完成并附实测证据，进度切到 S1-1 |
| 2026-11-23 | S1-1 完成：新增 `src/llm/sse.ts`（`parseSseStream` async generator）+ `tests/sse.test.ts` 13 用例（分块 / UTF-8 截断 / CRLF / 注释 / 多行 data / `[DONE]` / 尾部残留 / BOM / 空 data / AbortError）；typecheck 0、全量 52/52；S1-1 章节改为已完成并附实测证据，进度切到 S1-2 |
| 2026-11-23 | S1-2 完成：新增 `src/llm/openai.ts`（fetch + `parseSseStream` + text delta + `tool_calls` 按 index 聚合 + `AbortSignal` + 401 脱敏/坏 JSON/无 body 错误映射）+ `tests/openai.test.ts` 13 用例（聚合分片/乱序/空 delta/首次 id-name/缺 id 占位、`toApiMessages`、文本流 + 请求体断言、tool_calls 流式、401、AbortError、坏 JSON、无 body）；typecheck 0、全量 65/65；S1-2 章节改为已完成（真实 API 三行留 S1-4/S1-5），进度切到 S1-3 |
| 2026-11-23 | S1-3 完成：新增 `src/agent/prompt.ts`（`SYSTEM_PROMPT_VERSION` / `buildSystemPrompt` / `withSystemPrompt`）与 `src/agent/messages.ts`（`toApiMessages` 自 `openai.ts` 迁入 + `toAssistantMessage`）；新增 `tests/messages.test.ts` 6 用例 + `tests/prompt.test.ts` 6 用例（全量 77/77）；S1-3 章节改为已完成（真实请求/请求体日志留 S1-5），进度切到 S1-4 |
| 2026-11-23 | S1-4 实现完成：新增 `src/ui/App.tsx`（Static 历史 + 50ms 节流动态区 + 输入框 + 错误行 + 排队 + Esc/Ctrl+C）、`src/ui/throttle.ts`、`src/ui/HistoryItem.tsx`、`src/ui/start-tui.tsx`、`src/ui/width.ts`，`src/index.ts` 交互分支接 TUI（mock 走两轮剧本、真实走 OpenAI 客户端）；新增 `tests/ui.test.ts` 6 用例（宽字符/节流/历史渲染）；typecheck 0、build 0、全量 83/83、假终端 TUI 冒烟 SMOKE OK；S1-4 章节标注"8 条 B 级手工项待用户验收"，进度切到 S1-5 |
| 2026-11-23 | S2-3 完成：新增 `src/tools/fs.ts`（`read_file` 行号/offset/limit/30KB 截断 + CRLF 标注；`write_file` 自动建父目录、空文件；`edit_file` 唯一性 + `replace_all` + CRLF 兼容 + ±3 行上下文；失败统一 `Error:` + 下一步）+ `tests/fs.test.ts` 14 用例（全量 141/141）；S2-3 章节改为已完成并附证据，进度切到 S2-4 |
| 2026-11-23 | S2-3 补丁：`read_file` 字节截断时续读 offset 改为按实际渲染行数（不跳行），`tests/fs.test.ts` 增 1 例（全量 142/142）；用户实测 #6（CRLF 保真）/#7（大文件截断）通过，S2-3 第 6/7 行结果更新并加 B 级段 |
| 2026-11-23 | S2-4 完成：新增 `src/tools/search.ts`（`glob` 星号/双星/问号/字符类 + 200 条与 30KB 截断；`grep` 正则逐行 + 100 条上限，跳过 .git/node_modules/二进制/5MB）+ `tests/search.test.ts` 11 用例（全量 153/153）；S2-4 章节改为已完成并附证据，进度切到 S2-5 |
| 2026-11-24 | S2-5 完成：新增 `src/tools/bash.ts`（`resolveShell`：`MEWCODE_SHELL` > Git Bash > cmd；cmd 用 `/d /s /c` + `chcp 65001` + `windowsVerbatimArguments`；超时 kill + 500ms 兜底；30KB UTF-8 安全截断；UTF-8→GBK 回退；cwd 固定工作区）+ `tests/bash.test.ts` 14 用例（全量 167/167）；S2-5 章节改为已完成并附证据，进度切到 S2-6 |
| 2026-11-24 | S2-6 完成：新增 `src/agent/loop.ts`（`runAgent`：`AgentEvent` 事件流、多轮工具、`maxSteps=30`、`turn_end` 原因、Gate 预留；`max_steps`/`aborted` 以事件+返回值收敛）+ `src/tools/index.ts`（`createDefaultRegistry` 6 工具）+ `tests/loop.test.ts` 19 用例（全量 186/186）；S2-6 章节改为已完成并附证据，进度切到 S2-7 |
| 2026-11-24 | S2-7 完成：`src/ui/App.tsx` 改为注入 `runTurn` 并消费 `AgentEvent`（`tool_start`/`tool_end` 历史项、`tool_running` 状态行、`turn_end` 提示），新增 `src/ui/tool-display.ts` 纯函数、`tests/tool-display.test.ts` 9 用例（全量 195/195），假 stdin 冒烟 `SMOKE OK`；S2-7 章节改为已完成并附证据，进度切到 S2-8 |
| 2026-11-24 | S2-7 补丁：修复"流式输出时向上滚动导致输出反复叠加"——新增 `src/ui/stream-lines.ts`（完整行立即提交 `<Static>`、未完成尾巴只留最后 ≤800 码点、CRLF `\r` 剥离），`App` 改为按行提交；新增 `tests/stream-lines.test.ts` 9 用例（全量 204/204），冒烟增加"60 行长输出每行只出现一次"断言；文档同步（spec §9 流式渲染、S2-7 小节补丁段、tasks/checklist） |
| 2026-11-24 | S2-8 完成：S2 全量验收通过（typecheck 0 / tests 204/204 / --help 8 参数 / --version 0.1.0 / --mock --print 幂等 / build+dist 一致 / any 0 / TUI 冒烟 SMOKE OK / 6 工具 loop 演示 ALL TOOLS OK / 真实 API exit 0）；真实模型自主 `read_file`+`glob` 读 README 并总结 `README ACCEPTANCE OK`（2 工具 3 步）；S2 全部 B 级手工项用户 2026-11-24 通过；打 tag `v0.1-s2` 并 push；S2-8 章节改为已完成并附证据，进度切到 S3-1 |
| 2026-11-24 | S3-1 完成：新增 `src/safety/danger.ts`（13 类危险命令识别 + `sudo`/`sh`/`powershell` 等包装器剥壳，最多 4 层）与 `src/safety/permissions.ts`（`createPermissionGate` 权限三道闸：路径边界 → readOnly → 危险命令 → 会话白名单 → `ask` y/a/n；headless 只读；拒绝原因回填 `Error: 权限被拒绝：…`）；`src/index.ts` 交互分支接 gate、`runRealHeadless` 升级为 Agent Loop + 只读工具；新增 `tests/danger.test.ts` 9 例、`tests/permissions.test.ts` 18 例、`tests/config.test.ts` headless 端到端 1 例（全量 232/232）；S3-1 章节改为已完成并附证据，进度切到 S3-2 |
| 2026-11-24 | S3-1 补丁：CI（ubuntu）暴露出 `tests/permissions.test.ts` 写死反斜杠路径在 POSIX 下被当成合法文件名 → 越界读取用例失败；改用 `path.join("..", "secret.txt")` 生成平台正确路径，CI 复绿（232/232） |
| 2026-11-24 | S3-2 完成：新增 `src/ui/approval.ts`（审批桥：挂起 Promise/订阅/单 pending）与 `src/ui/ApprovalPrompt.tsx`（y/a/n/Esc，Esc=拒绝，其它键忽略）；`src/ui/App.tsx` 增 `pendingApproval` 展示态（审批时输入框失焦、App useInput 让位、光标隐藏、状态行提示、动态区渲染审批框），`start-tui`/`index.ts` 透传 controller 给 gate `ask`；新增 `tests/approval.test.ts` 9 例 + 假 stdin 审批冒烟 `APPROVAL SMOKE OK`（全量 241/241）；S3-2 章节改为已完成并附证据，S3-1 的 B 级 5/6/8 行标用户已验，进度切到 S3-3 |
| 2026-11-24 | S3-3 完成：新增 `src/session/store.ts`（`<workspace>/.mewcode/session.json`：原子写 tmp→rename、加载校验与损坏降级、`--new` 跳过恢复、只存 user/assistant/tool）+ `tests/session.test.ts` 14 例；`src/index.ts` 交互分支启动加载并注入 `initialMessages`/`restoredMessageCount`/`sessionNotice`，每轮结束 `persistMessages` 落盘（失败仅警告）；`App` 顶部恢复提示 + `tests/config.test.ts` 3 例端到端（恢复/损坏/`--new`）；全量 258/258；S3-3 章节改为已完成并附证据，进度切到 S3-4 |
| 2026-11-24 | S3-4 完成：新增 `src/context/tokens.ts`（CJK 1.1/字、其他 1/4、每条 +8、预算 ×0.7）与 `src/context/compress.ts`（按 user 分轮、system 常驻、最新轮必留、旧轮整轮丢弃、最新轮超预算截断 tool 2000/assistant 4000、去掉开头悬空 tool）；`src/agent/loop.ts` 增 `contextTokens`/`onCompress`（请求前压缩副本、历史保持完整）；`src/index.ts` 读 `MEWCODE_CONTEXT_TOKENS`（默认 128000），`MEWCODE_DEBUG=1` 输出 `[压缩]` 统计；`.env.example`/`--help` 补变量；新增 `tests/compress.test.ts` 17 例 + `tests/loop.test.ts` 2 例（全量 277/277）；S3-4 章节改为已完成并附证据、B 级 2–4 行标待用户，进度切到 S3-5 |
| 2026-11-24 | S3-5 完成：新增脚本化集成 `spikes/.out/s3-5-integration.ts`（4 场景 25 断言：50 轮压缩全部 stop/历史 101 条/maxDropped=41；会话恢复 2→4；审批拒绝后继续；`rm -rf /` 硬拦不询问）→ `INTEGRATION OK`；全量回归 typecheck 0 / 277/277 / `--help` / `--version` / mock 幂等 / build+dist / any 0 / `SMOKE OK`+`APPROVAL SMOKE OK`+`ALL TOOLS OK`；文档更新、打 tag `v0.1-s3` 并 push（CI 277/277）；S3-5 章节改为已完成并附证据，进度切到 S4-1 |
| 2026-11-24 | S4-1 完成：新增 `src/tools/diff.ts`（行级 unified diff：LCS + ±3 行 hunk + maxHunks/maxLines 截断 + 4 位行号列）、`src/errors.ts`（`describeHttpStatus`/`isNetworkFailure`/`describeFailure`/`describeToolFailure`，所有失败带「下一步」）、`src/ui/diff-view.ts`（解析 edit 输出为可着色行 + 渲染裁剪 + `+N −M`）；`edit_file` 输出改 diff 格式（头行 + `--- a/`/`+++ b/`/`@@`/带行号红绿行）；`HistoryItem` 新增 `diff` 条目（红删/绿增/青 hunk/暗 context，最多 80 行）；`App` 的 `tool_end` 成功 edit 追加 diff、失败附「下一步」，catch 统一 `describeFailure`；`formatTurnEndNote` 的 max_steps 带下一步；headless `index.ts` 复用 `errors.ts`；新增 `tests/diff.test.ts` 9 例、`tests/errors.test.ts` 4 例、`tests/diff-view.test.ts` 5 例，更新 ui/fs/tool-display 断言（全量 **296/296**，26 个测试文件）；S4-1 章节改为已完成并附证据、B 级 3 条已由用户 2026-11-24 实测通过，进度切到 S4-2 |
| 2026-11-24 | S4-2 完成：重写 README.md（特性/环境要求/安装/配置/快速开始/命令与参数/架构图+数据流/目录结构/6 工具表/3 步加工具教程/权限与安全/会话与压缩/错误展示/测试与 CI/Windows 注意/已知限制与 Roadmap/文档索引）；src/config.ts 的 --help banner 由「S0-3 骨架」改为「（v0.1）」、MEWCODE_SHELL 说明改「默认 Git Bash，其次 cmd.exe」；A 级：克隆到临时目录仅照 README 跑通 npm install（52 包/4s）→ typecheck 0 → tests 296/296 → --mock 0 → build 0 → dist 0，--help 显示 v0.1；B 级 3 条待用户，进度切到 S4-3 |
| 2026-11-24 | S4-3 完成：`package.json` 增 `bin.mewagent`/`prepack`/`files`，入口加 shebang 且直跑判断改用 realpath（修 junction 下静默退出）；`npm link` 后任意目录可用、`npx .` 可运行、含空格+中文路径正常、`npm unlink -g` 无残留、`npm pack` 产物 77 项/230KB；`tests/packaging.test.ts` 5 例、全量 303/303；B 级 4 条待用户，进度切到 S4-4 |
