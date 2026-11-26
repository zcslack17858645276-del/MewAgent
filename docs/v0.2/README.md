# MewAgent v0.2 文档

> v0.2 目标：把 v0.1 的"能跑通闭环"推进到"能日常用、能安装给别人用、能接外部工具"。
> 当前状态：**计划完成，开发未开始**（2026-11-26）。基线 `v0.1.0` / 冻结锚点 `v0.1.0-final`。

## 一句话范围

五件事：**LLM 摘要压缩**、**多会话管理（`--resume`）**、**Slash 命令**、**MCP 工具接入（stdio）**、**npm 发布**。
不做：多模型路由、SubAgent、Skill/Hook、Agent Teams、Worktree、桌面 GUI、远程 MCP、多模态。
（详见 [plan.md](./plan.md) §3–§4；v0.2 开发按单模型执行，见 [playbook.md](./playbook.md) §0。）

## 文档地图

| 文件 | 用途 | 什么时候读 |
|---|---|---|
| [plan.md](./plan.md) | 为什么做、做什么、架构影响、关键决策、风险、成功标准 | 开工前、需要决策时 |
| [tasks.md](./tasks.md) | 27 个 task 的唯一状态看板（含估时/依赖/验收） | 每次开工、每天收尾 |
| [testing.md](./testing.md) | 每个 task 的 A/B 级测试步骤 + 阶段回归 + 人工测试清单 | 写完代码、验收、打 tag 前 |
| [playbook.md](./playbook.md) | 单模型单人的执行规则：开工/分支/提交/DoD/提示词/停止条件/回滚 | 每个新会话开始 |
| [checklist.md](./checklist.md) | v0.2.0 发布前 37 项验收门 | 阶段收尾、发布前 |

## 建议阅读顺序

1. **第一次接触**：本文件 → plan §1 一页结论 → plan §3 范围 → tasks 的 V2-0 一节。
2. **准备开工**：playbook §2–§4 → testing §1–§2 → 对应 task 的 testing 章节。
3. **阶段收尾**：testing §4 → tasks 状态 → checklist 对应条目 → HANDOFF §7 回填。

## 阶段与 tag

| 阶段 | 内容 | tag |
|---|---|---|
| V2-0 | 基线、ADR、压缩验收剧本 | — |
| V2-1 | LLM 摘要压缩 | `v0.2-s1` |
| V2-2 | 多会话管理 | `v0.2-s2` |
| V2-3 | Slash 命令 | `v0.2-s3` |
| V2-4 | MCP 工具接入 | `v0.2-s4` |
| V2-5 | npm 发布与收尾 | `v0.2.0` |

## 与 v0.1 文档的关系

- v0.1 的 [../spec.md](../spec.md)、[../testing.md](../testing.md)、[../tasks.md](../tasks.md)、[../checklist.md](../checklist.md) **不修改**，作为历史与回归依据。
- v0.2 只写"新增/变化"；回归时 v0.1 的 330 例必须继续全绿。
- 工程红线、Git 工作流、`.env` 配置沿用 [../../HANDOFF.md](../../HANDOFF.md) 与 [../../AGENTS.md](../../AGENTS.md)。

## 关键前提（开工前确认）

- Node ≥ 22；本机 Node 26 可开发，CI 固定 22。
- 代理 `http://127.0.0.1:7890` 可用（MCP 真实 server 的 `npx` 下载、npm 发布需要）。
- `mewagent` 包名 2026-11-26 查询为未注册（404）；发布前再确认一次。
- license 当前是 `UNLICENSED`，发布前需拍板（建议 MIT）。
- MCP SDK 计划精确使用 `@modelcontextprotocol/sdk@1.32.2`（engines ≥18；体积与许可在 V2-4-1 记录）。

## 更新约定

- 范围/决策变化 → 改 plan.md，并在 §12 变更记录加一行；不要只改 tasks。
- task 状态变化 → 只改 tasks.md（状态 + 证据），不要另起看板。
- 验收步骤变化 → 同步改 testing.md；否则下次验收会按旧步骤跑。
- 发布门槛变化 → 同步改 checklist.md。
