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
C→D    { type:"signal", sessionId, sdp:{ type:"offer", sdp }, ecdh:"<b64 spki, ephemeral ECDH P-256>",
         signature: sign("grc-offer:" + sessionId + ":" + ecdh + ":" + sdp) }
D→C    { type:"signal", sessionId, sdp:{ type:"answer", sdp }, ecdh:"<b64 spki, ephemeral ECDH P-256>",
         signature: deviceSign("grc-answer:" + sessionId + ":" + ecdh + ":" + sdp) }
       // ecdh keys are always exchanged; they key the encrypted relay fallback (section 7)
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
≤ 16 000 bytes of payload. A frame is complete when all chunks arrived; a newer frameId discards an older partial one
(a dropped partial *delta* frame means the controller must request one with `{t:"keyframe"}`).

**Frame payload (v2, tile-delta)** — the reassembled bytes, all little-endian:
```
u8  version = 2
u8  flags            bit0 = keyframe (whole screen; the controller resets its canvas)
u16 width, u16 height  size of the full encoded picture (after scaling)
u16 rectCount
rectCount × { u16 x, u16 y, u16 w, u16 h, u8 codec (0 = JPEG), u32 length, length bytes }
```
The agent compares each captured (scaled) frame with the previous one in tiles (64×64, merged into horizontal runs) and
sends only changed areas; rectCount 0 = nothing changed (not sent at all, except as a heartbeat ≤ 1/s). A keyframe is
sent at session start, on resolution/monitor/scale change, on `{t:"keyframe"}`, and every 10 s as a safety refresh.
The controller paints each rect onto a persistent canvas at (x, y). Flow control: the agent keeps at most 6 frames or
1.5 MB un-acked and the channel's buffered amount under 1 MB; it never waits on a frame it can drop — it captures the
newest screen when the window opens (latest-wins, no queueing of stale frames). After each complete frame the
controller sends `{t:"ack", frameId}`.

**Audio** (agent→controller): PCM signed 16-bit LE, mono, 24 000 Hz, 20 ms per message (480 samples = 960 bytes),
from WASAPI loopback. Sent only while audio is enabled.

**File chunks**: raw bytes ≤ 16 000 per message, for the single active transfer in that direction.

### 5.1 GPU video track (H.264) — agent-initiated renegotiation (optional)
The controller's first offer (above) never changes: data channels only. An agent that can hardware-encode H.264
announces it in `hello` (`video:"h264"`) and then **renegotiates** to add a media track:
```
agent → controller  { type:"signal", sessionId, renegotiate:true, seq:<int 1..1e6>, sdp:{type:"offer", sdp}, signature }
controller → agent  { type:"signal", sessionId, renegotiate:true, seq:<same>, sdp:{type:"answer", sdp}, signature }
```
* Agent signs `grc-reoffer:<sessionId>:<seq>:<sdp>` with its device key; controller signs
  `grc-reanswer:<sessionId>:<seq>:<sdp>` with its controller key. Each side verifies before applying.
  `seq` strictly increases per session (an older or repeated seq is ignored: no replay / downgrade).
* The server relays these only after `session-accept`, never during the relay fallback (section 7), and only in
  this direction (agent offers, controller answers). No `ecdh` field (the relay keys come from the first exchange).
* The offer adds one `sendonly` video m-line (H.264, packetization-mode=1, no B-frames). The controller answers
  `recvonly` and shows the track in a hardware-decoded `<video>`; the JPEG `video` channel goes quiet while the track
  plays and is used again if the track ends or fails (the agent switches back on its own; the controller can also
  send `{t:"keyframe"}` to ask for a JPEG keyframe).
* Low-latency encoder settings (agent): GPU encoder (NVENC / AMF / QuickSync via Media Foundation) with software
  OpenH264 fallback, CBR or capped VBR, long GOP with intra-refresh, IDR on `{t:"keyframe"}` and on monitor or
  resolution change, max frame rate = the `quality` message's `fps` (≤ 60).
* An agent without H.264 never sends `video` in `hello` and never renegotiates: everything stays on the JPEG path.

### control messages, controller → agent (all validated; out-of-range → ignored + logged)
```
{ t:"mouse-move", x, y }                       // 0..1 floats, relative to the current monitor
{ t:"mouse-move-rel", dx, dy }                  // game mode (Pointer Lock): ints, clamped to ±2000 per message;
                                               // the agent injects RELATIVE motion (SendInput MOUSEEVENTF_MOVE, no ABSOLUTE)
                                               // so games that read raw mouse input can turn the camera.
                                               // An agent that doesn't know it ignores it (unknown t → ignored).
{ t:"mouse-button", button:"left"|"right"|"middle", down:bool, x?, y? }
{ t:"wheel", dx, dy }                          // ints, clamped to ±1200 (120 = one notch); Windows sign: dy > 0 = scroll up, dx > 0 = right
{ t:"key", code:"<KeyboardEvent.code>", down:bool }   // agent maps code → virtual key / scancode; unknown code ignored
{ t:"text", text }                             // ≤ 256 chars, typed as Unicode (mobile keyboard)
{ t:"select-monitor", index }
{ t:"quality", fps:1..60, quality:10..95, scale:0.25..1, cursor:bool }   // cursor=false: don't draw the cursor into frames
                                                                         // (the browser shows the user's own pointer)
{ t:"keyframe" }                               // request a keyframe (after a dropped frame or decode error)
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
{ t:"hello", mode:"control"|"view", monitors:[ { index, name, x, y, width, height, primary } ], monitor:<index>, audio:<bool available>,
  video?:"h264", relMouse?:true }                // optional capabilities: GPU video track (5.1) / mouse-move-rel
{ t:"monitor", index, width, height }          // after select-monitor / resolution change (native monitor pixels)
{ t:"cursor", x, y, visible }                   // 0..1 on the current monitor, ≤ 60/s while it moves (for touch/view cursor)
{ t:"file-accept", id } | { t:"file-reject", id, reason }   // answers to a controller offer
{ t:"file-progress", id, received }
{ t:"file-done", id, ok:bool, reason? }
{ t:"file-offer", id, name, size }             // the local user chose "Send a file to the remote device" in the tray
{ t:"file-end", id, sha256 }
{ t:"notice", text }                           // shown as a toast in the browser
```

## 6. MCP bridge (minimal: open the app, report status, make a pairing code)

`GlobalRemoteControl.exe --mcp` speaks MCP over stdio (JSON-RPC 2.0, newline-delimited; `initialize`,
`notifications/initialized`, `ping`, `tools/list`, `tools/call`; protocolVersion `2025-06-18`). It runs as a separate
short-lived process started by the MCP client and talks to the running tray app over a named pipe
`\.\pipe\GlobalRemoteControl-<current user SID>` whose ACL allows only the current user. Pipe protocol: one JSON
request line → one JSON response line (≤ 4 KB each): `{"cmd":"status"}`, `{"cmd":"pairing-code"}`. Replies carry
`ok`; errors are `{ ok:false, error, message }` (`unknown-command`, `bad-request`, `too-large`, `mcp-disabled`, …). The
pairing-code reply is `{ ok:true, code, expiresAt, server }`; `webUrl` is derived from `server` (`wss://host/remote/ws` →
`https://host/remote/web/`).

| tool | args | behaviour |
|---|---|---|
| `get_agent_status` | — | `{ running, connectedToServer, server, deviceName, fingerprint, trustedDevices, sessionActive, mcpAllowed }`; `running:false` if the pipe isn't there |
| `open_agent` | — | if not running, starts this same exe with `--tray` (visible tray app) and waits ≤ 15 s for the pipe; returns the status |
| `create_pairing_code` | — | refused unless **Allow Claude (MCP)** is on in the app; otherwise same as clicking *Pair a new device* (the code window also appears on the PC screen) and returns `{ code, expiresAt, webUrl }` |

There is deliberately no tool that approves anything, captures the screen, injects input or touches files: pairing and
every session still need the approval dialogs on the PC. Every pipe command is written to the audit log.
The app's MCP toggle defaults to off; "Copy Claude setup" copies `claude mcp add globalremotecontrol -- "<exe>" --mcp`.

## 7. Relay fallback over the WebSocket (when WebRTC can't connect, e.g. phones on mobile data)

No TURN server is needed. If the controller's `iceConnectionState` is not `connected`/`completed` within **6 s** of
applying the answer (or becomes `failed`), it sends `{ type:"relay-start", sessionId }` (controller-only, relayed to the
device like the other session messages; the server only accepts it for a session that was `session-accept`ed). From then
on both ends close the RTCPeerConnection and carry the four channels over the signaling WebSocket as **binary** frames:

```
WS binary frame = sessionId (22 ASCII bytes) | counter (u64 big-endian) | AES-256-GCM ciphertext (+16-byte tag)
plaintext       = u8 channel (0 control, 1 video, 2 audio, 3 file) | payload (exactly what the data channel would carry)
```
* Keys: `Z = ECDH(own ephemeral private, peer ecdh public)` (32 bytes, P-256 x-coordinate);
  `key_c2d = HKDF-SHA256(Z, salt = UTF-8 sessionId, info = "grc-relay c2d", 32)`, `key_d2c` likewise with `"grc-relay d2c"`.
* Nonce = 4 zero bytes | counter (u64 BE). Each direction starts its counter at 1 and increments per frame; the receiver
  drops any frame whose counter is not greater than the last accepted one (replay protection) or that fails to decrypt.
* Frame ≤ 64 KB (payloads stay ≤ 16 000 bytes as on the data channels). Control messages are JSON text inside the
  plaintext exactly as on the `control` channel.
* The server forwards binary frames unchanged, only between the two ends of a session that is accepted and in relay mode,
  and only from a socket that is one of those ends; the 22-byte sessionId prefix selects the session. It never sees
  plaintext. Binary frames have their own rate limit (≤ 4000 frames / 5 s per socket); if the receiver's socket has more
  than 8 MB buffered the server ends the session with reason `relay-overload`.
* Senders must self-throttle: video uses its ack window as before; file and other senders wait while their own
  WebSocket's buffered amount is above 1 MB (browser `ws.bufferedAmount`; agent: bounded send queue).
* Unordered/unreliable audio semantics don't exist on the relay; it's fine (ordered delivery).
* The browser shows a "Relayed" badge; Auto quality starts at the Smooth preset in relay mode.
