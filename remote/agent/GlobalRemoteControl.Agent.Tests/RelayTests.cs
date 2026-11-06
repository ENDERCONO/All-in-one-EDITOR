using System.Buffers.Binary;
using System.Drawing;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;
using Rig = GlobalRemoteControl.Agent.Tests.SessionNegotiatorTests.Rig;

namespace GlobalRemoteControl.Agent.Tests;

// Encrypted relay fallback + signed ECDH exchange (PROTOCOL.md sections 4 and 7).

internal static class RelayTestUtil
{
    public static byte[] Hex(string s) => Convert.FromHexString(s);
    public static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);

    public static (RelayCodec Ctl, RelayCodec Dev) Pair(string? sid = null)
    {
        sid ??= Msg.NewId();
        var z = RandomNumberGenerator.GetBytes(32);
        return (RelayCodec.ForController(sid, z), RelayCodec.ForDevice(sid, z));
    }

    public static async Task<bool> Until(Func<bool> cond, int ms = 3000)
    {
        var end = DateTime.UtcNow.AddMilliseconds(ms);
        while (!cond()) { if (DateTime.UtcNow > end) return false; await Task.Delay(5); }
        return true;
    }
}

/// <summary>Fixed vector produced by the browser code (Fixtures/make-relay-vector.mjs → remote/web/protocol.js).</summary>
public class RelayCryptoVectorTests
{
    private sealed record Key(string d, string x, string y, string spki);
    private sealed record Frame(string direction, int counter, int channel, string payload, string frame);
    private sealed record Vector(string sessionId, Key controller, Key device, string z, string keyC2D, string keyD2C, Frame[] frames);

    private static string FixturePath => Path.Combine(AppContext.BaseDirectory, "Fixtures", "relay-vector.json");
    private static Vector Load(string? path = null) =>
        JsonSerializer.Deserialize<Vector>(File.ReadAllText(path ?? FixturePath))!;

    private static EphemeralEcdh Ecdh(Key k) => EphemeralEcdh.FromPrivateKey(RelayTestUtil.Hex(k.d), RelayTestUtil.Hex(k.x), RelayTestUtil.Hex(k.y));

    [Fact]
    public void KeySchedule_MatchesBrowser()
    {
        var v = Load();
        using var ctl = Ecdh(v.controller);
        using var dev = Ecdh(v.device);
        Assert.Equal(v.controller.spki, ctl.SpkiBase64); // same SPKI encoding as WebCrypto exportKey('spki')
        Assert.Equal(v.device.spki, dev.SpkiBase64);
        var z1 = dev.DeriveSharedSecret(v.controller.spki);
        var z2 = ctl.DeriveSharedSecret(v.device.spki);
        Assert.Equal(v.z, Convert.ToHexString(z1).ToLowerInvariant());
        Assert.Equal(z1, z2);
        var (c2d, d2c) = RelayKeys.Derive(z1, v.sessionId);
        Assert.Equal(v.keyC2D, Convert.ToHexString(c2d).ToLowerInvariant());
        Assert.Equal(v.keyD2C, Convert.ToHexString(d2c).ToLowerInvariant());
    }

    [Fact]
    public void Encrypt_ProducesIdenticalBytes_BothDirections()
    {
        var v = Load();
        using var devKey = Ecdh(v.device);
        var z = devKey.DeriveSharedSecret(v.controller.spki);
        using var ctl = RelayCodec.ForController(v.sessionId, z);
        using var dev = RelayCodec.ForDevice(v.sessionId, z);
        Assert.Equal(4, v.frames.Count(f => f.direction == "c2d"));
        foreach (var f in v.frames)
        {
            var codec = f.direction == "c2d" ? ctl : dev;
            var bytes = codec.Encrypt((byte)f.channel, RelayTestUtil.Hex(f.payload));
            Assert.Equal((ulong)f.counter, codec.LastSentCounter);
            Assert.Equal(f.frame, Convert.ToHexString(bytes).ToLowerInvariant());
        }
    }

    [Fact]
    public void Decrypts_BrowserFrames_BothDirections()
    {
        var v = Load();
        using var devKey = Ecdh(v.device);
        var z = devKey.DeriveSharedSecret(v.controller.spki);
        using var ctl = RelayCodec.ForController(v.sessionId, z);
        using var dev = RelayCodec.ForDevice(v.sessionId, z);
        foreach (var f in v.frames)
        {
            var receiver = f.direction == "c2d" ? dev : ctl; // the agent receives c2d
            Assert.True(receiver.TryDecrypt(RelayTestUtil.Hex(f.frame), out var ch, out var payload));
            Assert.Equal(f.channel, ch);
            Assert.Equal(f.payload, Convert.ToHexString(payload).ToLowerInvariant());
        }
        // and the browser's frames are replays now
        Assert.False(dev.TryDecrypt(RelayTestUtil.Hex(v.frames[0].frame), out _, out _));
    }

    [NodeFact]
    public void Fixture_IsCurrent_WithWebProtocolJs()
    {
        var script = Path.Combine(AppContext.BaseDirectory, "Fixtures", "make-relay-vector.mjs");
        // run the copy that sits in the source tree (it imports ../../../web/protocol.js relative to itself)
        var web = RepoPaths.WebProtocolJs!;
        var src = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(web))!, "agent", "GlobalRemoteControl.Agent.Tests", "Fixtures", "make-relay-vector.mjs");
        if (File.Exists(src)) script = src;
        using var dir = new TempDir();
        var outFile = dir.File("v.json");
        NodeRunner.Run(script, outFile);
        var fresh = Load(outFile);
        var committed = Load();
        Assert.Equal(committed.z, fresh.z);
        Assert.Equal(committed.frames.Select(f => f.frame), fresh.frames.Select(f => f.frame));
    }
}

public class RelayCodecTests
{
    [Fact]
    public void FrameLayout_SessionId_CounterBE_CiphertextAndTag()
    {
        var sid = Msg.NewId();
        var (ctl, dev) = RelayTestUtil.Pair(sid);
        using (ctl) using (dev)
        {
            var f1 = ctl.Encrypt(0, RelayTestUtil.Utf8("{}"));
            var f2 = ctl.Encrypt(3, new byte[100]);
            Assert.Equal(Encoding.ASCII.GetBytes(sid), f1[..22]);
            Assert.Equal(1UL, BinaryPrimitives.ReadUInt64BigEndian(f1.AsSpan(22, 8)));
            Assert.Equal(2UL, BinaryPrimitives.ReadUInt64BigEndian(f2.AsSpan(22, 8)));
            Assert.Equal(22 + 8 + 1 + 2 + 16, f1.Length);
            Assert.Equal(22 + 8 + 1 + 100 + 16, f2.Length);
            Assert.True(dev.TryDecrypt(f1, out var ch, out var p));
            Assert.Equal(0, ch); Assert.Equal("{}", Encoding.UTF8.GetString(p));
        }
    }

    [Fact]
    public void Nonce_Is4ZeroBytesAndCounter_NoAad()
    {
        // decrypt a frame by hand with the spec's nonce and no AAD
        var sid = Msg.NewId();
        var z = RandomNumberGenerator.GetBytes(32);
        using var ctl = RelayCodec.ForController(sid, z);
        ctl.Encrypt(0, new byte[1]);
        var f = ctl.Encrypt(1, RelayTestUtil.Utf8("hi"));
        var (c2d, _) = RelayKeys.Derive(z, sid);
        var nonce = new byte[12];
        BinaryPrimitives.WriteUInt64BigEndian(nonce.AsSpan(4), 2);
        using var aes = new AesGcm(c2d, 16);
        var plain = new byte[f.Length - 30 - 16];
        aes.Decrypt(nonce, f.AsSpan(30, plain.Length), f.AsSpan(f.Length - 16), plain);
        Assert.Equal(new byte[] { 1, (byte)'h', (byte)'i' }, plain);
    }

    [Fact]
    public void Directions_UseDifferentKeys()
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        using (ctl) using (dev)
        {
            var own = dev.Encrypt(0, new byte[4]);
            Assert.False(dev.TryDecrypt(own, out _, out _)); // d2c frame is not valid as c2d
            Assert.True(ctl.TryDecrypt(own, out _, out _));
        }
    }

    [Fact]
    public void Replay_And_OldCounters_Dropped_GapsAllowed()
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        using (ctl) using (dev)
        {
            var f1 = ctl.Encrypt(0, new byte[1]);
            var f2 = ctl.Encrypt(0, new byte[2]);
            var f3 = ctl.Encrypt(0, new byte[3]);
            Assert.True(dev.TryDecrypt(f1, out _, out _));
            Assert.False(dev.TryDecrypt(f1, out _, out _));   // exact replay
            Assert.True(dev.TryDecrypt(f3, out _, out _));    // gap (f2 lost) is fine
            Assert.False(dev.TryDecrypt(f2, out _, out _));   // older than the last accepted
            Assert.Equal(3UL, dev.LastReceivedCounter);
        }
    }

    [Theory]
    [InlineData(0)]   // sessionId
    [InlineData(25)]  // counter
    [InlineData(30)]  // channel byte (ciphertext)
    [InlineData(35)]  // payload ciphertext
    [InlineData(-1)]  // tag
    public void Tampered_Dropped_DoesNotAdvanceCounter(int offset)
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        using (ctl) using (dev)
        {
            var f = ctl.Encrypt(0, new byte[10]);
            var bad = (byte[])f.Clone();
            bad[offset < 0 ? bad.Length - 1 : offset] ^= 0x01;
            Assert.False(dev.TryDecrypt(bad, out _, out _));
            Assert.Equal(0UL, dev.LastReceivedCounter);
            Assert.True(dev.TryDecrypt(f, out _, out _)); // the genuine frame still goes through
        }
    }

    [Fact]
    public void ForgedHighCounter_DoesNotBlockGenuineFrames()
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        using (ctl) using (dev)
        {
            var f = ctl.Encrypt(0, new byte[10]);
            var forged = (byte[])f.Clone();
            BinaryPrimitives.WriteUInt64BigEndian(forged.AsSpan(22), ulong.MaxValue);
            Assert.False(dev.TryDecrypt(forged, out _, out _));
            Assert.True(dev.TryDecrypt(f, out _, out _));
        }
    }

    [Fact]
    public void Oversize_And_Undersize()
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        using (ctl) using (dev)
        {
            Assert.Throws<ArgumentException>(() => ctl.Encrypt(3, new byte[RelayCodec.MaxPayloadLength + 1]));
            var max = ctl.Encrypt(3, new byte[RelayCodec.MaxPayloadLength]);
            Assert.Equal(64 * 1024, max.Length);
            Assert.True(dev.TryDecrypt(max, out _, out var p));
            Assert.Equal(RelayCodec.MaxPayloadLength, p.Length);

            var big = new byte[64 * 1024 + 1];
            ctl.Encrypt(0, new byte[1]).CopyTo(big, 0);
            Assert.False(dev.TryDecrypt(big, out _, out _));
            Assert.False(dev.TryDecrypt(new byte[RelayCodec.MinFrameLength - 1], out _, out _));
            Assert.False(dev.TryDecrypt(Array.Empty<byte>(), out _, out _));
        }
    }

    [Theory]
    [InlineData("short")]
    [InlineData("AbCdEfGhIjKlMnOpQrStUvW")] // 23
    [InlineData("AbCdEfGhIjKlMnOpQrStü")]   // 21 chars, 22 UTF-8 bytes
    public void BadSessionId_Throws(string sid) =>
        Assert.Throws<ArgumentException>(() => new RelayCodec(sid, new byte[32], new byte[32]));

    [Fact]
    public void EcdhKeys_AreFreshAndValidated()
    {
        using var a = new EphemeralEcdh();
        using var b = new EphemeralEcdh();
        Assert.NotEqual(a.SpkiBase64, b.SpkiBase64);
        Assert.True(EphemeralEcdh.IsValidPeerKey(a.SpkiBase64));
        Assert.Equal(a.DeriveSharedSecret(b.SpkiBase64), b.DeriveSharedSecret(a.SpkiBase64));
        using var p384 = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP384);
        Assert.False(EphemeralEcdh.IsValidPeerKey(Convert.ToBase64String(p384.ExportSubjectPublicKeyInfo())));
        Assert.False(EphemeralEcdh.IsValidPeerKey("not base64!"));
        Assert.False(EphemeralEcdh.IsValidPeerKey(null));
        Assert.ThrowsAny<CryptographicException>(() => a.DeriveSharedSecret("AAAA"));
    }
}

/// <summary>Signed offer/answer with ECDH, relay-start and frame routing in <see cref="SessionNegotiator"/>.</summary>
public class RelayNegotiatorTests
{
    private static async Task<Rig> Connected(ApprovalResult mode = ApprovalResult.Control)
    {
        var r = new Rig();
        await r.ApprovedSession(mode);
        await r.Offer("v=0 offer");
        Assert.NotNull(r.Peer);
        return r;
    }

    private static void AssertOfferRejected(Rig r)
    {
        Assert.Equal(0, r.PeerCreated);
        Assert.Equal("bad-signature", r.LastReason("session-end"));
        Assert.Null(r.Gate.Active);
        Assert.Empty(r.Signal.OfType("signal"));
    }

    [Fact]
    public async Task Offer_MissingEcdh_Rejected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer", signature: r.Ctl.Sign(IdentityUtil.OfferString(r.Sid, "", "v=0 offer")), ecdh: "");
        AssertOfferRejected(r);
    }

    [Fact]
    public async Task Offer_MissingSignature_Rejected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer", omitSignature: true);
        AssertOfferRejected(r);
    }

    [Fact]
    public async Task Offer_TamperedSignature_Rejected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        var sig = Convert.FromBase64String(r.SignOffer("v=0 offer"));
        sig[10] ^= 0x40;
        await r.Offer("v=0 offer", Convert.ToBase64String(sig));
        AssertOfferRejected(r);
    }

    [Fact]
    public async Task Offer_EcdhSwappedByServer_Rejected()
    {
        // the server replaces the controller's ECDH key with its own (relay MITM): the signature no longer matches
        using var r = new Rig();
        await r.ApprovedSession();
        using var mitm = new EphemeralEcdh();
        await r.Offer("v=0 offer", signature: r.SignOffer("v=0 offer"), ecdh: mitm.SpkiBase64);
        AssertOfferRejected(r);
    }

    [Fact]
    public async Task Offer_OldFormatSignature_WithoutEcdh_Rejected()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer", signature: r.Ctl.Sign($"grc-offer:{r.Sid}:v=0 offer"));
        AssertOfferRejected(r);
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("p384")]
    public async Task Offer_InvalidEcdhKey_Rejected_EvenIfSigned(string kind)
    {
        using var r = new Rig();
        await r.ApprovedSession();
        string key = "QUJD";
        if (kind == "p384")
        {
            using var k = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP384);
            key = Convert.ToBase64String(k.ExportSubjectPublicKeyInfo());
        }
        await r.Offer("v=0 offer", signature: r.SignOffer("v=0 offer", key), ecdh: key);
        AssertOfferRejected(r);
    }

    [Fact]
    public async Task Answer_CarriesFreshEcdh_SignedByDevice()
    {
        using var r = await Connected();
        var a = r.Answer;
        var ecdh = a.GetProperty("ecdh").GetString()!;
        var sdp = a.GetProperty("sdp").GetProperty("sdp").GetString()!;
        var sig = a.GetProperty("signature").GetString()!;
        Assert.True(EphemeralEcdh.IsValidPeerKey(ecdh));
        Assert.NotEqual(r.CtlEcdh.SpkiBase64, ecdh);
        Assert.NotEqual(r.Device.PublicKeyBase64, ecdh); // not the long-term identity key
        Assert.True(IdentityUtil.Verify(r.Device.PublicKeyBase64, $"grc-answer:{r.Sid}:{ecdh}:{sdp}", sig));
        Assert.False(IdentityUtil.Verify(r.Device.PublicKeyBase64, $"grc-answer:{r.Sid}:{sdp}", sig));
        Assert.False(IdentityUtil.Verify(r.Device.PublicKeyBase64, IdentityUtil.AnswerString(r.Sid, r.CtlEcdh.SpkiBase64, sdp), sig));

        using var r2 = await Connected();
        Assert.NotEqual(ecdh, r2.Answer.GetProperty("ecdh").GetString()); // ephemeral: new key every session
    }

    [Fact]
    public async Task RelayStart_ForOtherSession_Ignored()
    {
        using var r = await Connected();
        await r.RelayStart(Msg.NewId());
        Assert.Equal(0, r.Peer!.SwitchCalls);
        Assert.False(r.Neg.IsRelayed);
        using var codec = r.ControllerCodec();
        r.Neg.OnRelayFrame(codec.Encrypt(0, RelayTestUtil.Utf8("{}")));
        Assert.Empty(r.Peer.RelayMessages);
        Assert.True(r.Gate.IsActive(r.Sid)); // the real session is unaffected
    }

    [Fact]
    public async Task RelayStart_BeforeApprovalOrOffer_Ignored()
    {
        using var r = new Rig();
        await r.Request();
        await r.RelayStart();                       // awaiting auth
        await r.Auth();
        await r.RelayStart();                       // accepted, but no signed offer/ECDH yet
        Assert.False(r.Neg.IsRelayed);
        await r.Offer("v=0 offer");
        Assert.Equal(0, r.Peer!.SwitchCalls);
        await r.RelayStart();
        Assert.True(r.Neg.IsRelayed);
    }

    [Fact]
    public async Task RelayStart_AfterEnd_Ignored()
    {
        using var r = await Connected();
        await r.Neg.HandleAsync("session-end", Msg.Of(new { type = "session-end", sessionId = r.Sid }));
        await r.RelayStart();
        Assert.Equal(0, r.Peer!.SwitchCalls);
        Assert.False(r.Neg.IsRelayed);
    }

    [Fact]
    public async Task RelayStart_SwitchesSynchronously_Once()
    {
        using var r = await Connected();
        var t = r.RelayStart();
        Assert.True(t.IsCompleted); // nothing async: frames read next are routed already
        Assert.Equal(1, r.Peer!.SwitchCalls);
        Assert.NotNull(r.Peer.Relay);
        Assert.True(r.Neg.IsRelayed);
        await r.RelayStart();
        Assert.Equal(1, r.Peer.SwitchCalls);
    }

    [Fact]
    public async Task RelayStart_SwitchFails_EndsSession()
    {
        using var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        r.Peer!.ThrowOnSwitch = true;
        await r.RelayStart();
        Assert.Equal("relay-failed", r.LastReason("session-end"));
        Assert.Null(r.Gate.Active);
        Assert.True(r.Peer.Disposed);
    }

    [Fact]
    public async Task Frames_BeforeRelayStart_Dropped()
    {
        using var r = await Connected();
        using var codec = r.ControllerCodec();
        r.Neg.OnRelayFrame(codec.Encrypt(0, RelayTestUtil.Utf8("{\"t\":\"keyframe\"}")));
        await r.RelayStart();
        Assert.Empty(r.Peer!.RelayMessages);
    }

    [Fact]
    public async Task Frames_RoutedByChannel_InOrder()
    {
        using var r = await Connected();
        await r.RelayStart();
        using var codec = r.ControllerCodec();
        r.Neg.OnRelayFrame(codec.Encrypt(0, RelayTestUtil.Utf8("{\"t\":\"keyframe\"}")));
        r.Neg.OnRelayFrame(codec.Encrypt(3, new byte[] { 1, 2, 3 }));
        r.Neg.OnRelayFrame(codec.Encrypt(1, new byte[] { 9 }));
        r.Neg.OnRelayFrame(codec.Encrypt(2, new byte[] { 8 }));
        r.Neg.OnRelayFrame(codec.Encrypt(4, new byte[] { 7 }));   // unknown channel: dropped
        r.Neg.OnRelayFrame(codec.Encrypt(255, new byte[] { 7 })); // unknown channel: dropped
        var got = r.Peer!.RelayMessages;
        Assert.Equal(new[] { RelayChannel.Control, RelayChannel.File, RelayChannel.Video, RelayChannel.Audio }, got.Select(x => x.Ch));
        Assert.Equal("{\"t\":\"keyframe\"}", Encoding.UTF8.GetString(got[0].Payload));
        Assert.Equal(new byte[] { 1, 2, 3 }, got[1].Payload);
    }

    [Fact]
    public async Task Frames_Replayed_Tampered_OrForeign_Dropped()
    {
        using var r = await Connected();
        await r.RelayStart();
        using var codec = r.ControllerCodec();
        var f1 = codec.Encrypt(0, RelayTestUtil.Utf8("{\"t\":\"keyframe\"}"));
        var f2 = codec.Encrypt(0, RelayTestUtil.Utf8("{\"t\":\"audio\",\"enabled\":false}"));
        r.Neg.OnRelayFrame(f1);
        r.Neg.OnRelayFrame(f1); // replay
        var bad = (byte[])f2.Clone(); bad[^3] ^= 1;
        r.Neg.OnRelayFrame(bad); // tampered
        // a frame for the right session id but made with other keys (e.g. a server that swapped ECDH keys)
        using var foreign = RelayCodec.ForController(r.Sid, RandomNumberGenerator.GetBytes(32));
        foreign.Encrypt(0, new byte[1]); foreign.Encrypt(0, new byte[1]);
        r.Neg.OnRelayFrame(foreign.Encrypt(0, RelayTestUtil.Utf8("{}")));
        r.Neg.OnRelayFrame(new byte[10]); // garbage
        r.Neg.OnRelayFrame(f2);
        Assert.Equal(2, r.Peer!.RelayMessages.Count);
    }

    [Fact]
    public async Task DeviceToController_FramesDecryptWithBrowserKeys_CountersFrom1()
    {
        using var r = await Connected();
        await r.RelayStart();
        var t = r.Peer!.Relay!;
        Assert.True(t.SendControl("{\"t\":\"hello\"}"));
        Assert.True(t.Send(RelayChannel.Video, new byte[] { 1, 2 }));
        Assert.True(t.Send(RelayChannel.Audio, new byte[] { 3 }));
        Assert.True(await ((RelayTransport)t).DrainAsync(TimeSpan.FromSeconds(3)));
        var frames = r.Signal.BinarySnapshot;
        Assert.Equal(3, frames.Length);
        using var codec = r.ControllerCodec();
        var expect = new (byte Ch, ulong Counter)[] { (0, 1), (1, 2), (2, 3) };
        for (int i = 0; i < 3; i++)
        {
            Assert.Equal(expect[i].Counter, BinaryPrimitives.ReadUInt64BigEndian(frames[i].AsSpan(22, 8)));
            Assert.True(codec.TryDecrypt(frames[i], out var ch, out _));
            Assert.Equal(expect[i].Ch, ch);
        }
    }

    [Fact]
    public async Task Kill_DisposesRelay()
    {
        using var r = await Connected();
        await r.RelayStart();
        var t = r.Peer!.Relay!;
        r.Gate.Kill();
        Assert.False(r.Neg.IsRelayed);
        Assert.False(t.Send(RelayChannel.Control, new byte[1]));
        Assert.False(t.HasChannel(RelayChannel.Video));
    }
}

/// <summary>A scripted server socket: hands out queued messages (chunked like a real socket), then closes.</summary>
internal sealed class ScriptedWebSocket : WebSocket
{
    private readonly Queue<(byte[] Data, WebSocketMessageType Type)> _in = new();
    private byte[]? _cur; private WebSocketMessageType _curType; private int _pos;
    private WebSocketState _state = WebSocketState.Open;
    public List<(byte[] Data, WebSocketMessageType Type)> Sent { get; } = new();
    public int ChunkSize { get; set; } = 4096;

    public void Text(string s) => _in.Enqueue((Encoding.UTF8.GetBytes(s), WebSocketMessageType.Text));
    public void Text(object o) => Text(Json.Serialize(o));
    public void Binary(byte[] b) => _in.Enqueue((b, WebSocketMessageType.Binary));

    public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken ct)
    {
        if (_cur == null)
        {
            if (!_in.TryDequeue(out var m))
            {
                _state = WebSocketState.CloseReceived;
                return Task.FromResult(new WebSocketReceiveResult(0, WebSocketMessageType.Close, true));
            }
            (_cur, _curType, _pos) = (m.Data, m.Type, 0);
        }
        var n = Math.Min(Math.Min(buffer.Count, ChunkSize), _cur.Length - _pos);
        Array.Copy(_cur, _pos, buffer.Array!, buffer.Offset, n);
        _pos += n;
        var end = _pos >= _cur.Length;
        var type = _curType;
        if (end) _cur = null;
        return Task.FromResult(new WebSocketReceiveResult(n, type, end));
    }

    public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType t, bool end, CancellationToken ct)
    { Sent.Add((buffer.ToArray(), t)); return Task.CompletedTask; }
    public override WebSocketCloseStatus? CloseStatus => null;
    public override string? CloseStatusDescription => null;
    public override WebSocketState State => _state;
    public override string? SubProtocol => null;
    public override void Abort() => _state = WebSocketState.Aborted;
    public override Task CloseAsync(WebSocketCloseStatus s, string? d, CancellationToken ct) { _state = WebSocketState.Closed; return Task.CompletedTask; }
    public override Task CloseOutputAsync(WebSocketCloseStatus s, string? d, CancellationToken ct) => CloseAsync(s, d, ct);
    public override void Dispose() { }
}

/// <summary>The real SignalingClient receive loop feeding the negotiator, wired like AgentHost does.</summary>
public class RelayReceiveLoopTests
{
    private static SignalingClient Client(Rig r)
    {
        var c = new SignalingClient(r.Device, () => "PC");
        c.MessageReceived += (type, m) => { if (type != "ready") _ = r.Neg.HandleAsync(type, m); }; // not awaited, as in AgentHost
        c.BinaryReceived += r.Neg.OnRelayFrame;
        return c;
    }

    private static async Task<Rig> Connected()
    {
        var r = new Rig();
        await r.ApprovedSession();
        await r.Offer("v=0 offer");
        return r;
    }

    [Fact]
    public async Task FramesSentRightAfterRelayStart_AreAllDelivered()
    {
        using var r = await Connected();
        using var codec = r.ControllerCodec();
        var ws = new ScriptedWebSocket();
        ws.Text(new { type = "ready", id = r.Device.DeviceId, iceServers = Array.Empty<object>() });
        ws.Text(new { type = "relay-start", sessionId = r.Sid });
        for (int i = 0; i < 5; i++) ws.Binary(codec.Encrypt(0, RelayTestUtil.Utf8($"{{\"t\":\"ack\",\"frameId\":{i}}}")));
        using var client = Client(r);
        await client.ReceiveLoopAsync(ws, CancellationToken.None, () => { });
        Assert.True(r.Neg.IsRelayed);
        Assert.Equal(5, r.Peer!.RelayMessages.Count);
        Assert.Equal("{\"t\":\"ack\",\"frameId\":4}", Encoding.UTF8.GetString(r.Peer.RelayMessages[4].Payload));
    }

    [Fact]
    public async Task BinaryBeforeAuthentication_Ignored()
    {
        using var r = await Connected();
        await r.RelayStart();
        using var codec = r.ControllerCodec();
        var ws = new ScriptedWebSocket();
        ws.Binary(codec.Encrypt(0, RelayTestUtil.Utf8("{}"))); // before "ready"
        using var client = Client(r);
        await client.ReceiveLoopAsync(ws, CancellationToken.None, () => { });
        Assert.Empty(r.Peer!.RelayMessages);
    }

    [Fact]
    public async Task OversizeMessages_DroppedAndLoopContinues()
    {
        using var r = await Connected();
        using var codec = r.ControllerCodec();
        var ws = new ScriptedWebSocket { ChunkSize = 16384 };
        ws.Text(new { type = "ready", id = r.Device.DeviceId });
        ws.Text(new { type = "relay-start", sessionId = r.Sid });
        var huge = new byte[SignalingClient.MaxFrameBytes + 500];
        codec.Encrypt(0, new byte[1]).CopyTo(huge, 0);
        ws.Binary(huge);                                                       // oversize binary
        ws.Text("{\"type\":\"session-end\",\"sessionId\":\"" + r.Sid + "\",\"pad\":\"" + new string('x', 70000) + "\"}"); // oversize text
        ws.Binary(codec.Encrypt(0, RelayTestUtil.Utf8("{\"t\":\"keyframe\"}")));
        using var client = Client(r);
        await client.ReceiveLoopAsync(ws, CancellationToken.None, () => { });
        Assert.Single(r.Peer!.RelayMessages);
        Assert.True(r.Gate.IsActive(r.Sid)); // the oversize session-end was not acted on
    }

    [Fact]
    public async Task MaxSizeFrame_Accepted()
    {
        using var r = await Connected();
        using var codec = r.ControllerCodec();
        var ws = new ScriptedWebSocket();
        ws.Text(new { type = "ready", id = r.Device.DeviceId });
        ws.Text(new { type = "relay-start", sessionId = r.Sid });
        var f = codec.Encrypt(3, new byte[RelayCodec.MaxPayloadLength]);
        Assert.Equal(SignalingClient.MaxFrameBytes, f.Length);
        ws.Binary(f);
        using var client = Client(r);
        await client.ReceiveLoopAsync(ws, CancellationToken.None, () => { });
        Assert.Single(r.Peer!.RelayMessages);
    }
}

/// <summary>The agent→controller send queue.</summary>
public class RelayTransportTests
{
    private sealed class Wire
    {
        public readonly List<byte[]> Frames = new();
        public TaskCompletionSource Gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Blocked;
        public async Task Send(byte[] f)
        {
            if (Blocked) await Gate.Task;
            lock (Frames) Frames.Add(f);
        }
        public int Count { get { lock (Frames) return Frames.Count; } }
    }

    [Fact]
    public async Task KeepsOrder_AcrossChannels_CountersIncrease()
    {
        var (ctl, dev) = RelayTestUtil.Pair();
        var wire = new Wire();
        using var t = new RelayTransport(dev, wire.Send);
        for (int i = 0; i < 200; i++) Assert.True(t.Send((RelayChannel)(i % 4 == 2 ? 3 : i % 4), BitConverter.GetBytes(i)));
        Assert.True(await t.DrainAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(200, wire.Count);
        for (int i = 0; i < 200; i++)
        {
            Assert.True(ctl.TryDecrypt(wire.Frames[i], out _, out var p));
            Assert.Equal(i, BitConverter.ToInt32(p));
        }
        ctl.Dispose();
    }

    [Fact]
    public async Task Buffered_ReportsQueuedBytes_ThenDrains()
    {
        var (_, dev) = RelayTestUtil.Pair();
        var wire = new Wire { Blocked = true };
        using var t = new RelayTransport(dev, wire.Send);
        t.Send(RelayChannel.Video, new byte[10_000]);
        t.Send(RelayChannel.Video, new byte[5_000]);
        Assert.Equal(15_000UL, t.Buffered(RelayChannel.Video));
        wire.Gate.SetResult();
        Assert.True(await t.DrainAsync(TimeSpan.FromSeconds(3)));
        Assert.Equal(0UL, t.Buffered(RelayChannel.File));
    }

    [Fact]
    public void Audio_DroppedWhenBacklogged()
    {
        var (_, dev) = RelayTestUtil.Pair();
        var wire = new Wire { Blocked = true };
        using var t = new RelayTransport(dev, wire.Send);
        Assert.True(t.Send(RelayChannel.Video, new byte[16_000]));
        Assert.True(t.Send(RelayChannel.Audio, new byte[960]));
        for (int i = 0; i < 4; i++) t.Send(RelayChannel.Video, new byte[16_000]); // > 64 KB queued
        Assert.False(t.Send(RelayChannel.Audio, new byte[960]));
        Assert.True(t.Send(RelayChannel.Control, new byte[10])); // control still goes
    }

    [Fact]
    public async Task FileSend_WaitsWhileOver1MB()
    {
        var (_, dev) = RelayTestUtil.Pair();
        var wire = new Wire { Blocked = true };
        using var t = new RelayTransport(dev, wire.Send);
        for (int i = 0; i < 70; i++) Assert.True(t.Send(RelayChannel.Video, new byte[16_000])); // 1.12 MB
        Assert.True(t.Pending > RelayTransport.FileWaitAbove);
        var file = Task.Run(() => t.Send(RelayChannel.File, new byte[16_000]));
        await Task.Delay(300);
        Assert.False(file.IsCompleted);
        wire.Gate.SetResult();
        Assert.True(await file.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.True(await t.DrainAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(71, wire.Count);
    }

    [Fact]
    public void Queue_IsBounded()
    {
        var (_, dev) = RelayTestUtil.Pair();
        var wire = new Wire { Blocked = true };
        using var t = new RelayTransport(dev, wire.Send);
        int accepted = 0;
        for (int i = 0; i < 1000; i++) if (t.Send(RelayChannel.Video, new byte[16_000])) accepted++;
        Assert.InRange(accepted * 16_000L, RelayTransport.HardLimit - 16_000, RelayTransport.HardLimit);
        Assert.True(t.Pending <= RelayTransport.HardLimit);
    }

    [Fact]
    public void Oversize_Refused_Disposed_Refused()
    {
        var (_, dev) = RelayTestUtil.Pair();
        var t = new RelayTransport(dev, new Wire().Send);
        Assert.False(t.Send(RelayChannel.File, new byte[RelayCodec.MaxPayloadLength + 1]));
        Assert.True(t.HasChannel(RelayChannel.Audio));
        t.Dispose();
        Assert.False(t.HasChannel(RelayChannel.Audio));
        Assert.False(t.SendControl("{}"));
    }
}

/// <summary>The real <see cref="RemoteSession"/> switching to a relay transport.</summary>
public class RemoteSessionRelayTests
{
    private sealed class RecordingTransport : ISessionTransport
    {
        public readonly List<(RelayChannel Ch, byte[] Data)> Sent = new();
        public bool Send(RelayChannel channel, byte[] payload) { lock (Sent) Sent.Add((channel, payload)); return true; }
        public bool SendControl(string json) => Send(RelayChannel.Control, Encoding.UTF8.GetBytes(json));
        public ulong Buffered(RelayChannel channel) => 0;
        public bool HasChannel(RelayChannel channel) => true;
        public List<string> Controls() { lock (Sent) return Sent.Where(s => s.Ch == RelayChannel.Control).Select(s => Encoding.UTF8.GetString(s.Data)).ToList(); }
        public int Count(RelayChannel ch) { lock (Sent) return Sent.Count(s => s.Ch == ch); }
    }

    private sealed class Sink : IInputSink
    {
        public int Moves;
        public void MoveAbsolute(int nx, int ny) => Interlocked.Increment(ref Moves);
        public void Button(MouseButton button, bool down) { }
        public void Wheel(int dx, int dy) { }
        public void Key(KeyInfo key, bool down) { }
        public void UnicodeChar(char c, bool down) { }
    }

    private static (RemoteSession S, Sink Sink, TempDir Dir) Make(SessionMode mode)
    {
        var dir = new TempDir();
        var gate = new SessionGate();
        var key = Msg.NewId();
        gate.TryReserve(key);
        gate.Activate(key, SessionKind.Browser, "Browser", "cid", mode);
        var mon = new MonitorInfo(0, "Test", @"\\.\DISPLAY1", new Rectangle(0, 0, 320, 200), true);
        var sink = new Sink();
        var svc = new SessionServices
        {
            Monitors = () => new[] { mon },
            CreateCapturer = () => new FakeCapturer(Px.Gradient(320, 200)),
            InputSink = sink,
            VirtualScreen = () => mon.Bounds,
            AudioAvailable = () => false,
            Prompts = new FakePrompts(),
            Audit = new AuditLog(dir.File("a.log")),
        };
        return (new RemoteSession(gate.Active!, "AB12-CD34-EF56-7890", Array.Empty<IceServerConfig>(), gate, svc), sink, dir);
    }

    private const string Move = "{\"t\":\"mouse-move\",\"x\":0.5,\"y\":0.5}";

    [Fact]
    public async Task SwitchToRelay_HelloVideoAndInputGoOverRelay()
    {
        var (s, sink, dir) = Make(SessionMode.Control);
        using var _ = dir;
        try
        {
            s.OnRelayMessage(RelayChannel.Control, RelayTestUtil.Utf8(Move)); // not relayed yet: ignored
            Assert.Equal(0, sink.Moves);
            var t = new RecordingTransport();
            s.SwitchToRelay(t);
            Assert.True(s.IsRelayed);
            Assert.Contains(t.Controls(), c => c.Contains("\"t\":\"hello\"") && c.Contains("\"mode\":\"control\""));
            Assert.True(await RelayTestUtil.Until(() => t.Count(RelayChannel.Video) > 0), "video over the relay");
            s.OnRelayMessage(RelayChannel.Control, RelayTestUtil.Utf8(Move));
            Assert.Equal(1, sink.Moves);
            s.SwitchToRelay(new RecordingTransport()); // second switch ignored
            s.OnRelayMessage(RelayChannel.Control, RelayTestUtil.Utf8(Move));
            Assert.Equal(2, sink.Moves);
        }
        finally { s.Dispose(); }
    }

    [Fact]
    public void ViewOnly_RelayInputIgnored()
    {
        var (s, sink, dir) = Make(SessionMode.View);
        using var _ = dir;
        try
        {
            s.SwitchToRelay(new RecordingTransport());
            s.OnRelayMessage(RelayChannel.Control, RelayTestUtil.Utf8(Move));
            Assert.Equal(0, sink.Moves);
        }
        finally { s.Dispose(); }
    }
}
