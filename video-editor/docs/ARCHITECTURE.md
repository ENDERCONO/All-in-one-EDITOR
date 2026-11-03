# Video Editor — Architecture & Module Contracts

Read this before touching any file in `video-editor/`. Every module is a plain
ES module in `video-editor/js/`, no bundler, no npm. External libraries come
from CDNs (exact versions) and are imported with dynamic `import()` only when
needed.

## Files and owners

| File | Purpose | Exports |
|---|---|---|
| `js/state.js` | Project data model, undo/redo, event bus, query helpers | `store`, `mediaRuntime`, `makeClip`, `makeTrack`, `uid`, `dbToGain`, `gainToDb`, `clamp`, `FRAME_EPS` |
| `js/catalog.js` | Lists shared by UI + renderer: filters, transitions, blend modes, aspect presets, fonts | `FILTERS`, `TRANSITIONS`, `BLEND_MODES`, `ASPECTS`, `FONTS`, `TITLE_PRESETS` |
| `js/sources.js` | `<video>`/image/text-canvas sources per clip, playback sync, exact seeking for export | `createSources` |
| `js/ops.js` | Data-level edit operations (split, delete, ripple, insert, copy/paste, detach audio…) | `ops` |
| `js/timeline.js` | Timeline UI (tracks, clips, ruler, playhead, drag/trim/blade, zoom, snapping, transitions drop) | `createTimeline` |
| `js/renderer.js` | WebGL2 compositor: transforms, color, filters, chroma key, materials, transitions, blend modes | `createRenderer` |
| `js/gizmo.js` | On-canvas move / scale / rotate handles over the preview | `createGizmo` |
| `js/materials.js` | Unreal-style material node editor + GLSL compiler | `compileMaterial`, `buildMaterialFragment`, `openMaterialEditor`, `makeDefaultMaterial`, `NODE_TYPES` |
| `js/audio.js` | Web Audio playback, decoding, waveform peaks, pitch shifting, offline mixdown | `createAudioEngine` |
| `js/export.js` | Export dialog + encoders (MP4/WebM via WebCodecs, WAV, MP3, ffmpeg.wasm extras) | `openExportDialog` |
| `js/media.js` | Import (picker, drop, **Ctrl+V**), thumbnails/filmstrips, library panel tabs | `createLibrary`, `importFiles` |
| `js/inspector.js` | Right-hand property panel for the selected clip / project | `createInspector` |
| `js/playback.js` | Master clock: play/pause/seek, drives sources + renderer + audio each frame | `createPlayback` |
| `js/app.js` | Boot, menus, keyboard shortcuts, project settings, save/load | — (entry point) |

## Conventions

* **Time** is seconds (float). Frame snapping uses `settings.fps`.
* **Colors** in data are hex strings `#rrggbb`.
* **Alpha** is *straight* (not premultiplied) everywhere in shaders and textures; the renderer handles blending.
* **Coordinates**: project pixels. `(0,0)` is the frame center, +x right, +y down.
* Never mutate `store.project` outside `store.transact` / `store.update` (they snapshot for undo and emit events).
* Modules must not add global `keydown` listeners — `app.js` owns shortcuts and calls into modules. Local listeners on your own elements are fine (wheel, pointer, keydown inside an input).
* Style: CSS variables from `css/editor.css` (`--bg`, `--panel`, `--panel-2`, `--border`, `--text`, `--text-dim`, `--accent`, `--accent-2`, `--danger`, `--clip-video`, `--clip-audio`, `--clip-title`, `--clip-material`, `--playhead`). Module-specific CSS goes in its own file: `css/timeline.css`, `css/gizmo.css`, `css/materials.css`, `css/export.css` (already linked).

## Data model (`store.project`, pure JSON)

```js
{
  version: 1,
  name: 'Untitled project',
  settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000',
              sampleRate: 48000, channels: 2, masterVolume: 0 /* dB */ },
  media: [ { id, name, kind: 'video'|'image'|'audio', mime, duration /* s, images: 0 */,
             width, height, hasAudio, size } ],
  tracks: [ { id, kind: 'video'|'audio', name, muted: false, hidden: false, locked: false } ],
  clips:  [ Clip ],
  materials: [ Material ],
  markers: [ { id, time, color: '#ffcc00', label: '' } ]
}
```

`tracks` is in **UI order, top to bottom**: all video tracks first, then all
audio tracks. Upper video tracks draw **on top** (render the video tracks in
reverse array order).

### Clip

```js
{
  id, trackId,
  type: 'video' | 'image' | 'audio' | 'text' | 'color' | 'material',
  mediaId: string|null,          // video / image / audio clips
  name: string,
  start: 0,                      // timeline position (s)
  duration: 5,                   // length on the timeline (s)
  in: 0,                         // source offset (s) for video/audio
  speed: 1,                      // 0.1 .. 10; source time advances speed× faster
  reverse: false,
  transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 /* deg, clockwise */,
               opacity: 1, flipH: false, flipV: false },
  crop: { l: 0, t: 0, r: 0, b: 0 },    // fractions of the source removed per edge
  blend: 'normal',                     // see BLEND_MODES
  color: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0,
           temperature: 0, tint: 0, highlights: 0, shadows: 0, vignette: 0,
           blur: 0, sharpen: 0 },      // all -100..100 except blur/sharpen/vignette 0..100, hue -180..180
  filters: [ { id, type, amount: 1 } ],  // type from FILTERS, amount 0..1
  chroma: { enabled: false, color: '#00ff00', similarity: 0.35, smoothness: 0.08,
            spill: 0.5, edgeFeather: 0 },
  materialId: null,                    // apply a material from project.materials
  materialParams: {},                  // { [paramDisplayName]: number | number[] }
  audio: { volume: 0 /* dB, -60..+12 */, pan: 0 /* -1..1 */, pitch: 0 /* semitones -12..12 */,
           fadeIn: 0, fadeOut: 0, mute: false, keepPitch: true, detached: false },
  text: { content: 'Title', font: 'Inter', size: 96, color: '#ffffff', bold: true, italic: false,
          align: 'center', stroke: 0, strokeColor: '#000000', background: '', shadow: true,
          lineHeight: 1.15 },          // text clips only
  fill: '#2a6df4',                     // color clips only
  transitionIn:  null | { type, duration },   // see TRANSITIONS
  transitionOut: null | { type, duration },
  groupId: null
}
```

Fitting: a source is first **fit inside** the frame (`contain`), then the
transform is applied: `x, y` move the center (project px), `scale × scaleX/scaleY`
resize, `rotation` rotates around the center. Text clips are sized in project px
directly (scale 1 = the font size chosen). Color and material clips fill the frame.

### Material (node graph)

```js
{
  id, name,
  nodes: [ { id, type, x, y, params: { ... } } ],      // type from NODE_TYPES
  links: [ { id, from: { node, pin }, to: { node, pin } } ]   // pin = pin name string
}
```

Exactly one node of type `output` with inputs `baseColor (vec3)`, `opacity (float)`,
`emissive (vec3)`, `uv (vec2, optional UV override for the source sample)`.
Final color = `vec4(baseColor + emissive, opacity)`.

## `state.js`

```js
store.project                       // the JSON above
store.selection                     // { clipIds: string[], trackId: string|null, markerId:null }
store.playhead                      // seconds
store.playing                       // bool
store.tool                          // 'select' | 'blade'
store.zoom                          // px per second on the timeline
store.snap                          // bool
store.clipboard                     // copied clips (internal)

store.on(event, fn) / store.off(event, fn) / store.emit(event, payload)
store.transact(label, fn)           // fn(project) mutates; one undo step; emits 'project'
store.update(label, fn, { coalesce: 'key' })  // like transact, but consecutive calls with the
                                    // same coalesce key within 600 ms merge into one undo step
store.undo() / store.redo() / store.canUndo() / store.canRedo()
store.load(projectJson)             // replace project, clear history
store.setPlayhead(t) / store.select(clipIds, {add}) / store.setTool(t) / store.setZoom(z)

store.getClip(id) / store.getTrack(id) / store.getMedia(id) / store.getMaterial(id)
store.clipsOnTrack(trackId)         // sorted by start
store.duration()                    // end of the last clip (s)
store.clipAt(trackId, t)
store.renderListAt(t)               // see below
store.audibleClips()                // clips that produce sound (respects mute/detached/track mute)
store.frame()                       // 1 / fps
store.snapTime(t)                   // round to frame
```

Events: `project` ({reason}), `selection`, `playhead` (t), `playstate` (bool),
`media` ({id, what}), `materials` ({id}), `tool`, `zoom`, `snap`, `history`.

`mediaRuntime` is a `Map<mediaId, { file: Blob, url: objectURL, image?: HTMLImageElement,
audioBuffer?: AudioBuffer, peaks?: { rate, min: Float32Array, max: Float32Array },
thumb?: dataURL, filmstrip?: [{ t, url }] }>`.

### `store.renderListAt(t)`

Returns the layers to draw at time `t`, **bottom first**:

```js
[ { track, clip, time /* source time */, transition: null | {
      type, progress /* 0..1 */, phase: 'in'|'out',
      other: Clip|null, otherTime /* source time of other, or null */ } } ]
```

For `transitionIn` on clip B during `[B.start, B.start + d)`: `other` is the clip
on the same track that ends at `B.start` (±1 frame), held on its last frame, or
`null` (transition from transparent). For `transitionOut` on clip A during the
last `d` seconds: `other` is `null` (transition to transparent). The renderer
draws `mix(other, clip, progress)` using the transition shader.

## `sources.js`

```js
const sources = createSources({ store, mediaRuntime })
sources.getFrame(clip)       // -> { el, width, height } | null  (el = HTMLVideoElement |
                             //    HTMLImageElement | HTMLCanvasElement), ready to upload to GL
sources.sourceTime(clip, t)  // clip.in + (t - clip.start) * clip.speed  (handles reverse)
sources.sync(t, playing)     // preview: keep one muted <video> per visible video clip in step
sources.prepare(t)           // Promise: every clip in renderListAt(t) has the exact frame
                             // (used by export and when paused)
sources.version(clip)        // number that changes when a clip's frame content changes
                             // (text re-render, video frame) — renderer may use it to skip uploads
sources.dispose()
```

## `renderer.js`

```js
const renderer = createRenderer({ canvas, store, sources, mediaRuntime })
renderer.render(t)           // draw the composited frame at time t into canvas (sync)
renderer.setSize(w, h)       // canvas pixel size; everything scales from project size
renderer.getClipQuad(clip)   // 4 corners [{x,y}] in *project* px (center origin), for gizmo
renderer.dispose()
```

Per-layer pipeline: source → chroma key → color adjust → filters → material →
crop + transform → blend into the frame. Transitions combine the two layers'
results before blending. Material shaders come from
`buildMaterialFragment(compileMaterial(material).code)`; recompile when the
`materials` event fires (cache by JSON string). Material uniforms are set from
`compileMaterial(...).uniforms` with overrides from `clip.materialParams[u.param]`.
`u_time` = seconds since the clip started.

## `materials.js`

```js
compileMaterial(material) -> {
  ok: bool, error: string|null,
  code: string,       // GLSL ES 3.0 that declares its own uniforms/helpers and defines
                      //   vec4 aio_material(vec2 uv)
  uniforms: [ { name /* glsl */, type: 'float'|'vec2'|'vec3'|'vec4', value, param /* display name */,
                min, max } ],
  textures: [ { uniform, mediaId } ]   // extra image textures from Texture Sample nodes
}
buildMaterialFragment(code) -> full fragment shader source. The wrapper provides:
  #version 300 es / precision highp float;
  uniform sampler2D u_src;   // the clip's own frame after color/filters (straight alpha)
  uniform float u_time;      // clip-local seconds
  uniform vec2 u_resolution; // layer size in px
  in vec2 v_uv; out vec4 outColor;
  void main() { outColor = aio_material(v_uv); }
openMaterialEditor({ store, mediaRuntime, materialId })  // full-screen modal node editor
makeDefaultMaterial(name) -> Material   // Texture Sample(src) -> Output
NODE_TYPES                               // registry: { [type]: { title, category, inputs, outputs, params } }
```

## `audio.js`

```js
const audio = createAudioEngine({ store, mediaRuntime })
audio.ctx                         // AudioContext
audio.ensureDecoded(mediaId)      // Promise<AudioBuffer|null>; also fills mediaRuntime peaks,
                                  //   emits store 'media' {id, what:'peaks'}
audio.play(fromTime)              // schedule all audible clips from timeline time
audio.stop()
audio.now()                       // current timeline time while playing
audio.refresh()                   // re-schedule after an edit while playing
audio.renderMix({ start, end, sampleRate, channels }) // Promise<AudioBuffer> (offline)
audio.meter()                     // { l, r } peak 0..1 for the level meter
```

## `export.js`

```js
openExportDialog({ store, mediaRuntime, sources, audio, createRenderer })
```

## `timeline.js`

```js
const timeline = createTimeline({ root /* #timeline */, store, mediaRuntime, ops })
timeline.scrollToPlayhead()
timeline.render()                 // force redraw
```

## `gizmo.js`

```js
const gizmo = createGizmo({ layer /* #gizmoLayer */, canvas, store, renderer })
gizmo.refresh()
```

## `ops.js`

```js
ops.insertMedia(mediaId, { time, trackId })   // add a clip for a media item (new track if busy)
ops.addTextClip({ time, preset }) / ops.addColorClip({ time, fill }) / ops.addMaterialClip({ time, materialId })
ops.splitAt(t, clipIds?)            // split selected (or all clips under the playhead)
ops.deleteSelected({ ripple })
ops.copy() / ops.cut() / ops.paste(t) / ops.duplicate()
ops.trimStartTo(t) / ops.trimEndTo(t)
ops.detachAudio()
ops.moveClip(id, { start, trackId })          // used by timeline drag (no overlap: pushes into new track)
ops.setTransition(clipId, 'in'|'out', { type, duration } | null)
ops.addTrack(kind, index?) / ops.removeTrack(id)
ops.addMarker(t)
ops.freezeFrame()
```
