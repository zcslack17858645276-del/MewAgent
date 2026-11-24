// 审批桥：把 `safety/permissions.ts` 的 `ask` 回调与 Ink UI 连接起来。
//
// 为什么不直接在 App 里创建 permission gate：
// - gate 在 index.ts 创建（需要 tools/workspace/模式），而 Ink 的状态要等
//   render 之后才有；二者创建时机不同。
// - 这个 controller 把「循环等待用户按键」拆成两半：`ask` 返回一个挂起的
//   Promise（供 gate 等待），`current()` / `subscribe()` 暴露 pending 状态
//   供 React 渲染 ApprovalPrompt，`respond()` 由按键调用解决 Promise。
//
// 不 import Ink / 不读 stdin：这边是纯逻辑，方便单测。

import type {
  ApprovalChoice,
  ApprovalPrompt,
  ApprovalRequest,
} from "../safety/permissions.js";

export interface ApprovalController {
  /** 传给 `createPermissionGate({ ask })` 的审批函数。 */
  readonly ask: ApprovalPrompt;
  /** 订阅 pending 变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;
  /** 当前等待中的审批；没有等待时为 null。 */
  current(): ApprovalRequest | null;
  /** UI 按键后调用：解决当前等待。没有等待时返回 false（按键被忽略）。 */
  respond(choice: ApprovalChoice): boolean;
}

interface PendingApproval {
  readonly request: ApprovalRequest;
  readonly resolve: (choice: ApprovalChoice) => void;
}

export function createApprovalController(): ApprovalController {
  const listeners = new Set<() => void>();
  let pending: PendingApproval | null = null;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const ask: ApprovalPrompt = (request) =>
    new Promise<ApprovalChoice>((resolve) => {
      // Agent Loop 串行执行工具，正常不会重叠；真重叠说明有 bug，显式报错比
      // 静默覆盖前一个审批更安全（gate 会把它当作审批失败按拒绝处理）。
      if (pending !== null) {
        throw new Error("已有审批在进行中，不能重复请求。");
      }

      pending = { request, resolve };
      notify();
    });

  return {
    ask,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: () => pending?.request ?? null,
    respond(choice) {
      if (pending === null) {
        return false;
      }

      const { resolve } = pending;
      pending = null;
      // 先通知 UI 收起审批、再解决 Promise：避免 gate 继续执行后产生的
      // tool_end 事件与审批弹窗同帧，界面出现一闪而过的残留。
      notify();
      resolve(choice);
      return true;
    },
  };
}
