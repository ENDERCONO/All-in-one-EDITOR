using System.Drawing;
using System.Text.Json;
using GlobalRemoteControl.Agent.Capture;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>
/// Cross-check against the browser (PROTOCOL.md section 5): chunks produced by the agent are fed through
/// remote/web/protocol.js (FrameAssembler → parseFrameV2 → FrameSequencer) by Fixtures/browser-frames.mjs, and what
/// the browser parses must equal what the agent meant to send.
/// </summary>
public class VideoPipelineBrowserTests
{
    private sealed record BRect(int x, int y, int w, int h, int codec, int length, string sha256);
    private sealed record BFrame(long frameId, bool dropped, string decision, bool keyframe, int width, int height, BRect[]? rects, string? error);

    private static List<BFrame> Browser(IEnumerable<byte[]> chunks)
    {
        using var dir = new TempDir();
        var input = dir.File("in.json");
        var output = dir.File("out.json");
        File.WriteAllText(input, JsonSerializer.Serialize(new { chunks = chunks.Select(c => Convert.ToHexString(c)).ToArray() }));
        // the copy in the source tree imports ../../../web/protocol.js relative to itself
        var src = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(RepoPaths.WebProtocolJs!))!,
            "agent", "GlobalRemoteControl.Agent.Tests", "Fixtures", "browser-frames.mjs");
        var script = File.Exists(src) ? src : Path.Combine(AppContext.BaseDirectory, "Fixtures", "browser-frames.mjs");
        NodeRunner.Run(script, input, output);
        return JsonSerializer.Deserialize<List<BFrame>>(File.ReadAllText(output))!;
    }

    private static string Sha(byte[] d) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(d)).ToLowerInvariant();

    private static void AssertSame(FrameV2.Parsed agent, BFrame browser)
    {
        Assert.Null(browser.error);
        Assert.Equal(agent.Keyframe, browser.keyframe);
        Assert.Equal((agent.Width, agent.Height), (browser.width, browser.height));
        Assert.Equal(agent.Rects.Count, browser.rects!.Length);
        for (int i = 0; i < agent.Rects.Count; i++)
        {
            var (r, codec, data) = agent.Rects[i];
            var b = browser.rects[i];
            Assert.Equal((r.X, r.Y, r.Width, r.Height, (int)codec, data.Length, Sha(data)), (b.x, b.y, b.w, b.h, b.codec, b.length, b.sha256));
        }
    }

    [NodeFact]
    public void StreamerOutput_KeyframeDeltaHeartbeatScale_ParsesIdenticallyInBrowser()
    {
        var clock = new FakeClock();
        var screen = Px.Gradient(900, 500);
        var mons = new List<MonitorInfo> { new(0, "D1", @"\\.\DISPLAY1", new Rectangle(0, 0, 900, 500), true) };
        var chunks = new List<byte[]>();
        var s = new VideoStreamer(new FakeCapturer(screen), () => mons, 0, chunks.Add, () => 0, _ => { },
            new SkiaJpegEncoder(), () => default, () => clock.Now);
        s.SetQuality(30, 85, 1);
        var expected = new List<(uint Id, FrameV2.Parsed F)>();
        var reasm = new FrameReassembler();
        void Tick(double ms)
        {
            clock.AdvanceMs(ms);
            int before = chunks.Count;
            if (!s.CanProduce() || !s.ProduceFrame()) return;
            Assert.True(s.SendPending());
            foreach (var c in chunks.Skip(before).ToList())
                if (reasm.Add(c) is { } done) { expected.Add((done.FrameId, FrameV2.Read(done.Data)!)); s.Ack(done.FrameId); }
        }
        Tick(0);                                                                  // keyframe, several chunks
        Px.Fill(screen, new Rectangle(130, 70, 200, 90), 0, 0, 255); Tick(40);   // delta: merged runs
        Px.Set(screen, 899, 499, 255, 255, 255); Tick(40);                        // one pixel in the bottom-right edge tile
        Tick(1100);                                                               // static: heartbeat (rectCount 0)
        s.RequestKeyframe(); Tick(40);                                            // requested keyframe
        s.SetQuality(30, 70, 0.5); Tick(40);                                      // scale change → keyframe at 450×250

        Assert.True(chunks.Count > expected.Count, "the first keyframe should span several chunks");
        Assert.Contains(expected, e => e.F.Rects.Count == 0);
        Assert.Contains(expected, e => !e.F.Keyframe && e.F.Rects.Count > 0);
        Assert.Equal((450, 250), (expected[^1].F.Width, expected[^1].F.Height));

        var browser = Browser(chunks);
        Assert.Equal(expected.Count, browser.Count);
        for (int i = 0; i < expected.Count; i++)
        {
            Assert.Equal(expected[i].Id, (uint)browser[i].frameId);
            Assert.Equal("apply", browser[i].decision);
            Assert.False(browser[i].dropped);
            AssertSame(expected[i].F, browser[i]);
        }
        s.Dispose();
    }

    private static byte[] Big(int n, int seed) => Enumerable.Range(0, n).Select(i => (byte)(i * 7 + seed)).ToArray();

    [NodeFact]
    public void LostChunk_BrowserSkipsDeltasUntilKeyframe_ShuffledChunksStillReassemble()
    {
        var key = FrameV2.Write(true, 640, 360, new[] { new EncodedRect(0, 0, 640, 360, Big(40_000, 1), 40_000) });
        var bigDelta = FrameV2.Write(false, 640, 360, new[] { new EncodedRect(0, 0, 320, 192, Big(30_000, 2), 30_000) });
        var smallDelta = FrameV2.Write(false, 640, 360, new[] { new EncodedRect(576, 320, 64, 40, Big(500, 3), 500) });
        var key2 = FrameV2.Write(true, 640, 360, new[] { new EncodedRect(0, 0, 640, 360, Big(20_000, 4), 20_000) });

        var c1 = FrameChunker.Split(1, key);
        var c2 = FrameChunker.Split(2, bigDelta);
        Assert.True(c2.Count >= 2);
        var stream = new List<byte[]>();
        stream.AddRange(new[] { c1[2], c1[0], c1[1] });          // out of order: still one complete frame
        stream.AddRange(c2.Take(c2.Count - 1));                  // last chunk of frame 2 lost
        stream.AddRange(FrameChunker.Split(3, smallDelta));      // newer frame discards partial 2 → browser must skip
        stream.AddRange(FrameChunker.Split(4, smallDelta));      // still no keyframe → skip
        stream.AddRange(FrameChunker.Split(5, key2));            // keyframe → apply again
        stream.AddRange(FrameChunker.Split(6, smallDelta));

        var b = Browser(stream);
        Assert.Equal(new long[] { 1, 3, 4, 5, 6 }, b.Select(f => f.frameId));
        Assert.Equal(new[] { "apply", "skip", "skip", "apply", "apply" }, b.Select(f => f.decision));
        Assert.True(b[1].dropped);
        AssertSame(FrameV2.Read(key)!, b[0]);
        AssertSame(FrameV2.Read(key2)!, b[3]);
    }

    [NodeFact]
    public void EdgeCases_AgreeWithBrowser_AndMalformedRejectedByBoth()
    {
        var good = new List<byte[]>
        {
            FrameV2.Write(false, 1920, 1080, Array.Empty<EncodedRect>()),                                     // heartbeat
            FrameV2.Write(true, 1, 1, new[] { new EncodedRect(0, 0, 1, 1, new byte[] { 1 }, 1) }),             // 1×1
            FrameV2.Write(false, 1000, 700, new[] { new EncodedRect(960, 640, 40, 60, Big(10, 5), 10),         // clipped edge tiles
                                                    new EncodedRect(0, 640, 1000, 60, Big(16_100, 6), 16_100) }),
            FrameV2.Write(true, 65535, 65535, new[] { new EncodedRect(65471, 65471, 64, 64, Big(3, 7), 3) }),
        };
        var pristine = FrameV2.Write(true, 100, 100, new[] { new EncodedRect(0, 0, 10, 10, new byte[] { 1, 2, 3 }, 3) });
        byte[] Mut(Action<byte[]> m) { var x = (byte[])pristine.Clone(); m(x); return x; }
        var bad = new List<byte[]>
        {
            pristine[..7],                         // too short
            pristine[..^1],                        // truncated rect data
            pristine[..15],                        // truncated rect header
            Mut(x => x[0] = 1),                    // version
            Mut(x => x[16] = 1),                   // codec
            Mut(x => { x[2] = 0; x[3] = 0; }),     // width 0
            Mut(x => x[8] = 95),                   // x + w > width
            Mut(x => x[12] = 0),                   // w = 0
        };
        uint id = 0;
        var chunks = good.Concat(bad).SelectMany(f => FrameChunker.Split(++id, f)).ToList();
        var b = Browser(chunks);
        Assert.Equal(good.Count + bad.Count, b.Count);
        for (int i = 0; i < good.Count; i++) AssertSame(FrameV2.Read(good[i])!, b[i]);
        for (int i = 0; i < bad.Count; i++)
        {
            Assert.Null(FrameV2.Read(bad[i]));
            Assert.Equal("error", b[good.Count + i].decision);
        }
    }
}
