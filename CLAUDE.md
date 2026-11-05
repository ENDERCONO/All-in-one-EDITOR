# All-in-one EDITOR — notes for Claude

* `index.html` is the whole main site (≈25k lines, one file): a sidebar of tabs, each tab is a `<main data-mode="…">` panel, scripts at the bottom. Add a tab = sidebar `<button class="sb-tab" data-tab="x">` + `<main data-mode="x" hidden>`.
* `server.js` (Express) serves the repo statically plus APIs (downloader, converter with native ffmpeg, chat). GitHub Pages also deploys the repo as static files (`.github/workflows/static.yml`), so every tool must work without the server.
* On Render the server keeps itself awake: it pings its own `RENDER_EXTERNAL_URL` every 10 minutes (`KEEP_AWAKE=0` turns it off). GitHub's scheduled keep-alive workflow never fired for this repo, so don't rely on it.
* A shared ffmpeg.wasm loader lives in `index.html`: `window.loadSharedFFmpeg()`.
* The site's audio **Timeline** tab is retired (button hidden in the sidebar, code kept; `lastTab = 'timeline'` opens the Video Editor). Multitrack audio lives in the Video Editor.
* Don't touch `claude-game/`, `ReelReact/`, `process-monitor-app/`, `Autoclicker/` binaries unless asked.

## Video editor (`video-editor/`)

Standalone Filmora-style editor, embedded in the main site as the **Video Editor** tab through an iframe.
Start with `video-editor/docs/PLAN.md` and `video-editor/docs/ARCHITECTURE.md` (data model + every module's contract), shortcuts in `video-editor/docs/SHORTCUTS.md`, progress in `video-editor/docs/STATUS.md`.

* Plain ES modules (no build needed on a server). Libraries are vendored in `video-editor/vendor/`.
* **After changing anything in `video-editor/js/`, run `node video-editor/build.mjs`** — it regenerates `video-editor/dist/editor.js`, the bundle used when `index.html` is opened from disk (`file://` blocks modules). Commit the bundle too.
* Mutate project data only through `store.transact` / `store.update`.
* Only `js/app.js` adds global key listeners.
* Test: `node server.js` then open `http://localhost:3000/video-editor/` (or the Playwright smoke test `video-editor/tests/smoke.mjs`).
