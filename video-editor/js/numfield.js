// Unreal-style number field (Details panel "spin box").
//   numField({ value, min, max, step, softMin, softMax, hardMin, hardMax, unit, decimals, onInput, onChange, title }) -> HTMLElement
// * One rounded box with the value text and a faint accent bar showing where the value sits in [softMin..softMax]
//   (falls back to [min..max]; no bar when the range is open).
// * Drag horizontally anywhere on it to scrub (pointer lock when available; Shift = fine ×0.1, Ctrl = coarse ×10).
//   Dragging moves within the slider range but never snaps a value that is already beyond it back inside.
// * Click without dragging (or Enter / F2 / a digit while focused) -> text input. Typed values are NOT capped by min/max
//   (only by hardMin/hardMax). Accepts math: "2*3", "(1+2)/4"; a leading + * / is relative ("+10" adds 10, "*2" doubles),
//   "-=5" subtracts. Enter / blur commits, Esc cancels. Arrow keys / wheel while focused step the value.
// Element extras: .setValue(v), .getValue(), .setDisabled(b), .scrubFrom(el) (make another element, e.g. a label, scrub it).

const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = x => typeof x === 'number' && isFinite(x);

function evalExpr(str, cur) {
  let s = String(str).trim().replace(/,/g, '.').replace(/[^\d.+\-*/()%^eE\s=]/g, '');
  if (!s) return NaN;
  let rel = null;
  const m = /^([+\-*/])=(.*)$/.exec(s) || /^([+*/])(?![+*/])(.*)$/.exec(s);
  if (m) { rel = m[1]; s = m[2]; }
  if (/[^\d.+\-*/()%^eE\s]/.test(s)) return NaN;
  let v;
  try { v = Function('"use strict";return (' + s.replace(/\^/g, '**') + ')')(); } catch { return NaN; }
  if (!fin(v)) return NaN;
  if (rel === '+') return cur + v;
  if (rel === '-') return cur - v;
  if (rel === '*') return cur * v;
  if (rel === '/') return v === 0 ? NaN : cur / v;
  return v;
}

export function numField({ value = 0, min = -Infinity, max = Infinity, step = 1, softMin, softMax, hardMin = -Infinity, hardMax = Infinity,
  unit = '', decimals, onInput, onChange, title } = {}) {
  const lo = fin(softMin) ? softMin : min, hi = fin(softMax) ? softMax : max;
  const ranged = fin(lo) && fin(hi) && hi > lo;
  step = +step || 0.01;
  const dec = decimals ?? Math.min(3, Math.max(0, (String(step).split('.')[1] || '').length));
  let v = +value || 0, editing = null, dragging = false, disabled = false;

  const box = document.createElement('div');
  box.className = 'nf';
  box.tabIndex = 0;
  box.setAttribute('role', 'spinbutton');
  box.title = title || 'Drag to change · Shift = fine · Ctrl = coarse · click to type (math ok, e.g. *2 or +10)';
  box.innerHTML = '<div class="nf-bar"></div><span class="nf-val"></span>';
  const bar = box.firstChild, txt = box.lastChild;
  if (ranged) { box.setAttribute('aria-valuemin', lo); box.setAttribute('aria-valuemax', hi); } else bar.remove();

  const fmt = x => { const r = (+x).toFixed(dec); return r === '-' + (0).toFixed(dec) ? (0).toFixed(dec) : r; };
  const tidy = x => +(+x).toFixed(Math.max(dec, 4) + 2);
  function render() {
    txt.innerHTML = fmt(v) + (unit ? `<i>${unit}</i>` : '');
    box.setAttribute('aria-valuenow', v);
    box.setAttribute('aria-valuetext', fmt(v) + unit);
    if (ranged) {
      const p = clampN((v - lo) / (hi - lo), 0, 1);
      const z = lo < 0 && hi > 0 ? (0 - lo) / (hi - lo) : 0;
      bar.style.left = (Math.min(p, z) * 100) + '%';
      bar.style.width = (Math.abs(p - z) * 100) + '%';
      box.classList.toggle('nf-out', v < lo || v > hi);
    }
  }
  const hard = x => clampN(x, hardMin, hardMax);
  const emit = (x, final) => {
    x = tidy(hard(x));
    if (x === v && !final) return;
    v = x; render();
    onInput?.(v);
    if (final) onChange?.(v);
  };

  // ---------- drag to scrub ----------
  function startScrub(e, el) {
    if (e.button !== 0 || disabled || editing) return;
    e.preventDefault();
    box.focus({ preventScroll: true });
    const v0 = v, x0 = e.clientX; let acc = 0, lastX = e.clientX, moved = false, locked = false;
    const width = Math.max(120, box.clientWidth || 160);
    const perPx = ranged ? (hi - lo) / width : step;
    const bLo = ranged ? Math.min(lo, v0) : -Infinity, bHi = ranged ? Math.max(hi, v0) : Infinity;
    try { el.setPointerCapture(e.pointerId); } catch {}
    const mv = ev => {
      const dx = document.pointerLockElement === el ? ev.movementX : ev.clientX - lastX;
      lastX = ev.clientX;
      if (!moved) {
        if (Math.abs(ev.clientX - x0) < 3 && !locked) return;
        moved = true; dragging = true; box.classList.add('nf-drag');
        acc = ev.clientX - x0;
        try { const r = el.requestPointerLock?.(); r?.catch?.(() => {}); locked = true; } catch {}
      } else acc += dx * (ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1);
      const st = step * (ev.shiftKey ? 0.1 : 1);
      let x = clampN(v0 + acc * perPx, bLo, bHi);
      x = Math.round(x / st) * st;
      emit(clampN(x, bLo, bHi), false);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (document.pointerLockElement === el) document.exitPointerLock?.();
      box.classList.remove('nf-drag'); dragging = false;
      if (moved) onChange?.(v);
      else if (el === box) beginEdit();
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  box.addEventListener('pointerdown', e => startScrub(e, box));

  // ---------- click to type ----------
  function beginEdit(initial) {
    if (editing || disabled) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'nf-input'; inp.spellcheck = false; inp.setAttribute('inputmode', 'decimal');
    inp.value = initial ?? String(tidy(+fmt(v)) === tidy(v) ? fmt(v) : tidy(v));
    editing = { inp, start: v };
    box.classList.add('nf-editing');
    box.appendChild(inp);
    inp.focus(); if (initial == null) inp.select();
    let done = false;
    const finish = commit => {
      if (done) return; done = true;
      const val = commit ? evalExpr(inp.value, editing.start) : NaN;
      const restore = editing.start;
      editing = null; box.classList.remove('nf-editing'); inp.remove();
      if (commit && fin(val)) emit(val, true);
      else if (v !== restore) { v = restore; render(); onInput?.(v); }
      box.focus({ preventScroll: true });
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab') finish(true);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cur = evalExpr(inp.value, editing.start);
        const k = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1);
        emit((fin(cur) ? cur : v) + k, false);
        inp.value = String(tidy(v)); inp.select();
      }
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('pointerdown', e => e.stopPropagation());
  }

  box.addEventListener('keydown', e => {
    if (editing || disabled) return;
    const k = e.key;
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); e.stopPropagation(); beginEdit(); }
    else if (/^[\d.+\-*/]$/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); beginEdit(k); }
    else if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'PageUp' || k === 'PageDown') {
      e.preventDefault(); e.stopPropagation();
      const dir = k === 'ArrowUp' || k === 'ArrowRight' || k === 'PageUp' ? 1 : -1;
      const mul = k.startsWith('Page') ? 10 : e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
      emit(v + dir * step * mul, true);
    } else if (k === 'Home' && fin(lo)) { e.preventDefault(); e.stopPropagation(); emit(lo, true); }
    else if (k === 'End' && fin(hi)) { e.preventDefault(); e.stopPropagation(); emit(hi, true); }
  });
  box.addEventListener('wheel', e => {
    if (disabled || (document.activeElement !== box && !(editing && document.activeElement === editing.inp))) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    emit(v + dir * step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1), false);
    if (editing) { editing.inp.value = String(tidy(v)); editing.start = v; }
  }, { passive: false });

  box.setValue = x => { if (editing || dragging) return; x = +x; if (!fin(x)) x = 0; if (x !== v || !txt.firstChild) { v = x; render(); } };
  box.getValue = () => v;
  box.setDisabled = b => { disabled = !!b; box.classList.toggle('nf-disabled', disabled); box.tabIndex = disabled ? -1 : 0; box.setAttribute('aria-disabled', disabled); };
  box.scrubFrom = el => { el.addEventListener('pointerdown', e => startScrub(e, el)); el.style.touchAction = 'none'; };
  render();
  return box;
}
