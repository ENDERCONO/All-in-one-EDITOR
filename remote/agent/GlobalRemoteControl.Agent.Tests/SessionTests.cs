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
    internal sealed class FakePeer : IRemotePeer
    {
        public bool Disposed;
        public ISessionTransport? Relay;
        public int SwitchCalls;
        public bool ThrowOnSwitch;
        public List<(RelayChannel Ch, byte[] Payload)> RelayMessages = new();
        public string? Offer;
        public List<string> Candidates = new();
        public event Action<string, string?, ushort>? LocalCandidate { add { } remove { } }
        public event Action<string>? Closed { add { } remove { } }
        public Task<string> AcceptOfferAsync(string offerSdp) { Offer = offerSdp; return Task.FromResult("v=0 answer"); }
        public void AddRemoteCandidate(string candidate, string? sdpMid, ushort idx) => Candidates.Add(candidate);
        public void SwitchToRelay(ISessionTransport relay)
        {
            SwitchCalls++;
            if (ThrowOnSwitch) throw new InvalidOperationException("boom");
            Relay = relay;
        }
        public void OnRelayMessage(RelayChannel channel, byte[] payload) { lock (RelayMessages) RelayMessages.Add((channel, payload)); }
        public Func<string, Task<string?>>? Renegotiate { get; set; }
        public void Dispose() => Disposed = true;
    }

    internal sealed class Rig : IDisposable
    {
        public TempDir Dir = new();
        public FakeSignal Signal = new();
        public FakePrompts Prompts = new();
        public SessionGate Gate = new();
        public TrustedControllerStore Store;
        public DeviceIdentity Device;
        public TestKey Ctl = new();
        /// <summary>The controller's ephemeral ECDH key (what the browser puts in its offer).</summary>
        public EphemeralEcdh CtlEcdh = new();
        public FakePeer? Peer;
        public int PeerCreated;
        public SessionNegotiator Neg;
        public string Sid = Msg.NewId();

        public Rig(bool paired = true)
        {
            Store = new TrustedControllerStore(Dir.File("t.json"));
            if (paired) Store.Add(Ctl.Id, Ctl.Name, Ctl.PublicKeyB64);
            Device = DeviceIdentity.CreateEphemeral(); // in-memory seam; DPAPI persistence has its own tests
            Neg = new SessionNegotiator(Signal, Device, Store, Gate, Prompts, new AuditLog(Dir.File("a.log")),
                (info, fp) => { PeerCreated++; return Peer = new FakePeer(); });
        }

        public Task Request(string? sid = null, string? cid = null) =>
            Neg.HandleAsync("session-request", Msg.Of(new { type = "session-request", sessionId = sid ?? Sid, controller = new { id = cid ?? Ctl.Id, name = Ctl.Name, publicKey = Ctl.PublicKeyB64 } }));

        public string Nonce => Signal.OfType("session-challenge").Last().GetProperty("nonce").GetString()!;

        public Task Auth(string? signature = null, string? sid = null) =>
            Neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = sid ?? Sid, signature = signature ?? Ctl.Sign(IdentityUtil.SessionAuthString(Sid, Nonce, Device.DeviceId)) }));

        public string SignOffer(string sdp, string? ecdh = null) => Ctl.Sign(IdentityUtil.OfferString(Sid, ecdh ?? CtlEcdh.SpkiBase64, sdp));

        /// <summary>Sends a signed offer. <paramref name="ecdh"/> null = our key; "" = field omitted.</summary>
        public Task Offer(string sdp, string? signature = null, string? ecdh = null, bool omitSignature = false)
        {
            var key = ecdh ?? CtlEcdh.SpkiBase64;
            var sig = signature ?? SignOffer(sdp, key);
            object msg = (key.Length == 0, omitSignature) switch
            {
                (true, true) => new { type = "signal", sessionId = Sid, sdp = new { type = "offer", sdp } },
                (true, false) => new { type = "signal", sessionId = Sid, sdp = new { type = "offer", sdp }, signature = sig },
                (false, true) => new { type = "signal", sessionId = Sid, sdp = new { type = "offer", sdp }, ecdh = key },
                _ => new { type = "signal", sessionId = Sid, sdp = new { type = "offer", sdp }, ecdh = key, signature = sig },
            };
            return Neg.HandleAsync("signal", Msg.Of(msg));
        }

        public JsonElement Answer => Signal.OfType("signal").Single(s => s.TryGetProperty("sdp", out _));

        public Task RelayStart(string? sid = null) =>
            Neg.HandleAsync("relay-start", Msg.Of(new { type = "relay-start", sessionId = sid ?? Sid }));

        /// <summary>The browser's relay codec, keyed from our ECDH key and the device's signed answer.</summary>
        public RelayCodec ControllerCodec()
        {
            var z = CtlEcdh.DeriveSharedSecret(Answer.GetProperty("ecdh").GetString()!);
            return RelayCodec.ForController(Sid, z);
        }

        public async Task ApprovedSession(ApprovalResult res = ApprovalResult.Control)
        {
            Prompts.Session = () => Task.FromResult(res);
            await Request(); await Auth();
        }

        public string LastReason(string type = "session-reject") => Signal.OfType(type).Last().GetProperty("reason").GetString()!;
        public void Dispose() { Neg.AbortPending("test-end"); Gate.Kill("test-end"); Device.Dispose(); Ctl.Dispose(); CtlEcdh.Dispose(); Dir.Dispose(); }
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
        await r.Offer("v=0 offer", attacker.Sign(IdentityUtil.OfferString(r.Sid, r.CtlEcdh.SpkiBase64, "v=0 offer")));
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
        await r.Offer("v=0 evil", r.SignOffer("v=0 good"));
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
        Assert.True(IdentityUtil.Verify(r.Device.PublicKeyBase64, IdentityUtil.AnswerString(r.Sid, sig.GetProperty("ecdh").GetString()!, answer), sig.GetProperty("signature").GetString()));
    }

    // ---- PROTOCOL 5.1: agent-initiated renegotiation for the H.264 track ----

    private static async Task<(Rig R, Task<string?> Result, JsonElement ReOffer)> StartReoffer(string sdp = "v=0 reoffer")
    {
        var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        var task = r.Peer!.Renegotiate!(sdp);
        JsonElement re = default;
        for (int i = 0; i < 100; i++)
        {
            var list = r.Signal.OfType("signal").Where(x => x.TryGetProperty("renegotiate", out _)).ToList();
            if (list.Count > 0) { re = list[^1]; break; }
            await Task.Delay(10);
        }
        return (r, task, re);
    }

    private static Task Reanswer(Rig r, int seq, string sdp, string? signature = null) =>
        r.Neg.HandleAsync("signal", Msg.Of(new
        {
            type = "signal", sessionId = r.Sid, renegotiate = true, seq,
            sdp = new { type = "answer", sdp },
            signature = signature ?? r.Ctl.Sign(IdentityUtil.ReanswerString(r.Sid, seq, sdp)),
        }));

    [Fact]
    public async Task Reoffer_IsSignedByDevice_WithIncreasingSeq()
    {
        var (r, task, re) = await StartReoffer();
        using var rig = r;
        Assert.True(re.GetProperty("renegotiate").GetBoolean());
        Assert.Equal(1, re.GetProperty("seq").GetInt32());
        Assert.Equal("offer", re.GetProperty("sdp").GetProperty("type").GetString());
        Assert.False(re.TryGetProperty("ecdh", out _));
        Assert.True(IdentityUtil.Verify(r.Device.PublicKeyBase64, IdentityUtil.ReofferString(r.Sid, 1, "v=0 reoffer"), re.GetProperty("signature").GetString()));
        // a signature over the first-offer text (or another seq) must not verify: different domain prefix
        Assert.False(IdentityUtil.Verify(r.Device.PublicKeyBase64, IdentityUtil.ReofferString(r.Sid, 2, "v=0 reoffer"), re.GetProperty("signature").GetString()));
        await Reanswer(r, 1, "v=0 reanswer");
        Assert.Equal("v=0 reanswer", await task);
        var second = r.Peer!.Renegotiate!("v=0 again");
        await Task.Delay(50);
        Assert.Equal(2, r.Signal.OfType("signal").Last(x => x.TryGetProperty("renegotiate", out _)).GetProperty("seq").GetInt32());
        await Reanswer(r, 2, "v=0 a2");
        Assert.Equal("v=0 a2", await second);
    }

    [Fact]
    public async Task Reanswer_BadSignature_EndsSession()
    {
        var (r, task, _) = await StartReoffer();
        using var _r = r;
        using var attacker = new TestKey();
        await Reanswer(r, 1, "v=0 evil", attacker.Sign(IdentityUtil.ReanswerString(r.Sid, 1, "v=0 evil")));
        Assert.Null(await task);
        Assert.True(r.Peer!.Disposed);
        Assert.Equal("bad-signature", r.Signal.OfType("session-end").Last().GetProperty("reason").GetString());
    }

    [Fact]
    public async Task Reanswer_SignatureOverOtherSdp_EndsSession()
    {
        var (r, task, _) = await StartReoffer();
        using var _r = r;
        await Reanswer(r, 1, "v=0 swapped", r.Ctl.Sign(IdentityUtil.ReanswerString(r.Sid, 1, "v=0 original")));
        Assert.Null(await task);
        Assert.True(r.Peer!.Disposed);
    }

    [Fact]
    public async Task Reanswer_WrongSeq_Ignored_ThenTimesOut()
    {
        var old = SessionNegotiator.RenegotiateTimeout;
        SessionNegotiator.RenegotiateTimeout = TimeSpan.FromMilliseconds(300);
        try
        {
            var (r, task, _) = await StartReoffer();
            using var _r = r;
            await Reanswer(r, 7, "v=0 stale"); // validly signed, but not the outstanding seq
            Assert.False(task.IsCompleted);
            Assert.Null(await task);           // no answer within the timeout → JPEG stays
            Assert.False(r.Peer!.Disposed);    // a missing answer is not an attack
            await Reanswer(r, 1, "v=0 late");  // after the timeout: nothing outstanding, ignored
            Assert.False(r.Peer!.Disposed);
        }
        finally { SessionNegotiator.RenegotiateTimeout = old; }
    }

    [Fact]
    public async Task UnsolicitedReanswer_Ignored()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        await Reanswer(r, 1, "v=0 x");
        Assert.False(r.Peer!.Disposed);
        Assert.Empty(r.Signal.OfType("session-end"));
    }

    [Fact]
    public async Task Renegotiate_AfterRelayStart_ReturnsNull_NoSignal()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        await r.RelayStart();
        Assert.Null(await r.Peer!.Renegotiate!("v=0 reoffer"));
        Assert.DoesNotContain(r.Signal.OfType("signal"), x => x.TryGetProperty("renegotiate", out _));
    }

    [Fact]
    public async Task Renegotiate_AfterSessionEnded_ReturnsNull()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        var reneg = r.Peer!.Renegotiate!;
        r.Gate.Kill("test");
        await Task.Delay(50);
        Assert.Null(await reneg("v=0 reoffer"));
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
