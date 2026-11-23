// 交互 TUI 的启动器：负责调用 ink.render 并等用户退出。
//
// 放在 ui/ 下而不是 index.ts，是为了让 index.ts 保持 .ts（不用 JSX），
// 同时把"Ink 渲染"这个 UI 细节关在 UI 层里。

import { render } from "ink";

import type { AppConfig } from "../config.js";
import { App } from "./App.js";
import type { SendMessage } from "./App.js";

export interface StartTuiOptions {
  readonly version: string;
  readonly config: AppConfig;
  readonly send: SendMessage;
  readonly systemPrompt: string;
}

/** 启动交互式 TUI，直到用户 Ctrl+C（空闲态）或进程被信号终止。 */
export async function startTui(options: StartTuiOptions): Promise<void> {
  const { version, config, send, systemPrompt } = options;
  const instance = render(
    <App
      version={version}
      model={config.model}
      workspace={config.workspace}
      mock={config.mock}
      systemPrompt={systemPrompt}
      send={send}
    />,
    {
      // Ctrl+C 由 App 自己的 useInput 处理（生成中只中断，空闲才退出）。
      exitOnCtrlC: false,
      // 只重绘变化的行，减少流式时的闪烁。
      incrementalRendering: true,
    },
  );

  await instance.waitUntilExit();
}
