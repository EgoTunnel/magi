' Silent launcher for the Desktop/taskbar shortcut — runs Start-Magi.ps1
' fully hidden (no PowerShell console flash) via WScript.Shell.Run's
' windowStyle=0. This is the actual shortcut target; Start-Magi.ps1 is
' where the real logic lives.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1Path = fso.BuildPath(scriptDir, "Start-Magi.ps1")

Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
shell.Run cmd, 0, False
