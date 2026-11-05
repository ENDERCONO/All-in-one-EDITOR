# Handoff — continue here (for the next Claude session)

Paste the prompt at the bottom into a new session on the user's local PC clone of
`ENDERCONO/All-in-one-EDITOR`, branch `main`.

## Where things stand

- **Site / editor:** `index.html` (main site) + `video-editor/` (the editor, opened from
  the "Video Editor" tab). Both deploy to GitHub Pages from `main`.
- **Build:** after any change in `video-editor/js/`, run `node video-editor/build.mjs`
  (regenerates `video-editor/dist/editor.js` for `file://`). Commit it.
- **Tests:** `video-editor/tests/smoke.mjs` (Playwright). Serve the repo first, e.g.
  `python -m http.server 8099`, then
  `VE_URL=http://localhost:8099/video-editor/ node video-editor/tests/smoke.mjs <mediaDir> <outDir>`.
  The media dir needs `clip.webm`, `green.png`, `tone.wav`.
- **Server:** `server.js` (Express) serves the site and the downloader/converter APIs.
  Local start: `START-SERVER.bat` (Windows). It needs **Node.js LTS** installed.
- **Node.js is required on the user's PC.** That was the real cause of the "not a bot"
  failures on the user's PC: `START-SERVER.bat` could not start, so downloads fell back
  to the online Render server, which YouTube blocks.

## Downloader (the part still being worked on)

Key pieces:
- `server.js`: `runDlJob` (retry plan: default → update yt-dlp → YouTube player clients
  → optional browser cookies), `ytdlpOnce`, `ytdlpCommonArgs`, `friendlyDlError`,
  cookie upload `POST /api/dl/cookies` (single-use token, deleted after use / 15 min),
  `scripts/fetch-tools.js` (fetches yt-dlp + ffmpeg at `npm install`).
- `video-editor/js/integrations.js`: `apiBase()` (checks this PC first on every download,
  then the online server), `downloadUrl()`, `explainDlError()`, Import-from-URL dialog.
- `video-editor/js/app.js`: paste a link (Ctrl+V) → download → timeline.
- Opt-in browser-login fallback on the PC: set `YTDLP_BROWSER=opera` (or chrome/edge/firefox/brave).
- Per-download cookies file: the user picks `cookies.txt` in Import from URL.

Rules the user set: no covert data collection, no third-party YouTube bypass/scraping
services, no proxy pools. Ask the user before anything that reads their data.

## Open items

1. **Make the local flow fully automatic on Windows.** Confirm `START-SERVER.bat` works
   on the user's PC after Node.js is installed. Optional: a Startup shortcut so the server
   starts at login (explain it, don't install it silently).
2. **YouTube "not a bot" check.** Unverified on the user's home connection. Ask for the
   `[downloader]` lines from the server console and for whether the download said
   "via this PC" or "via the online server".
3. **AI features are untested against real models** (hub blocked in the build sandbox):
   auto captions (`js/ai.js`, Whisper via transformers.js 4.3.2 from jsDelivr) and
   background removal (RMBG-1.4 / MODNet). Test them on the real PC first.
4. **Right-click Copy/Paste of transitions** in the timeline menu is not tested on the
   latest build (Ctrl+C / Ctrl+V works).

## Prompt for the next session

> Continue the All-in-one EDITOR project in this repo (branch `main`). Read
> `video-editor/docs/HANDOFF.md` first, then `CLAUDE.md`.
> Goal: the video editor's "Import from URL" must download YouTube, TikTok, Instagram and
> X links reliably on the user's Windows PC, fully automatically, with no manual steps
> beyond installing Node.js once and running `START-SERVER.bat`. Use the local server
> (this PC) first and the online server only as a fallback.
> Do not add covert data collection, third-party YouTube bypass or scraping services, or
> proxy pools. Ask the user before touching anything that reads their data. Explain
> anything that changes the user's machine (autostart, installs).
> Steps: (1) run the local server and the smoke test; (2) test the download path on a
> non-YouTube link and a direct link; (3) check the YouTube error path and what the server
> log says; (4) make `START-SERVER.bat` and the editor report clearly which server is used
> and why a download failed; (5) rebuild `video-editor/dist/editor.js` after any change in
> `video-editor/js/`, run the smoke test, commit and push to `main`.
