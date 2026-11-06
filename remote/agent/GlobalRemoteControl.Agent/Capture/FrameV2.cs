using System.Buffers.Binary;
using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>One encoded rectangle of a v2 frame.</summary>
public readonly record struct EncodedRect(int X, int Y, int W, int H, byte[] Data, int Length, byte Codec = FrameV2.CodecJpeg)
{
    public EncodedRect(Rectangle r, byte[] data) : this(r.X, r.Y, r.Width, r.Height, data, data.Length) { }
}

/// <summary>
/// Frame payload v2 (PROTOCOL.md section 5), little-endian:
/// <c>u8 version=2, u8 flags (bit0 keyframe), u16 width, u16 height, u16 rectCount,</c>
/// then per rect <c>u16 x, u16 y, u16 w, u16 h, u8 codec (0=JPEG), u32 length, bytes</c>.
/// </summary>
public static class FrameV2
{
    public const byte Version = 2;
    public const byte FlagKeyframe = 1;
    public const byte CodecJpeg = 0;
    public const int HeaderSize = 8;
    public const int RectHeaderSize = 13;

    public static int Size(IReadOnlyList<EncodedRect> rects)
    {
        int n = HeaderSize;
        foreach (var r in rects) n += RectHeaderSize + r.Length;
        return n;
    }

    public static byte[] Write(bool keyframe, int width, int height, IReadOnlyList<EncodedRect> rects)
    {
        if (width is <= 0 or > ushort.MaxValue || height is <= 0 or > ushort.MaxValue) throw new ArgumentOutOfRangeException(nameof(width));
        if (rects.Count > ushort.MaxValue) throw new ArgumentException("too many rects");
        var buf = new byte[Size(rects)];
        var s = buf.AsSpan();
        s[0] = Version;
        s[1] = keyframe ? FlagKeyframe : (byte)0;
        BinaryPrimitives.WriteUInt16LittleEndian(s[2..], (ushort)width);
        BinaryPrimitives.WriteUInt16LittleEndian(s[4..], (ushort)height);
        BinaryPrimitives.WriteUInt16LittleEndian(s[6..], (ushort)rects.Count);
        int o = HeaderSize;
        foreach (var r in rects)
        {
            BinaryPrimitives.WriteUInt16LittleEndian(s[o..], (ushort)r.X);
            BinaryPrimitives.WriteUInt16LittleEndian(s[(o + 2)..], (ushort)r.Y);
            BinaryPrimitives.WriteUInt16LittleEndian(s[(o + 4)..], (ushort)r.W);
            BinaryPrimitives.WriteUInt16LittleEndian(s[(o + 6)..], (ushort)r.H);
            s[o + 8] = r.Codec;
            BinaryPrimitives.WriteUInt32LittleEndian(s[(o + 9)..], (uint)r.Length);
            o += RectHeaderSize;
            r.Data.AsSpan(0, r.Length).CopyTo(s[o..]);
            o += r.Length;
        }
        return buf;
    }

    public sealed record Parsed(bool Keyframe, int Width, int Height, List<(Rectangle Rect, byte Codec, byte[] Data)> Rects);

    /// <summary>Parses a payload the way the browser does (tests / diagnostics). Returns null when malformed.</summary>
    public static Parsed? Read(ReadOnlySpan<byte> s)
    {
        if (s.Length < HeaderSize || s[0] != Version) return null;
        bool key = (s[1] & FlagKeyframe) != 0;
        int w = BinaryPrimitives.ReadUInt16LittleEndian(s[2..]), h = BinaryPrimitives.ReadUInt16LittleEndian(s[4..]);
        int count = BinaryPrimitives.ReadUInt16LittleEndian(s[6..]);
        var list = new List<(Rectangle, byte, byte[])>(count);
        int o = HeaderSize;
        for (int i = 0; i < count; i++)
        {
            if (o + RectHeaderSize > s.Length) return null;
            var r = new Rectangle(BinaryPrimitives.ReadUInt16LittleEndian(s[o..]), BinaryPrimitives.ReadUInt16LittleEndian(s[(o + 2)..]),
                BinaryPrimitives.ReadUInt16LittleEndian(s[(o + 4)..]), BinaryPrimitives.ReadUInt16LittleEndian(s[(o + 6)..]));
            byte codec = s[o + 8];
            uint len = BinaryPrimitives.ReadUInt32LittleEndian(s[(o + 9)..]);
            o += RectHeaderSize;
            if (len > (uint)(s.Length - o)) return null;
            list.Add((r, codec, s.Slice(o, (int)len).ToArray()));
            o += (int)len;
        }
        return o == s.Length ? new Parsed(key, w, h, list) : null;
    }
}
