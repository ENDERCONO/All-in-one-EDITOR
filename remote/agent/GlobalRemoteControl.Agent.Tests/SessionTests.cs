using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Tests;

public class SessionGateTests
{
    [Fact]
    public void Reserve_Busy_Cancel()
    {
        var g = new SessionGate();
        Assert.True(g.TryReserve("a"));
        Assert.True(g.IsBusy);
        Assert.False(g.TryReserve("b"));
        g.CancelReservation("a");
        Assert.False(g.IsBusy);
        Assert.True(g.TryReserve("b"));
    }

    [Fact]
    public void Activate_RequiresReservation()
    {
        var g = new SessionGate();
        Assert.False(g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.Control));
        Assert.Null(g.Active);
        Assert.False(g.IsInputAllowed("a"));
        g.TryReserve("a");
        Assert.False(g.Activate("other", SessionKind.Browser, "n", "i", SessionMode.Control));
        Assert.True(g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.Control));
        Assert.True(g.IsInputAllowed("a"));
        Assert.False(g.IsInputAllowed("other"));
        Assert.False(g.TryReserve("b")); // busy while active
    }

    [Fact]
    public void ViewMode_NeverAllowsInput()
    {
        var g = new SessionGate();
        g.TryReserve("a"); g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.View);
        Assert.True(g.IsActive("a"));
        Assert.False(g.IsInputAllowed("a"));
    }

    [Fact]
    public void Kill_EndsSession_BlocksInput_RaisesEnded()
    {
        var g = new SessionGate();
        SessionInfo? ended = null; string? why = null;
        g.Ended += (i, r) => { ended = i; why = r; };
        g.TryReserve("a"); g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.Control);
        g.Kill();
        Assert.Null(g.Active);
        Assert.False(g.IsInputAllowed("a"));
        Assert.Equal("killed", why);
        Assert.Equal("a", ended!.Key);
        Assert.False(g.IsBusy);
    }

    [Fact]
    public void Kill_ClearsPendingReservation_SoApprovalCannotActivate()
    {
        var g = new SessionGate();
        g.TryReserve("a");
        g.Kill();
        Assert.False(g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.Control));
    }

    [Fact]
    public void End_WrongKey_IsNoOp()
    {
        var g = new SessionGate();
        g.TryReserve("a"); g.Activate("a", SessionKind.Browser, "n", "i", SessionMode.Control);
        g.End("b", "x");
        Assert.True(g.IsInputAllowed("a"));
        g.End("a", "stopped");
        Assert.Null(g.Active);
    }
}

public class SessionNegotiatorTests
{
    private sealed class FakePeer : IRemotePeer
    {
        public bool Disposed;
        public string? Offer;
        public List<string> Candidates = new();
        public event Action<string, string?, ushort>? LocalCandidate { add { } remove { } }
        public event Action<string>? Closed { add { } remove { } }
        public Task<string> AcceptOfferAsync(string offerSdp) { Offer = offerSdp; return Task.FromResult("v=0 answer"); }
        public void AddRemoteCandidate(string candidate, string? sdpMid, ushort idx) => Candidates.Add(candidate);
        public void Dispose() => Disposed = true;
    }

    private sealed class Rig : IDisposable
    {
        public TempDir Dir = new();
        public FakeSignal Signal = new();
        public FakePrompts Prompts = new();
        public SessionGate Gate = new();
        public TrustedControllerStore Store;
        public DeviceIdentity Device;
        public TestKey Ctl = new();
        public FakePeer? Peer;
        public int PeerCreated;
        public SessionNegotiator Neg;
        public string Sid = Msg.NewId();

        public Rig(bool paired = true)
        {
            Store = new TrustedControllerStore(Dir.File("t.json"));
            if (paired) Store.Add(Ctl.Id, Ctl.Name, Ctl.PublicKeyB64);
            Device = DeviceIdentity.LoadOrCreate(Dir.File("k.bin"));
            Neg = new SessionNegotiator(Signal, Device, Store, Gate, Prompts, new AuditLog(Dir.File("a.log")),
                (info, fp) => { PeerCreated++; return Peer = new FakePeer(); });
        }

        public Task Request(string? sid = null, string? cid = null) =>
            Neg.HandleAsync("session-request", Msg.Of(new { type = "session-request", sessionId = sid ?? Sid, controller = new { id = cid ?? Ctl.Id, name = Ctl.Name, publicKey = Ctl.PublicKeyB64 } }));

        public string Nonce => Signal.OfType("session-challenge").Last().GetProperty("nonce").GetString()!;

        public Task Auth(string? signature = null, string? sid = null) =>
            Neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = sid ?? Sid, signature = signature ?? Ctl.Sign(IdentityUtil.SessionAuthString(Sid, Nonce, Device.DeviceId)) }));

        public Task Offer(string sdp, string? signature = null) =>
            Neg.HandleAsync("signal", Msg.Of(new { type = "signal", sessionId = Sid, sdp = new { type = "offer", sdp }, signature = signature ?? Ctl.Sign(IdentityUtil.OfferString(Sid, sdp)) }));

        public async Task ApprovedSession(ApprovalResult res = ApprovalResult.Control)
        {
            Prompts.Session = () => Task.FromResult(res);
            await Request(); await Auth();
        }

        public string LastReason(string type = "session-reject") => Signal.OfType(type).Last().GetProperty("reason").GetString()!;
        public void Dispose() { Device.Dispose(); Ctl.Dispose(); Dir.Dispose(); }
    }

    [Fact]
    public async Task UntrustedController_NotPaired_NoChallenge()
    {
        using var r = new Rig(paired: false);
        await r.Request();
        Assert.Equal("not-paired", r.LastReason());
        Assert.Empty(r.Signal.OfType("session-challenge"));
        Assert.False(r.Gate.IsBusy);
        Assert.Equal(0, r.Prompts.SessionCalls);
    }

    [Fact]
    public async Task ServerClaimsPairedIdButKeyUnknown_Rejected()
    {
        using var r = new Rig();
        using var other = new TestKey();
        await r.Request(cid: other.Id);
        Assert.Equal("not-paired", r.LastReason());
    }

    [Fact]
    public async Task MalformedSessionId_Ignored()
    {
        using var r = new Rig();
        await r.Request(sid: "short");
        Assert.Equal(0, r.Signal.Count);
        Assert.False(r.Gate.IsBusy);
    }

    [Fact]
    public async Task Request_SendsChallenge_AndReserves()
    {
        using var r = new Rig();
        await r.Request();
        Assert.Equal(r.Sid, r.Signal.OfType("session-challenge").Single().GetProperty("sessionId").GetString());
        Assert.Equal(32, Convert.FromBase64String(r.Nonce).Length);
        Assert.True(r.Gate.IsBusy);
        Assert.Null(r.Gate.Active);
    }

    [Fact]
    public async Task BadSessionAuthSignature_Rejected_NoPrompt_ReservationReleased()
    {
        using var r = new Rig();
        await r.Request();
        using var attacker = new TestKey();
        await r.Auth(attacker.Sign(IdentityUtil.SessionAuthString(r.Sid, r.Nonce, r.Device.DeviceId)));
        Assert.Equal("bad-signature", r.LastReason());
        Assert.Equal(0, r.Prompts.SessionCalls);
        Assert.False(r.Gate.IsBusy);
    }

    [Theory]
    [InlineData("nonce")]
    [InlineData("device")]
    [InlineData("session")]
    [InlineData("der")]
    [InlineData("missing")]
    public async Task SessionAuth_SignatureOverWrongData_Rejected(string flaw)
    {
        using var r = new Rig();
        await r.Request();
        string data = flaw switch
        {
            "nonce" => IdentityUtil.SessionAuthString(r.Sid, IdentityUtil.RandomNonce(), r.Device.DeviceId),
            "device" => IdentityUtil.SessionAuthString(r.Sid, r.Nonce, Msg.NewId()),
            "session" => IdentityUtil.SessionAuthString(Msg.NewId(), r.Nonce, r.Device.DeviceId),
            _ => IdentityUtil.SessionAuthString(r.Sid, r.Nonce, r.Device.DeviceId),
        };
        string? sig = flaw == "der" ? r.Ctl.SignDer(data) : flaw == "missing" ? "" : r.Ctl.Sign(data);
        await r.Neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = r.Sid, signature = sig }));
        Assert.Equal("bad-signature", r.LastReason());
        Assert.Equal(0, r.Prompts.SessionCalls);
    }

    [Fact]
    public async Task AuthWithoutRequest_Ignored()
    {
        using var r = new Rig();
        await r.Neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = r.Sid, signature = "AAAA" }));
        Assert.Equal(0, r.Signal.Count);
    }

    [Fact]
    public async Task AuthForOtherSessionId_Ignored()
    {
        using var r = new Rig();
        await r.Request();
        await r.Neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = Msg.NewId(), signature = "AAAA" }));
        Assert.Empty(r.Signal.OfType("session-reject"));
        Assert.Equal(0, r.Prompts.SessionCalls);
    }

    [Fact]
    public async Task Approved_Control_Activates_AndAccepts()
    {
        using var r = new Rig();
        await r.ApprovedSession(ApprovalResult.Control);
        Assert.Equal("control", r.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        Assert.True(r.Gate.IsInputAllowed(r.Sid));
    }

    [Fact]
    public async Task Approved_ViewOnly_DoesNotAllowInput()
    {
        using var r = new Rig();
        await r.ApprovedSession(ApprovalResult.View);
        Assert.Equal("view", r.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        Assert.True(r.Gate.IsActive(r.Sid));
        Assert.False(r.Gate.IsInputAllowed(r.Sid));
    }

    [Theory]
    [InlineData(ApprovalResult.Deny, "denied")]
    [InlineData(ApprovalResult.Timeout, "timeout")]
    public async Task ApprovalDeniedOrTimedOut_Rejected(ApprovalResult res, string reason)
    {
        using var r = new Rig();
        await r.ApprovedSession(res);
        Assert.Equal(reason, r.LastReason());
        Assert.Empty(r.Signal.OfType("session-accept"));
        Assert.Null(r.Gate.Active);
        Assert.False(r.Gate.IsBusy);
    }

    [Fact]
    public async Task PromptThrows_TreatedAsDenied()
    {
        using var r = new Rig();
        r.Prompts.Session = () => throw new InvalidOperationException();
        await r.Request(); await r.Auth();
        Assert.Equal("denied", r.LastReason());
        Assert.Null(r.Gate.Active);
    }

    [Fact]
    public async Task SecondRequest_WhileSessionExists_Busy_AndFirstUnaffected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        var before = r.Signal.Count;
        await r.Request(sid: Msg.NewId());
        Assert.Equal("busy", r.LastReason());
        Assert.Equal(before + 1, r.Signal.Count);
        Assert.True(r.Gate.IsInputAllowed(r.Sid));
    }

    [Fact]
    public async Task Request_WhileOtherReserved_Busy()
    {
        using var r = new Rig();
        r.Gate.TryReserve("mcp-or-other");
        await r.Request();
        Assert.Equal("busy", r.LastReason());
        Assert.Empty(r.Signal.OfType("session-challenge"));
    }

    [Fact]
    public async Task KillDuringApprovalDialog_NeverActivates()
    {
        using var r = new Rig();
        var tcs = new TaskCompletionSource<ApprovalResult>();
        r.Prompts.Session = () => tcs.Task;
        await r.Request();
        var auth = r.Auth();
        r.Gate.Kill();
        tcs.SetResult(ApprovalResult.Control);
        await auth;
        Assert.Null(r.Gate.Active);
        Assert.Empty(r.Signal.OfType("session-accept"));
        Assert.Equal("denied", r.LastReason());
    }

    [Fact]
    public async Task BadOfferSignature_EndsSession_NoPeerCreated()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        using var attacker = new TestKey();
        await r.Offer("v=0 offer", attacker.Sign(IdentityUtil.OfferString(r.Sid, "v=0 offer")));
        Assert.Equal(0, r.PeerCreated);
        Assert.Equal("bad-signature", r.LastReason("session-end"));
        Assert.Null(r.Gate.Active);
        Assert.Empty(r.Signal.OfType("signal"));
    }

    [Fact]
    public async Task OfferSignatureOverDifferentSdp_Rejected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 evil", r.Ctl.Sign(IdentityUtil.OfferString(r.Sid, "v=0 good")));
        Assert.Equal(0, r.PeerCreated);
        Assert.Null(r.Gate.Active);
    }

    [Fact]
    public async Task OfferBeforeApproval_Ignored()
    {
        using var r = new Rig();
        await r.Request();
        await r.Offer("v=0 offer");
        Assert.Equal(0, r.PeerCreated);
    }

    [Fact]
    public async Task ValidOffer_CreatesPeer_AnswerSignedByDevice()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        Assert.Equal("v=0 offer", r.Peer!.Offer);
        var sig = r.Signal.OfType("signal").Single();
        Assert.Equal("answer", sig.GetProperty("sdp").GetProperty("type").GetString());
        var answer = sig.GetProperty("sdp").GetProperty("sdp").GetString()!;
        Assert.True(IdentityUtil.Verify(r.Device.PublicKeyBase64, IdentityUtil.AnswerString(r.Sid, answer), sig.GetProperty("signature").GetString()));
    }

    [Fact]
    public async Task EarlyCandidates_AreForwardedAfterOffer()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Neg.HandleAsync("signal", Msg.Of(new { type = "signal", sessionId = r.Sid, candidate = new { candidate = "candidate:1", sdpMid = "0", sdpMLineIndex = 0 } }));
        await r.Offer("v=0 offer");
        Assert.Equal(new[] { "candidate:1" }, r.Peer!.Candidates);
    }

    [Fact]
    public async Task Kill_DisposesPeer_NotifiesController_EndsGate()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        r.Gate.Kill();
        Assert.True(r.Peer!.Disposed);
        Assert.Equal("killed", r.LastReason("session-end"));
        Assert.Null(r.Gate.Active);
        Assert.False(r.Gate.IsInputAllowed(r.Sid));
        Assert.Null(r.Neg.ActivePeer);
    }

    [Fact]
    public async Task ControllerSessionEnd_TearsDown()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        await r.Neg.HandleAsync("session-end", Msg.Of(new { type = "session-end", sessionId = r.Sid, reason = "bye" }));
        Assert.True(r.Peer!.Disposed);
        Assert.Null(r.Gate.Active);
    }

    [Fact]
    public async Task SignalingLost_TearsDown()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        r.Neg.OnDisconnected();
        Assert.Null(r.Gate.Active);
    }

    [Fact]
    public async Task SessionEnd_ForOtherSession_Ignored()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Neg.HandleAsync("session-end", Msg.Of(new { type = "session-end", sessionId = Msg.NewId() }));
        Assert.True(r.Gate.IsInputAllowed(r.Sid));
    }
}
