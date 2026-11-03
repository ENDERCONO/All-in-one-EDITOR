# All-in-one EDITOR — notes for Claude

* `index.html` is the whole main site (≈25k lines, one file): a sidebar of tabs, each tab is a `<main data-mode="…">` panel, scripts at the bottom. Add a tab = sidebar `<button class="sb-tab" data-tab="x">` + `<main data-mode="x" hidden>`.
* `server.js` (Express) serves the repo statically plus APIs (downloader, converter with native ffmpeg, chat). GitHub Pages also deploys the repo as static files (`.github/workflows/static.yml`), so every tool must work without the server.
* A shared ffmpeg.wasm loader lives in `index.html`: `window.loadSharedFFmpeg()`.
* Don't touch `claude-game/`, `ReelReact/`, `process-monitor-app/`, `Autoclicker/` binaries unless asked.

## Video editor (`video-editor/`)

Standalone Filmora-style editor, embedded in the main site as the **Video Editor** tab through an iframe.
Start with `video-editor/docs/PLAN.md` and `video-editor/docs/ARCHITECTURE.md` (data model + every module's contract), shortcuts in `video-editor/docs/SHORTCUTS.md`, progress in `video-editor/docs/STATUS.md`.

* No build step: plain ES modules, CDN libraries with exact versions.
* Mutate project data only through `store.transact` / `store.update`.
* Only `js/app.js` adds global key listeners.
* Test: `node server.js` then open `http://localhost:3000/video-editor/` (or the Playwright smoke test `video-editor/tests/smoke.mjs`).
