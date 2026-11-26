# v0.1.0 冻结与快速回滚手册

> 目标：v0.2 用多模型协同开发时，任何一步失控，都能在 1 分钟内回到可运行的 v0.1.0。
>
> 锚点：tag `v0.1.0-final`（2026-11-26 冻结，含完整 v0.1.0 代码、HF-2/HF-3 安装修复、复盘文档与本手册）；远程分支 `release/v0.1.0` 指向同一提交；原发布 tag `v0.1.0`（tag 对象 `03baaa7`，提交 `3cdf699`）保持不动。
>
> 仓库：<https://github.com/zcslack17858645276-del/MewAgent>

---

## 0. 先确认锚点存在（30 秒）

```powershell
cd D:\workplace\AIAgent\MewCode
git fetch --all --tags --prune
git rev-parse --short v0.1.0-final
git ls-remote --tags origin v0.1.0-final
git ls-remote --heads origin release/v0.1.0
npm test
```

期望：`npm test` 输出 **tests 330 / pass 329 / fail 0 / skipped 1**。

如果 `v0.1.0-final` 不存在，先不要开始 v0.2，见 §8 第 1 条。

---

## 1. 两种回滚方式

### 1.1 用脚本（推荐）

```powershell
# 先预览：只打印将要做什么，不改任何东西
.\scripts\rollback-to-v0.1.0.ps1 -DryRun

# 确认后执行，需要输入 yes
.\scripts\rollback-to-v0.1.0.ps1

# 无人值守（例如多模型流水线里）
.\scripts\rollback-to-v0.1.0.ps1 -Yes
```

脚本按顺序做 6 件事：

1. `git fetch --all --tags --prune`；
2. 解析 `v0.1.0-final`（找不到则回退到 `v0.1.0`）；
3. 把当前 HEAD 建成 `backup/pre-rollback-<时间戳>` 备份分支；
4. 有未提交改动时 `git stash push -u`（含未跟踪文件，不含 `.env`/`node_modules` 这类被忽略文件）；
5. `git reset --hard v0.1.0-final`；
6. `git clean -fd`（**不加 `-x`**，所以 `.env`、`node_modules`、`dist`、`.mewcode` 不会被删）。

它**不会** push、不会 force-push、不会移动或删除 tag。回滚只发生在本地。

### 1.2 手工版（脚本丢了时）

```powershell
git fetch --all --tags --prune
git switch main
git reset --hard v0.1.0-final
git clean -fd
git status -sb
npm test
```

前提：当前改动已提交，或你不需要未提交内容。需要保留就先 `git stash push -u`。

---

## 2. 按场景选命令

| 场景 | 回滚动作 | 说明 |
|---|---|---|
| A. 改动还没提交 | 用脚本；手工先 `git stash push -u` | stash 可恢复，见 §6 |
| B. 提交在 `v0.2/*` 分支，本地 | 用脚本；或 `git switch main`（main 没动就不用 reset） | 坏分支留着或删掉都行 |
| C. 提交在本地 `main`，未 push | 用脚本；手工先 `git branch backup/...` 再 reset | 脚本自动建备份分支 |
| D. 已 push 到 `v0.2/*` 远程分支 | 本地回滚；远程分支可留可删（**由你手动删**） | main 未受影响，零风险 |
| E. 已 push 到 `main` | 见 §2.1，用 `revert` 发布回滚 | 禁止 force-push main |

### 2.1 最坏情况：v0.2 已经 push 到 main

不要 `git reset --hard` 后 `git push --force`（违反本项目红线，GitHub 保护也会拦）。用反向提交：

```powershell
git fetch origin
git switch main
git revert --no-commit v0.1.0-final..origin/main
git commit -m "revert: 回滚 v0.2 未完成改动"
git push origin main
```

如果区间里有 merge commit 导致 revert 冲突，逐个 `git revert -m 1 <merge-hash>`，或从 `release/v0.1.0` 新建分支发 PR 恢复内容（保留历史，不 force）。

---

## 3. 冻结锚点是什么

| 引用 | 指向 | 用途 |
|---|---|---|
| `v0.1.0-final` | 2026-11-26，当前完整 v0.1.0（含 HF-2 一键安装、HF-3 安装修复、审计/复盘文档、本手册） | **v0.2 开发的回滚锚点** |
| `release/v0.1.0` | 与 `v0.1.0-final` 同一提交的远程分支 | 只读对照、clone、发恢复 PR |
| `v0.1.0` | `03baaa7`（tag 对象）→ 提交 `3cdf699`，2026-11-24 发布点 | 历史发布记录，保持不动 |
| `v0.1-s0` … `v0.1-s3` | 各阶段验收提交 | 阶段级回滚/对照 |

为什么不直接回滚到 `v0.1.0`：发布后又合入了 7 个提交，其中 HF-2（`0e10223` 一键安装脚本 + `prepare` 构建）和 HF-3（`08fe3fd` 兼容 `irm | iex` 与全局安装权限回退）是实际使用者会碰到的修复。`v0.1.0-final` = “今天能跑的最完整 v0.1.0”。

---

## 4. v0.2 多模型工作流（把回滚成本压到最低）

核心原则：**main 永远是发布分支，v0.2 永远不直接进 main。**

```
main（= v0.1.0-final，受保护）
  └─ v0.2-dev            集成分支，多模型结果先汇到这里
       ├─ v0.2/<task>-gpt     某个模型/某个任务
       ├─ v0.2/<task>-claude  另一个模型/另一个任务
       └─ v0.2/<task>-glm     ……
```

### 4.1 开工前

```powershell
git switch main
git pull --ff-only
git switch -c v0.2-dev
git push -u origin v0.2-dev
```

### 4.2 每个模型一个 worktree（强烈建议）

同一个仓库可以 checkout 多个目录，互不干扰：

```powershell
# 在仓库根目录执行；..\ 表示与 MewCode 同级
git worktree add -b v0.2/dev-gpt ..\MewAgent-v0.2-gpt v0.2-dev
git worktree add -b v0.2/dev-claude ..\MewAgent-v0.2-claude v0.2-dev
```

注意：

- 每个 worktree 要自己 `npm install`（node_modules 不共享）；
- 同一个分支不能同时被两个 worktree checkout；
- 删除 worktree 前先 commit/stash：`git worktree remove ..\MewAgent-v0.2-gpt`；
- 查看清单：`git worktree list`。

### 4.3 日常节奏

1. 一次只做一个 task，小步 commit；
2. 高风险实验前：`git tag wip/<模型>-<时间>` 或至少 commit 一次；
3. 每天 push 自己的分支（`git push -u origin v0.2/dev-gpt`），远端就是免费备份；
4. 模型分支 → PR → `v0.2-dev`；阶段验收通过后，才把 `v0.2-dev` 合进 main 并打 `v0.2-s1` 之类 tag；
5. 主目录 `D:\workplace\AIAgent\MewCode` 始终留在 main（v0.1.0），随时可运行、可对照。

### 4.4 main 保护（GitHub 手动设置，一次）

GitHub 仓库 → Settings → Branches → Add branch protection rule：

- Branch name pattern：`main`
- 勾选 Require a pull request before merging
- 勾选 Do not allow force pushes
- 勾选 Do not allow deletions

这样即使某个模型失误，也无法把 main 推坏。

---

## 5. 回滚后验证

```powershell
git log -1 --oneline
git status -sb
npm install        # 仅当 package.json 有变化；否则可跳过
npm test           # tests 330 / pass 329 / fail 0 / skipped 1
npm run build
node dist/index.js --version
```

- `.env` 不会被 `git clean -fd` 删除（它是 ignored）。
- 如果 node_modules 与新状态不一致：`npm ci`。
- 如果全局命令 `mewagent` 还是旧版：`npm run build; npm link`，或重跑 `scripts/install.ps1`。

---

## 6. 找回被回滚掉的工作

| 来源 | 命令 | 说明 |
|---|---|---|
| 备份分支 | `git branch --list 'backup/*'`；`git switch backup/pre-rollback-...` | 只含**已提交**内容 |
| stash | `git stash list`；`git stash apply stash@{0}` | 含未提交 + 未跟踪（不含 ignored） |
| reflog | `git reflog`；`git switch -c rescue <hash>` | 默认保留 30 天 |
| 远端分支 | `git ls-remote --heads origin 'v0.2/*'`；`git switch -c v0.2/recover origin/v0.2/dev-gpt` | 只要 push 过就能找回 |

---

## 7. 红线

1. **不要** `git clean -x` / `-xdf`：会删 `.env`、`node_modules`、`dist`。
2. **不要** force-push `main`；**不要**改写已推送历史。
3. **不要**移动或删除 `v0.1.0-final`；需要新锚点就新建 tag（如 `v0.1.0-final-2`）。
4. **不要**在 main 上直接开发 v0.2 功能（文档除外）。
5. **不要**把半成品合进 main；main 必须随时能 `npm test` 全绿。
6. **不要**在两个 worktree 同时 checkout 同一分支。
7. 回滚后**不要**立刻 push；先跑 `npm test`，再决定走 revert 还是 PR。

---

## 8. 常见问题

1. **脚本报 `tag 'v0.1.0-final' not found`**
   先 `git fetch --tags`；仍没有就查 `git tag -l 'v0.1.0*'`。若 tag 被误删，可从 `release/v0.1.0` 恢复：`git tag -a v0.1.0-final -m "restore" origin/release/v0.1.0; git push origin v0.1.0-final`。

2. **reset 后 `git status` 显示 `ahead` / `behind`**
   本地 main 与远端 main 不一致。远端若已有 v0.2 提交，不要 force-push；按 §2.1 用 revert 发布回滚。

3. **远端 main 已被 v0.2 污染**
   用 §2.1 的 revert；或从 `release/v0.1.0` 新建 `hotfix/restore-v0.1.0` 分支发 PR 覆盖内容（保留历史）。不要删仓库重来。

4. **只想临时看 v0.1.0，不想动当前工作区**
   `git switch --detach v0.1.0-final`（看完 `git switch main` 回来），或 `git worktree add ..\MewAgent-v0.1.0 v0.1.0-final`。

5. **worktree 删不掉/被占用**
   `git worktree list` 找到路径；先 commit/stash，再 `git worktree remove <path>`；仍失败时 `git worktree prune` 后手动删目录。

6. **回滚后发现 `.env` 或 node_modules 没了**
   说明用了 `clean -x`。`.env` 只能从备份/密码管理器恢复；node_modules 用 `npm ci` 重建。

7. **想回滚到某个阶段而不是 v0.1.0**
   把命令里的 tag 换成 `v0.1-s2` 等；脚本支持 `-Tag v0.1-s2`。

---

## 9. 变更记录

- 2026-11-26：创建；冻结 `v0.1.0-final` 与 `release/v0.1.0`；新增 `scripts/rollback-to-v0.1.0.ps1`。
