using System.Collections.Concurrent;
using System.Drawing;
using System.Text;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>A stand-in H.264 encoder: emits a tiny Annex-B access unit per picture (SPS+PPS+IDR on keyframes).</summary>
public sealed class FakeH264Encoder : IH264Encoder
{
    public static readonly byte[] Idr = { 0, 0, 0, 1, 0x67, 0x42, 0xC0, 0x1F, 0, 0, 0, 1, 0x68, 0xCE, 0x3C, 0x80, 0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00 };
    public static readonly byte[] P = { 0, 0, 0, 1, 0x41, 0x9A, 0x02, 0x03 };
    public string Name => "fake";
    public int Width { get; }
    public int Height { get; }
    public int Encoded, Keyframes, BitrateChanges;
    public bool Throw;
    public bool Disposed;
    public FakeH264Encoder(int w, int h) { Width = w; Height = h; }
    public byte[]? Encode(byte[] nv12, bool keyframe, TimeSpan timestamp)
    {
        if (Throw) throw new InvalidOperationException("driver lost");
        Assert.True(nv12.Length >= Nv12.Size(Width, Height));
        Encoded++;
        bool key = keyframe || Encoded == 1;
        if (key) Keyframes++;
        return key ? Idr : P;
    }
    public void SetBitrate(int bitsPerSecond) => BitrateChanges++;
    public void Dispose() => Disposed = true;
}

public sealed class FakeH264Factory : IH264EncoderFactory
{
    public bool Available { get; set; } = true;
    public bool ThrowOnEncode;
    public bool CreateFails;
    public readonly List<FakeH264Encoder> Made = new();
    public IH264Encoder? Create(int width, int height, int fps, int bitsPerSecond, Action<string>? log = null)
    {
        if (CreateFails) return null;
        var e = new FakeH264Encoder(width, height) { Throw = ThrowOnEncode };
        lock (Made) Made.Add(e);
        return e;
    }
    public FakeH264Encoder? Last { get { lock (Made) return Made.Count == 0 ? null : Made[^1]; } }
}

public class H264Tests
{
    private static readonly MonitorInfo Mon = new(0, "Test", @"\\.\DISPLAY1", new Rectangle(0, 0, 320, 200), true);

    // ---------- pure helpers ----------

    [Fact]
    public void Nv12_KnownColours_Bt601Limited()
    {
        var f = new FrameBuffer(4, 2);
        Px.Fill(f, new Rectangle(0, 0, 2, 2), 255, 255, 255); // white
        Px.Fill(f, new Rectangle(2, 0, 2, 2), 0, 0, 255);     // red (BGRA)
        var nv = new byte[Nv12.Size(4, 2)];
        Nv12.FromBgra(f, nv);
        Assert.Equal(235, nv[0]); Assert.Equal(235, nv[5]);         // white luma
        Assert.InRange(nv[2], 80, 82);                              // red luma ≈ 81
        Assert.InRange(nv[8], 127, 129); Assert.InRange(nv[9], 127, 129); // white: neutral chroma
        Assert.InRange(nv[10], 89, 91); Assert.InRange(nv[11], 239, 240); // red: U≈90, V≈240
        var black = new FrameBuffer(2, 2);
        Px.Fill(black, new Rectangle(0, 0, 2, 2), 0, 0, 0); // buffers start uninitialised
        Nv12.FromBgra(black, nv);
        Assert.Equal(16, nv[0]);
    }

    [Fact]
    public void Nv12_OddSize_Rejected() =>
        Assert.Throws<ArgumentException>(() => Nv12.FromBgra(new FrameBuffer(3, 2), new byte[100]));

    [Fact]
    public void AnnexB_FindsNalTypes_With3And4ByteStartCodes()
    {
        Assert.Equal(new[] { 7, 8, 5 }, AnnexB.NalTypes(FakeH264Encoder.Idr));
        Assert.True(AnnexB.HasIdr(FakeH264Encoder.Idr) && AnnexB.HasSps(FakeH264Encoder.Idr));
        Assert.False(AnnexB.HasIdr(FakeH264Encoder.P));
        Assert.Equal(new[] { 1, 5 }, AnnexB.NalTypes(new byte[] { 0, 0, 1, 0x41, 9, 0, 0, 0, 1, 0x65, 1 }));
        Assert.Empty(AnnexB.NalTypes(new byte[] { 1, 2, 3 }));
    }

    [Theory]
    [InlineData(1920, 1080, 1.0, 1920, 1080)]
    [InlineData(1366, 768, 1.0, 1366, 768)]
    [InlineData(1365, 767, 1.0, 1364, 766)]   // odd → even
    [InlineData(1920, 1080, 0.5, 960, 540)]
    [InlineData(2560, 1440, 0.75, 1920, 1080)]
    public void EncodeSize_EvenAndNotLarger(int w, int h, double scale, int ew, int eh) =>
        Assert.Equal((ew, eh), H264Streamer.EncodeSize(w, h, scale));

    [Fact]
    public void Bitrate_GrowsWithQualityAndFps_Clamped()
    {
        int lo = H264Streamer.BitrateFor(1920, 1080, 30, 30), hi = H264Streamer.BitrateFor(1920, 1080, 30, 90);
        Assert.True(hi > lo);
        Assert.True(H264Streamer.BitrateFor(1920, 1080, 60, 70) > H264Streamer.BitrateFor(1920, 1080, 30, 70));
        Assert.Equal(1_000_000, H264Streamer.BitrateFor(64, 64, 1, 10));
        Assert.Equal(40_000_000, H264Streamer.BitrateFor(3840, 2160, 60, 95));
    }

    [Theory]
    [InlineData("{\"t\":\"video-track\",\"enabled\":true}", true)]
    [InlineData("{\"t\":\"video-track\",\"enabled\":false}", false)]
    public void VideoTrackMsg_Parses(string json, bool enabled)
    {
        var m = Assert.IsType<VideoTrackMsg>(ControlMessageParser.Parse(json, out _));
        Assert.Equal(enabled, m.Enabled);
    }

    [Theory]
    [InlineData("{\"t\":\"video-track\"}")]
    [InlineData("{\"t\":\"video-track\",\"enabled\":1}")]
    [InlineData("{\"t\":\"video-track\",\"enabled\":\"yes\"}")]
    public void VideoTrackMsg_Invalid_Ignored(string json) => Assert.Null(ControlMessageParser.Parse(json, out _));

    // ---------- streamers ----------

    private static async Task<bool> Until(Func<bool> cond, int ms = 5000)
    {
        for (int i = 0; i < ms / 10; i++) { if (cond()) return true; await Task.Delay(10); }
        return cond();
    }

    [Fact]
    public async Task H264Streamer_SendsIdrFirst_MonitorMessage_ThenFrames()
    {
        var factory = new FakeH264Factory();
        var frames = new ConcurrentQueue<(uint Dur, byte[] Au)>();
        var controls = new ConcurrentQueue<string>();
        using var h = new H264Streamer(new FakeCapturer(Px.Gradient(320, 200)), () => new[] { Mon }, 0, factory,
            (d, au) => frames.Enqueue((d, au)), o => controls.Enqueue(Json.Serialize(o)));
        h.SetQuality(60, 70, 1);
        h.Start();
        Assert.True(await Until(() => frames.Count >= 5));
        var list = frames.ToArray();
        Assert.True(AnnexB.HasIdr(list[0].Au));
        Assert.Contains(controls, c => c.Contains("\"t\":\"monitor\"") && c.Contains("\"width\":320"));
        Assert.Equal((320, 200), (factory.Last!.Width, factory.Last.Height));
        Assert.All(list, f => Assert.InRange(f.Dur, 1u, 900000u)); // RTP time follows the wall clock (slow CI runners stall)
        h.RequestKeyframe();
        int before = factory.Last.Keyframes;
        Assert.True(await Until(() => factory.Last.Keyframes > before), "keyframe on request");
    }

    [Fact]
    public async Task H264Streamer_Scale_ReopensEncoderAtNewSize()
    {
        var factory = new FakeH264Factory();
        using var h = new H264Streamer(new FakeCapturer(Px.Gradient(320, 200)), () => new[] { Mon }, 0, factory, (_, _) => { }, _ => { });
        h.SetQuality(60, 70, 1);
        h.Start();
        Assert.True(await Until(() => factory.Last?.Encoded > 0));
        h.SetQuality(60, 70, 0.5);
        Assert.True(await Until(() => factory.Last is { Width: 160, Height: 100, Encoded: > 0 }));
        Assert.True(factory.Made[0].Disposed);
    }

    [Fact]
    public async Task H264Streamer_StaticScreen_OnlyIdleRefresh()
    {
        var factory = new FakeH264Factory();
        int sent = 0;
        var cap = new FakeCapturer(Px.Gradient(320, 200)) { DirtyHint = new List<Rectangle>() }; // "nothing changed"
        using var h = new H264Streamer(cap, () => new[] { Mon }, 0, factory, (_, _) => Interlocked.Increment(ref sent), _ => { });
        h.SetQuality(60, 70, 1);
        h.Start();
        await Task.Delay(1100);
        // ~60 captures, but only the first frame + refreshes every 0.5 s are encoded
        Assert.InRange(Volatile.Read(ref sent), 1, 5);
    }

    [Fact]
    public async Task H264Streamer_EncoderKeepsFailing_RaisesFailedOnce()
    {
        var factory = new FakeH264Factory { ThrowOnEncode = true };
        int failed = 0;
        using var h = new H264Streamer(new FakeCapturer(Px.Gradient(320, 200)), () => new[] { Mon }, 0, factory, (_, _) => { }, _ => { });
        h.Failed += _ => Interlocked.Increment(ref failed);
        h.SetQuality(60, 70, 1);
        h.Start();
        Assert.True(await Until(() => Volatile.Read(ref failed) == 1));
        await Task.Delay(300);
        Assert.Equal(1, failed);
        Assert.Equal(H264Streamer.MaxFailures, factory.Made.Count);
        Assert.All(factory.Made, e => Assert.True(e.Disposed));
    }

    [Fact]
    public async Task VideoStreamer_Paused_StopsCapturing_ResumesWithKeyframe()
    {
        var cap = new FakeCapturer(Px.Gradient(320, 200));
        int chunks = 0;
        using var s = new VideoStreamer(cap, () => new[] { Mon }, 0, _ => Interlocked.Increment(ref chunks), () => 0, _ => { }, new FakeRectEncoder());
        s.SetQuality(60, 70, 1);
        s.Start();
        Assert.True(await Until(() => s.FramesSent > 0));
        s.SetPaused(true);
        int calls = cap.Calls;
        long frames = s.FramesSent;
        await Task.Delay(400);
        Assert.Equal(calls, cap.Calls);           // the capturer is free for the H.264 streamer
        Assert.True(s.FramesSent <= frames + 1);
        s.SetPaused(false);
        Assert.True(await Until(() => cap.Calls > calls && s.FramesSent > frames + 1));
        Assert.True(s.LastStats?.Keyframe == true || s.FramesSent > frames);
    }

    // ---------- RemoteSession + a SIPSorcery "browser" (real WebRTC loopback, fake encoder) ----------

    private sealed class Sink : IInputSink
    {
        public void MoveAbsolute(int nx, int ny) { }
        public void MoveRelative(int dx, int dy) { }
        public void Button(MouseButton button, bool down) { }
        public void Wheel(int dx, int dy) { }
        public void Key(KeyInfo key, bool down) { }
        public void UnicodeChar(char c, bool down) { }
    }

    private sealed class Loop : IAsyncDisposable
    {
        public TempDir Dir = new();
        public RemoteSession Agent = null!;
        public RTCPeerConnection Browser = new(new RTCConfiguration());
        public RTCDataChannel Control = null!, Video = null!;
        public FakeH264Factory Factory = new();
        public ConcurrentQueue<string> FromAgent = new();
        public int RtpVideo, JpegChunks, Reoffers;
        public string? AuditText => File.Exists(Dir.File("a.log")) ? File.ReadAllText(Dir.File("a.log")) : null;

        public async Task Start(bool renegotiateWorks = true)
        {
            var gate = new SessionGate();
            var key = Msg.NewId();
            gate.TryReserve(key);
            gate.Activate(key, SessionKind.Browser, "Browser", "cid", SessionMode.Control);
            var svc = new SessionServices
            {
                Monitors = () => new[] { Mon },
                CreateCapturer = () => new FakeCapturer(Px.Gradient(320, 200)),
                InputSink = new Sink(),
                VirtualScreen = () => Mon.Bounds,
                AudioAvailable = () => false,
                Prompts = new FakePrompts(),
                Audit = new AuditLog(Dir.File("a.log")),
                H264 = Factory,
            };
            Agent = new RemoteSession(gate.Active!, "AB12-CD34-EF56-7890", Array.Empty<IceServerConfig>(), gate, svc);
            Agent.LocalCandidate += (c, mid, idx) => Browser.addIceCandidate(new RTCIceCandidateInit { candidate = c, sdpMid = mid, sdpMLineIndex = idx });
            Browser.onicecandidate += c => { if (c != null) Agent.AddRemoteCandidate(c.candidate, c.sdpMid, c.sdpMLineIndex); };
            // what the negotiator does after verifying signatures: hand the re-offer to the browser, return its answer
            Agent.Renegotiate = async sdp =>
            {
                Interlocked.Increment(ref Reoffers);
                if (!renegotiateWorks) return null;
                Browser.addTrack(new MediaStreamTrack(new VideoFormat(VideoCodecsEnum.H264, 96, 90000, RemoteSession.H264Fmtp), MediaStreamStatusEnum.RecvOnly));
                var res = Browser.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.offer, sdp = sdp });
                if (res != SetDescriptionResultEnum.OK) return null;
                var ans = Browser.createAnswer(null);
                await Browser.setLocalDescription(ans);
                return ans.sdp;
            };
            Browser.OnRtpPacketReceived += (_, media, _) => { if (media == SDPMediaTypesEnum.video) Interlocked.Increment(ref RtpVideo); };

            Control = await Browser.createDataChannel("control", new RTCDataChannelInit { ordered = true });
            Video = await Browser.createDataChannel("video", new RTCDataChannelInit { ordered = true });
            await Browser.createDataChannel("audio", new RTCDataChannelInit { ordered = false, maxRetransmits = 0 });
            await Browser.createDataChannel("file", new RTCDataChannelInit { ordered = true });
            Control.onmessage += (_, _, d) => FromAgent.Enqueue(Encoding.UTF8.GetString(d));
            Video.onmessage += (_, _, _) => Interlocked.Increment(ref JpegChunks);
            var offer = Browser.createOffer(null);
            await Browser.setLocalDescription(offer);
            var answer = await Agent.AcceptOfferAsync(offer.sdp);
            Assert.Equal(SetDescriptionResultEnum.OK, Browser.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = answer }));
            Assert.True(await Until(() => FromAgent.Any(m => m.Contains("\"t\":\"hello\"")), 30000), "hello");
        }

        public void Send(string json) => Control.send(json);

        public async ValueTask DisposeAsync()
        {
            Agent?.Dispose();
            try { Browser.close(); } catch (Exception) { }
            await Task.Delay(50);
            Dir.Dispose();
        }
    }

    [Fact(Timeout = 90000)]
    public async Task Session_VideoTrack_RtpFlows_JpegPauses_AndSwitchesBack()
    {
        await using var l = new Loop();
        await l.Start();
        Assert.Contains(l.FromAgent, m => m.Contains("\"t\":\"hello\"") && m.Contains("\"video\":\"h264\"") && m.Contains("\"relMouse\":true"));
        Assert.True(await Until(() => l.JpegChunks > 0), "JPEG video first");

        l.Send("{\"t\":\"video-track\",\"enabled\":true}");
        Assert.True(await Until(() => l.Agent.H264Active, 20000), "H.264 streaming");
        Assert.True(await Until(() => l.RtpVideo > 5, 20000), "RTP video reaches the browser");
        Assert.Equal(1, l.Reoffers);
        await Task.Delay(200);
        int jpeg = l.JpegChunks;
        await Task.Delay(500);
        Assert.True(l.JpegChunks - jpeg <= 2, "JPEG channel quiet while the track plays");

        l.Send("{\"t\":\"video-track\",\"enabled\":false}");
        Assert.True(await Until(() => !l.Agent.H264Active), "back to JPEG");
        jpeg = l.JpegChunks;
        Assert.True(await Until(() => l.JpegChunks > jpeg), "JPEG resumes");

        l.Send("{\"t\":\"video-track\",\"enabled\":true}"); // reuses the negotiated track
        Assert.True(await Until(() => l.Agent.H264Active, 10000));
        Assert.Equal(1, l.Reoffers);
        Assert.True(l.Factory.Made.Count >= 2, "a fresh encoder (IDR) after switching back");
    }

    [Fact(Timeout = 90000)]
    public async Task Session_NoValidAnswer_StaysOnJpeg_NeverRetries()
    {
        await using var l = new Loop();
        await l.Start(renegotiateWorks: false);
        l.Send("{\"t\":\"video-track\",\"enabled\":true}");
        Assert.True(await Until(() => l.Reoffers == 1));
        await Task.Delay(300);
        Assert.False(l.Agent.H264Active);
        int jpeg = l.JpegChunks;
        Assert.True(await Until(() => l.JpegChunks > jpeg), "JPEG keeps going");
        l.Send("{\"t\":\"video-track\",\"enabled\":true}");
        await Task.Delay(300);
        Assert.Equal(1, l.Reoffers);
        Assert.Contains("H.264 track unavailable", l.AuditText);
    }

    [Fact(Timeout = 90000)]
    public async Task Session_EncoderFails_FallsBackToJpeg()
    {
        await using var l = new Loop();
        l.Factory.ThrowOnEncode = true;
        await l.Start();
        l.Send("{\"t\":\"video-track\",\"enabled\":true}");
        Assert.True(await Until(() => l.Factory.Made.Count >= H264Streamer.MaxFailures, 20000));
        Assert.True(await Until(() => !l.Agent.H264Active, 10000));
        int jpeg = l.JpegChunks;
        Assert.True(await Until(() => l.JpegChunks > jpeg), "JPEG resumes after the encoder broke");
        Assert.Contains("encoder failed", l.AuditText);
    }

    [Fact(Timeout = 90000)]
    public async Task Session_WithoutEncoder_NoVideoCapability_RequestIgnored()
    {
        await using var l = new Loop();
        l.Factory.Available = false;
        await l.Start();
        Assert.DoesNotContain(l.FromAgent, m => m.Contains("\"video\":\"h264\""));
        l.Send("{\"t\":\"video-track\",\"enabled\":true}");
        await Task.Delay(500);
        Assert.Equal(0, l.Reoffers);
        Assert.False(l.Agent.H264Active);
    }

    // ---------- the real Media Foundation encoder (Windows only; CI runs it on windows-latest) ----------

    [Fact]
    public void MediaFoundation_EncodesIdr_WithSps_OnWindows()
    {
        if (!OperatingSystem.IsWindows()) return; // no Media Foundation here
        var factory = new MfH264EncoderFactory();
        var log = new List<string>();
        using var enc = factory.Create(640, 360, 30, 2_000_000, log.Add);
        Assert.True(enc != null, "no working H.264 MFT: " + string.Join(" | ", log));
        var src = Px.Gradient(640, 360);
        var nv = new byte[Nv12.Size(640, 360)];
        Nv12.FromBgra(src, nv);
        var types = new List<int>();
        for (int i = 0; i < 30 && !types.Contains(5); i++)
        {
            var au = enc!.Encode(nv, i == 0, TimeSpan.FromSeconds(i / 30.0));
            if (au != null) types.AddRange(AnnexB.NalTypes(au));
        }
        Assert.Contains(5, types); // IDR
        Assert.Contains(7, types); // SPS (in-band, so the browser can start decoding)
        // a later forced keyframe comes out as an IDR again
        bool idr = false;
        for (int i = 30; i < 60 && !idr; i++)
        {
            var au = enc!.Encode(nv, i == 30, TimeSpan.FromSeconds(i / 30.0));
            idr = au != null && AnnexB.HasIdr(au);
        }
        Assert.True(idr, "forced keyframe");
    }
}
