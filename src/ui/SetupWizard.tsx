// 首次配置向导（Ink 组件）：base-url → 模型 → API key → 确认（可测连接）→ 保存。
//
// 边界（AGENTS §3/§4）：
// - 只消费 `setup-state.ts` 的纯逻辑与注入的 `probe`/`onSubmit`，不直接读环境变量或写文件；
// - 不 import LLM 客户端；所有失败信息都带「下一步」；
// - 已有 API key 时，key 步骤允许留空回车表示"保留旧值"。

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { UserConfig } from "../config.js";
import {
  describeSetupSummary,
  maskSecret,
  normalizeDraft,
  validateApiKey,
  validateBaseUrl,
  validateModel,
  type SetupDraft,
  type SetupOutcome,
} from "./setup-state.js";

type WizardStep =
  | "baseUrl"
  | "model"
  | "apiKey"
  | "confirm"
  | "testing"
  | "error"
  | "saved";

type ProbeResult = { ok: boolean; reason: string };

export interface SetupWizardProps {
  version: string;
  initial: { baseUrl: string; model: string; hasApiKey: boolean };
  /** 连接测试；由调用方注入（真实实现发一次最小请求）。 */
  probe: (draft: SetupDraft) => Promise<ProbeResult>;
  /** 保存草稿；由调用方注入（真实实现写用户级 config.json）。 */
  onSubmit: (
    draft: SetupDraft,
  ) => { ok: true; path: string } | { ok: false; reason: string };
  /** 结束回调：saved（含保存路径与可持久化配置）或 cancelled。 */
  onFinish: (outcome: SetupOutcome) => void;
}

/** 首次启动配置向导。 */
export function SetupWizard(props: SetupWizardProps): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>("baseUrl");
  const [draft, setDraft] = useState<SetupDraft>({
    baseUrl: props.initial.baseUrl,
    model: props.initial.model,
    apiKey: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [errorBack, setErrorBack] = useState<"apiKey" | "confirm">("apiKey");
  const [savedPath, setSavedPath] = useState("");
  const cancelledRef = useRef(false);

  const finish = useCallback(
    (outcome: SetupOutcome) => {
      props.onFinish(outcome);
      exit();
    },
    [exit, props],
  );

  const cancel = useCallback(() => {
    if (cancelledRef.current) {
      return;
    }
    cancelledRef.current = true;
    finish({ kind: "cancelled" });
  }, [finish]);

  const save = useCallback(() => {
    const normalized = normalizeDraft(draft);
    const saved = props.onSubmit(normalized);
    if (!saved.ok) {
      setErrorBack("confirm");
      setErrorMessage(
        `保存配置失败：${saved.reason}\n下一步：检查用户主目录的写权限，或改用环境变量/.env 配置。`,
      );
      setStep("error");
      return;
    }
    setSavedPath(saved.path);
    setStep("saved");
  }, [draft, props]);

  const testAndSave = useCallback(async () => {
    const normalized = normalizeDraft(draft);
    setStep("testing");
    setErrorMessage("");
    let result: ProbeResult;
    try {
      result = await props.probe(normalized);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = { ok: false, reason: `连接测试异常：${reason}` };
    }
    if (!result.ok) {
      setErrorBack("apiKey");
      setErrorMessage(result.reason);
      setStep("error");
      return;
    }
    save();
  }, [draft, props, save]);

  // 保存成功屏自动结束，交给入口继续启动 TUI。
  useEffect(() => {
    if (step !== "saved") {
      return;
    }
    const timer = setTimeout(() => {
      const normalized = normalizeDraft(draft);
      const config: UserConfig = {
        baseUrl: normalized.baseUrl,
        model: normalized.model,
        ...(normalized.apiKey === "" ? {} : { apiKey: normalized.apiKey }),
      };
      finish({ kind: "saved", path: savedPath, config });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, finish, savedPath, step]);

  // 全局按键：Esc = 上一步/取消，Ctrl+C = 取消；确认/错误屏的其余按键单独处理。
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      cancel();
      return;
    }
    if (key.escape) {
      if (step === "baseUrl" || step === "confirm") {
        cancel();
      } else if (step === "model") {
        setStep("baseUrl");
      } else if (step === "apiKey") {
        setStep("model");
      } else if (step === "error") {
        if (errorBack === "confirm") {
          setStep("confirm");
        } else {
          setStep("apiKey");
        }
      }
      return;
    }
    if (step === "confirm") {
      if (key.return) {
        void testAndSave();
      } else if (input === "s") {
        save();
      } else if (input === "e") {
        setStep("baseUrl");
      }
      return;
    }
    if (step === "error" && key.return) {
      setStep(errorBack);
    }
  });

  const stepLabel =
    step === "baseUrl"
      ? "第 1/3 步"
      : step === "model"
        ? "第 2/3 步"
        : step === "apiKey"
          ? "第 3/3 步"
          : step === "confirm"
            ? "确认"
            : step === "testing"
              ? "测试连接"
              : step === "error"
                ? "出错了"
                : "已保存";

  const footer =
    step === "confirm"
      ? "Enter 测试连接并保存 · s 跳过测试直接保存 · e 重新填写 · Esc 取消"
      : step === "error"
        ? "Enter 返回修改 · Esc 取消"
        : step === "testing"
          ? "正在测试连接，请稍候…"
          : step === "saved"
            ? `已写入：${savedPath}`
            : "Enter 继续 · Esc 上一步/取消 · Ctrl+C 取消";

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{`mewagent ${props.version} · 首次配置（${stepLabel}）`}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          配置会保存到用户级 config.json（~/.mewcode/config.json，可用
          MEWCODE_HOME 改目录），之后在任何目录启动都能用。
        </Text>
      </Box>

      {step === "baseUrl" ? (
        <Box>
          <Text>API 地址（OpenAI 兼容，例如 https://api.deepseek.com）：</Text>
        </Box>
      ) : null}
      {step === "baseUrl" ? (
        <TextInput
          value={draft.baseUrl}
          onChange={(value) => setDraft({ ...draft, baseUrl: value })}
          onSubmit={() => {
            const check = validateBaseUrl(draft.baseUrl);
            if (check.ok) {
              setStep("model");
            } else {
              setErrorBack("apiKey");
              setErrorMessage(check.message);
              setStep("error");
            }
          }}
        />
      ) : null}

      {step === "model" ? (
        <Box>
          <Text>模型名（例如 deepseek-chat）：</Text>
        </Box>
      ) : null}
      {step === "model" ? (
        <TextInput
          value={draft.model}
          onChange={(value) => setDraft({ ...draft, model: value })}
          onSubmit={() => {
            const check = validateModel(draft.model);
            if (check.ok) {
              setStep("apiKey");
            } else {
              setErrorBack("apiKey");
              setErrorMessage(check.message);
              setStep("error");
            }
          }}
        />
      ) : null}

      {step === "apiKey" ? (
        <Box>
          <Text>
            API key（输入时不显示；已有 key 时留空回车可保留旧值）：
          </Text>
        </Box>
      ) : null}
      {step === "apiKey" ? (
        <TextInput
          value={draft.apiKey}
          mask="•"
          onChange={(value) => setDraft({ ...draft, apiKey: value })}
          onSubmit={() => {
            const check = validateApiKey(draft.apiKey, {
              hasExisting: props.initial.hasApiKey,
            });
            if (check.ok) {
              if (draft.apiKey !== "") {
                setDraft({ ...draft, apiKey: draft.apiKey });
              }
              setStep("confirm");
            } else {
              setErrorBack("apiKey");
              setErrorMessage(check.message);
              setStep("error");
            }
          }}
        />
      ) : null}

      {step === "confirm" ? (
        <Box flexDirection="column">
          <Text>请确认配置：</Text>
          {describeSetupSummary(draft, {
            hasExistingApiKey: props.initial.hasApiKey,
          }).map((line) => (
            <Text key={line}> {line}</Text>
          ))}
          <Text dimColor>
            {draft.apiKey === ""
              ? "提示：直接回车会先测试连接；如果不方便测试，可按 s 直接保存。"
              : "提示：直接回车会先测试连接；如果不方便测试，可按 s 直接保存。"}
          </Text>
        </Box>
      ) : null}

      {step === "testing" ? (
        <Text color="cyan">正在测试连接（最多 10 秒）…</Text>
      ) : null}

      {step === "error" ? (
        <Box flexDirection="column">
          <Text color="red">{errorMessage}</Text>
        </Box>
      ) : null}

      {step === "saved" ? (
        <Box flexDirection="column">
          <Text color="green">配置已保存，之后启动会自动使用。</Text>
          <Text dimColor>稍后自动继续启动…</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>{footer}</Text>
      </Box>
    </Box>
  );
}

/** 供测试断言用的掩码展示（不参与渲染逻辑，仅导出避免重复实现）。 */
export const maskForDisplay = maskSecret;
