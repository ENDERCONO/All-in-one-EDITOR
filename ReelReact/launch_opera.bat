@echo off
echo Closing any existing Opera GX processes...
taskkill /f /im opera.exe >nul 2>&1
timeout /t 3 /nobreak >nul

set OPERA=
if exist "%LOCALAPPDATA%\Programs\Opera GX\opera.exe" set OPERA=%LOCALAPPDATA%\Programs\Opera GX\opera.exe
if exist "%PROGRAMFILES%\Opera GX\opera.exe" set OPERA=%PROGRAMFILES%\Opera GX\opera.exe
if exist "%PROGRAMFILES(X86)%\Opera GX\opera.exe" set OPERA=%PROGRAMFILES(X86)%\Opera GX\opera.exe

if not defined OPERA (
    echo [ERROR] Opera GX not found. Edit this file and set the OPERA variable manually.
    pause & exit /b 1
)

echo Launching Opera GX with debug port 9222...
start "" "%OPERA%" --remote-debugging-port=9222 --remote-debugging-address=localhost --no-first-run

echo Waiting 5 seconds for Opera to start...
timeout /t 5 /nobreak >nul

echo Checking if debug port is open...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9222/json' -UseBasicParsing -TimeoutSec 5; Write-Host 'SUCCESS: Debug port is open!'; } catch { Write-Host 'WARNING: Port not responding yet - wait a few more seconds before running the bot.'; }"

echo.
echo Now run PumpkinReactor.exe
pause
