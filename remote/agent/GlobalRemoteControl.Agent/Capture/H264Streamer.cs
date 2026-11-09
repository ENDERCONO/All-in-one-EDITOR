using System.Diagnostics;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// The GPU video path (PROTOCOL 5.1): paced capture → scale → BGRA→NV12 → H.264 → RTP video track. Replaces the
/// JPEG <see cref="VideoStreamer"/> (paused meanwhile; its cursor thread keeps running) while the controller has the
/// track. Static screens send nothing but a refresh every <see cref="IdleRefresh"/>. If encoding keeps failing,
/// <see cref="Failed"/> fires once and the session goes back to JPEG.
/// </summary>
public sealed class H264Streamer : IDisposable
{
    /// <summary>
    /// Safety IDR. Loss is repaired by NACK resends and, failing that, the browser's PLI asks for an IDR at once, so
    /// this only needs to be rare: every IDR is a big frame, and a regular burst of them is a regular stutter.
    /// </summary>
    public static readonly TimeSpan KeyframeInterval = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan IdleRefresh = TimeSpan.FromMilliseconds(500);
    public const int MaxFailures = 3;

    private readonly IScreenCapturer _capturer;
    private readonly Func<IReadOnlyList<MonitorInfo>> _monitors;
    private readonly IH264EncoderFactory _factory;
    private readonly Action<uint, byte[]> _sendFrame;
    private readonly Action<object> _sendControl;
    private readonly FrameBuffer _full = new();
    private readonly FrameBuffer _scaled = new();
    private readonly BoxScaler _scaler = new();
    private readonly DirtyRegion _dirty = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly AutoResetEvent _wake = new(false);
    private IH264Encoder? _encoder;
    private byte[] _nv12 = Array.Empty<byte>();
    private Thread? _thread;
    private int _keyRequested = 1;
    private int _failed;
    private int _failures;
    private (int Index, int W, int H) _reported = (-1, 0, 0);

    private volatile int _fps = 30;
    private volatile int _quality = 70;
    private double _scale = 1;
    private volatile bool _drawCursor = true;
    private volatile int _monitorIndex;
    private int _bitrate;

    private long _frames, _bytes;

    public H264Streamer(IScreenCapturer capturer, Func<IReadOnlyList<MonitorInfo>> monitors, int monitorIndex,
        IH264EncoderFactory factory, Action<uint, byte[]> sendFrame, Action<object> sendControl)
    {
        _capturer = capturer;
        _monitors = monitors;
        _monitorIndex = monitorIndex;
        _factory = factory;
        _sendFrame = sendFrame;
        _sendControl = sendControl;
    }

    public Action<string>? Log { get; set; }
    /// <summary>How long the network sender still needs for what it holds; while it's over one frame time, the next
    /// capture waits (latest-wins: a fresh picture later beats a stale one queued now).</summary>
    public Func<TimeSpan>? Backlog { get; init; }
    /// <summary>Encoding broke for good (raised once, on the streaming thread).</summary>
    public event Action<string>? Failed;
    public string? EncoderName => _encoder?.Name;
    public long FramesSent => Interlocked.Read(ref _frames);
    public long BytesSent => Interlocked.Read(ref _bytes);
    public int Bitrate => Volatile.Read(ref _bitrate);

    public void Start()
    {
        if (_thread != null) return;
        _thread = new Thread(Loop) { IsBackground = true, Name = "grc-h264", Priority = ThreadPriority.AboveNormal };
        _thread.Start();
    }

    public void SetQuality(int fps, int quality, double scale, bool cursor = true)
    {
        _fps = Math.Clamp(fps, 1, VideoStreamer.MaxFps);
        _quality = Math.Clamp(quality, 10, 95);
        Volatile.Write(ref _scale, Math.Clamp(scale, 0.25, 1));
        _drawCursor = cursor;
        _wake.Set();
    }

    /// <summary>A keyframe request from the controller or an RTCP PLI/FIR.</summary>
    public void RequestKeyframe() { Interlocked.Exchange(ref _keyRequested, 1); _wake.Set(); }

    public void SelectMonitor(int index) { _monitorIndex = index; RequestKeyframe(); }

    /// <summary>
    /// Target bitrate for the picture size: about 0.05–0.2 bits per pixel per frame by quality (screen content
    /// compresses well), 1–40 Mbit/s.
    /// </summary>
    public static int BitrateFor(int width, int height, int fps, int quality)
    {
        double bpp = 0.05 + 0.15 * (Math.Clamp(quality, 10, 95) - 10) / 85.0;
        double bits = (double)width * height * Math.Clamp(fps, 1, 120) * bpp;
        return (int)Math.Clamp(bits, 1_000_000, 40_000_000);
    }

    /// <summary>Encode size for a scale: even, never larger than the source.</summary>
    public static (int W, int H) EncodeSize(int width, int height, double scale)
    {
        var (w, h) = DeltaEncoder.TargetSize(width, height, scale);
        w = Math.Max(2, w & ~1); h = Math.Max(2, h & ~1);
        // BoxScaler handles up to 16× down; scale is clamped to ≥ 0.25 so that always holds
        return (Math.Min(w, width & ~1), Math.Min(h, height & ~1));
    }

    private void Loop()
    {
        var ct = _cts.Token;
        using var timer = new PreciseTimer();
        var sw = Stopwatch.StartNew();
        var next = TimeSpan.Zero;
        var lastSent = TimeSpan.FromDays(-1); // (MinValue would overflow in now - lastSent)
        var lastKey = TimeSpan.FromDays(-1);
        TimeSpan? lastTs = null;
        while (!ct.IsCancellationRequested)
        {
            if (!timer.Wait(next - sw.Elapsed, ct)) break;
            var now = sw.Elapsed;
            var frameTime = TimeSpan.FromSeconds(1.0 / _fps);
            next = now + frameTime;
            if (Backlog != null && Backlog() > frameTime) { next = now + TimeSpan.FromMilliseconds(2); continue; }
            try
            {
                var monitors = _monitors();
                if (monitors.Count == 0) continue;
                var mon = monitors[Math.Min(_monitorIndex, monitors.Count - 1)];
                if (!_capturer.Capture(mon, _full, _drawCursor, _dirty)) continue;
                if ((_full.Width & ~1) < 2 || (_full.Height & ~1) < 2) continue;
                if (_reported != (mon.Index, _full.Width, _full.Height))
                {
                    _reported = (mon.Index, _full.Width, _full.Height);
                    _sendControl(new { t = "monitor", index = mon.Index, width = _full.Width, height = _full.Height });
                }

                var (w, h) = EncodeSize(_full.Width, _full.Height, Volatile.Read(ref _scale));
                int fps = _fps;
                int bitrate = BitrateFor(w, h, fps, _quality);
                bool key = false;
                if (_encoder == null || _encoder.Width != w || _encoder.Height != h)
                {
                    _encoder?.Dispose();
                    _encoder = _factory.Create(w, h, fps, bitrate, Log) ?? throw new InvalidOperationException("no H.264 encoder");
                    _nv12 = new byte[Nv12.Size(w, h)];
                    Volatile.Write(ref _bitrate, bitrate);
                    key = true;
                }
                else if (bitrate != _bitrate)
                {
                    _encoder.SetBitrate(bitrate);
                    Volatile.Write(ref _bitrate, bitrate);
                }
                key |= Interlocked.Exchange(ref _keyRequested, 0) == 1;
                key |= now - lastKey >= KeyframeInterval;
                if (!key && _dirty.IsEmpty && now - lastSent < IdleRefresh) continue; // nothing changed

                FrameBuffer src = _full;
                if (w != _full.Width || h != _full.Height)
                {
                    _scaled.EnsureSize(w, h);
                    _scaler.Scale(_full, _scaled);
                    src = _scaled;
                }
                Nv12.FromBgra(src, _nv12);
                var au = _encoder.Encode(_nv12, key, now);
                _failures = 0;
                if (au == null || au.Length == 0) continue;
                if (key && !AnnexB.HasIdr(au)) RequestKeyframe(); // the encoder ignored the request: ask again
                if (AnnexB.HasIdr(au)) lastKey = now;
                uint duration = lastTs == null ? 3000 : (uint)Math.Max(1, (now - lastTs.Value).TotalSeconds * 90000);
                lastTs = now;
                _sendFrame(duration, au);
                lastSent = now;
                Interlocked.Increment(ref _frames);
                Interlocked.Add(ref _bytes, au.Length);
            }
            catch (Exception ex)
            {
                Log?.Invoke("H.264 frame failed: " + ex.Message);
                try { _encoder?.Dispose(); } catch (Exception) { }
                _encoder = null;
                if (++_failures >= MaxFailures)
                {
                    if (Interlocked.Exchange(ref _failed, 1) == 0) Failed?.Invoke(ex.Message);
                    return;
                }
                if (ct.WaitHandle.WaitOne(200)) break;
            }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _wake.Set();
        bool stopped = _thread == null || _thread == Thread.CurrentThread || _thread.Join(3000);
        if (!stopped) return; // still inside a driver call: leave the encoder to the thread rather than race it
        try { _encoder?.Dispose(); } catch (Exception) { }
        _encoder = null;
    }
}
