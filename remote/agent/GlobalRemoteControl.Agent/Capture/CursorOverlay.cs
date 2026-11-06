using System.Drawing;
using System.Runtime.InteropServices;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>Screen position (virtual-desktop pixels), cursor handle and visibility.</summary>
public readonly record struct CursorState(int X, int Y, IntPtr Handle, bool Showing)
{
    public static CursorState Read()
    {
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf<CURSORINFO>() };
        if (!GetCursorInfo(ref ci)) return default;
        return new CursorState(ci.ptScreenPos.X, ci.ptScreenPos.Y, ci.hCursor, (ci.flags & CURSOR_SHOWING) != 0 && ci.hCursor != IntPtr.Zero);
    }
}

/// <summary>
/// Draws the mouse cursor into a BGRA frame buffer (neither capture path includes it). Only the small area under the
/// cursor is copied into a reusable GDI DIB, drawn with DrawIconEx, and copied back. Not thread-safe.
/// </summary>
public sealed class CursorPainter : IDisposable
{
    private readonly Dictionary<IntPtr, (int Hx, int Hy, int W, int H)> _shapes = new();
    private IntPtr _dc, _dib, _old, _bits;
    private int _dibW, _dibH;

    /// <summary>Monitor-local rectangle the cursor covers (empty if not visible on this monitor).</summary>
    public Rectangle Bounds(CursorState c, Rectangle monitor, Size frame)
    {
        if (!c.Showing) return Rectangle.Empty;
        var s = Shape(c.Handle);
        var r = new Rectangle(c.X - s.Hx - monitor.Left, c.Y - s.Hy - monitor.Top, s.W, s.H);
        r.Intersect(new Rectangle(Point.Empty, frame));
        return r.Width > 0 && r.Height > 0 ? r : Rectangle.Empty;
    }

    /// <summary>Draws the cursor; returns the monitor-local rectangle that was touched (or empty).</summary>
    public unsafe Rectangle Draw(FrameBuffer target, Rectangle monitor, CursorState c)
    {
        var r = Bounds(c, monitor, new Size(target.Width, target.Height));
        if (r.IsEmpty) return r;
        var s = Shape(c.Handle);
        if (!EnsureDib(r.Width, r.Height)) return Rectangle.Empty;
        int dibStride = _dibW * 4, rowBytes = r.Width * 4;
        for (int y = 0; y < r.Height; y++)
            target.Pixels.AsSpan((r.Top + y) * target.Stride + r.Left * 4, rowBytes).CopyTo(new Span<byte>((byte*)_bits + y * dibStride, rowBytes));
        DrawIconEx(_dc, c.X - s.Hx - monitor.Left - r.Left, c.Y - s.Hy - monitor.Top - r.Top, c.Handle, 0, 0, 0, IntPtr.Zero, DI_NORMAL);
        GdiFlush();
        for (int y = 0; y < r.Height; y++)
            new ReadOnlySpan<byte>((byte*)_bits + y * dibStride, rowBytes).CopyTo(target.Pixels.AsSpan((r.Top + y) * target.Stride + r.Left * 4, rowBytes));
        return r;
    }

    private (int Hx, int Hy, int W, int H) Shape(IntPtr cursor)
    {
        if (_shapes.TryGetValue(cursor, out var s)) return s;
        int w = Math.Max(32, GetSystemMetrics(SM_CXCURSOR)), h = Math.Max(32, GetSystemMetrics(SM_CYCURSOR)), hx = 0, hy = 0;
        if (GetIconInfo(cursor, out var info))
        {
            hx = info.xHotspot; hy = info.yHotspot;
            if (info.hbmColor != IntPtr.Zero && GetObject(info.hbmColor, Marshal.SizeOf<BITMAP>(), out var bc) != 0) { w = bc.bmWidth; h = bc.bmHeight; }
            else if (info.hbmMask != IntPtr.Zero && GetObject(info.hbmMask, Marshal.SizeOf<BITMAP>(), out var bm) != 0) { w = bm.bmWidth; h = bm.bmHeight / 2; }
            if (info.hbmMask != IntPtr.Zero) DeleteObject(info.hbmMask);
            if (info.hbmColor != IntPtr.Zero) DeleteObject(info.hbmColor);
        }
        s = (hx, hy, Math.Clamp(w, 1, 512), Math.Clamp(h, 1, 512));
        if (_shapes.Count > 64) _shapes.Clear();
        _shapes[cursor] = s;
        return s;
    }

    private bool EnsureDib(int w, int h)
    {
        if (_dib != IntPtr.Zero && w <= _dibW && h <= _dibH) return true;
        FreeDib();
        w = Math.Max(w, 64); h = Math.Max(h, 64);
        _dc = CreateCompatibleDC(IntPtr.Zero);
        if (_dc == IntPtr.Zero) return false;
        var bmi = new BITMAPINFOHEADER { biSize = Marshal.SizeOf<BITMAPINFOHEADER>(), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
        _dib = CreateDIBSection(_dc, ref bmi, 0, out _bits, IntPtr.Zero, 0);
        if (_dib == IntPtr.Zero) { DeleteDC(_dc); _dc = IntPtr.Zero; return false; }
        _old = SelectObject(_dc, _dib);
        _dibW = w; _dibH = h;
        return true;
    }

    private void FreeDib()
    {
        if (_dc != IntPtr.Zero) { SelectObject(_dc, _old); DeleteDC(_dc); _dc = IntPtr.Zero; }
        if (_dib != IntPtr.Zero) { DeleteObject(_dib); _dib = IntPtr.Zero; }
        _dibW = _dibH = 0;
    }

    public void Dispose() => FreeDib();
}

/// <summary>
/// Builds <c>{t:"cursor", x, y, visible}</c> messages (PROTOCOL.md section 5): position normalized to the current
/// monitor (0..1), sent only when something changed and at most <see cref="MaxRate"/> per second.
/// </summary>
public sealed class CursorTracker
{
    public const int MaxRate = 60;
    private static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(1.0 / MaxRate);

    private (double X, double Y, bool Visible)? _last;
    private DateTime _lastSent = DateTime.MinValue;

    public void Reset() => _last = null;

    public object? Update(CursorState c, Rectangle monitor, DateTime now)
    {
        if (monitor.Width <= 0 || monitor.Height <= 0) return null;
        if (now - _lastSent < MinInterval) return null;
        bool inside = monitor.Contains(c.X, c.Y);
        double x = Math.Round(Math.Clamp((c.X - monitor.Left + 0.5) / monitor.Width, 0, 1), 5);
        double y = Math.Round(Math.Clamp((c.Y - monitor.Top + 0.5) / monitor.Height, 0, 1), 5);
        var state = (x, y, c.Showing && inside);
        if (_last == state) return null;
        _last = state;
        _lastSent = now;
        return new { t = "cursor", x, y, visible = state.Item3 };
    }
}
