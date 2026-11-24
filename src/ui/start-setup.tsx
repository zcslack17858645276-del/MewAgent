// 首启配置向导的启动入口：把 Ink 渲染细节包在这里，`index.ts` 只依赖注入函数。

import React from "react";
import { render } from "ink";
import type { UserConfig } from "../config.js";
import { SetupWizard } from "./SetupWizard.js";
import type { SetupDraft, SetupOutcome } from "./setup-state.js";

/** `index.ts` 传入的向导参数。 */
export interface SetupWizardRequest {
  version: string;
  initial: { baseUrl: string; model: string; hasApiKey: boolean };
  probe: (draft: SetupDraft) => Promise<{ ok: boolean; reason: string }>;
  onSubmit: (
    draft: SetupDraft,
  ) => { ok: true; path: string } | { ok: false; reason: string };
}

export type { SetupDraft, SetupOutcome };

/**
 * 渲染配置向导并等待退出。
 * 返回 saved（含用户级配置合并结果）或 cancelled，不抛异常。
 */
export async function runSetupWizard(
  request: SetupWizardRequest,
): Promise<SetupOutcome> {
  let outcome: SetupOutcome = { kind: "cancelled" };
  const element = React.createElement(SetupWizard, {
    version: request.version,
    initial: request.initial,
    probe: request.probe,
    onSubmit: request.onSubmit,
    onFinish: (next: SetupOutcome) => {
      outcome = next;
    },
  });
  const instance = render(element, { exitOnCtrlC: false });
  await instance.waitUntilExit();
  return outcome;
}

/** 便于入口统一类型：保存后的用户级配置形状。 */
export type SetupSavedConfig = UserConfig;
