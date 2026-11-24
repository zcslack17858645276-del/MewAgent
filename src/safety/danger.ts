/**
 * 危险命令识别（S3-1）。
 *
 * 只做字符串层面的模式匹配，不执行任何命令；供 `permissions.ts` 在询问用户前
 * 硬拦截明显破坏性的操作（`rm -rf` / `format` / `shutdown` / 写入系统目录 等）。
 * 规则故意保守：宁可漏判（交给人工审批）也不误杀正常命令。
 *
 * 为什么用"按分隔符切段 + 取首 token 当命令名"：`git commit -m "rm -rf fix"`
 * 这类把危险字样当参数的正常命令不能被误拦，所以只检查每段的命令名与标志位。
 */

export interface DangerCheck {
  /** 是否命中任一危险规则。 */
  readonly dangerous: boolean;
  /** 命中的规则 id（便于日志与测试断言）。 */
  readonly ruleId?: string;
  /** 面向用户的短语原因（由调用方拼成完整错误，如"危险命令，已硬拦截：…"）。 */
  readonly reason?: string;
}

interface CommandContext {
  readonly command: string;
  readonly segments: readonly (readonly string[])[];
}

interface DangerRule {
  readonly id: string;
  readonly reason: string;
  readonly matches: (context: CommandContext) => boolean;
}

/** Windows 系统目录（token 以盘符或裸目录开头）。 */
const SYSTEM_PATH_RE =
  /^(?:[a-z]:\\+)?(?:windows|program files|programdata|system32|users\\+public)(?:\\|$)/i;

/** POSIX 系统目录。 */
const POSIX_SYSTEM_PATH_RE =
  /^\/(?:etc|bin|sbin|usr|boot|dev|proc|sys|lib|lib64)(?:\/|$)/;

/** 会修改文件的命令名（用于"写系统目录"判断）。 */
const DESTRUCTIVE_COMMANDS = new Set([
  "rm",
  "del",
  "erase",
  "rd",
  "rmdir",
  "mv",
  "move",
  "copy",
  "xcopy",
  "robocopy",
  "format",
  "icacls",
  "takeown",
  "cacls",
  "attrib",
  "chmod",
  "chown",
  "ln",
  "mklink",
  "tee",
]);

/** 前缀包装器：去掉后继续分析真实命令（`sudo rm -rf …`）。 */
const TOKEN_WRAPPERS = new Set(["sudo", "doas", "env", "nohup", "time", "command", "exec"]);

/** 壳程序：`bash -c "…"` / `cmd /c …` / `powershell -Command …`。 */
const SHELL_WRAPPERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "powershell", "pwsh", "cmd"]);

/**
 * 剥掉包装器与壳，返回真正要分析的片段。
 * 限制递归层数，防止恶意嵌套导致过深调用。
 */
function unwrapSegments(tokens: readonly string[], depth = 0): string[][] {
  if (tokens.length === 0) {
    return [];
  }
  if (depth >= 4) {
    return [[...tokens]];
  }
  const tool = baseToolName(tokens);
  if (TOKEN_WRAPPERS.has(tool)) {
    return unwrapSegments(tokens.slice(1), depth + 1);
  }
  if (!SHELL_WRAPPERS.has(tool)) {
    return [[...tokens]];
  }

  const rest = tokens.slice(1);
  const flagIndex = rest.findIndex((token) => /^(?:-c|-command|\/c|\/k)$/i.test(token));
  const isPowerShell = tool === "powershell" || tool === "pwsh";
  if (flagIndex === -1) {
    if (isPowerShell) {
      // `powershell Remove-Item -Recurse -Force X`：后续参数本身就是内层命令。
      return splitSegments(rest.join(" "));
    }
    // `bash script.sh` / `cmd /k` 等无法安全内联分析，保留外层片段。
    return [[...tokens]];
  }
  return splitSegments(rest.slice(flagIndex + 1).join(" "));
}

/** 把命令按 `;` / `&&` / `||` / `|` / 换行切成独立片段（并剥掉包装器）。 */
function splitSegments(command: string): string[][] {
  return command
    .split(/(?:&&|\|\||[;|\n])/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => unwrapSegments(tokenize(segment)));
}

/** 简单分词：保留引号内空格，去掉外层引号。 */
function tokenize(segment: string): string[] {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    token.length >= 2 && (token.startsWith('"') || token.startsWith("'"))
      ? token.slice(1, -1)
      : token,
  );
}

/** 取命令名（去掉目录与 .exe 后缀，转小写）。 */
function baseToolName(tokens: readonly string[]): string {
  const raw = tokens[0] ?? "";
  const base = raw.replace(/^.*[\\/]/, "").toLowerCase();
  return base.replace(/\.exe$/, "");
}

/** 收集标志位（排除命令名本身）。 */
function collectFlags(tokens: readonly string[]): string[] {
  return tokens
    .slice(1)
    .filter((token) => token.startsWith("-") || /^\/[a-zA-Z]{1,5}$/.test(token))
    .map((token) => token.toLowerCase());
}

/** 短标志（`-rf` 含 r；Windows `/s`）；长标志由 longFlag 单独判断。 */
function shortFlag(flags: readonly string[], letter: string): boolean {
  const target = letter.toLowerCase();
  return flags.some((flag) => {
    if (flag.startsWith("--")) {
      return false;
    }
    if (flag.startsWith("-")) {
      return flag.slice(1).includes(target);
    }
    if (flag.startsWith("/") && flag.length === 2) {
      return flag.slice(1) === target;
    }
    return false;
  });
}

/** 长标志（`--recursive` / `--force`）。 */
function longFlag(flags: readonly string[], name: string): boolean {
  return flags.some((flag) => flag === `--${name}`);
}

/** 整段里是否出现某个 PowerShell 风格参数（`-Recurse` / `-Force`）。 */
function hasPowerShellFlag(tokens: readonly string[], name: string): boolean {
  return tokens.some((token) => token.toLowerCase() === `-${name.toLowerCase()}`);
}

function isSystemPath(token: string): boolean {
  return SYSTEM_PATH_RE.test(token) || POSIX_SYSTEM_PATH_RE.test(token);
}

function isDestructiveTool(tool: string): boolean {
  return DESTRUCTIVE_COMMANDS.has(tool);
}

/** "写系统目录"：该段有破坏性命令或重定向，且目标落在系统目录。 */
function writesSystemPath(tokens: readonly string[]): boolean {
  const tool = baseToolName(tokens);
  const redirects = tokens.some((token) => token === ">" || token === ">>");
  if (!isDestructiveTool(tool) && !redirects) {
    return false;
  }
  return tokens.some((token) => {
    if (isSystemPath(token)) {
      return true;
    }
    // 兼容 `>C:\Windows\...` 这种重定向与目标粘连的写法。
    if ((token.startsWith(">") || token.startsWith(">>")) && isSystemPath(token.replace(/^>+/, ""))) {
      return true;
    }
    return false;
  });
}

const DANGER_RULES: readonly DangerRule[] = [
  {
    id: "rm-recursive-force",
    reason: "递归强制删除（rm -rf）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        if (tool !== "rm") {
          return false;
        }
        const flags = collectFlags(tokens);
        const recursive = shortFlag(flags, "r") || longFlag(flags, "recursive");
        const force = shortFlag(flags, "f") || longFlag(flags, "force");
        return recursive && force;
      }),
  },
  {
    id: "powershell-remove-item",
    reason: "PowerShell 递归强制删除（Remove-Item -Recurse -Force）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        if (!["remove-item", "ri", "rm", "rd", "rmdir", "del", "erase"].includes(tool)) {
          return false;
        }
        return hasPowerShellFlag(tokens, "Recurse") && hasPowerShellFlag(tokens, "Force");
      }),
  },
  {
    id: "rmdir-recursive",
    reason: "递归删除目录（rmdir /s）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        if (tool !== "rmdir" && tool !== "rd") {
          return false;
        }
        const flags = collectFlags(tokens);
        return shortFlag(flags, "s");
      }),
  },
  {
    id: "del-force-recursive",
    reason: "强制递归删除文件（del /f /s /q）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        if (tool !== "del" && tool !== "erase") {
          return false;
        }
        const flags = collectFlags(tokens);
        const force = shortFlag(flags, "f");
        const recursive = shortFlag(flags, "s") || shortFlag(flags, "q");
        return force && recursive;
      }),
  },
  {
    id: "deltree",
    reason: "删除整棵目录树（deltree）",
    matches: ({ segments }) => segments.some((tokens) => baseToolName(tokens) === "deltree"),
  },
  {
    id: "format",
    reason: "格式化磁盘（format）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        return tool === "format" || tool === "format.com";
      }),
  },
  {
    id: "shutdown",
    reason: "关机 / 重启 / 注销（shutdown 等）",
    matches: ({ segments }) =>
      segments.some((tokens) =>
        ["shutdown", "restart", "restart-computer", "stop-computer", "logoff"].includes(
          baseToolName(tokens),
        ),
      ),
  },
  {
    id: "disk-tools",
    reason: "磁盘分区 / 格式化工具（diskpart / fdisk / mkfs）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        const tool = baseToolName(tokens);
        return (
          tool.startsWith("mkfs") ||
          tool === "mke2fs" ||
          tool === "diskpart" ||
          tool === "fdisk" ||
          tool === "parted"
        );
      }),
  },
  {
    id: "dd-device",
    reason: "直接写块设备（dd of=/dev/…）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        if (baseToolName(tokens) !== "dd") {
          return false;
        }
        return tokens.some(
          (token) =>
            /^of=\/dev\//i.test(token) || /^of=\\\\\.\\physicaldrive/i.test(token),
        );
      }),
  },
  {
    id: "bcdedit",
    reason: "修改启动配置（bcdedit）",
    matches: ({ segments }) => segments.some((tokens) => baseToolName(tokens) === "bcdedit"),
  },
  {
    id: "reg-system-hive",
    reason: "修改注册表系统配置（reg delete/add HKLM 等）",
    matches: ({ segments }) =>
      segments.some((tokens) => {
        if (baseToolName(tokens) !== "reg") {
          return false;
        }
        const action = (tokens[1] ?? "").toLowerCase();
        if (!["delete", "add", "import", "restore"].includes(action)) {
          return false;
        }
        return tokens
          .slice(2)
          .some((token) => /^(hklm|hkcr|hku|hkey_local_machine)/i.test(token));
      }),
  },
  {
    id: "system-path-write",
    reason: "写入系统目录（C:\\Windows、/etc、/usr 等）",
    matches: ({ segments }) => segments.some((tokens) => writesSystemPath(tokens)),
  },
  {
    id: "fork-bomb",
    reason: "fork 炸弹（:(){ :|:& };:）",
    matches: ({ command }) => /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i.test(command),
  },
];

/**
 * 识别危险命令。
 *
 * @param command 完整的 shell 命令字符串（可含多行与 `;`/`&&`/`|` 组合）
 */
export function checkDangerousCommand(command: string): DangerCheck {
  const segments = splitSegments(command);
  if (segments.length === 0) {
    return { dangerous: false };
  }
  const context: CommandContext = { command, segments };
  for (const rule of DANGER_RULES) {
    if (rule.matches(context)) {
      return { dangerous: true, ruleId: rule.id, reason: rule.reason };
    }
  }
  return { dangerous: false };
}
