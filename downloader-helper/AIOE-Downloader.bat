@echo off
rem  All-in-one EDITOR - Downloader helper (Windows 10 / 11)
rem  Double-click it and keep the window open. The site (GitHub Pages or a file
rem  on disk) finds it at http://localhost:3000 and downloads through it, using
rem  YOUR internet connection, which YouTube accepts.
rem  Nothing to install: the first run fetches yt-dlp, ffmpeg and Deno into
rem  %LOCALAPPDATA%\AIOE-Downloader (about 200 MB). Close the window to stop.
title AIOE Downloader helper
set "AIOE_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:AIOE_SELF); $i=$s.IndexOf('#==' + '== POWERSHELL'); iex $s.Substring($i)"
echo.
pause
exit /b

#==== POWERSHELL ====
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Port = 3000
$Root = Join-Path $env:LOCALAPPDATA 'AIOE-Downloader'
$Bin  = Join-Path $Root 'bin'
$Jobs = Join-Path $env:TEMP 'aioe-downloads'
$YtDlp  = Join-Path $Bin 'yt-dlp.exe'
$FFmpeg = Join-Path $Bin 'ffmpeg.exe'
$Deno   = Join-Path $Bin 'deno.exe'
New-Item -ItemType Directory -Force -Path $Bin, $Jobs | Out-Null

function Say($msg, $color = 'Gray') { Write-Host ("  " + $msg) -ForegroundColor $color }

Write-Host ''
Say 'All-in-one EDITOR - Downloader helper' 'Cyan'
Say '-------------------------------------' 'Cyan'

# ---- already running? (the helper or START-SERVER.bat)
try {
  $p = Invoke-RestMethod -Uri "http://localhost:$Port/api/dl/ping" -TimeoutSec 2
  if ($p.ok) { Say "A download server is already running on port $Port - nothing to do." 'Green'; return }
} catch {}

# ---- first run: fetch the tools
function Fetch($url, $dest) {
  $tmp = $dest + '.part'
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --progress-bar -o $tmp $url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  } else {
    (New-Object Net.WebClient).DownloadFile($url, $tmp)
  }
  Move-Item -Force $tmp $dest
}
function FetchZipExe($url, $names) {
  $zip = Join-Path $Root 'tmp.zip'
  $out = Join-Path $Root 'tmp-unzip'
  Fetch $url $zip
  if (Test-Path $out) { Remove-Item -Recurse -Force $out }
  Expand-Archive -Force -Path $zip -DestinationPath $out
  foreach ($n in $names) {
    $f = Get-ChildItem -Path $out -Recurse -Filter $n | Select-Object -First 1
    if ($f) { Copy-Item -Force $f.FullName (Join-Path $Bin $n) }
  }
  Remove-Item -Force $zip
  Remove-Item -Recurse -Force $out
}

try {
  if (-not (Test-Path $YtDlp)) {
    Say 'First run: downloading yt-dlp (about 18 MB)...' 'Yellow'
    Fetch 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' $YtDlp
  } else {
    Say 'Checking for a newer yt-dlp (YouTube changes often)...'
    try { & $YtDlp -U 2>&1 | Select-Object -Last 1 | ForEach-Object { Say $_ } } catch {}
  }
  if (-not (Test-Path $FFmpeg)) {
    Say 'First run: downloading ffmpeg (about 150 MB, only once)...' 'Yellow'
    FetchZipExe 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' @('ffmpeg.exe', 'ffprobe.exe')
  }
  if (-not (Test-Path $Deno)) {
    Say 'First run: downloading Deno - YouTube needs it to unlock formats (about 40 MB)...' 'Yellow'
    try { FetchZipExe 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' @('deno.exe') }
    catch { Say ('Deno download failed (downloads may still work): ' + $_.Exception.Message) 'DarkYellow' }
  }
} catch {
  Say ('Setup failed: ' + $_.Exception.Message) 'Red'
  Say 'Check your internet connection and run the helper again.' 'Red'
  return
}
$YtVersion = ''
try { $YtVersion = (& $YtDlp --version | Select-Object -First 1).Trim() } catch {}

# ---- jobs
$jobs = @{}
$seq = 0
$ClientFallbacks = @('', 'youtube:player_client=tv_simply,web_safari', 'youtube:player_client=mweb,web_embedded', 'youtube:player_client=tv,ios')
$Permanent = 'private video|video unavailable|this video is not available|unsupported url|members-only|join this channel|confirm your age|age-restricted|copyright|has been removed|does not exist|HTTP Error 404'

function Q($s) { '"' + ($s -replace '"', '\"') + '"' }

function CommonArgs() {
  $a = @('--no-warnings', '--ignore-config', '--ffmpeg-location', (Q $Bin))
  if (Test-Path $Deno) { $a += @('--js-runtimes', (Q ('deno:' + $Deno))) }
  return $a
}

function StartAttempt($job) {
  $o = $job.opts
  $a = CommonArgs
  $extra = $ClientFallbacks[$job.attempt]
  if ($extra) { $a += @('--extractor-args', (Q $extra)) }
  $a += @('--newline', '--no-playlist', '--no-mtime', '-N', '8', '-o', (Q (Join-Path $job.dir '%(title).150B.%(ext)s')))
  if ($o.kind -eq 'audio') {
    $a += @('-f', 'bestaudio/best', '-x', '--audio-format', $o.format)
    $kbps = 0; [int]::TryParse($o.quality, [ref]$kbps) | Out-Null
    if ($kbps -gt 0 -and $o.format -ne 'wav' -and $o.format -ne 'flac') { $a += @('--audio-quality', "$($kbps)K") }
    $a += '--embed-metadata'
    if ($job.attempt -eq 0 -and ($o.format -eq 'mp3' -or $o.format -eq 'm4a')) { $a += @('--embed-thumbnail', '--convert-thumbnails', 'jpg') }
  } else {
    $h = 0; [int]::TryParse($o.quality, [ref]$h) | Out-Null
    $cap = ''; if ($h -gt 0) { $cap = "[height<=$h]" }
    if ($o.kind -eq 'mute') { $a += @('-f', (Q "bv*$cap[ext=mp4]/bv*$cap/bv*")) }
    else { $a += @('-f', (Q "bv*$cap[ext=mp4]+ba[ext=m4a]/bv*$cap+ba/b$cap/b"), '--merge-output-format', 'mp4') }
    $a += '--embed-metadata'
  }
  $a += @('--', (Q $o.url))
  Get-ChildItem -Path $job.dir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $job.proc = NewProc $a
  $job.outTask = $job.proc.StandardOutput.ReadLineAsync()
  $job.errTask = $job.proc.StandardError.ReadToEndAsync()
}

# yt-dlp runs hidden; its output is read with async reads, polled on each
# progress request (PowerShell can't take .NET output events on other threads)
function NewProc($argList) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $YtDlp
  $psi.Arguments = $argList -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $psi.EnvironmentVariables['PYTHONUTF8'] = '1'
  return [Diagnostics.Process]::Start($psi)
}

function KillTree($proc) {
  try { if ($proc -and -not $proc.HasExited) { & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null } } catch {}
}

function Refresh($job) {
  if ($job.state -eq 'done' -or $job.state -eq 'error') { return }
  $lines = New-Object System.Collections.ArrayList
  while ($job.outTask -and $job.outTask.IsCompleted) {
    $l = $job.outTask.Result
    if ($null -eq $l) { $job.outTask = $null; break }   # end of output
    [void]$lines.Add($l)
    $job.outTask = $job.proc.StandardOutput.ReadLineAsync()
  }
  foreach ($line in $lines) {
    if ($line -match '\[download\]\s+([\d.]+)%\s+of\s+~?\s*[\d.]+\w+(?:\s+at\s+([\d.]+\s*\w+/s))?(?:\s+ETA\s+([\d:]+))?') {
      $job.state = 'downloading'; $job.pct = [double]$Matches[1]; $job.speed = "$($Matches[2])"; $job.eta = "$($Matches[3])"
    } elseif ($line -match '^\[(Merger|ExtractAudio|VideoConvertor|Fixup|EmbedThumbnail|Metadata|ThumbnailsConvertor)') {
      $job.state = 'processing'; $job.pct = 99
    }
    if ($line -match '\[download\] Destination: (.+)$' -and $Matches[1] -notmatch '\.(jpe?g|webp|png)$') {
      $job.title = [IO.Path]::GetFileNameWithoutExtension($Matches[1].Trim())
    }
  }
  if (-not $job.proc.HasExited -or $job.outTask) { return }
  $job.proc.WaitForExit()
  if ($job.proc.ExitCode -eq 0) {
    $media = @(Get-ChildItem -Path $job.dir -File | Where-Object { $_.Name -notmatch '\.(part|ytdl|temp|jpe?g|webp|png|txt)$' -and $_.Name -notmatch '\.part-Frag' } | Sort-Object Length -Descending)
    if ($media) { $job.file = $media[0].FullName; $job.pct = 100; $job.state = 'done'; return }
    $job.error = 'Download finished but produced no file'
  } else {
    $errLines = "$($job.errTask.Result)" -split "`r?`n" | Where-Object { $_ -like 'ERROR:*' }
    $job.error = if ($errLines) { ($errLines | Select-Object -Last 1) -replace '^ERROR:\s*(\[[^\]]*\]\s*)?([A-Za-z0-9_-]{6,}:\s*)?', '' } else { "downloader exited with code $($job.proc.ExitCode)" }
  }
  if ($job.attempt -lt $ClientFallbacks.Count - 1 -and $job.error -notmatch $Permanent) {
    $job.attempt++; $job.state = 'updating'; $job.pct = 0; $job.error = $null
    StartAttempt $job
    return
  }
  if ($job.error -match 'not a bot|sign in to confirm') { $job.error = "YouTube's bot check blocked this download. Wait a few minutes, or sign in to YouTube in your browser and try again." }
  $job.state = 'error'
}

function DropJob($job) {
  KillTree $job.proc
  $jobs.Remove($job.id)
  Start-Sleep -Milliseconds 150
  Remove-Item -Recurse -Force $job.dir -ErrorAction SilentlyContinue
}

# ---- HTTP
function Send($ctx, $code, $body, $type = 'application/json; charset=utf-8') {
  $r = $ctx.Response
  $r.StatusCode = $code
  $r.ContentType = $type
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $r.ContentLength64 = $bytes.Length
  $r.OutputStream.Write($bytes, 0, $bytes.Length)
  $r.OutputStream.Close()
}
function SendJson($ctx, $obj, $code = 200) { Send $ctx $code (ConvertTo-Json -InputObject $obj -Depth 6 -Compress) }

function RunCapture($argList, $timeoutSec) {
  $p = NewProc $argList
  $errTask = $p.StandardError.ReadToEndAsync()
  $outTask = $p.StandardOutput.ReadToEndAsync()
  if (-not $p.WaitForExit($timeoutSec * 1000)) { KillTree $p; throw 'Timed out reading the playlist' }
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) {
    $e = ($errTask.Result -split "`r?`n" | Where-Object { $_ -like 'ERROR:*' } | Select-Object -Last 1)
    if (-not $e) { $e = "exited with code $($p.ExitCode)" }
    throw ($e -replace '^ERROR:\s*(\[[^\]]*\]\s*)?', '')
  }
  return $outTask.Result
}

function Expand($url, $max) {
  $sep = '~|~'   # field separator for the printed lines
  $entryFmt = "E$sep%(id)s$sep%(duration|0)s$sep%(url)s$sep%(uploader|)s$sep%(title)s"
  $plFmt = "playlist:P$sep%(title)s$sep%(uploader|)s"
  $a = (CommonArgs) + @('--flat-playlist', '--yes-playlist', '--playlist-end', "$max", '-O', (Q $entryFmt), '-O', (Q $plFmt), '--', (Q $url))
  $out = RunCapture $a 120
  $entries = New-Object System.Collections.ArrayList
  $title = ''; $uploader = ''
  foreach ($line in ($out -split "`r?`n")) {
    $f = $line -split '~\|~'
    if ($f[0] -eq 'P' -and $f.Count -ge 3) { $title = $f[1]; $uploader = $f[2]; continue }
    if ($f[0] -ne 'E' -or $f.Count -lt 6) { continue }
    $id = $f[1]; $u = $f[3]
    if ($u -notmatch '^https?://') {
      if ($id -match '^[A-Za-z0-9_-]{11}$') { $u = "https://www.youtube.com/watch?v=$id" } else { continue }
    }
    $dur = 0.0; [double]::TryParse($f[2], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$dur) | Out-Null
    $t = ($f[5..($f.Count - 1)] -join ' ')
    if ($title -eq '' -and $t -eq 'NA') { $t = $id }
    [void]$entries.Add(@{ url = $u; id = $id; duration = [int]$dur; uploader = $(if ($f[4] -eq 'NA') { '' } else { $f[4] }); title = $(if ($t -and $t -ne 'NA') { $t } else { $id }) })
  }
  $isList = $title -ne ''
  if ($title -eq 'NA') { $title = '' }
  if ($uploader -eq 'NA') { $uploader = '' }
  return @{ title = $title; uploader = $uploader; playlist = $isList; entries = @($entries.ToArray()) }
}

function QueryParams($req) {
  $q = @{}
  $raw = $req.Url.Query.TrimStart('?')
  foreach ($pair in $raw.Split('&')) {
    if (-not $pair) { continue }
    $kv = $pair.Split('=', 2)
    $k = [Uri]::UnescapeDataString($kv[0].Replace('+', ' '))
    $v = if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
    $q[$k] = $v
  }
  return $q
}

function Handle($ctx) {
  $req = $ctx.Request; $res = $ctx.Response
  $res.AddHeader('Access-Control-Allow-Origin', '*')
  $res.AddHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  $res.AddHeader('Access-Control-Allow-Headers', 'Content-Type')
  $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
  $res.AddHeader('Cache-Control', 'no-store')
  if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; $res.Close(); return }
  $path = $req.Url.AbsolutePath
  $q = QueryParams $req

  if ($path -eq '/api/dl/ping') {
    SendJson $ctx @{ ok = $true; setup = 'ready'; ytdlp = $true; ffmpeg = (Test-Path $FFmpeg); version = $YtVersion; cookies = $false; local = $true; helper = $true }
    return
  }
  if ($path -eq '/api/dl/expand') {
    $url = "$($q['url'])".Trim()
    if ($url -notmatch '^https?://\S+$') { SendJson $ctx @{ error = 'That does not look like a link' } 400; return }
    $max = 300; $mx = 0
    if ([int]::TryParse("$($q['max'])", [ref]$mx)) { $max = $mx }
    $max = [Math]::Max(1, [Math]::Min(1000, $max))
    Say "Reading $url"
    try { SendJson $ctx (Expand $url $max) }
    catch { SendJson $ctx @{ error = $_.Exception.Message } 500 }
    return
  }
  if ($path -eq '/api/dl/start') {
    $url = "$($q['url'])".Trim()
    if ($url -notmatch '^https?://\S+$') { SendJson $ctx @{ error = 'That does not look like a link' } 400; return }
    $kind = "$($q['kind'])"; if (@('audio', 'video', 'mute') -notcontains $kind) { $kind = 'video' }
    $format = "$($q['format'])"; if (@('mp3', 'm4a', 'opus', 'wav', 'flac') -notcontains $format) { $format = 'mp3' }
    $quality = "$($q['quality'])" -replace '[^0-9a-zA-Z]', ''
    $script:seq++
    $id = 'h' + $script:seq + [Guid]::NewGuid().ToString('N').Substring(0, 6)
    $dir = Join-Path $Jobs $id
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $job = @{ id = $id; dir = $dir; attempt = 0; state = 'queued'; pct = 0; speed = ''; eta = ''; title = ''; file = $null; error = $null; proc = $null
              opts = @{ url = $url; kind = $kind; format = $format; quality = $quality } }
    $jobs[$id] = $job
    Say "Downloading $url"
    try { StartAttempt $job } catch { $job.state = 'error'; $job.error = $_.Exception.Message }
    SendJson $ctx @{ id = $id }
    return
  }
  if ($path -match '^/api/dl/progress/(.+)$') {
    $job = $jobs[$Matches[1]]
    if (-not $job) { SendJson $ctx @{ error = 'Unknown job' } 404; return }
    try { Refresh $job } catch { $job.state = 'error'; $job.error = $_.Exception.Message }
    $fn = $null; if ($job.file) { $fn = [IO.Path]::GetFileName($job.file) }
    if ($job.state -eq 'done') { Say ("Done: " + $fn) 'Green' }
    if ($job.state -eq 'error') { Say ("Failed: " + $job.error) 'Red' }
    SendJson $ctx @{ state = $job.state; pct = $job.pct; speed = $job.speed; eta = $job.eta; title = $job.title; error = $job.error; filename = $fn }
    return
  }
  if ($path -match '^/api/dl/file/(.+)$') {
    $job = $jobs[$Matches[1]]
    if (-not $job -or -not $job.file) { Send $ctx 404 'Not ready' 'text/plain'; return }
    $name = [IO.Path]::GetFileName($job.file)
    $ascii = ($name -replace '[^\x20-\x7E]', '_') -replace '"', "'"
    $res.AddHeader('Content-Disposition', "attachment; filename=`"$ascii`"; filename*=UTF-8''" + [Uri]::EscapeDataString($name))
    $res.AddHeader('Access-Control-Expose-Headers', 'Content-Disposition')
    $res.ContentType = if ($name -match '\.mp3$') { 'audio/mpeg' } elseif ($name -match '\.mp4$') { 'video/mp4' } else { 'application/octet-stream' }
    $fs = [IO.File]::OpenRead($job.file)
    try { $res.ContentLength64 = $fs.Length; $fs.CopyTo($res.OutputStream) } finally { $fs.Close(); $res.OutputStream.Close() }
    DropJob $job
    return
  }
  if ($path -match '^/api/dl/cancel/(.+)$') {
    $job = $jobs[$Matches[1]]
    if ($job) { DropJob $job }
    SendJson $ctx @{ ok = $true }
    return
  }
  if ($path -eq '/' -or $path -eq '/index.html') {
    Send $ctx 200 '<!doctype html><meta charset="utf-8"><title>AIOE Downloader helper</title><body style="font-family:sans-serif;background:#111;color:#ddd;padding:40px"><h2>AIOE Downloader helper is running</h2><p>Go back to the All-in-one EDITOR site and download from there - it finds this helper by itself. Keep the helper window open.</p>' 'text/html; charset=utf-8'
    return
  }
  SendJson $ctx @{ error = 'Not found' } 404
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch {
  Say "Could not open port $Port : $($_.Exception.Message)" 'Red'
  Say 'Is another program using it? Close it and run the helper again.' 'Red'
  return
}

Write-Host ''
Say "READY - helper running on http://localhost:$Port  (yt-dlp $YtVersion)" 'Green'
Say 'Go back to the All-in-one EDITOR site and download. KEEP THIS WINDOW OPEN.' 'Green'
Say 'If your browser asks to allow access to your local network / devices, click Allow.' 'Yellow'
Say 'To stop: close this window.'
Write-Host ''

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try { Handle $ctx }
    catch {
      Say ('Request error: ' + $_.Exception.Message) 'DarkYellow'
      try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
    }
  }
} finally {
  foreach ($j in @($jobs.Values)) { KillTree $j.proc }
  $listener.Stop()
}
