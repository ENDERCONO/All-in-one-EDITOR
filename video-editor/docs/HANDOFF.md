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

## Tested on the user's PC (2026-11-05)

- Node.js: the PC has **Volta** installed; `node` failed until a toolchain was added
  (`volta install node@lts` → v26.13.0). `START-SERVER.bat` should mention Volta in its
  "no Node" message.
- `npm install` + `node server.js` work; ffmpeg is fetched on the first download (~20 s).
- Local downloads OK: YouTube video (Me at the zoo, 12 s, no bot check on the home
  connection), direct `.mp4` (video and MP3), archive.org (came back as a 330 MB `.avi`).
- Vimeo now needs login; the raw yt-dlp text reaches the user. Add a friendly message for
  "only works when logged-in".
- Server log prints `â€”` on the Windows console: use ASCII in `[downloader]` log lines.
- Not yet done: TikTok / Instagram / X links (need real public links from the user), the
  smoke test (Playwright + Chromium now installed in a temp folder; needs `NODE_PATH` to it
  and a media dir made with `bin/ffmpeg.exe`), step 4 (reporting), AI features.
- The online (Render) server is still blocked by YouTube; that can't be fixed by a push.

## Open items

1. **Local flow on Windows: done (2026-11-05), tested on the user's PC.** `START-SERVER.bat`
   sets itself up: if the server already answers on port 3000 it just opens the site; if
   Node.js is missing it offers to install it (Volta, else winget; asks with a 20 s default
   of Yes, never in `/quiet`); it re-runs `npm install` whenever `package.json` differs from
   `node_modules/.installed-package.json`; it restarts the server after a crash (gives up
   after 5). `START-SERVER.bat /quiet` = no browser, no questions. `START-AT-LOGIN.bat`
   turns a Startup-folder shortcut (minimized, `/quiet`) on or off; it is opt-in and was
   not run on the user's PC. Fixed: `npm -v` without `call` ended the old script early on
   a normal (non-Volta) Node.js install. Delays use `ping`, not `timeout` (which fails
   without a console).
2. **YouTube "not a bot" check.** Unverified on the user's home connection. Ask for the
   `[downloader]` lines from the server console and for whether the download said
   "via this PC" or "via the online server".
3. **AI features are untested against real models** (hub blocked in the build sandbox):
   auto captions (`js/ai.js`, Whisper via transformers.js 4.3.2 from jsDelivr) and
   background removal (RMBG-1.4 / MODNet). Test them on the real PC first.
4. **Right-click Copy/Paste of transitions** in the timeline menu is not tested on the
   latest build (Ctrl+C / Ctrl+V works).

## Prompt for a cloud (non-local) session

> Continue the All-in-one EDITOR project (branch `main`). Read `video-editor/docs/HANDOFF.md`
> (especially "Tested on the user's PC") and `CLAUDE.md` first. You can't reach the user's
> PC, so make code changes only; the local tests happen later on the PC.
> Do: (1) `START-SERVER.bat`: when `node` fails but Volta is installed
> (`C:\Program Files\Volta\volta.exe` exists), say "run `volta install node@lts`" instead of
> only "install Node.js"; print which server the editor will use (this PC, port 3000).
> (2) `server.js`: friendly message for "only works when logged-in" (site needs an account);
> ASCII-only `[downloader]` log lines (no em dashes, they print as `â€”` on Windows);
> log one line per download with the URL, the site, which attempt worked or the final
> reason; on a local (non-Render) server, fetch ffmpeg at boot instead of on first download.
> Keep `/api/dl/ping`'s fields and add `local: !process.env.RENDER`.
> (3) `video-editor/js/integrations.js`: the dialog/progress always says "via this PC" or
> "via the online server", and on failure says which server failed and why. If the online
> server fails with the YouTube bot check, say "Start START-SERVER.bat on your PC; YouTube
> works there". Mirror `friendlyDlError` in `explainDlError`.
> (4) `node video-editor/build.mjs`, run the smoke test (`video-editor/tests/smoke.mjs`, make
> the media with ffmpeg), commit and push to `main`.
> Rules: no covert data collection, no third-party YouTube bypass/scraping services, no proxy
> pools, nothing that reads the user's data without asking.

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
