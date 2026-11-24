// 交互 TUI 的启动器：负责调用 ink.render 并等用户退出。
//
// 放在 ui/ 下而不是 index.ts，是为了让 index.ts 保持 .ts（不用 JSX），
// 同时把"Ink 渲染"这个 UI 细节关在 UI 层里。

import { render } from "ink";

import type { AppConfig } from "../config.js";
import { App } from "./App.js";
import type { RunAgentTurn } from "./App.js";
import type { ApprovalController } from "./approval.js";

export interface StartTuiOptions {
  readonly version: string;
  readonly config: AppConfig;
  /** 一轮执行的注入点（S2-7 起接 Agent Loop；测试注入假实现）。 */
  readonly runTurn: RunAgentTurn;
  /** 已注册工具名，仅用于启动横幅。 */
  readonly toolNames: readonly string[];
  /** 审批桥（S3-2）：权限闸需要人工确认时，由 App 渲染审批弹窗。 */
  readonly approvals?: ApprovalController | undefined;
}

/** 读取 Kitty 键盘协议的开关（`MEWCODE_KITTY_KEYBOARD=0/off` 可关闭）。 */
function readKittyKeyboardMode(): "auto" | "disabled" {
  const raw = process.env["MEWCODE_KITTY_KEYBOARD"];
  if (raw === undefined) {
    return "auto";
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "off" || normalized === "false") {
    return "disabled";
  }

  return "auto";
}

/** 启动交互式 TUI，直到用户 Ctrl+C（空闲态）或进程被信号终止。 */
export async function startTui(options: StartTuiOptions): Promise<void> {
  const { version, config, runTurn, toolNames, approvals } = options;
  const instance = render(
    <App
      version={version}
      model={config.model}
      workspace={config.workspace}
      mock={config.mock}
      toolNames={toolNames}
      runTurn={runTurn}
      approvals={approvals}
    />,
    {
      // Ctrl+C 由 App 自己的 useInput 处理（生成中只中断，空闲才退出）。
      exitOnCtrlC: false,
      // 只重绘变化的行，减少流式时的闪烁。
      incrementalRendering: true,
      // 开启 Kitty 键盘协议后终端能区分 Shift+Enter（ESC[13;2u）与 Enter；
      // 不支持该协议的终端会回退到普通按键，Shift+Enter 无效时用 Ctrl+J 换行。
      kittyKeyboard: { mode: readKittyKeyboardMode() },
    },
  );

  await instance.waitUntilExit();
}
