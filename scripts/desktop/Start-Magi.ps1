# Launches Magi like a desktop app: shows a "Starting Magi" window straight
# away, builds Magi if the code has changed since the last build, starts the
# server, and the window turns into Magi itself as soon as it answers. Opens
# in a chromeless Edge "app mode" window (no address bar/tabs) with its own
# profile, so it isn't merged into your regular browsing session.
#
# Meant to be run via Start-Magi.vbs (silent). Everything it does, and all
# build and server output, goes to data\launcher.log in the Magi folder — the
# first place to look if Magi doesn't start. To watch a launch, run it from a
# terminal:  powershell -ExecutionPolicy Bypass -File scripts\desktop\Start-Magi.ps1
#
# -NoBrowser skips opening any window (used to test the launcher itself).
param([switch]$NoBrowser)

$ErrorActionPreference = "Continue"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$url = "http://localhost:3000/"
$onWindows = $env:OS -eq "Windows_NT"
# Minutes a build may take before it's treated as stuck. A first build on a
# slow machine takes a few; anything near this is not going to finish.
$buildTimeoutMinutes = 15
# Seconds to wait for the server once it's been started.
$startTimeoutSeconds = 180

$dataDir = Join-Path $repoRoot "data"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$log = Join-Path $dataDir "launcher.log"
if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) { Move-Item -Force $log "$log.old" }

function Write-Log([string]$message) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message)
}

# Next.js reports anonymous usage after a build from a detached background
# process. Nothing here needs it, and a launcher shouldn't depend on it.
$env:NEXT_TELEMETRY_DISABLED = "1"

# "up": Magi answered. "error": something on the port answered with a server
# error (an older Magi that broke, typically after an update). "down": nothing.
function Get-MagiState {
    try {
        $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        if ([int]$res.StatusCode -lt 500) { return "up" }
        return "error"
    } catch {
        $response = $_.Exception.Response
        if ($response) {
            if ([int]$response.StatusCode -lt 500) { return "up" }
            return "error"
        }
        return "down"
    }
}

# True when there is no production build yet, or anything that goes into one
# has changed since it was made. Checked by timestamp against .next/BUILD_ID,
# which `next build` writes last — so an interrupted build also counts as stale.
function Test-BuildStale {
    $buildId = Join-Path $repoRoot ".next\BUILD_ID"
    if (-not (Test-Path $buildId)) { return $true }
    $builtAt = (Get-Item $buildId).LastWriteTime
    $inputs = @()
    foreach ($name in @("package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json")) {
        $path = Join-Path $repoRoot $name
        if (Test-Path $path) { $inputs += Get-Item $path }
    }
    foreach ($dir in @("src", "public")) {
        $path = Join-Path $repoRoot $dir
        if (Test-Path $path) { $inputs += Get-ChildItem -Path $path -Recurse -File }
    }
    return [bool]($inputs | Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1)
}

# Runs `npm run <script>` in the background with its output going to the log,
# and returns the process. Deliberately not `Start-Process -Wait`: on Windows
# that waits for every process the command ever starts, including background
# ones that outlive it — which could leave a launch waiting forever with
# nothing on screen.
function Start-Npm([string]$script) {
    Write-Log "Running: npm run $script"
    if ($onWindows) {
        $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run $script >> `"$log`" 2>&1" `
            -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    } else {
        # Off Windows (used to test this script): the same, through sh.
        $p = Start-Process -FilePath "/bin/sh" -ArgumentList "-c", "`"npm run $script >> '$log' 2>&1`"" `
            -WorkingDirectory $repoRoot -PassThru
    }
    # Windows PowerShell only reports ExitCode for a process whose handle was
    # read while it ran.
    $null = $p.Handle
    return $p
}

function Stop-ProcessTree([int]$id) {
    if ($onWindows) { & taskkill.exe /PID $id /T /F *> $null } else { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

# Stops a Magi server that holds the port but can't serve — the leftover of an
# earlier run, most often a development server still running old code after an
# update. Only a Node process listening on Magi's port is touched.
function Stop-StaleServer {
    if (-not $onWindows) { return }
    try {
        $listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop
    } catch {
        return
    }
    foreach ($owner in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq "node") {
            Write-Log "Stopping a Magi server that was answering with errors (process $owner)."
            Stop-ProcessTree $owner
        }
    }
    Start-Sleep -Seconds 2
}

function Open-Window([string]$target) {
    if ($NoBrowser) { return }
    $edgeCandidates = @(
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
    )
    $edge = $edgeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($edge) {
        $profileDir = Join-Path $env:LOCALAPPDATA "MagiAppMode"
        Start-Process -FilePath $edge -ArgumentList "--app=$target", "--user-data-dir=$profileDir"
    } else {
        Start-Process $target
    }
}

# The window shown while Magi gets ready. It checks for the server itself and
# becomes Magi the moment it answers, so this script never has to open a
# second window.
function Open-StartingWindow {
    $page = ([System.Uri](Join-Path $PSScriptRoot "starting.html")).AbsoluteUri
    Open-Window ("{0}?log={1}" -f $page, [System.Uri]::EscapeDataString($log))
}

# One launch at a time. A second click while a build is running would start a
# second build into the same folder; instead it just shows the window again.
$lock = Join-Path $dataDir "launcher.lock"
if (Test-Path $lock) {
    $holder = Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1
    $running = if ($holder) { Get-Process -Id ([int]$holder) -ErrorAction SilentlyContinue } else { $null }
    if ($running -and $running.ProcessName -match "powershell|pwsh") {
        Write-Log "A launch is already in progress (process $holder); showing its window."
        Open-StartingWindow
        exit 0
    }
}
Set-Content -Path $lock -Value $PID

# Set inside the try and applied after it: exiting from inside a try block
# can skip its finally in Windows PowerShell, which would leave the lock behind.
$exitCode = 0
try {
    Write-Log "---- Launch (PowerShell $($PSVersionTable.PSVersion), folder $repoRoot)"
    $state = Get-MagiState
    if ($state -eq "up") {
        Write-Log "Magi is already running; opening it."
        Open-Window $url
        return
    }

    Open-StartingWindow
    if ($state -eq "error") { Stop-StaleServer }

    # Magi used to be launched with `npm run dev`. The dev server compiles each
    # page the first time it's visited and ships React's development build,
    # which is most of why the app felt slow. A production build is compiled
    # once, up front, and only rebuilt when the code actually changes.
    $mode = "start"
    if (Test-BuildStale) {
        Write-Log "The code has changed since the last build; building (this takes a few minutes the first time)."
        $build = Start-Npm "build"
        if (-not $build.WaitForExit($buildTimeoutMinutes * 60 * 1000)) {
            Write-Log "The build was still running after $buildTimeoutMinutes minutes; stopping it and using the development server."
            Stop-ProcessTree $build.Id
            $mode = "dev"
        } elseif ($build.ExitCode -ne 0) {
            # A broken build must not leave you without Magi — the dev server
            # still works (and shows the error) when the production build won't.
            Write-Log "The build failed (exit code $($build.ExitCode)); using the development server instead. The error is above."
            $mode = "dev"
        } else {
            Write-Log "Build finished."
        }
    }

    $null = Start-Npm $mode
    $waited = 0
    while ((Get-MagiState) -ne "up" -and $waited -lt $startTimeoutSeconds) {
        Start-Sleep -Seconds 2
        $waited += 2
    }
    if ((Get-MagiState) -eq "up") {
        Write-Log "Magi is up ($mode)."
    } else {
        Write-Log "Magi didn't answer within $startTimeoutSeconds seconds of starting. The server's output is above."
        if ($onWindows -and -not $NoBrowser) { Start-Process notepad.exe -ArgumentList "`"$log`"" }
        $exitCode = 1
    }
} finally {
    Remove-Item -Path $lock -ErrorAction SilentlyContinue
}
exit $exitCode
