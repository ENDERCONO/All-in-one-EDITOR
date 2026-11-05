/**
 * fetch-tools.js — runs at "npm install" (postinstall) so the downloader's
 * yt-dlp and ffmpeg are already in bin/ when the server starts.
 *
 * Without this, a free Render instance re-downloads both (~200 MB) every time
 * it wakes from sleep, which is most of the "waking up" delay.
 * Always exits 0: if a download fails the server still fetches them on first use.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin');
const IS_WIN = process.platform === 'win32';
// same asset names as server.js (YTDLP_ASSET)
const ytdlpAsset = IS_WIN ? 'yt-dlp.exe'
  : process.platform === 'darwin' ? 'yt-dlp_macos'
  : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
const ytdlpPath = path.join(BIN, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

function get(url, dest, redirects = 8) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'aio-editor' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume(); return resolve(get(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(BIN, { recursive: true });
  if (!fs.existsSync(ytdlpPath)) {
    try {
      const tmp = ytdlpPath + '.tmp';
      await get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + ytdlpAsset, tmp);
      if (!IS_WIN) fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, ytdlpPath);
      console.log('[fetch-tools] yt-dlp ready');
    } catch (e) { console.warn('[fetch-tools] yt-dlp skipped:', e.message); }
  }
  // ffmpeg: Linux/macOS builds come as a tar.xz (same source as the server)
  const ffName = IS_WIN ? 'ffmpeg.exe' : 'ffmpeg';
  if (!fs.existsSync(path.join(BIN, ffName)) && !IS_WIN) {
    const tmp = path.join(BIN, 'ffmpeg-build');
    try {
      fs.mkdirSync(tmp, { recursive: true });
      const arch = process.arch === 'arm64' ? 'linuxarm64' : 'linux64';
      const tar = path.join(tmp, 'ffmpeg.tar.xz');
      await get(`https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-${arch}-gpl.tar.xz`, tar);
      execFileSync('tar', ['-xJf', tar, '-C', tmp]);
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
      for (const f of walk(tmp).filter(f => /\/(ffmpeg|ffprobe)$/.test(f))) {
        const d = path.join(BIN, path.basename(f)); fs.copyFileSync(f, d); fs.chmodSync(d, 0o755);
      }
      console.log('[fetch-tools] ffmpeg ready');
    } catch (e) { console.warn('[fetch-tools] ffmpeg skipped:', e.message); }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
})().catch(() => {}).finally(() => process.exit(0));
