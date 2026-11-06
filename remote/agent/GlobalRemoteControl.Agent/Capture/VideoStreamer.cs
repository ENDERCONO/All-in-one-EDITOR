using System.Diagnostics;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Video for one session (PROTOCOL.md section 5). Three threads, none sharing a lock with input handling:
/// <list type="bullet">
/// <item>capture/encode: paced to the requested fps; captures only when the <see cref="AckWindow"/> is open and the
/// sender is idle (latest-wins — a frame is never queued behind a stale one), then tile-diffs and encodes a v2 payload;</item>
/// <item>send: hands the chunks of the one ready frame to the data channel;</item>
/// <item>cursor: polls the pointer at ≤ 60 Hz and sends <c>{t:"cursor"}</c> when it moves.</item>
/// </list>
/// </summary>
public sealed class VideoStreamer : IDisposable
{
    public static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(1);
    public const int MaxFps = 60;

    private readonly IScreenCapturer _capturer;
    private readonly Func<IReadOnlyList<MonitorInfo>> _monitors;
    private readonly Action<byte[]> _sendChunk;
    private readonly Func<ulong> _bufferedAmount;
    private readonly Action<object> _sendControl;
    private readonly Func<CursorState> _cursorSource;
    private readonly AckWindow _window = new();
    private readonly KeyframePolicy _keyframes = new();
    private readonly DeltaEncoder _delta;
    private readonly FrameBuffer _full = new();
    private readonly DirtyRegion _dirty = new();
    private readonly CursorTracker _cursorTracker = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly AutoResetEvent _sendReady = new(false);
    private readonly ManualResetEventSlim _senderIdle = new(true);
    private List<byte[]>? _pending;
    private Thread? _captureThread, _sendThread, _cursorThread;

    private volatile int _fps = 30;
    private volatile int _quality = 70;
    private double _scale = 1;
    private volatile bool _drawCursor = true;
    private volatile int _monitorIndex;
    private volatile int _cursorMonitorDirty;
    private (int Index, int W, int H) _reported = (-1, 0, 0);
    private DateTime _lastFrameSent = DateTime.MinValue;

    // stats (diagnostics / benchmark)
    private long _framesSent, _bytesSent, _chunksSent;
    private double _sendMs;

    public VideoStreamer(IScreenCapturer capturer, Func<IReadOnlyList<MonitorInfo>> monitors, int monitorIndex,
        Action<byte[]> sendChunk, Func<ulong> bufferedAmount, Action<object> sendControl,
        IRectEncoder? encoder = null, Func<CursorState>? cursorSource = null)
    {
        _capturer = capturer;
        _monitors = monitors;
        _monitorIndex = monitorIndex;
        _sendChunk = sendChunk;
        _bufferedAmount = bufferedAmount;
        _sendControl = sendControl;
        _delta = new DeltaEncoder(encoder);
        _cursorSource = cursorSource ?? CursorState.Read;
    }

    public int MonitorIndex => _monitorIndex;
    public Action<string>? Log { get; set; }
    public AckWindow Window => _window;
    public string EncoderName => _delta.Encoder.Name;
    public long FramesSent => Interlocked.Read(ref _framesSent);
    public long BytesSent => Interlocked.Read(ref _bytesSent);
    public DeltaStats? LastStats => _delta.Last;

    public void Start()
    {
        if (_captureThread != null) return;
        _captureThread = new Thread(CaptureLoop) { IsBackground = true, Name = "grc-video-capture", Priority = ThreadPriority.AboveNormal };
        _sendThread = new Thread(SendLoop) { IsBackground = true, Name = "grc-video-send" };
        _cursorThread = new Thread(CursorLoop) { IsBackground = true, Name = "grc-cursor" };
        _sendThread.Start();
        _captureThread.Start();
        _cursorThread.Start();
    }

    public void SetQuality(int fps, int quality, double scale, bool cursor = true)
    {
        _fps = Math.Clamp(fps, 1, MaxFps);
        _quality = Math.Clamp(quality, 10, 95);
        Volatile.Write(ref _scale, Math.Clamp(scale, 0.25, 1));
        _drawCursor = cursor;
        _wake.Set();
    }

    public void RequestKeyframe() { _keyframes.Request(); _wake.Set(); }

    public bool SelectMonitor(int index)
    {
        if (index < 0 || index >= _monitors().Count) return false;
        _monitorIndex = index;
        _cursorMonitorDirty = 1;
        _wake.Set();
        return true;
    }

    public void Ack(uint frameId)
    {
        if (_window.OnAck(frameId, DateTime.UtcNow)) _wake.Set();
    }

    private void CaptureLoop()
    {
        var ct = _cts.Token;
        using var timer = new PreciseTimer();
        var sw = Stopwatch.StartNew();
        var next = TimeSpan.Zero;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!timer.Wait(next - sw.Elapsed, ct)) break;
                // Flow control: wait (without capturing) until the sender is idle and the window is open.
                while (!(_senderIdle.IsSet && _window.CanSend(_bufferedAmount(), DateTime.UtcNow)))
                {
                    if (WaitHandle.WaitAny(new[] { _wake, ct.WaitHandle }, 5) == 1) return;
                }
                var start = sw.Elapsed;
                next = start + TimeSpan.FromSeconds(1.0 / _fps);
                ProduceFrame();
            }
            catch (Exception ex)
            {
                Log?.Invoke("video frame failed: " + ex.Message);
                _delta.Reset();
                if (ct.WaitHandle.WaitOne(200)) break;
            }
        }
    }

    /// <summary>Captures, diffs and encodes one frame and hands it to the send thread. Runs on the capture thread.</summary>
    internal bool ProduceFrame()
    {
        var monitors = _monitors();
        if (monitors.Count == 0) return false;
        var mon = monitors[Math.Min(_monitorIndex, monitors.Count - 1)];
        if (!_capturer.Capture(mon, _full, _drawCursor, _dirty)) return false;
        if (_reported != (mon.Index, _full.Width, _full.Height))
        {
            _reported = (mon.Index, _full.Width, _full.Height);
            _sendControl(new { t = "monitor", index = mon.Index, width = _full.Width, height = _full.Height });
        }
        var now = DateTime.UtcNow;
        double scale = Volatile.Read(ref _scale);
        bool forceKey = _keyframes.ShouldSend(now, mon.Index, _full.Width, _full.Height, scale);
        var payload = _delta.Encode(_full, _dirty, scale, _quality, forceKey, out bool keyframe);
        if (payload == null)
        {
            if (now - _lastFrameSent < HeartbeatInterval) return false;
            payload = FrameV2.Write(false, _delta.Width, _delta.Height, Array.Empty<EncodedRect>());
        }
        if (keyframe) _keyframes.OnSent(now);
        var id = _window.NextFrameId();
        var chunks = FrameChunker.Split(id, payload);
        _window.OnSent(id, payload.Length, now);
        _lastFrameSent = now;
        _senderIdle.Reset();
        Volatile.Write(ref _pending, chunks);
        _sendReady.Set();
        return true;
    }

    private void SendLoop()
    {
        var ct = _cts.Token;
        var sw = new Stopwatch();
        while (true)
        {
            if (WaitHandle.WaitAny(new[] { _sendReady, ct.WaitHandle }) == 1) return;
            var chunks = Interlocked.Exchange(ref _pending, null);
            if (chunks == null) continue;
            sw.Restart();
            long bytes = 0;
            try
            {
                foreach (var c in chunks) { _sendChunk(c); bytes += c.Length; }
            }
            catch (Exception ex) { Log?.Invoke("video send failed: " + ex.Message); }
            _sendMs += sw.Elapsed.TotalMilliseconds;
            Interlocked.Increment(ref _framesSent);
            Interlocked.Add(ref _bytesSent, bytes);
            Interlocked.Add(ref _chunksSent, chunks.Count);
            _senderIdle.Set();
            _wake.Set();
        }
    }

    private void CursorLoop()
    {
        var ct = _cts.Token;
        using var timer = new PreciseTimer();
        var period = TimeSpan.FromSeconds(1.0 / CursorTracker.MaxRate);
        while (timer.Wait(period, ct))
        {
            try
            {
                if (Interlocked.Exchange(ref _cursorMonitorDirty, 0) == 1) _cursorTracker.Reset();
                var monitors = _monitors();
                if (monitors.Count == 0) continue;
                var mon = monitors[Math.Min(_monitorIndex, monitors.Count - 1)];
                var msg = _cursorTracker.Update(_cursorSource(), mon.Bounds, DateTime.UtcNow);
                if (msg != null) _sendControl(msg);
            }
            catch (Exception ex) { Log?.Invoke("cursor update failed: " + ex.Message); }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _captureThread?.Join(2000);
        _sendThread?.Join(2000);
        _cursorThread?.Join(2000);
    }
}
