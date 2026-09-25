# Launches Magi like a desktop app: starts the server if it isn't already
# running, waits for it to come up, then opens it in a chromeless
# Edge "app mode" window (no address bar/tabs) using its own profile so it
# doesn't get merged into your regular browsing session. Meant to be run
# via Start-Magi.vbs (silent), not double-clicked directly — run directly
# from a terminal if you want to see its progress/errors.

$ErrorActionPreference = "SilentlyContinue"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$url = "http://localhost:3000/"

function Test-MagiUp {
    try {
        $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $res.StatusCode -ge 200 -and $res.StatusCode -lt 500
    } catch {
        return $false
    }
}

# True when there is no production build yet, or anything that goes into one
# has changed since it was made. Checked by timestamp against .next/BUILD_ID,
# which `next build` writes last — so an interrupted build also counts as stale.
function Test-BuildStale {
    $buildId = Join-Path $repoRoot ".next\BUILD_ID"
    if (-not (Test-Path $buildId)) { return $true }
    $builtAt = (Get-Item $buildId).LastWriteTime

    $inputs = @("package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json") |
        ForEach-Object { Join-Path $repoRoot $_ } | Where-Object { Test-Path $_ } | ForEach-Object { Get-Item $_ }
    $inputs += Get-ChildItem -Path (Join-Path $repoRoot "src"), (Join-Path $repoRoot "public") -Recurse -File
    return [bool]($inputs | Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1)
}

if (-not (Test-MagiUp)) {
    # Magi used to be launched with `npm run dev`. The dev server compiles each
    # page the first time it is visited and ships React's development build,
    # which is most of why the app felt slow next to a hosted chat app. A
    # production build is compiled once, up front, and only rebuilt when the
    # code actually changes (a `git pull`, or an edit).
    $mode = "start"
    if (Test-BuildStale) {
        $build = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run build" -WorkingDirectory $repoRoot -WindowStyle Hidden -Wait -PassThru
        # A broken build must not leave you without Magi — the dev server
        # still works (and shows the error) when the production build won't.
        if ($build.ExitCode -ne 0) { $mode = "dev" }
    }
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run $mode" -WorkingDirectory $repoRoot -WindowStyle Hidden

    $waited = 0
    while (-not (Test-MagiUp) -and $waited -lt 60) {
        Start-Sleep -Seconds 1
        $waited++
    }
    if ($waited -ge 60) {
        # Fall back to a normal browser tab so the user at least sees *something*
        # (likely a connection error) rather than nothing happening at all.
        Start-Process $url
        exit 1
    }
}

$edgeCandidates = @(
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    $profileDir = Join-Path $env:LOCALAPPDATA "MagiAppMode"
    Start-Process -FilePath $edge -ArgumentList "--app=$url", "--user-data-dir=$profileDir"
} else {
    Start-Process $url
}
