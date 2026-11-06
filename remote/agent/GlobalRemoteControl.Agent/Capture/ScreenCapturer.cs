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

    public bool Capture(MonitorInfo monitor, FrameBuffer target, bool drawCursor, DirtyRegion dirty)
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
                if (_dup.Capture(monitor.Bounds, target, drawCursor, dirty)) { Backend = "duplication"; return true; }
            }
            catch (Exception)
            {
                _dup?.Dispose(); _dup = null;
                _retryAfter = DateTime.UtcNow.AddSeconds(3);
            }
        }
        Backend = "gdi";
        return _gdi.Capture(monitor, target, drawCursor, dirty);
    }

    public void Dispose()
    {
        _dup?.Dispose();
        _gdi.Dispose();
    }
}
