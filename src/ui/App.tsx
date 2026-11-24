// S2-7：TUI 消费 AgentEvent（assistant_text / tool_start / tool_end / turn_end）。
//
// 边界（方案 §3.1）：本组件不 import LLM 客户端、不 import Agent Loop、不发 HTTP；
// 真正的"跑一轮"函数由入口注入（`runTurn`），UI 只把事件渲染成历史/状态行。
//
// 关键行为（方案 §6.9）：
// - 已提交的历史用 <Static> 一次性渲染，动态区只重绘流式文本/工具状态/输入框，避免闪屏；
// - 流式文本按「整行」提交进 Static（动态区只留最后一行未写完的尾巴，且尾巴有长度上限）：
//   Ink 只能擦除屏幕内的行，动态区一旦高于终端就会把旧帧留在 scrollback 里，用户滚动时
//   表现为同一段输出反复叠加；按行提交后已提交内容永不重绘，从结构上消除该问题；
// - 未成行的尾巴按 50ms 合并刷新，不是每个 token setState；
// - 工具结束立刻提交为历史项（✅/❌ + 参数摘要 + 耗时），事件顺序即历史顺序；
// - 生成/工具运行中 Esc / Ctrl+C 只 abort；空闲时 Ctrl+C 退出；
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import type { AgentLoopResult } from "../agent/loop.js";
import type { ApprovalChoice, ApprovalRequest } from "../safety/permissions.js";
import type { AgentEvent, Message } from "../types.js";
import type { ApprovalController } from "./approval.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { HistoryItem, createHistoryEntry } from "./HistoryItem.js";
import type { HistoryEntry, HistoryEntryKind } from "./HistoryItem.js";
import { InputBox } from "./InputBox.js";
import {
  CONTINUATION_WIDTH,
  PROMPT_WIDTH,
  lineAndColumn,
  splitLines,
} from "./input-text.js";
import { clampDynamicTail, splitCompletedLines } from "./stream-lines.js";
import {
  formatToolCall,
  formatToolEnd,
  formatTurnEndNote,
} from "./tool-display.js";
import { displayWidth } from "./width.js";

/** 入口注入的一轮执行函数：给完整消息历史 + 事件回调，返回 loop 最终结果。 */
export interface AgentTurnOptions {
  readonly signal: AbortSignal;
  readonly emit: (event: AgentEvent) => void;
}

export type RunAgentTurn = (
  messages: readonly Message[],
  options: AgentTurnOptions,
) => Promise<AgentLoopResult>;

export interface AppProps {
  readonly version: string;
  readonly model: string;
  readonly workspace: string;
  readonly mock: boolean;
  /** 已注册的工具名，仅用于启动横幅展示（真正执行在入口注入的 runTurn 里）。 */
  readonly toolNames: readonly string[];
  readonly runTurn: RunAgentTurn;
  /** 审批桥（S3-2）：存在时，权限闸询问会以审批弹窗形式出现在动态区。 */
  readonly approvals?: ApprovalController | undefined;
  /** 会话恢复（S3-3）：上次会话的历史消息（不含 system）。 */
  readonly initialMessages?: readonly Message[] | undefined;
  /** 会话恢复（S3-3）：恢复的消息条数，>0 时在历史区顶部提示。 */
  readonly restoredMessageCount?: number | undefined;
  /** 会话恢复（S3-3）：加载异常（损坏等）时的提示文案。 */
  readonly sessionNotice?: string | undefined;
  /** 会话保存（S3-3）：每轮结束回调，由入口写入 .mewcode/session.json。 */
  readonly persistMessages?: ((messages: readonly Message[]) => void) | undefined;
  /** 流式刷新间隔，默认 50ms（方案 §6.9）；测试可调小。 */
  readonly streamThrottleMs?: number;
}

type Phase = "idle" | "streaming" | "tool_running";

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
  toolNames,
  runTurn,
  approvals,
  initialMessages,
  restoredMessageCount = 0,
  sessionNotice,
  persistMessages,
  streamThrottleMs = 50,
}: AppProps): ReactElement {
  const { exit } = useApp();
  const { setCursorPosition } = useCursor();

  // Ink 的 <Static items> 要求可变数组，所以这里不用 readonly。
  const [entries, setEntries] = useState<HistoryEntry[]>(() => {
    const base: HistoryEntry[] = [
      createHistoryEntry(
        0,
        "info",
        `MewAgent ${version}${mock ? "（mock 离线模式）" : ""} · 模型 ${model}`,
      ),
      createHistoryEntry(1, "info", `工作区 ${workspace}`),
      createHistoryEntry(
        2,
        "info",
        `工具：${toolNames.length > 0 ? toolNames.join("、") : "（无）"}`,
      ),
      createHistoryEntry(
        3,
        "info",
        "输入问题后回车发送；工具调用会显示在历史区（✅/❌ + 耗时）。生成中 Esc 中断，空闲 Ctrl+C 退出。",
      ),
    ];

    if (restoredMessageCount > 0) {
      base.push(
        createHistoryEntry(
          base.length,
          "info",
          `已恢复 ${restoredMessageCount} 条消息（上次会话继续；--new 可开新会话）。`,
        ),
      );
    }
    if (sessionNotice !== undefined) {
      base.push(createHistoryEntry(base.length, "error", sessionNotice));
    }
    return base;
  });
  const nextIdRef = useRef(entries.length);
  // S2-7 起消息历史由 Agent Loop 维护（含 tool 消息），UI 只保存 loop 返回的完整历史。
  // S3-3：启动时可用上次会话的消息作为初始历史（loop 会重建 system prompt）。
  const [messages, setMessages] = useState<Message[]>(() => [...(initialMessages ?? [])]);
  const messagesRef = useRef<Message[]>(messages);
  const [input, setInput] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const [streaming, setStreaming] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  // S3-2：等待用户审批的工具调用。非 null 时 ApprovalPrompt 独占按键。
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [cursorPosition, setCursorState] = useState<CursorPosition | undefined>(undefined);

  const abortRef = useRef<AbortController | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputBoxRef = useRef<DOMElement | null>(null);

  const appendEntry = useCallback((kind: HistoryEntryKind, text: string) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setEntries((previous) => [...previous, createHistoryEntry(id, kind, text)]);
  }, []);

  // 流式文本按「整行」批量提交进 Static：一次 setState 追加多行，避免逐行 setState。
  const appendStreamLines = useCallback((lines: readonly string[]) => {
    if (lines.length === 0) {
      return;
    }

    const firstId = nextIdRef.current;
    nextIdRef.current += lines.length;
    const appended = lines.map((text, index) => createHistoryEntry(firstId + index, "stream", text));
    setEntries((previous) => [...previous, ...appended]);
  }, []);

  const commitMessages = useCallback((next: Message[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  /** 发送一轮：事件流 → 历史区；被中断时保留已输出内容与已完成的工具项。 */
  const start = useCallback(
    async (prompt: string): Promise<void> => {
      const nextMessages: Message[] = [...messagesRef.current, { role: "user", content: prompt }];
      commitMessages(nextMessages);
      appendEntry("user", prompt);
      setErrorText(null);
      setStreaming("");
      setToolStatus(null);
      setPhase("streaming");

      const controller = new AbortController();
      abortRef.current = controller;

      // 未提交的流式尾巴（最后一个 \n 之后的部分）；已完成的行会立刻交给 Static。
      let buffer = "";
      let hadText = false;

      const clearFlushTimer = (): void => {
        if (flushTimerRef.current !== null) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
      };

      /** 提交完整行；final=true 时把尾巴也作为最后一行提交并清空动态区。 */
      const flushStream = (final: boolean): void => {
        clearFlushTimer();
        const { lines, tail } = splitCompletedLines(buffer);
        buffer = tail;
        appendStreamLines(lines);

        if (final) {
          if (buffer !== "") {
            appendStreamLines([buffer]);
            buffer = "";
          }
          setStreaming("");
          return;
        }

        // 尾巴末尾若是还没等到 \n 的 \r（CRLF 被拆开），显示时先剥掉，避免光标跑回行首。
        const displayBuffer = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
        const clamped = clampDynamicTail(displayBuffer);
        setStreaming(clamped.hiddenChars > 0 ? `…${clamped.text}` : clamped.text);
      };

      const scheduleFlush = (): void => {
        if (flushTimerRef.current !== null) {
          return;
        }

        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          flushStream(false);
        }, streamThrottleMs);
      };

      try {
        const result = await runTurn(nextMessages, {
          signal: controller.signal,
          emit: (event) => {
            switch (event.type) {
              case "assistant_text": {
                buffer += event.delta;
                hadText = true;
                if (buffer.includes("\n")) {
                  // 有完整行就立即提交：动态区只留尾巴，长输出不会把动态区撑出屏幕。
                  flushStream(false);
                } else {
                  scheduleFlush();
                }
                break;
              }
              case "tool_start": {
                flushStream(true);
                setToolStatus(formatToolCall(event.call));
                setPhase("tool_running");
                break;
              }
              case "tool_end": {
                appendEntry(
                  event.result.ok ? "info" : "error",
                  formatToolEnd(event.call, event.result, event.durationMs),
                );
                setToolStatus(null);
                setPhase("streaming");
                break;
              }
              case "turn_end": {
                break;
              }
            }
          },
        });
        flushStream(true);
        commitMessages(result.messages.filter((message) => message.role !== "system"));

        const note = formatTurnEndNote(result.stopReason);
        if (note !== null) {
          appendEntry("info", note);
        }
      } catch (error) {
        clearFlushTimer();
        flushStream(true);
        if (isAbortError(error)) {
          if (hadText) {
            appendEntry("info", "（已中断）");
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
        clearFlushTimer();
        abortRef.current = null;
        setStreaming("");
        setToolStatus(null);
        setPhase("idle");
        // S3-3：每轮结束落盘（含被中断的轮次）；保存失败由入口打警告，不阻塞 UI。
        persistMessages?.(messagesRef.current);
      }
    },
    [appendEntry, appendStreamLines, commitMessages, persistMessages, runTurn, streamThrottleMs],
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
    setCursorOffset(0);
    const prompt = value.trim();
    if (prompt === "") {
      return; // 空输入不请求、不报错
    }

    setQueue((previous) => [...previous, prompt]);
  }, []);

  // 审批桥 → React 状态：gate 调 ask 时出现弹窗，respond 后收起。
  useEffect(() => {
    if (approvals === undefined) {
      return;
    }

    const syncPending = (): void => {
      setPendingApproval(approvals.current());
    };
    syncPending();
    return approvals.subscribe(syncPending);
  }, [approvals]);

  const decideApproval = useCallback(
    (choice: ApprovalChoice) => {
      approvals?.respond(choice);
    },
    [approvals],
  );

  const busy = phase !== "idle";

  useInput((typed, key) => {
    // 审批时按键归 ApprovalPrompt（y/a/n/Esc）；这里只保留 Ctrl+C 中断整轮。
    if (pendingApproval !== null) {
      if (key.ctrl && typed === "c") {
        approvals?.respond("n");
        abortRef.current?.abort();
      }

      return;
    }

    if (key.ctrl && typed === "c") {
      if (busy) {
        abortRef.current?.abort();
      } else {
        exit();
      }

      return;
    }

    if (key.escape) {
      if (busy) {
        abortRef.current?.abort();
        return;
      }

      setInput("");
      setCursorOffset(0);
      setErrorText(null);
    }
  });

  // 卸载时清掉定时器与未完成的请求，避免进程挂着不走。
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, []);

  // 布局完成后测量输入框位置，把终端光标放到 caret（IME 候选框跟随）。
  // 多行时 y 需要加上 caret 所在行号，x 需要加上该行的前缀宽度（首行提示符/续行缩进）。
  useEffect(() => {
    const node = inputBoxRef.current;
    if (node === null || pendingApproval !== null) {
      setCursorState(undefined);
      return;
    }

    const metrics = measureElement(node);
    if (metrics.width === 0) {
      setCursorState(undefined);
      return;
    }

    const { lineIndex, columnIndex } = lineAndColumn(input, cursorOffset);
    const lines = splitLines(input);
    const line = lines[lineIndex] ?? "";
    const prefixWidth = lineIndex === 0 ? PROMPT_WIDTH : CONTINUATION_WIDTH;
    setCursorState({
      x: metrics.x + prefixWidth + displayWidth(line.slice(0, columnIndex)),
      y: metrics.y + lineIndex,
    });
  }, [input, cursorOffset, pendingApproval, streaming, toolStatus, errorText, entries.length, phase]);

  setCursorPosition(cursorPosition);

  const statusLine = useMemo(() => {
    if (pendingApproval !== null) {
      return "等待审批：y 允许 · a 本会话总是允许 · n/Esc 拒绝";
    }

    if (phase === "tool_running") {
      return toolStatus !== null
        ? `工具运行中：${toolStatus}（Esc 中断）`
        : "工具运行中…（Esc 中断）";
    }

    if (phase === "streaming") {
      return queue.length > 0
        ? `生成中… Esc 中断 · 已有 ${queue.length} 条排队`
        : "生成中… Esc 中断";
    }

    if (queue.length > 0) {
      return `准备发送排队消息（${queue.length} 条）…`;
    }

    return mock
      ? "就绪（mock 离线）· Enter 发送 · Shift+Enter 换行 · Esc 清空 · Ctrl+C 退出"
      : "就绪 · Enter 发送 · Shift+Enter 换行 · Esc 清空 · Ctrl+C 退出";
  }, [mock, pendingApproval, phase, queue.length, toolStatus]);

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

      {phase === "tool_running" && toolStatus !== null && pendingApproval === null ? (
        <Box marginTop={1}>
          <Text color="yellow">⚙ {toolStatus}…</Text>
        </Box>
      ) : null}

      {pendingApproval !== null ? (
        <ApprovalPrompt request={pendingApproval} onDecision={decideApproval} />
      ) : null}

      {errorText !== null ? (
        <Box marginTop={1}>
          <Text color="red">{errorText}</Text>
        </Box>
      ) : null}

      <Box marginTop={1} ref={inputBoxRef}>
        <InputBox
          value={input}
          cursorOffset={cursorOffset}
          onChange={(value, offset) => {
            setInput(value);
            setCursorOffset(offset);
          }}
          onSubmit={handleSubmit}
          active={pendingApproval === null}
          placeholder={
            pendingApproval !== null
              ? "审批中：按键交给上方提示（y/a/n/Esc）"
              : busy
                ? "生成中，可先输入下一条（Enter 排队，Shift+Enter 换行）"
                : "输入问题（Enter 发送，Shift+Enter 换行）"
          }
          promptColor={busy || pendingApproval !== null ? "gray" : "cyan"}
        />
      </Box>

      <Text dimColor>{statusLine}</Text>
    </Box>
  );
}
