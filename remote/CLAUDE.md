# GlobalRemoteControl (remote/) — notes for Claude

Consent-based remote desktop for the user's OWN home PC. Contract between the parts: `docs/PROTOCOL.md`
(change it first, then all three parts). Setup / usage: `README.md`.

* `server/remote-server.js` — signaling relay, hooked into the site's `server.js` with `require('./remote/server/remote-server').attach(app, server)`. Tests: `node --test "remote/server/test/*.test.js"`.
* `web/` — browser client, plain ES modules (no build), shown in the main site's **Remote** tab via iframe.
* `agent/` — Windows agent (.NET 8 WinForms + SIPSorcery). Tests: `dotnet test remote/agent`. Release build:
  `remote/agent/publish.ps1` → one self-contained `GlobalRemoteControl.exe`. CI publishes it to the GitHub release
  `remote-agent-latest` (`.github/workflows/remote-agent.yml`); the site's download button points there.

## Non-negotiable safety rules
- A pairing code alone never grants access; it is short-lived, single-use, rate-limited.
- The person at the PC approves every new controller and every session (control or view-only), and every file transfer (with a chosen destination).
- A visible on-screen session bar + tray state while any session (browser or MCP) is active; immediate kill switch (bar button, tray, Ctrl+Alt+Shift+F12).
- MCP (PROTOCOL section 6) is NOT implemented. If ever added: off by default, never auto-approves, no shell / arbitrary file access, session-scoped tokens, logs everything.
- No stealth mode, hidden persistence, credential access, or network-control bypasses. "Start at login" is an opt-in visible checkbox.
- Tests for every security-sensitive path.
