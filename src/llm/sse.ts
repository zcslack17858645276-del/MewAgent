// S1-1 SSE 逐行解析：把 fetch 的字节流还原成一条条 `data:` 负载。
//
// 为什么单独成文件：分帧、多字节 UTF-8 被切断、CRLF、`[DONE]` 结束标记都是
// 容易写错的边界；抽成 async generator 后可以用假 ReadableStream 单测，
// 不必起网络。S1-2 的 openai.ts 只负责把负载 JSON.parse 成 delta。

/** `data:` 字段前缀（SSE 允许冒号后带一个空格，也允许直接跟值）。 */
const DATA_FIELD_PREFIX = "data:";

/** OpenAI 兼容流式的结束标记，不交给调用方做 JSON.parse。 */
const DONE_MARKER = "[DONE]";

export interface ParseSseOptions {
  /** 调用方中断时传入；中断后生成器以 name === "AbortError" 的错误结束。 */
  signal?: AbortSignal;
}

function createAbortError(): Error {
  const error = new Error("SSE 解析已被中断。");
  error.name = "AbortError";
  return error;
}

/**
 * 把 `ReadableStream<Uint8Array>` 解析成一条条 `data:` 负载字符串。
 *
 * - 按 SSE 规范以空行分帧；同一帧内多行 `data:` 用 `\n` 连接；
 * - 同时支持 `\n` 与 `\r\n` 行尾，以及行尾被拆到两个 chunk 的情况；
 * - 忽略空行、`:` 注释行与 `event:` / `id:` / `retry:` 等本项目用不到的字段；
 * - `data: [DONE]` 作为结束信号：不输出、不报错，生成器正常返回；
 * - `TextDecoder(..., { stream: true })` 处理跨 chunk 被切断的多字节字符；
 * - 流结束或尾部没有换行时，提交缓冲区里的最后一帧（方案 §7.1：最后一条不丢）。
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseSseOptions = {},
): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder("utf-8");
  const { signal } = options;
  let buffer = "";
  let pendingData: string[] = [];
  let isFirstChunk = true;

  const throwIfAborted = (): void => {
    if (signal?.aborted === true) throw createAbortError();
  };

  /** 把已累计的多行 data 合成一条负载；没有 data 时返回 null。 */
  const takePayload = (): string | null => {
    if (pendingData.length === 0) return null;
    const payload = pendingData.join("\n");
    pendingData = [];
    // `data:` 后为空的行不构成有效事件，直接丢掉，避免调用方 JSON.parse("")。
    return payload === "" ? null : payload;
  };

  /** 消费一整行；返回要 yield 的负载、是否遇到 `[DONE]`。 */
  const consumeLine = (rawLine: string): { payload: string | null; done: boolean } => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (line === "") {
      const payload = takePayload();
      if (payload === null) return { payload: null, done: false };
      if (payload === DONE_MARKER) return { payload: null, done: true };
      return { payload, done: false };
    }

    if (line.startsWith(":") || !line.startsWith(DATA_FIELD_PREFIX)) {
      return { payload: null, done: false };
    }

    const value = line.slice(DATA_FIELD_PREFIX.length);
    pendingData.push(value.startsWith(" ") ? value.slice(1) : value);
    return { payload: null, done: false };
  };

  for await (const chunk of stream) {
    throwIfAborted();

    let text = decoder.decode(chunk, { stream: true });
    if (isFirstChunk) {
      isFirstChunk = false;
      // SSE 规范允许流以 BOM 开头；不剥掉会让第一条 data 字段匹配失败。
      if (text.startsWith("\uFEFF")) text = text.slice(1);
    }
    buffer += text;

    let consumed = 0;
    for (;;) {
      const newlineIndex = buffer.indexOf("\n", consumed);
      if (newlineIndex === -1) break;
      const result = consumeLine(buffer.slice(consumed, newlineIndex));
      consumed = newlineIndex + 1;
      if (result.done) return;
      if (result.payload !== null) yield result.payload;
    }
    buffer = buffer.slice(consumed);
  }

  throwIfAborted();

  // 流已结束：冲掉 TextDecoder 里可能残留的半个字符。
  buffer += decoder.decode();

  // 尾部可能是一行没有换行符的 data，也可能是本帧还没等到空行；
  // 两者都按“最后一条不丢”处理。
  if (buffer.length > 0) {
    const result = consumeLine(buffer);
    buffer = "";
    if (result.done) return;
    if (result.payload !== null) yield result.payload;
  }

  const tail = takePayload();
  if (tail !== null) yield tail;
}
