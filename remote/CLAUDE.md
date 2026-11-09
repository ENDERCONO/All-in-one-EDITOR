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
  The one exception is PROTOCOL section 8 ("My device"): a controller the person at the PC explicitly marked as their own (off by default, settable only at the PC, never over the network or by MCP) may start sessions and upload files (fixed Downloads\GlobalRemoteControl folder, no overwrite) without a dialog, and may answer pairing/session approvals with a signed decision the agent verifies. Everything stays audited and visible (session bar, tray, kill switch).
- A visible on-screen session bar + tray state while any session (browser or MCP) is active; immediate kill switch (bar button, tray, Ctrl+Alt+Shift+F12).
- MCP is only the minimal PROTOCOL section 6 bridge (`agent/.../Mcp/`, tests in `McpTests.cs`): `--mcp` stdio server with exactly three tools — `get_agent_status`, `open_agent`, `create_pairing_code` — talking to the tray app over the per-user, current-user-ACL pipe (`status` / `pairing-code` only). "Allow Claude (MCP)" is off by default and gates `create_pairing_code`; every pipe command is audited. It never approves anything and has no screen, input, file, shell or session tools; don't add any without changing PROTOCOL first and keeping: off by default, never auto-approves, no shell / arbitrary file access, session-scoped tokens, logs everything.
- No stealth mode, hidden persistence, credential access, or network-control bypasses. "Start at login" is an opt-in visible checkbox.
- Tests for every security-sensitive path.
