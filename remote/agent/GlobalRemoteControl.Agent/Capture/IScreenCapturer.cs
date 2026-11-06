namespace GlobalRemoteControl.Agent.Capture;

public interface IScreenCapturer : IDisposable
{
    /// <summary>Which backend produced the last frame ("duplication", "gdi", ...).</summary>
    string Backend { get; }

    /// <summary>
    /// Brings <paramref name="target"/> (resized to the monitor, kept between calls) up to date with the screen, drawing
    /// the cursor into it when <paramref name="drawCursor"/>. <paramref name="dirty"/> receives what may have changed
    /// since the previous call (All when unknown). Returns false when nothing could be captured.
    /// </summary>
    bool Capture(MonitorInfo monitor, FrameBuffer target, bool drawCursor, DirtyRegion dirty);
}
