# MewAgent 3 分钟演示脚本（v0.1.0）

> 目的：用 3 分钟展示 MewAgent 的核心能力，步骤可复现、不依赖运气。
> 适用：Windows Terminal + Node ≥ 22；已按 README 完成安装，并且 `.env`（项目级或用户级）或首启向导已配好真实模型。
> 没有 API key 也可以先跑「离线版」（见 §0），两条命令就能看到 TUI 与工具事件。

## 0. 准备（演示前 30 秒，可提前做）

```powershell
# 仓库根目录
npm run build            # 保证 dist 是最新的（全局 mewagent 用的是 dist）
mewagent --version       # 0.1.0
mewagent --print "你好"  # 真实模型链路自检；没有 key 时用 --mock --print "你好"
```

窗口建议：Windows Terminal，字号 14~16，宽度 ≥ 120 列（diff 展示更清楚）。

## 1. 流式对话与中断（30 秒）

```powershell
npm run dev        # 或在任意目录用 mewagent
```

输入并回车：

```
介绍一下你自己，然后用三点说明你能做什么。
```

看点：

- 回复**逐字流式**出现（不是等一大段）；
- 输入框在等待期间仍可输入下一句（排队）；
- 按 `Esc` 清空输入框；Ctrl+C 退出（再进来自动恢复上一次会话）。

## 2. 读项目 + 多工具回答（60 秒）

在同一会话里输入：

```
先读 README.md 的「架构」一节，再看 src/agent/loop.ts，然后用 3 行概括这个项目的分层。
```

看点：

- 顶部出现 `⚙ 工具运行中 …`，依次调用 `read_file` / `grep` 等**多个工具**；
- 每个工具都有 `✅/❌` 结果行；
- 最终回答引用了真实文件内容（不是编造）。

> 这段与自动化证据对应：`docs/testing.md` S4-4 的「真实模型多工具」A 级记录（3 次工具调用、4 轮 LLM、stop）。

## 3. 改真实文件 + 红绿 diff + 跑测试（60 秒）

在同一会话里输入：

```
新建 scratch-demo.txt 写入三行：hello、world、third；
然后把 hello 改成 hi；
再用 bash 运行 npm run typecheck；最后告诉我改了哪些行。
```

看点：

- 新建文件 / 修改文件前**弹审批**（`y` 允许一次、`a` 本会话同类都允许、`n` 拒绝）；
- `edit_file` 成功后展示**带行号的 diff**：删除行红色、添加行绿色、hunk 头青色；
- `bash` 执行 `npm run typecheck`（同样先审批），输出退出码 0；
- 结束提示 `完成`，diff 最多显示 80 行，超出部分有「还有 N 行未显示」。

清理演示文件（可让 Agent 做，也可手动）：`Remove-Item scratch-demo.txt`。

## 4. 安全底限与会话恢复（30 秒）

1. 让 Agent 执行危险命令：

   ```
   帮我执行 rm -rf / 清理一下
   ```

   看点：**不弹审批**，直接拦截并回填「危险命令」原因，模型改用安全方式回答或反问。

2. 让 Agent 写工作区外的文件：

   ```
   写文件 ../outside.txt，内容是 test
   ```

   看点：路径越界被拒绝，模型收到「不安全的路径：… 下一步：…」并解释。

3. 退出再进：

   ```
   Ctrl+C 退出；重新运行 mewagent
   ```

   看点：恢复上次会话（`已恢复 N 条消息`），直接输入「继续」能接着聊。

## 5. 常见问题（演示时备用）

| 现象 | 处理 |
|---|---|
| 首字慢 | 取决于 provider/网络；本机实测真实模型首字 ~1.0–1.3s（deepseek-flash） |
| 没有 API key | 全程加 `--mock` 可演示 UI/工具事件（不调真实模型） |
| 中文乱码 | 确认在 Windows Terminal、Node ≥ 22；输出重定向用 `cmd /c` |
| 审批按键无反应 | 先 `Esc` 回到输入框，再按 `y/a/n` |
| 想重新配置 | `mewagent --setup`（或删除 `%USERPROFILE%\.mewcode\config.json` 后首次启动） |

## 6. 自动化证据索引

演示相关的 A 级证据记录在 `docs/testing.md` 的 S4-4 小节（真实 API 首字时延、多工具、审批拒绝、50 轮压缩、冒烟脚本、全量测试）；录屏/截图如需要可放 `docs/evidence/`（当前未收录）。
