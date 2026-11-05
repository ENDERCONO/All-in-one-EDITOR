// Stickers for the library's Stickers tab:
//  * built-in stickers (SVG drawn here, no network) and an emoji set, turned into PNG files
//  * GIPHY search (GIFs + transparent stickers) with the user's own free API key,
//    stored only in this browser (localStorage). Nothing is sent anywhere else.

const W = 512;

// ---- built-in SVG stickers -------------------------------------------------------------
const svg = (body, vb = '0 0 512 512') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${W}" height="${W * (+vb.split(' ')[3] / +vb.split(' ')[2])}">${body}</svg>`;
const FONT = `font-family="Arial Black, Impact, Arial, sans-serif" font-weight="900"`;

export const BUILTIN_STICKERS = [
  { id: 'subscribe', label: 'Subscribe', cat: 'Social', svg: () => svg(`<rect x="8" y="8" width="496" height="144" rx="30" fill="#e00"/><text x="256" y="104" text-anchor="middle" ${FONT} font-size="74" fill="#fff">SUBSCRIBE</text>`, '0 0 512 160') },
  { id: 'subscribed', label: 'Subscribed', cat: 'Social', svg: () => svg(`<rect x="8" y="8" width="496" height="144" rx="30" fill="#606060"/><text x="256" y="102" text-anchor="middle" ${FONT} font-size="64" fill="#fff">SUBSCRIBED ✓</text>`, '0 0 512 160') },
  { id: 'like', label: 'Like', cat: 'Social', svg: () => svg(`<rect x="8" y="8" width="496" height="160" rx="40" fill="#ff2d55"/><path d="M78 88c0-26 33-38 50-14 17-24 50-12 50 14 0 30-50 54-50 54s-50-24-50-54z" fill="#fff"/><text x="330" y="116" text-anchor="middle" ${FONT} font-size="80" fill="#fff">LIKE</text>`, '0 0 512 176') },
  { id: 'bell', label: 'Bell', cat: 'Social', svg: () => svg(`<circle cx="256" cy="256" r="240" fill="#ffcc00"/><path d="M256 110c-60 0-100 44-100 104v70l-36 50h272l-36-50v-70c0-60-40-104-100-104z" fill="#222"/><circle cx="256" cy="380" r="34" fill="#222"/>`) },
  { id: 'thumbs', label: 'Thumbs Up', cat: 'Social', svg: () => svg(`<circle cx="256" cy="256" r="240" fill="#2a6df4"/><path d="M150 230h56v150h-56zM226 380V236l70-110c22 0 34 16 30 38l-14 62h86c22 0 36 20 30 40l-34 96c-6 14-18 18-30 18z" fill="#fff"/>`) },
  { id: 'live', label: 'LIVE', cat: 'Labels', svg: () => svg(`<rect x="8" y="8" width="300" height="128" rx="22" fill="#e3002b"/><circle cx="66" cy="72" r="24" fill="#fff"/><text x="196" y="100" text-anchor="middle" ${FONT} font-size="74" fill="#fff">LIVE</text>`, '0 0 316 144') },
  { id: 'new', label: 'NEW burst', cat: 'Labels', svg: () => { let pts = ''; for (let i = 0; i < 32; i++) { const r = i % 2 ? 190 : 240, a = i / 32 * Math.PI * 2; pts += `${256 + r * Math.cos(a)},${256 + r * Math.sin(a)} `; } return svg(`<polygon points="${pts}" fill="#ffe600" stroke="#111" stroke-width="10"/><text x="256" y="290" text-anchor="middle" ${FONT} font-size="120" fill="#e3002b">NEW</text>`); } },
  { id: 'breaking', label: 'Breaking News', cat: 'Labels', svg: () => svg(`<rect x="0" y="0" width="1024" height="160" fill="#c4001d"/><rect x="0" y="110" width="1024" height="50" fill="#111"/><text x="40" y="88" ${FONT} font-size="76" fill="#fff" font-style="italic">BREAKING NEWS</text>`, '0 0 1024 160') },
  { id: 'arrow_r', label: 'Arrow', cat: 'Arrows', svg: () => svg(`<path d="M40 200h300v-90l140 146-140 146v-90H40z" fill="#ff3b30" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>`) },
  { id: 'arrow_curve', label: 'Curved Arrow', cat: 'Arrows', svg: () => svg(`<path d="M70 420C90 220 220 120 400 130" fill="none" stroke="#ffe600" stroke-width="34" stroke-linecap="round"/><path d="M350 70l90 60-80 80" fill="none" stroke="#ffe600" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'circle', label: 'Highlight Circle', cat: 'Shapes', svg: () => svg(`<ellipse cx="256" cy="256" rx="226" ry="180" fill="none" stroke="#ff2d55" stroke-width="22" transform="rotate(-8 256 256)"/>`) },
  { id: 'underline', label: 'Swoosh Underline', cat: 'Shapes', svg: () => svg(`<path d="M20 110C200 40 380 40 500 80" fill="none" stroke="#ffe600" stroke-width="26" stroke-linecap="round"/>`, '0 0 520 140') },
  { id: 'speech', label: 'Speech Bubble', cat: 'Shapes', svg: () => svg(`<path d="M40 60h432a30 30 0 0 1 30 30v220a30 30 0 0 1-30 30H200l-90 90v-90H40a30 30 0 0 1-30-30V90a30 30 0 0 1 30-30z" fill="#fff" stroke="#111" stroke-width="12"/>`) },
  { id: 'thought', label: 'Thought Bubble', cat: 'Shapes', svg: () => svg(`<ellipse cx="270" cy="200" rx="220" ry="150" fill="#fff" stroke="#111" stroke-width="12"/><circle cx="120" cy="390" r="36" fill="#fff" stroke="#111" stroke-width="10"/><circle cx="70" cy="460" r="20" fill="#fff" stroke="#111" stroke-width="8"/>`) },
  { id: 'star', label: 'Star', cat: 'Shapes', svg: () => { let pts = ''; for (let i = 0; i < 10; i++) { const r = i % 2 ? 100 : 236, a = -Math.PI / 2 + i / 10 * Math.PI * 2; pts += `${256 + r * Math.cos(a)},${266 + r * Math.sin(a)} `; } return svg(`<polygon points="${pts}" fill="#ffcc00" stroke="#c78a00" stroke-width="12" stroke-linejoin="round"/>`); } },
  { id: 'heart', label: 'Heart', cat: 'Shapes', svg: () => svg(`<path d="M256 450C120 350 30 270 30 170 30 100 85 50 150 50c45 0 80 24 106 60 26-36 61-60 106-60 65 0 120 50 120 120 0 100-90 180-226 280z" fill="#ff2d55"/>`) },
  { id: 'check', label: 'Check', cat: 'Shapes', svg: () => svg(`<circle cx="256" cy="256" r="236" fill="#34c759"/><path d="M140 262l80 80 160-170" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 'cross', label: 'Cross', cat: 'Shapes', svg: () => svg(`<circle cx="256" cy="256" r="236" fill="#ff3b30"/><path d="M160 160l192 192M352 160L160 352" stroke="#fff" stroke-width="48" stroke-linecap="round"/>`) },
  { id: 'click', label: 'Click Here', cat: 'Labels', svg: () => svg(`<rect x="8" y="8" width="496" height="144" rx="72" fill="#18d5b7"/><text x="256" y="102" text-anchor="middle" ${FONT} font-size="70" fill="#fff">CLICK HERE</text>`, '0 0 512 160') },
  { id: 'thanks', label: 'Thanks for watching', cat: 'Labels', svg: () => svg(`<rect x="8" y="8" width="1008" height="184" rx="30" fill="#111" stroke="#ff2d9a" stroke-width="10"/><text x="512" y="124" text-anchor="middle" ${FONT} font-size="86" fill="#fff">THANKS FOR WATCHING</text>`, '0 0 1024 200') },
];

const EMOJI = ['😂', '🤣', '😭', '😍', '😎', '🤔', '😱', '😡', '🥺', '🤯', '💀', '👀', '🔥', '💯', '❤️', '👍', '👏', '🙏', '🎉', '✨', '⭐', '⚡', '💥', '💢', '❓', '❗', '✅', '❌', '🚨', '🎮', '🏆', '💰', '🍿', '👑', '🤡', '👻', '🎃', '🗿', '🫠', '😈'];
export const EMOJI_STICKERS = EMOJI.map((e, i) => ({ id: 'emoji' + i, label: e, cat: 'Emoji', emoji: e }));

export const STICKER_CATS = [...new Set([...BUILTIN_STICKERS, ...EMOJI_STICKERS].map(s => s.cat))];

// Inline preview (data URL) for the library grid
export function stickerThumb(s) {
  if (s.emoji) return null;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.svg());
}

// Sticker → transparent PNG File (rasterized so every browser and the exporter treat it the same)
export async function stickerFile(s) {
  const c = document.createElement('canvas');
  if (s.emoji) {
    c.width = c.height = W;
    const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${W * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.fillText(s.emoji, W / 2, W * 0.54);
  } else {
    const src = s.svg();
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('sticker failed to draw')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src); });
    c.width = img.naturalWidth || W; c.height = img.naturalHeight || W;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([blob], `Sticker ${s.emoji ? 'emoji' : s.label}.png`, { type: 'image/png' });
}

// ---- GIPHY ----------------------------------------------------------------------------
const KEY = 've.giphyKey';
export const giphyKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
export const setGiphyKey = k => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } };

// kind: 'gifs' | 'stickers'. Empty query = trending. Returns [{ id, title, thumb, full, w, h }]
export async function giphySearch(kind, q, { limit = 30 } = {}) {
  const key = giphyKey(); if (!key) throw Object.assign(new Error('No GIPHY key'), { code: 'nokey' });
  const base = `https://api.giphy.com/v1/${kind === 'stickers' ? 'stickers' : 'gifs'}/${q ? 'search' : 'trending'}`;
  const url = `${base}?api_key=${encodeURIComponent(key)}&limit=${limit}&rating=pg-13${q ? '&q=' + encodeURIComponent(q) : ''}`;
  const r = await fetch(url);
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('GIPHY rejected the API key'), { code: 'badkey' });
  if (!r.ok) throw new Error('GIPHY error ' + r.status);
  const j = await r.json();
  return (j.data || []).map(g => {
    const im = g.images || {};
    const thumb = im.fixed_width_small?.webp || im.fixed_width_small?.url || im.fixed_width?.webp || im.fixed_width?.url;
    const full = im.original?.webp || im.original?.url || im.downsized?.url;
    return { id: g.id, title: g.title || 'GIF', thumb, full, w: +im.original?.width || 0, h: +im.original?.height || 0 };
  }).filter(g => g.thumb && g.full);
}

export async function giphyFile(g) {
  const r = await fetch(g.full);
  if (!r.ok) throw new Error('Could not download that GIF (' + r.status + ')');
  const b = await r.blob();
  const ext = /webp/.test(b.type) ? 'webp' : 'gif';
  const name = (g.title || 'GIF').replace(/[\\/:*?"<>|]+/g, '').slice(0, 40).trim() || 'GIF';
  return new File([b], `${name}.${ext}`, { type: b.type || 'image/' + ext });
}
