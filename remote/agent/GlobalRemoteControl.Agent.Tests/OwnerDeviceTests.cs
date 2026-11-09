using System.Security.Cryptography;
using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.FileTransfer;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Tests;

// PROTOCOL section 8: "my device" controllers (unattended sessions, approving from a phone, code requests).

/// <summary>Prompts that stay open until answered or cancelled (like the real dialogs).</summary>
internal sealed class OpenPrompts : IUserPrompts
{
    public TaskCompletionSource<bool> Pair = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource<ApprovalResult> Session = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public int PairCalls, SessionCalls, FileCalls;
    public bool PairCancelled, SessionCancelled;

    public Task<bool> ApprovePairingAsync(string n, string id, string fp, TimeSpan t) => throw new NotSupportedException();
    public Task<ApprovalResult> ApproveSessionAsync(string l, string fp, string? r, bool c, TimeSpan t) => throw new NotSupportedException();
    public Task<string?> ApproveIncomingFileAsync(string l, string fp, string f, long s, TimeSpan t) { FileCalls++; return Task.FromResult<string?>(null); }
    public Task<string?> PickFileToSendAsync() => Task.FromResult<string?>(null);

    public Task<bool> ApprovePairingAsync(string n, string id, string fp, TimeSpan t, CancellationToken cancel)
    {
        Interlocked.Increment(ref PairCalls);
        cancel.Register(() => { PairCancelled = true; Pair.TrySetResult(false); });
        return Pair.Task;
    }

    public Task<ApprovalResult> ApproveSessionAsync(string l, string fp, string? r, bool c, TimeSpan t, CancellationToken cancel)
    {
        Interlocked.Increment(ref SessionCalls);
        cancel.Register(() => { SessionCancelled = true; Session.TrySetResult(ApprovalResult.Deny); });
        return Session.Task;
    }
}

internal sealed class OwnerRig : IDisposable
{
    public TempDir Dir = new();
    public FakeSignal Signal = new();
    public OpenPrompts Prompts = new();
    public DeviceIdentity Device = DeviceIdentity.CreateEphemeral();
    public DateTimeOffset Now = DateTimeOffset.UtcNow;
    public TrustedControllerStore Store;
    public AuditLog Audit;
    public OwnerApprovals Approvals;
    public PairingHandler Pairing;
    public TestKey Phone = new("My phone");
    public TestKey School = new("School PC");

    public OwnerRig(bool phoneIsOwner = true)
    {
        Store = new TrustedControllerStore(Dir.File("t.json"), () => Now);
        Audit = new AuditLog(Dir.File("a.log"));
        Store.Add(Phone.Id, Phone.Name, Phone.PublicKeyB64);
        if (phoneIsOwner) Store.SetOwner(Phone.Id, true);
        Approvals = new OwnerApprovals(Signal, Device, Store, Audit);
        Pairing = new PairingHandler(Signal, Store, Prompts, Audit, Approvals, Device.DeviceId) { Now = () => Now };
    }

    public JsonElement LastRequest => Signal.OfType("approval-request").Last();

    public void Answer(TestKey by, JsonElement request, string decision, string? signWith = null, string? kind = null)
    {
        var approvalId = request.GetProperty("approvalId").GetString()!;
        kind ??= request.GetProperty("kind").GetString()!;
        var sig = by.Sign(IdentityUtil.ApproveString(Device.DeviceId, approvalId, kind, signWith ?? decision));
        Approvals.OnResult(Msg.Of(new { type = "approval-result", controllerId = by.Id, approvalId, decision, signature = sig }));
    }

    public Task PairRequest(TestKey k) => Pairing.OnPairRequestAsync(Msg.Of(new
    {
        type = "pair-request", requestId = "r1", controller = new { id = k.Id, name = k.Name, publicKey = k.PublicKeyB64 },
    }));

    public static async Task Until(Func<bool> cond)
    {
        for (int i = 0; i < 200 && !cond(); i++) await Task.Delay(10);
        Assert.True(cond(), "condition not reached");
    }

    public string AuditText() => File.Exists(Dir.File("a.log")) ? File.ReadAllText(Dir.File("a.log")) : "";

    public void Dispose() { Device.Dispose(); Phone.Dispose(); School.Dispose(); Dir.Dispose(); }
}

public class OwnerStoreTests
{
    [Fact]
    public void Owner_IsOffByDefault_PersistsAndSurvivesRepairing()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        s.Add(k.Id, "Phone", k.PublicKeyB64);
        Assert.False(s.Get(k.Id)!.Owner);
        Assert.Empty(s.Owners);
        Assert.True(s.SetOwner(k.Id, true));
        Assert.False(s.SetOwner(k.Id, true)); // no change
        var reloaded = new TrustedControllerStore(d.File("t.json"));
        Assert.True(reloaded.Get(k.Id)!.Owner);
        reloaded.Add(k.Id, "Phone again", k.PublicKeyB64);
        Assert.True(reloaded.Get(k.Id)!.Owner);
        Assert.True(reloaded.SetOwner(k.Id, false));
        Assert.Empty(new TrustedControllerStore(d.File("t.json")).Owners);
    }

    [Fact]
    public void SetOwner_UnknownOrRevoked_DoesNothing()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        Assert.False(s.SetOwner(k.Id, true));
        s.Add(k.Id, "x", k.PublicKeyB64); s.SetOwner(k.Id, true); s.Revoke(k.Id);
        Assert.Empty(s.Owners);
    }

    [Fact]
    public void Once_InMemoryOnly_OneUse_ExpiresAfter10Min()
    {
        using var d = new TempDir(); using var k = new TestKey(); using var k2 = new TestKey();
        var now = DateTimeOffset.UtcNow;
        var s = new TrustedControllerStore(d.File("t.json"), () => now);
        var c = s.AddTemporary(k.Id, "School", k.PublicKeyB64);
        Assert.True(c.Temporary);
        Assert.False(c.Owner);
        Assert.Same(c, s.Get(k.Id));
        Assert.Empty(s.All);                                         // not listed
        Assert.Null(new TrustedControllerStore(d.File("t.json")).Get(k.Id)); // not saved
        Assert.True(s.TryUseOnce(k.Id));
        Assert.False(s.TryUseOnce(k.Id));
        Assert.Null(s.Get(k.Id));                                    // used up: not paired any more

        s.AddTemporary(k2.Id, "Other", k2.PublicKeyB64);
        now += TrustedControllerStore.OnceWindow + TimeSpan.FromSeconds(1);
        Assert.Null(s.Get(k2.Id));
        Assert.False(s.TryUseOnce(k2.Id));
    }

    [Fact]
    public void Once_ForAPairedController_Throws_AndBadKeysRejected()
    {
        using var d = new TempDir(); using var k = new TestKey(); using var other = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        s.Add(k.Id, "x", k.PublicKeyB64);
        Assert.Throws<InvalidOperationException>(() => s.AddTemporary(k.Id, "x", k.PublicKeyB64));
        Assert.Throws<ArgumentException>(() => s.AddTemporary(other.Id, "x", k.PublicKeyB64));
    }

    [Fact]
    public void OwnerFlag_InFile_OnlyForValidEntries()
    {
        using var d = new TempDir(); using var k = new TestKey(); using var attacker = new TestKey();
        var path = d.File("t.json");
        File.WriteAllText(path, JsonSerializer.Serialize(new[]
        {
            new { Id = k.Id, Name = "x", PublicKey = attacker.PublicKeyB64, AddedAt = DateTimeOffset.UtcNow, Owner = true },
        }));
        Assert.Empty(new TrustedControllerStore(path).Owners); // id doesn't match the key: dropped, flag and all
    }
}

public class OwnerApprovalTests
{
    [Fact]
    public async Task Ask_SendsASignedRequestToEachOwner_ButNotToTheSubject()
    {
        using var r = new OwnerRig();
        using var laptop = new TestKey("Laptop");
        r.Store.Add(laptop.Id, laptop.Name, laptop.PublicKeyB64); r.Store.SetOwner(laptop.Id, true);
        var task = r.Approvals.AskAsync("pair", laptop.Id, "Laptop", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromSeconds(5), CancellationToken.None);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        var req = r.LastRequest;
        Assert.Equal(r.Phone.Id, req.GetProperty("to").GetString()); // the laptop is the subject, so only the phone
        var sub = req.GetProperty("subject");
        var data = IdentityUtil.ApprovalRequestString(req.GetProperty("approvalId").GetString()!, "pair", sub.GetProperty("id").GetString()!,
            sub.GetProperty("fingerprint").GetString()!, req.GetProperty("expiresAt").GetInt64(), sub.GetProperty("name").GetString()!);
        Assert.True(IdentityUtil.Verify(r.Device.PublicKeyBase64, data, req.GetProperty("signature").GetString()));
        r.Answer(r.Phone, req, "trust");
        Assert.Equal("trust", await task);
        Assert.Equal(0, r.Approvals.Pending);
        Assert.Single(r.Signal.OfType("approval-cancel")); // withdrawn from the server/other tabs
    }

    [Fact]
    public async Task NoOtherTrustedDevice_NothingSent()
    {
        using var r = new OwnerRig();
        r.Store.Revoke(r.Phone.Id);
        Assert.False(r.Approvals.CanAsk(r.School.Id));
        Assert.Null(await r.Approvals.AskAsync("pair", r.School.Id, "x", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromSeconds(1), CancellationToken.None));
        Assert.Empty(r.Signal.OfType("approval-request"));
    }

    [Fact]
    public async Task OrdinaryTrustedDevice_IsAskedToo_AndItsAnswerCounts()
    {
        // 2026-11-09: any saved trusted device approves, not only a my-device
        using var r = new OwnerRig(phoneIsOwner: false);
        Assert.True(r.Approvals.CanAsk(r.School.Id));
        var task = r.Approvals.AskAsync("pair", r.School.Id, "School PC", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromSeconds(5), CancellationToken.None);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        Assert.Equal(r.Phone.Id, r.LastRequest.GetProperty("to").GetString());
        r.Answer(r.Phone, r.LastRequest, "trust");
        Assert.Equal("trust", await task);
    }

    [Fact]
    public async Task AllowOnceDevice_IsNeverAsked()
    {
        using var r = new OwnerRig();
        r.Store.Revoke(r.Phone.Id);
        using var guest = new TestKey("Guest");
        r.Store.AddTemporary(guest.Id, guest.Name, guest.PublicKeyB64);
        Assert.False(r.Approvals.CanAsk(r.School.Id));
        Assert.Null(await r.Approvals.AskAsync("pair", r.School.Id, "x", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromMilliseconds(200), CancellationToken.None));
        Assert.Empty(r.Signal.OfType("approval-request"));
    }

    [Theory]
    [InlineData("bad-signature")]
    [InlineData("wrong-decision-signed")]
    [InlineData("decision-for-other-kind")]
    [InlineData("revoked-meanwhile")]
    [InlineData("answered-by-someone-else")]
    [InlineData("unknown-approval")]
    public async Task InvalidAnswers_AreIgnored(string attack)
    {
        using var r = new OwnerRig();
        using var mallory = new TestKey("Mallory");
        r.Store.Add(mallory.Id, mallory.Name, mallory.PublicKeyB64); // trusted too, so it gets its own request
        var task = r.Approvals.AskAsync("pair", r.School.Id, "School PC", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromMilliseconds(400), CancellationToken.None);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 2);
        var req = r.Signal.OfType("approval-request").Single(q => q.GetProperty("to").GetString() == r.Phone.Id);
        switch (attack)
        {
            case "bad-signature":
                r.Approvals.OnResult(Msg.Of(new { type = "approval-result", controllerId = r.Phone.Id, approvalId = req.GetProperty("approvalId").GetString(), decision = "trust", signature = mallory.Sign("x") }));
                break;
            case "wrong-decision-signed": r.Answer(r.Phone, req, "trust", signWith: "deny"); break;
            case "decision-for-other-kind": r.Answer(r.Phone, req, "control"); break;
            case "revoked-meanwhile": r.Store.Revoke(r.Phone.Id); r.Answer(r.Phone, req, "trust"); break;
            case "answered-by-someone-else": r.Answer(mallory, req, "trust"); break; // the phone's request, mallory's key
            case "unknown-approval":
                r.Approvals.OnResult(Msg.Of(new { type = "approval-result", controllerId = r.Phone.Id, approvalId = Msg.NewId(), decision = "trust",
                    signature = r.Phone.Sign(IdentityUtil.ApproveString(r.Device.DeviceId, Msg.NewId(), "pair", "trust")) }));
                break;
        }
        Assert.Null(await task); // timed out: nothing was accepted
    }

    [Fact]
    public async Task AnswerAfterItWasWithdrawn_IsIgnored()
    {
        using var r = new OwnerRig();
        using var cts = new CancellationTokenSource();
        var task = r.Approvals.AskAsync("session", r.School.Id, "School PC", "AAAA-BBBB-CCCC-DDDD", TimeSpan.FromSeconds(5), cts.Token);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        var req = r.LastRequest;
        cts.Cancel();
        Assert.Null(await task);
        r.Answer(r.Phone, req, "control"); // too late
        Assert.Equal(0, r.Approvals.Pending);
        Assert.Contains("approval-cancel", string.Join(",", r.Signal.Sent.Select(s => s.GetProperty("type").GetString())));
    }
}

public class OwnerPairingTests
{
    [Fact]
    public async Task PhoneAllowsOnce_TemporaryPairing_PcDialogClosed()
    {
        using var r = new OwnerRig();
        var t = r.PairRequest(r.School);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        Assert.Equal(1, r.Prompts.PairCalls); // the PC dialog is open at the same time
        r.Answer(r.Phone, r.LastRequest, "once");
        await t;
        Assert.True(r.Prompts.PairCancelled);
        var res = r.Signal.OfType("pair-result").Single();
        Assert.True(res.GetProperty("approved").GetBoolean());
        Assert.True(res.GetProperty("temporary").GetBoolean());
        Assert.True(r.Store.Get(r.School.Id)!.Temporary);
        Assert.DoesNotContain(r.Store.All, c => c.Id == r.School.Id);
        Assert.Contains("pair-approved-once", r.AuditText());
    }

    [Theory]
    [InlineData("trust", true)]
    [InlineData("deny", false)]
    public async Task PhoneTrustsOrDenies(string decision, bool approved)
    {
        using var r = new OwnerRig();
        var t = r.PairRequest(r.School);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        r.Answer(r.Phone, r.LastRequest, decision);
        await t;
        var res = r.Signal.OfType("pair-result").Single();
        Assert.Equal(approved, res.GetProperty("approved").GetBoolean());
        Assert.False(res.TryGetProperty("temporary", out _));
        Assert.Equal(approved, r.Store.All.Any(c => c.Id == r.School.Id));
        Assert.False(r.Store.Get(r.School.Id)?.Owner ?? false); // approving never makes a my-device
    }

    [Fact]
    public async Task PcAnswersFirst_PhoneQuestionWithdrawn_LateAnswerIgnored()
    {
        using var r = new OwnerRig();
        var t = r.PairRequest(r.School);
        await OwnerRig.Until(() => r.Signal.OfType("approval-request").Count == 1);
        var req = r.LastRequest;
        r.Prompts.Pair.SetResult(false); // denied at the PC
        await t;
        Assert.Single(r.Signal.OfType("approval-cancel"));
        r.Answer(r.Phone, req, "trust");
        Assert.False(r.Signal.OfType("pair-result").Single().GetProperty("approved").GetBoolean());
        Assert.Null(r.Store.Get(r.School.Id));
    }

    [Fact]
    public async Task WithoutOtherTrustedDevices_OnlyThePcDialog()
    {
        using var r = new OwnerRig();
        r.Store.Revoke(r.Phone.Id);
        var t = r.PairRequest(r.School);
        await OwnerRig.Until(() => r.Prompts.PairCalls == 1);
        r.Prompts.Pair.SetResult(true);
        await t;
        Assert.Empty(r.Signal.OfType("approval-request"));
        Assert.NotNull(r.Store.Get(r.School.Id));
    }
}

public class OwnerCodeRequestTests
{
    private static Task Request(OwnerRig r, TestKey by, string? requestId = null, long? ts = null, string? sig = null)
    {
        requestId ??= Msg.NewId();
        var t = ts ?? r.Now.ToUnixTimeMilliseconds();
        sig ??= by.Sign(IdentityUtil.CodeRequestString(r.Device.DeviceId, requestId, t));
        return r.Pairing.OnCodeRequestAsync(Msg.Of(new { type = "code-request", controllerId = by.Id, requestId, ts = t, signature = sig }));
    }

    private static string? Error(OwnerRig r) =>
        r.Signal.OfType("code-reply").Last().TryGetProperty("error", out var e) ? e.GetString() : null;

    [Fact]
    public async Task Owner_GetsAFreshCode()
    {
        using var r = new OwnerRig();
        int uiOpened = 0;
        r.Pairing.RemoteCodeRequested += () => { uiOpened++; _ = r.Pairing.RequestCodeAsync(); };
        var t = Request(r, r.Phone);
        await OwnerRig.Until(() => r.Signal.OfType("pairing-code-request").Count == 1);
        Assert.Equal(1, uiOpened);
        r.Pairing.OnPairingCode(Msg.Of(new { type = "pairing-code", code = "ABCD-EFGH", expiresAt = 1_900_000_000_000L }));
        await t;
        var reply = r.Signal.OfType("code-reply").Single();
        Assert.Equal(r.Phone.Id, reply.GetProperty("to").GetString());
        Assert.Equal("ABCD-EFGH", reply.GetProperty("code").GetString());
        Assert.Equal(1_900_000_000_000L, reply.GetProperty("expiresAt").GetInt64());
    }

    [Fact]
    public async Task NotAnOwner_Refused_NoCodeRequested()
    {
        using var r = new OwnerRig(phoneIsOwner: false);
        await Request(r, r.Phone);
        Assert.Equal("not-allowed", Error(r));
        await Request(r, r.School); // not paired at all
        Assert.Equal("not-allowed", Error(r));
        Assert.Empty(r.Signal.OfType("pairing-code-request"));
    }

    [Fact]
    public async Task BadSignature_Stale_Replay_RateLimit()
    {
        using var r = new OwnerRig();
        await Request(r, r.Phone, sig: r.School.Sign("nope"));
        Assert.Equal("not-allowed", Error(r));
        await Request(r, r.Phone, ts: r.Now.AddMinutes(-3).ToUnixTimeMilliseconds());
        Assert.Equal("stale", Error(r));
        Assert.Empty(r.Signal.OfType("pairing-code-request"));

        var id = Msg.NewId();
        var first = Request(r, r.Phone, requestId: id);
        await OwnerRig.Until(() => r.Signal.OfType("pairing-code-request").Count == 1);
        r.Pairing.OnPairingCode(Msg.Of(new { type = "pairing-code", code = "ABCD-EFGH", expiresAt = 1_900_000_000_000L }));
        await first;
        await Request(r, r.Phone, requestId: id);
        Assert.Equal("replayed", Error(r));

        var more = new List<Task>();
        for (int i = 0; i < PairingHandler.CodeRequestsPer10Min - 1; i++) more.Add(Request(r, r.Phone));
        await OwnerRig.Until(() => r.Signal.OfType("pairing-code-request").Count == PairingHandler.CodeRequestsPer10Min);
        await Request(r, r.Phone);
        Assert.Equal("rate-limited", Error(r));
        Assert.Equal(PairingHandler.CodeRequestsPer10Min, r.Signal.OfType("pairing-code-request").Count);
        r.Pairing.OnPairingCode(Msg.Of(new { type = "pairing-code", code = "WXYZ-2345", expiresAt = 1_900_000_000_000L }));
        await Task.WhenAll(more);
    }
}

public class OwnerSessionTests
{
    [Fact]
    public async Task MyDevice_ConnectsWithoutAnyDialog_InControl()
    {
        using var rig = new SessionNegotiatorTests.Rig();
        rig.Store.SetOwner(rig.Ctl.Id, true);
        int prompted = 0;
        rig.Prompts.Session = () => { prompted++; return Task.FromResult(ApprovalResult.Deny); };
        await rig.Request();
        await rig.Auth();
        Assert.Equal(0, prompted);
        Assert.Equal("control", rig.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        Assert.True(rig.Gate.Active!.Owner);
        Assert.True(rig.Gate.IsInputAllowed(rig.Sid));
    }

    [Fact]
    public async Task MyDevice_StillNeedsAValidSignature()
    {
        using var rig = new SessionNegotiatorTests.Rig();
        rig.Store.SetOwner(rig.Ctl.Id, true);
        using var other = new TestKey();
        await rig.Request();
        await rig.Auth(signature: other.Sign(IdentityUtil.SessionAuthString(rig.Sid, rig.Nonce, rig.Device.DeviceId)));
        Assert.Empty(rig.Signal.OfType("session-accept"));
        Assert.Equal("bad-signature", rig.Signal.OfType("session-reject").Single().GetProperty("reason").GetString());
        Assert.Null(rig.Gate.Active);
    }

    [Fact]
    public async Task OrdinaryDevice_StillAsks()
    {
        using var rig = new SessionNegotiatorTests.Rig();
        int prompted = 0;
        rig.Prompts.Session = () => { prompted++; return Task.FromResult(ApprovalResult.View); };
        await rig.Request();
        await rig.Auth();
        Assert.Equal(1, prompted);
        Assert.Equal("view", rig.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        Assert.False(rig.Gate.Active!.Owner);
    }

    [Fact]
    public async Task AllowOnce_OneSessionWithoutDialog_ThenNotPaired()
    {
        using var rig = new SessionNegotiatorTests.Rig(paired: false);
        rig.Store.AddTemporary(rig.Ctl.Id, rig.Ctl.Name, rig.Ctl.PublicKeyB64);
        int prompted = 0;
        rig.Prompts.Session = () => { prompted++; return Task.FromResult(ApprovalResult.Deny); };
        await rig.Request();
        await rig.Auth();
        Assert.Equal(0, prompted);
        Assert.Equal("control", rig.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        rig.Gate.End(rig.Sid, "stopped");

        rig.Sid = Msg.NewId();
        await rig.Request();
        Assert.Equal("not-paired", rig.Signal.OfType("session-reject").Last().GetProperty("reason").GetString());
    }

    [Fact]
    public async Task PhoneApprovesASession_AsViewOnly_PcDialogClosed()
    {
        using var dir = new TempDir();
        using var rig = new SessionNegotiatorTests.Rig();
        using var phone = new TestKey("My phone");
        rig.Store.Add(phone.Id, phone.Name, phone.PublicKeyB64); rig.Store.SetOwner(phone.Id, true);
        var prompts = new OpenPrompts();
        var approvals = new OwnerApprovals(rig.Signal, rig.Device, rig.Store, new AuditLog(dir.File("a.log")));
        var neg = new SessionNegotiator(rig.Signal, rig.Device, rig.Store, rig.Gate, prompts, new AuditLog(dir.File("b.log")),
            (_, _) => new SessionNegotiatorTests.FakePeer(), approvals);
        await neg.HandleAsync("session-request", Msg.Of(new { type = "session-request", sessionId = rig.Sid, controller = new { id = rig.Ctl.Id, name = rig.Ctl.Name, publicKey = rig.Ctl.PublicKeyB64 } }));
        var auth = neg.HandleAsync("session-auth", Msg.Of(new { type = "session-auth", sessionId = rig.Sid, signature = rig.Ctl.Sign(IdentityUtil.SessionAuthString(rig.Sid, rig.Nonce, rig.Device.DeviceId)) }));
        await OwnerRig.Until(() => rig.Signal.OfType("approval-request").Count == 1);
        var req = rig.Signal.OfType("approval-request").Single();
        Assert.Equal("session", req.GetProperty("kind").GetString());
        Assert.Equal(rig.Ctl.Id, req.GetProperty("subject").GetProperty("id").GetString());
        var approvalId = req.GetProperty("approvalId").GetString()!;
        approvals.OnResult(Msg.Of(new { type = "approval-result", controllerId = phone.Id, approvalId, decision = "view",
            signature = phone.Sign(IdentityUtil.ApproveString(rig.Device.DeviceId, approvalId, "session", "view")) }));
        await auth;
        Assert.True(prompts.SessionCancelled);
        Assert.Equal("view", rig.Signal.OfType("session-accept").Single().GetProperty("mode").GetString());
        Assert.False(rig.Gate.IsInputAllowed(rig.Sid));
    }
}

public class OwnerFileTests
{
    [Fact]
    public async Task MyDevice_UploadGoesToTheInbox_WithoutADialog_NeverOverwrites()
    {
        using var d = new TempDir();
        var inbox = d.File("inbox");
        Directory.CreateDirectory(inbox);
        File.WriteAllText(Path.Combine(inbox, "notes.txt"), "existing");
        var prompts = new FakePrompts();
        var sent = new List<string>();
        using var m = new FileTransferManager("Phone", "cid", "AAAA-BBBB-CCCC-DDDD", false,
            o => { lock (sent) sent.Add(Json.Serialize(o)); }, _ => { }, () => 0, prompts, new AuditLog(d.File("a.log")), d.File("tmp"),
            autoAcceptDir: inbox);
        var data = RandomNumberGenerator.GetBytes(1000);
        await m.Handle(new FileOfferMsg("f1", "..\\..\\notes.txt", data.Length));
        Assert.Equal(0, prompts.FileCalls);
        Assert.Contains(sent, s => s.Contains("file-accept"));
        m.OnChunk(data);
        await m.Handle(new FileEndMsg("f1", IncomingFile.Sha256Hex(data)));
        Assert.Equal("existing", File.ReadAllText(Path.Combine(inbox, "notes.txt")));
        Assert.Equal(data, File.ReadAllBytes(Path.Combine(inbox, "notes (2).txt")));
    }

    [Fact]
    public async Task ViewOnly_StillRejected_EvenForMyDevice()
    {
        using var d = new TempDir();
        var sent = new List<string>();
        using var m = new FileTransferManager("Phone", "cid", "AAAA-BBBB-CCCC-DDDD", true,
            o => sent.Add(Json.Serialize(o)), _ => { }, () => 0, new FakePrompts(), new AuditLog(d.File("a.log")), d.File("tmp"),
            autoAcceptDir: d.File("inbox"));
        await m.Handle(new FileOfferMsg("f1", "a.txt", 5));
        Assert.Contains(sent, s => s.Contains("view-only"));
    }

    [Fact]
    public void UniquePath_Numbers()
    {
        using var d = new TempDir();
        Assert.Equal(Path.Combine(d.Path, "a.txt"), FileTransferManager.UniquePath(d.Path, "a.txt"));
        File.WriteAllText(Path.Combine(d.Path, "a.txt"), "");
        File.WriteAllText(Path.Combine(d.Path, "a (2).txt"), "");
        Assert.Equal(Path.Combine(d.Path, "a (3).txt"), FileTransferManager.UniquePath(d.Path, "a.txt"));
    }
}
