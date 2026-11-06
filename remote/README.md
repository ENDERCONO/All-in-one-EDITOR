# GlobalRemoteControl — control your own PC from any browser

Part of the All-in-one EDITOR site: open the **Remote** tab (or `/remote/web/`) on your phone or another computer
and control your home PC: live screen, mouse, keyboard, multiple monitors, PC audio and file transfer — every
session approved by you at the PC.

## Use it (nothing to install)

1. **On the home PC**: open the site → **Remote** → **Download the Windows app**. Run `GlobalRemoteControl.exe`
   (one self-contained file: .NET and WebRTC are inside it). It sits in the tray.
   Windows SmartScreen may warn because the exe isn't code-signed: *More info → Run anyway*.
2. In the app click **Pair a new device**: it shows a code like `7F2A-91BC`, valid 5 minutes, single use.
3. **On your phone / other PC**: open the Remote tab, type the code. The PC shows the browser's name and fingerprint —
   compare it with the one shown in the browser and click **Approve**. That browser is now a trusted device.
4. Press **Connect**. The PC asks again — **Allow full control**, **View only** or **Deny** — every time.
5. While a session runs, a bar at the top of the PC's screen says who is connected. Stop it any time with the bar's
   **Stop** button, the tray menu, or **Ctrl+Alt+Shift+F12**.

In a session: monitor picker, quality, audio on/off, send files (the PC asks where to save each one), on-screen
keyboard and touchpad mode for phones, fullscreen. From the PC's tray, **Send a file to the remote device…** pushes a
file to the browser.

## Claude / MCP

A minimal bridge (`docs/PROTOCOL.md` section 6): `GlobalRemoteControl.exe --mcp` lets Claude open the app, read its
status and — only when **Allow Claude (MCP)** is ticked (off by default) — show a pairing code on the PC's screen.
Claude cannot approve devices or sessions, see the screen, send input or touch files. **Copy Claude setup** in the main
window copies the `claude mcp add …` command. Every request is written to the audit log.

## How it works

```
Browser (Remote tab) ──WSS──▶ Render server (/remote/ws, stateless relay) ◀──WSS── GlobalRemoteControl.exe (home PC)
        ▲                                                                              │
        └──────────── WebRTC data channels, DTLS-encrypted, peer-to-peer ──────────────┘
```

* The server only relays signaling. Your PC holds the list of trusted browsers; each browser and the PC have their own
  P-256 keys, and the WebRTC offer/answer are signed, so even the server can't impersonate either side or read the stream.
* Screen frames are JPEG over a WebRTC data channel (with back-pressure), audio is 24 kHz PCM, input is JSON.
* Details: [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Safety rules: [`CLAUDE.md`](CLAUDE.md).

**NAT note**: most home networks connect directly (STUN). On strict networks (some mobile carriers, corporate
Wi-Fi) a TURN relay is needed: set `REMOTE_TURN_URL` (e.g. `turn:turn.example.com:3478`) and `REMOTE_TURN_SECRET`
(coturn `static-auth-secret`) on the Render service.

## Develop

| | command |
|---|---|
| Run the site + signaling locally | `node server.js` → `http://localhost:3000/remote/web/` |
| Agent against the local server | `dotnet run --project remote/agent/GlobalRemoteControl.Agent -- --server ws://localhost:3000/remote/ws` |
| Server tests | `node --test "remote/server/test/*.test.js"` |
| Web logic tests | `node --test "remote/web/test/*.test.mjs"` |
| Agent tests | `dotnet test remote/agent` |
| Build the single exe | `powershell remote/agent/publish.ps1` → `remote/agent/dist/GlobalRemoteControl.exe` |

Releases: pushing changes under `remote/agent/` to `main` runs `.github/workflows/remote-agent.yml`, which tests,
builds the exe and uploads it to the GitHub release `remote-agent-latest`. The site's download button
(`/api/remote/agent`) serves a local `remote/agent/dist/GlobalRemoteControl.exe` if present, otherwise redirects to
that release (override with `REMOTE_AGENT_URL`).

Known limits: input can't reach windows running as administrator unless the agent is run as administrator
(Windows UIPI); the Ctrl+Alt+Del secure screen can't be controlled.
