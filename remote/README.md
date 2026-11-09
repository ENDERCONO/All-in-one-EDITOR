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
keyboard, fullscreen (where the browser allows it; not iPhone Safari).

**Game mode** (toolbar **Game**, needs the latest Windows app): locks the mouse to the stream and sends raw relative
motion, so games that read the mouse directly (first-person cameras etc.) can be aimed. **Esc** releases the mouse.
Some games with anti-cheat block injected input.

**GPU video** (Stream settings, on by default, needs the latest Windows app): the PC encodes the screen as H.264 on
the graphics card (NVIDIA / AMD / Intel; Windows' software encoder if there is none) and sends it as a WebRTC
video stream that the browser decodes in hardware, like a livestream: smoother at 30–60 fps with far less data than
the JPEG picture. A **GPU** badge shows while it is on. If it can't start, the session simply stays on JPEG.

On a phone or tablet: **pinch with two fingers to zoom** into the PC's screen and drag with two fingers to move
around (the **1:1** button resets the zoom). **Touchpad** mode (default on touch screens) moves a cursor like a laptop
touchpad: tap = click, hold then drag = drag, two-finger tap = right click, two-finger drag = scroll (or pan when
zoomed). With Touchpad off the finger is the mouse: tap = click, drag = drag, long press or two-finger tap = right
click, two-finger drag = scroll (or pan when zoomed). On mobile data, where a direct connection usually fails, the
session switches to the encrypted relay automatically. From the PC's tray, **Send a file to the remote device…** pushes a
file to the browser.

## Away from home: "My device" (off by default)

Normally someone at the PC has to click Approve. To use the PC when nobody is home, mark your own phone (or laptop)
as **My device**, once, while you're at the PC: open the app → **Trusted devices** → select the phone → **Mark as my
device…** → Yes. From then on that phone:

* **connects without approval**: tap Connect and you're in (full control);
* **sends files without asking**: they land in `Downloads\GlobalRemoteControl` (never overwriting anything);
* **approves other devices for you**: when another browser (e.g. a school computer) pairs or asks for a session,
  the phone pops up *Allow once / Trust / Deny* (or *Allow control / View only / Deny*) at the same time as the PC
  dialog, and the first answer wins. **Allow once** = one session, nothing saved, gone afterwards. Keep the Remote page
  open on the phone to get these (it can also show a notification while the tab is in the background). Since
  2026-11-09 every **trusted** device gets these popups too, not only "My device" ones;
* **gets pairing codes**: the **Pairing code** button next to the PC asks it for a fresh code to type on the other browser.

Example, at school: tap **Pairing code** on your phone → type the code on the school PC → tap **Allow once** on your
phone → press Connect on the school PC. When you disconnect, the school PC has no access left.

The session bar, tray icon and kill switch (Ctrl+Alt+Shift+F12) still work, everything is in the audit log, and
**Not my device** (or Revoke) undoes it. Only the PC can mark a device; Claude/MCP can't. Details: `docs/PROTOCOL.md`
section 8.

## Claude / MCP (minimal, off by default)

The exe has a tiny MCP bridge so Claude can **open the app, check its status and make a pairing code** — nothing else.
There is deliberately no tool that approves anything, sees the screen, moves the mouse, types or touches files:
pairing and every session still need your click at the PC.

1. In the app, turn on **Allow Claude (MCP)** (off by default) and click **Copy Claude setup**. It copies:
   ```
   claude mcp add globalremotecontrol -- "C:\path\to\GlobalRemoteControl.exe" --mcp
   ```
2. Run that once in a terminal. Claude now has three tools:

| tool | what it does |
|---|---|
| `get_agent_status` | running?, connected to the server, device name + fingerprint, number of trusted browsers, session active, MCP allowed |
| `open_agent` | starts the tray app (visible) if it isn't running |
| `create_pairing_code` | only when **Allow Claude (MCP)** is on: same as clicking *Pair a new device* (the code window also shows on the PC) and returns the code + the Remote tab URL |

`--mcp` runs as a short-lived process started by Claude; it talks to the running tray app over a named pipe that only
your Windows user can open. Every request is written to the audit log. Details: `docs/PROTOCOL.md` section 6.

## How it works

```
Browser (Remote tab) ──WSS──▶ Render server (/remote/ws) ◀──WSS── GlobalRemoteControl.exe (home PC)
        ▲                                                                │
        └──────── WebRTC data channels, DTLS-encrypted, peer-to-peer ────┘
                 (fallback: AES-256-GCM frames relayed over the two WebSockets)
```

* The server relays signaling. Your PC holds the list of trusted browsers; each browser and the PC have their own
  P-256 keys, and the WebRTC offer/answer (including an ephemeral ECDH key on each side) are signed, so even the server
  can't impersonate either side or read the stream.
* Screen frames are tile-delta JPEG (only changed 64×64 areas are sent, keyframe on demand / every 10 s) over a WebRTC
  data channel with an ack window, audio is 24 kHz PCM, input is JSON.
* Details: [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Safety rules: [`CLAUDE.md`](CLAUDE.md).

**NAT / relay fallback (replaces TURN)**: most home networks connect directly (STUN). When WebRTC can't connect within
6 s (strict NATs, phones on mobile data, corporate Wi-Fi) the browser switches the session to the **encrypted relay**:
the same four channels travel as binary frames over the existing signaling WebSockets, end-to-end encrypted with
AES-256-GCM (keys from the signed ECDH exchange via HKDF, per-direction counters against replay). The server only
forwards ciphertext and never needs a TURN server; the browser shows a **Relayed** badge and starts at the Smooth
quality preset. Your own TURN server still works if you want one (`REMOTE_TURN_URL` + `REMOTE_TURN_SECRET`, coturn
`static-auth-secret`), but it's no longer needed.

## Develop

| | command |
|---|---|
| Run the site + signaling locally | `node server.js` → `http://localhost:3000/remote/web/` |
| Agent against the local server | `dotnet run --project remote/agent/GlobalRemoteControl.Agent -- --server ws://localhost:3000/remote/ws` |
| Server tests | `node --test "remote/server/test/*.test.js"` |
| Web logic tests | `node --test "remote/web/test/*.test.mjs"` |
| Agent tests | `dotnet test remote/agent` (Windows; with `node` on PATH it also cross-checks relay frames and video frames against `web/protocol.js`, and runs the "My device" flow end to end against the real signaling server) |
| Regenerate the relay test vector (after changing `RelayCodec` in `web/protocol.js`) | `node remote/agent/GlobalRemoteControl.Agent.Tests/Fixtures/make-relay-vector.mjs` |
| Build the single exe | `powershell remote/agent/publish.ps1` → `remote/agent/dist/GlobalRemoteControl.exe` |

Releases: pushing changes under `remote/agent/` to `main` runs `.github/workflows/remote-agent.yml`, which tests,
builds the exe and uploads it to the GitHub release `remote-agent-latest`. The site's download button
(`/api/remote/agent`) serves a local `remote/agent/dist/GlobalRemoteControl.exe` if present, otherwise redirects to
that release (override with `REMOTE_AGENT_URL`).

Known limits: input can't reach windows running as administrator unless the agent is run as administrator
(Windows UIPI); the Ctrl+Alt+Del secure screen can't be controlled.
