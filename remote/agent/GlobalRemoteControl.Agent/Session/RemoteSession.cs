using System.Text;
using GlobalRemoteControl.Agent.Audio;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.FileTransfer;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Signaling;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace GlobalRemoteControl.Agent.Session;

/// <summary>Services a session needs from the host (real ones in the app, fakes in tests).</summary>
public sealed class SessionServices
{
    public required Func<IReadOnlyList<MonitorInfo>> Monitors { get; init; }
    public required Func<IScreenCapturer> CreateCapturer { get; init; }
    public required IInputSink InputSink { get; init; }
    public required Func<System.Drawing.Rectangle> VirtualScreen { get; init; }
    public required Func<bool> AudioAvailable { get; init; }
    public required IUserPrompts Prompts { get; init; }
    public required AuditLog Audit { get; init; }
    /// <summary>H.264 encoders for the GPU video track (PROTOCOL 5.1); null = JPEG only.</summary>
    public IH264EncoderFactory? H264 { get; init; }
    /// <summary>Where uploads from a "my device" land without a dialog (PROTOCOL section 8).</summary>
    public string FileInbox { get; init; } = FileTransferManager.DefaultInbox;
}

/// <summary>
/// The WebRTC side of one approved browser session (PROTOCOL.md section 5). Answerer: the controller created the
/// four data channels. Input is injected only while the <see cref="SessionGate"/> says this session is active in
/// control mode.
/// </summary>
public sealed class RemoteSession : IRemotePeer
{
    private readonly string _key;
    private readonly SessionInfo _info;
    private readonly string _fingerprint;
    private readonly SessionGate _gate;
    private readonly SessionServices _svc;
    private readonly RTCPeerConnection _pc;
    private readonly InputController _input;
    private readonly FileTransferManager _files;
    private readonly object _lock = new();
    private RTCDataChannel? _control, _video, _audio, _file;
    private VideoStreamer? _streamer;
    private IScreenCapturer? _capturer;
    private LoopbackAudio? _loopback;
    private int _monitorIndex;
    private int _disposed;
    /// <summary>Where everything is sent: the data channels until <see cref="SwitchToRelay"/>, then the relay.</summary>
    private volatile ISessionTransport _transport;
    private volatile bool _relayed;
    private System.Threading.Timer? _failGrace;
    // PROTOCOL 5.1 GPU video track
    private readonly SemaphoreSlim _videoSwitch = new(1, 1);
    private MediaStreamTrack? _videoTrack;
    private bool _videoTrackFailed;
    private H264Streamer? _h264;
    private RtpVideoSender? _rtp; // paced RTP + NACK resends for the track (one per track: keeps the sequence going)
    public const int H264PayloadType = 96;
    private (int Fps, int Quality, double Scale, bool Cursor) _quality = (30, 70, 1, true);

    /// <summary>H.264 offer: packetization-mode=1 must be explicit or browsers answer mode 0, which SIPSorcery can't send.</summary>
    public const string H264Fmtp = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f";

    /// <summary>
    /// If WebRTC fails before the channels ever opened, the controller is expected to fall back to the relay
    /// (PROTOCOL.md section 7), so the session is only closed if no relay-start arrives within this time.
    /// </summary>
    public static TimeSpan RelayGrace { get; set; } = TimeSpan.FromSeconds(20);

    public event Action<string, string?, ushort>? LocalCandidate;
    public event Action<string>? Closed;

    public RemoteSession(SessionInfo info, string fingerprint, IReadOnlyList<IceServerConfig> iceServers, SessionGate gate, SessionServices svc)
    {
        _info = info;
        _key = info.Key;
        _fingerprint = fingerprint;
        _gate = gate;
        _svc = svc;
        var monitors = svc.Monitors();
        _monitorIndex = Monitors.PrimaryIndex(monitors);

        var config = new RTCConfiguration { iceServers = new List<RTCIceServer>() };
        foreach (var s in iceServers)
            foreach (var url in s.Urls)
                config.iceServers.Add(new RTCIceServer { urls = url, username = s.Username, credential = s.Credential });
        _pc = new RTCPeerConnection(config);
        _pc.onicecandidate += c =>
        {
            if (c == null || string.IsNullOrEmpty(c.candidate)) return;
            var text = c.candidate.StartsWith("candidate:", StringComparison.Ordinal) ? c.candidate : "candidate:" + c.candidate;
            LocalCandidate?.Invoke(text, c.sdpMid ?? "0", c.sdpMLineIndex);
        };
        _pc.onconnectionstatechange += state =>
        {
            if (_relayed || state is not (RTCPeerConnectionState.failed or RTCPeerConnectionState.closed)) return;
            bool opened;
            lock (_lock) opened = _streamer != null;
            if (opened) { Closed?.Invoke("connection-" + state); return; }
            // never connected: give the controller time to switch to the relay
            lock (_lock) _failGrace ??= new System.Threading.Timer(_ =>
            {
                if (!_relayed && _disposed == 0) Closed?.Invoke("connection-" + state);
            }, null, RelayGrace, Timeout.InfiniteTimeSpan);
        };
        _pc.ondatachannel += OnDataChannel;
        _pc.OnReceiveReport += (_, media, report) =>
        {
            // RTCP picture loss / full intra request from the browser's decoder → send an IDR
            if (media != SDPMediaTypesEnum.video || report?.Feedback == null) return;
            var fb = report.Feedback;
            if (fb.Header.PacketType == RTCPReportTypesEnum.RTPFB && fb.Header.FeedbackMessageType == RTCPFeedbackTypesEnum.NACK)
                _rtp?.OnNack(fb.PID, fb.BLP); // lost packets: resend them (ahead of new video)
            else if (fb.Header.PayloadFeedbackMessageType is PSFBFeedbackTypesEnum.PLI or PSFBFeedbackTypesEnum.FIR)
                _h264?.RequestKeyframe();
        };
        _transport = new DataChannelTransport(this);

        _input = new InputController(svc.InputSink, () => _gate.IsInputAllowed(_key), CurrentMonitorBounds, svc.VirtualScreen)
        {
            Log = m => svc.Audit.Write("input-dropped", info.ControllerName, info.ControllerId, m),
        };
        _files = new FileTransferManager(info.ControllerName, info.ControllerId, fingerprint, info.Mode == SessionMode.View,
            SendControl, d => _transport.Send(RelayChannel.File, d), () => _transport.Buffered(RelayChannel.File), svc.Prompts, svc.Audit,
            autoAcceptDir: info.Owner ? svc.FileInbox : null);
    }

    public bool IsRelayed => _relayed;

    /// <summary>Set by the negotiator: sends a signed re-offer and returns the verified answer (null = none / refused).</summary>
    public Func<string, Task<string?>>? Renegotiate { get; set; }

    /// <summary>True while the picture goes over the H.264 track instead of the JPEG channel.</summary>
    public bool H264Active { get { lock (_lock) return _h264 != null; } }
    public H264Streamer? H264Streamer { get { lock (_lock) return _h264; } }
    private bool H264Possible => _svc.H264?.Available == true && !_relayed && !_videoTrackFailed;

    public SessionInfo Info => _info;
    public FileTransferManager Files => _files;

    /// <summary>Applies the (already signature-verified) offer and returns the answer SDP.</summary>
    public async Task<string> AcceptOfferAsync(string offerSdp)
    {
        var res = _pc.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.offer, sdp = offerSdp });
        if (res != SetDescriptionResultEnum.OK) throw new InvalidOperationException("Bad offer: " + res);
        var answer = _pc.createAnswer(null);
        await _pc.setLocalDescription(answer);
        return answer.sdp;
    }

    public void AddRemoteCandidate(string candidate, string? sdpMid, ushort sdpMLineIndex)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return; // end-of-candidates
        try { _pc.addIceCandidate(new RTCIceCandidateInit { candidate = candidate, sdpMid = sdpMid, sdpMLineIndex = sdpMLineIndex }); }
        catch (Exception) { /* unparseable candidate (e.g. mDNS): ignore */ }
    }

    private System.Drawing.Rectangle CurrentMonitorBounds()
    {
        var m = _svc.Monitors();
        return m.Count == 0 ? System.Drawing.Rectangle.Empty : m[Math.Min(_monitorIndex, m.Count - 1)].Bounds;
    }

    private void OnDataChannel(RTCDataChannel dc)
    {
        lock (_lock)
        {
            switch (dc.label)
            {
                case "control":
                    _control = dc;
                    dc.onmessage += (_, proto, data) => OnControlMessage(proto, data);
                    break;
                case "video": _video = dc; break;
                case "audio": _audio = dc; break;
                case "file":
                    _file = dc;
                    dc.onmessage += (_, proto, data) => { if (IsBinary(proto)) _files.OnChunk(data); };
                    break;
                default:
                    dc.close();
                    return;
            }
        }
        dc.onclose += () => { if (!_relayed && dc.label is "control" or "video") Closed?.Invoke("channel-closed"); };
        if (dc.readyState == RTCDataChannelState.open) OnChannelOpen();
        else dc.onopen += OnChannelOpen;
    }

    private static bool IsBinary(DataChannelPayloadProtocols p) =>
        p is DataChannelPayloadProtocols.WebRTC_Binary or DataChannelPayloadProtocols.WebRTC_Binary_Empty;

    private void OnChannelOpen()
    {
        lock (_lock)
        {
            if (_disposed != 0 || _streamer != null || _relayed) return;
            if (_control?.readyState != RTCDataChannelState.open || _video?.readyState != RTCDataChannelState.open) return;
            StartStreamingLocked();
        }
        _svc.Audit.Write("session-connected", _info.ControllerName, _info.ControllerId, _info.ModeText);
    }

    /// <summary>
    /// relay-start (PROTOCOL.md section 7): runs synchronously on the signaling receive loop, so binary frames that
    /// follow are already routed here. Closes the peer connection (without raising <see cref="Closed"/>) and carries
    /// all four channels over <paramref name="relay"/>; hello and video (re)start on the relay.
    /// </summary>
    public void SwitchToRelay(ISessionTransport relay)
    {
        VideoStreamer? old;
        H264Streamer? oldH264;
        lock (_lock)
        {
            if (_disposed != 0 || _relayed) return;
            _relayed = true;
            _failGrace?.Dispose();
            _transport = relay;
            old = _streamer;
            _streamer = null;
            oldH264 = _h264; // the relay can't carry RTP: back to JPEG
            _h264 = null;
        }
        try { oldH264?.Dispose(); } catch (Exception) { }
        try { _pc.close(); } catch (Exception) { }
        try { old?.Dispose(); } catch (Exception) { } // its ack window refers to frames sent on the dead channel
        lock (_lock)
        {
            if (_disposed != 0) return;
            StartStreamingLocked();
        }
        _svc.Audit.Write("session-connected", _info.ControllerName, _info.ControllerId, _info.ModeText + " (relayed)");
    }

    /// <summary>A decrypted relay message from the controller (same content as on the data channel).</summary>
    public void OnRelayMessage(RelayChannel channel, byte[] payload)
    {
        if (_disposed != 0 || !_relayed) return;
        switch (channel)
        {
            case RelayChannel.Control: OnControlMessage(DataChannelPayloadProtocols.WebRTC_String, payload); break;
            case RelayChannel.File: _files.OnChunk(payload); break;
            // the controller never sends video/audio
        }
    }

    private void StartStreamingLocked()
    {
        {
            var monitors = _svc.Monitors();
            var hello = new Dictionary<string, object>
            {
                ["t"] = "hello",
                ["mode"] = _info.Mode == SessionMode.Control ? "control" : "view",
                ["monitors"] = monitors.Select(m => m.ToJson()).ToArray(),
                ["monitor"] = _monitorIndex,
                ["audio"] = _svc.AudioAvailable(),
                ["relMouse"] = true, // game mode: mouse-move-rel is supported (PROTOCOL 5)
            };
            if (H264Possible) hello["video"] = "h264"; // PROTOCOL 5.1
            SendControl(hello);
            _capturer ??= _svc.CreateCapturer();
            var transport = _transport; // a streamer lives on one transport (a relay switch makes a new one)
            _streamer = new VideoStreamer(_capturer, _svc.Monitors, _monitorIndex,
                chunk => transport.Send(RelayChannel.Video, chunk), () => transport.Buffered(RelayChannel.Video), SendControl)
            {
                Log = m => _svc.Audit.Write("video-error", _info.ControllerName, _info.ControllerId, m),
            };
            _streamer.Start();
        }
    }

    private void OnControlMessage(DataChannelPayloadProtocols proto, byte[] data)
    {
        if (_disposed != 0 || IsBinary(proto) || data.Length > Json.MaxMessageBytes) return;
        var msg = ControlMessageParser.Parse(Encoding.UTF8.GetString(data), out var error);
        if (msg == null)
        {
            _svc.Audit.Write("control-ignored", _info.ControllerName, _info.ControllerId, error);
            return;
        }
        Dispatch(msg);
    }

    /// <summary>Routes a validated control message.</summary>
    internal void Dispatch(ControlMessage msg)
    {
        switch (msg)
        {
            case MouseMoveMsg or MouseMoveRelMsg or MouseButtonMsg or WheelMsg or KeyMsg or TextMsg:
                _input.Handle(msg); // gate + view-mode check inside
                break;
            case SelectMonitorMsg s:
                var monitors = _svc.Monitors();
                if (s.Index >= monitors.Count || _streamer == null) break;
                _monitorIndex = s.Index;
                _streamer.SelectMonitor(s.Index);
                H264Streamer?.SelectMonitor(s.Index);
                break;
            case QualityMsg q:
                _quality = (q.Fps, q.Quality, q.Scale, q.Cursor);
                _streamer?.SetQuality(q.Fps, q.Quality, q.Scale, q.Cursor);
                H264Streamer?.SetQuality(q.Fps, q.Quality, q.Scale, q.Cursor);
                break;
            case KeyframeMsg:
                _streamer?.RequestKeyframe();
                H264Streamer?.RequestKeyframe();
                break;
            case VideoTrackMsg v:
                _ = SetVideoTrackAsync(v.Enabled);
                break;
            case AudioMsg a:
                SetAudio(a.Enabled);
                break;
            case AckMsg ack:
                _streamer?.Ack(ack.FrameId);
                break;
            case FileOfferMsg or FileEndMsg or FileCancelMsg or FileAcceptMsg or FileRejectMsg:
                _ = _files.Handle(msg);
                break;
        }
    }

    /// <summary>
    /// PROTOCOL 5.1: switches the picture to the H.264 track (negotiating it the first time) or back to JPEG.
    /// Any failure leaves (or puts) the session on the JPEG channel, which never stopped existing.
    /// </summary>
    internal async Task SetVideoTrackAsync(bool enabled)
    {
        await _videoSwitch.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!enabled) { StopH264("controller asked"); return; }
            lock (_lock) if (_disposed != 0 || _streamer == null || _h264 != null || !H264Possible) return;

            if (_videoTrack == null)
            {
                var renegotiate = Renegotiate;
                if (renegotiate == null) { _videoTrackFailed = true; return; }
                var track = new MediaStreamTrack(new VideoFormat(VideoCodecsEnum.H264, H264PayloadType, 90000, H264Fmtp), MediaStreamStatusEnum.SendOnly);
                _pc.addTrack(track);
                var offer = _pc.createOffer(null);
                offer.sdp = WithVideoFeedback(offer.sdp, H264PayloadType); // NACK + PLI/FIR, or the browser never reports loss
                await _pc.setLocalDescription(offer).ConfigureAwait(false);
                var answer = await renegotiate(offer.sdp).ConfigureAwait(false);
                if (answer == null) { VideoTrackFailed("no valid answer to the re-offer"); return; }
                var res = _pc.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = answer });
                if (res != SetDescriptionResultEnum.OK) { VideoTrackFailed("answer rejected: " + res); return; }
                _videoTrack = track;
            }

            lock (_lock)
            {
                if (_disposed != 0 || _relayed || _streamer == null || _capturer == null || _h264 != null) return;
                var q = _quality;
                _streamer.SetPaused(true); // waits for a JPEG frame in progress, so the capturer is free
                var rtp = _rtp ??= new RtpVideoSender((payload, ts, marker, seq) =>
                    _pc.SendRtpRaw(SDPMediaTypesEnum.video, payload, ts, marker ? 1 : 0, H264PayloadType, seq));
                H264Streamer? self = null;
                var h = new H264Streamer(_capturer, _svc.Monitors, _monitorIndex, _svc.H264!,
                    (duration, au) => { rtp.SetBitrate(self?.Bitrate ?? 0); rtp.Send(duration, au); }, SendControl)
                {
                    Log = m => _svc.Audit.Write("video-error", _info.ControllerName, _info.ControllerId, m),
                    Backlog = () => rtp.Backlog,
                };
                self = h;
                h.SetQuality(q.Fps, q.Quality, q.Scale, q.Cursor);
                rtp.Overflow += () => { lock (_lock) _h264?.RequestKeyframe(); };
                h.Failed += reason => Task.Run(() =>
                {
                    _videoTrackFailed = true; // don't try again in this session
                    StopH264("encoder failed: " + reason);
                });
                _h264 = h;
                h.Start();
            }
            _svc.Audit.Write("video-h264", _info.ControllerName, _info.ControllerId, "GPU video track on");
        }
        catch (Exception ex) { VideoTrackFailed(ex.Message); }
        finally { _videoSwitch.Release(); }
    }

    /// <summary>
    /// Adds <c>nack</c>, <c>nack pli</c> and <c>ccm fir</c> RTCP feedback for <paramref name="pt"/> (SIPSorcery only
    /// offers transport-cc). Without them the browser never reports lost packets or asks for a keyframe, and the
    /// picture stays broken until the next periodic IDR.
    /// </summary>
    internal static string WithVideoFeedback(string sdp, int pt)
    {
        var nl = sdp.Contains('\r') ? "\r\n" : "\n";
        var lines = sdp.Split(nl).ToList();
        int at = lines.FindIndex(l => l.StartsWith($"a=rtpmap:{pt} ", StringComparison.Ordinal));
        if (at < 0) return sdp;
        foreach (var fb in new[] { "ccm fir", "nack pli", "nack" })
        {
            var line = $"a=rtcp-fb:{pt} {fb}";
            if (!lines.Contains(line)) lines.Insert(at + 1, line);
        }
        return string.Join(nl, lines);
    }

    private void VideoTrackFailed(string why)
    {
        _videoTrackFailed = true;
        _svc.Audit.Write("video-error", _info.ControllerName, _info.ControllerId, "H.264 track unavailable: " + why);
        StopH264(why);
    }

    /// <summary>Back to the JPEG channel (keyframe first).</summary>
    private void StopH264(string why)
    {
        H264Streamer? h;
        lock (_lock) { h = _h264; _h264 = null; }
        if (h != null)
        {
            try { h.Dispose(); } catch (Exception) { }
            _svc.Audit.Write("video-h264", _info.ControllerName, _info.ControllerId, "GPU video track off: " + why);
        }
        lock (_lock) { if (_disposed == 0) _streamer?.SetPaused(false); }
    }

    private void SetAudio(bool enabled)
    {
        lock (_lock)
        {
            if (_disposed != 0) return;
            if (!enabled) { _loopback?.Stop(); return; }
            if (!_svc.AudioAvailable() || !_transport.HasChannel(RelayChannel.Audio)) return;
            try
            {
                _loopback ??= new LoopbackAudio(p =>
                {
                    var t = _transport;
                    if (t.Buffered(RelayChannel.Audio) < 64 * 1024) t.Send(RelayChannel.Audio, p);
                });
                _loopback.Start();
                _svc.Audit.Write("audio-enabled", _info.ControllerName, _info.ControllerId);
            }
            catch (Exception ex)
            {
                SendControl(new { t = "notice", text = "Audio capture is not available: " + ex.Message });
            }
        }
    }

    public void SendControl(object message) => _transport.SendControl(Json.Serialize(message));

    private static bool SafeSend(RTCDataChannel? dc, byte[] data)
    {
        if (dc == null || dc.readyState != RTCDataChannelState.open) return false;
        try { dc.send(data, 0, data.Length); return true; } catch (Exception) { return false; }
    }

    /// <summary>The WebRTC data channels as an <see cref="ISessionTransport"/> (control goes as text).</summary>
    private sealed class DataChannelTransport : ISessionTransport
    {
        private readonly RemoteSession _s;
        public DataChannelTransport(RemoteSession s) => _s = s;

        private RTCDataChannel? Get(RelayChannel ch) => ch switch
        {
            RelayChannel.Control => _s._control,
            RelayChannel.Video => _s._video,
            RelayChannel.Audio => _s._audio,
            _ => _s._file,
        };

        public bool Send(RelayChannel channel, byte[] payload) => SafeSend(Get(channel), payload);
        public bool SendControl(string json)
        {
            var dc = _s._control;
            if (dc == null || dc.readyState != RTCDataChannelState.open) return false;
            try { dc.send(json); return true; } catch (Exception) { return false; }
        }
        public ulong Buffered(RelayChannel channel) => Get(channel)?.bufferedAmount ?? 0;
        public bool HasChannel(RelayChannel channel) => Get(channel) != null;
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _failGrace?.Dispose();
        _input.ReleaseAll();
        H264Streamer? h;
        lock (_lock) { h = _h264; _h264 = null; }
        try { h?.Dispose(); } catch (Exception) { }
        try { _rtp?.Dispose(); } catch (Exception) { }
        try { _streamer?.Dispose(); } catch (Exception) { }
        try { _loopback?.Dispose(); } catch (Exception) { }
        _files.Dispose();
        try { _capturer?.Dispose(); } catch (Exception) { }
        try { _pc.close(); } catch (Exception) { }
        _input.ReleaseAll(); // anything that raced in while shutting down
    }
}
