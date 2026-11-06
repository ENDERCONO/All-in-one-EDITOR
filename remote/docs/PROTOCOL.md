# GlobalRemoteControl — wire protocol (the contract between server, web client and agent)

Three parts, all in this repo:

| Part | Path | Tech |
|---|---|---|
| Signaling server | `remote/server/remote-server.js` | CommonJS module, `ws` package, hooked into the site's `server.js` (Express 5 on Render) |
| Web client | `remote/web/` (`index.html`, `app.js`, `style.css`, more ES modules) | Plain ES modules, no build step. Embedded in the main site as the **Remote** tab (iframe) |
| Windows agent | `remote/agent/` | .NET 8 WinForms, SIPSorcery WebRTC, published as ONE self-contained exe `GlobalRemoteControl.exe` |

Production server: `https://all-in-one-editor.onrender.com`. WebSocket endpoint: `wss://<host>/remote/ws`
(dev: `ws://localhost:3000/remote/ws`). All WebSocket messages are JSON text frames, max 64 KB, each with a `type`.

## Trust model (why the server is untrusted)

The server is a stateless relay (Render's free disk is wiped on restart). **The trust root is the home PC.**

* **Device identity**: the agent owns an ECDSA P-256 key pair (private key DPAPI-protected on disk).
  `deviceId = base64url(SHA-256(SPKI DER of public key)).slice(0, 22)`.
* **Controller identity**: each browser owns an ECDSA P-256 key pair made with WebCrypto (`extractable: false`
  private key, kept in IndexedDB). `controllerId` is computed the same way from its SPKI.
* **Fingerprint** for humans: first 8 bytes of SHA-256(SPKI) as uppercase hex in groups of 4: `AB12-CD34-EF56-7890`.
  The agent's approval dialog shows the controller's fingerprint; the browser shows it too so the user can compare.
* **Signatures**: ECDSA with SHA-256, signature encoded as **IEEE P1363** (`r||s`, 64 bytes), base64 (standard, padded).
  WebCrypto produces that natively; .NET: `DSASignatureFormat.IeeeP1363FixedFieldConcatenation`;
  Node: `crypto.verify('sha256', data, { key, format:'der', type:'spki', dsaEncoding:'ieee-p1363' }, sig)`.
  Signed data is the UTF-8 bytes of the strings given below.
* Public keys travel as base64 SPKI DER.
* A pairing code alone gives nothing: the person at the PC must approve the controller (pairing), and must approve
  **every** session. The agent itself verifies controller signatures; it never trusts the server's word.
* The agent signs its SDP answer and the controller signs its offer, so the server cannot man-in-the-middle the
  WebRTC DTLS connection (the DTLS fingerprint is inside the signed SDP).

## 1. Connect + authenticate (both roles)

```
S→C  { type:"challenge", nonce:"<base64 32 bytes>" }
C→S  { type:"hello", role:"device"|"controller", publicKey:"<b64 spki>", name:"<1..64 chars>",
       signature: sign("grc-auth:" + role + ":" + nonce) }
S→C  { type:"ready", id:"<deviceId|controllerId>", iceServers:[ { urls, username?, credential? } ] }
```
Bad signature / bad schema / no hello within 10 s → `{type:"error", code:"auth-failed"}` and close.
`iceServers` always contains `stun:stun.l.google.com:19302`; if env `REMOTE_TURN_URL` and `REMOTE_TURN_SECRET`
are set, add a TURN entry with coturn REST credentials (username `"<expiryUnix>:<id>"`, credential
`base64(HMAC-SHA1(secret, username))`, 1 h). Only one socket per device id: a new device login replaces the old.

Errors anywhere: `{ type:"error", code:"<kebab-code>", message?, ref? }` (`ref` echoes a `requestId`/`sessionId`).

## 2. Pairing (enroll a new controller)

```
D→S  { type:"pairing-code-request" }
S→D  { type:"pairing-code", code:"ABCD-EFGH", expiresAt:<ms epoch> }
```
Code: 8 chars from Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), shown as `XXXX-XXXX`, TTL 5 min,
single-use, one live code per device (a new request replaces the old one). Redemption normalises input
(uppercase, strip `-`/spaces, I→1, L→1, O→0). Rate limit: max 5 `pair` attempts per minute per controller id and
per IP (over the limit → error `rate-limited`, no lookup done). A used or expired code is deleted.

```
C→S  { type:"pair", code:"ABCD-EFGH" }
S→C  { type:"pair-pending", requestId, device:{ id, name, publicKey } }    // or error code "bad-code" | "rate-limited" | "device-offline"
S→D  { type:"pair-request", requestId, controller:{ id, name, publicKey } } // identity verified by the server at hello
D→S  { type:"pair-result", requestId, approved:true|false }
S→C  { type:"pair-result", requestId, approved, device:{ id, name, publicKey } }
```
The agent stores approved controllers (id, name, publicKey, addedAt) locally. The browser stores paired devices
(id, name, publicKey) in IndexedDB. Revocation = the agent deletes the controller (tray UI); the browser can
"forget" a device locally.

## 3. Presence

```
C→S  { type:"watch", deviceIds:[...≤50] }
S→C  { type:"presence", devices:{ "<id>": { online:true|false, name? } } }   // sent now and on every change
```

## 4. Session setup

`sessionId` = 22-char base64url random from the controller. The server keeps `sessionId → {controllerSocket, deviceSocket}`
in memory and relays only these types between the two ends, adding nothing but `sessionId`:
`session-challenge, session-auth, session-accept, session-reject, signal, session-end`.
On either socket closing the server sends `{type:"session-end", sessionId, reason:"peer-disconnected"}` to the other.

```
C→S→D  { type:"session-request", sessionId, deviceId }   // server forwards to device as:
S→D    { type:"session-request", sessionId, controller:{ id, name, publicKey } }
D→C    { type:"session-challenge", sessionId, nonce:"<b64 32 bytes>" }       // device rejects at once if controller not paired:
                                                                            // { type:"session-reject", sessionId, reason:"not-paired" }
C→D    { type:"session-auth", sessionId, signature: sign("grc-session:" + sessionId + ":" + nonce + ":" + deviceId) }
       // device verifies with the publicKey IT stored at pairing, then shows the local approval dialog:
       // "Allow full control" | "View only" | "Deny" (auto-deny after 60 s)
D→C    { type:"session-accept", sessionId, mode:"control"|"view" }  |  { type:"session-reject", sessionId, reason:"denied"|"timeout"|"bad-signature"|"busy" }
C→D    { type:"signal", sessionId, sdp:{ type:"offer", sdp }, signature: sign("grc-offer:" + sessionId + ":" + sdp) }
D→C    { type:"signal", sessionId, sdp:{ type:"answer", sdp }, signature: deviceSign("grc-answer:" + sessionId + ":" + sdp) }
both   { type:"signal", sessionId, candidate:{ candidate, sdpMid, sdpMLineIndex } }   // unsigned
both   { type:"session-end", sessionId, reason }
```
The controller verifies the answer with the device publicKey it stored at pairing. One session at a time per device
(else `busy`).

## 5. WebRTC data channels (the controller creates all four before making the offer)

| label | options | content |
|---|---|---|
| `control` | ordered, reliable | JSON text messages, field `t` (below) |
| `video` | ordered, reliable | binary JPEG frame chunks |
| `audio` | `ordered:false, maxRetransmits:0` | binary PCM |
| `file` | ordered, reliable | binary file chunks |

**Video chunk** (agent→controller): 8-byte little-endian header `u32 frameId, u16 chunkIndex, u16 chunkCount`, then
≤ 16 000 bytes of JPEG. A frame is complete when all chunks arrived; a newer frameId discards an older partial one.
The agent sends the next frame only when the channel's buffered amount is under 256 KB (back-pressure), adapting
to the requested fps/quality. After each complete frame the controller sends `{t:"ack", frameId}`; the agent keeps at most
2 frames un-acked.

**Audio** (agent→controller): PCM signed 16-bit LE, mono, 24 000 Hz, 20 ms per message (480 samples = 960 bytes),
from WASAPI loopback. Sent only while audio is enabled.

**File chunks**: raw bytes ≤ 16 000 per message, for the single active transfer in that direction.

### control messages, controller → agent (all validated; out-of-range → ignored + logged)
```
{ t:"mouse-move", x, y }                       // 0..1 floats, relative to the current monitor
{ t:"mouse-button", button:"left"|"right"|"middle", down:bool, x?, y? }
{ t:"wheel", dx, dy }                          // ints, clamped to ±1200 (120 = one notch); Windows sign: dy > 0 = scroll up, dx > 0 = right
{ t:"key", code:"<KeyboardEvent.code>", down:bool }   // agent maps code → virtual key / scancode; unknown code ignored
{ t:"text", text }                             // ≤ 256 chars, typed as Unicode (mobile keyboard)
{ t:"select-monitor", index }
{ t:"quality", fps:1..30, quality:10..95, scale:0.25..1 }
{ t:"audio", enabled:bool }
{ t:"ack", frameId }
{ t:"file-offer", id, name, size }             // upload to PC; size ≤ 2 GiB; agent asks the local user + Save dialog
{ t:"file-end", id, sha256:"<hex>" }           // after the last chunk
{ t:"file-cancel", id }
{ t:"file-accept", id } | { t:"file-reject", id, reason }   // answers to an agent-initiated offer
```
In `view` mode the agent ignores input messages (mouse/wheel/key/text) and controller-initiated file offers.
The agent never injects its own kill-switch hotkey (Ctrl+Alt+Shift+F12) from remote input.

### control messages, agent → controller
```
{ t:"hello", mode:"control"|"view", monitors:[ { index, name, x, y, width, height, primary } ], monitor:<index>, audio:<bool available> }
{ t:"monitor", index, width, height }          // after select-monitor / resolution change
{ t:"file-accept", id } | { t:"file-reject", id, reason }   // answers to a controller offer
{ t:"file-progress", id, received }
{ t:"file-done", id, ok:bool, reason? }
{ t:"file-offer", id, name, size }             // the local user chose "Send a file to the remote device" in the tray
{ t:"file-end", id, sha256 }
{ t:"notice", text }                           // shown as a toast in the browser
```

## 6. Local API for the MCP bridge (agent only) — DESIGN ONLY, NOT IMPLEMENTED

`GlobalRemoteControl.exe --mcp` speaks MCP (JSON-RPC 2.0, stdio, newline-delimited) and forwards to the running
agent over `http://127.0.0.1:<port>` with a bearer token; port + token are in
`%LOCALAPPDATA%\GlobalRemoteControl\mcp.json` (rewritten at every agent start). The local API refuses everything
with 403 while **Allow Claude (MCP)** is off (default off). Tools:

| tool | args | notes |
|---|---|---|
| `get_agent_status` | — | connected, paired controllers count, active session, MCP enabled |
| `list_monitors` | — | index, name, bounds, primary |
| `request_session_approval` | `reason` (1..200) , `mode` `"control"\|"view"` | blocks until the local user answers (≤ 120 s); returns `sessionToken` valid 15 min |
| `capture_screen` | `sessionToken`, `monitor?`, `maxWidth?` 320..1920 | returns an MCP image (JPEG base64) |
| `send_input` | `sessionToken`, `action`: `move`/`click`/`double_click`/`right_click`/`scroll`/`type`/`key`, `x?`,`y?` (pixels in the last captured image, bounds-checked), `text?` ≤ 256, `key?` (KeyboardEvent.code or combo like `Control+C`), `dy?` | only with a `control` token |
| `request_file_transfer` | `sessionToken`, `fileName`, `contentBase64` (≤ 10 MB decoded) | local approval + Save dialog every time |
| `end_session` | `sessionToken` | |

MCP sessions show the same on-screen session bar and obey the same kill switch. Every call is appended to the audit log.
