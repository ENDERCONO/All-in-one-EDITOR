/**
 * setup-lovejs.js — runs automatically via "postinstall" in package.json
 *
 * Downloads compiled love.js + love.wasm WebAssembly binaries from known
 * online sources so Balatro can run in the browser without any manual setup.
 * Always exits 0 (non-fatal) so a failed download never breaks npm install.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const DEST_DIR  = path.join(__dirname, '..', 'claude-game', 'Balatro', 'love.js');
const JS_DEST   = path.join(DEST_DIR, 'love.js');
const WASM_DEST = path.join(DEST_DIR, 'love.wasm');

// Minimum size for a real compiled file (100 KB)
const MIN_BYTES = 100_000;
const isReal = fp => { try { return fs.statSync(fp).size >= MIN_BYTES; } catch { return false; } };

if (isReal(JS_DEST) && isReal(WASM_DEST)) {
  console.log('[love.js setup] Already installed — skipping.');
  process.exit(0);
}

fs.mkdirSync(DEST_DIR, { recursive: true });

// Candidate sources — tried in order, first valid pair wins.
// Prefer compat (single-threaded) build — no SharedArrayBuffer/COOP/COEP required.
const SOURCES = [
  {
    label: 'Davidobot/love.js — src/compat (single-threaded)',
    js:   'https://raw.githubusercontent.com/Davidobot/love.js/master/src/compat/love.js',
    wasm: 'https://raw.githubusercontent.com/Davidobot/love.js/master/src/compat/love.wasm',
  },
  {
    label: '2dengine/love.js — 11.5',
    js:   'https://raw.githubusercontent.com/2dengine/love.js/main/11.5/love.js',
    wasm: 'https://raw.githubusercontent.com/2dengine/love.js/main/11.5/love.wasm',
  },
  {
    label: 'Davidobot/love.js — src/release',
    js:   'https://raw.githubusercontent.com/Davidobot/love.js/master/src/release/love.js',
    wasm: 'https://raw.githubusercontent.com/Davidobot/love.js/master/src/release/love.wasm',
  },
  {
    label: 'GitHub releases API — Davidobot/love.js',
    js:   '__releases_api__',
    wasm: '__releases_api__',
    repo: 'Davidobot/love.js',
  },
];

(async () => {
  for (const src of SOURCES) {
    console.log(`[love.js setup] Trying: ${src.label}`);
    try {
      if (src.js === '__releases_api__') {
        const releases = await fetchJSON(`https://api.github.com/repos/${src.repo}/releases`);
        let found = false;
        for (const rel of releases) {
          const jsA   = (rel.assets||[]).find(a => /love\.js$/i.test(a.name));
          const wasmA = (rel.assets||[]).find(a => /love\.wasm$/i.test(a.name));
          if (jsA && wasmA) {
            const jsSize   = await downloadFile(jsA.browser_download_url,   JS_DEST);
            const wasmSize = await downloadFile(wasmA.browser_download_url, WASM_DEST);
            if (jsSize >= MIN_BYTES && wasmSize >= MIN_BYTES) {
              console.log(`[love.js setup] ✓ Installed from release ${rel.tag_name} — JS ${kb(jsSize)} KB, WASM ${kb(wasmSize)} KB`);
              found = true; break;
            }
          }
        }
        if (found) process.exit(0);
      } else {
        const jsSize   = await downloadFile(src.js,   JS_DEST);
        const wasmSize = await downloadFile(src.wasm, WASM_DEST);
        if (jsSize >= MIN_BYTES && wasmSize >= MIN_BYTES) {
          console.log(`[love.js setup] ✓ Installed — JS ${kb(jsSize)} KB, WASM ${kb(wasmSize)} KB`);
          process.exit(0);
        }
        console.log(`[love.js setup]   Files too small (${jsSize}B / ${wasmSize}B), skipping.`);
      }
    } catch (e) {
      console.log(`[love.js setup]   Failed: ${e.message}`);
    }
    // Clean up partial downloads before next attempt
    try { fs.unlinkSync(JS_DEST);   } catch {}
    try { fs.unlinkSync(WASM_DEST); } catch {}
  }

  console.log('[love.js setup] No compiled binaries found. Browser play requires manual setup.');
  process.exit(0); // non-fatal
})();

/* ── helpers ─────────────────────────────────────────────────────────── */

function kb(n) { return Math.round(n / 1024); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'lovejs-setup', Accept: 'application/vnd.github.v3+json' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('Too many redirects')); return; }
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'lovejs-setup' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        resolve(downloadFile(res.headers.location, dest, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const f = fs.createWriteStream(dest);
      let size = 0;
      res.on('data', c => size += c.length);
      res.pipe(f);
      f.on('finish', () => resolve(size));
      f.on('error', reject);
    }).on('error', reject);
  });
}
