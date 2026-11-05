@echo off
title All-in-one EDITOR server
cd /d "%~dp0"

node -v >nul 2>nul
if errorlevel 1 goto nonode
npm -v >nul 2>nul
if errorlevel 1 goto nonode

if not exist node_modules (
  echo First run - installing dependencies ^(one time, takes a minute^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo  Server starting - KEEP THIS WINDOW OPEN while you use the site.
echo  Site: http://localhost:3000
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
echo.
echo The server stopped. Read the message above, then press a key to close.
pause
exit /b 0

:nonode
echo.
echo  Node.js is NOT installed on this PC, so the server can't start.
echo.
echo  1. Go to https://nodejs.org and install the LTS version (the default options are fine).
echo  2. Close this window and double-click START-SERVER.bat again.
echo.
pause
exit /b 1
