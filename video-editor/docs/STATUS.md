# Video Editor — Status

Last updated by the build session that created the editor.

## Done

| Module | State | Notes |
|---|---|---|
| Shell UI (`index.html`, `css/editor.css`) | ✅ | Filmora layout, resizable splitters (double-click resets), **View → Theme**: Filmora / Unreal Engine |
| `state.js` | ✅ | JSON project, undo/redo (200 steps, slider drags coalesce), events |
| `ops.js` | ✅ | insert, split, delete / ripple, copy / cut / paste / duplicate, trim to playhead, detach audio, speed, freeze frame, group, markers, tracks |
| `sources.js` | ✅ | one `<video>` per clip, text → canvas, exact seeking for export |
| `media.js` | ✅ | import (picker / drop / **Ctrl+V**), filmstrips, library tabs (Media, Audio, Titles, Transitions, Effects, Filters, Elements, Materials) |
| `inspector.js` | ✅ | Video (transform, crop, compositing, chroma key with eyedropper, material + params, transitions), Titles, Audio (volume, balance, pitch, fades), Color, Speed, Effects |
| `timeline.js` | ✅ | Filmora scissor ball on the playhead (drag = scrub, click = split), drag across tracks with snapping, trim, blade, rubber band, context menu, fades, volume line, transitions, markers, zoom |
| `audio.js` | ✅ | Web Audio mix, WSOLA pitch shift in a Worker (independent of speed), offline mixdown, meter |
| `export.js` | ✅ | MP4 (H.264 + AAC/Opus), WebM (VP9 + Opus), MKV, WAV 16/24-bit, MP3; MOV / AVI / GIF via ffmpeg.wasm from the main site |
| `renderer.js` / `gizmo.js` | ✅ | WebGL2 compositor: 25 filters, 25 transitions, 12 blend modes, chroma key, materials; move / scale / rotate gizmo with snapping |
| `materials.js` | ✅ | Unreal-style node editor (≈55 nodes, templates, live preview) → GLSL; Scalar/Vector Parameters become inspector sliders |
| Project files | ✅ | `.aioproj` (JSON + embedded media), autosave to IndexedDB with restore prompt |
| Main site | ✅ | **Video Editor** tab (iframe, lazy loaded, full window) |
| Opened from disk | ✅ | `file://` loads `dist/editor.js` (build with `node video-editor/build.mjs`) |
| GIFs | ✅ | animated GIF / WebP clips decoded with ImageDecoder, looping |
| Voice & audio fx | ✅ | 19 voice filters + 13 presets + reverb / echo / crush / muffle / high-pass / bass / 8D, ported from Audio Tools |
| Image adjustments | ✅ | Image Editor set (hue, sat, exposure, contrast, sharpen, noise, invert, grayscale, color levels, auto hue match) + gamma, vibrance, levels, RGB, fade, clarity |
| QoL hotkeys | ✅ | see `SHORTCUTS.md` → Quality-of-life |
| Shared transitions | ✅ | a transition on a cut is one block centred on it (half over each clip, video + audio crossfade); resize symmetric, drag to another cut / edge, right-click, Ctrl+C / Ctrl+V, Delete |
| Adjustment layers | ✅ | clip type `adjustment`: color / filters / hue match / material apply to every track below; drop a filter on empty timeline space, Effects → Adjustment Layer, Ctrl+Alt+A |
| Timeline extras | ✅ | scissor ball drags in both directions, middle-mouse pan |
| Auto captions (local AI) | ✅* | `js/ai.js` + `js/ai-worker.js`: Whisper (tiny/base/small) via transformers.js 4.3.2 from jsDelivr, model from the Hugging Face hub, runs in the browser (WebGPU or WASM). Styles: Subtitle / TikTok / Clean / Word-by-word, .srt download. *Real model not testable in the build sandbox (hub blocked); needs http(s), not file:// |
| Auto edit | ✅ | `js/autoedit.js`: silence remover (ripple / split / mark), scene detection, beat detection + cut to beat, auto reframe |
| Right-click tools | ✅ | player: Zoom 2×/4× on the clicked spot (crop + scale, clicked spot centred; `clip.zoomSpot` keeps the pre-zoom state for Reset zoom), Crop corner to here (nearest corner moves to the click), Reset crop, Auto subtitles…; timeline clip: Auto subtitles…, Remove silences…, Detect scenes…, Cut to beat…. Captions reuse a free top "Captions" track, else a new track goes on top. Each edit is one undo step |
| Polish | ✅ | t=0 on the left wall, live preview while dragging, guides (G), preview zoom/pan, player right-click menu, label scrubbing, status-bar selection info |
| Unreal-style number fields | ✅ | `js/numfield.js`: drag to scrub (Shift fine / Ctrl coarse), click to type (no caps, math like `2*3`, `+10`), Esc cancels; native sliders restyled app-wide |
| Masks / gradient blur / 3D tilt | ✅ | clip.mask (linear, radial, rect, ellipse), clip.gradBlur (site's Gradient Blur), transform.rotX/rotY/perspective; tile filters (site's Seamless Tile) |
| Site integrations | ✅ | Import from URL (site downloader), auto-convert unsupported files on import (site converter / ffmpeg.wasm), copy file names, text case buttons, crop-to-aspect, AI background removal, material templates (Channel Compositor, Normal Mix, Seamless tile, Height → Normal) |
| Overwrite on drop | ✅ | dropping clips over clips trims / splits / removes what's underneath (Alt = avoid) |
| Material editor drops | ✅ | drag images (files or library) onto the graph → Texture Sample nodes |

## Known limitations / next ideas

* Material editor hold-key shortcuts follow Unreal (1-4 constants, A D E I L M N O P S T U V; C = Component Mask, R Rotator, F Frac, B Blend, X Noise, K Clamp, W Time, G Desaturation, H Append).
* Keyframe animation per property (Filmora's ◇ buttons) — not yet.
* Opus only encodes at 48 kHz (44.1 kHz choice applies to WAV / MP3 / AAC).
* PNG-sequence export not implemented.
* Reverse video playback seeks per frame — slow on long clips.
* The timeline "link" toggle is visual only.
* C++/Rust → WebAssembly is an option for hot spots (pitch shifter, custom encoders) if JS ever becomes the bottleneck; WebGL + WebCodecs already run natively.

## Testing

```bash
python3 -m http.server 8099   # from the repo root
node video-editor/tests/smoke.mjs <dir with clip.webm green.png tone.wav> <screenshot dir>
```
