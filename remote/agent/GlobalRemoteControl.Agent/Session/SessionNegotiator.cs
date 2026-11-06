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
    }

    private readonly ISignalSender _signal;
    private readonly DeviceIdentity _identity;
    private readonly TrustedControllerStore _store;
    private readonly SessionGate _gate;
    private readonly IUserPrompts _prompts;
    private readonly AuditLog _audit;
    private readonly Func<SessionInfo, string, IRemotePeer> _peerFactory;
    private readonly object _lock = new();
    private Pending? _p;

    public SessionNegotiator(ISignalSender signal, DeviceIdentity identity, TrustedControllerStore store, SessionGate gate,
        IUserPrompts prompts, AuditLog audit, Func<SessionInfo, string, IRemotePeer> peerFactory)
    {
        _signal = signal; _identity = identity; _store = store; _gate = gate;
        _prompts = prompts; _audit = audit; _peerFactory = peerFactory;
        _gate.Ended += OnGateEnded;
    }

    public IRemotePeer? ActivePeer { get { lock (_lock) return _p?.Peer; } }

    public Task HandleAsync(string type, JsonElement m) => type switch
    {
        "session-request" => OnRequestAsync(m),
        "session-auth" => OnAuthAsync(m),
        "signal" => OnSignalAsync(m),
        "session-end" => OnEndAsync(m),
        _ => Task.CompletedTask,
    };

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
        try { decision = await _prompts.ApproveSessionAsync(p.Controller.Name, p.Controller.Fingerprint, null, true, ApprovalTimeout, p.Cancel.Token); }
        catch (Exception) { decision = ApprovalResult.Deny; }

        lock (_lock) if (_p != p) return; // ended meanwhile (peer disconnected / kill)
        if (decision is ApprovalResult.Deny or ApprovalResult.Timeout)
        {
            var reason = decision == ApprovalResult.Timeout ? "timeout" : "denied";
            _audit.Write("session-" + reason, p.Controller.Name, p.Controller.Id);
            await RejectAsync(p, reason);
            return;
        }
        var mode = decision == ApprovalResult.Control ? SessionMode.Control : SessionMode.View;
        if (!_gate.Activate(p.SessionId, SessionKind.Browser, p.Controller.Name, p.Controller.Id, mode))
        {
            await RejectAsync(p, "denied"); // kill switch pressed while the dialog was open
            return;
        }
        lock (_lock) p.Stage = Stage.AwaitOffer;
        p.Timeout = new CancellationTokenSource();
        ArmTimeout(p, StepTimeout, "no-offer");
        _audit.Write("session-approved", p.Controller.Name, p.Controller.Id, mode == SessionMode.Control ? "full control" : "view only");
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
        if (!IdentityUtil.Verify(p.Controller.PublicKey, IdentityUtil.OfferString(p.SessionId, sdp), Json.Str(m, "signature", 100)))
        {
            _audit.Write("session-ended", p.Controller.Name, p.Controller.Id, "offer signature invalid");
            EndLocal(p, "bad-signature", notifyPeer: true);
            return;
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
                signature = _identity.Sign(IdentityUtil.AnswerString(p.SessionId, answer)),
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
