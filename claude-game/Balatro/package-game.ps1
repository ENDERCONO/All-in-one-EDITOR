# package-game.ps1
# Packages the Balatro Lua source + resources into game.love (a ZIP file
# that love.js can load in the browser).
# Run with: right-click → "Run with PowerShell"

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "Packaging Balatro for the web..." -ForegroundColor Yellow

# Everything to include in game.love:
$includes = @(
    '*.lua',          # all root Lua files (main.lua, game.lua, ...)
    '*.jkr',          # version file
    'conf.lua',       # LOVE config
    'resources'       # sounds, textures, shaders, fonts
)

$dest = Join-Path $here 'game.love'

# Remove old package if it exists
if (Test-Path $dest) {
    Remove-Item $dest -Force
    Write-Host "  Removed old game.love" -ForegroundColor Gray
}

# Build list of items to compress
$items = @()
foreach ($pat in $includes) {
    $found = Get-ChildItem -Path $here -Filter $pat -ErrorAction SilentlyContinue
    if ($found) { $items += $found.FullName }
}
# Also include the resources folder itself if it exists
$resDir = Join-Path $here 'resources'
if (Test-Path $resDir) {
    $items += $resDir
}
# engine/ and functions/ and localization/ sub-folders
foreach ($sub in 'engine','functions','localization') {
    $d = Join-Path $here $sub
    if (Test-Path $d) { $items += $d }
}

if ($items.Count -eq 0) {
    Write-Host "ERROR: No game files found in $here" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Compressing $($items.Count) item(s)..." -ForegroundColor Gray
Compress-Archive -Path $items -DestinationPath $dest -CompressionLevel Optimal

$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "  game.love created ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next step:" -ForegroundColor Cyan
Write-Host "  1. Download love.js from https://github.com/Davidobot/love.js/releases"
Write-Host "  2. Extract love.js and love.wasm into Balatro\love.js\"
Write-Host "  3. Open Balatro/index.html in your browser (via the local server)"
Write-Host ""
Read-Host "Done — press Enter to close"
