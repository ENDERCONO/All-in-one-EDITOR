@echo off
echo ============================================
echo  Pumpkin Reactor - EXE Builder (Fixed)
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found! Install Python 3.10+ from python.org
    pause
    exit /b 1
)

echo Python found:
python --version
echo.

echo [1/4] Installing dependencies (using python -m pip to avoid path issues)...
python -m pip install --upgrade pip --quiet
python -m pip install playwright pyinstaller --quiet
if errorlevel 1 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
)
echo Done installing packages.
echo.

echo [2/4] Installing Playwright browsers...
python -m playwright install chromium
if errorlevel 1 (
    echo [ERROR] Playwright browser install failed.
    pause
    exit /b 1
)
echo Done installing browsers.
echo.

echo [3/4] Building EXE with PyInstaller...
python -m PyInstaller ^
    --onefile ^
    --name "PumpkinReactor" ^
    --collect-all playwright ^
    --hidden-import playwright ^
    --hidden-import playwright.sync_api ^
    pumpkin_reactor.py

if errorlevel 1 (
    echo [ERROR] PyInstaller build failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  [4/4] BUILD COMPLETE!
echo ============================================
echo.
echo  Your EXE is at:  dist\PumpkinReactor.exe
echo.
echo  HOW TO USE:
echo    1. Double-click dist\PumpkinReactor.exe
echo    2. A browser window will open
echo    3. If not logged in, log in to Instagram manually
echo    4. Bot reacts to last 10 reels, then watches for new ones
echo    5. Press Ctrl+C in the console window to stop
echo.
pause
