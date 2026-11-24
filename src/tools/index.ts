// 默认工具集入口（S2-6）：把 6 个工具装进一个 registry，供 loop / TUI / headless 使用。
//
// 与各工具文件解耦：这里只做"组装"，不实现任何工具逻辑，也不读环境变量。
// 需要裁剪工具集的场景（例如未来 headless 只允许只读工具）由调用方自行 new ToolRegistry。

import { bashTools } from "./bash.js";
import { fsTools } from "./fs.js";
import { ToolRegistry } from "./registry.js";
import { searchTools } from "./search.js";
import type { ToolDefinition } from "../types.js";

/** v0.1 全部 6 个工具（read/write/edit/glob/grep/bash），顺序即注册顺序。 */
export const defaultTools: readonly ToolDefinition[] = [
  ...fsTools,
  ...searchTools,
  ...bashTools,
];

/** 构造默认工具注册表；每次调用返回独立实例（避免测试间串状态）。 */
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry(defaultTools);
}
