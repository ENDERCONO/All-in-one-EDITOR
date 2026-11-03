// Inline SVG icons (24×24, stroke). Any element with data-icon="name" gets the icon
// prepended by applyIcons(root).
const P = {
  media: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="m10 12 5 3-5 3z"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  titles: '<path d="M4 7V4h16v3"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  transitions: '<rect x="2" y="5" width="9" height="14" rx="1.5"/><rect x="13" y="5" width="9" height="14" rx="1.5"/><path d="m9 12 6 0"/><path d="m13 10 2 2-2 2"/>',
  effects: '<path d="m12 3 1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z"/>',
  filters: '<circle cx="9" cy="9" r="6"/><circle cx="15" cy="9" r="6"/><circle cx="12" cy="15" r="6"/>',
  elements: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M3 21l4-7 4 7z"/><rect x="13" y="13" width="8" height="8" rx="4"/>',
  materials: '<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6c5 0 5 6 9 6M7.5 18c5 0 5-6 9-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
  split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  select: '<path d="m4 3 7 17 2.5-7.5L21 10z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  speed: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M10 2h4"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M12 4v16"/>',
  marker: '<path d="M6 3h12v14l-6 4-6-4z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>',
  detach: '<path d="M3 12h4l2-5 3 10 2-5h7"/><path d="M15 3l6 6M21 3l-6 6"/>',
  snap: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>',
  zoomIn: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
  zoomOut: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  fit: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
  prevFrame: '<path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/>',
  nextFrame: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7z"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  addTrack: '<rect x="3" y="5" width="13" height="5" rx="1"/><rect x="3" y="14" width="13" height="5" rx="1"/><path d="M20 9v6M17 12h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  freeze: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9z"/>',
  export: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v5h16v-5"/>',
  save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h8"/><rect x="8" y="13" width="8" height="6"/>',
  color: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  chroma: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17c0-4 8-4 8-8" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="3"/>',
  ripple: '<path d="M3 6h7v12H3zM14 6h7v12h-7"/><path d="M10 12h4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
};

export function icon(name, size = 16) {
  const p = P[name] || P.plus;
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = '1';
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +(el.dataset.iconSize || 16)));
  });
}
