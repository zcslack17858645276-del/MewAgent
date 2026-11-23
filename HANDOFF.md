# MewAgent 会话交接文档（HANDOFF）

> **每个新会话的第一件事**：读本文件。
> **每个会话结束前**：更新 §7 交接记录，并同步 `docs/tasks.md` 的任务状态。
> 最后更新：2026-11-23 ｜ 当前阶段：S0-1 已完成（IME 判定 A）｜ 下一任务：S0-2

---

## 1. 30 秒看懂

- **项目**：MewAgent —— 类 Claude Code 的 CLI Coding Agent（个人精简版）。目标是能日常用来读代码、改代码、跑命令。
- **仓库**：<https://github.com/zcslack17858645276-del/MewAgent>（私有，默认分支 `main`）
- **本地工作区**：`D:\workplace\AIAgent\MewCode`（目录名仍是 MewCode，仓库名是 MewAgent，暂不强行统一）
- **默认技术栈**：TypeScript + Node ≥22 + Ink 8 + React 19；原生 `fetch` 手写 SSE；6 个工具；单 Agent Loop。v0.1 不做 MCP / SubAgent / GUI。
- **当前状态**：需求、选型、方案、任务板都已就绪；**还没有一行业务代码**，仓库里目前只有文档和 README。
- **下一步**：按 `docs/tasks.md` 做 S0-1（初始化工程），然后 S0-2 → S0-3 → … → S4。

---

## 2. 新会话启动清单（固定动作，约 5 分钟）

1. 读本文件，尤其 §4（已定决策）、§5（Git 工作流）、§7（上次交接）。
2. 读 `MewCode-TS实施方案.md` 的 §3（核心契约）和 §4 中本次阶段。
3. 打开 `docs/tasks.md`，认领本次 task（`todo` → `doing`）；同时读 `docs/testing.md` 中该 task 的测试小节，完成前按它跑自动化和人工验收。
4. 终端确认环境：

   ```powershell
   Set-Location D:\workplace\AIAgent\MewCode
   git pull
   git status
   git log --oneline -5
   node -v      # 需要 >= 22
   npm -v
   ```

5. 建任务分支（见 §5.1），实现，跑 `npm run typecheck && npm test`，按阶段验收项手动验收。
6. 提交 → 推送 → 合并；更新 `docs/tasks.md` 状态和本文件 §7。

**新会话开场提示词（直接复制给 AI）**：

```text
项目：D:\workplace\AIAgent\MewCode（MewAgent，TypeScript + Ink 的 CLI Coding Agent）。
先读 HANDOFF.md、MewCode-TS实施方案.md 的 §3/§4、docs/tasks.md。
本次会话只做 task <ID>：<一句话描述>。
要求：先给实现计划，不要直接写代码；实现只改相关文件；完成后运行 npm run typecheck 和 npm test，
按方案的阶段验收项自检，最后更新 HANDOFF.md §7 和 docs/tasks.md 状态。
```

---

## 3. 仓库与环境

| 项目 | 值 |
|---|---|
| 仓库 | <https://github.com/zcslack17858645276-del/MewAgent>（私有） |
| 远端 | `origin`，HTTPS；凭据由本机 Git Credential Manager 管理（账号 `zcslack17858645276-del`），不要手动保存 token |
| 分支 | `main` 随时可运行；任务分支见 §5.1 |
| 本地路径 | `D:\workplace\AIAgent\MewCode` |
| 运行时 | Node ≥22、npm、git；推荐 Windows Terminal（本机实测环境见下方） |
| 外网 | 代理 `http://127.0.0.1:7890`；`github.com` 需要代理，`api.github.com` 可直连 |
| 密钥 | 只放 `.env`（已被 `.gitignore` 忽略）；仓库只提交 `.env.example`；任何情况下不把 key 写进代码、文档或提交 |

**本机实测环境（2026-11-23，S0-1 验证）**：Node v26.7.0 / npm 12.0.2 / Windows Terminal 1.25.3131.0；系统只有 Windows PowerShell 5.1（**无 pwsh 7**，未签名 `.ps1` 需 `-ExecutionPolicy Bypass`）；Windows 11 26200，单屏 1920x1080；git 全局 `http(s).proxy=127.0.0.1:7890`，npm 装包需带 `HTTP_PROXY/HTTPS_PROXY` 或改用 npmmirror（npmmirror 可直连）。

**常用命令**（S0-1 起可用；`--mock` 等参数随 S0-3/S0-4 落地）：

```powershell
npm run dev              # tsx 直接跑
npm run dev -- --mock    # 离线 mock，不调真实 API
npm run typecheck
npm test
npm run build
```

---

## 4. 已定决策（不要再讨论；要改必须写清原因并同步本节）

| 类别 | 决策 |
|---|---|
| 技术栈 | TypeScript + Node ≥22 + Ink 8 + React 19；`tsc` 构建、`tsx` 开发、`node:test` 测试 |
| 模型协议 | 只做 OpenAI 兼容的 `chat/completions`；原生 `fetch` + 手写 SSE；不用 LangChain / Vercel AI SDK / 各家 SDK |
| 工具 | v0.1 六个：`read_file` `write_file` `edit_file` `bash` `glob` `grep`；注册表 + JSON Schema + 统一 `{ok,output}` 结果 |
| Agent Loop | 单循环；终止条件 = 本轮模型不再返回 `tool_calls`；`maxSteps=30` |
| 权限 | 三道闸：路径边界 → 危险命令 → 人工确认；只读工具自动放行；拒绝原因回填给模型 |
| 上下文 | 按 `user` 轮次压缩；工具输出单次截断 30KB；system prompt 常驻 |
| 状态 | session JSON 本地持久化（`.mewcode/session.json`）；跨会话 memory v0.1 不做，只留接口 |
| 产品边界 | v0.1 不做 MCP / Skill / Hook / SubAgent / Git Worktree / Agent Teams / 桌面 GUI |

**未定/已定事项**：

1. **产品名（仍未定）**：仓库叫 MewAgent，历史方案文档仍写 MewCode。建议新代码/README 统一用 MewAgent，历史文档不重命名，靠本文件说明；最终以用户拍板为准。
2. **技术栈（已定，2026-11-23）**：✅ 继续 TS + Ink，不转 Go + Bubble Tea。S0-1 的 Ink 中文 IME spike 判定 **A**（中文可正常输入、退格正常，仅候选框位置略偏），满足方案 §9.1「继续 TS」条件；证据见 `spikes/RESULT.md`。Go 方案不再保留（除非后续出现阻断）。
3. **S0 第一件事（已完成）**：✅ Ink 中文 IME spike 已完成，结论见 §7 会话 2。

**补充已定决策（S0-1 新增，勿再讨论）**：

| 类别 | 决策 |
|---|---|
| 包名/版本 | `mewagent` / `0.1.0`（private，`type: module`，engines `node>=22`） |
| 环境变量 | `MEWCODE_API_KEY` / `MEWCODE_BASE_URL` / `MEWCODE_MODEL`（可选 `MEWCODE_SHELL`）；模板见 `.env.example` |
| 输入法 | 中文输入走系统微软拼音（WT 实测可用）；候选框位置略偏属可接受项；S1 起在输入框用 ink 的 `useCursor` 把终端光标放到 caret 位置，改善候选框位置 |

---

## 5. Git 工作流（长期开发、测试、回滚的基础）

### 5.1 分支模型（单人简化版）

- `main`：随时可运行；只接受通过 `typecheck + test` 的合并。
- 每个 task 一个短分支：`task/s0-1-scaffold`、`task/s2-3-fs-tools`；修复用 `fix/...`，纯文档用 `docs/...`。
- 标准流程：

  ```powershell
  git switch -c task/s0-1-scaffold
  # 开发 + 提交（可多次）
  git push -u origin task/s0-1-scaffold
  # 网页开 PR，自己 review diff → Squash and merge → 删除分支
  git switch main
  git pull
  ```

- 只改文档或一行配置，允许直接在 `main` 提交，但仍要求"一次任务一个 commit"。

### 5.2 commit 规范（Conventional Commits 简版）

- 标题：`type(scope): 摘要`，≤ 50 字。type 用 `feat` / `fix` / `test` / `docs` / `chore` / `refactor`。
- 例：`feat(agent): 增加 loop 终止判断`、`fix(tools): edit 多处匹配时报错`、`docs: 更新 HANDOFF`。
- 正文写"为什么"和"验收方式"；一个 task 至少一个 commit，不混入无关改动。

### 5.3 里程碑 tag

每个阶段验收通过后打 tag，作为回滚点：

```powershell
git tag -a v0.1-s0 -m "S0: 骨架与契约"
git push origin v0.1-s0
```

Tag 计划：`v0.1-s0` → `v0.1-s1` → `v0.1-s2` → `v0.1-s3` → `v0.1.0`（S4 完成）。

### 5.4 回滚

- 已推送的提交：`git revert <hash>`（生成反向提交，最安全）。
- 未推送的本地提交：`git reset --hard <hash>`；执行前先 `git stash` 或建备份分支。
- 只回滚单个文件：`git checkout <hash> -- path/to/file`。
- 查看某个历史阶段的代码：`git switch --detach v0.1-s2`（看完 `git switch main` 回来）。
- **禁止** `git push --force` 到 `main`；禁止改写已推送历史。

### 5.5 每次提交前必做

```powershell
npm run typecheck        # 0 错误
npm test                 # 全绿
git diff --stat          # 确认没有意外文件
git status               # 确认没有 .env / node_modules / 密钥
```

### 5.6 文档更新义务

- 每个会话结束：更新本文件 §7 + `docs/tasks.md` 状态。
- 每个 task 完成：按 `docs/testing.md` 对应小节留测试证据（自动命令输出 + 人工验收结论），再改状态为 `done`。
- 每个阶段完成：更新 README 的进度/用法，以及 §4 的未定项。
- 改架构/契约：先改 `MewCode-TS实施方案.md` §3，再改代码。
- 新增依赖：在 commit 正文说明理由，必要时更新 §4。

### 5.7 CI（S0 任务之一）

计划在 S0 添加 `.github/workflows/ci.yml`：push / PR 时执行 `npm ci && npm run typecheck && npm test`。CI 变绿前，PR 只作为 diff 审查手段。

---

## 6. 任务看板

以 [`docs/tasks.md`](docs/tasks.md) 为唯一看板。当前状态：**S0-1 已完成（IME 判定 A），下一任务 S0-2（`types.ts` 契约）**。
阶段划分、交付物、验收标准见 `MewCode-TS实施方案.md` §4。

---

## 7. 会话交接记录

### 2026-11-23 · 会话 1（调研、方案、建仓）

- **做了什么**：开源项目盘点与技术选型；个人版范围与排期；TS + Ink 实施方案（S0–S4、契约、提示词模板）；创建 GitHub 私有仓库并完成首次提交（README 仅标题）；建立本交接文档与任务看板。
- **提交**：`755d7d3`（README）；`d35d7d5`（HANDOFF + 任务板 + 三份方案文档 + research/ + .gitignore）。
- **关键结论**：开源侧 TypeScript 占主导，TUI 正从 Ink/Textual 向 OpenTUI 换代；Claude Code 已改为原生二进制分发；个人首版砍到 P0 8 项；默认 TS + Ink，中文 IME 不可用时转 Go + Bubble Tea。
- **遗留/坑**：① Ink 中文 IME 尚未实测，S0 必须做 spike；② 产品名 MewAgent 与 MewCode 未统一；③ `research/` 中部分事实为社区说法，引用前看每条标注。
- **下次第一步**：S0-1 初始化工程 + IME spike，然后 S0-2 定契约。

### 2026-11-23 · 会话 2（S0-1：工程初始化 + Ink 中文 IME spike）

- **做了什么**：搭 TS 工程骨架（`package.json` / `tsconfig.json` / `tsconfig.build.json` / `.env.example` / `.gitignore` 补 `spikes/.out/` / `src/index.ts` 占位 / `tests/core.test.ts`）；`npm install` 锁定依赖（ink 8.0.0、react 19.3.1、ink-text-input 6.0.0、tsx 4.23.15、typescript 7.0.2）；完成 Ink 8 中文 IME spike（真实 GUI 注入，非模拟）；更新看板与本文件。
- **IME 结论（判定 A → 按方案 §9.1 继续 TS + Ink，不转 Go）**：
  - 环境：Windows Terminal 1.25.3131.0 + 微软拼音；目标窗口 HKL=0x08040804 但 TSF 实际生效微软拼音（默认中文）；**Shift 按一次切英文直通**；无需改系统输入法设置。
  - 中文：`nihao` 组合期 Ink 收不到事件 → 空格选首候选上屏 `你好` → jsonl `change value="你好" len=2` → Enter `submit value="你好"`，无重复字符。
  - 退格：`你好` → `你` → `""`（len 2→1→0），每次精确删 1 个完整汉字，无半字/乱码/错位。
  - ASCII 基线：`a`→`ab`→`abc`→`ab`，Ink/终端/keypress 解析本身正常。
  - 已知限制：preedit + 微软拼音候选条渲染在 Ink 边框盒下方约 3~4 行（不贴 `> ` 光标），但不遮挡、可正常选词/上屏；属 §9.1「候选框位置略偏但可输入」。
  - 证据：`spikes/RESULT.md`（复现步骤 + jsonl 原文 + 截图对照表）；`spikes/.out/`（14 张截图、`ime-log.jsonl`、`summary.json`、`run-ime-spike.log`）；一键复现：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes\run-ime-spike.ps1`。
  - 残余风险（未测，S1/S3 再覆盖）：① 数字键从候选列表选词可能被 Ink 当普通数字输入（Claude Code #57759 同类）；② alternate-screen 全屏 TUI 下 IME 表现可能更差（Claude Code #93281）；③ 真实 TUI 输入框在底部时候选框偏移的观感，可用 ink `useCursor` 把终端光标放到 caret 位置缓解。
- **提交**：分支 `task/s0-1-scaffold` 提交 `a454433`（已 push 到远端）→ squash 合并为 `main` 的 `17d1120` 并 push。gh CLI 未安装，PR 步骤以本地 diff review 代替（远端分支 review 后可删除）。
- **环境坑**：① 本机只有 Windows PowerShell 5.1（**无 pwsh 7**）；② 执行策略 `RemoteSigned`，未签名 `.ps1` 需 `-ExecutionPolicy Bypass`；③ PS 5.1 会把无 BOM 的 UTF-8 `.ps1` 按 GBK 解码，脚本内请只写 ASCII；④ npm 装包需 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890`（npmmirror 可直连）；⑤ `npm test` 的 `tests/*.test.ts` glob 在 Node 26 + npm 下可直接用（npm 原样传给 node，由 node 展开）。
- **下次第一步**：S0-2 `src/types.ts` 定契约（`Message` / `ToolCall` / `ToolResult` / `ToolDefinition` / `LlmClient` / `Gate` / `AgentEvent`），先抄方案 §3.3 原文，禁止 `any` 逃逸。

### 交接模板（每次会话结束复制填写）

```text
### YYYY-MM-DD · 会话 N（<主题>）
- 做了什么：
- 产出/提交：<分支、PR、commit 范围、tag>
- 当前可运行状态：<能跑什么、已知报错>
- 遗留问题/坑：
- 下次第一步：<task ID>
```

---

## 8. 文档索引

| 文件 | 用途 | 什么时候读 |
|---|---|---|
| `HANDOFF.md` | 会话交接、已定决策、Git 流程（本文件） | 每次新会话第一件事 |
| `MewCode-TS实施方案.md` | 施工图纸：契约、S0–S4、提示词、验收 | 开工前 + 每个 task |
| `docs/tasks.md` | 任务看板（ID / 状态 / 验收） | 每次认领任务 |
| `docs/testing.md` | 每个 task 的测试手册（AI 自动化 + 用户手工验收） | task 完成前必读 |
| `MewCode-个人版实施计划.md` | 范围、排期、为什么砍功能 | 想改范围时 |
| `技术选型报告.md` | 开源盘点、跨端与语言对比 | 质疑选型、写简历时 |
| `research/01-oss-survey.md` | 16 个开源项目的技术栈证据 | 查事实来源 |
| `research/02-tui-frameworks.md` | TUI 框架对比与中文 IME 证据 | 选 TUI、遇 IME 问题 |
| `research/03-desktop-frameworks.md` | 桌面 GUI 跨端 vs 原生 | 以后做 GUI |
| `research/04-language-mastery.md` | 语言掌握自评与 spike 验收表 | 想换语言时 |
| `research/BRIEF.md` | 调研口径与事实分级规范 | 引用调研结论时 |

---

## 9. 红线与常见坑

1. 不把 `.env`、密钥、会话日志提交进仓库。
2. 不跳过 `typecheck + test`；不通过不合并。
3. 一次只做一个阶段、一个 task，禁止"顺手把下一阶段也写了"。
4. 契约（`types.ts`）先行；实现阶段要改契约，先停下来说明原因。
5. Windows 中文 IME 是最大不确定性：S0 先实测；不可用按方案 §9.1 转 Go。
6. 工具输出必须截断，否则一次 `cat` 就能把上下文打爆。
7. 每阶段结束打 tag，别等全做完才想起回滚点。
8. 产品名统一前，新代码/README 用 MewAgent，历史文档不混改。

---

## 10. 快速排障

- **push 失败**：确认代理已开；`git config --get credential.helper` 应为 `manager`；必要时重新登录 GitHub（GCM 会弹窗）。
- **中文乱码**：用 Windows Terminal；cmd 下先 `chcp 65001`；代码统一 UTF-8，读命令输出失败再尝试 GBK。
- **测试跑不起来**：确认 `package.json` 的 `test` 脚本（S0 定为 `node --import tsx --test tests/*.test.ts`）。
- **不确定当前状态**：依次看 `git status`、`git log --oneline --graph -10`、本文件 §7。
