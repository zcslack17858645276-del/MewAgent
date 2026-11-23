# CLAUDE.md — Claude / AI 代理入口

本仓库对所有 AI 编码代理的统一规则在 **[`AGENTS.md`](AGENTS.md)**。
Claude（Claude Code / 其他接入方式）请**先完整阅读 `AGENTS.md`**，再按下面的最短路径开工；本文件只做入口索引，不重复规则。

## 开工三步

1. 读 `HANDOFF.md`：已定决策、Git 流程、红线、当前状态与会话交接（新会话第一件事）。
2. 读 `docs/tasks.md`：唯一任务看板，**一次只认领一个 task**；再读 `docs/testing.md` 里该 task 的测试小节。
3. 需要架构/模块细节时读 `MewCode-TS实施方案.md`（§3 架构与契约、§4 阶段任务、§6 关键模块）。

## 必须记住的红线（摘自 AGENTS.md §7）

- 不提交 `.env`、密钥、`node_modules/`、`spikes/.out/`、`dist/`。
- 不跳过 `npm run typecheck` 与 `npm test`；不在 `main` 上直接开发（文档/一行配置除外）。
- 一次只做一阶段一 task；不顺手重构未要求的部分。
- `src/types.ts` 是唯一契约；改契约先改方案 §3.3 + `docs/spec.md`，并在 `HANDOFF.md` §7 说明原因。
- 本机策略层（cc-safety-net）会拦截：读写 `.env`、工作区外递归删除、`git push --delete`、`git branch -D`——被拦截时**不要绕过**，交给用户手动执行。

## 当前状态

见 `HANDOFF.md` §6 与 `docs/tasks.md` 顶部「当前焦点」；阶段交付顺序见 `docs/spec.md` §13。
