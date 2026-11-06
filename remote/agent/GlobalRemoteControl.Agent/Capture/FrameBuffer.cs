using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// A reusable, pinned 32-bit BGRA pixel buffer (stride = width * 4). Pinned so native code (Skia, GDI) can read it by
/// pointer without copying; only reallocated when the size grows.
/// </summary>
public sealed class FrameBuffer
{
    private byte[] _pixels = Array.Empty<byte>();

    public int Width { get; private set; }
    public int Height { get; private set; }
    public int Stride => Width * 4;
    public byte[] Pixels => _pixels;
    public Span<byte> Span => _pixels.AsSpan(0, Stride * Height);

    public FrameBuffer() { }
    public FrameBuffer(int width, int height) => EnsureSize(width, height);

    /// <summary>Sets the size; returns true when it changed (contents are then undefined).</summary>
    public bool EnsureSize(int width, int height)
    {
        if (width == Width && height == Height) return false;
        long needed = (long)width * height * 4;
        if (needed > _pixels.Length) _pixels = GC.AllocateUninitializedArray<byte>((int)needed, pinned: true);
        Width = width; Height = height;
        return true;
    }

    public Span<byte> Row(int y) => _pixels.AsSpan(y * Stride, Stride);

    public unsafe IntPtr Pointer
    {
        get { fixed (byte* p = _pixels) return (IntPtr)p; } // pinned array: the address is stable
    }

    public void CopyFrom(FrameBuffer src)
    {
        EnsureSize(src.Width, src.Height);
        src.Span.CopyTo(Span);
    }

    /// <summary>Copies a rectangle (same coordinates) from <paramref name="src"/>, which must have the same size.</summary>
    public void CopyRect(FrameBuffer src, Rectangle r)
    {
        int bytes = r.Width * 4;
        for (int y = r.Top; y < r.Bottom; y++)
            src._pixels.AsSpan(y * src.Stride + r.Left * 4, bytes).CopyTo(_pixels.AsSpan(y * Stride + r.Left * 4, bytes));
    }
}

/// <summary>
/// What a capture call says may have changed since the previous call: everything (<see cref="All"/>), nothing (no
/// rects), or a list of rectangles. It is only a hint — the tile diff always verifies.
/// </summary>
public sealed class DirtyRegion
{
    public bool All { get; private set; } = true;
    public List<Rectangle> Rects { get; } = new();
    public bool IsEmpty => !All && Rects.Count == 0;

    public void Reset() { All = false; Rects.Clear(); }
    public void SetAll() { All = true; Rects.Clear(); }

    public void Add(Rectangle r, Size bounds)
    {
        if (All) return;
        r.Intersect(new Rectangle(Point.Empty, bounds));
        if (r.Width > 0 && r.Height > 0) Rects.Add(r);
    }
}
