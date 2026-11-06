using System.Diagnostics;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Capture → JPEG → chunk → send loop for one session, fps-limited and flow-controlled by <see cref="AckWindow"/>.
/// </summary>
public sealed class VideoStreamer : IDisposable
{
    private readonly IScreenCapturer _capturer;
    private readonly Func<IReadOnlyList<MonitorInfo>> _monitors;
    private readonly Action<byte[]> _sendChunk;
    private readonly Func<ulong> _bufferedAmount;
    private readonly Action<object> _sendControl;
    private readonly AckWindow _window = new();
    private readonly CancellationTokenSource _cts = new();
    private Task? _loop;

    private volatile int _fps = 15;
    private volatile int _quality = 70;
    private double _scale = 1;
    private volatile int _monitorIndex;
    private (int Index, int W, int H) _reported = (-1, 0, 0);

    public VideoStreamer(IScreenCapturer capturer, Func<IReadOnlyList<MonitorInfo>> monitors, int monitorIndex,
        Action<byte[]> sendChunk, Func<ulong> bufferedAmount, Action<object> sendControl)
    {
        _capturer = capturer;
        _monitors = monitors;
        _monitorIndex = monitorIndex;
        _sendChunk = sendChunk;
        _bufferedAmount = bufferedAmount;
        _sendControl = sendControl;
    }

    public int MonitorIndex => _monitorIndex;
    public Action<string>? Log { get; set; }

    public void Start() => _loop ??= Task.Factory.StartNew(Run, TaskCreationOptions.LongRunning);

    public void SetQuality(int fps, int quality, double scale)
    {
        _fps = Math.Clamp(fps, 1, 30);
        _quality = Math.Clamp(quality, 10, 95);
        Volatile.Write(ref _scale, Math.Clamp(scale, 0.25, 1));
    }

    public bool SelectMonitor(int index)
    {
        if (index < 0 || index >= _monitors().Count) return false;
        _monitorIndex = index;
        return true;
    }

    public void Ack(uint frameId) => _window.OnAck(frameId, DateTime.UtcNow);

    private void Run()
    {
        var ct = _cts.Token;
        var sw = Stopwatch.StartNew();
        while (!ct.IsCancellationRequested)
        {
            var frameStart = sw.Elapsed;
            try
            {
                if (!_window.CanSend(_bufferedAmount(), DateTime.UtcNow)) { ct.WaitHandle.WaitOne(5); continue; }
                SendOneFrame();
            }
            catch (Exception ex) { Log?.Invoke("video frame failed: " + ex.Message); ct.WaitHandle.WaitOne(200); }
            var wait = TimeSpan.FromSeconds(1.0 / _fps) - (sw.Elapsed - frameStart);
            if (wait > TimeSpan.Zero) ct.WaitHandle.WaitOne(wait);
        }
    }

    private void SendOneFrame()
    {
        var monitors = _monitors();
        if (monitors.Count == 0) return;
        var mon = monitors[Math.Min(_monitorIndex, monitors.Count - 1)];
        using var bmp = _capturer.Capture(mon);
        if (bmp == null) return;
        if (_reported != (mon.Index, bmp.Width, bmp.Height))
        {
            _reported = (mon.Index, bmp.Width, bmp.Height);
            _sendControl(new { t = "monitor", index = mon.Index, width = bmp.Width, height = bmp.Height });
        }
        var jpeg = JpegEncoder.Encode(bmp, _quality, Volatile.Read(ref _scale));
        var id = _window.NextFrameId();
        foreach (var chunk in FrameChunker.Split(id, jpeg)) _sendChunk(chunk);
        _window.OnSent(id, DateTime.UtcNow);
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _loop?.Wait(2000); } catch (Exception) { }
    }
}
