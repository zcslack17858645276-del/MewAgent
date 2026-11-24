// 首次配置向导的纯逻辑层：校验、归一化、摘要。不 import Ink，便于单测。
//
// 设计（用户 2026-11-24 选定方案 A）：
// - 首次交互式启动且缺模型/API key 时弹 3 步向导（base-url / 模型 / API key）；
// - 用户可先测试连接再保存到用户级 `~/.mewcode/config.json`（`MEWCODE_HOME` 可改目录）；
// - 已有 key 时允许留空回车，表示"保留旧值"。

import type { UserConfig } from "../config.js";

/** 向导收集的草稿；`apiKey` 为空表示"保留已有值"（仅当已有配置时合法）。 */
export interface SetupDraft {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** 单个字段的校验结果。 */
export type SetupValidation = { ok: true } | { ok: false; message: string };

/** 向导结束时的结果：保存成功（含路径与可持久化配置）或取消。 */
export type SetupOutcome =
  | { kind: "saved"; path: string; config: UserConfig }
  | { kind: "cancelled" };

/** API 地址不能为空，且必须是 http(s):// 开头的绝对地址。 */
export function validateBaseUrl(value: string): SetupValidation {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, message: "API 地址不能为空。" };
  }
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    return { ok: false, message: "API 地址需要以 http:// 或 https:// 开头。" };
  }
  return { ok: true };
}

/** 模型名不能为空、不能含空白。 */
export function validateModel(value: string): SetupValidation {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, message: "模型名不能为空。" };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, message: "模型名不能包含空格。" };
  }
  return { ok: true };
}

/** API key 不能为空；但已有 key 时允许留空（表示保留旧值）。 */
export function validateApiKey(
  value: string,
  options: { hasExisting: boolean },
): SetupValidation {
  const trimmed = value.trim();
  if (trimmed === "") {
    return options.hasExisting
      ? { ok: true }
      : { ok: false, message: "API key 不能为空。" };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, message: "API key 不能包含空格。" };
  }
  return { ok: true };
}

/** 提交前归一化：去首尾空白，base-url 去尾部斜杠。 */
export function normalizeDraft(draft: SetupDraft): SetupDraft {
  return {
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
  };
}

/** 把密钥显示成等长圆点（按码点计数，不会泄露任何字符）。 */
export function maskSecret(value: string): string {
  return "•".repeat(Array.from(value.trim()).length);
}

/** confirm 屏的摘要行：key 只显示长度或“保留已保存”。 */
export function describeSetupSummary(
  draft: SetupDraft,
  options: { hasExistingApiKey: boolean },
): string[] {
  const normalized = normalizeDraft(draft);
  const keyLabel =
    normalized.apiKey === ""
      ? options.hasExistingApiKey
        ? "保留已保存的 key"
        : "（未填写）"
      : `${maskSecret(normalized.apiKey)}（${Array.from(normalized.apiKey).length} 个字符）`;
  return [
    `API 地址：${normalized.baseUrl}`,
    `模型：${normalized.model}`,
    `API key：${keyLabel}`,
  ];
}
