# MewAgent v0.2 测试手册

> 配套 [tasks.md](./tasks.md)：**每个 task 在 §3 都有一节**。
> 定位：AI 自测覆盖"代码层"；交互、中文 IME、真实模型、真实 MCP server、npm 发布、破坏性操作必须人验。
> v0.1 的 [../testing.md](../testing.md) 仍然有效（内置 6 工具、权限、压缩规则、会话 v1）；本文件只写 v0.2 新增/变化部分，回归时两份都要看。

---

## 0. 测试分级与分工

| 级别 | 谁跑 | 含义 | 证据形式 |
|---|---|---|---|
| **A 自动化** | AI 跑 | 单测/集成测试/脚本，退出码 0 或断言通过 | 命令 + 结果摘要（pass/fail 数） |
| **B 手工** | 只能用户跑 | TUI 交互、真实 API、真实 MCP server、npm 登录/发布 | 截图/录屏/文字记录 + 时间 |
| **C 回归** | AI 先跑，用户抽查 | 阶段末全量回归 | `npm test` 全绿 + 关键 B 项 |

优先级：P0 阻塞发布；P1 影响体验但可带缺陷发布（需记录）；P2 边角问题。

判定原则：

- 任何 A 级失败 = 该 task 不算完成。
- B 级 P0 未做 = 不能打阶段 tag。
- 测试失败先写复现步骤，再修；修完补一条回归用例，避免同类问题再犯。

---

## 1. 用户 5 分钟起步（每个新会话先跑）

```powershell
cd D:\workplace\AIAgent\MewCode
git pull
node -v                      # 需要 >= 22
npm install
npm run typecheck
npm test
npm run build
```

预期：typecheck/build 退出码 0；测试数随阶段增长（v0.2 完成时 ≥420，0 fail，1 skip 可接受）。
离线冒烟（不需要 key）：

```powershell
npm run dev -- --mock --print "你好"
```

真实模型冒烟（需要 `.env` 或用户级配置）：

```powershell
npm run dev -- --print "用一句话说明当前目录"
```

---

## 2. 测试环境与数据

### 2.1 环境基线

| 项 | 值 |
|---|---|
| 系统 | Windows 11（本机）；CI 为 Ubuntu + Node 22 |
| 终端 | Windows Terminal；PowerShell 5.1 可用，pwsh 7 未装 |
| Node/npm | Node 26.7.0 / npm 12.0.2（CI Node 22） |
| 代理 | `http://127.0.0.1:7890`（Clash）；github 需代理，registry.npmmirror.com 直连 |
| 配置 | `.env`：`MEWCODE_API_KEY` / `MEWCODE_BASE_URL` / `MEWCODE_MODEL` |
| 测试沙盒 | `D:\workplace\AIAgent\mewagent-testbed-v2`（v0.2 新目录，避免污染 v0.1 数据） |

### 2.2 v0.2 新增环境变量

| 变量 | 用途 | 示例 |
|---|---|---|
| `MEWCODE_CONTEXT_TOKENS` | 调小上下文窗口，便于观察摘要压缩 | `2000` |
| `MEWCODE_MCP` | `0` 关闭 MCP；默认开 | `0` |
| `MEWCODE_DEBUG` | 打印压缩统计/请求体（不含 key） | `1` |
| `MEWCODE_HOME` | 隔离用户级配置/测试 | `D:\...\tmp-home` |

### 2.3 测试数据脚本

```powershell
$root = 'D:\workplace\AIAgent\mewagent-testbed-v2'
New-Item -ItemType Directory -Force $root | Out-Null
Set-Content -Path "$root\sample.txt" -Value "hello v0.2" -Encoding UTF8
Set-Content -Path "$root\中文-测试.txt" -Value "第一行`n第二行" -Encoding UTF8
# 60 轮剧本：按 tests/fixtures/long-conversation.md 逐条粘贴，或写脚本从文件读入
# 多会话：先在同一目录跑三次 --new，每次聊 2 轮不同主题
```

MCP 测试用 fixture（仓库内，不联网）：

```powershell
node tests/fixtures/mcp-echo-server.mjs   # 手工启动，stdin/stdout JSON-RPC；Ctrl+C 退出
```

真实 server（B 级，需要 npx 下载）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\workplace\\AIAgent\\mewagent-testbed-v2"]
    }
  }
}
```

写入 `<workspace>\.mewcode\mcp.json`；Windows 下命令解析失败时先确认 `npx` 在 PATH。

### 2.4 费用控制

- 摘要压缩只在超预算时触发；测试时设 `MEWCODE_CONTEXT_TOKENS=2000` 可快速触发。
- 真实 API 冒烟一次只问一句话；长剧本用 mock LLM 先验流程。
- 记录每次 B 级真实调用的大致 token/费用到 §5 模板。

---

## 3. 每个 task 的测试明细

> 每节：级别 + 类型 + 步骤 + 预期。命令默认在仓库根执行。

### V2-0-1 基线核对

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `git tag --list "v0.1.0*"`；`git rev-parse --short 'v0.1.0-final^{commit}'` | 有 `v0.1.0`/`v0.1.0-final`；输出 `8bd74fb` |
| P0 A | `npm test` | 330 例，329 pass + 1 skip，0 fail |
| P1 A | `git status --short` | 空 |

### V2-0-2 ADR-0001

| 级别 | 步骤 | 预期 |
|---|---|---|
| P1 A | 检查 `docs/adr/0001-dependency-policy.md` 存在 | 含版本/许可/体积/移除成本/结论 |
| P2 A | 文档内链接可点 | 无死链 |

### V2-0-3 压缩验收剧本

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | 阅读 `tests/fixtures/long-conversation.md` | 60 轮、8–10 条关键事实、含否决方案与文件名 |
| P1 B | 用 mock 跑一遍剧本（见 V2-1-5） | 流程能走通，不依赖真实 API |

### V2-1-1 摘要器

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/context-summarize.test.ts` | 全绿；覆盖正常/空摘要/超长/抛错/超时 |
| P1 A | 摘要长度断言 | 超过 `SUMMARY_MAX_CHARS` 被截断并加标记 |
| P1 A | 摘要结构断言 | 含目标/约束/决策/文件/待办五个小节 |

### V2-1-2 摘要压缩策略

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/context-compress-summary.test.ts` | 保留最近 2 轮；预算 70%；旧轮被摘要 |
| P0 A | 注入摘要器抛错 | 回退 `strategy:"drop"`，消息仍可发 |
| P1 A | 统计字段 | `summarizedTurns`/`summaryChars`/`before/afterTokens` 合理 |
| P1 B | `MEWCODE_CONTEXT_TOKENS=2000 npm run dev -- --mock` 聊 10 轮 | 终端出现压缩统计（需 `MEWCODE_DEBUG=1`），无崩溃 |

### V2-1-3 Loop 注入异步压缩

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/agent-loop-compress.test.ts` | 压缩函数被 await；失败不中断；abort 传播 |
| P0 A | 压缩期间触发 Esc/abort | 请求取消、错误可读、消息配对完整 |
| P1 A | 未注入 `compress` | 行为与 v0.1 一致（规则压缩） |

### V2-1-4 摘要落盘与重启

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/session-store-v2.test.ts`（摘要部分） | v1 迁移后 `summary` 可读；重启复用；不重复摘要 |
| P0 A | 构造损坏的 v1 `session.json` | 降级提示，不覆盖源文件（保留 `.bak`） |
| P1 B | 真实对话 10+ 轮后退出、重启 | 恢复会话且摘要仍在，不重复调用摘要（`MEWCODE_DEBUG=1` 观察） |

### V2-1-5 阶段验收 + tag

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | 用 60 轮剧本跑完后问 5 个关键事实 | 至少 4/5 答对（目标、否决方案、权限顺序、文件名、待办） |
| P1 B | 记录摘要调用次数/耗时 | 单轮压缩延迟可接受（<15s），次数不随轮数线性上涨 |
| P1 A | `git tag v0.2-s1` 前跑 §4 回归 | 全绿；HANDOFF §7 已回填 |

### V2-2-1 会话存储 v2

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/session-store-v2.test.ts` | 创建/列出/读取最新/按 id 读取/标题/原子写 |
| P0 A | 删除 `index.json` 后启动 | 扫描重建，会话不丢 |
| P0 A | 旧 `session.json` 迁移 | 消息完整；源文件改名 `.bak`；重复启动不重复迁移 |

### V2-2-2 CLI 参数

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/config-resume.test.ts` | `--resume`/`--resume id`/`--list`/`--new` 解析正确；冲突报错 |
| P0 A | `npm run dev -- --list`（非 TTY） | 输出会话表，退出码 0，不启动 TUI |
| P1 A | `npm run dev -- --resume bad-id` | 错误可读（含下一步），退出码非 0 |

### V2-2-3 启动选择器

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | 造 3 个会话后运行 `npm run dev -- --resume` | 显示最近 10 条；↑↓ 移动；Enter 进入；Esc 取消 |
| P1 B | 空工作区运行 `--resume` | 提示无会话并直接进新会话，不崩溃 |
| P2 B | 会话超过 10 条 | 只显示 10 条且最新的在最上 |

### V2-2-4 会话生命周期

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | 会话 A 聊 2 轮 → `/clear` → 聊 1 轮 → 重启 | A 文件仍在；新会话独立；重启默认进入最新会话 |
| P0 A | 保存失败（只读目录） | 警告可读，UI 不崩 |
| P1 B | 损坏某个会话文件后 `--resume` | 该条标记损坏，可跳过 |

### V2-2-5 阶段验收 + tag

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | 同工作区 3 个不同主题会话，重启逐一恢复 | 内容不串、标题正确 |
| P0 A | v1 数据迁移演练（备份后） | 迁移后原会话可恢复 |
| P1 A | §4 回归 | 全绿；HANDOFF §7 回填 |

### V2-3-1 解析器与帮助文本

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/ui-commands.test.ts` | `/help` `/clear` `/model` `/model x`；未知命令；空 `/`；多空格 |
| P1 A | 中文/emoji 前的 `/` | 只有整行以 `/` 开头才算命令 |
| P1 A | 帮助文本 | 含三条命令 + Esc/Ctrl+C/Shift+Enter |

### V2-3-2 执行器与模型控制器

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | 单测：`/help` 返回文本；`/clear` 调用新会话；`/model` 无参显示当前 | 通过；不产生 LLM 调用 |
| P0 A | `/model <name>` | 控制器收到新模型；LlmClient 重建；会话 model 更新 |
| P1 B | `/model` 切换后真实问一句 | 请求使用新模型（debug 请求体可见） |

### V2-3-3 App 接线与忙碌保护

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | TUI 输入 `/help`、`/clear`、`/model` | 提示进历史区；不发给模型；不崩溃 |
| P0 B | 生成中执行 `/clear` | 明确拒绝并说明（Esc 中断后再试） |
| P1 B | 中文 IME 状态下输入 `/` | 能正常输入并回显；候选框不遮挡输入行 |
| P2 B | 输入 `/unknown` | 提示未知命令，不产生请求 |

### V2-3-4 阶段验收 + tag

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | 三条命令 + 未知命令全流程 | 符合 §3.3 验收 |
| P0 A | 回归 + tag 前检查 | 全绿；HANDOFF §7 回填 |

### V2-4-1 依赖与配置

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/mcp-config.test.ts` | 合法配置通过；缺 command/args 非数组/env 非对象报错清晰 |
| P0 A | `MEWCODE_MCP=0` | 不连接任何 server；本地工具正常 |
| P1 A | `npm ls @modelcontextprotocol/sdk` 与 `npm pack --dry-run` | 版本 1.32.2；体积有记录 |

### V2-4-2 客户端管理

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/mcp-client.test.ts` | 连接 fixture、list、call echo、close 全通过 |
| P0 A | fixture 启动即退出/超时 | 该 server 标记 failed，其它不受影响 |
| P1 A | 调用超时 | 60s 内返回错误，不挂死 |

### V2-4-3 工具适配器

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `node --import tsx --test tests/mcp-adapter.test.ts` | 命名 `mcp__<server>__<tool>`；冲突/非法字符处理；schema 映射 |
| P0 A | 结果含 text/image/error | text 拼接；image 占位；`isError` → `ok:false` |
| P1 A | 超大输出 | 截断到 30KB 并加标记 |

### V2-4-4 权限与 UI

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | 集成：MCP 工具调用触发 gate | 默认 ask；headless 拒绝；`trustReadOnly` 默认关 |
| P1 B | 接真实 filesystem server，让模型读一个文件 | 审批出现，允许后成功，结果显示来源 server |
| P1 B | 启动时某 server 坏配置 | banner/状态可见；本地 6 工具仍可用 |

### V2-4-5 阶段验收 + tag

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | @modelcontextprotocol/server-filesystem 真实验收 | 列出工具 ≥1；成功调用一次；结果可读 |
| P0 B | 杀 server 进程后继续用本地工具 | 本地工具不受影响；有错误提示 |
| P0 B | 退出 CLI 后 `Get-Process node`（对比前后） | 没有新增孤儿进程 |
| P1 A | 回归 + tag 前检查 | 全绿；HANDOFF §7 回填 |

### V2-5-1 发布配置

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `npm pack --dry-run` | 只含预期文件；无 `.env`/`node_modules`/测试临时文件；体积记录 |
| P0 A | 检查 `package.json` | `private:false`、license、files、prepublishOnly、version 0.2.0 |
| P1 A | 模拟打包后解压检查 `dist/index.js` | shebang 存在，可执行 |

### V2-5-2 文档更新

| 级别 | 步骤 | 预期 |
|---|---|---|
| P1 A | 链接检查（README/HANDOFF/docs 索引） | 无死链 |
| P0 B | 只照 README 从零安装一次 | 能跑通 `npx` 与配置 |

### V2-5-3 安装验证

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | 临时目录 `npm i <tarball>` → `npx mewagent --mock --print "你好"` | 输出正常，退出码 0 |
| P0 B | Windows + Node 22 机器上重复 | 成功；无 PowerShell 编码错误 |
| P1 A | `npm link` 后任意目录 `mewagent --version` | 正常 |

### V2-5-4 发布执行

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 B | `npm whoami` → `npm publish`（2FA） | 发布成功；`npm view mewagent version`=0.2.0 |
| P0 B | 干净目录 `npx mewagent@0.2.0 --mock --print "你好"` | 成功 |
| P1 B | GitHub Release + tag 推送 | tag 指向发布提交；Release 说明完整 |

### V2-5-5 最终验收

| 级别 | 步骤 | 预期 |
|---|---|---|
| P0 A | `npm run typecheck && npm test && npm run build` | 全 0；测试 ≥420 |
| P0 A | 对照 [checklist.md](./checklist.md) | 12 条全部有证据 |
| P0 B | 3 分钟演示：新建会话 → 摘要压缩 → MCP 工具 → `/model` → 退出恢复 | 全流程可用 |

---

## 4. 阶段回归清单（打 tag 前必跑）

| 阶段 | 必跑 A 级 | 必做 B 级 |
|---|---|---|
| v0.2-s1 | 全量测试；压缩相关测试；v0.1 回归 | 60 轮剧本、重启复用摘要 |
| v0.2-s2 | 全量测试；session v2 测试；迁移测试 | 3 会话切换、--resume 选择器、重启恢复 |
| v0.2-s3 | 全量测试；commands 测试 | 三条 slash、中文 IME、忙碌拒绝 |
| v0.2-s4 | 全量测试；MCP 集成测试 | 真实 filesystem server、杀进程、孤儿检查 |
| v0.2.0 | 全量测试 + build + pack | npm 安装、npx、3 分钟演示、回滚演练 |

---

## 5. 记录模板

```markdown
## 验收记录：V2-x-y
- 时间：
- 环境：Windows 11 / Node x / 模型：
- A 级：命令 → 结果（pass/fail 数，0 fail）
- B 级：步骤 → 现象 → 截图/录屏路径
- 费用：摘要调用 N 次 / 真实 API M 次 / 估算 token
- 结论：通过 / 带缺陷通过（缺陷号）/ 不通过
```

缺陷模板：

```markdown
## 缺陷：<一句话>
- 复现步骤：
- 预期：
- 实际：
- 影响级别：P0/P1/P2
- 根因/修复：
- 回归用例：tests/xxx.test.ts:NN
```

给 AI 的自测报告提示词：

```text
按 docs/v0.2/testing.md 的 V2-x-y 一节跑 A 级测试，贴完整命令与输出摘要；
不要只写“通过”。失败项给出复现步骤、怀疑根因、下一步。B 级项不要冒充已跑，列出来等我做。
```

---

## 6. 常见问题

| 现象 | 先查 |
|---|---|
| `npm test` 找不到新测试 | 文件是否在 `tests/*.test.ts`；`node --import tsx --test` 路径是否正确 |
| 摘要从不触发 | `MEWCODE_CONTEXT_TOKENS` 是否设得太小/太大；debug 是否开 |
| 摘要每轮都调用 | 摘要是否落盘；`summary` 字段是否被保存；保留窗口是否足够 |
| `--resume` 没反应 | 是否 TTY；`--list` 是否正常；`.mewcode/sessions/index.json` 是否可读 |
| `/model` 切换后仍用旧模型 | LlmClient 是否重建；请求体 debug 是否看到新 model |
| MCP 工具不出现 | `mcp.json` 路径/格式；`MEWCODE_MCP=0` 是否误设；server 命令是否在 PATH |
| MCP 调用超时 | server 是否真的实现了 `tools/call`；Windows 下 `npx` 是否可用 |
| `npm publish` 403/OTP | 登录状态、2FA、包名是否被占、是否在 72h 内重复发布 |
| 迁移后会话没了 | 先看 `.mewcode/session.json.bak` 是否存在；不要删源文件 |

---

## 7. AI 不能替代的测试（重点）

1. 中文 IME 下输入 `/`、候选框位置、退格。
2. 真实模型下的摘要质量（语义是否被曲解）。
3. 真实 MCP server 的权限弹窗与结果可读性。
4. npm 登录、2FA、发布、`npx` 真实下载。
5. 长对话（60 轮）的体感与延迟。
6. 破坏性操作：迁移、删除会话、回滚到 v0.1。
7. Windows 终端下的颜色/换行/滚动。
8. 费用是否可接受（真实 token 账单）。

---

## 附录 A：测试数据脚本

```powershell
# 建 v0.2 沙盒
$root = 'D:\workplace\AIAgent\mewagent-testbed-v2'
New-Item -ItemType Directory -Force $root | Out-Null
Set-Content "$root\sample.txt" 'hello v0.2' -Encoding UTF8
Set-Content "$root\中文-测试.txt" "第一行`n第二行" -Encoding UTF8

# 多会话：在沙盒目录跑三次
# npm run dev -- --new   （每次聊不同主题，2 轮即可）

# 触发压缩
$env:MEWCODE_CONTEXT_TOKENS='2000'; $env:MEWCODE_DEBUG='1'
npm run dev -- --mock

# 安装验证
$tmp = Join-Path $env:TEMP 'mewagent-v2-install'
New-Item -ItemType Directory -Force $tmp | Out-Null
npm pack --pack-destination $tmp
cd $tmp
npm init -y | Out-Null
npm i .\mewagent-0.2.0.tgz
npx mewagent --mock --print "你好"
```

## 附录 B：MCP fixture 约定

- 文件：`tests/fixtures/mcp-echo-server.mjs`（V2-4-2 实现）。
- 传输：stdio，逐行 JSON-RPC；实现 `initialize`、`tools/list`、`tools/call`。
- 工具：`echo`（返回输入 text）、`fail`（`isError:true`）、`slow`（用于超时）、`big`（>30KB 输出）。
- 失败模式：环境变量 `MCP_FIXTURE_MODE=crash|hang` 控制启动即退出/不响应。
- 测试通过 `command: process.execPath`、`args: [fixture 路径]` 启动，不依赖 npx/网络。

## 附录 C：任务 → 测试文件矩阵

| task | 主要测试文件 |
|---|---|
| V2-0-1 | 手工命令（见 §3） |
| V2-1-1/2 | `tests/context-summarize.test.ts`、`tests/context-compress-summary.test.ts` |
| V2-1-3 | `tests/agent-loop-compress.test.ts` |
| V2-1-4/2-1 | `tests/session-store-v2.test.ts` |
| V2-2-2 | `tests/config-resume.test.ts` |
| V2-2-3/4 | 手工 + `tests/session-picker.test.ts`（纯逻辑） |
| V2-3-1/2 | `tests/ui-commands.test.ts` |
| V2-4-1 | `tests/mcp-config.test.ts` |
| V2-4-2 | `tests/mcp-client.test.ts`（fixture 集成） |
| V2-4-3 | `tests/mcp-adapter.test.ts` |
| V2-4-4 | `tests/mcp-permissions.test.ts` |
| V2-5-1/3 | `npm pack --dry-run` + 临时目录脚本（§附录 A） |

## 附录 D：更新记录

| 日期 | 变更 |
|---|---|
| 2026-11-26 | 初稿，覆盖 27 个 task |
