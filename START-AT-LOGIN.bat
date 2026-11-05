@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem  Turns "start the All-in-one EDITOR server when I log in to Windows" on or off.
rem  ON  = puts a shortcut in your Startup folder that runs START-SERVER.bat /quiet
rem        in a minimized window (no browser, no questions).
rem  OFF = deletes that shortcut. Nothing else on the PC is changed.

set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\All-in-one EDITOR server.lnk"

if exist "%LNK%" (
  echo  The server currently STARTS AUTOMATICALLY when you log in.
  choice /c YN /m " Turn that off"
  if errorlevel 2 exit /b 0
  del "%LNK%"
  echo  Done: the server will no longer start at login.
  ping -n 5 127.0.0.1 >nul
  exit /b 0
)

echo  This makes the server start by itself, minimized, every time you log in to Windows,
echo  so the editor's downloads always use this PC. Run this file again to turn it off.
choice /c YN /m " Turn it on"
if errorlevel 2 exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath=(Join-Path (Get-Location) 'START-SERVER.bat'); $s.Arguments='/quiet'; $s.WorkingDirectory=(Get-Location).Path; $s.WindowStyle=7; $s.Description='All-in-one EDITOR local server'; $s.Save()"
if not exist "%LNK%" (
  echo  Could not create the shortcut.
  pause
  exit /b 1
)
echo  Done: the server will start at login. Starting it now too...
start "All-in-one EDITOR server" /min "%~dp0START-SERVER.bat" /quiet
ping -n 5 127.0.0.1 >nul
exit /b 0
