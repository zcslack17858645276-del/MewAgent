// S4-1：统一错误描述（"发生了什么 + 下一步怎么做"）。
//
// 约束：
// - 纯函数、无依赖，TUI（App.tsx）与 headless（index.ts）共用同一套措辞，避免两条链路各写一份；
// - 不 import LLM 模块（AGENTS §4：UI 不直接依赖 LLM 实现）——LLM 的错误用结构化鸭子类型识别；
// - 不拼接 ANSI/颜色：显示层自己决定颜色。

/** 把错误翻译成"发生了什么"与"下一步"；两段都不含前缀，由调用方拼接。 */
export interface FailureDescription {
  /** 发生了什么（一句话，可包含 HTTP 状态等细节）。 */
  readonly what: string;
  /** 下一步怎么做（可操作的具体建议）。 */
  readonly next: string;
}

/** HTTP 状态码 → 下一步建议（与 S1-5 的措辞保持一致）。 */
export function describeHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "检查 .env 里的 MEWCODE_API_KEY 是否有效、是否还有余额。";
  }
  if (status === 404) {
    return "检查 MEWCODE_BASE_URL 是否正确（DeepSeek 为 https://api.deepseek.com，OpenAI 兼容服务通常以 /v1 结尾）。";
  }
  if (status === 429) {
    return "供应商限流或额度不足：稍后重试，或检查账户额度。";
  }
  if (status >= 500) {
    return "供应商服务暂时不可用：稍后重试。";
  }
  return "检查 API key、base-url 与模型名后重试。";
}

/** 区分"网络层失败"（代理/断网）与程序错误，给出可操作提示。 */
export function isNetworkFailure(error: unknown): error is TypeError {
  return (
    error instanceof TypeError &&
    /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(
      error.message,
    )
  );
}

interface LlmHttpErrorLike {
  readonly name: "LlmHttpError";
  readonly status: number;
  readonly message: string;
}

function isLlmHttpErrorLike(error: unknown): error is LlmHttpErrorLike {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record["name"] === "LlmHttpError" &&
    typeof record["status"] === "number" &&
    typeof record["message"] === "string"
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** 错误对象 → {what, next}：HTTP / 网络 / 中断 / 其它。 */
export function describeFailure(error: unknown): FailureDescription {
  if (isLlmHttpErrorLike(error)) {
    return { what: error.message, next: describeHttpStatus(error.status) };
  }
  if (isNetworkFailure(error)) {
    return {
      what: `网络请求失败：${error.message}`,
      next: "检查网络连接与代理（本机可用 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890）后重试。",
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { what: "请求已中断（Esc / Ctrl+C）。", next: "如果还要继续，重新输入问题即可。" };
  }
  return {
    what: `请求失败：${errorMessage(error)}`,
    next: "检查网络与 API key（.env 的 MEWCODE_API_KEY）后重试；按 Esc 可清空本行提示。",
  };
}

/** 工具失败输出（`Error: ...\n下一步：...`）→ 首行 + 下一步；供 TUI 历史区展示。 */
export function describeToolFailure(output: string): { what: string; next: string | null } {
  const lines = output.split("\n");
  const what = (lines.find((line) => line.trim() !== "") ?? "").trim();
  const nextLine = lines.find((line) => line.trim().startsWith("下一步："));
  return {
    what: what.replace(/^Error:\s*/u, ""),
    next: nextLine === undefined ? null : nextLine.trim().replace(/^下一步：\s*/u, ""),
  };
}
