// Bridges to the rest of the All-in-one site: the downloader (Import from URL),
// the converter (auto-convert files the browser can't play), and small helpers.
// The site's server is found the same way the main page does it: the hosting
// page's resolveApiBase() when embedded, else same origin / localhost:3000 /
// the default online server.

const DEFAULT_ONLINE_API = 'https://all-in-one-editor.onrender.com';
let cachedBase;

async function ping(base, ms) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(base + '/api/dl/ping', { signal: ctrl.signal, cache: 'no-store' }); const j = await r.json(); if (j?.ok) return base; }
  catch (e) { /* not there */ } finally { clearTimeout(t); }
  throw new Error('no server');
}

export async function apiBase(onStatus) {
  if (cachedBase !== undefined && cachedBase !== null) return cachedBase;
  try { if (window.parent !== window && typeof window.parent.resolveApiBase === 'function') { cachedBase = await window.parent.resolveApiBase(onStatus); return cachedBase; } } catch (e) { /* cross-origin */ }
  const local = [];
  if (/^https?:$/.test(location.protocol)) local.push(location.origin);
  for (const c of ['http://localhost:3000', 'http://127.0.0.1:3000']) if (location.origin !== c) local.push(c);
  try { cachedBase = await Promise.any(local.map(b => ping(b, 1500))); return cachedBase; } catch (e) { /* none local */ }
  let saved = ''; try { saved = (localStorage.getItem('apiBase') || '').replace(/\/+$/, ''); } catch (e) { /* ignore */ }
  for (const b of [...new Set([saved, DEFAULT_ONLINE_API].filter(Boolean))]) {
    const slow = setTimeout(() => onStatus?.('Waking up the online server (free hosting sleeps) — up to a minute…'), 2500);
    try { cachedBase = await ping(b, 90000); return cachedBase; } catch (e) { /* try next */ } finally { clearTimeout(slow); }
  }
  cachedBase = null; return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- Convert files the browser can't decode ----------------
// Tries the site's server converter (native ffmpeg), then ffmpeg.wasm from the hosting page.
export async function convertForImport(file, kind, onStatus) {
  const target = kind === 'audio' ? 'mp3' : kind === 'image' ? 'png' : 'mp4';
  const outName = (file.name || 'media').replace(/\.[^.]+$/, '') + '.' + target;
  const base = await apiBase(onStatus).catch(() => null);
  if (base !== null && base !== undefined) {
    try {
      onStatus?.(`Converting ${file.name} → ${target.toUpperCase()} on the server…`);
      const r = await fetch(`${base}/api/convert/start?name=${encodeURIComponent(file.name || 'input')}&target=${target}`, { method: 'POST', body: file });
      const { id, error } = await r.json(); if (!id) throw new Error(error || 'convert failed');
      for (;;) {
        await sleep(700);
        const p = await (await fetch(`${base}/api/convert/progress/${id}`, { cache: 'no-store' })).json();
        if (p.state === 'error') throw new Error(p.error || 'convert failed');
        if (p.state === 'done') break;
        onStatus?.(`Converting ${file.name}… ${p.pct || 0}%`);
      }
      const blob = await (await fetch(`${base}/api/convert/file/${id}`)).blob();
      return new File([blob], outName, { type: kind === 'audio' ? 'audio/mpeg' : kind === 'image' ? 'image/png' : 'video/mp4' });
    } catch (e) { console.warn('server convert failed, trying ffmpeg.wasm', e); }
  }
  let host = null;
  try { if (window.parent !== window && typeof window.parent.loadSharedFFmpeg === 'function') host = window.parent; } catch (e) { /* cross-origin */ }
  if (!host) throw new Error('No converter available (open the editor from the main site, or run the server)');
  onStatus?.(`Converting ${file.name} in the browser (ffmpeg.wasm)…`);
  const ff = await host.loadSharedFFmpeg();
  const inName = 'in_' + Date.now() + '_' + (file.name || 'media').replace(/[^\w.-]/g, '_');
  await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  const args = kind === 'audio' ? ['-i', inName, '-vn', '-b:a', '192k', outName]
    : kind === 'image' ? ['-i', inName, '-frames:v', '1', outName]
    : ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', outName];
  await ff.exec(args);
  const data = await ff.readFile(outName);
  try { await ff.deleteFile(inName); await ff.deleteFile(outName); } catch (e) { /* ignore */ }
  return new File([data], outName, { type: kind === 'audio' ? 'audio/mpeg' : kind === 'image' ? 'image/png' : 'video/mp4' });
}

// ---------------- Import from URL (the site's downloader) ----------------
export function openImportFromUrl({ importFiles, toast }) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" style="width:560px">
    <div class="modal-head"><span>Import from URL</span><button class="icon-btn" data-x>✕</button></div>
    <div class="modal-body"><div class="form-grid">
      <label>Links</label><textarea id="iuLinks" rows="4" placeholder="YouTube, TikTok, Instagram, X, direct .mp4 / .mp3 / .png links… one per line" spellcheck="false" style="width:100%;resize:vertical"></textarea>
      <label>Get</label><select id="iuKind"><option value="video">Video (with sound)</option><option value="audio">Audio only (MP3)</option><option value="mute">Video only (no sound)</option></select>
      <label>Quality</label><select id="iuQ"><option value="">Best</option><option value="1080">1080p</option><option value="720" selected>720p</option><option value="480">480p</option></select>
      <label>Then</label><label style="display:flex;gap:6px;align-items:center;color:var(--text)"><input type="checkbox" id="iuAdd" checked> add to the timeline at the playhead</label>
    </div><div id="iuStatus" style="margin-top:12px;color:var(--text-dim);min-height:36px;white-space:pre-line"></div>
    <div class="dim" style="font-size:11.5px">Uses the same downloader as the site's Converter tab (the local server, or the online one). Direct media links download straight into your browser.</div></div>
    <div class="modal-foot"><button class="btn" data-x>Close</button><button class="btn primary" id="iuGo">Import</button></div></div>`;
  document.getElementById('modalRoot').appendChild(back);
  const $ = s => back.querySelector(s);
  let cancelled = false;
  back.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { cancelled = true; back.remove(); });
  back.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { cancelled = true; back.remove(); } });
  setTimeout(() => $('#iuLinks').focus(), 30);
  const say = m => { $('#iuStatus').textContent = m; };
  $('#iuGo').onclick = async () => {
    const links = $('#iuLinks').value.split(/\s+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    if (!links.length) return say('Paste at least one http(s) link.');
    $('#iuGo').disabled = true;
    const kind = $('#iuKind').value, quality = $('#iuQ').value, add = $('#iuAdd').checked;
    let done = 0;
    for (const url of links) {
      if (cancelled) return;
      try {
        let file = null;
        if (/\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|png|jpe?g|gif|webp)(\?|#|$)/i.test(url)) {
          say(`Downloading ${url}…`);
          try { const r = await fetch(url); if (r.ok) { const b = await r.blob(); file = new File([b], decodeURIComponent(url.split('/').pop().split(/[?#]/)[0]) || 'download', { type: b.type }); } } catch (e) { /* CORS → use the server */ }
        }
        if (!file) {
          const base = await apiBase(say);
          if (base === null || base === undefined) throw new Error('No downloader server reachable (run the site\'s server, or check your connection)');
          const st = await (await fetch(`${base}/api/dl/start?url=${encodeURIComponent(url)}&kind=${kind}&format=mp3&quality=${quality}`)).json();
          if (!st.id) throw new Error(st.error || 'Download failed to start');
          let title = '';
          for (;;) {
            if (cancelled) return;
            await sleep(800);
            const p = await (await fetch(`${base}/api/dl/progress/${st.id}`, { cache: 'no-store' })).json();
            title = p.title || title;
            if (p.state === 'error') throw new Error(p.error || 'Download failed');
            if (p.state === 'setup') say(`First run: the server is fetching its downloader (${p.setupPhase || ''} ${p.setupPct || 0}%)…`);
            else say(`${title || url}\n${p.state} ${p.pct || 0}% ${p.speed || ''} ${p.eta ? '· ETA ' + p.eta : ''}`);
            if (p.state === 'done' && p.filename) {
              const b = await (await fetch(`${base}/api/dl/file/${st.id}`)).blob();
              file = new File([b], p.filename, { type: b.type || (kind === 'audio' ? 'audio/mpeg' : 'video/mp4') });
              break;
            }
          }
        }
        say(`Importing ${file.name}…`);
        await importFiles([file], add);
        done++;
      } catch (e) { say(`✕ ${url}\n${e.message}`); toast?.('Import from URL failed: ' + e.message); await sleep(1500); }
    }
    $('#iuGo').disabled = false;
    if (done) { say(`Imported ${done} of ${links.length}.`); toast?.(`Imported ${done} file(s) from URL`); }
  };
}

// ---------------- File names (the site's File Names tool) ----------------
export async function copyFileNames(names, toast) {
  const text = names.join('\n');
  try { await navigator.clipboard.writeText(text); toast?.(`Copied ${names.length} file name(s)`); }
  catch (e) { prompt('Copy the file names:', text); }
}
