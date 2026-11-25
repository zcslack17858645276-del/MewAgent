#!/usr/bin/env bash
# MewAgent 一行安装脚本（macOS / Linux）
#
# 用法（推荐）：
#   curl -fsSL https://raw.githubusercontent.com/zcslack17858645276-del/MewAgent/main/scripts/install.sh | bash
#
# 可选环境变量：
#   MEWAGENT_REPO=<git地址>   MEWAGENT_REF=<分支/标签>   MEWAGENT_NO_GLOBAL=1（只构建不全局安装）
#
# 脚本做四件事：检查 Node >= 22 → 取源码（git 优先，无 git 时下载 tar.gz）→ 安装依赖并构建 → 全局安装并验证。

set -euo pipefail

REPO="${MEWAGENT_REPO:-https://github.com/zcslack17858645276-del/MewAgent}"
REF="${MEWAGENT_REF:-main}"
NO_GLOBAL="${MEWAGENT_NO_GLOBAL:-}"

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# 1. Node 检查
command -v node >/dev/null 2>&1 || fail "未找到 Node.js。请先安装 Node >= 22（macOS: brew install node；Linux: 用 nvm 或发行版包管理器），然后重试。"
NODE_VERSION="$(node -p 'process.versions.node')"
if [ "$(printf '%s\n22.0.0\n' "$NODE_VERSION" | sort -V | head -n1)" != "22.0.0" ]; then
  fail "Node.js 版本过低：当前 $NODE_VERSION，需要 >= 22。"
fi
step "Node.js $NODE_VERSION 可用"

command -v npm >/dev/null 2>&1 || fail "未找到 npm（应随 Node 提供）。"

TMP_DIR="$(mktemp -d -t mewagent-install-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
SRC="$TMP_DIR/src"

# 2. 取源码
if command -v git >/dev/null 2>&1; then
  step "git clone $REPO ($REF)"
  git clone --depth 1 --branch "$REF" "$REPO" "$SRC" || fail "git clone 失败（检查网络/代理）。"
else
  TARBALL="$TMP_DIR/src.tar.gz"
  DOWNLOADED=""
  for KIND in heads tags; do
    URL="${REPO%/}/archive/refs/${KIND}/${REF}.tar.gz"
    step "未找到 git，尝试下载 $URL"
    if command -v curl >/dev/null 2>&1; then
      if curl -fsSL "$URL" -o "$TARBALL"; then DOWNLOADED="$URL"; break; fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q "$URL" -O "$TARBALL"; then DOWNLOADED="$URL"; break; fi
    else
      fail "需要 git 或 curl/wget 之一。"
    fi
    echo "  （该地址不可用，继续尝试下一个）"
  done
  [ -n "$DOWNLOADED" ] || fail "下载源码包失败（检查网络/代理，或先安装 git）。"
  mkdir -p "$SRC"
  tar -xzf "$TARBALL" -C "$SRC" --strip-components=1 || fail "解压失败。"
fi

# 3. 安装依赖 + 构建 + 全局安装
cd "$SRC"
step "npm install（首次约 1-2 分钟）"
npm install --no-audit --no-fund || fail "npm install 失败（检查网络/代理或 npm 镜像配置）。"

step "npm run build"
npm run build || fail "构建失败。"

if [ -z "$NO_GLOBAL" ]; then
  # 用 npm pack 生成 tarball 再全局安装：直接 `npm install -g .` 可能创建指向源码目录的链接，
  # 脚本清理临时目录后全局命令就断了。
  step "npm pack 后全局安装（安装为全局命令 mewagent）"
  TGZ_NAME="$(npm pack --silent --pack-destination "$TMP_DIR" | tail -n1)" || fail "npm pack 失败。"
  TGZ="$TMP_DIR/$TGZ_NAME"
  [ -f "$TGZ" ] || fail "找不到打包产物：$TGZ"
  npm uninstall -g mewagent >/dev/null 2>&1 || true
  npm install -g "$TGZ" --no-audit --no-fund || fail "全局安装失败（检查 npm 全局目录权限，或设置 MEWAGENT_NO_GLOBAL=1 只构建）。"
fi

cd - >/dev/null

# 4. 验证
if [ -z "$NO_GLOBAL" ]; then
  command -v mewagent >/dev/null 2>&1 || fail "安装完成但未找到 mewagent 命令（检查 npm 全局 bin 是否在 PATH）。"
  step "验证：mewagent --version"
  mewagent --version || fail "mewagent --version 失败：全局安装可能指向了已删除的源码目录，请重试。"
  echo ""
  echo "安装完成。下一步："
  echo "  mewagent              # 首次运行会弹出配置向导（base-url / 模型 / API key）"
  echo "  mewagent --mock       # 没有 API key 也可以先离线体验"
  echo "  升级：重新运行本脚本；卸载：npm uninstall -g mewagent"
else
  echo "构建完成（未做全局安装，MEWAGENT_NO_GLOBAL=1）。"
fi
