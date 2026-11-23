<#
.SYNOPSIS
    Fully automated GUI driver for the Ink 8 + ink-text-input 6 Chinese IME spike.

.DESCRIPTION
    1. Records the current foreground window, then opens a new Windows Terminal window
       running `npx tsx spikes/ime-spike.tsx` (title IMESPIKE_R1/R2/R3).
    2. Finds the window via EnumWindows and waits for spikes/.out/ready.txt.
    3. Injects *real* keyboard input with SendInput after HARD-verifying that the target
       window is the foreground window before EVERY key. If focus cannot be restored the
       script throws instead of typing blindly.
    4. Round 1: Chinese IME  -> n i h a o -> screenshot (candidate window) -> Space
       (select 1st candidate) -> Enter (commit) -> Enter (submit/onExit).
       Round 2: Chinese IME  -> nihao + Space (commit the CJK text) -> Backspace -> verify that
       exactly one complete CJK character was deleted.
       Round 3: ASCII baseline -> a b c -> Backspace -> confirm the non-IME path is sane.
    5. Saves screenshots to spikes/.out/*.png, evidence to spikes/.out/ime-log.jsonl
       (written by the Ink app itself) and a machine-readable summary to
       spikes/.out/summary.json.
    6. Restores the original foreground window, closes only the windows it created
       (verified by title + owning process) and terminates the spike node processes.

.NOTES
    - Windows PowerShell 5.1 (this machine has no pwsh 7) and 64-bit only.
    - The task's reference command used `pwsh`; this machine has no `pwsh`, therefore
      powershell.exe is used inside the Windows Terminal tab. This is documented in
      spikes/RESULT.md.
    - SAFETY: nothing is typed unless GetForegroundWindow() == the spike window hwnd.
#>
[CmdletBinding()]
param(
    [int]$KeyDelayMs = 110,
    [int]$ReadyTimeoutSec = 45,
    [switch]$SkipRound2,
    [switch]$SkipRound3
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------- paths
$SpikeDir  = $PSScriptRoot
$RepoRoot  = Split-Path -Parent $SpikeDir
$OutDir    = Join-Path $SpikeDir '.out'
$LogPath   = Join-Path $OutDir 'run-ime-spike.log'
$JsonlPath = Join-Path $OutDir 'ime-log.jsonl'
$ReadyPath = Join-Path $OutDir 'ready.txt'
$SummaryPath = Join-Path $OutDir 'summary.json'
$WtExe = 'C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wt.exe'
$ShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not [Environment]::Is64BitProcess) { throw 'This script must run as a 64-bit PowerShell process.' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# --------------------------------------------------------------------------- logging
function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

# --------------------------------------------------------------------------- native
$nativeSource = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ImeSpikeNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint threadId);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint numInputs, INPUT[] inputs, int sizeOfInput);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit, Size = 40)]
    public struct INPUT
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KEYBDINPUT ki;
    }

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint VK_SHIFT = 0x10;

    public class WindowInfo
    {
        public IntPtr Hwnd;
        public uint ProcessId;
        public string Title;
    }

    public static string GetTitle(IntPtr hWnd)
    {
        int len = GetWindowTextLength(hWnd);
        if (len <= 0) return string.Empty;
        var sb = new StringBuilder(len + 2);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static List<WindowInfo> FindWindows(string needle)
    {
        var result = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            string title = GetTitle(hWnd);
            if (title.Length == 0) return true;
            if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0)
            {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                var info = new WindowInfo();
                info.Hwnd = hWnd;
                info.ProcessId = pid;
                info.Title = title;
                result.Add(info);
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static IntPtr GetKeyboardLayoutForWindow(IntPtr hWnd)
    {
        uint pid;
        uint tid = GetWindowThreadProcessId(hWnd, out pid);
        return GetKeyboardLayout(tid);
    }

    public static bool SendKey(ushort virtualKey, ushort scanCode, bool keyUp)
    {
        var inputs = new INPUT[1];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = virtualKey;
        inputs[0].ki.wScan = scanCode;
        inputs[0].ki.dwFlags = keyUp ? KEYEVENTF_KEYUP : 0;
        inputs[0].ki.time = 0;
        inputs[0].ki.dwExtraInfo = IntPtr.Zero;
        uint sent = SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent == 1;
    }
}
'@

Write-Log '=== run-ime-spike.ps1 start ==='
Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
Add-Type -AssemblyName System.Drawing -ErrorAction Stop
[void][ImeSpikeNative]::SetProcessDPIAware()

$script:ScreenWidth  = [ImeSpikeNative]::GetSystemMetrics(0)
$script:ScreenHeight = [ImeSpikeNative]::GetSystemMetrics(1)
$script:TargetHwnd   = [IntPtr]::Zero
$script:TargetPid    = 0
$script:OriginalForeground = [ImeSpikeNative]::GetForegroundWindow()
$script:CreatedWindows = New-Object System.Collections.ArrayList

Write-Log ("screen={0}x{1} originalForeground=0x{2} title='{3}'" -f `
    $script:ScreenWidth, $script:ScreenHeight, $script:OriginalForeground.ToInt64().ToString('X'), `
    [ImeSpikeNative]::GetTitle($script:OriginalForeground))

# --------------------------------------------------------------------------- focus
function Get-ForegroundHwnd { return [ImeSpikeNative]::GetForegroundWindow() }

function Activate-Window {
    param([IntPtr]$Hwnd, [uint32]$ProcessId = 0, [int]$TimeoutMs = 8000)
    if ($Hwnd -eq [IntPtr]::Zero) { return $false }
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ((Get-Date) -lt $deadline) {
        if ((Get-ForegroundHwnd) -eq $Hwnd) { return $true }
        [void][ImeSpikeNative]::ShowWindow($Hwnd, 9)   # SW_RESTORE
        [void][ImeSpikeNative]::SetForegroundWindow($Hwnd)
        Start-Sleep -Milliseconds 120
        if ((Get-ForegroundHwnd) -eq $Hwnd) { return $true }

        $fg = [ImeSpikeNative]::GetForegroundWindow()
        $fgPid = [uint32]0
        $fgThread = [uint32]0
        if ($fg -ne [IntPtr]::Zero) {
            $fgThread = [ImeSpikeNative]::GetWindowThreadProcessId($fg, [ref]$fgPid)
        }
        $curThread = [ImeSpikeNative]::GetCurrentThreadId()
        if ($fgThread -ne 0 -and $fgThread -ne $curThread) {
            [void][ImeSpikeNative]::AttachThreadInput($curThread, $fgThread, $true)
            [void][ImeSpikeNative]::SetForegroundWindow($Hwnd)
            [void][ImeSpikeNative]::BringWindowToTop($Hwnd)
            [void][ImeSpikeNative]::SetFocus($Hwnd)
            [void][ImeSpikeNative]::AttachThreadInput($curThread, $fgThread, $false)
        }
        Start-Sleep -Milliseconds 120
        if ((Get-ForegroundHwnd) -eq $Hwnd) { return $true }

        $title = [ImeSpikeNative]::GetTitle($Hwnd)
        if ($title.Length -gt 0) {
            try {
                $shell = New-Object -ComObject WScript.Shell
                [void]$shell.AppActivate($title)
            } catch { }
            Start-Sleep -Milliseconds 150
        }
    }
    return ((Get-ForegroundHwnd) -eq $Hwnd)
}

function Ensure-TargetForeground {
    if ($script:TargetHwnd -eq [IntPtr]::Zero) { throw 'No target window set.' }
    if ((Get-ForegroundHwnd) -eq $script:TargetHwnd) { return }
    $ok = Activate-Window -Hwnd $script:TargetHwnd -ProcessId ([uint32]$script:TargetPid)
    if (-not $ok) {
        $actual = (Get-ForegroundHwnd).ToInt64()
        $title = [ImeSpikeNative]::GetTitle((Get-ForegroundHwnd))
        $msg = "FOREGROUND_MISMATCH target=$($script:TargetHwnd.ToInt64()) actual=$actual actualTitle='$title' -- refusing to send keyboard input"
        Write-Log "SAFETY ABORT: $msg"
        throw $msg
    }
}

# --------------------------------------------------------------------------- keyboard
function Send-Key {
    param([int]$Vk, [string]$Label)
    Ensure-TargetForeground
    $scan = [uint32][ImeSpikeNative]::MapVirtualKey([uint32]$Vk, 0)
    $down = [ImeSpikeNative]::SendKey([uint16]$Vk, [uint16]$scan, $false)
    Start-Sleep -Milliseconds 25
    $up = [ImeSpikeNative]::SendKey([uint16]$Vk, [uint16]$scan, $true)
    if (-not $down -or -not $up) {
        throw "SendInput failed for '$Label' (vk=0x$('{0:X2}' -f $Vk), down=$down, up=$up)"
    }
    Add-Content -Path $LogPath -Value ('[{0}] SEND {1} (vk=0x{2:X2} scan=0x{3:X2})' -f (Get-Date -Format 'HH:mm:ss.fff'), $Label, $Vk, $scan) -Encoding UTF8
    Start-Sleep -Milliseconds $KeyDelayMs
}

function Send-KeyState {
    # Raw single transition (used for modifier combinations such as Win+Space).
    param([int]$Vk, [bool]$KeyUp)
    Ensure-TargetForeground
    $scan = [uint32][ImeSpikeNative]::MapVirtualKey([uint32]$Vk, 0)
    $ok = [ImeSpikeNative]::SendKey([uint16]$Vk, [uint16]$scan, $KeyUp)
    if (-not $ok) { throw "SendInput (raw) failed vk=0x$('{0:X2}' -f $Vk) keyUp=$KeyUp" }
    Add-Content -Path $LogPath -Value ('[{0}] SEND_RAW vk=0x{1:X2} keyUp={2}' -f (Get-Date -Format 'HH:mm:ss.fff'), $Vk, $KeyUp) -Encoding UTF8
    Start-Sleep -Milliseconds 20
}

function Send-Char {
    param([string]$Character)
    $upper = $Character.ToUpperInvariant()
    $vk = 0
    if ($upper.Length -eq 1 -and $upper[0] -ge [char]'A' -and $upper[0] -le [char]'Z') {
        $vk = [int][char]$upper
    } elseif ($Character -eq ' ') {
        $vk = 0x20
    } else {
        throw "Send-Char: unsupported character '$Character'"
    }
    Send-Key -Vk $vk -Label $Character
}

function Send-Text {
    param([string]$Text)
    foreach ($ch in $Text.ToCharArray()) { Send-Char -Character ([string]$ch) }
}

function Press-Backspace { Send-Key -Vk 0x08 -Label 'Backspace' }
function Press-Space     { Send-Key -Vk 0x20 -Label 'Space' }
function Press-Enter     { Send-Key -Vk 0x0D -Label 'Enter' }
function Press-Escape    { Send-Key -Vk 0x1B -Label 'Escape' }
function Press-Shift     { Send-Key -Vk 0x10 -Label 'Shift' }

# --------------------------------------------------------------------------- evidence helpers
function Read-SpikeLog {
    $items = New-Object System.Collections.ArrayList
    if (-not (Test-Path $JsonlPath)) { return @() }
    $lines = [System.IO.File]::ReadAllLines($JsonlPath, [System.Text.Encoding]::UTF8)
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $obj = $line | ConvertFrom-Json
            [void]$items.Add($obj)
        } catch {
            Write-Log "WARN unparsable jsonl line ignored: $line"
        }
    }
    return @($items.ToArray())
}

function Get-LogCount { return @(Read-SpikeLog).Count }

function Get-ChangesSince {
    param([int]$FromIndex, [int]$AppPid)
    $all = @(Read-SpikeLog)
    $result = New-Object System.Collections.ArrayList
    for ($i = $FromIndex; $i -lt $all.Count; $i++) {
        $item = $all[$i]
        if ($item.event -eq 'change' -and [int]$item.pid -eq $AppPid) { [void]$result.Add($item) }
    }
    return @($result.ToArray())
}

function Get-LastValue {
    param([int]$AppPid)
    $all = @(Read-SpikeLog)
    $last = ''
    foreach ($item in $all) {
        if ($item.event -eq 'change' -and [int]$item.pid -eq $AppPid) { $last = [string]$item.value }
    }
    return $last
}

function Get-LastEvent {
    param([string]$EventName, [int]$AppPid = 0)
    $all = @(Read-SpikeLog)
    $found = $null
    foreach ($item in $all) {
        if ($item.event -eq $EventName) {
            if ($AppPid -eq 0 -or [int]$item.pid -eq $AppPid) { $found = $item }
        }
    }
    return $found
}

function Get-ReadyInfo {
    if (-not (Test-Path $ReadyPath)) { return $null }
    $text = Get-Content -Path $ReadyPath -Raw -Encoding UTF8
    $info = @{ Raw = $text }
    foreach ($line in ($text -split "`n")) {
        if ($line -match '^(?<k>[a-zA-Z_]+)=(?<v>.*)$') {
            $info[$Matches['k']] = $Matches['v'].Trim()
        }
    }
    return $info
}

function Save-Screenshot {
    param([string]$Name, [int]$Padding = 0)
    Ensure-TargetForeground
    $rect = New-Object ImeSpikeNative+RECT
    [void][ImeSpikeNative]::GetWindowRect($script:TargetHwnd, [ref]$rect)
    $left   = [Math]::Max(0, $rect.Left - $Padding)
    $top    = [Math]::Max(0, $rect.Top - $Padding)
    $right  = [Math]::Min($script:ScreenWidth, $rect.Right + $Padding)
    $bottom = [Math]::Min($script:ScreenHeight, $rect.Bottom + $Padding)
    $width  = $right - $left
    $height = $bottom - $top
    if ($width -le 0 -or $height -le 0) { throw "Bad capture rect for $Name" }
    $bmp = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $graphics.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size $width, $height))
        $path = Join-Path $OutDir ($Name + '.png')
        $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bmp.Dispose()
    }
    Write-Log "SHOT $path (${width}x${height})"
    return $path
}

# --------------------------------------------------------------------------- window lifecycle
function Start-SpikeWindow {
    param([string]$Title)
    if (Test-Path $ReadyPath) { Remove-Item -Path $ReadyPath -Force }
    $tabCommand = 'npx tsx spikes/ime-spike.tsx'
    $wtArgs = @(
        '-w', '-1', 'new-tab', '--title', $Title, '-d', $RepoRoot,
        $ShellExe, '-NoLogo', '-NoProfile', '-NoExit', '-Command', $tabCommand
    )
    Write-Log ('LAUNCH ' + $WtExe + ' ' + ($wtArgs -join ' '))
    & $WtExe @wtArgs
    Start-Sleep -Milliseconds 600

    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $found = $null
    while ((Get-Date) -lt $deadline) {
        $wins = @([ImeSpikeNative]::FindWindows($Title))
        if ($wins.Count -gt 0) { $found = $wins[0]; break }
        Start-Sleep -Milliseconds 300
    }
    if ($null -eq $found) {
        throw "WINDOW_NOT_FOUND: no visible top-level window whose title contains '$Title'"
    }
    $script:TargetHwnd = $found.Hwnd
    $script:TargetPid = [int]$found.ProcessId
    [void]$script:CreatedWindows.Add($found)
    Write-Log ("WINDOW hwnd=0x{0} pid={1} title='{2}'" -f $found.Hwnd.ToInt64().ToString('X'), $found.ProcessId, $found.Title)

    Ensure-TargetForeground
    $hkl = [ImeSpikeNative]::GetKeyboardLayoutForWindow($script:TargetHwnd)
    Write-Log ('TARGET HKL=0x{0:X8}' -f $hkl.ToInt64())

    # wait for the Ink app to announce itself
    $readyDeadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $ready = $null
    while ((Get-Date) -lt $readyDeadline) {
        $ready = Get-ReadyInfo
        if ($null -ne $ready) { break }
        Start-Sleep -Milliseconds 300
    }
    if ($null -eq $ready) {
        Save-Screenshot -Name 'ERROR-ready-timeout'
        throw "READY_TIMEOUT: $ReadyPath did not appear; screenshot saved"
    }
    Write-Log ('APP ready pid=' + $ready['pid'] + ' ready_ms=' + $ready['ready_ms'])
    Start-Sleep -Milliseconds 900
    return $ready
}

function Close-SpikeWindow {
    param([IntPtr]$Hwnd, [int]$AppPid = 0)
    if ($Hwnd -ne [IntPtr]::Zero -and [ImeSpikeNative]::IsWindow($Hwnd)) {
        $title = [ImeSpikeNative]::GetTitle($Hwnd)
        if ($title -notmatch 'IMESPIKE') {
            Write-Log "REFUSING to close window with unexpected title '$title'"
        } else {
            Write-Log "CLOSE window 0x$($Hwnd.ToInt64().ToString('X')) '$title'"
            [void][ImeSpikeNative]::PostMessage($Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE
            $deadline = (Get-Date).AddSeconds(5)
            while ((Get-Date) -lt $deadline -and [ImeSpikeNative]::IsWindow($Hwnd)) { Start-Sleep -Milliseconds 200 }
        }
    }
    if ($AppPid -gt 0) {
        $proc = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            Write-Log "STOP leftover spike node process pid=$AppPid"
            Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue
        }
    }
}

# --------------------------------------------------------------------------- IME state helpers
function Test-ContainsCjk {
    param([string]$Text)
    return ($Text -match '[\u4e00-\u9fff]')
}

# Ensure the *target window* input context is in Chinese composition mode.
# Strategy: type "nihao" and inspect the evidence log.
#   - no 'change' event   => the IME swallowed the keystrokes (composition) => Chinese mode
#   - latin 'change' events => English/passthrough mode => press Shift (MS Pinyin CN/EN toggle),
#     clear the input, retry. Track behaviour in the log so RESULT.md can report it.
function Ensure-ChineseMode {
    param([int]$AppPid)
    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $before = Get-LogCount
        Send-Text 'nihao'
        Start-Sleep -Milliseconds 700
        $changes = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
        if ($changes.Count -eq 0) {
            Write-Log "IME_MODE attempt=$attempt CHINESE composition active (no onChange for 'nihao'); cancelling probe composition with Esc"
            Press-Escape
            Start-Sleep -Milliseconds 350
            return 'CHINESE'
        }
        $value = [string]$changes[$changes.Count - 1].value
        Write-Log "IME_MODE attempt=$attempt PASSTHROUGH (typed nihao -> '$value'); pressing Shift to toggle CN/EN"
        Press-Escape
        Start-Sleep -Milliseconds 200
        Press-Shift
        Start-Sleep -Milliseconds 350
        $clearCount = [int]$changes[$changes.Count - 1].len + 2
        for ($i = 0; $i -lt $clearCount; $i++) { Press-Backspace }
        Start-Sleep -Milliseconds 250
        $now = Get-LastValue -AppPid $AppPid
        Write-Log "IME_MODE clear check: current value='$now'"
    }
    # Last resort: Win+Space (switch input language/IME). Only reached when the target is
    # verified foreground (Ensure-TargetForeground is called inside every raw send).
    Write-Log 'IME_MODE trying Win+Space fallback'
    Send-KeyState -Vk 0x5B -KeyUp $false   # LWin down
    Start-Sleep -Milliseconds 80
    Send-Key -Vk 0x20 -Label 'Space'
    Start-Sleep -Milliseconds 80
    Send-KeyState -Vk 0x5B -KeyUp $true    # LWin up
    Start-Sleep -Milliseconds 500
    $before = Get-LogCount
    Send-Text 'nihao'
    Start-Sleep -Milliseconds 700
    $changes = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
    if ($changes.Count -eq 0) {
        Write-Log 'IME_MODE after Win+Space: CHINESE composition active'
        return 'CHINESE'
    }
    $value = [string]$changes[$changes.Count - 1].value
    throw "IME_MODE_UNRESOLVED: still passthrough after Shift/Win+Space (typed nihao -> '$value')"
}

# Compose nihao, confirm the composition, press Space to select the first candidate.
# Returns a hashtable with the result and the change records collected.
function Invoke-ChineseCommit {
    param([int]$AppPid, [string]$ShotPrefix)
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $before = Get-LogCount
        Send-Text 'nihao'
        Start-Sleep -Milliseconds 750
        $composing = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
        if ($composing.Count -gt 0) {
            # IME was in passthrough mode; recover and retry.
            Write-Log ("COMMIT attempt=$attempt unexpected latin changes '" + [string]$composing[$composing.Count-1].value + "'; recovering")
            Press-Escape; Start-Sleep -Milliseconds 200
            Press-Shift; Start-Sleep -Milliseconds 300
            for ($i = 0; $i -lt ([int]$composing[$composing.Count-1].len + 2); $i++) { Press-Backspace }
            Start-Sleep -Milliseconds 250
            continue
        }
        $shot = Save-Screenshot -Name ($ShotPrefix + '-composing') -Padding 170
        Write-Log "COMPOSING screenshot=$shot (expect MS Pinyin candidate window)"
        Press-Space
        Start-Sleep -Milliseconds 800
        $afterSpace = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
        if ($afterSpace.Count -gt 0) {
            $committed = [string]$afterSpace[$afterSpace.Count - 1].value
            Write-Log "COMMIT after Space value='$committed' len=$([int]$afterSpace[$afterSpace.Count-1].len)"
            return @{
                Attempt = $attempt
                Method = 'Space'
                CommittedValue = $committed
                Changes = $afterSpace
                ComposingShot = $shot
            }
        }
        # Space did not commit (e.g. candidate list consumed it); try Enter as commit key.
        Write-Log "COMMIT attempt=$attempt Space produced no change; trying Enter"
        Press-Enter
        Start-Sleep -Milliseconds 700
        $afterEnter = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
        if ($afterEnter.Count -gt 0) {
            $committed = [string]$afterEnter[$afterEnter.Count - 1].value
            Write-Log "COMMIT after Enter value='$committed'"
            return @{ Attempt = $attempt; Method = 'Enter'; CommittedValue = $committed; Changes = $afterEnter; ComposingShot = $shot }
        }
        Write-Log "COMMIT attempt=$attempt failed; cancelling composition and retrying"
        Press-Escape; Start-Sleep -Milliseconds 250
        Press-Shift; Start-Sleep -Milliseconds 300
    }
    throw 'IME_COMMIT_FAILED: could not commit Chinese text via Space/Enter'
}

function Invoke-EnsureAsciiMode {
    param([int]$AppPid)
    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $before = Get-LogCount
        Send-Text 'abc'
        Start-Sleep -Milliseconds 500
        $changes = @(Get-ChangesSince -FromIndex $before -AppPid $AppPid)
        if ($changes.Count -gt 0) {
            $value = [string]$changes[$changes.Count - 1].value
            Write-Log "ASCII_MODE attempt=$attempt ok value='$value'"
            return @{ Mode = 'ASCII'; Changes = $changes; Value = $value }
        }
        Write-Log "ASCII_MODE attempt=$attempt composing (Chinese mode); Esc + Shift then retry"
        Press-Escape
        Start-Sleep -Milliseconds 250
        Press-Shift
        Start-Sleep -Milliseconds 350
        $current = Get-LastValue -AppPid $AppPid
        for ($i = 0; $i -lt ($current.Length + 2); $i++) { Press-Backspace }
        Start-Sleep -Milliseconds 250
    }
    throw 'ASCII_MODE_UNRESOLVED: could not switch target input context to ASCII passthrough'
}

# --------------------------------------------------------------------------- rounds
$script:RoundResults = New-Object System.Collections.ArrayList

function Invoke-RoundChinese {
    # Round 1: Chinese composition + candidate selection + commit + Enter submit.
    $ready = Start-SpikeWindow -Title 'IMESPIKE_R1'
    $appPid = [int]$ready['pid']
    $readyShot = Save-Screenshot -Name 'r1-01-ready'
    $mode = Ensure-ChineseMode -AppPid $appPid
    $commit = Invoke-ChineseCommit -AppPid $appPid -ShotPrefix 'r1-02'
    $afterCommitShot = Save-Screenshot -Name 'r1-03-committed'
    $value = [string]$commit.CommittedValue
    $beforeEnter = Get-LastValue -AppPid $appPid
    $logBefore = Get-LogCount
    Press-Enter
    Start-Sleep -Milliseconds 900
    $submit = Get-LastEvent -EventName 'submit' -AppPid $appPid
    if ($null -eq $submit) {
        Write-Log 'SUBMIT first Enter did not produce the submit event; pressing Enter again'
        Press-Enter
        Start-Sleep -Milliseconds 900
        $submit = Get-LastEvent -EventName 'submit' -AppPid $appPid
    }
    $submitShot = $null
    if ([ImeSpikeNative]::IsWindow($script:TargetHwnd)) {
        $submitShot = Save-Screenshot -Name 'r1-04-submitted'
    }
    $result = @{
        Round = 'R1-chinese'
        AppPid = $appPid
        Screenshots = @($readyShot, $commit.ComposingShot, $afterCommitShot, $submitShot) | Where-Object { $_ }
        ImeMode = $mode
        CommitMethod = $commit.Method
        CommittedValue = $value
        ValueBeforeEnter = $beforeEnter
        SubmitEvent = $submit
        SubmitValue = $(if ($null -ne $submit) { [string]$submit.value } else { $null })
        ChangeValues = @($commit.Changes | ForEach-Object { [string]$_.value })
        FullChangeSequence = @($commit.Changes | ForEach-Object { '{0}(len={1})' -f $_.value, $_.len })
    }
    [void]$script:RoundResults.Add($result)
    Write-Log ("ROUND1 done commit='$value' submitValue='$($result.SubmitValue)' mode=$mode")
    Close-SpikeWindow -Hwnd $script:TargetHwnd -AppPid $appPid
    $script:TargetHwnd = [IntPtr]::Zero
}

function Invoke-RoundBackspace {
    $ready = Start-SpikeWindow -Title 'IMESPIKE_R2'
    $appPid = [int]$ready['pid']
    $readyShot = Save-Screenshot -Name 'r2-01-ready'
    $mode = Ensure-ChineseMode -AppPid $appPid
    $commit = Invoke-ChineseCommit -AppPid $appPid -ShotPrefix 'r2-02'
    $committed = [string]$commit.CommittedValue
    $beforeShot = Save-Screenshot -Name 'r2-03-before-backspace'
    $logBefore = Get-LogCount
    Press-Backspace
    Start-Sleep -Milliseconds 650
    $del1 = @(Get-ChangesSince -FromIndex $logBefore -AppPid $appPid)
    $afterShot = Save-Screenshot -Name 'r2-04-after-backspace'
    $valueAfter1 = Get-LastValue -AppPid $appPid
    if ($del1.Count -gt 0) { $valueAfter1 = [string]$del1[$del1.Count - 1].value }
    $logBefore2 = Get-LogCount
    Press-Backspace
    Start-Sleep -Milliseconds 650
    $del2 = @(Get-ChangesSince -FromIndex $logBefore2 -AppPid $appPid)
    $valueAfter2 = Get-LastValue -AppPid $appPid
    $afterShot2 = Save-Screenshot -Name 'r2-05-after-backspace2'
    $result = @{
        Round = 'R2-backspace'
        AppPid = $appPid
        Screenshots = @($readyShot, $commit.ComposingShot, $beforeShot, $afterShot, $afterShot2) | Where-Object { $_ }
        ImeMode = $mode
        CommitMethod = $commit.Method
        CommittedValue = $committed
        Backspace1 = @{
            ChangeValues = @($del1 | ForEach-Object { [string]$_.value })
            ChangeLens = @($del1 | ForEach-Object { [int]$_.len })
            ValueAfter = $valueAfter1
            DeletedOneCompleteChar = (($committed.Length -gt 0) -and ($valueAfter1 -eq $committed.Substring(0, $committed.Length - 1)))
        }
        Backspace2 = @{
            ChangeValues = @($del2 | ForEach-Object { [string]$_.value })
            ChangeLens = @($del2 | ForEach-Object { [int]$_.len })
            ValueAfter = $valueAfter2
        }
    }
    [void]$script:RoundResults.Add($result)
    Write-Log ("ROUND2 done committed='$committed' after1='$valueAfter1' after2='$valueAfter2'")
    Close-SpikeWindow -Hwnd $script:TargetHwnd -AppPid $appPid
    $script:TargetHwnd = [IntPtr]::Zero
}

function Invoke-RoundAscii {
    $ready = Start-SpikeWindow -Title 'IMESPIKE_R3'
    $appPid = [int]$ready['pid']
    $readyShot = Save-Screenshot -Name 'r3-01-ready'
    $ascii = Invoke-EnsureAsciiMode -AppPid $appPid
    $asciiShot = Save-Screenshot -Name 'r3-02-ascii-abc'
    $logBefore = Get-LogCount
    Press-Backspace
    Start-Sleep -Milliseconds 650
    $del = @(Get-ChangesSince -FromIndex $logBefore -AppPid $appPid)
    $afterShot = Save-Screenshot -Name 'r3-03-after-backspace'
    $valueAfter = Get-LastValue -AppPid $appPid
    if ($del.Count -gt 0) { $valueAfter = [string]$del[$del.Count - 1].value }
    $logBeforeSubmit = Get-LogCount
    Press-Enter
    Start-Sleep -Milliseconds 900
    $submit = Get-LastEvent -EventName 'submit' -AppPid $appPid
    $submitShot = $null
    if ([ImeSpikeNative]::IsWindow($script:TargetHwnd)) {
        $submitShot = Save-Screenshot -Name 'r3-04-submitted'
    }
    $result = @{
        Round = 'R3-ascii'
        AppPid = $appPid
        Screenshots = @($readyShot, $asciiShot, $afterShot, $submitShot) | Where-Object { $_ }
        AsciiChanges = @($ascii.Changes | ForEach-Object { [string]$_.value })
        ValueAfterAscii = $ascii.Value
        BackspaceChanges = @($del | ForEach-Object { [string]$_.value })
        ValueAfterBackspace = $valueAfter
        SubmitValue = $(if ($null -ne $submit) { [string]$submit.value } else { $null })
    }
    [void]$script:RoundResults.Add($result)
    Write-Log ("ROUND3 done ascii='$($ascii.Value)' afterBackspace='$valueAfter' submit='$($result.SubmitValue)'")
    Close-SpikeWindow -Hwnd $script:TargetHwnd -AppPid $appPid
    $script:TargetHwnd = [IntPtr]::Zero
}

# --------------------------------------------------------------------------- main
$failure = $null
try {
    if (Test-Path $JsonlPath) { Remove-Item -Path $JsonlPath -Force }
    if (Test-Path $ReadyPath) { Remove-Item -Path $ReadyPath -Force }
    if (Test-Path $SummaryPath) { Remove-Item -Path $SummaryPath -Force }

    $envInfo = @{
        timestamp = (Get-Date).ToString('o')
        wtVersion = ((Get-AppxPackage Microsoft.WindowsTerminal | Select-Object -First 1).Version)
        powershell = $PSVersionTable.PSVersion.ToString()
        node = (& node --version)
        languages = @(Get-WinUserLanguageList | ForEach-Object { @{ LanguageTag = $_.LanguageTag; InputMethodTips = @($_.InputMethodTips) } })
        preload = @(Get-ItemProperty 'HKCU:\Keyboard Layout\Preload' | Select-Object -First 1 | Format-List | Out-String)
        originalForeground = @{
            hwnd = $script:OriginalForeground.ToInt64()
            title = [ImeSpikeNative]::GetTitle($script:OriginalForeground)
        }
        screen = @{ width = $script:ScreenWidth; height = $script:ScreenHeight }
    }

    Invoke-RoundChinese
    if (-not $SkipRound2) { Invoke-RoundBackspace }
    if (-not $SkipRound3) { Invoke-RoundAscii }
} catch {
    $failure = $_.Exception.Message
    Write-Log "FAILURE: $failure"
    Write-Log ($_.ScriptStackTrace)
    if ($script:TargetHwnd -ne [IntPtr]::Zero) {
        try { Save-Screenshot -Name 'ERROR-state' -Padding 170 } catch { }
    }
} finally {
    # close every window this script created (verified by title), then kill leftover app processes
    foreach ($win in @($script:CreatedWindows)) {
        try { Close-SpikeWindow -Hwnd $win.Hwnd -AppPid 0 } catch { Write-Log "cleanup warn: $($_.Exception.Message)" }
    }
    if ($script:TargetHwnd -ne [IntPtr]::Zero) {
        try { Close-SpikeWindow -Hwnd $script:TargetHwnd -AppPid 0 } catch { }
    }
    # leftover node processes whose command line is spikes/ime-spike.tsx
    $leftover = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'ime-spike' }
    foreach ($proc in @($leftover)) {
        Write-Log "STOP leftover node pid=$($proc.ProcessId)"
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    # restore the original foreground window
    if ([ImeSpikeNative]::IsWindow($script:OriginalForeground)) {
        $restored = Activate-Window -Hwnd $script:OriginalForeground -TimeoutMs 5000
        Write-Log "RESTORE original foreground 0x$($script:OriginalForeground.ToInt64().ToString('X')) restored=$restored"
    } else {
        Write-Log 'RESTORE skipped: original foreground window no longer exists'
    }
    # close the leftover Windows Terminal "Help" window if it belongs to our probing
    foreach ($win in @([ImeSpikeNative]::FindWindows('Help'))) {
        if ($win.Title -match 'Help$') {
            $procName = (Get-Process -Id $win.ProcessId -ErrorAction SilentlyContinue).ProcessName
            if ($procName -eq 'WindowsTerminal') {
                Write-Log "CLOSE leftover WT Help window 0x$($win.Hwnd.ToInt64().ToString('X')) pid=$($win.ProcessId)"
                [void][ImeSpikeNative]::PostMessage($win.Hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            }
        }
    }

    $summary = @{
        timestamp = (Get-Date).ToString('o')
        failure = $failure
        rounds = @($script:RoundResults.ToArray())
        evidence = @{
            jsonl = $JsonlPath
            screenshots = @(Get-ChildItem -Path $OutDir -Filter '*.png' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
            log = $LogPath
        }
        env = $envInfo
    }
    $json = $summary | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($SummaryPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Log "SUMMARY written to $SummaryPath"
    Write-Log '=== run-ime-spike.ps1 end ==='
}

if ($null -ne $failure) { exit 1 }
exit 0
