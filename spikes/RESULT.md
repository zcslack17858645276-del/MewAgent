# S0-1 Ink 8 中文 IME Spike 结果报告

- 任务：`task-1` — Ink 8 + ink-text-input 6 在 **Windows Terminal + 微软拼音** 下的真实 GUI 键盘注入验证
- 执行人：ime-spiker（teammate）
- 执行时间：2026-11-23 15:53:33 ~ 15:54:01（Asia/Shanghai，三轮共约 28 秒；自动化脚本一次通过）
- 机器：Windows NT 10.0.26200.0 x64，session 1（UserInteractive），单屏 1920x1080
- **最终判定：A（可正常输入中文 + 退格正常；候选框位置偏移但不遮挡、不影响使用）**
- **§9.1 建议：继续 TS + Ink，不转 Go + Bubble Tea**
- 证据目录：`spikes/.out/`（jsonl 日志、14 张截图、run log、summary.json）

---

## 1. 环境（实测）

| 项目 | 值 |
| --- | --- |
| OS | Windows NT 10.0.26200.0（Windows 11 25H2 内核版本号），x64，单屏 1920x1080 |
| 终端 | Windows Terminal **1.25.3131.0**（MSIX，`Get-AppxPackage Microsoft.WindowsTerminal`），wt.exe 位于 `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wt.exe` |
| Shell | **Windows PowerShell 5.1.26100.7019**（本机**没有 pwsh 7**：`Get-Command pwsh` 为空） |
| 执行策略 | CurrentUser = `RemoteSigned` → 未签名 `.ps1` 直接运行会被拒（见 §2 第 4 步） |
| Node | v26.7.0；npx 12.0.2；tsx 4.23.15 |
| Ink / 输入组件 | ink 8.0.0 / ink-text-input 6.0.0 / react 19.3.1 |
| 语言列表 | `Get-WinUserLanguageList` = zh-Hans-CN, ja |
| zh-Hans-CN IME tips | `0804:{81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E}{FA550B04-5AD7-411F-A5AC-CA038EC515D7}` = **微软拼音** |
| ja IME tips | `0411:{03B5835F-F03C-411B-9CE2-AA23E1171E36}{A76C93D9-5523-4E90-AAFA-4DB112F9AC76}` = 日文 MS-IME |
| `HKCU:\Keyboard Layout\Preload` | `1 = 00000804`，`2 = 00000411`；`Substitutes` 为空 |
| 目标窗口线程 HKL | **0x08040804**（中文(简体)-美式键盘） |

### 实际生效的输入法 / 中英切换方式

- **HKL 0x08040804 并不代表只能输英文**：目标窗口（WT）的 TSF 输入配置实际生效的是**微软拼音**。
  证据：输入 `nihao` 时 Ink 端**没有任何 onChange 事件**（按键被 IME 组合吞掉），截图 `spikes/.out/r1-02-composing.png` 中可见
  `ni'hao` 预编辑串与微软拼音候选条 `1 你好 2 你号 3 拟好 4 倪浩 5 \(@^0^@)/ 6 你哈哦 7 泥嚎`；随后空格上屏成功得到 `你好`。
- **中文 → 英文直通**：在测试窗口前台、输入框为空时**按一次 Shift** 即生效（第 3 轮：首次输入 abc 仍被组合吞掉 → Esc + Shift 后重试，jsonl 出现 `a`→`ab`→`abc` 逐键事件）。
- **英文 → 中文**：同样按一次 Shift 切回（首轮无需切换，默认就是中文模式）。
- 脚本里还内置了 Win+Space fallback，但**本次未触发**；实际生效方式就是 **Shift 键**。
- 结论：**无需修改系统输入法设置、无需安装额外 IME**，默认环境即可用。

---

## 2. 复现步骤

1. 依赖已安装（本 spike 未执行 `npm install`）。`cd D:\workplace\AIAgent\MewCode`
2. 类型检查（spike 已纳入 tsconfig 的 `include`）：
   ```
   npx tsc -p tsconfig.json        # EXIT=0
   ```
3. 单跑 Ink spike（手工验证用）：
   ```
   npx tsx spikes/ime-spike.tsx
   ```
   Ink 界面显示输入框、`value=... len=...` 行；挂载即写 `spikes/.out/ready.txt`，每次 onChange 同步 append JSONL。
4. **全自动 GUI 驱动（一键复现，本报告证据均来自它）**：
   ```
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File spikes\run-ime-spike.ps1
   ```
   > 注意：本机执行策略为 `RemoteSigned`，直接 `& spikes\run-ime-spike.ps1` 会报
   > 「未对文件进行数字签名，无法在当前系统上运行该脚本」；必须加 `-ExecutionPolicy Bypass`（或有 pwsh 7 时 `pwsh -File` 同样需要 Bypass/签名）。
   脚本行为（与任务书要求一致）：
   - 记录启动前 `GetForegroundWindow()` → `wt.exe -w -1 new-tab --title IMESPIKE_R1 -d <repo> powershell -NoLogo -NoProfile -NoExit -Command "npx tsx spikes/ime-spike.tsx"` 新建测试窗口（R1/R2/R3 三轮各一窗）；
   - `Add-Type` P/Invoke `EnumWindows + GetWindowText` 找标题含 `IMESPIKE` 的顶层窗口（标题带「管理员: 」前缀，子串匹配可命中）；
   - 等 `spikes/.out/ready.txt` 出现后再发键；
   - `SendInput`（KEYBDINPUT 结构、MapVirtualKey 取扫描码）发**真实按键**；**每次发键前硬校验 `GetForegroundWindow() == 目标 hwnd`**，不等则 `ShowWindow + SetForegroundWindow + AttachThreadInput`（及 WScript.Shell.AppActivate 兜底）重试，仍失败则 `throw` 中止，绝不盲发；
   - 测试序列：R1 中文 `n i h a o` → 截图（候选框）→ 空格选首候选 → 截图 → Enter 提交（onSubmit）；R2 中文上屏「你好」→ Backspace → 截图 → 再 Backspace；R3 ASCII `a b c` → Backspace；
   - `GetWindowRect + CopyFromScreen` 截图到 `spikes/.out/*.png`（组合态截图外扩 170px 以包含候选条）；
   - 结束：`WM_CLOSE` 关闭自己创建的测试窗口、停止残留 `node ... ime-spike` 进程、**还原原前台窗口**（本机回到 DSH Desktop），并关闭此前探测遗留的 WT “Help” 窗口；写 `spikes/.out/summary.json`。
5. 手工对照：也可在 WT 中直接 `npx tsx spikes/ime-spike.tsx`，按同样序列手敲；日志与截图节点与自动化一致。

---

## 3. 证据清单

### 3.1 JSONL 关键行原文（`spikes/.out/ime-log.jsonl`，由 Ink 程序同步 append）

第 1 轮（中文 → 空格选候选 → Enter 提交）：
```json
{"ts":"2026-11-23T07:53:36.052Z","pid":14280,"event":"init","node":"v26.7.0","platform":"win32","cwd":"D:\\workplace\\AIAgent\\MewCode","stdinIsTTY":true,"stdoutIsTTY":true,"argv":[]}
{"ts":"2026-11-23T07:53:41.053Z","pid":14280,"event":"change","value":"你好","len":2,"codeUnits":2,"changeIndex":1,"elapsedMs":5027}
{"ts":"2026-11-23T07:53:42.065Z","pid":14280,"event":"submit","value":"你好","len":2,"codeUnits":2,"changes":1,"elapsedMs":6039}
```

第 2 轮（退格验证）：
```json
{"ts":"2026-11-23T07:53:49.847Z","pid":31924,"event":"change","value":"你好","len":2,"codeUnits":2,"changeIndex":1,"elapsedMs":4704}
{"ts":"2026-11-23T07:53:50.863Z","pid":31924,"event":"change","value":"你","len":1,"codeUnits":1,"changeIndex":2,"elapsedMs":5720}
{"ts":"2026-11-23T07:53:51.725Z","pid":31924,"event":"change","value":"","len":0,"codeUnits":0,"changeIndex":3,"elapsedMs":6582}
```

第 3 轮（ASCII 基线）：
```json
{"ts":"2026-11-23T07:53:57.980Z","pid":27144,"event":"change","value":"a","len":1,"codeUnits":1,"changeIndex":1,"elapsedMs":3640}
{"ts":"2026-11-23T07:53:58.133Z","pid":27144,"event":"change","value":"ab","len":2,"codeUnits":2,"changeIndex":2,"elapsedMs":3793}
{"ts":"2026-11-23T07:53:58.287Z","pid":27144,"event":"change","value":"abc","len":3,"codeUnits":3,"changeIndex":3,"elapsedMs":3947}
{"ts":"2026-11-23T07:53:58.978Z","pid":27144,"event":"change","value":"ab","len":2,"codeUnits":2,"changeIndex":4,"elapsedMs":4638}
{"ts":"2026-11-23T07:53:59.829Z","pid":27144,"event":"submit","value":"ab","len":2,"codeUnits":2,"changes":4,"elapsedMs":5489}
```

### 3.2 onChange 序列汇总

| 轮次 | 场景 | onChange 序列 | 结论 |
| --- | --- | --- | --- |
| R1 | 中文 `nihao` + 空格选首候选 + Enter | **（无事件）→ `你好`（1 次，len=2）** | IME 组合期 Ink 收不到按键（正常）；上屏一次性整串进入，无重复/拆字 |
| R2 | 中文上屏 `你好` 后 Backspace ×2 | `你好` → `你`（len=1）→ `""`（len=0） | 每次退格精确删除 **1 个完整汉字**，无半字/乱码/重复/错位 |
| R3 | ASCII `abc` 后 Backspace | `a` → `ab` → `abc` → `ab` | 非 IME 路径逐键正常，排除 Ink/终端自身问题 |

### 3.3 final submit value

- R1：`你好`（code points = 2，codeUnits = 2，`changes=1`）
- R3：`ab`（code units = 2，`changes=4`）
- R2：未提交（直接关闭窗口，无 submit 事件，符合预期）

### 3.4 截图（`spikes/.out/`）

| 文件 | 内容 |
| --- | --- |
| `r1-01-ready.png` | R1 窗口就绪：Ink 边框盒 + `> ` 输入行 + `value= len=0 codeUnits=0` + `pid=14280 · changes=0` |
| `r1-02-composing.png` | **中文组合中**：Ink 盒下方可见 `ni'hao` 预编辑串与微软拼音候选条（1 你好 2 你号 3 拟好 4 倪浩 5 …），有翻页/展开按钮 |
| `r1-03-committed.png` | 空格选首候选上屏后：`> 你好█`，`value=你好 len=2 codeUnits=2`，`changes=1` |
| `r1-04-submitted.png` | Enter 提交后（onSubmit 已写 jsonl） |
| `r2-01-ready.png` | R2 窗口就绪 |
| `r2-02-composing.png` | R2 组合态（候选条） |
| `r2-03-before-backspace.png` | R2 上屏「你好」后：`> 你好█ value=你好 len=2` |
| `r2-04-after-backspace.png` | **退格后**：`> 你█`，`value=你 len=1 codeUnits=1`，`changes=2` |
| `r2-05-after-backspace2.png` | 再退格：`> █`，`value= len=0 codeUnits=0`，`changes=3` |
| `r3-01-ready.png` | R3 窗口就绪 |
| `r3-02-ascii-abc.png` | ASCII 基线：`> abc█`，`value=abc len=3 codeUnits=3`，`changes=3` |
| `r3-03-after-backspace.png` | ASCII 退格：`> ab█`，`value=ab len=2`，`changes=4` |
| `r3-04-submitted.png` | ASCII Enter 提交后 |

其他证据：`spikes/.out/run-ime-spike.log`（逐键发送/窗口/前台校验/截图步骤日志）、`spikes/.out/summary.json`（三轮结构化结果）、`spikes/.out/ready.txt`。
全程日志中**没有** `FOREGROUND_MISMATCH` / `SAFETY ABORT` 记录 → 每次按键前都成功校验了前台窗口。

---

## 4. 候选框位置（判定 A 的子项）

- 组合态（`r1-02-composing.png`、`r2-02-composing.png`）：Ink 输入框内**不显示**预编辑串（IME 组合期 Ink 收不到事件，符合预期）；
  `ni'hao` 预编辑串与微软拼音候选条渲染在 **Ink 边框盒下方**（约输入行下 3~4 行文本高度），并未贴住 `> ` 光标位置。
- 候选条**不遮挡**输入框、`value=` 状态行与提示行，可正常读数，空格选词、Enter 上屏均正常；
  上屏后中文**正确出现在 `> ` 之后**（`r1-03-committed.png`），`value`/`len` 同步更新。
- 这属于 Ink 的已知 IME 限制（终端光标坐标无 side-channel；相关 PR #846/#1004 均未合并，见 `research/02-tui-frameworks.md`），
  但**不影响输入功能**，属任务判定中的「候选框位置略偏（可接受）」。
- 残余风险（本次未覆盖）：用**数字键**从 CJK 候选列表选词时，按键可能被 Ink 当成普通数字输入（Claude Code 有同类 issue #57759）。
  本次用空格选首候选规避；如需覆盖，复测成本很低：组合 `nihao` 后按 `2`，看 jsonl 是否出现 change=`2`。

---

## 5. 判定与 §9.1 建议

### 判定：**A**

依据（真实 GUI 注入，非模拟）：
1. **中文可正常输入**：真实微软拼音组合 → 空格选首候选 → 上屏 `你好`，Ink onChange/submit 均拿到正确 UTF-16 值（len=2）。
2. **退格正常**：`你好` → `你` → `""`，每次删除 1 个完整汉字（len 2→1→0），**无半字、无乱码、无重复字符、无错位**。
3. **ASCII 基线正常**：`a`→`ab`→`abc`→`ab`，证明非 IME 路径（Ink/终端/keypress 解析）健康，问题不在 Ink 基本输入能力。
4. 候选框位置偏移但可见、不遮挡、不影响操作 → 属 A 的可接受子项。

### §9.1 建议

- **继续 TS + Ink**（不切 Go + Bubble Tea）。§9.1 决策规则中「WT + 微软拼音在 Ink 输入框能输入中文，仅候选框位置略偏」→ 继续 TS；本次实测满足该条件。
- 日常使用建议（方案 §9.1 已给出）：candidate 位置偏移的观感问题可通过**英文下指令**规避（本环境 Shift 一次即可切英文直通，输入完全正常）。
- 非阻塞后续项：
  - 若产品对候选框位置敏感，可等 Ink 上游修复（PR #846 synchronized update / #1004 side-channel inline cursor），或替换输入组件/自绘行编辑；
  - 在 alternate-screen 全屏 TUI 模式下复测 IME（Ink 已知在全屏模式下问题更明显，Claude Code #93281）；
  - 补测数字键选候选（第 4 节残余风险）。

---

## 6. 过程备注（复现时可能踩的坑）

1. **本机无 pwsh 7**：任务书原文的 `pwsh` 命令改用 `powershell.exe`；驱动脚本同时兼容 5.1 / 7。
2. **执行策略**：CurrentUser=`RemoteSigned`，未签名 `.ps1` 必须 `-ExecutionPolicy Bypass` 运行（已在 §2 写明，未修改系统策略）。
3. **PS 5.1 的编码坑**：Windows PowerShell 5.1 读取「无 BOM 的 UTF-8 `.ps1`」会按系统 ANSI（本机 GBK）解码，中文注释/字符串会破坏引号解析导致 `Parser::ParseFile` 报「字符串缺少终止符」。
   因此 `run-ime-spike.ps1` 刻意保持**纯 ASCII**（注释与日志均英文），避免误判；`ime-spike.tsx` 由 Node/tsx 以 UTF-8 读取，中文 UI 正常。
4. **WT 标题会变**：测试 tab 标题初始为 `管理员: IMESPIKE_R1`，子进程（npx → cmd.exe）运行期间会临时变成 `管理员: C:\Windows\system32\cmd.exe`，关闭窗口时脚本按标题 `IMESPIKE` 校验可能拒绝 → 已由 `finally` 清理阶段兜底关闭（日志中 R2 的一次 `REFUSING to close` 即此原因，最终窗口全部关闭）。
5. **DPI/缩放**：脚本先 `SetProcessDPIAware()`；本机 100% 缩放，截图与窗口矩形一致。
6. **焦点安全**：脚本启动前记录原前台（DSH Desktop），每轮发键前硬校验前台；结束后已还原前台到 **DSH Desktop**（`hwnd=395108`，title `MewCode S0-1 任务实施 — DeepSeek Harness`），测试窗口、WT “Help” 探测遗留窗口、残留 `node ime-spike` 进程均已清理。
7. **时间**：三轮自动化总耗时约 28 秒（15:53:33–15:54:01），远低于 25 分钟卡点；未使用 `AttachConsole + WriteConsoleInput` 降级方案（不需要）。
8. **证据等级**：本次为**最高等级**——真实前台 WT 窗口 + `SendInput` 真实按键 + 系统微软拼音真实 IME 组合/候选/上屏，而非向 conhost 注入已提交文本；截图与程序侧 JSONL 双证据互相印证。

---

## 7. 交付物对照

| 交付物 | 状态 |
| --- | --- |
| `spikes/ime-spike.tsx` | ✅ 可 `npx tsx spikes/ime-spike.tsx` 运行；`npx tsc -p tsconfig.json` EXIT=0 |
| `spikes/run-ime-spike.ps1` | ✅ 一键自动化：启动/查找窗口、真实按键注入+前台硬校验、三轮测试、截图、清理与还原前台；本次运行 EXIT=0 |
| `spikes/RESULT.md` | ✅ 本文件（环境/复现/证据/判定 A/§9.1 建议） |
| 证据 | ✅ `spikes/.out/`：`ime-log.jsonl`、14 张 PNG、`run-ime-spike.log`、`ready.txt`、`summary.json` |
