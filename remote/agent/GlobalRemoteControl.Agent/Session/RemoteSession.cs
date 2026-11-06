using System.Text;
using GlobalRemoteControl.Agent.Audio;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.FileTransfer;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Signaling;
using SIPSorcery.Net;

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
            if (state is RTCPeerConnectionState.failed or RTCPeerConnectionState.closed) Closed?.Invoke("connection-" + state);
        };
        _pc.ondatachannel += OnDataChannel;

        _input = new InputController(svc.InputSink, () => _gate.IsInputAllowed(_key), CurrentMonitorBounds, svc.VirtualScreen)
        {
            Log = m => svc.Audit.Write("input-dropped", info.ControllerName, info.ControllerId, m),
        };
        _files = new FileTransferManager(info.ControllerName, info.ControllerId, fingerprint, info.Mode == SessionMode.View,
            SendControl, d => SafeSend(_file, d), () => _file?.bufferedAmount ?? 0, svc.Prompts, svc.Audit);
    }

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
        dc.onclose += () => { if (dc.label is "control" or "video") Closed?.Invoke("channel-closed"); };
        if (dc.readyState == RTCDataChannelState.open) OnChannelOpen();
        else dc.onopen += OnChannelOpen;
    }

    private static bool IsBinary(DataChannelPayloadProtocols p) =>
        p is DataChannelPayloadProtocols.WebRTC_Binary or DataChannelPayloadProtocols.WebRTC_Binary_Empty;

    private void OnChannelOpen()
    {
        lock (_lock)
        {
            if (_disposed != 0 || _streamer != null) return;
            if (_control?.readyState != RTCDataChannelState.open || _video?.readyState != RTCDataChannelState.open) return;
            var monitors = _svc.Monitors();
            SendControl(new
            {
                t = "hello",
                mode = _info.Mode == SessionMode.Control ? "control" : "view",
                monitors = monitors.Select(m => m.ToJson()).ToArray(),
                monitor = _monitorIndex,
                audio = _svc.AudioAvailable(),
            });
            _capturer = _svc.CreateCapturer();
            var video = _video;
            _streamer = new VideoStreamer(_capturer, _svc.Monitors, _monitorIndex,
                chunk => SafeSend(video, chunk), () => video.bufferedAmount, SendControl)
            {
                Log = m => _svc.Audit.Write("video-error", _info.ControllerName, _info.ControllerId, m),
            };
            _streamer.Start();
        }
        _svc.Audit.Write("session-connected", _info.ControllerName, _info.ControllerId, _info.ModeText);
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
            case MouseMoveMsg or MouseButtonMsg or WheelMsg or KeyMsg or TextMsg:
                _input.Handle(msg); // gate + view-mode check inside
                break;
            case SelectMonitorMsg s:
                var monitors = _svc.Monitors();
                if (s.Index >= monitors.Count || _streamer == null) break;
                _monitorIndex = s.Index;
                _streamer.SelectMonitor(s.Index);
                break;
            case QualityMsg q:
                _streamer?.SetQuality(q.Fps, q.Quality, q.Scale, q.Cursor);
                break;
            case KeyframeMsg:
                _streamer?.RequestKeyframe();
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

    private void SetAudio(bool enabled)
    {
        lock (_lock)
        {
            if (_disposed != 0) return;
            if (!enabled) { _loopback?.Stop(); return; }
            if (!_svc.AudioAvailable() || _audio == null) return;
            try
            {
                var ch = _audio;
                _loopback ??= new LoopbackAudio(p => { if (ch.bufferedAmount < 64 * 1024) SafeSend(ch, p); });
                _loopback.Start();
                _svc.Audit.Write("audio-enabled", _info.ControllerName, _info.ControllerId);
            }
            catch (Exception ex)
            {
                SendControl(new { t = "notice", text = "Audio capture is not available: " + ex.Message });
            }
        }
    }

    public void SendControl(object message)
    {
        var dc = _control;
        if (dc == null || dc.readyState != RTCDataChannelState.open) return;
        try { dc.send(Json.Serialize(message)); } catch (Exception) { }
    }

    private static void SafeSend(RTCDataChannel? dc, byte[] data)
    {
        if (dc == null || dc.readyState != RTCDataChannelState.open) return;
        try { dc.send(data, 0, data.Length); } catch (Exception) { }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _input.ReleaseAll();
        try { _streamer?.Dispose(); } catch (Exception) { }
        try { _loopback?.Dispose(); } catch (Exception) { }
        _files.Dispose();
        try { _capturer?.Dispose(); } catch (Exception) { }
        try { _pc.close(); } catch (Exception) { }
        _input.ReleaseAll(); // anything that raced in while shutting down
    }
}
