using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Signaling;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Session;

/// <summary>What the negotiator needs from a WebRTC session (RemoteSession in the app, a fake in tests).</summary>
public interface IRemotePeer : IDisposable
{
    Task<string> AcceptOfferAsync(string offerSdp);
    void AddRemoteCandidate(string candidate, string? sdpMid, ushort sdpMLineIndex);
    /// <summary>Raised with (candidate, sdpMid, sdpMLineIndex) for trickle ICE.</summary>
    event Action<string, string?, ushort>? LocalCandidate;
    event Action<string>? Closed;
    /// <summary>Relay fallback (section 7): drop WebRTC and send everything through <paramref name="relay"/>.
    /// Must complete synchronously; frames that follow are delivered through <see cref="OnRelayMessage"/>.</summary>
    void SwitchToRelay(ISessionTransport relay);
    /// <summary>One decrypted, in-order relay message from the controller.</summary>
    void OnRelayMessage(RelayChannel channel, byte[] payload);
}

/// <summary>
/// Device side of PROTOCOL.md section 4: challenge → verify the controller's signature with the key stored at
/// pairing → local approval → verify the signed offer → signed answer → trickle ICE.
/// </summary>
public sealed class SessionNegotiator
{
    public static readonly TimeSpan ApprovalTimeout = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan StepTimeout = TimeSpan.FromSeconds(30);

    private enum Stage { AwaitAuth, AwaitApproval, AwaitOffer, Connected }

    private sealed class Pending
    {
        public required string SessionId;
        public required TrustedController Controller;
        public required string Nonce;
        public Stage Stage;
        public IRemotePeer? Peer;
        public readonly List<(string, string?, ushort)> EarlyCandidates = new();
        public CancellationTokenSource Timeout = new();
        /// <summary>Cancelled when this request goes away, so an open approval dialog closes itself.</summary>
        public readonly CancellationTokenSource Cancel = new();
        /// <summary>Our ephemeral ECDH key and the controller's (from the verified offer); they key the relay.</summary>
        public EphemeralEcdh? Ecdh;
        public string? PeerEcdh;
        public RelayCodec? RelayCodec;
        public RelayTransport? Relay;
    }

    private readonly ISignalSender _signal;
    private readonly DeviceIdentity _identity;
    private readonly TrustedControllerStore _store;
    private readonly SessionGate _gate;
    private readonly IUserPrompts _prompts;
    private readonly AuditLog _audit;
    private readonly Func<SessionInfo, string, IRemotePeer> _peerFactory;
    private readonly OwnerApprovals? _approvals;
    private readonly object _lock = new();
    private Pending? _p;

    public SessionNegotiator(ISignalSender signal, DeviceIdentity identity, TrustedControllerStore store, SessionGate gate,
        IUserPrompts prompts, AuditLog audit, Func<SessionInfo, string, IRemotePeer> peerFactory, OwnerApprovals? approvals = null)
    {
        _signal = signal; _identity = identity; _store = store; _gate = gate;
        _prompts = prompts; _audit = audit; _peerFactory = peerFactory; _approvals = approvals;
        _gate.Ended += OnGateEnded;
    }

    public IRemotePeer? ActivePeer { get { lock (_lock) return _p?.Peer; } }

    public Task HandleAsync(string type, JsonElement m) => type switch
    {
        "session-request" => OnRequestAsync(m),
        "session-auth" => OnAuthAsync(m),
        "signal" => OnSignalAsync(m),
        "session-end" => OnEndAsync(m),
        "relay-start" => OnRelayStart(m),
        _ => Task.CompletedTask,
    };

    /// <summary>True while the active session runs over the encrypted relay.</summary>
    public bool IsRelayed { get { lock (_lock) return _p?.Relay != null; } }

    /// <summary>
    /// relay-start from the controller (PROTOCOL.md section 7). Honoured only for the active, accepted session whose
    /// signed offer/answer (and so the ECDH keys) went through. Fully synchronous: when this returns, the peer is
    /// switched and binary frames read next from the WebSocket go to <see cref="OnRelayFrame"/>.
    /// </summary>
    private Task OnRelayStart(JsonElement m)
    {
        var sid = Json.Str(m, "sessionId", 22);
        Pending? p;
        IRemotePeer? peer;
        lock (_lock)
        {
            p = _p;
            if (p == null || p.SessionId != sid || p.Stage != Stage.Connected || p.Relay != null) return Task.CompletedTask;
            peer = p.Peer;
            if (peer == null || p.Ecdh == null || p.PeerEcdh == null) return Task.CompletedTask;
        }
        var info = _gate.Active;
        if (info == null || info.Key != p.SessionId) return Task.CompletedTask;
        RelayCodec codec;
        try
        {
            var z = p.Ecdh.DeriveSharedSecret(p.PeerEcdh);
            try { codec = RelayCodec.ForDevice(p.SessionId, z); }
            finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(z); }
        }
        catch (Exception ex)
        {
            _audit.Write("session-failed", p.Controller.Name, p.Controller.Id, "relay keys: " + ex.Message);
            EndLocal(p, "relay-failed", notifyPeer: true);
            return Task.CompletedTask;
        }
        var transport = new RelayTransport(codec, _signal.SendBinaryAsync)
        {
            Log = msg => _audit.Write("relay-error", p.Controller.Name, p.Controller.Id, msg),
        };
        lock (_lock)
        {
            if (_p != p || p.Relay != null) { transport.Dispose(); codec.Dispose(); return Task.CompletedTask; }
            p.RelayCodec = codec;
            p.Relay = transport;
        }
        _audit.Write("session-relayed", p.Controller.Name, p.Controller.Id, "WebRTC failed; using the encrypted relay");
        try { peer.SwitchToRelay(transport); }
        catch (Exception ex)
        {
            _audit.Write("session-failed", p.Controller.Name, p.Controller.Id, "relay switch: " + ex.Message);
            EndLocal(p, "relay-failed", notifyPeer: true);
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// A binary WebSocket frame (call in arrival order, on the receive loop). Dropped unless the active session is in
    /// relay mode and it decrypts with a fresh counter; otherwise routed to the peer synchronously.
    /// </summary>
    public void OnRelayFrame(byte[] frame)
    {
        RelayCodec? codec;
        IRemotePeer? peer;
        lock (_lock) { codec = _p?.RelayCodec; peer = _p?.Peer; }
        if (codec == null || peer == null) return;
        bool ok;
        byte channel; byte[] payload;
        try { ok = codec.TryDecrypt(frame, out channel, out payload); }
        catch (ObjectDisposedException) { return; }
        if (!ok || channel > (byte)RelayChannel.File) return;
        peer.OnRelayMessage((RelayChannel)channel, payload);
    }

    private async Task OnRequestAsync(JsonElement m)
    {
        var sid = Json.Str(m, "sessionId", 22);
        if (!Json.IsId(sid)) return;
        var c = Json.Obj(m, "controller");
        var cid = c == null ? null : Json.Str(c.Value, "id", 22);
        var trusted = _store.Get(cid);
        if (trusted == null)
        {
            _audit.Write("session-rejected", c == null ? null : Json.Str(c.Value, "name", 64), cid, "not-paired");
            await _signal.SendAsync(new { type = "session-reject", sessionId = sid, reason = "not-paired" });
            return;
        }
        if (!_gate.TryReserve(sid!))
        {
            _audit.Write("session-rejected", trusted.Name, trusted.Id, "busy");
            await _signal.SendAsync(new { type = "session-reject", sessionId = sid, reason = "busy" });
            return;
        }
        var p = new Pending { SessionId = sid!, Controller = trusted, Nonce = IdentityUtil.RandomNonce(), Stage = Stage.AwaitAuth };
        lock (_lock) _p = p;
        ArmTimeout(p, StepTimeout, "timeout");
        _audit.Write("session-request", trusted.Name, trusted.Id, sid);
        await _signal.SendAsync(new { type = "session-challenge", sessionId = sid, nonce = p.Nonce });
    }

    private async Task OnAuthAsync(JsonElement m)
    {
        var sid = Json.Str(m, "sessionId", 22);
        Pending? p;
        lock (_lock)
        {
            p = _p;
            if (p == null || p.SessionId != sid || p.Stage != Stage.AwaitAuth) return;
            p.Stage = Stage.AwaitApproval;
        }
        p.Timeout.Cancel();
        var sig = Json.Str(m, "signature", 100);
        var data = IdentityUtil.SessionAuthString(p.SessionId, p.Nonce, _identity.DeviceId);
        if (!IdentityUtil.Verify(p.Controller.PublicKey, data, sig))
        {
            _audit.Write("session-rejected", p.Controller.Name, p.Controller.Id, "bad-signature");
            await RejectAsync(p, "bad-signature");
            return;
        }

        ApprovalResult decision;
        string how = "approved at the PC";
        var c = p.Controller;
        if (c.Owner && _store.Get(c.Id)?.Owner == true)
        {
            decision = ApprovalResult.Control; // "my device" (PROTOCOL section 8): no dialog
            how = "my device: no approval needed";
        }
        else if (c.Temporary && _store.TryUseOnce(c.Id))
        {
            decision = ApprovalResult.Control; // the single session of an "Allow once"
            how = "allowed once from a my-device";
        }
        else
        {
            try
            {
                if (_approvals == null)
                    decision = await _prompts.ApproveSessionAsync(c.Name, c.Fingerprint, null, true, ApprovalTimeout, p.Cancel.Token);
                else
                {
                    var (local, remote) = await _approvals.RaceAsync(
                        t => _prompts.ApproveSessionAsync(c.Name, c.Fingerprint, null, true, ApprovalTimeout, t),
                        "session", c.Id, c.Name, c.Fingerprint, ApprovalTimeout, p.Cancel.Token);
                    decision = remote switch
                    {
                        null => local,
                        "control" => ApprovalResult.Control,
                        "view" => ApprovalResult.View,
                        _ => ApprovalResult.Deny,
                    };
                    if (remote != null) how = "approved from a my-device";
                }
            }
            catch (Exception) { decision = ApprovalResult.Deny; }
        }

        lock (_lock) if (_p != p) return; // ended meanwhile (peer disconnected / kill)
        if (decision is ApprovalResult.Deny or ApprovalResult.Timeout)
        {
            var reason = decision == ApprovalResult.Timeout ? "timeout" : "denied";
            _audit.Write("session-" + reason, p.Controller.Name, p.Controller.Id);
            await RejectAsync(p, reason);
            return;
        }
        var mode = decision == ApprovalResult.Control ? SessionMode.Control : SessionMode.View;
        if (!_gate.Activate(p.SessionId, SessionKind.Browser, p.Controller.Name, p.Controller.Id, mode, owner: c.Owner))
        {
            await RejectAsync(p, "denied"); // kill switch pressed while the dialog was open
            return;
        }
        lock (_lock) p.Stage = Stage.AwaitOffer;
        p.Timeout = new CancellationTokenSource();
        ArmTimeout(p, StepTimeout, "no-offer");
        _audit.Write(how.StartsWith("approved", StringComparison.Ordinal) ? "session-approved" : "session-auto-approved",
            p.Controller.Name, p.Controller.Id, (mode == SessionMode.Control ? "full control" : "view only") + ", " + how);
        await _signal.SendAsync(new { type = "session-accept", sessionId = p.SessionId, mode = mode == SessionMode.Control ? "control" : "view" });
    }

    private async Task OnSignalAsync(JsonElement m)
    {
        var sid = Json.Str(m, "sessionId", 22);
        Pending? p;
        lock (_lock) { p = _p; if (p == null || p.SessionId != sid) return; }

        if (Json.Obj(m, "candidate") is { } cand)
        {
            var c = Json.Str(cand, "candidate", 4096);
            if (c == null) return;
            var mid = Json.Str(cand, "sdpMid", 64);
            var idx = (ushort)Math.Clamp(Json.Int(cand, "sdpMLineIndex") ?? 0, 0, 64);
            IRemotePeer? peer;
            lock (_lock)
            {
                peer = p.Peer;
                if (peer == null) { if (p.EarlyCandidates.Count < 50) p.EarlyCandidates.Add((c, mid, idx)); return; }
            }
            peer.AddRemoteCandidate(c, mid, idx);
            return;
        }

        var sdpObj = Json.Obj(m, "sdp");
        if (sdpObj == null || Json.Str(sdpObj.Value, "type", 16) != "offer") return;
        var sdp = Json.Str(sdpObj.Value, "sdp", 60000, 1);
        lock (_lock)
        {
            if (p.Stage != Stage.AwaitOffer || sdp == null) return;
            p.Stage = Stage.Connected;
        }
        p.Timeout.Cancel();
        // the ecdh key is covered by the controller's signature, so the server can't swap it (relay MITM)
        var peerEcdh = Json.Str(m, "ecdh", 200, 1);
        if (peerEcdh == null || !EphemeralEcdh.IsValidPeerKey(peerEcdh) ||
            !IdentityUtil.Verify(p.Controller.PublicKey, IdentityUtil.OfferString(p.SessionId, peerEcdh, sdp), Json.Str(m, "signature", 100)))
        {
            _audit.Write("session-ended", p.Controller.Name, p.Controller.Id,
                peerEcdh == null ? "offer without ecdh key" : "offer signature invalid");
            EndLocal(p, "bad-signature", notifyPeer: true);
            return;
        }
        var ecdh = new EphemeralEcdh();
        lock (_lock)
        {
            if (_p != p) { ecdh.Dispose(); return; }
            p.Ecdh = ecdh; p.PeerEcdh = peerEcdh;
        }
        var info = _gate.Active;
        if (info == null || info.Key != p.SessionId) { EndLocal(p, "ended", true); return; }
        try
        {
            var peer = _peerFactory(info, p.Controller.Fingerprint);
            peer.LocalCandidate += (c, mid, idx) => _ = _signal.SendAsync(new
            {
                type = "signal", sessionId = p.SessionId, candidate = new { candidate = c, sdpMid = mid, sdpMLineIndex = idx },
            });
            peer.Closed += reason => EndLocal(p, reason, notifyPeer: true);
            List<(string, string?, ushort)> early;
            lock (_lock) { p.Peer = peer; early = p.EarlyCandidates.ToList(); p.EarlyCandidates.Clear(); }
            var answer = await peer.AcceptOfferAsync(sdp);
            foreach (var (c, mid, idx) in early) peer.AddRemoteCandidate(c, mid, idx);
            await _signal.SendAsync(new
            {
                type = "signal", sessionId = p.SessionId,
                sdp = new { type = "answer", sdp = answer },
                ecdh = ecdh.SpkiBase64,
                signature = _identity.Sign(IdentityUtil.AnswerString(p.SessionId, ecdh.SpkiBase64, answer)),
            });
        }
        catch (Exception ex)
        {
            _audit.Write("session-failed", p.Controller.Name, p.Controller.Id, ex.Message);
            EndLocal(p, "webrtc-failed", notifyPeer: true);
        }
    }

    private Task OnEndAsync(JsonElement m)
    {
        var sid = Json.Str(m, "sessionId", 22);
        Pending? p;
        lock (_lock) { p = _p; if (p == null || p.SessionId != sid) return Task.CompletedTask; }
        _audit.Write("session-ended", p.Controller.Name, p.Controller.Id, "by controller: " + (Json.Str(m, "reason", 64) ?? "ended"));
        EndLocal(p, "remote-ended", notifyPeer: false);
        return Task.CompletedTask;
    }

    /// <summary>Signaling connection lost: tear down any session (the server can no longer relay).</summary>
    public void OnDisconnected()
    {
        Pending? p;
        lock (_lock) p = _p;
        if (p != null) EndLocal(p, "signaling-lost", notifyPeer: false);
    }

    /// <summary>
    /// Kill switch: also drops a request that is still waiting for approval (a reservation alone does not raise
    /// <see cref="SessionGate.Ended"/>), which closes its dialog.
    /// </summary>
    public void AbortPending(string reason)
    {
        Pending? p;
        lock (_lock) p = _p;
        if (p == null) return;
        _audit.Write("session-ended", p.Controller.Name, p.Controller.Id, reason);
        EndLocal(p, reason, notifyPeer: true);
    }

    private void OnGateEnded(SessionInfo info, string reason)
    {
        Pending? p;
        lock (_lock) p = _p;
        if (p != null && p.SessionId == info.Key) EndLocal(p, reason, notifyPeer: true);
    }

    private Task RejectAsync(Pending p, string reason)
    {
        lock (_lock) { if (_p == p) _p = null; }
        CancelQuietly(p.Cancel);
        _gate.CancelReservation(p.SessionId);
        return _signal.SendAsync(new { type = "session-reject", sessionId = p.SessionId, reason });
    }

    private void EndLocal(Pending p, string reason, bool notifyPeer)
    {
        lock (_lock)
        {
            if (_p != p) return;
            _p = null;
        }
        p.Timeout.Cancel();
        CancelQuietly(p.Cancel);
        try { p.Peer?.Dispose(); } catch (Exception) { }
        p.Relay?.Dispose();
        p.RelayCodec?.Dispose();
        p.Ecdh?.Dispose();
        _gate.End(p.SessionId, reason); // no-op if already ended (kill path)
        if (notifyPeer) _ = _signal.SendAsync(new { type = "session-end", sessionId = p.SessionId, reason });
    }

    private static void CancelQuietly(CancellationTokenSource cts)
    {
        try { cts.Cancel(); } catch (Exception) { /* a dialog's cancel callback must never break teardown */ }
    }

    private void ArmTimeout(Pending p, TimeSpan after, string reason)
    {
        var token = p.Timeout.Token;
        _ = Task.Delay(after, token).ContinueWith(t =>
        {
            if (t.IsCanceled) return;
            Stage stage;
            lock (_lock) { if (_p != p) return; stage = p.Stage; }
            if (stage == Stage.AwaitAuth) _ = RejectAsync(p, reason);
            else EndLocal(p, reason, notifyPeer: true);
        }, TaskScheduler.Default);
    }
}
