using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Signaling;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Tests;

public class TrustStoreTests
{
    [Fact]
    public void Add_Persist_Reload()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        var c = s.Add(k.Id, "Laptop", k.PublicKeyB64);
        Assert.Equal(k.Id, c.Id);
        Assert.Same(c, s.Get(k.Id));
        var s2 = new TrustedControllerStore(d.File("t.json"));
        Assert.Equal(k.PublicKeyB64, s2.Get(k.Id)!.PublicKey);
        Assert.Equal("Laptop", s2.Get(k.Id)!.Name);
        Assert.Single(s2.All);
    }

    [Fact]
    public void Revoke_RemovesAndPersists_AndRaisesChanged()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        int changed = 0; s.Changed += () => changed++;
        s.Add(k.Id, "x", k.PublicKeyB64);
        Assert.True(s.Revoke(k.Id));
        Assert.False(s.Revoke(k.Id));
        Assert.Null(s.Get(k.Id));
        Assert.Equal(2, changed);
        Assert.Empty(new TrustedControllerStore(d.File("t.json")).All);
    }

    [Fact]
    public void Add_IdNotHashOfKey_Throws()
    {
        using var d = new TempDir(); using var a = new TestKey(); using var b = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        Assert.Throws<ArgumentException>(() => s.Add(b.Id, "x", a.PublicKeyB64));
        Assert.Empty(s.All);
    }

    [Fact]
    public void Add_NonP256Key_Throws()
    {
        using var d = new TempDir(); using var k = new TestKey("p384", System.Security.Cryptography.ECCurve.NamedCurves.nistP384);
        var s = new TrustedControllerStore(d.File("t.json"));
        Assert.Throws<ArgumentException>(() => s.Add(k.Id, "x", k.PublicKeyB64));
    }

    [Fact]
    public void Add_SameIdTwice_Replaces()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        s.Add(k.Id, "one", k.PublicKeyB64); s.Add(k.Id, "two", k.PublicKeyB64);
        Assert.Single(s.All);
        Assert.Equal("two", s.Get(k.Id)!.Name);
    }

    [Fact]
    public void TamperedFile_EntryWithSwappedKey_IsDropped_ValidOneKept()
    {
        using var d = new TempDir(); using var good = new TestKey(); using var victim = new TestKey(); using var attacker = new TestKey();
        var path = d.File("t.json");
        var s = new TrustedControllerStore(path);
        s.Add(good.Id, "good", good.PublicKeyB64);
        s.Add(victim.Id, "victim", victim.PublicKeyB64);
        // attacker edits the file: victim's id now carries attacker's key
        var text = JsonSerializer.Serialize(JsonSerializer.Deserialize<List<TrustedController>>(File.ReadAllText(path))!.Select(c => c.Id == victim.Id ? c with { PublicKey = attacker.PublicKeyB64 } : c));
        File.WriteAllText(path, text);
        var reloaded = new TrustedControllerStore(path);
        Assert.NotNull(reloaded.Get(good.Id));
        Assert.Null(reloaded.Get(victim.Id));
    }

    [Fact]
    public void TamperedFile_GarbageKey_Dropped()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var path = d.File("t.json");
        File.WriteAllText(path, JsonSerializer.Serialize(new[] { new { Id = k.Id, Name = "x", PublicKey = "AAAA", AddedAt = DateTimeOffset.UtcNow } }));
        Assert.Empty(new TrustedControllerStore(path).All);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("[null]")]
    [InlineData("")]
    public void CorruptFile_FailsClosed_Empty(string content)
    {
        using var d = new TempDir();
        var path = d.File("t.json"); File.WriteAllText(path, content);
        Assert.Empty(new TrustedControllerStore(path).All);
    }

    [Fact]
    public void Get_NullOrUnknown_ReturnsNull()
    {
        using var d = new TempDir();
        var s = new TrustedControllerStore(d.File("t.json"));
        Assert.Null(s.Get(null)); Assert.Null(s.Get("nope"));
    }

    [Fact]
    public void Name_IsNormalized_ControlCharsStripped()
    {
        using var d = new TempDir(); using var k = new TestKey();
        var s = new TrustedControllerStore(d.File("t.json"));
        Assert.Equal("ab", s.Add(k.Id, "a\nb\0", k.PublicKeyB64).Name);
    }
}

public class PairingHandlerTests
{
    private sealed class Rig : IDisposable
    {
        public TempDir Dir = new();
        public FakeSignal Signal = new();
        public FakePrompts Prompts = new();
        public TrustedControllerStore Store;
        public PairingHandler Handler;
        public Rig()
        {
            Store = new TrustedControllerStore(Dir.File("t.json"));
            Handler = new PairingHandler(Signal, Store, Prompts, new AuditLog(Dir.File("a.log")));
        }
        public void Dispose() => Dir.Dispose();
    }

    private static JsonElement Req(string requestId, string? id, string? name, string? key) =>
        Msg.Of(new { type = "pair-request", requestId, controller = new { id, name, publicKey = key } });

    [Fact]
    public async Task IdNotHashOfKey_Rejected_NoPrompt_NotStored()
    {
        using var r = new Rig(); using var real = new TestKey(); using var forged = new TestKey();
        await r.Handler.OnPairRequestAsync(Req("r1", forged.Id, "Evil", real.PublicKeyB64));
        Assert.Equal(0, r.Prompts.PairingCalls);
        Assert.Empty(r.Store.All);
        Assert.False(r.Signal.Last.GetProperty("approved").GetBoolean());
    }

    [Fact]
    public async Task NonP256Key_Rejected()
    {
        using var r = new Rig(); using var k = new TestKey("p384", System.Security.Cryptography.ECCurve.NamedCurves.nistP384);
        await r.Handler.OnPairRequestAsync(Req("r1", k.Id, "Evil", k.PublicKeyB64));
        Assert.Equal(0, r.Prompts.PairingCalls);
        Assert.Empty(r.Store.All);
    }

    [Fact]
    public async Task MissingName_Rejected()
    {
        using var r = new Rig(); using var k = new TestKey();
        await r.Handler.OnPairRequestAsync(Req("r1", k.Id, null, k.PublicKeyB64));
        Assert.Equal(0, r.Prompts.PairingCalls);
        Assert.Empty(r.Store.All);
    }

    [Fact]
    public async Task Approved_StoresController_AndReportsApproved()
    {
        using var r = new Rig(); using var k = new TestKey();
        await r.Handler.OnPairRequestAsync(Req("r1", k.Id, "Phone", k.PublicKeyB64));
        Assert.Equal(1, r.Prompts.PairingCalls);
        Assert.NotNull(r.Store.Get(k.Id));
        Assert.True(r.Signal.Last.GetProperty("approved").GetBoolean());
        Assert.Equal("r1", r.Signal.Last.GetProperty("requestId").GetString());
    }

    [Fact]
    public async Task Denied_NotStored()
    {
        using var r = new Rig(); using var k = new TestKey();
        r.Prompts.Pairing = () => Task.FromResult(false);
        await r.Handler.OnPairRequestAsync(Req("r1", k.Id, "Phone", k.PublicKeyB64));
        Assert.Empty(r.Store.All);
        Assert.False(r.Signal.Last.GetProperty("approved").GetBoolean());
    }

    [Fact]
    public async Task PromptThrows_TreatedAsDenied()
    {
        using var r = new Rig(); using var k = new TestKey();
        r.Prompts.Pairing = () => throw new InvalidOperationException("ui died");
        await r.Handler.OnPairRequestAsync(Req("r1", k.Id, "Phone", k.PublicKeyB64));
        Assert.Empty(r.Store.All);
        Assert.False(r.Signal.Last.GetProperty("approved").GetBoolean());
    }

    [Fact]
    public async Task SecondRequestWhileFirstWaiting_IsRejected()
    {
        using var r = new Rig(); using var a = new TestKey(); using var b = new TestKey();
        var tcs = new TaskCompletionSource<bool>();
        r.Prompts.Pairing = () => tcs.Task;
        var first = r.Handler.OnPairRequestAsync(Req("r1", a.Id, "A", a.PublicKeyB64));
        await r.Handler.OnPairRequestAsync(Req("r2", b.Id, "B", b.PublicKeyB64));
        Assert.Equal(1, r.Prompts.PairingCalls);
        Assert.False(r.Signal.OfType("pair-result").Single(m => m.GetProperty("requestId").GetString() == "r2").GetProperty("approved").GetBoolean());
        tcs.SetResult(true); await first;
        Assert.NotNull(r.Store.Get(a.Id)); Assert.Null(r.Store.Get(b.Id));
    }

    [Fact]
    public async Task MalformedRequests_AreIgnoredOrRejected_NeverThrow()
    {
        using var r = new Rig();
        await r.Handler.OnPairRequestAsync(Msg.Parse("{}"));
        await r.Handler.OnPairRequestAsync(Msg.Parse("{\"requestId\":\"x\",\"controller\":5}"));
        Assert.Equal(0, r.Prompts.PairingCalls);
        Assert.Empty(r.Store.All);
    }

    [Fact]
    public void PairingCode_Parsed_AndBadOnesIgnored()
    {
        using var r = new Rig();
        var got = new List<(string, DateTimeOffset)>();
        r.Handler.CodeReceived += (c, e) => got.Add((c, e));
        r.Handler.OnPairingCode(Msg.Parse("{\"code\":\"ABCD-EFGH\",\"expiresAt\":1700000000000}"));
        r.Handler.OnPairingCode(Msg.Parse("{\"code\":\"ABCD-EFGH\"}"));
        r.Handler.OnPairingCode(Msg.Parse("{\"code\":\"X\",\"expiresAt\":1}"));
        r.Handler.OnPairingCode(Msg.Parse("{\"code\":5,\"expiresAt\":1}"));
        Assert.Single(got);
        Assert.Equal(1700000000000, got[0].Item2.ToUnixTimeMilliseconds());
    }
}
