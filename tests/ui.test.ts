// S1-4 TUI 的可自动化部分：列宽估算、50ms 流式节流器、历史条目渲染。
//
// 真正的交互（中文输入、Esc/Ctrl+C、拉伸、粘贴、排队）按 docs/testing.md
// S1-4 的 8 条 B 级手工项由用户在 Windows Terminal 里验收；这里保证
// 纯逻辑部分可回归，且渲染中文不会被截断/转义。

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToString } from "ink";
import { createElement } from "react";

import { HistoryItem, createHistoryEntry } from "../src/ui/HistoryItem.js";
import { ThrottledEmitter } from "../src/ui/throttle.js";
import type { ThrottleClock } from "../src/ui/throttle.js";
import { displayWidth } from "../src/ui/width.js";

interface FakeClock extends ThrottleClock {
  advance: (ms: number) => void;
  pendingTimers: () => number;
}

/** 假时钟：手动推进时间，让节流测试完全不依赖真实定时器。 */
function createFakeClock(): FakeClock {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();

  return {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

test("displayWidth：ASCII / 中文 / 中英混排 / 组合字符", () => {
  assert.equal(displayWidth(""), 0);
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("你好"), 4);
  assert.equal(displayWidth("You 好"), 6);
  assert.equal(displayWidth("ni'hao"), 6);
  assert.equal(displayWidth("e\u0301"), 1);
  assert.equal(displayWidth("❯ "), 2);
});

test("ThrottledEmitter：首次立即输出，窗口内合并为最新全文", () => {
  const clock = createFakeClock();
  const emitted: string[] = [];
  const emitter = new ThrottledEmitter({
    delayMs: 50,
    emit: (text) => emitted.push(text),
    clock,
  });

  emitter.push("你");
  assert.deepEqual(emitted, ["你"]);

  emitter.push("好");
  emitter.push("！");
  assert.deepEqual(emitted, ["你"], "窗口内不重复输出");
  assert.equal(emitter.pending, true);

  clock.advance(49);
  assert.deepEqual(emitted, ["你"], "未到 50ms 不应输出");

  clock.advance(1);
  assert.deepEqual(emitted, ["你", "你好！"], "到点输出累积的最新全文");
  assert.equal(emitter.pending, false);
  assert.equal(clock.pendingTimers(), 0);
});

test("ThrottledEmitter：flush 立即补上最后一段且不丢字", () => {
  const clock = createFakeClock();
  const emitted: string[] = [];
  const emitter = new ThrottledEmitter({
    delayMs: 50,
    emit: (text) => emitted.push(text),
    clock,
  });

  emitter.push("a");
  emitter.push("b");
  emitter.flush();
  assert.deepEqual(emitted, ["a", "ab"]);
  assert.equal(emitter.pending, false);
  assert.equal(clock.pendingTimers(), 0);

  // 已经 flush 后没有新增内容，再 flush 不应重复输出。
  emitter.flush();
  assert.deepEqual(emitted, ["a", "ab"]);
});

test("ThrottledEmitter：cancel 丢弃未输出内容并停掉定时器", () => {
  const clock = createFakeClock();
  const emitted: string[] = [];
  const emitter = new ThrottledEmitter({
    delayMs: 50,
    emit: (text) => emitted.push(text),
    clock,
  });

  emitter.push("x");
  emitter.push("y");
  emitter.cancel();
  clock.advance(100);
  assert.deepEqual(emitted, ["x"]);
  assert.equal(emitter.pending, false);
});

test("ThrottledEmitter：空 delta 不触发输出", () => {
  const clock = createFakeClock();
  const emitted: string[] = [];
  const emitter = new ThrottledEmitter({
    delayMs: 50,
    emit: (text) => emitted.push(text),
    clock,
  });

  emitter.push("");
  assert.deepEqual(emitted, []);
  assert.equal(emitter.pending, false);
  assert.equal(clock.pendingTimers(), 0);
});

test("HistoryItem：用户/助手/信息/错误条目都能渲染出中文原文", () => {
  const user = renderToString(
    createElement(HistoryItem, {
      entry: createHistoryEntry(1, "user", "请解释这段代码"),
    }),
  );
  assert.match(user, /❯/);
  assert.match(user, /请解释这段代码/);

  const assistant = renderToString(
    createElement(HistoryItem, {
      entry: createHistoryEntry(2, "assistant", "第一行\n第二行"),
    }),
  );
  assert.match(assistant, /第一行/);
  assert.match(assistant, /第二行/);

  const info = renderToString(
    createElement(HistoryItem, {
      entry: createHistoryEntry(3, "info", "（模型没有返回文本）"),
    }),
  );
  assert.match(info, /模型没有返回文本/);

  const error = renderToString(
    createElement(HistoryItem, {
      entry: createHistoryEntry(4, "error", "请求失败：401"),
    }),
  );
  assert.match(error, /请求失败：401/);
});
