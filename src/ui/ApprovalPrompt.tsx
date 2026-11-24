// 审批弹窗：显示工具名、参数摘要与 y/a/n/Esc 选项（方案 §4 S3、§6.9）。
//
// 输入权限说明：审批出现时 App 会让 InputBox 失焦，本组件独占按键；
// 只接受单字符 y/a/n（Esc 等同 n），其它键一律忽略——避免用户误按某个字符
// 就被当成"允许"，也避免字符漏进输入框。

import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";

import type { ApprovalChoice, ApprovalRequest } from "../safety/permissions.js";

export interface ApprovalPromptProps {
  readonly request: ApprovalRequest;
  readonly onDecision: (choice: ApprovalChoice) => void;
}

export function ApprovalPrompt({ request, onDecision }: ApprovalPromptProps): ReactElement {
  useInput((input, key) => {
    if (key.escape) {
      onDecision("n");
      return;
    }

    // 只接受单字符按键；忽略粘贴的多字符与其它组合键。
    if (input.length !== 1) {
      return;
    }

    const normalized = input.toLowerCase();
    if (normalized === "y") {
      onDecision("y");
      return;
    }
    if (normalized === "a") {
      onDecision("a");
      return;
    }
    if (normalized === "n") {
      onDecision("n");
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">
        ⚠ 需要审批：{request.toolName}（{request.readOnly ? "只读" : "写操作"}）
      </Text>
      <Text> {request.summary}</Text>
      {request.reason !== undefined ? <Text dimColor> {request.reason}</Text> : null}
      <Text>
        <Text color="green">y</Text> 允许一次 · <Text color="green">a</Text> 本会话总是允许此工具 ·{" "}
        <Text color="red">n</Text> 拒绝 · <Text color="red">Esc</Text> 拒绝
      </Text>
    </Box>
  );
}
