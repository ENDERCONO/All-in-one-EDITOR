@echo off
:: Run this from inside the Balatro folder (double-click it there)
cd /d "%~dp0"
echo.
echo  Creating game.love ...
echo.

if exist game.zip  del /q game.zip
if exist game.love del /q game.love

powershell -ExecutionPolicy Bypass -NoProfile -Command "$f=@(); Get-ChildItem -Filter '*.lua' | ForEach-Object { $f+=$_.FullName }; Get-ChildItem -Filter '*.jkr' | ForEach-Object { $f+=$_.FullName }; foreach($d in 'resources','engine','functions','localization'){if(Test-Path $d){$f+=(Resolve-Path $d).Path}}; if($f.Count-eq 0){Write-Host 'ERROR: no .lua files found here'; exit 1}; Compress-Archive -Path $f -DestinationPath 'game.zip' -Force; Rename-Item 'game.zip' 'game.love'; $s=[math]::Round((Get-Item 'game.love').Length/1MB,1); Write-Host ('Done — game.love ' + $s + ' MB')"

echo.
if exist game.love (
  echo  SUCCESS: game.love is ready.
) else (
  echo  FAILED. Make sure you double-clicked this .bat
  echo  from INSIDE the Balatro folder, not from Downloads.
)
echo.
pause
