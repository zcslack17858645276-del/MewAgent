# MewAgent 一行安装脚本（Windows PowerShell）
#
# 用法（推荐）：
#   irm https://raw.githubusercontent.com/zcslack17858645276-del/MewAgent/main/scripts/install.ps1 | iex
#
# 可选参数（用 & { ... } 或直接调用时）：
#   .\install.ps1 -Repo <git地址> -Ref <分支/标签> -NoGlobal
#
# 脚本做四件事：检查 Node >= 22 → 取源码（git 优先，无 git 时下载 zip）→ 安装依赖并构建 → 全局安装并验证。
# 不修改用户的 .env / 配置；首次运行 `mewagent` 会弹出配置向导。

param(
  [string]$Repo = 'https://github.com/zcslack17858645276-del/MewAgent',
  [string]$Ref = 'main',
  [switch]$NoGlobal
)

$ErrorActionPreference = 'Stop'

function Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

# 1. Node 检查
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "未找到 Node.js。请先安装 Node >= 22（推荐 winget install OpenJS.NodeJS.LTS），然后重新运行本脚本。"
}
$nodeVersion = (node -p "process.versions.node").Trim()
if ([version]$nodeVersion -lt [version]'22.0.0') {
  Fail "Node.js 版本过低：当前 $nodeVersion，需要 >= 22。请升级后重试。"
}
Step "Node.js $nodeVersion 可用"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail "未找到 npm（应随 Node 提供）。" }

$tmp = Join-Path $env:TEMP ("mewagent-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $tmp | Out-Null
$src = Join-Path $tmp 'src'

try {
  # 2. 取源码
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Step "git clone $Repo ($Ref)"
    # 注意：不要对 git 输出做 2>&1 重定向——$ErrorActionPreference='Stop' 会把 git 的正常 stderr 当成终止错误。
    & git clone --depth 1 --branch "$Ref" "$Repo" "$src"
    if ($LASTEXITCODE -ne 0) { Fail "git clone 失败（检查网络/代理，或改用无 git 的 zip 方式）。" }
  }
  else {
    $repoBase = $Repo.TrimEnd('/')
    $zip = Join-Path $tmp 'src.zip'
    $downloaded = $false
    foreach ($kind in @('heads', 'tags')) {
      $zipUrl = "$repoBase/archive/refs/$kind/$Ref.zip"
      Step "未找到 git，尝试下载 $zipUrl"
      try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
        $downloaded = $true
        break
      } catch {
        Write-Host "  （该地址不可用，继续尝试下一个）" -ForegroundColor DarkYellow
      }
    }
    if (-not $downloaded) { Fail "下载源码包失败（检查网络/代理，或先安装 git）。" }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $extracted = Get-ChildItem -Path $tmp -Directory | Where-Object { $_.Name -like 'MewAgent-*' } | Select-Object -First 1
    if (-not $extracted) { Fail "下载的源码压缩包结构不符合预期。" }
    Move-Item -Path $extracted.FullName -Destination $src
  }

  # 3. 安装依赖 + 构建 + 全局安装
  Push-Location $src
  try {
    Step "npm install（首次约 1-2 分钟）"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install 失败（检查网络/代理或 npm 镜像配置）。" }

    Step "npm run build"
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail "构建失败。" }

    if (-not $NoGlobal) {
      # 用 npm pack 生成 tarball 再全局安装：
      # 1) 直接 `npm install -g .` 在 npm 12 会创建指向源码目录的 junction，脚本清理临时目录后全局命令就断了；
      # 2) tarball 安装会复制文件，但旧 shim（mewagent / mewagent.cmd / mewagent.ps1）残留会触发 EEXIST，需要先清掉。
      Step "npm pack 后全局安装（安装为全局命令 mewagent）"
      $tgzName = & npm pack --silent --pack-destination $tmp
      if ($LASTEXITCODE -ne 0 -or -not $tgzName) { Fail "npm pack 失败。" }
      $tgz = Join-Path $tmp ($tgzName | Select-Object -Last 1)
      if (-not (Test-Path $tgz)) { Fail "找不到打包产物：$tgz" }

      $prefix = (& npm config get prefix).Trim()
      $stale = @(
        (Join-Path $prefix 'node_modules\mewagent'),
        (Join-Path $prefix 'mewagent'),
        (Join-Path $prefix 'mewagent.cmd'),
        (Join-Path $prefix 'mewagent.ps1')
      )
      foreach ($stalePath in $stale) {
        if (Test-Path $stalePath) {
          for ($i = 0; $i -lt 3; $i++) {
            Remove-Item -Path $stalePath -Recurse -Force -ErrorAction SilentlyContinue
            if (-not (Test-Path $stalePath)) { break }
            Start-Sleep -Milliseconds 300
          }
        }
      }

      & npm install -g $tgz --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { Fail "全局安装失败（检查 npm 全局目录权限；可加 -NoGlobal 只构建不安装）。" }
    }
  }
  finally { Pop-Location }
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# 4. 验证
if (-not $NoGlobal) {
  $cmd = Get-Command mewagent -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail "安装完成但未找到 mewagent 命令（检查 npm 全局 bin 是否在 PATH）。" }
  Step "验证：mewagent --version"
  & mewagent --version
  if ($LASTEXITCODE -ne 0) { Fail "mewagent --version 失败：全局安装可能指向了已删除的源码目录，请重试或运行 npm uninstall -g mewagent 后重新安装。" }
  Write-Host ""
  Write-Host "安装完成。下一步：" -ForegroundColor Green
  Write-Host "  mewagent              # 首次运行会弹出配置向导（base-url / 模型 / API key）"
  Write-Host "  mewagent --mock       # 没有 API key 也可以先离线体验"
  Write-Host "  升级：重新运行本脚本；卸载：npm uninstall -g mewagent"
}
else {
  Write-Host "构建完成（未做全局安装，-NoGlobal）：$src/dist/index.js" -ForegroundColor Green
}
