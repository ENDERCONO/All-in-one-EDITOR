using System.Diagnostics;
using System.Drawing;
using GlobalRemoteControl.Agent.Capture;
using SkiaSharp;

namespace GlobalRemoteControl.Agent.Tests;

// WindowsFactAttribute lives in McpTests.cs.

/// <summary>A fact that needs <c>node</c> on PATH (cross-checks against the browser code in remote/web).</summary>
public sealed class NodeFactAttribute : FactAttribute
{
    public NodeFactAttribute()
    {
        if (NodeRunner.Find() == null) Skip = "node not found on PATH";
        else if (RepoPaths.WebProtocolJs == null) Skip = "remote/web/protocol.js not found";
    }
}

public static class RepoPaths
{
    /// <summary>Absolute path of remote/web/protocol.js, found by walking up from the test binaries.</summary>
    public static string? WebProtocolJs
    {
        get
        {
            for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent)
            {
                var p = Path.Combine(d.FullName, "remote", "web", "protocol.js");
                if (File.Exists(p)) return p;
                p = Path.Combine(d.FullName, "web", "protocol.js"); // d = remote/
                if (File.Exists(p) && File.Exists(Path.Combine(d.FullName, "docs", "PROTOCOL.md"))) return p;
            }
            return null;
        }
    }
}

public static class NodeRunner
{
    public static string? Find()
    {
        var exe = OperatingSystem.IsWindows() ? "node.exe" : "node";
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            var p = Path.Combine(dir, exe);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    /// <summary>Runs a .mjs script with arguments; returns stdout (throws with stderr on a non-zero exit).</summary>
    public static string Run(string script, params string[] args)
    {
        var psi = new ProcessStartInfo(Find()!) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add(script);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(30_000)) { p.Kill(); throw new TimeoutException("node timed out"); }
        if (p.ExitCode != 0) throw new InvalidOperationException("node failed: " + stderr.Result);
        return stdout.Result;
    }
}

/// <summary>Synthetic BGRA frames and helpers to decode / paint v2 frames like the browser does.</summary>
public static class Px
{
    public static FrameBuffer Solid(int w, int h, byte b, byte g, byte r)
    {
        var f = new FrameBuffer(w, h);
        Fill(f, new Rectangle(0, 0, w, h), b, g, r);
        return f;
    }

    /// <summary>A smooth, deterministic picture (gradients compress well, so JPEG error stays small).</summary>
    public static FrameBuffer Gradient(int w, int h, int seed = 0)
    {
        var f = new FrameBuffer(w, h);
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                Set(f, x, y, (byte)((x * 255 / Math.Max(1, w - 1) + seed) & 255), (byte)((y * 255 / Math.Max(1, h - 1) + seed * 3) & 255), (byte)(128 + seed * 7 & 255));
        return f;
    }

    public static void Fill(FrameBuffer f, Rectangle r, byte b, byte g, byte red)
    {
        for (int y = r.Top; y < r.Bottom; y++)
            for (int x = r.Left; x < r.Right; x++) Set(f, x, y, b, g, red);
    }

    public static void Set(FrameBuffer f, int x, int y, byte b, byte g, byte r)
    {
        int o = y * f.Stride + x * 4;
        f.Pixels[o] = b; f.Pixels[o + 1] = g; f.Pixels[o + 2] = r; f.Pixels[o + 3] = 255;
    }

    public static (byte B, byte G, byte R) Get(FrameBuffer f, int x, int y)
    {
        int o = y * f.Stride + x * 4;
        return (f.Pixels[o], f.Pixels[o + 1], f.Pixels[o + 2]);
    }

    public static FrameBuffer Clone(FrameBuffer src)
    {
        var f = new FrameBuffer();
        f.CopyFrom(src);
        return f;
    }

    /// <summary>Decodes a JPEG into a BGRA buffer with SkiaSharp.</summary>
    public static FrameBuffer DecodeJpeg(byte[] data)
    {
        using var stream = new SKMemoryStream(data);
        using var codec = SKCodec.Create(stream) ?? throw new InvalidOperationException("not a decodable image");
        var info = new SKImageInfo(codec.Info.Width, codec.Info.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        var f = new FrameBuffer(info.Width, info.Height);
        var res = codec.GetPixels(info, f.Pointer, f.Stride, SKCodecOptions.Default);
        if (res != SKCodecResult.Success) throw new InvalidOperationException("decode failed: " + res);
        return f;
    }

    /// <summary>Paints a parsed v2 frame onto a persistent canvas, exactly like the browser (session.js).</summary>
    public static FrameBuffer Paint(FrameBuffer? canvas, FrameV2.Parsed frame)
    {
        if (frame.Keyframe || canvas == null || canvas.Width != frame.Width || canvas.Height != frame.Height)
        {
            Assert.True(frame.Keyframe, "a delta frame arrived without a canvas of its size");
            canvas = new FrameBuffer(frame.Width, frame.Height);
            canvas.Span.Clear();
        }
        foreach (var (rect, codec, data) in frame.Rects)
        {
            Assert.Equal(FrameV2.CodecJpeg, codec);
            var img = DecodeJpeg(data);
            Assert.Equal(rect.Width, img.Width);
            Assert.Equal(rect.Height, img.Height);
            for (int y = 0; y < rect.Height; y++)
                img.Pixels.AsSpan(y * img.Stride, rect.Width * 4).CopyTo(canvas.Pixels.AsSpan((rect.Y + y) * canvas.Stride + rect.X * 4));
        }
        return canvas;
    }

    /// <summary>Mean and max absolute per-channel difference (B, G, R) between two same-size buffers.</summary>
    public static (double Mean, int Max) Diff(FrameBuffer a, FrameBuffer b)
    {
        Assert.Equal(a.Width, b.Width);
        Assert.Equal(a.Height, b.Height);
        long sum = 0; int max = 0, n = 0;
        for (int y = 0; y < a.Height; y++)
            for (int x = 0; x < a.Width; x++)
            {
                int o = y * a.Stride + x * 4;
                for (int c = 0; c < 3; c++)
                {
                    int d = Math.Abs(a.Pixels[o + c] - b.Pixels[o + c]);
                    sum += d; n++;
                    if (d > max) max = d;
                }
            }
        return ((double)sum / n, max);
    }
}

/// <summary>Records encode calls; returns a tiny payload ("rect" bytes) instead of a JPEG.</summary>
public sealed class FakeRectEncoder : IRectEncoder
{
    public string Name => "fake";
    public List<Rectangle> Calls { get; } = new();

    public byte[] Encode(FrameBuffer src, Rectangle r, int quality)
    {
        lock (Calls) Calls.Add(r);
        return new byte[] { 0xFF, 0xD8, (byte)r.X, (byte)r.Y, (byte)r.Width, (byte)r.Height, (byte)quality };
    }
}

/// <summary>A screen whose picture the test controls. Reports All as dirty unless a hint is set.</summary>
public sealed class FakeCapturer : IScreenCapturer
{
    public FrameBuffer Screen { get; set; }
    public List<Rectangle>? DirtyHint { get; set; }
    public bool Fail { get; set; }
    public int Calls { get; private set; }
    public bool LastDrawCursor { get; private set; }
    public MonitorInfo? LastMonitor { get; private set; }

    public FakeCapturer(FrameBuffer screen) => Screen = screen;
    public string Backend => "fake";

    public bool Capture(MonitorInfo monitor, FrameBuffer target, bool drawCursor, DirtyRegion dirty)
    {
        Calls++;
        LastDrawCursor = drawCursor;
        LastMonitor = monitor;
        if (Fail) return false;
        lock (this)
        {
            bool resized = target.EnsureSize(Screen.Width, Screen.Height);
            Screen.Span.CopyTo(target.Span);
            if (DirtyHint == null || resized) dirty.SetAll();
            else
            {
                dirty.Reset();
                foreach (var r in DirtyHint) dirty.Add(r, new Size(target.Width, target.Height));
            }
        }
        return true;
    }

    public void Dispose() { }
}

/// <summary>A controllable clock.</summary>
public sealed class FakeClock
{
    public DateTime Now { get; set; } = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
    public void Advance(TimeSpan t) => Now += t;
    public void AdvanceMs(double ms) => Now += TimeSpan.FromMilliseconds(ms);
}
