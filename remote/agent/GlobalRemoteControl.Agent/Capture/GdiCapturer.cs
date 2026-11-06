using System.Drawing;
using System.Drawing.Imaging;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>GDI BitBlt capture (fallback when Desktop Duplication is unavailable).</summary>
public sealed class GdiCapturer : IScreenCapturer
{
    public Bitmap? Capture(MonitorInfo monitor)
    {
        var b = monitor.Bounds;
        if (b.Width <= 0 || b.Height <= 0) return null;
        var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format32bppRgb);
        try
        {
            using var g = Graphics.FromImage(bmp);
            g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy | CopyPixelOperation.CaptureBlt);
            CursorOverlay.Draw(g, b);
            return bmp;
        }
        catch (Exception)
        {
            bmp.Dispose();
            return null; // e.g. secure desktop (UAC / lock screen) is not capturable from the user session
        }
    }

    public void Dispose() { }
}
