// 流式文本节流器（方案 §6.9：50ms 节流 setState，避免每个 token 重渲染）。
//
// 职责：把高频的 delta 累积成"最新全文"，最多每 delayMs 向上抛一次；
// 流结束时调用 flush() 把最后一段补上，保证不丢字。
// 时钟可注入，便于用假时钟做确定性测试。

export interface ThrottleClock {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/** 默认时钟：直接使用全局定时器（测试可替换）。 */
export const systemClock: ThrottleClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface ThrottledEmitterOptions {
  /** 每次触发时拿到"目前累积的完整文本"。 */
  emit: (text: string) => void;
  /** 节流间隔，默认 50ms（方案 §6.9）。 */
  delayMs?: number;
  /** 可注入时钟，默认系统时钟。 */
  clock?: ThrottleClock;
}

export class ThrottledEmitter {
  readonly #emit: (text: string) => void;
  readonly #delayMs: number;
  readonly #clock: ThrottleClock;
  #buffer = "";
  #lastEmitAt = Number.NEGATIVE_INFINITY;
  #timer: unknown = undefined;
  #dirty = false;

  constructor(options: ThrottledEmitterOptions) {
    this.#emit = options.emit;
    this.#delayMs = options.delayMs ?? 50;
    this.#clock = options.clock ?? systemClock;
  }

  /** 是否还有未抛出的文本。 */
  get pending(): boolean {
    return this.#dirty;
  }

  /** 追加一段流式文本。第一次调用立即触发，之后按节流间隔合并。 */
  push(delta: string): void {
    if (delta === "") {
      return;
    }

    this.#buffer += delta;
    this.#dirty = true;

    const now = this.#clock.now();
    if (this.#timer === undefined && now - this.#lastEmitAt >= this.#delayMs) {
      this.#emitNow(now);
      return;
    }

    this.#schedule(now);
  }

  /** 立即抛出当前累积文本（流结束 / 中断时调用）。 */
  flush(): void {
    this.#cancelTimer();
    if (!this.#dirty) {
      return;
    }

    this.#emitNow(this.#clock.now());
  }

  /** 丢弃未抛出的文本并停掉定时器（中断且不保留半截输出时使用）。 */
  cancel(): void {
    this.#cancelTimer();
    this.#buffer = "";
    this.#dirty = false;
  }

  #schedule(now: number): void {
    if (this.#timer !== undefined) {
      return;
    }

    const waitMs = Math.max(0, this.#delayMs - (now - this.#lastEmitAt));
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = undefined;
      if (this.#dirty) {
        this.#emitNow(this.#clock.now());
      }
    }, waitMs);
  }

  #emitNow(now: number): void {
    this.#lastEmitAt = now;
    this.#dirty = false;
    this.#emit(this.#buffer);
  }

  #cancelTimer(): void {
    if (this.#timer === undefined) {
      return;
    }

    this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
