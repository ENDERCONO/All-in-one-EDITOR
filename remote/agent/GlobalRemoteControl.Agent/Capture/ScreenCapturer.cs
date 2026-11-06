using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Desktop Duplication first; on any failure (no GPU output, secure desktop, access lost, RDP...) falls back to
/// GDI and retries duplication after a few seconds.
/// </summary>
public sealed class ScreenCapturer : IScreenCapturer
{
    private DuplicationCapturer? _dup;
    private DateTime _retryAfter = DateTime.MinValue;
    private readonly GdiCapturer _gdi = new();

    public string Backend { get; private set; } = "none";

    public Bitmap? Capture(MonitorInfo monitor)
    {
        if (DateTime.UtcNow >= _retryAfter)
        {
            try
            {
                if (_dup != null && (_dup.DeviceName != monitor.DeviceName || _dup.Width != monitor.Bounds.Width || _dup.Height != monitor.Bounds.Height))
                {
                    _dup.Dispose(); _dup = null;
                }
                _dup ??= new DuplicationCapturer(monitor.DeviceName);
                var bmp = _dup.Capture(monitor.Bounds);
                if (bmp != null) { Backend = "duplication"; return bmp; }
            }
            catch (Exception)
            {
                _dup?.Dispose(); _dup = null;
                _retryAfter = DateTime.UtcNow.AddSeconds(3);
            }
        }
        Backend = "gdi";
        return _gdi.Capture(monitor);
    }

    public void Dispose()
    {
        _dup?.Dispose();
        _gdi.Dispose();
    }
}
