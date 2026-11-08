# AIO Stream performance plan — GPU video track + game input

Investigation (2026-11-08). Goal from the user: faster, less bandwidth, 30–60 fps,
best image quality, no input lag, livestream-like, control like Parsec including
**moving the camera in games**.

## What it does today (the bottleneck)
- **Video:** `agent/.../Capture/VideoStreamer.cs` captures with DXGI Desktop
  Duplication, diffs 64×64 tiles, encodes changed tiles as **JPEG** and sends them
  over a **reliable, ordered `video` DataChannel** (`PROTOCOL.md` §5, codec 0 = JPEG).
  The browser (`web/session.js`) does `createImageBitmap(jpegBlob)` → `drawImage`
  onto a 2D canvas.
  → No GPU encode, no inter-frame video compression, retransmit-blocking on a
  reliable channel. This is why it's heavy and laggy at high fps / full screen.
- **Mouse:** absolute only — `{t:"mouse-move", x, y}` (0..1 of the monitor).
  There is **no relative-motion path**, so games that read raw mouse input (FPS
  camera, etc.) cannot be aimed. This is the "move cameras in games" gap.

## Target design
### A. Hardware H.264 WebRTC **video track** (replaces JPEG-over-datachannel)
- Agent: add a real `MediaStreamTrack` (SIPSorcery `RTCPeerConnection.addTrack`)
  carrying **H.264**. Encode with **Windows Media Foundation** using the GPU
  encoder when present (NVIDIA NVENC / AMD VCE / Intel QuickSync via the MFT),
  fall back to software **OpenH264** when no HW MFT is available.
- Encoder config for low latency: baseline/constrained-baseline or main, **no
  B-frames**, CBR or capped-VBR, **long GOP with periodic intra-refresh** (avoid
  big IDR spikes; send an IDR on `{t:"keyframe"}` and on monitor/resolution change),
  target bitrate by resolution (e.g. 1080p60 ≈ 10–20 Mbps on LAN, adaptive down),
  `maxFramerate` 30–60.
- Browser: on `pc.ontrack`, attach the incoming track to a `<video>` element
  (hardware-decoded by the browser) sized to fit; keep the 2D canvas only as the
  JPEG fallback. Use `playsInline`, `muted` autoplay; render the PC audio via the
  same track set or keep the existing `audio` channel.
- Bandwidth/adaptation: WebRTC's own congestion control (transport-cc / REMB)
  adjusts the bitrate to the link; drop resolution/fps before quality collapses.
  Idle screen → near-zero bitrate automatically.
- Keep the JPEG path as a negotiated fallback for browsers/links where the H.264
  track fails (and for the AES-relay fallback, which can't carry a media track).

### B. Relative-mouse "game mode" (Parsec-like camera control)
- `PROTOCOL.md` §5: add `{t:"mouse-move-rel", dx, dy}` (ints, clamped) controller→agent.
- Browser (`web/session.js` + UI): a **Game mode** toggle that requests
  **Pointer Lock** on the video; while locked, send `movementX/movementY` deltas as
  `mouse-move-rel` (coalesced per rAF) instead of absolute `mouse-move`; Esc releases.
- Agent input: inject **relative** movement with `SendInput` + `MOUSEEVENTF_MOVE`
  (no `ABSOLUTE` flag). Validate/clamp deltas; ignored in `view` mode; never
  synthesize the kill-switch. (Anti-cheat may still block injected input — document it.)

## Order of work (respect `remote/CLAUDE.md`: change PROTOCOL first, then all three parts, tests for security-sensitive paths)
1. `docs/PROTOCOL.md`: add the H.264 video track (§5) and `mouse-move-rel`.
2. Agent (C#): `Capture/H264Encoder.cs` (MF HW + OpenH264 fallback), wire a video
   track in `Session/*`, add relative-mouse injection in the input path; unit tests
   in `VideoPipelineTests` / `ControlAndInputTests`.
3. Web client: `ontrack` → `<video>`; Game-mode Pointer Lock + `mouse-move-rel`;
   negotiate H.264-track vs JPEG fallback.
4. Keep the AES-relay fallback on JPEG (no media track over the WS relay).

## Can't be done from the cloud Linux sandbox
No .NET SDK, no Windows, no GPU here, so the agent (the core of A and B) cannot be
compiled, hardware-tested, or `dotnet test`'d. This is security-sensitive code that
runs on the user's PC, so it must be built and tested in a Windows + .NET 8 + GPU
session (`dotnet test remote/agent`, then `remote/agent/publish.ps1`), not pushed
blind. The browser halves (ontrack `<video>`, Pointer-Lock game mode, protocol.js)
can be built and unit-tested in a cloud session and are forward-compatible (the
agent ignores unknown control messages and simply never offers a video track yet).
