# Builds ONE self-contained GlobalRemoteControl.exe (no .NET install needed) into remote/agent/dist/.
#   powershell -ExecutionPolicy Bypass -File remote/agent/publish.ps1
# SIPSorcery, NAudio and Vortice are fully managed (Vortice calls the d3d11/dxgi DLLs that ship with Windows), so
# everything is bundled; IncludeNativeLibrariesForSelfExtract also packs the runtime's own native DLLs into the exe.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$project = Join-Path $root 'GlobalRemoteControl.Agent\GlobalRemoteControl.Agent.csproj'
$out = Join-Path $root 'GlobalRemoteControl.Agent\bin\publish'
$dist = Join-Path $root 'dist'

if (Test-Path $out) { Remove-Item -Recurse -Force $out }

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none `
    -p:GenerateDocumentationFile=false `
    -o $out
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }

$exe = Join-Path $out 'GlobalRemoteControl.exe'
if (-not (Test-Path $exe)) { throw "Publish did not produce $exe" }
$extra = Get-ChildItem $out -File | Where-Object { $_.Name -ne 'GlobalRemoteControl.exe' }
if ($extra) { Write-Warning ("Files left next to the exe (not bundled): " + ($extra.Name -join ', ')) }

New-Item -ItemType Directory -Force $dist | Out-Null
$target = Join-Path $dist 'GlobalRemoteControl.exe'
Copy-Item $exe $target -Force
$mb = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Host "Published $target ($mb MB)"
