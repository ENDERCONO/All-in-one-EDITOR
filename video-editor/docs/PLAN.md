# Video Editor — Plan

A Filmora-style video editor that runs fully in the browser, opened from the
**Video Editor** tab of the main site (`index.html` embeds `video-editor/index.html`
in an iframe so its shortcuts never clash with the other tools).

## Goals (from the request)

| Area | What it does |
|---|---|
| Look & controls | Filmora-like dark UI: media library top-left, player top-center, property inspector top-right, multi-track timeline at the bottom. Filmora shortcuts (see `SHORTCUTS.md`). |
| Import | File picker, drag & drop, **Ctrl+V paste** of images (and files) straight onto the timeline at the playhead. |
| Timeline | Multiple video + audio tracks, move clips across tracks, trim edges, split (Ctrl+B / blade tool), ripple delete, copy/paste, snapping, zoom, markers, undo/redo. |
| Canvas | Every clip can be moved, scaled, rotated, cropped, flipped in the frame with an on-canvas gizmo. Opacity + blend modes. |
| Project | Aspect presets 16:9, 9:16, 1:1, 4:3, 4:5, 21:9 or custom pixel size, frame rate, background color. |
| Look | Color adjust (brightness, contrast, saturation, hue, exposure, temperature, tint, vignette, blur, sharpen…), filter presets, **green screen (chroma key)** with spill removal. |
| Transitions | Dissolve, dip to black/white, wipes, slides, push, zoom, circle, pixelate, blur… dropped on a clip edge. |
| Audio | Volume, pan, **pitch (semitones, independent of speed)**, speed, fade in/out, mute, detach audio from video, waveform display. |
| Materials | Unreal-style node editor (Texture Sample, TexCoord, Time, Panner, math, Lerp, noise, …) compiled to GLSL and applied to any clip, or used as a generated clip. Scalar/vector parameters show up as sliders in the inspector. |
| Titles | Simple text clips (font, size, color, stroke, background). |
| Export | MP4 (H.264/AAC), WebM (VP9/Opus), audio-only WAV / MP3, GIF-free for now; resolution / pixel size, fps, quality/bitrate (compression), mono or stereo, sample rate. Extra containers (MOV, MKV…) through ffmpeg.wasm when the main site is hosting the editor. |

## Approach

* **No build step.** Plain ES modules in `video-editor/js/`, loaded by `video-editor/index.html`. Works on GitHub Pages and the Node server unchanged.
* **WebGL2 compositor** renders every frame (preview and export use the same code path, so what you see is what you export).
* **Web Audio** plays the mix; `OfflineAudioContext` renders it for export. Pitch shifting is done offline per clip (granular / WSOLA) and cached.
* **WebCodecs** + `mp4-muxer` / `webm-muxer` (CDN) encode exports frame-by-frame — fast and exact. WAV is written by hand, MP3 via `lamejs`.
* Project data is pure JSON (`store.project`) so undo/redo is snapshotting; heavy runtime things (Blobs, `<video>` elements, decoded audio) live in `mediaRuntime`, keyed by media id.

## Phases

1. **Docs + core** — this plan, `ARCHITECTURE.md` (module contracts), `SHORTCUTS.md`, `state.js`, `sources.js`, `catalog.js`, shell HTML/CSS. *(lead)*
2. **Parallel modules** (subagents, one file set each, built against the contracts):
   * A. `timeline.js` — timeline UI and editing operations.
   * B. `renderer.js` + `gizmo.js` — WebGL compositor, filters, chroma key, transitions, blend modes, canvas transform gizmo.
   * C. `materials.js` — node graph editor + GLSL compiler.
   * D. `audio.js` + `export.js` — audio engine, pitch shifter, export dialog and encoders.
3. **Glue** — `media.js` (import/paste/thumbnails/library), `inspector.js`, `playback.js`, `app.js` (menus, shortcuts, project settings, save/load). *(lead, in parallel with phase 2)*
4. **Integrate + test** — headless Chromium smoke test (load, import, play, export), fix bugs, embed tab in main `index.html`.

## Later / nice to have

Keyframe animation per property, motion tracking, speech-to-text captions, project autosave to IndexedDB, proxy media for 4K.
