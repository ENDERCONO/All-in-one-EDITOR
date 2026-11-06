using System.Drawing;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>Draws the current mouse cursor into a captured frame (neither capture path includes it).</summary>
public static class CursorOverlay
{
    public static void Draw(Graphics g, Rectangle monitorBounds)
    {
        var ci = new CURSORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<CURSORINFO>() };
        if (!GetCursorInfo(ref ci) || (ci.flags & CURSOR_SHOWING) == 0 || ci.hCursor == IntPtr.Zero) return;
        if (!monitorBounds.Contains(ci.ptScreenPos.X, ci.ptScreenPos.Y)) return;
        int hx = 0, hy = 0;
        if (GetIconInfo(ci.hCursor, out var info))
        {
            hx = info.xHotspot; hy = info.yHotspot;
            if (info.hbmMask != IntPtr.Zero) DeleteObject(info.hbmMask);
            if (info.hbmColor != IntPtr.Zero) DeleteObject(info.hbmColor);
        }
        var hdc = g.GetHdc();
        try
        {
            DrawIconEx(hdc, ci.ptScreenPos.X - monitorBounds.Left - hx, ci.ptScreenPos.Y - monitorBounds.Top - hy,
                ci.hCursor, 0, 0, 0, IntPtr.Zero, DI_NORMAL);
        }
        finally { g.ReleaseHdc(hdc); }
    }
}
