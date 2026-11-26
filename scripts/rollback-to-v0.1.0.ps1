<#
.SYNOPSIS
  Roll MewAgent back to the frozen v0.1.0 baseline.

.DESCRIPTION
  Safety-first rollback:
    1. fetch tags/branches
    2. resolve -Tag (default v0.1.0-final; fallback v0.1.0)
    3. create a backup branch of the current HEAD
    4. stash uncommitted changes (including untracked, excluding ignored)
    5. hard reset the current branch to the tag
    6. remove untracked files (never ignored ones: node_modules/.env/dist stay)
  It never pushes, never force-pushes, never moves or deletes tags.

.PARAMETER Tag
  Frozen tag to restore. Default: v0.1.0-final

.PARAMETER Yes
  Skip the interactive confirmation.

.PARAMETER DryRun
  Show what would happen, change nothing.

.EXAMPLE
  .\scripts\rollback-to-v0.1.0.ps1 -DryRun

.EXAMPLE
  .\scripts\rollback-to-v0.1.0.ps1 -Yes
#>
param(
    [string]$Tag = 'v0.1.0-final',
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Invoke-Git {
    param([string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE)"
    }
}

function Resolve-TagCommit {
    param([string]$Name)
    # A missing tag makes git write "fatal:" to stderr; with
    # $ErrorActionPreference='Stop' that would abort this script before the
    # fallback runs, so scope it to 'Continue' and return $null instead.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git rev-parse --verify --quiet "$Name^{commit}" 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (($out | Select-Object -First 1) -as [string]).Trim()
    } finally {
        $ErrorActionPreference = $previous
    }
}

if (-not (Test-Path (Join-Path $repo '.git'))) {
    throw "not a git work tree: $repo"
}

Write-Host "repo   : $repo"
Invoke-Git @('fetch', '--all', '--tags', '--prune')

$target = Resolve-TagCommit $Tag
if ([string]::IsNullOrWhiteSpace($target)) {
    Write-Host "tag '$Tag' not found; trying fallback 'v0.1.0'..."
    $Tag = 'v0.1.0'
    $target = Resolve-TagCommit $Tag
    if ([string]::IsNullOrWhiteSpace($target)) {
        throw "no usable rollback tag found (tried v0.1.0-final and v0.1.0)"
    }
}
$target = $target.Trim()

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
$head = (& git rev-parse --short HEAD).Trim()
$dirty = @(& git status --porcelain)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "backup/pre-rollback-$stamp"

Write-Host "branch : $branch"
Write-Host "head   : $head"
Write-Host "target : $Tag -> $($target.Substring(0, 7))"
Write-Host "dirty  : $($dirty.Count) changed/untracked path(s)"
Write-Host "backup : $backup"

if ($DryRun) {
    Write-Host ""
    Write-Host "DRY RUN: would create the backup branch, stash changes if any,"
    Write-Host "         reset '$branch' to '$Tag', then run 'git clean -fd'."
    exit 0
}

if (-not $Yes) {
    $answer = Read-Host "Type 'yes' to continue"
    if ($answer -ne 'yes') {
        Write-Host "Aborted."
        exit 1
    }
}

Invoke-Git @('branch', $backup)
Write-Host "created backup branch: $backup"

if ($dirty.Count -gt 0) {
    try {
        Invoke-Git @('stash', 'push', '-u', '-m', "pre-rollback-$stamp")
        Write-Host "saved working changes to git stash (recover with: git stash list)"
    } catch {
        Write-Warning "stash failed; uncommitted changes may be lost: $_"
    }
}

Invoke-Git @('reset', '--hard', $Tag)
Invoke-Git @('clean', '-fd')

Write-Host ""
Write-Host "Rollback done."
Write-Host "  current : $((& git log -1 --oneline).Trim())"
Write-Host "  status  : $((& git status -sb | Select-Object -First 1))"
Write-Host ""
Write-Host "Recover old work:"
Write-Host "  git branch --list 'backup/*'"
Write-Host "  git switch $backup"
Write-Host "  git stash list"
Write-Host "  git stash apply   # only if a stash was created"
Write-Host ""
Write-Host "Verify:"
Write-Host "  npm install       # only if package.json changed"
Write-Host "  npm test          # expect: tests 330 / pass 329 / skipped 1"
Write-Host "  npm run build"
