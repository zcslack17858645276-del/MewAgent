// 流式文本的分行/截断纯逻辑（S2-7 修复：长输出在动态区重绘导致"叠字"）。
//
// 背景：Ink 的动态区每帧要靠"上移光标 + 清行"来重绘；一旦动态区高度超过终端高度，
// 超出屏幕的旧帧无法被清除、会留在 scrollback 里；用户拖动滚动条时这些旧帧更明显，
// 表现为同一段输出反复叠加。修法：把"已完成的行"立刻提交给 <Static>（只渲染一次、
// 永不重绘），动态区只留"最后一行还没写完的尾巴"，并对尾巴做长度上限。

export interface StreamSplit {
  /** 以 \n 结尾的完整行（不含行尾 \n；空行保留为空串）。 */
  readonly lines: readonly string[];
  /** 最后一个 \n 之后、还没写完的尾巴。 */
  readonly tail: string;
}

/** 把流式缓冲区拆成「已完成整行」+「未完成尾行」。 */
export function splitCompletedLines(buffer: string): StreamSplit {
  const lastNewline = buffer.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { lines: [], tail: buffer };
  }

  return {
    // 模型可能输出 CRLF：行尾 \r 属于换行符，不能当正文渲染（\r 会把终端光标拉回行首）。
    lines: buffer
      .slice(0, lastNewline)
      .split("\n")
      .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)),
    tail: buffer.slice(lastNewline + 1),
  };
}

/** 动态区尾巴最多显示的码点数（避免没有换行的超长单行把动态区撑爆）。 */
export const MAX_DYNAMIC_TAIL_CHARS = 800;

export interface ClampedTail {
  /** 实际显示在动态区的文本（超限时只保留末尾）。 */
  readonly text: string;
  /** 被隐藏的码点数（>0 时动态区可显示省略标记）。 */
  readonly hiddenChars: number;
}

/** 只保留尾巴最后 maxChars 个码点，避免切开代理对（emoji）。 */
export function clampDynamicTail(
  text: string,
  maxChars: number = MAX_DYNAMIC_TAIL_CHARS,
): ClampedTail {
  const points = Array.from(text);
  if (points.length <= maxChars) {
    return { text, hiddenChars: 0 };
  }

  return {
    text: points.slice(points.length - maxChars).join(""),
    hiddenChars: points.length - maxChars,
  };
}
