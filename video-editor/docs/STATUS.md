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
| Main site | ✅ | **Video Editor** tab (iframe, lazy loaded) |

## Known limitations / next ideas

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
