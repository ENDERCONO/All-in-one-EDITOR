using System.Buffers.Binary;
using System.Drawing;
using System.Text.Json;
using GlobalRemoteControl.Agent.Capture;

namespace GlobalRemoteControl.Agent.Tests;

// Fast video pipeline (PROTOCOL.md section 5): frame v2 layout, chunking, tile diff, box scaler, delta encoder (with a
// real JPEG round trip through SkiaSharp), flow-control window, keyframe policy, heartbeat, cursor messages.

public class VideoPipelineFrameV2Tests
{
    [Fact]
    public void Write_IsByteExact_LittleEndian()
    {
        var rects = new[]
        {
            new EncodedRect(0x0102, 0x0304, 0x0040, 0x0080, new byte[] { 0xAA, 0xBB, 0xCC }, 3),
            new EncodedRect(1, 2, 3, 4, new byte[] { 0x11, 0x22, 0x99 }, 2), // Length < Data.Length: only 2 bytes go out
        };
        var bytes = FrameV2.Write(true, 0x0500, 0x0400, rects);
        var expected = new byte[]
        {
            2, 1,               // version, flags (keyframe)
            0x00, 0x05,         // width 0x0500
            0x00, 0x04,         // height 0x0400
            0x02, 0x00,         // rectCount 2
            0x02, 0x01, 0x04, 0x03, 0x40, 0x00, 0x80, 0x00,  // x, y, w, h
            0,                  // codec JPEG
            0x03, 0x00, 0x00, 0x00, // length 3
            0xAA, 0xBB, 0xCC,
            0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00,
            0,
            0x02, 0x00, 0x00, 0x00,
            0x11, 0x22,
        };
        Assert.Equal(expected, bytes);
        Assert.Equal(FrameV2.Size(rects), bytes.Length);
    }

    [Fact]
    public void Heartbeat_IsEightBytes_NoKeyframeFlag()
    {
        var bytes = FrameV2.Write(false, 1920, 1080, Array.Empty<EncodedRect>());
        Assert.Equal(new byte[] { 2, 0, 0x80, 0x07, 0x38, 0x04, 0, 0 }, bytes);
        var p = FrameV2.Read(bytes)!;
        Assert.False(p.Keyframe);
        Assert.Empty(p.Rects);
        Assert.Equal((1920, 1080), (p.Width, p.Height));
    }

    [Fact]
    public void Header_Constants_MatchProtocol()
    {
        Assert.Equal(8, FrameV2.HeaderSize);
        Assert.Equal(13, FrameV2.RectHeaderSize); // 4×u16 + u8 + u32
        Assert.Equal(2, FrameV2.Version);
        Assert.Equal(1, FrameV2.FlagKeyframe);
        Assert.Equal(0, FrameV2.CodecJpeg);
    }

    [Fact]
    public void Read_RoundTrips()
    {
        var data = Enumerable.Range(0, 300).Select(i => (byte)i).ToArray();
        var bytes = FrameV2.Write(false, 640, 360, new[] { new EncodedRect(64, 128, 64, 64, data, data.Length), new EncodedRect(576, 320, 64, 40, new byte[] { 7 }, 1) });
        var p = FrameV2.Read(bytes)!;
        Assert.False(p.Keyframe);
        Assert.Equal(2, p.Rects.Count);
        Assert.Equal(new Rectangle(64, 128, 64, 64), p.Rects[0].Rect);
        Assert.Equal(data, p.Rects[0].Data);
        Assert.Equal(new Rectangle(576, 320, 64, 40), p.Rects[1].Rect);
    }

    [Fact]
    public void Read_RejectsMalformed_LikeTheBrowser()
    {
        var good = FrameV2.Write(true, 100, 100, new[] { new EncodedRect(0, 0, 10, 10, new byte[] { 1, 2, 3 }, 3) });
        Assert.NotNull(FrameV2.Read(good));
        Assert.Null(FrameV2.Read(good.AsSpan(0, 7)));                      // too short
        Assert.Null(FrameV2.Read(good.AsSpan(0, good.Length - 1)));        // truncated rect data
        Assert.Null(FrameV2.Read(good.AsSpan(0, 15)));                     // truncated rect header
        Assert.Null(FrameV2.Read(good.Concat(new byte[] { 0 }).ToArray())); // trailing bytes
        var bad = (byte[])good.Clone(); bad[0] = 1; Assert.Null(FrameV2.Read(bad));          // version
        bad = (byte[])good.Clone(); bad[16] = 1; Assert.Null(FrameV2.Read(bad));             // codec
        bad = (byte[])good.Clone(); bad[2] = 0; bad[3] = 0; Assert.Null(FrameV2.Read(bad));  // width 0
        bad = (byte[])good.Clone(); bad[8] = 95; Assert.Null(FrameV2.Read(bad));             // x + w > width
        bad = (byte[])good.Clone(); bad[12] = 0; Assert.Null(FrameV2.Read(bad));             // w = 0
    }

    [Theory]
    [InlineData(-1, 0, 10, 10)]
    [InlineData(0, 0, 0, 10)]
    [InlineData(0, 0, 10, 0)]
    [InlineData(95, 0, 10, 10)]
    [InlineData(0, 95, 10, 10)]
    public void Write_RefusesRectsTheBrowserWouldReject(int x, int y, int w, int h)
    {
        Assert.Throws<ArgumentException>(() => FrameV2.Write(false, 100, 100, new[] { new EncodedRect(x, y, w, h, new byte[1], 1) }));
    }

    [Fact]
    public void Write_RefusesBadPictureSize()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => FrameV2.Write(true, 0, 10, Array.Empty<EncodedRect>()));
        Assert.Throws<ArgumentOutOfRangeException>(() => FrameV2.Write(true, 10, 70000, Array.Empty<EncodedRect>()));
    }
}

public class VideoPipelineChunkTests
{
    [Fact]
    public void ChunkHeader_IsByteExact()
    {
        var chunks = FrameChunker.Split(0x01020304, new byte[] { 9, 8, 7 });
        var c = Assert.Single(chunks);
        Assert.Equal(new byte[] { 0x04, 0x03, 0x02, 0x01, 0x00, 0x00, 0x01, 0x00, 9, 8, 7 }, c);
    }

    [Theory]
    [InlineData(8, 1)]
    [InlineData(16000, 1)]
    [InlineData(16001, 2)]
    [InlineData(32000, 2)]
    [InlineData(32001, 3)]
    [InlineData(1_000_000, 63)]
    public void Split_PayloadsAtMost16000(int size, int expectedCount)
    {
        var frame = Enumerable.Range(0, size).Select(i => (byte)(i * 31)).ToArray();
        var chunks = FrameChunker.Split(77, frame);
        Assert.Equal(expectedCount, chunks.Count);
        for (int i = 0; i < chunks.Count; i++)
        {
            var c = chunks[i];
            Assert.InRange(c.Length - 8, 1, 16000);
            Assert.Equal(77u, BinaryPrimitives.ReadUInt32LittleEndian(c));
            Assert.Equal(i, BinaryPrimitives.ReadUInt16LittleEndian(c.AsSpan(4)));
            Assert.Equal(expectedCount, BinaryPrimitives.ReadUInt16LittleEndian(c.AsSpan(6)));
            if (i < chunks.Count - 1) Assert.Equal(16008, c.Length);
        }
        Assert.Equal(frame, chunks.SelectMany(c => c.Skip(8)).ToArray());
    }

    [Fact]
    public void Reassembler_OutOfOrder_AndNewerFrameDiscardsPartial()
    {
        var a = FrameChunker.Split(1, new byte[40000]);
        var bData = Enumerable.Range(0, 20000).Select(i => (byte)i).ToArray();
        var b = FrameChunker.Split(2, bData);
        var r = new FrameReassembler();
        Assert.Null(r.Add(a[2]));
        Assert.Null(r.Add(a[0]));
        Assert.Null(r.Add(b[1]));   // newer frame: drops the partial frame 1
        Assert.Null(r.Add(a[1]));   // stale chunk of frame 1: ignored
        var done = r.Add(b[0]);
        Assert.NotNull(done);
        Assert.Equal(2u, done!.Value.FrameId);
        Assert.Equal(bData, done.Value.Data);
    }
}

public class VideoPipelineTileDiffTests
{
    private static TileGrid Diff(FrameBuffer prev, FrameBuffer cur)
    {
        var g = new TileGrid();
        g.Resize(cur.Width, cur.Height);
        g.MarkAllCandidates();
        g.Compare(cur, prev);
        return g;
    }

    [Fact]
    public void NoChange_NoRects()
    {
        var a = Px.Gradient(300, 200);
        var g = Diff(a, Px.Clone(a));
        Assert.Equal(0, g.ChangedCount());
        Assert.Empty(g.MergeRects());
    }

    [Theory]
    [InlineData(0, 0, 0, 0)]
    [InlineData(63, 63, 0, 0)]
    [InlineData(64, 0, 64, 0)]
    [InlineData(200, 130, 192, 128)]
    public void SinglePixel_OneTile(int x, int y, int tx, int ty)
    {
        var a = Px.Gradient(320, 256);
        var b = Px.Clone(a);
        Px.Set(b, x, y, 1, 2, 3);
        var g = Diff(a, b);
        Assert.Equal(1, g.ChangedCount());
        Assert.Equal(new[] { new Rectangle(tx, ty, 64, 64) }, g.MergeRects());
    }

    [Fact]
    public void AlphaOnlyChange_CountsAsChange()
    {
        // the diff is a plain memcmp of the 4 bytes; a capture that flips alpha still produces a rect (harmless)
        var a = Px.Solid(64, 64, 1, 1, 1);
        var b = Px.Clone(a);
        b.Pixels[3] = 0;
        Assert.Equal(1, Diff(a, b).ChangedCount());
    }

    [Fact]
    public void AdjacentTilesInARow_MergeHorizontally()
    {
        var a = Px.Solid(512, 128, 0, 0, 0);
        var b = Px.Clone(a);
        Px.Set(b, 70, 10, 255, 255, 255);   // tile col 1
        Px.Set(b, 130, 60, 255, 255, 255);  // tile col 2
        Px.Set(b, 200, 0, 255, 255, 255);   // tile col 3
        Px.Set(b, 400, 5, 255, 255, 255);   // tile col 6 (gap)
        var rects = Diff(a, b).MergeRects();
        Assert.Equal(new[] { new Rectangle(64, 0, 192, 64), new Rectangle(384, 0, 64, 64) }, rects);
    }

    [Fact]
    public void SameSpanOnConsecutiveRows_MergeVertically_DifferentSpansDont()
    {
        var a = Px.Solid(256, 256, 0, 0, 0);
        var b = Px.Clone(a);
        Px.Fill(b, new Rectangle(64, 0, 128, 128), 9, 9, 9); // cols 1-2, rows 0-1 → one 128×128 rect
        Px.Set(b, 0, 200, 9, 9, 9);                          // row 3, col 0
        Px.Set(b, 100, 200, 9, 9, 9);                        // row 3, col 1 → merged with col 0 horizontally
        var rects = Diff(a, b).MergeRects();
        Assert.Equal(new[] { new Rectangle(64, 0, 128, 128), new Rectangle(0, 192, 128, 64) }, rects);
    }

    [Fact]
    public void EdgeTiles_OfNonMultipleOf64Sizes_AreClipped()
    {
        var a = Px.Gradient(130, 70);
        var g0 = new TileGrid();
        g0.Resize(130, 70);
        Assert.Equal((3, 2), (g0.Cols, g0.Rows));
        Assert.Equal(new Rectangle(128, 64, 2, 6), g0.TileRect(2, 1));

        var b = Px.Clone(a);
        Px.Set(b, 129, 69, 0, 0, 0);
        var g = Diff(a, b);
        Assert.Equal(new[] { new Rectangle(128, 64, 2, 6) }, g.MergeRects());
        Assert.Equal(12, g.ChangedArea());

        var c = Px.Clone(a);
        Px.Set(c, 0, 69, 0, 0, 0);
        Px.Set(c, 70, 69, 0, 0, 0);
        Px.Set(c, 129, 69, 0, 0, 0);
        Assert.Equal(new[] { new Rectangle(0, 64, 130, 6) }, Diff(a, c).MergeRects());

        g.MarkAllChanged();
        Assert.Equal(new[] { new Rectangle(0, 0, 130, 70) }, g.MergeRects());
        Assert.Equal(130 * 70, g.ChangedArea());
    }

    [Fact]
    public void TinyPicture_SmallerThanATile()
    {
        var a = Px.Solid(5, 3, 0, 0, 0);
        var b = Px.Clone(a);
        Px.Set(b, 4, 2, 1, 1, 1);
        Assert.Equal(new[] { new Rectangle(0, 0, 5, 3) }, Diff(a, b).MergeRects());
    }

    [Fact]
    public void OnlyCandidateTilesAreCompared()
    {
        var a = Px.Solid(256, 64, 0, 0, 0);
        var b = Px.Clone(a);
        Px.Set(b, 10, 10, 5, 5, 5);   // tile 0
        Px.Set(b, 200, 10, 5, 5, 5);  // tile 3
        var g = new TileGrid();
        g.Resize(256, 64);
        g.ClearCandidates();
        g.MarkCandidates(new Rectangle(190, 0, 20, 20));
        g.Compare(b, a);
        Assert.Equal(new[] { new Rectangle(192, 0, 64, 64) }, g.MergeRects());
    }

    [Fact]
    public void ManyCandidates_ParallelCompare_SameResult()
    {
        var a = Px.Gradient(1920, 1080);
        var b = Px.Clone(a);
        var rnd = new Random(5);
        var expected = new HashSet<(int, int)>();
        for (int i = 0; i < 40; i++)
        {
            int x = rnd.Next(1920), y = rnd.Next(1080);
            Px.Set(b, x, y, (byte)~Px.Get(a, x, y).B, 0, 0);
            expected.Add((x / 64, y / 64));
        }
        var g = Diff(a, b);
        Assert.Equal(expected.Count, g.ChangedCount());
        foreach (var (c, r) in expected) Assert.True(g.Changed[r * g.Cols + c]);
        // every changed tile is covered by exactly one merged rect, and nothing else is
        var rects = g.MergeRects();
        long area = rects.Sum(r => (long)r.Width * r.Height);
        Assert.Equal(g.ChangedArea(), area);
    }

    [Fact]
    public void Compare_SizeMismatch_Throws()
    {
        var g = new TileGrid();
        g.Resize(64, 64);
        Assert.Throws<ArgumentException>(() => g.Compare(new FrameBuffer(64, 64), new FrameBuffer(65, 64)));
    }
}

public class VideoPipelineBoxScalerTests
{
    [Theory]
    [InlineData(1920, 1080, 1.0, 1920, 1080)]
    [InlineData(1920, 1080, 0.5, 960, 540)]
    [InlineData(1920, 1080, 0.75, 1440, 810)]
    [InlineData(2560, 1440, 0.25, 640, 360)]
    [InlineData(1366, 768, 0.33, 451, 253)]
    [InlineData(3, 3, 0.25, 1, 1)]
    public void TargetSize(int w, int h, double scale, int ew, int eh)
    {
        Assert.Equal((ew, eh), DeltaEncoder.TargetSize(w, h, scale));
    }

    [Fact]
    public void HalfScale_AveragesEach2x2Block_WithRounding()
    {
        var src = new FrameBuffer(4, 2);
        // block 0: B values 0,1,2,4 → 7/4 = 1.75 → 2 ; block 1: B 10,10,10,11 → 10.25 → 10
        Px.Set(src, 0, 0, 0, 100, 200); Px.Set(src, 1, 0, 1, 100, 200); Px.Set(src, 0, 1, 2, 100, 201); Px.Set(src, 1, 1, 4, 100, 201);
        Px.Set(src, 2, 0, 10, 0, 255); Px.Set(src, 3, 0, 10, 0, 255); Px.Set(src, 2, 1, 10, 1, 255); Px.Set(src, 3, 1, 11, 1, 255);
        var dst = new FrameBuffer(2, 1);
        new BoxScaler().Scale(src, dst);
        Assert.Equal((2, 100, 201), ToTuple(Px.Get(dst, 0, 0)));   // R 200.5 rounds up
        Assert.Equal((10, 1, 255), ToTuple(Px.Get(dst, 1, 0)));    // G 0.5 rounds up
        Assert.Equal(255, dst.Pixels[3]);
        Assert.Equal(255, dst.Pixels[7]);
    }

    private static (int, int, int) ToTuple((byte B, byte G, byte R) p) => (p.B, p.G, p.R);

    [Fact]
    public void NonIntegerRatio_UsesWholePixelFootprints()
    {
        // 3 → 2 columns: dst 0 = src 0, dst 1 = avg(src 1, src 2)
        var src = new FrameBuffer(3, 1);
        Px.Set(src, 0, 0, 30, 0, 0); Px.Set(src, 1, 0, 60, 0, 0); Px.Set(src, 2, 0, 90, 0, 0);
        var dst = new FrameBuffer(2, 1);
        new BoxScaler().Scale(src, dst);
        Assert.Equal(30, Px.Get(dst, 0, 0).B);
        Assert.Equal(75, Px.Get(dst, 1, 0).B);
    }

    [Fact]
    public void SolidColour_StaysExact_AtEveryScale()
    {
        var src = Px.Solid(333, 177, 12, 200, 99);
        foreach (var s in new[] { 1.0, 0.75, 0.5, 0.33, 0.25 })
        {
            var (w, h) = DeltaEncoder.TargetSize(src.Width, src.Height, s);
            var dst = new FrameBuffer(w, h);
            new BoxScaler().Scale(src, dst);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) Assert.Equal((12, 200, 99), ToTuple(Px.Get(dst, x, y)));
        }
    }

    [Fact]
    public void ScaleRect_MatchesFullRescale_ForMappedDirtyRect()
    {
        var a = Px.Gradient(1000, 600);
        var b = Px.Clone(a);
        var dirty = new Rectangle(333, 217, 41, 29);
        Px.Fill(b, dirty, 250, 3, 77);
        var (w, h) = DeltaEncoder.TargetSize(1000, 600, 0.75);
        var scaler = new BoxScaler();
        var partial = new FrameBuffer(w, h);
        scaler.Scale(a, partial);
        scaler.ScaleRect(b, partial, BoxScaler.MapToDst(dirty, 1000, 600, w, h));
        var full = new FrameBuffer(w, h);
        new BoxScaler().Scale(b, full);
        Assert.Equal(full.Span.ToArray(), partial.Span.ToArray());
    }

    [Fact]
    public void LargeFrame_ParallelBands_SameAsSerial()
    {
        var src = Px.Gradient(1920, 1080, 3);
        var whole = new FrameBuffer(960, 540);
        new BoxScaler().Scale(src, whole); // ≥ 64K pixels → banded in parallel
        var pieces = new FrameBuffer(960, 540);
        var s = new BoxScaler();
        for (int y = 0; y < 540; y += 60) s.ScaleRect(src, pieces, new Rectangle(0, y, 960, 60)); // < 64K each → serial
        Assert.Equal(whole.Span.ToArray(), pieces.Span.ToArray());
    }

    [Fact]
    public void RefusesUpscaleAndExtremeRatios()
    {
        var s = new BoxScaler();
        Assert.Throws<ArgumentException>(() => s.Scale(new FrameBuffer(10, 10), new FrameBuffer(20, 10)));
        Assert.Throws<ArgumentException>(() => s.Scale(new FrameBuffer(170, 10), new FrameBuffer(10, 10)));
    }
}

public class VideoPipelineDeltaEncoderTests
{
    private static readonly IRectEncoder Jpeg = new SkiaJpegEncoder();

    private static FrameV2.Parsed Parse(byte[] payload) => FrameV2.Read(payload) ?? throw new Xunit.Sdk.XunitException("payload does not parse");

    [Fact]
    public void SkiaJpeg_EncodesSubRect_InPlace()
    {
        var f = Px.Solid(200, 100, 0, 0, 0);
        Px.Fill(f, new Rectangle(50, 20, 30, 40), 10, 200, 30);
        var jpg = Jpeg.Encode(f, new Rectangle(50, 20, 30, 40), 90);
        Assert.Equal(0xFF, jpg[0]); Assert.Equal(0xD8, jpg[1]);  // SOI
        var img = Px.DecodeJpeg(jpg);
        Assert.Equal((30, 40), (img.Width, img.Height));
        var (b, g, r) = Px.Get(img, 15, 20);
        Assert.InRange(b, 0, 25); Assert.InRange(g, 185, 215); Assert.InRange(r, 15, 45);
        Assert.Equal("skia", Jpeg.Name);
    }

    [Fact]
    public void FirstFrame_IsKeyframe_FullPicture_DecodesBack()
    {
        var enc = new DeltaEncoder(Jpeg, workers: 1);
        var src = Px.Gradient(320, 200);
        var payload = enc.Encode(src, AllDirty(), 1, 95, false, out bool key)!;
        Assert.True(key);
        var p = Parse(payload);
        Assert.True(p.Keyframe);
        Assert.Equal((320, 200), (p.Width, p.Height));
        Assert.Equal(new Rectangle(0, 0, 320, 200), Assert.Single(p.Rects).Rect);
        var canvas = Px.Paint(null, p);
        var (mean, _) = Px.Diff(canvas, src);
        Assert.True(mean < 2.5, $"mean error {mean}");
    }

    [Fact]
    public void NoChange_ReturnsNull_NotKeyframe()
    {
        var enc = new DeltaEncoder(new FakeRectEncoder(), workers: 1);
        var src = Px.Gradient(200, 100);
        Assert.NotNull(enc.Encode(src, AllDirty(), 1, 70, false, out _));
        Assert.Null(enc.Encode(Px.Clone(src), AllDirty(), 1, 70, false, out bool key));
        Assert.False(key);
        Assert.Equal(0, enc.Last!.Rects);
    }

    [Fact]
    public void SmallChange_DeltaRect_PaintsBackToTheNewPicture()
    {
        var enc = new DeltaEncoder(Jpeg, workers: 1);
        var a = Px.Solid(400, 300, 40, 40, 40);
        var canvas = Px.Paint(null, Parse(enc.Encode(a, AllDirty(), 1, 95, false, out _)!));
        var before = Px.Clone(canvas);

        var b = Px.Clone(a);
        Px.Fill(b, new Rectangle(100, 70, 20, 10), 0, 0, 255);   // inside tile (1,1)
        var p = Parse(enc.Encode(b, AllDirty(), 1, 95, false, out bool key)!);
        Assert.False(key);
        Assert.False(p.Keyframe);
        Assert.Equal(new Rectangle(64, 64, 64, 64), Assert.Single(p.Rects).Rect);
        canvas = Px.Paint(canvas, p);

        // pixels outside the sent rect are untouched; inside they match the new picture
        for (int y = 0; y < 300; y += 3)
            for (int x = 0; x < 400; x += 3)
                if (!p.Rects[0].Rect.Contains(x, y)) Assert.Equal(Px.Get(before, x, y), Px.Get(canvas, x, y));
        var (bb, gg, rr) = Px.Get(canvas, 110, 75);
        Assert.True(bb < 30 && gg < 30 && rr > 225, $"got {bb},{gg},{rr}");
        Assert.True(Px.Diff(canvas, b).Mean < 1.5);
    }

    [Fact]
    public void ForceKeyframe_And_Reset_And_SizeChange_GiveKeyframes()
    {
        var enc = new DeltaEncoder(new FakeRectEncoder(), workers: 1);
        var a = Px.Gradient(200, 100);
        enc.Encode(a, AllDirty(), 1, 70, false, out _);
        var p = Parse(enc.Encode(a, AllDirty(), 1, 70, true, out bool key)!);
        Assert.True(key); Assert.True(p.Keyframe);

        enc.Reset();
        Assert.True(Parse(enc.Encode(a, AllDirty(), 1, 70, false, out key)!).Keyframe);
        Assert.True(key);

        p = Parse(enc.Encode(Px.Gradient(300, 100), AllDirty(), 1, 70, false, out key)!);
        Assert.True(key); Assert.Equal(300, p.Width);

        p = Parse(enc.Encode(Px.Gradient(300, 100), AllDirty(), 0.5, 70, false, out key)!);
        Assert.True(key); Assert.Equal((150, 50), (p.Width, p.Height));
    }

    [Fact]
    public void MostOfThePictureChanged_PromotedToKeyframe()
    {
        var enc = new DeltaEncoder(new FakeRectEncoder(), workers: 1);
        enc.Encode(Px.Solid(256, 256, 0, 0, 0), AllDirty(), 1, 70, false, out _);
        var b = Px.Solid(256, 256, 0, 0, 0);
        Px.Fill(b, new Rectangle(0, 0, 256, 192), 1, 1, 1);    // 75 % > 60 %
        var p = Parse(enc.Encode(b, AllDirty(), 1, 70, false, out bool key)!);
        Assert.True(key);
        Assert.Equal(new Rectangle(0, 0, 256, 256), Assert.Single(p.Rects).Rect);

        var c = Px.Clone(b);
        Px.Fill(c, new Rectangle(0, 0, 256, 128), 2, 2, 2);    // 50 % → still a delta
        p = Parse(enc.Encode(c, AllDirty(), 1, 70, false, out key)!);
        Assert.False(key);
        Assert.Equal(new Rectangle(0, 0, 256, 128), Assert.Single(p.Rects).Rect);
    }

    [Fact]
    public void Scaled_DeltaRects_InScaledCoordinates()
    {
        var enc = new DeltaEncoder(new FakeRectEncoder(), workers: 1);
        var a = Px.Solid(1280, 720, 0, 0, 0);
        enc.Encode(a, AllDirty(), 0.5, 70, false, out _);
        var b = Px.Clone(a);
        Px.Fill(b, new Rectangle(700, 300, 4, 4), 200, 200, 200);  // → (350,150) scaled → tile (5,2)
        var p = Parse(enc.Encode(b, AllDirty(), 0.5, 70, false, out bool key)!);
        Assert.False(key);
        Assert.Equal((640, 360), (p.Width, p.Height));
        Assert.Equal(new Rectangle(320, 128, 64, 64), Assert.Single(p.Rects).Rect);
    }

    [Fact]
    public void DirtyHint_WithScale_OnlyRescalesHintedArea_AndStaysCorrect()
    {
        var enc = new DeltaEncoder(Jpeg, workers: 1);
        var scaler = new BoxScaler();
        var screen = Px.Gradient(1000, 700);
        var canvas = Px.Paint(null, Parse(enc.Encode(screen, AllDirty(), 0.75, 95, false, out _)!));
        var rnd = new Random(42);
        for (int step = 0; step < 6; step++)
        {
            var dirty = new DirtyRegion();
            dirty.Reset();
            for (int k = 0; k < 3; k++)
            {
                var r = new Rectangle(rnd.Next(900), rnd.Next(600), 10 + rnd.Next(90), 10 + rnd.Next(90));
                Px.Fill(screen, Rectangle.Intersect(r, new Rectangle(0, 0, 1000, 700)), (byte)rnd.Next(256), (byte)rnd.Next(256), (byte)rnd.Next(256));
                dirty.Add(r, new Size(1000, 700));
            }
            var payload = enc.Encode(screen, dirty, 0.75, 95, false, out _);
            if (payload != null) canvas = Px.Paint(canvas, Parse(payload));
        }
        var expected = new FrameBuffer(750, 525);
        scaler.Scale(screen, expected);
        var (mean, _) = Px.Diff(canvas, expected);
        Assert.True(mean < 3, $"mean error {mean}");
    }

    [Theory]
    [InlineData(1.0, 1)]
    [InlineData(0.5, 4)]
    public void RandomSequence_CanvasTracksTheScreen(double scale, int workers)
    {
        var enc = new DeltaEncoder(Jpeg, workers);
        var rnd = new Random(7);
        var screen = Px.Gradient(700, 450, 1);
        FrameBuffer? canvas = null;
        int deltas = 0;
        for (int step = 0; step < 12; step++)
        {
            if (step > 0)
            {
                int n = rnd.Next(0, 4);
                for (int k = 0; k < n; k++)
                    Px.Fill(screen, Rectangle.Intersect(new Rectangle(rnd.Next(700), rnd.Next(450), 5 + rnd.Next(150), 5 + rnd.Next(100)), new Rectangle(0, 0, 700, 450)),
                        (byte)rnd.Next(256), (byte)rnd.Next(256), (byte)rnd.Next(256));
            }
            var payload = enc.Encode(screen, AllDirty(), scale, 92, false, out bool key);
            if (payload == null) continue;
            var p = Parse(payload);
            Assert.Equal(key, p.Keyframe);
            if (!key) deltas++;
            canvas = Px.Paint(canvas, p);
        }
        Assert.True(deltas > 0);
        var (w, h) = DeltaEncoder.TargetSize(700, 450, scale);
        var expected = new FrameBuffer(w, h);
        new BoxScaler().Scale(screen, expected);
        var (mean, _) = Px.Diff(canvas!, expected);
        Assert.True(mean < 3, $"mean error {mean}");
    }

    [Fact]
    public void SplitForParallel_BandsAreTileAligned_AndCoverTheRect()
    {
        var r = new Rectangle(0, 0, 1920, 1080);
        var bands = DeltaEncoder.SplitForParallel(new List<Rectangle> { r }, 4);
        Assert.Equal(4, bands.Count);
        int y = 0;
        foreach (var b in bands)
        {
            Assert.Equal(y, b.Top);
            Assert.Equal(0, b.Top % 64);
            Assert.Equal(1920, b.Width);
            y = b.Bottom;
        }
        Assert.Equal(1080, y);
        Assert.Single(DeltaEncoder.SplitForParallel(new List<Rectangle> { new(0, 0, 64, 64) }, 8));
        Assert.Single(DeltaEncoder.SplitForParallel(new List<Rectangle> { r }, 1));
    }

    private static DirtyRegion AllDirty() { var d = new DirtyRegion(); d.SetAll(); return d; }
}

public class VideoPipelineAckWindowTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void LimitsTo6Frames()
    {
        var w = new AckWindow();
        for (uint i = 1; i <= 6; i++)
        {
            Assert.True(w.CanSend(0, T0));
            Assert.Equal(i, w.NextFrameId());
            w.OnSent(i, 1000, T0);
        }
        Assert.False(w.CanSend(0, T0));
        Assert.Equal(6, w.UnackedFrames);
        Assert.True(w.OnAck(1, T0));
        Assert.True(w.CanSend(0, T0));
        Assert.Equal(5, w.UnackedFrames);
    }

    [Fact]
    public void LimitsTo1_5MB_ButOneBigFrameMayGoAlone()
    {
        var w = new AckWindow();
        w.OnSent(1, 800_000, T0);
        Assert.True(w.CanSend(0, T0));
        w.OnSent(2, 800_000, T0);
        Assert.Equal(1_600_000, w.UnackedBytes);
        Assert.False(w.CanSend(0, T0));     // ≥ 1.5 MB
        Assert.True(w.OnAck(2, T0));        // cumulative ack
        Assert.Equal(0, w.UnackedBytes);
        Assert.Equal(0, w.UnackedFrames);

        w.OnSent(3, 3_000_000, T0);         // bigger than the whole budget: allowed when nothing is outstanding
        Assert.False(w.CanSend(0, T0));
        Assert.Equal(1536 * 1024, AckWindow.MaxUnackedBytes);
    }

    [Fact]
    public void BufferedAmountAtOrAbove1MB_Blocks()
    {
        var w = new AckWindow();
        Assert.True(w.CanSend(1024 * 1024 - 1, T0));
        Assert.False(w.CanSend(1024 * 1024, T0));
    }

    [Fact]
    public void Acks_OnlyForSentAndNewerFrames()
    {
        var w = new AckWindow();
        Assert.False(w.OnAck(1, T0));       // nothing sent
        w.OnSent(1, 10, T0); w.OnSent(2, 10, T0); w.OnSent(3, 10, T0);
        Assert.False(w.OnAck(4, T0));       // future
        Assert.False(w.OnAck(0, T0));
        Assert.True(w.OnAck(2, T0));
        Assert.False(w.OnAck(2, T0));       // duplicate
        Assert.False(w.OnAck(1, T0));       // older
        Assert.Equal(1, w.UnackedFrames);
        Assert.Equal(2u, w.LastAcked);
        Assert.Equal(3u, w.LastSent);
    }

    [Fact]
    public void StalledAcks_ResetTheWindowAfter5s()
    {
        var w = new AckWindow();
        for (uint i = 1; i <= 6; i++) w.OnSent(i, 10, T0);
        Assert.False(w.CanSend(0, T0 + TimeSpan.FromSeconds(4.9)));
        Assert.True(w.CanSend(0, T0 + TimeSpan.FromSeconds(5.1)));
        Assert.Equal(0, w.UnackedFrames);
        Assert.False(w.OnAck(3, T0 + TimeSpan.FromSeconds(6)));   // late ack for a forgotten frame: ignored
        Assert.Equal(7u, w.NextFrameId());                         // ids keep increasing
    }

    [Fact]
    public void AckProgress_PostponesTheStallReset()
    {
        var w = new AckWindow();
        for (uint i = 1; i <= 6; i++) w.OnSent(i, 10, T0);
        Assert.True(w.OnAck(1, T0 + TimeSpan.FromSeconds(4)));
        w.OnSent(7, 10, T0 + TimeSpan.FromSeconds(4));
        Assert.False(w.CanSend(0, T0 + TimeSpan.FromSeconds(8)));   // only 4 s since the last ack
        Assert.True(w.CanSend(0, T0 + TimeSpan.FromSeconds(9.5)));
    }

    [Fact]
    public void Reset_ForgetsOutstandingFrames()
    {
        var w = new AckWindow();
        for (uint i = 1; i <= 6; i++) w.OnSent(i, 300_000, T0);
        w.Reset(T0);
        Assert.Equal(0, w.UnackedFrames);
        Assert.Equal(0, w.UnackedBytes);
        Assert.True(w.CanSend(0, T0));
        Assert.False(w.OnAck(6, T0));
        Assert.Equal(7u, w.NextFrameId());
    }
}

public class VideoPipelineKeyframePolicyTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void SessionStart_Request_Interval_AndChanges()
    {
        var k = new KeyframePolicy();
        Assert.True(k.ShouldSend(T0, 0, 1920, 1080, 1));       // session start
        k.OnSent(T0);
        Assert.False(k.ShouldSend(T0.AddSeconds(1), 0, 1920, 1080, 1));

        k.Request();
        Assert.True(k.Pending);
        Assert.True(k.ShouldSend(T0.AddSeconds(2), 0, 1920, 1080, 1));
        Assert.False(k.Pending);
        k.OnSent(T0.AddSeconds(2));
        Assert.False(k.ShouldSend(T0.AddSeconds(3), 0, 1920, 1080, 1));

        Assert.False(k.ShouldSend(T0.AddSeconds(11.9), 0, 1920, 1080, 1));
        Assert.True(k.ShouldSend(T0.AddSeconds(12), 0, 1920, 1080, 1));   // 10 s after the last keyframe
        k.OnSent(T0.AddSeconds(12));

        Assert.True(k.ShouldSend(T0.AddSeconds(13), 1, 1920, 1080, 1));    // monitor
        Assert.False(k.ShouldSend(T0.AddSeconds(13), 1, 1920, 1080, 1));
        Assert.True(k.ShouldSend(T0.AddSeconds(13), 1, 1280, 1080, 1));    // resolution
        Assert.True(k.ShouldSend(T0.AddSeconds(13), 1, 1280, 720, 1));
        Assert.True(k.ShouldSend(T0.AddSeconds(13), 1, 1280, 720, 0.5));   // scale
        Assert.False(k.ShouldSend(T0.AddSeconds(13), 1, 1280, 720, 0.5));
    }

    [Fact]
    public void RequestDuringEncode_IsNotLost()
    {
        var k = new KeyframePolicy();
        Assert.True(k.ShouldSend(T0, 0, 100, 100, 1));
        k.Request();            // arrives while the keyframe above is being encoded
        k.OnSent(T0);
        Assert.True(k.ShouldSend(T0.AddMilliseconds(16), 0, 100, 100, 1));
    }

    [Fact]
    public void AutoPromotedKeyframe_RestartsTheInterval()
    {
        var k = new KeyframePolicy();
        k.ShouldSend(T0, 0, 100, 100, 1); k.OnSent(T0);
        k.OnSent(T0.AddSeconds(8));      // encoder promoted a big change to a keyframe
        Assert.False(k.ShouldSend(T0.AddSeconds(12), 0, 100, 100, 1));
        Assert.True(k.ShouldSend(T0.AddSeconds(18), 0, 100, 100, 1));
    }
}

public class VideoPipelineStreamerTests
{
    private sealed class Rig
    {
        public readonly FakeClock Clock = new();
        public readonly FakeCapturer Capturer;
        public readonly List<MonitorInfo> Monitors;
        public readonly List<byte[]> Chunks = new();
        public readonly List<JsonElement> Control = new();
        public readonly FrameReassembler Reassembler = new();
        public CursorState Cursor;
        public ulong Buffered;
        public readonly VideoStreamer S;

        public Rig(FrameBuffer screen, IRectEncoder? encoder = null)
        {
            Capturer = new FakeCapturer(screen);
            Monitors = new List<MonitorInfo>
            {
                new(0, "Display 1", @"\\.\DISPLAY1", new Rectangle(0, 0, screen.Width, screen.Height), true),
                new(1, "Display 2", @"\\.\DISPLAY2", new Rectangle(screen.Width, 0, 800, 600), false),
            };
            S = new VideoStreamer(Capturer, () => Monitors, 0, c => Chunks.Add(c), () => Buffered,
                m => Control.Add(Msg.Of(m)), encoder ?? new FakeRectEncoder(), () => Cursor, () => Clock.Now);
        }

        /// <summary>Like the capture thread for one tick: produce if the window allows, then send; returns the parsed frame.</summary>
        public (uint Id, FrameV2.Parsed Frame)? Tick(double advanceMs = 0)
        {
            Clock.AdvanceMs(advanceMs);
            if (!S.CanProduce()) return null;
            int before = Chunks.Count;
            if (!S.ProduceFrame()) return null;
            Assert.True(S.SendPending());
            (uint, byte[])? done = null;
            foreach (var c in Chunks.Skip(before)) done = Reassembler.Add(c) ?? done;
            Assert.NotNull(done);
            return (done!.Value.Item1, FrameV2.Read(done.Value.Item2) ?? throw new Xunit.Sdk.XunitException("bad payload"));
        }

        public List<JsonElement> ControlOfType(string t) => Control.Where(c => c.GetProperty("t").GetString() == t).ToList();
    }

    [Fact]
    public void FirstFrame_MonitorMessage_ThenKeyframeWithId1()
    {
        var rig = new Rig(Px.Gradient(320, 200));
        var f = rig.Tick()!.Value;
        Assert.Equal(1u, f.Id);
        Assert.True(f.Frame.Keyframe);
        Assert.Equal((320, 200), (f.Frame.Width, f.Frame.Height));
        var mon = Assert.Single(rig.ControlOfType("monitor"));
        Assert.Equal(0, mon.GetProperty("index").GetInt32());
        Assert.Equal(320, mon.GetProperty("width").GetInt32());
        Assert.Equal(200, mon.GetProperty("height").GetInt32());
        Assert.Equal(1, rig.S.FramesSent);
        Assert.True(rig.Capturer.LastDrawCursor);   // default: cursor drawn into frames
    }

    [Fact]
    public void StaticScreen_NoFrames_ExceptHeartbeatAtMostOncePerSecond()
    {
        var rig = new Rig(Px.Gradient(320, 200));
        rig.Tick();
        rig.S.Ack(1);
        int frames = 1;
        var heartbeats = new List<DateTime>();
        for (int i = 0; i < 300; i++)   // 5 s at 60 fps
        {
            var f = rig.Tick(1000.0 / 60);
            if (f == null) continue;
            frames++;
            Assert.False(f.Value.Frame.Keyframe);
            Assert.Empty(f.Value.Frame.Rects);   // rectCount 0
            Assert.Equal((320, 200), (f.Value.Frame.Width, f.Value.Frame.Height));
            heartbeats.Add(rig.Clock.Now);
            rig.S.Ack(f.Value.Id);
        }
        Assert.InRange(heartbeats.Count, 4, 5);
        for (int i = 1; i < heartbeats.Count; i++) Assert.True(heartbeats[i] - heartbeats[i - 1] >= TimeSpan.FromSeconds(1));
        Assert.Equal(frames, rig.S.FramesSent);
    }

    [Fact]
    public void Change_SendsOnlyTheChangedTiles_AndResetsHeartbeatTimer()
    {
        var screen = Px.Solid(320, 200, 0, 0, 0);
        var rig = new Rig(screen);
        rig.Tick(); rig.S.Ack(1);
        rig.Clock.AdvanceMs(900);
        Px.Set(screen, 130, 70, 255, 255, 255);
        var f = rig.Tick()!.Value;
        Assert.False(f.Frame.Keyframe);
        Assert.Equal(new Rectangle(128, 64, 64, 64), Assert.Single(f.Frame.Rects).Rect);
        rig.S.Ack(f.Id);
        Assert.Null(rig.Tick(500));      // 0.5 s after the last frame: no heartbeat yet
        Assert.NotNull(rig.Tick(600));   // 1.1 s: heartbeat
    }

    [Fact]
    public void KeyframeRequest_GivesKeyframe()
    {
        var screen = Px.Solid(320, 200, 0, 0, 0);
        var rig = new Rig(screen);
        rig.Tick(); rig.S.Ack(1);
        rig.S.RequestKeyframe();
        var f = rig.Tick(16)!.Value;      // even with an unchanged screen
        Assert.True(f.Frame.Keyframe);
        Assert.Equal(new Rectangle(0, 0, 320, 200), Assert.Single(f.Frame.Rects).Rect);
        rig.S.Ack(f.Id);
        Assert.Null(rig.Tick(16));
    }

    [Fact]
    public void PeriodicKeyframe_Every10s()
    {
        var screen = Px.Solid(160, 120, 0, 0, 0);
        var rig = new Rig(screen);
        var keyTimes = new List<DateTime>();
        var start = rig.Clock.Now;
        for (int i = 0; i < 25 * 30; i++)   // 25 s at 30 fps, screen changes all the time (a small corner)
        {
            Px.Set(screen, 0, 0, (byte)i, 0, 0);
            var f = rig.Tick(1000.0 / 30);
            if (f == null) continue;
            if (f.Value.Frame.Keyframe) keyTimes.Add(rig.Clock.Now);
            rig.S.Ack(f.Value.Id);
        }
        Assert.Equal(3, keyTimes.Count);  // start, +10 s, +20 s
        Assert.InRange((keyTimes[1] - keyTimes[0]).TotalSeconds, 10, 10.1);
        Assert.InRange((keyTimes[2] - keyTimes[1]).TotalSeconds, 10, 10.1);
    }

    [Fact]
    public void MonitorSwitch_SendsMonitorMessage_AndKeyframe()
    {
        var rig = new Rig(Px.Solid(320, 200, 0, 0, 0));
        rig.Tick(); rig.S.Ack(1);
        Assert.False(rig.S.SelectMonitor(5));
        Assert.True(rig.S.SelectMonitor(1));
        rig.Capturer.Screen = Px.Solid(800, 600, 9, 9, 9);
        var f = rig.Tick(16)!.Value;
        Assert.True(f.Frame.Keyframe);
        Assert.Equal((800, 600), (f.Frame.Width, f.Frame.Height));
        Assert.Equal(1, rig.Capturer.LastMonitor!.Index);
        var mons = rig.ControlOfType("monitor");
        Assert.Equal(2, mons.Count);
        Assert.Equal(1, mons[1].GetProperty("index").GetInt32());
        Assert.Equal(800, mons[1].GetProperty("width").GetInt32());
    }

    [Fact]
    public void ResolutionChange_SameMonitor_MonitorMessageAndKeyframe()
    {
        var rig = new Rig(Px.Solid(320, 200, 0, 0, 0));
        rig.Tick(); rig.S.Ack(1);
        rig.Capturer.Screen = Px.Solid(256, 192, 0, 0, 0);
        var f = rig.Tick(16)!.Value;
        Assert.True(f.Frame.Keyframe);
        Assert.Equal((256, 192), (f.Frame.Width, f.Frame.Height));
        Assert.Equal(256, rig.ControlOfType("monitor")[1].GetProperty("width").GetInt32());
    }

    [Fact]
    public void ScaleChange_KeyframeAtNewSize_CursorFlagPassedToCapturer()
    {
        var rig = new Rig(Px.Solid(320, 200, 0, 0, 0));
        rig.Tick(); rig.S.Ack(1);
        rig.S.SetQuality(30, 60, 0.5, cursor: false);
        var f = rig.Tick(16)!.Value;
        Assert.True(f.Frame.Keyframe);
        Assert.Equal((160, 100), (f.Frame.Width, f.Frame.Height));
        Assert.False(rig.Capturer.LastDrawCursor);
        Assert.Single(rig.ControlOfType("monitor"));   // native size did not change
        rig.S.Ack(f.Id);
        rig.S.SetQuality(30, 60, 0.5, cursor: false);  // same scale again: no keyframe
        Assert.Null(rig.Tick(16));
    }

    [Fact]
    public void SetQuality_ClampsToProtocolRanges()
    {
        var enc = new FakeRectEncoder();
        var rig = new Rig(Px.Solid(400, 400, 0, 0, 0), enc);
        rig.S.SetQuality(500, 1, 0.01);
        var f = rig.Tick()!.Value;
        Assert.Equal((100, 100), (f.Frame.Width, f.Frame.Height));   // scale clamped to 0.25
        Assert.Equal(10, f.Frame.Rects[0].Data[6]);                   // quality clamped to 10 (FakeRectEncoder echoes it)
    }

    [Fact]
    public void FlowControl_NoCaptureWhileWindowFullOrSenderBusy_LatestWins()
    {
        var screen = Px.Solid(320, 200, 0, 0, 0);
        var rig = new Rig(screen);
        Assert.True(rig.S.CanProduce());
        Assert.True(rig.S.ProduceFrame());
        Assert.False(rig.S.CanProduce());          // sender busy with frame 1: nothing is queued behind it
        Assert.True(rig.S.SendPending());
        Assert.False(rig.S.SendPending());
        Assert.True(rig.S.CanProduce());

        for (int i = 2; i <= 6; i++)
        {
            Px.Set(screen, i * 10, 0, (byte)i, 0, 0);
            Assert.NotNull(rig.Tick(16));
        }
        Assert.Equal(6, rig.S.Window.UnackedFrames);
        int captures = rig.Capturer.Calls;
        Px.Set(screen, 200, 100, 1, 1, 1);
        Assert.Null(rig.Tick(16));                 // window full: no capture at all
        Assert.Equal(captures, rig.Capturer.Calls);

        rig.S.Ack(6);
        rig.Buffered = 1024 * 1024;
        Assert.Null(rig.Tick(16));                 // channel buffer full
        rig.Buffered = 0;
        Px.Set(screen, 300, 150, 2, 2, 2);         // newest screen, captured only now
        var f = rig.Tick(16)!.Value;
        Assert.Equal(7u, f.Id);
        Assert.Equal(new[] { new Rectangle(192, 64, 64, 64), new Rectangle(256, 128, 64, 64) }, f.Frame.Rects.Select(r => r.Rect).ToArray());
    }

    [Fact]
    public void CaptureFailure_SendsNothing()
    {
        var rig = new Rig(Px.Solid(64, 64, 0, 0, 0));
        rig.Capturer.Fail = true;
        Assert.False(rig.S.ProduceFrame());
        Assert.Empty(rig.Chunks);
        Assert.Empty(rig.Control);
    }

    [Fact]
    public void RealJpeg_EndToEnd_ThroughChunks()
    {
        var screen = Px.Gradient(900, 500);   // keyframe > 16 000 bytes → several chunks
        var rig = new Rig(screen, new SkiaJpegEncoder());
        rig.S.SetQuality(30, 90, 1);
        var f = rig.Tick()!.Value;
        Assert.True(rig.Chunks.Count > 1);
        Assert.All(rig.Chunks, c => Assert.InRange(c.Length, 9, 16008));
        var canvas = Px.Paint(null, f.Frame);
        rig.S.Ack(f.Id);
        Px.Fill(screen, new Rectangle(500, 300, 100, 50), 0, 255, 0);
        f = rig.Tick(33)!.Value;
        Assert.False(f.Frame.Keyframe);
        canvas = Px.Paint(canvas, f.Frame);
        Assert.True(Px.Diff(canvas, screen).Mean < 3);
    }

    [Fact]
    public void Threads_StreamAndStop()
    {
        var screen = Px.Solid(256, 256, 0, 0, 0);
        var got = new List<FrameV2.Parsed>();
        var reasm = new FrameReassembler();
        VideoStreamer? s = null;
        var gotTwo = new ManualResetEventSlim();
        s = new VideoStreamer(new FakeCapturer(screen), () => new[] { new MonitorInfo(0, "D", "D", new Rectangle(0, 0, 256, 256), true) }, 0,
            c =>
            {
                var done = reasm.Add(c);
                if (done == null) return;
                lock (got) { got.Add(FrameV2.Read(done.Value.Data)!); if (got.Count >= 2) gotTwo.Set(); }
                s!.Ack(done.Value.FrameId);
            },
            () => 0, _ => { }, new FakeRectEncoder(), () => default);
        try
        {
            s.Start();
            Thread.Sleep(100);
            lock (screen) Px.Set(screen, 10, 10, 255, 255, 255);
            Assert.True(gotTwo.Wait(5000), "no delta frame arrived");
        }
        finally { s.Dispose(); }
        lock (got)
        {
            Assert.True(got[0].Keyframe);
            Assert.False(got[1].Keyframe);
            Assert.Equal(new Rectangle(0, 0, 64, 64), Assert.Single(got[1].Rects).Rect);
        }
    }
}

public class VideoPipelineCursorTests
{
    private static readonly DateTime T0 = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly Rectangle Mon = new(1920, 0, 1280, 1024);

    private static JsonElement J(object? o) => Msg.Of(o!);

    [Fact]
    public void Message_Shape_NormalizedToTheMonitor()
    {
        var t = new CursorTracker();
        var m = J(t.Update(new CursorState(1920 + 640, 512, (IntPtr)1, true), Mon, T0));
        Assert.Equal("cursor", m.GetProperty("t").GetString());
        Assert.InRange(m.GetProperty("x").GetDouble(), 0.5, 0.501);
        Assert.InRange(m.GetProperty("y").GetDouble(), 0.5, 0.501);
        Assert.True(m.GetProperty("visible").GetBoolean());
        Assert.Equal(4, m.EnumerateObject().Count());
    }

    [Fact]
    public void Coordinates_StayIn0To1_OutsideMeansInvisible()
    {
        var t = new CursorTracker();
        var m = J(t.Update(new CursorState(100, 2000, (IntPtr)1, true), Mon, T0));   // on another monitor
        Assert.Equal(0, m.GetProperty("x").GetDouble());
        Assert.Equal(1, m.GetProperty("y").GetDouble());
        Assert.False(m.GetProperty("visible").GetBoolean());
        m = J(t.Update(new CursorState(1920 + 1279, 1023, (IntPtr)1, true), Mon, T0.AddSeconds(1)));
        Assert.InRange(m.GetProperty("x").GetDouble(), 0.999, 1);
        Assert.InRange(m.GetProperty("y").GetDouble(), 0.999, 1);
        Assert.True(m.GetProperty("visible").GetBoolean());
    }

    [Fact]
    public void HiddenCursor_VisibleFalse()
    {
        var t = new CursorTracker();
        Assert.NotNull(t.Update(new CursorState(2000, 10, (IntPtr)1, true), Mon, T0));
        var m = J(t.Update(new CursorState(2000, 10, IntPtr.Zero, false), Mon, T0.AddSeconds(1)));
        Assert.False(m.GetProperty("visible").GetBoolean());
    }

    [Fact]
    public void Unchanged_NoMessage_AndResendsAfterReset()
    {
        var t = new CursorTracker();
        var c = new CursorState(2000, 10, (IntPtr)1, true);
        Assert.NotNull(t.Update(c, Mon, T0));
        for (int i = 1; i < 100; i++) Assert.Null(t.Update(c, Mon, T0.AddMilliseconds(i * 20)));
        t.Reset();
        Assert.NotNull(t.Update(c, Mon, T0.AddSeconds(3)));
    }

    [Fact]
    public void AtMost60PerSecond_WhileMoving_FinalPositionDelivered()
    {
        var t = new CursorTracker();
        var sent = new List<(DateTime At, JsonElement M)>();
        // poll at 1 kHz for 2 s while the cursor moves every millisecond
        for (int ms = 0; ms < 2000; ms++)
        {
            var now = T0.AddMilliseconds(ms);
            var m = t.Update(new CursorState(1920 + ms % 1280, ms % 1024, (IntPtr)1, true), Mon, now);
            if (m != null) sent.Add((now, J(m)));
        }
        Assert.InRange(sent.Count, 100, 120);
        for (int i = 1; i < sent.Count; i++) Assert.True((sent[i].At - sent[i - 1].At).TotalMilliseconds >= 1000.0 / 60 - 1e-9);
        // in any 1 s window: ≤ 60
        for (int i = 0; i < sent.Count; i++)
            Assert.True(sent.Count(s => s.At >= sent[i].At && s.At < sent[i].At.AddSeconds(1)) <= 60);
        // the cursor stops: its final position goes out on the next allowed tick
        var final = new CursorState(1920 + 10, 20, (IntPtr)1, true);
        var last = sent[^1].At;
        Assert.Null(t.Update(final, Mon, last.AddMilliseconds(5)));
        var fm = J(t.Update(final, Mon, last.AddMilliseconds(17)));
        Assert.InRange(fm.GetProperty("x").GetDouble(), 10.5 / 1280 - 1e-5, 10.5 / 1280 + 1e-5);
    }

    [Fact]
    public void Streamer_PollCursor_UsesCurrentMonitor_AndResetsOnSwitch()
    {
        var clock = new FakeClock();
        var control = new List<JsonElement>();
        var cursor = new CursorState(100, 100, (IntPtr)1, true);
        var mons = new[]
        {
            new MonitorInfo(0, "A", "A", new Rectangle(0, 0, 200, 200), true),
            new MonitorInfo(1, "B", "B", new Rectangle(200, 0, 400, 200), false),
        };
        var s = new VideoStreamer(new FakeCapturer(Px.Solid(8, 8, 0, 0, 0)), () => mons, 0, _ => { }, () => 0,
            m => control.Add(Msg.Of(m)), new FakeRectEncoder(), () => cursor, () => clock.Now);
        Assert.NotNull(s.PollCursor());
        clock.AdvanceMs(17);
        Assert.Null(s.PollCursor());                       // unchanged
        Assert.True(s.SelectMonitor(1));
        clock.AdvanceMs(17);
        var m = J(s.PollCursor());                         // re-sent for the new monitor
        Assert.False(m.GetProperty("visible").GetBoolean());  // (100,100) is not on monitor B
        cursor = new CursorState(400, 100, (IntPtr)1, true);
        clock.AdvanceMs(5);
        Assert.Null(s.PollCursor());                       // throttled
        clock.AdvanceMs(12);
        m = J(s.PollCursor());
        Assert.InRange(m.GetProperty("x").GetDouble(), 0.501, 0.502);
        Assert.True(m.GetProperty("visible").GetBoolean());
        Assert.Equal(3, control.Count(c => c.GetProperty("t").GetString() == "cursor"));
    }
}
