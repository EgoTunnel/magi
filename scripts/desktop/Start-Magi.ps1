# Launches Magi like a desktop app: starts the dev server if it isn't
# already running, waits for it to come up, then opens it in a chromeless
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

if (-not (Test-MagiUp)) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" -WorkingDirectory $repoRoot -WindowStyle Hidden

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
