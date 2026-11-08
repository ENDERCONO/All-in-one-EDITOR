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

## Status (2026-11-08)
Done, tested:
- PROTOCOL: 5.1 GPU video track via agent-initiated, signed renegotiation (`grc-reoffer` / `grc-reanswer`,
  increasing `seq`); `mouse-move-rel`; `hello.video` / `hello.relMouse` capabilities.
- Server: relays renegotiation only after `session-accept`, never during the relay fallback, only agent-offer /
  controller-answer, `seq` 1..1e6. Test in `server/test/remote-server.test.js` (34/34 pass).
- Web: verifies the re-offer (bad signature ends the session; replayed / older `seq` ignored), answers, paints the
  hardware-decoded track onto the existing canvas (zoom / touch / input mapping unchanged), JPEG painting pauses
  while the track plays and resumes with a keyframe if it stops; GPU badge + stats. Game mode button (only when the
  PC sends `relMouse`): Pointer Lock with raw (`unadjustedMovement`) deltas → `mouse-move-rel`, coalesced per frame,
  buttons sent without absolute coordinates. Unit tests in `web/test/protocol.test.mjs`; browser end-to-end test
  `web/test/gpu-track.e2e.mjs` (real Chromium, fake agent that signs like the real one).
- Agent: `mouse-move-rel` parsed (clamped ±2000), gated like all input (refused with no session / view mode / after
  the kill switch — covered by the existing security tests), injected with `SendInput` `MOUSEEVENTF_MOVE` (no
  ABSOLUTE); `hello` sends `relMouse:true`. Tests in `ControlAndInputTests.cs`.

- Agent GPU video (5.1): `Capture/MfH264Encoder.cs` (Media Foundation: hardware MFT first, async event pump,
  then the software MFT; ICodecAPI low latency / CBR / bitrate / forced IDR; self-test before use, probed once in
  the background at startup), `Capture/H264Streamer.cs` (paced capture → box scale → BGRA→NV12 → encode →
  `RTCPeerConnection.SendVideo`, bitrate from quality × size × fps, idle refresh, IDR on request / RTCP PLI·FIR /
  every 5 s, falls back after 3 failures). `RemoteSession` announces `video:"h264"` only when an encoder works,
  renegotiates on `{t:"video-track",enabled:true}` (signed re-offer, 15 s answer timeout), pauses the JPEG streamer
  while the track plays and resumes it with a keyframe on disable / failure / relay switch.
  Tests: `SessionTests.cs` (re-offer signature + seq, bad / swapped answer ends the session, stale seq ignored,
  timeout, relay, ended session), `H264Tests.cs` (NV12 colours, Annex-B parsing, sizes / bitrate, streamer with a
  fake encoder, fallback, JPEG pause, a real SIPSorcery WebRTC loopback where the H.264 RTP reaches the "browser"
  and switching back to JPEG works, plus the real Media Foundation encoder on Windows CI).
- Web: asks for the track when `hello.video` is `h264` and the new Stream setting **GPU video (H.264)** is on
  (default); turning it off goes back to JPEG.

Not verified here: a real GPU encoder (the CI runner has no GPU, so it exercises the software MFT); real-network
latency and bitrate tuning. If the GPU encoder misbehaves on a PC, turn off **GPU video** in Stream settings.
