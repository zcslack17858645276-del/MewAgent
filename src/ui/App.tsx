// S1-4 最小 TUI：消息列表（Static 历史）+ 流式区 + 输入框 + 状态/错误行。
//
// 边界（方案 §3.1）：本组件不 import LLM 客户端、不发 HTTP；真正的请求函数由入口
// 注入（`send`），S2 接入 Agent Loop 后只需换成事件源。这样 UI 只负责"展示 + 交互"。
//
// 关键行为（方案 §6.9）：
// - 已提交的历史用 <Static> 一次性渲染，动态区只重绘流式文本/输入框，避免闪屏；
// - 流式文本 50ms 节流（ThrottledEmitter），不是每个 token setState；
// - 生成中 Esc / Ctrl+C 只 abort；空闲时 Ctrl+C 退出；
// - 生成中仍可输入，回车把消息排队，上一轮结束后自动发送（不丢消息、不串轮）；
// - 终端光标通过 useCursor 放到输入框 caret，改善 Windows Terminal 下中文候选框位置。

import {
  Box,
  Static,
  Text,
  measureElement,
  useApp,
  useCursor,
  useInput,
} from "ink";
import type { CursorPosition, DOMElement } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { LlmChatResult, Message } from "../types.js";
import { HistoryItem, createHistoryEntry } from "./HistoryItem.js";
import type { HistoryEntry, HistoryEntryKind } from "./HistoryItem.js";
import { ThrottledEmitter } from "./throttle.js";
import { displayWidth } from "./width.js";

/** 入口注入的对话函数：给一段消息，流式回调 + 一个可中止信号，最终返回完整结果。 */
export type SendMessage = (
  messages: readonly Message[],
  options: { signal: AbortSignal; onDelta: (delta: string) => void },
) => Promise<LlmChatResult>;

export interface AppProps {
  readonly version: string;
  readonly model: string;
  readonly workspace: string;
  readonly mock: boolean;
  readonly systemPrompt: string;
  readonly send: SendMessage;
  /** 流式刷新间隔，默认 50ms（方案 §6.9）；测试可调小。 */
  readonly streamThrottleMs?: number;
}

const PROMPT = "❯ ";
const PROMPT_WIDTH = displayWidth(PROMPT);

type Phase = "idle" | "streaming";

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      // Node 的 DOMException 实现（fetch / undici）用 name 区分中止。
      error.message.includes("aborted"))
  );
}

export function App({
  version,
  model,
  workspace,
  mock,
  systemPrompt,
  send,
  streamThrottleMs = 50,
}: AppProps): ReactElement {
  const { exit } = useApp();
  const { setCursorPosition } = useCursor();

  // Ink 的 <Static items> 要求可变数组，所以这里不用 readonly。
  const [entries, setEntries] = useState<HistoryEntry[]>(() => [
    createHistoryEntry(0, "info", `MewAgent ${version}${mock ? "（mock 离线模式）" : ""} · 模型 ${model}`),
    createHistoryEntry(1, "info", `工作区 ${workspace}`),
    createHistoryEntry(2, "info", "输入问题后回车发送；生成中 Esc 中断，空闲 Ctrl+C 退出。"),
  ]);
  const nextIdRef = useRef(3);
  const [messages, setMessages] = useState<readonly Message[]>(() => [
    { role: "system", content: systemPrompt },
  ]);
  const messagesRef = useRef<readonly Message[]>(messages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [cursorPosition, setCursorState] = useState<CursorPosition | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const emitterRef = useRef<ThrottledEmitter | null>(null);
  const streamingTextRef = useRef("");
  const inputBoxRef = useRef<DOMElement | null>(null);

  const appendEntry = useCallback((kind: HistoryEntryKind, text: string) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setEntries((previous) => [...previous, createHistoryEntry(id, kind, text)]);
  }, []);

  const commitMessages = useCallback((next: readonly Message[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const appendToolCallNotice = useCallback(
    (result: LlmChatResult) => {
      const names = result.toolCalls.map((call) => call.name).join("、");
      appendEntry(
        "info",
        `（S1-4 占位）模型请求调用工具：${names}；工具执行与多轮循环在 S2 接入。`,
      );
    },
    [appendEntry],
  );

  /** 发送一轮：流式展示 → 提交 assistant 消息；被中断时保留已输出内容。 */
  const start = useCallback(
    async (prompt: string): Promise<void> => {
      const nextMessages: readonly Message[] = [
        ...messagesRef.current,
        { role: "user", content: prompt },
      ];
      commitMessages(nextMessages);
      appendEntry("user", prompt);
      setErrorText(null);
      setStreaming("");
      streamingTextRef.current = "";
      setPhase("streaming");

      const controller = new AbortController();
      abortRef.current = controller;
      const emitter = new ThrottledEmitter({
        delayMs: streamThrottleMs,
        emit: (text) => {
          setStreaming(text);
        },
      });
      emitterRef.current = emitter;

      try {
        const result = await send(nextMessages, {
          signal: controller.signal,
          onDelta: (delta) => {
            streamingTextRef.current += delta;
            emitter.push(delta);
          },
        });
        emitter.flush();

        const streamedText = streamingTextRef.current;
        const finalText = streamedText !== "" ? streamedText : result.content;
        commitMessages([
          ...nextMessages,
          { role: "assistant", content: result.content, toolCalls: result.toolCalls },
        ]);

        if (finalText !== "") {
          appendEntry("assistant", finalText);
        } else if (result.toolCalls.length > 0) {
          appendToolCallNotice(result);
        } else {
          appendEntry("info", "（模型没有返回文本）");
        }
      } catch (error) {
        emitter.cancel();
        if (isAbortError(error)) {
          const partial = streamingTextRef.current;
          if (partial !== "") {
            commitMessages([
              ...nextMessages,
              { role: "assistant", content: partial, toolCalls: [] },
            ]);
            appendEntry("assistant", `${partial}\n（已中断）`);
          } else {
            appendEntry("info", "（生成已中断，没有输出）");
          }
        } else {
          const detail = error instanceof Error ? error.message : String(error);
          appendEntry("error", `请求失败：${detail}`);
          setErrorText(
            `请求失败：${detail}\n下一步：检查网络与 API key（.env 的 MEWCODE_API_KEY）后重试；按 Esc 可清空本行提示。`,
          );
        }
      } finally {
        emitterRef.current = null;
        abortRef.current = null;
        streamingTextRef.current = "";
        setStreaming("");
        setPhase("idle");
      }
    },
    [appendEntry, appendToolCallNotice, commitMessages, send, streamThrottleMs],
  );

  // 队列驱动：空闲且有排队消息时自动发送下一条。
  useEffect(() => {
    if (phase !== "idle" || queue.length === 0) {
      return;
    }

    const nextPrompt = queue[0];
    if (nextPrompt === undefined) {
      return;
    }

    setQueue(queue.slice(1));
    void start(nextPrompt);
  }, [phase, queue, start]);

  const handleSubmit = useCallback((value: string) => {
    setInput("");
    const prompt = value.trim();
    if (prompt === "") {
      return; // 空输入不请求、不报错
    }

    setQueue((previous) => [...previous, prompt]);
  }, []);

  useInput((typed, key) => {
    if (key.ctrl && typed === "c") {
      if (phase === "streaming") {
        abortRef.current?.abort();
      } else {
        exit();
      }

      return;
    }

    if (key.escape) {
      if (phase === "streaming") {
        abortRef.current?.abort();
        return;
      }

      setInput("");
      setErrorText(null);
    }
  });

  // 卸载时清掉定时器与未完成的请求，避免进程挂着不走。
  useEffect(() => {
    return () => {
      emitterRef.current?.cancel();
      abortRef.current?.abort();
    };
  }, []);

  // 布局完成后测量输入框位置，把终端光标放到 caret（IME 候选框跟随）。
  useEffect(() => {
    const node = inputBoxRef.current;
    if (node === null) {
      setCursorState(undefined);
      return;
    }

    const metrics = measureElement(node);
    if (metrics.width === 0 || metrics.height !== 1) {
      // 输入内容换行时无法可靠计算 caret（ink-text-input 不暴露光标偏移），先隐藏。
      setCursorState(undefined);
      return;
    }

    setCursorState({
      x: metrics.x + PROMPT_WIDTH + displayWidth(input),
      y: metrics.y,
    });
  }, [input, streaming, errorText, entries.length, phase]);

  setCursorPosition(cursorPosition);

  const statusLine = useMemo(() => {
    if (phase === "streaming") {
      return queue.length > 0
        ? `生成中… Esc 中断 · 已有 ${queue.length} 条排队`
        : "生成中… Esc 中断";
    }

    if (queue.length > 0) {
      return `准备发送排队消息（${queue.length} 条）…`;
    }

    return mock
      ? "就绪（mock 离线）· 回车发送 · Esc 清空 · Ctrl+C 退出"
      : "就绪 · 回车发送 · Esc 清空 · Ctrl+C 退出";
  }, [mock, phase, queue.length]);

  return (
    <Box flexDirection="column">
      <Static items={entries}>
        {(entry) => <HistoryItem key={entry.id} entry={entry} />}
      </Static>

      {streaming !== "" ? (
        <Box marginTop={1}>
          <Text>
            {streaming}
            <Text color="gray">▍</Text>
          </Text>
        </Box>
      ) : null}

      {errorText !== null ? (
        <Box marginTop={1}>
          <Text color="red">{errorText}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} ref={inputBoxRef}>
        <Text color={phase === "streaming" ? "gray" : "cyan"}>{PROMPT}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={
            phase === "streaming"
              ? "生成中，可先输入下一条（回车排队）"
              : "输入问题，回车发送"
          }
          showCursor
        />
      </Box>

      <Text dimColor>{statusLine}</Text>
    </Box>
  );
}
