// S1-1 SSE 逐行解析测试：分块、UTF-8 截断、CRLF、注释、[DONE]、尾部残留。
//
// 这里只喂假 ReadableStream，不碰网络；重点覆盖“一行被拆成多块”这类
// 真实 fetch 流里一定会遇到的边界（方案 §7.1）。

import assert from "node:assert/strict";
import test from "node:test";

import { parseSseStream } from "../src/llm/sse.js";

const encoder = new TextEncoder();

/** 用字符串或原始字节拼一个一次性 ReadableStream。 */
function streamOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

/** 跑完解析器，收集全部负载。 */
async function collect(
  chunks: readonly (string | Uint8Array)[],
  signal?: AbortSignal,
): Promise<string[]> {
  const payloads: string[] = [];
  for await (const payload of parseSseStream(streamOf(chunks), { signal })) {
    payloads.push(payload);
  }
  return payloads;
}

test("SSE：两条完整事件按顺序返回", async () => {
  const payloads = await collect(['data: {"n":1}\n\ndata: {"n":2}\n\n']);
  assert.deepEqual(payloads, ['{"n":1}', '{"n":2}']);
});

test("SSE：一行被拆成 3 块仍拼回完整事件", async () => {
  const payloads = await collect(['data: {"a"', ':1}', "\n\n"]);
  assert.deepEqual(payloads, ['{"a":1}']);
});

test("SSE：UTF-8 多字节字符被 chunk 边界切断也不乱码", async () => {
  const line = 'data: {"text":"你好"}\n\n';
  const encoded = encoder.encode(line);
  const charIndex = line.indexOf("你");
  assert.ok(charIndex >= 0);

  // 在“你”的 UTF-8 字节中间切开（3 字节字符只放前 1 字节到第一个 chunk）。
  const byteOffset = encoder.encode(line.slice(0, charIndex)).length;
  const cut = byteOffset + 1;
  const payloads = await collect([encoded.slice(0, cut), encoded.slice(cut)]);

  assert.deepEqual(payloads, ['{"text":"你好"}']);
});

test("SSE：CRLF 行尾（含 \\r 与 \\n 被拆开）正确识别", async () => {
  const payloads = await collect(["data: one\r", "\n\r", "\ndata: two\r\n\r\n"]);
  assert.deepEqual(payloads, ["one", "two"]);
});

test("SSE：空行与 `:` 注释行被忽略", async () => {
  const payloads = await collect([": ping\n\n\n", "data: x\n\n"]);
  assert.deepEqual(payloads, ["x"]);
});

test("SSE：同一帧内多行 data 用换行连接", async () => {
  const payloads = await collect(["data: a\ndata: b\n\n"]);
  assert.deepEqual(payloads, ["a\nb"]);
});

test("SSE：`data:` 后不带空格也支持", async () => {
  const payloads = await collect(['data:{"x":1}\n\n']);
  assert.deepEqual(payloads, ['{"x":1}']);
});

test("SSE：`[DONE]` 不输出、不报错，且忽略其后的数据", async () => {
  const payloads = await collect(["data: a\n\ndata: [DONE]\n\ndata: ignored\n\n"]);
  assert.deepEqual(payloads, ["a"]);
});

test("SSE：尾部没有换行符时最后一条不丢", async () => {
  assert.deepEqual(await collect(["data: tail"]), ["tail"]);
  assert.deepEqual(await collect(["data: a\n\ndata: b"]), ["a", "b"]);
});

test("SSE：event/id/retry 等非 data 字段被忽略", async () => {
  const payloads = await collect(["event: message\nid: 1\nretry: 1000\ndata: ok\n\n"]);
  assert.deepEqual(payloads, ["ok"]);
});

test("SSE：流开头的 BOM 不影响第一条 data", async () => {
  const payloads = await collect(["\uFEFFdata: bom\n\n"]);
  assert.deepEqual(payloads, ["bom"]);
});

test("SSE：空 data（data: 后什么都没有）不产生负载", async () => {
  assert.deepEqual(await collect(["data:\n\n"]), []);
});

test("SSE：signal 已中止时以 AbortError 结束", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    collect(["data: x\n\n"], controller.signal),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});
