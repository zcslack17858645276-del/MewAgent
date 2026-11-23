// MewAgent 测试骨架（S0-1）：确保 npm test 链路可用，S0-2 起在此补充核心测试。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  name: string;
  version: string;
  type: string;
  engines: { node: string };
  scripts: Record<string, string>;
}

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown as PackageManifest;

test("工程清单：name/version/type 符合预期", () => {
  assert.equal(manifest.name, "mewagent");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.type, "module");
});

test("工程清单：engines.node 要求 >=22", () => {
  assert.equal(manifest.engines.node, ">=22");
});

test("工程清单：typecheck / test / build 脚本已就位", () => {
  for (const script of ["dev", "build", "start", "typecheck", "test"]) {
    assert.ok(manifest.scripts[script], `缺少 npm script: ${script}`);
  }
});
