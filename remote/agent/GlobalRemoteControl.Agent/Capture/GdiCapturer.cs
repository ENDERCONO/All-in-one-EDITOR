using System.Drawing;
using System.Runtime.InteropServices;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>GDI BitBlt capture into a reusable DIB (fallback when Desktop Duplication is unavailable).</summary>
public sealed class GdiCapturer : IScreenCapturer
{
    private readonly CursorPainter _cursor = new();
    private IntPtr _dc, _dib, _old, _bits;
    private int _w, _h;

    public string Backend => "gdi";

    public unsafe bool Capture(MonitorInfo monitor, FrameBuffer target, bool drawCursor, DirtyRegion dirty)
    {
        var b = monitor.Bounds;
        if (b.Width <= 0 || b.Height <= 0 || !EnsureDib(b.Width, b.Height)) return false;
        var screen = GetDC(IntPtr.Zero);
        if (screen == IntPtr.Zero) return false;
        bool ok;
        try { ok = BitBlt(_dc, 0, 0, b.Width, b.Height, screen, b.Left, b.Top, SRCCOPY | CAPTUREBLT); }
        finally { ReleaseDC(IntPtr.Zero, screen); }
        if (!ok) return false; // e.g. secure desktop (UAC / lock screen) is not capturable from the user session
        GdiFlush();
        target.EnsureSize(b.Width, b.Height);
        new ReadOnlySpan<byte>((void*)_bits, b.Width * b.Height * 4).CopyTo(target.Span);
        if (drawCursor) _cursor.Draw(target, b, CursorState.Read());
        dirty.SetAll();
        return true;
    }

    private bool EnsureDib(int w, int h)
    {
        if (_dib != IntPtr.Zero && w == _w && h == _h) return true;
        Free();
        _dc = CreateCompatibleDC(IntPtr.Zero);
        if (_dc == IntPtr.Zero) return false;
        var bmi = new BITMAPINFOHEADER { biSize = Marshal.SizeOf<BITMAPINFOHEADER>(), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
        _dib = CreateDIBSection(_dc, ref bmi, 0, out _bits, IntPtr.Zero, 0);
        if (_dib == IntPtr.Zero) { Free(); return false; }
        _old = SelectObject(_dc, _dib);
        _w = w; _h = h;
        return true;
    }

    private void Free()
    {
        if (_dc != IntPtr.Zero) { if (_old != IntPtr.Zero) SelectObject(_dc, _old); DeleteDC(_dc); _dc = IntPtr.Zero; }
        if (_dib != IntPtr.Zero) { DeleteObject(_dib); _dib = IntPtr.Zero; }
        _old = IntPtr.Zero; _w = _h = 0;
    }

    public void Dispose() { Free(); _cursor.Dispose(); }
}
