@echo off
title All-in-one EDITOR server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run - installing dependencies...
  call npm install
)

echo.
echo  Server starting - KEEP THIS WINDOW OPEN while you use the site.
echo  Site: http://localhost:3000
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
