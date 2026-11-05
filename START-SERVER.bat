@echo off
setlocal EnableExtensions EnableDelayedExpansion
title All-in-one EDITOR server
cd /d "%~dp0"

rem  Double-click to start the local server (http://localhost:3000).
rem  It sets itself up: installs Node.js if missing (asks first), installs or
rem  updates the dependencies when package.json changes, opens the site, and
rem  restarts the server if it crashes.
rem  START-SERVER.bat /quiet  = no browser, no questions (used by START-AT-LOGIN.bat)

set "PORT=3000"
set "QUIET="
if /i "%~1"=="/quiet" set "QUIET=1"

rem ---- already running? then just open the site
curl.exe -s -o nul -m 2 http://localhost:%PORT%/api/dl/ping >nul 2>nul
if not errorlevel 1 (
  echo  The server is already running on this PC: http://localhost:%PORT%
  if not defined QUIET start "" http://localhost:%PORT%
  ping -n 4 127.0.0.1 >nul
  exit /b 0
)

rem ---- Node.js
call :findnode
if not defined HAVENODE call :installnode
if not defined HAVENODE goto nonode

rem ---- dependencies: install on first run and again whenever package.json changes
set "NEEDINSTALL="
if not exist "node_modules\express\package.json" set "NEEDINSTALL=1"
if not exist "node_modules\.installed-package.json" set "NEEDINSTALL=1"
if not defined NEEDINSTALL (
  fc /b package.json "node_modules\.installed-package.json" >nul 2>nul
  if errorlevel 1 set "NEEDINSTALL=1"
)
if defined NEEDINSTALL (
  echo  Installing / updating dependencies ^(takes a minute the first time^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check your internet connection and try again.
    if not defined QUIET pause
    exit /b 1
  )
  copy /y package.json "node_modules\.installed-package.json" >nul
)

rem ---- run, and restart after a crash (gives up after 5 crashes in a row)
echo.
echo  Server starting - KEEP THIS WINDOW OPEN while you use the site.
echo  Site:      http://localhost:%PORT%
echo  Downloads: the editor uses THIS PC's server automatically (port %PORT%).
echo  To stop:   close this window.
echo.
if not defined QUIET start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:%PORT%"

set /a CRASHES=0
:run
node server.js
set "CODE=!errorlevel!"
set /a CRASHES+=1
echo.
if !CRASHES! geq 5 (
  echo  The server stopped 5 times in a row ^(last exit code !CODE!^). Read the messages above.
  echo  If it says EADDRINUSE, another program is using port %PORT%.
  if not defined QUIET pause
  exit /b 1
)
echo  The server stopped ^(exit code !CODE!^). Restarting in 5 seconds... close this window to stop.
ping -n 6 127.0.0.1 >nul
goto run

rem ------------------------------------------------------------------ helpers
:findnode
set "HAVENODE="
node -v >nul 2>nul
if errorlevel 1 exit /b 0
call npm -v >nul 2>nul
if errorlevel 1 exit /b 0
set "HAVENODE=1"
exit /b 0

:installnode
rem Install Node.js LTS once, with Volta if present, else with winget. Asks first.
set "HOW="
if exist "%ProgramFiles%\Volta\volta.exe" (
  set "HOW=volta"
) else (
  where winget >nul 2>nul
  if not errorlevel 1 set "HOW=winget"
)
if not defined HOW exit /b 0
if defined QUIET exit /b 0
echo.
echo  Node.js is not installed. The server needs it ^(one-time install, free^).
if "!HOW!"=="volta" (
  choice /c YN /t 20 /d Y /m " Install Node.js LTS now with Volta? Starts by itself in 20 s"
) else (
  choice /c YN /t 20 /d Y /m " Install Node.js LTS now with winget (accepts the Node.js license; Windows may ask for permission)? Starts by itself in 20 s"
)
if errorlevel 2 exit /b 0
if "!HOW!"=="volta" (
  "%ProgramFiles%\Volta\volta.exe" install node@lts
) else (
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
rem make the new install visible to this window without reopening it
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Volta\bin;%ProgramFiles%\Volta;%PATH%"
call :findnode
exit /b 0

:nonode
echo.
echo  Node.js is NOT installed on this PC, so the server can't start.
echo.
if exist "%ProgramFiles%\Volta\volta.exe" (
  echo  Volta is installed. Run this in a new terminal, then double-click START-SERVER.bat again:
  echo      volta install node@lts
) else (
  echo  1. Go to https://nodejs.org and install the LTS version ^(the default options are fine^).
  echo  2. Close this window and double-click START-SERVER.bat again.
)
echo.
if not defined QUIET pause
exit /b 1
