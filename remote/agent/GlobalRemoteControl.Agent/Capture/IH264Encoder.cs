namespace GlobalRemoteControl.Agent.Capture;

/// <summary>One H.264 encoder instance (PROTOCOL 5.1). Not thread-safe: one encoding thread uses it.</summary>
public interface IH264Encoder : IDisposable
{
    /// <summary>"hardware: NVIDIA H.264 Encoder MFT", "software: ...", "fake".</summary>
    string Name { get; }
    int Width { get; }
    int Height { get; }

    /// <summary>
    /// Encodes one NV12 picture (<see cref="Nv12.Size"/> bytes of <see cref="Width"/>×<see cref="Height"/>).
    /// Returns one Annex-B access unit (start codes, SPS/PPS before every IDR), or null when the encoder has no output yet.
    /// Throws when the encoder broke (the caller then falls back to JPEG).
    /// </summary>
    byte[]? Encode(byte[] nv12, bool keyframe, TimeSpan timestamp);

    /// <summary>Changes the target bitrate (bits per second) without restarting.</summary>
    void SetBitrate(int bitsPerSecond);
}

public interface IH264EncoderFactory
{
    /// <summary>True once the background probe found a working encoder; false while probing or when none works.</summary>
    bool Available { get; }

    /// <summary>A new encoder for even <paramref name="width"/>×<paramref name="height"/>, or null if none can be made.</summary>
    IH264Encoder? Create(int width, int height, int fps, int bitsPerSecond, Action<string>? log = null);
}

/// <summary>Helpers for H.264 bitstreams in Annex-B form.</summary>
public static class AnnexB
{
    /// <summary>The NAL unit types in an Annex-B buffer (in order).</summary>
    public static List<int> NalTypes(ReadOnlySpan<byte> au)
    {
        var types = new List<int>();
        for (int i = 0; i + 3 < au.Length; i++)
        {
            if (au[i] != 0 || au[i + 1] != 0) continue;
            int start;
            if (au[i + 2] == 1) start = i + 3;
            else if (au[i + 2] == 0 && au[i + 3] == 1 && i + 4 < au.Length) start = i + 4;
            else continue;
            if (start < au.Length) types.Add(au[start] & 0x1F);
            i = start - 1;
        }
        return types;
    }

    public static bool HasIdr(ReadOnlySpan<byte> au) => NalTypes(au).Contains(5);
    public static bool HasSps(ReadOnlySpan<byte> au) => NalTypes(au).Contains(7);
}

/// <summary>BGRA → NV12 (BT.601, limited range: what browsers assume for H.264 without colour info).</summary>
public static class Nv12
{
    public static int Size(int width, int height) => width * height + width * (height / 2);

    /// <summary>Converts <paramref name="src"/> (even width and height) into <paramref name="dst"/>.</summary>
    public static void FromBgra(FrameBuffer src, byte[] dst)
    {
        int w = src.Width, h = src.Height;
        if ((w & 1) != 0 || (h & 1) != 0) throw new ArgumentException("NV12 needs even dimensions");
        if (dst.Length < Size(w, h)) throw new ArgumentException("NV12 buffer too small");
        var px = src.Pixels;
        int stride = src.Stride;
        int uvBase = w * h;
        // two source rows per iteration → one chroma row; rows are independent, so split across cores
        Parallel.For(0, h / 2, new ParallelOptions { MaxDegreeOfParallelism = Math.Clamp(Environment.ProcessorCount, 1, 8) }, cy =>
        {
            int y0 = cy * 2;
            int r0 = y0 * stride, r1 = r0 + stride;
            int yo0 = y0 * w, yo1 = yo0 + w;
            int uvo = uvBase + cy * w;
            for (int x = 0; x < w; x += 2)
            {
                int a = r0 + x * 4, b = a + 4, c = r1 + x * 4, d = c + 4;
                int b0 = px[a], g0 = px[a + 1], rr0 = px[a + 2];
                int b1 = px[b], g1 = px[b + 1], rr1 = px[b + 2];
                int b2 = px[c], g2 = px[c + 1], rr2 = px[c + 2];
                int b3 = px[d], g3 = px[d + 1], rr3 = px[d + 2];
                dst[yo0 + x] = Y(rr0, g0, b0);
                dst[yo0 + x + 1] = Y(rr1, g1, b1);
                dst[yo1 + x] = Y(rr2, g2, b2);
                dst[yo1 + x + 1] = Y(rr3, g3, b3);
                int rs = rr0 + rr1 + rr2 + rr3, gs = g0 + g1 + g2 + g3, bs = b0 + b1 + b2 + b3; // 4× average
                dst[uvo + x] = (byte)(((-38 * rs - 74 * gs + 112 * bs + 512) >> 10) + 128);
                dst[uvo + x + 1] = (byte)(((112 * rs - 94 * gs - 18 * bs + 512) >> 10) + 128);
            }
        });
    }

    private static byte Y(int r, int g, int b) => (byte)(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
}
