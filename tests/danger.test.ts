// S3-1 单测：危险命令识别（纯字符串规则，不执行命令）。
import assert from "node:assert/strict";
import test from "node:test";

import { checkDangerousCommand } from "../src/safety/danger.js";

function expectDangerous(command: string, ruleId?: string): void {
  const check = checkDangerousCommand(command);
  assert.equal(check.dangerous, true, `应判为危险命令：${command}`);
  assert.ok((check.reason ?? "").length > 0, "必须给出可读原因");
  if (ruleId !== undefined) {
    assert.equal(check.ruleId, ruleId, `规则 id 不符：${command}`);
  }
}

function expectSafe(command: string): void {
  const check = checkDangerousCommand(command);
  assert.equal(
    check.dangerous,
    false,
    `不应判为危险命令：${command}（命中规则 ${check.ruleId ?? "-"}）`,
  );
}

test("danger：rm -rf 的各种写法都被拦截", () => {
  expectDangerous("rm -rf /", "rm-recursive-force");
  expectDangerous("rm -fr build", "rm-recursive-force");
  expectDangerous("rm -r -f build", "rm-recursive-force");
  expectDangerous("sudo rm -rf /", "rm-recursive-force");
  expectDangerous("RM -RF ./dist", "rm-recursive-force");
  expectDangerous("rm --recursive --force node_modules", "rm-recursive-force");
  expectDangerous("/bin/rm -rf /tmp/x", "rm-recursive-force");
});

test("danger：Windows 删除与格式化命令被拦截", () => {
  expectDangerous("rmdir /s /q C:\\temp", "rmdir-recursive");
  expectDangerous("rd /s /q old", "rmdir-recursive");
  expectDangerous("del /f /s /q C:\\data", "del-force-recursive");
  expectDangerous("erase /f /q foo", "del-force-recursive");
  expectDangerous("deltree C:\\old", "deltree");
  expectDangerous("format C:", "format");
  expectDangerous("format /q D:", "format");
});

test("danger：关机/磁盘/启动配置等系统级命令被拦截", () => {
  expectDangerous("shutdown /r /t 0", "shutdown");
  expectDangerous("shutdown -h now", "shutdown");
  expectDangerous("logoff", "shutdown");
  expectDangerous("diskpart", "disk-tools");
  expectDangerous("mkfs.ext4 /dev/sdb1", "disk-tools");
  expectDangerous("fdisk /dev/sda", "disk-tools");
  expectDangerous("dd if=/dev/zero of=/dev/sda bs=1M", "dd-device");
  expectDangerous("bcdedit /set {default} safeboot minimal", "bcdedit");
  expectDangerous("reg delete HKLM\\Software\\Foo /f", "reg-system-hive");
});

test("danger：PowerShell 递归强制删除被拦截", () => {
  expectDangerous("Remove-Item -Recurse -Force .\\build", "powershell-remove-item");
  expectDangerous("powershell Remove-Item -Recurse -Force C:\\temp", "powershell-remove-item");
});

test("danger：写系统目录被拦截，读系统目录不算", () => {
  expectDangerous("copy evil.exe C:\\Windows\\System32\\evil.exe", "system-path-write");
  expectDangerous("echo x > C:\\Windows\\System32\\evil.dll", "system-path-write");
  expectDangerous("rm -rf /etc/nginx", "rm-recursive-force");
  expectDangerous("echo hacked > /etc/passwd", "system-path-write");
  expectSafe("Get-ChildItem C:\\Windows");
  expectSafe("dir C:\\Windows");
  expectSafe("cat /etc/hosts");
});

test("danger：fork 炸弹被拦截", () => {
  expectDangerous(":(){ :|:& };:", "fork-bomb");
});

test("danger：正常开发命令与把危险字样当参数的命令不误杀", () => {
  expectSafe("rm file.txt");
  expectSafe("rm -f file.txt");
  expectSafe("rm -r build");
  expectSafe("git status");
  expectSafe("npm test");
  expectSafe("npm run format");
  expectSafe("echo 你好");
  expectSafe('git commit -m "fix: rm -rf 文案"');
  expectSafe("grep -r 'format' src");
  expectSafe("node -e \"console.log('hello')\"");
  expectSafe("del file.txt");
  expectSafe("rmdir emptydir");
});

test("danger：多行/组合命令逐段检查", () => {
  expectDangerous("git status\nrm -rf /\n", "rm-recursive-force");
  expectDangerous("echo hi && rm -rf /", "rm-recursive-force");
  expectDangerous("ls | rm -rf x", "rm-recursive-force");
  expectDangerous("echo hi; shutdown /r", "shutdown");
});

test("danger：空命令/空白不判危险", () => {
  assert.equal(checkDangerousCommand("").dangerous, false);
  assert.equal(checkDangerousCommand("   ").dangerous, false);
  assert.equal(checkDangerousCommand("\n\n").dangerous, false);
});
