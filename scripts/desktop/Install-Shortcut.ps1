# Creates (or refreshes) a "Magi" shortcut on the Desktop pointing at
# Start-Magi.vbs, with magi.ico as its icon. Safe to re-run any time (e.g.
# after moving the repo, or regenerating the icon) — it just overwrites the
# existing .lnk in place.
#
# Windows only lets a user pin something to the taskbar themselves (no
# script can do that reliably since Windows 10) — after running this,
# right-click the new Desktop shortcut and choose "Pin to taskbar" (or drag
# it there) if you want it in both places.

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Magi.lnk"
$vbsPath = (Resolve-Path (Join-Path $PSScriptRoot "Start-Magi.vbs")).Path
$iconPath = (Resolve-Path (Join-Path $PSScriptRoot "magi.ico")).Path
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Open Magi"
$shortcut.Save()

Write-Output "Created shortcut: $shortcutPath"
