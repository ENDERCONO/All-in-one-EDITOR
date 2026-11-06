using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

public interface IScreenCapturer : IDisposable
{
    /// <summary>Captures the monitor into a new 32bpp bitmap (caller disposes), or null on failure.</summary>
    Bitmap? Capture(MonitorInfo monitor);
}
