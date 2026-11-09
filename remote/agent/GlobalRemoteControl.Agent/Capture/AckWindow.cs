namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Flow control for video (PROTOCOL.md section 5): at most <see cref="MaxUnackedFrames"/> frames or
/// <see cref="MaxUnackedBytes"/> un-acked, and the channel's buffered amount under <see cref="MaxBuffered"/>. A single
/// frame larger than the byte budget may still go when nothing is outstanding. If the controller stops acking for
/// <see cref="StallTimeout"/>, the window is reset so a lost ack cannot freeze the stream forever.
/// </summary>
public sealed class AckWindow
{
    // 12 so a slow round trip (the WebSocket relay: ~0.4 s) still allows ~30 fps; the byte cap keeps queues small
    public const int MaxUnackedFrames = 12;
    public const long MaxUnackedBytes = 1536 * 1024;
    public const ulong MaxBuffered = 1024 * 1024;
    public static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(5);

    private readonly object _lock = new();
    private readonly Queue<(uint Id, int Bytes)> _inFlight = new();
    private uint _lastSent;
    private uint _lastAcked;
    private long _unackedBytes;
    private DateTime _lastProgress = DateTime.UtcNow;

    public uint LastSent { get { lock (_lock) return _lastSent; } }
    public uint LastAcked { get { lock (_lock) return _lastAcked; } }
    public int UnackedFrames { get { lock (_lock) return _inFlight.Count; } }
    public long UnackedBytes { get { lock (_lock) return _unackedBytes; } }

    public uint NextFrameId() { lock (_lock) return _lastSent + 1; }

    /// <summary>Forgets everything outstanding (the stream restarts; late acks for older frames are ignored).</summary>
    public void Reset(DateTime now)
    {
        lock (_lock) { _inFlight.Clear(); _unackedBytes = 0; _lastAcked = _lastSent; _lastProgress = now; }
    }

    public bool CanSend(ulong bufferedAmount, DateTime now)
    {
        if (bufferedAmount >= MaxBuffered) return false;
        lock (_lock)
        {
            if (_inFlight.Count == 0) return true;
            if (_inFlight.Count < MaxUnackedFrames && _unackedBytes < MaxUnackedBytes) return true;
            if (now - _lastProgress > StallTimeout)
            {
                _inFlight.Clear(); _unackedBytes = 0; _lastAcked = _lastSent; _lastProgress = now;
                return true;
            }
            return false;
        }
    }

    public void OnSent(uint frameId, int bytes, DateTime now)
    {
        lock (_lock)
        {
            if (_inFlight.Count == 0) _lastProgress = now;
            _lastSent = frameId;
            _inFlight.Enqueue((frameId, bytes));
            _unackedBytes += bytes;
        }
    }

    /// <summary>Accepts only acks for frames actually sent and newer than the last ack; acks everything up to it.</summary>
    public bool OnAck(uint frameId, DateTime now)
    {
        lock (_lock)
        {
            if (frameId <= _lastAcked || frameId > _lastSent) return false;
            _lastAcked = frameId;
            _lastProgress = now;
            while (_inFlight.Count > 0 && _inFlight.Peek().Id <= frameId) _unackedBytes -= _inFlight.Dequeue().Bytes;
            return true;
        }
    }
}

/// <summary>
/// When to send a keyframe (PROTOCOL.md section 5): session start, picture size / monitor / scale change, a
/// <c>{t:"keyframe"}</c> request, and every <see cref="Interval"/> as a safety refresh.
/// </summary>
public sealed class KeyframePolicy
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(10);

    private int _requested = 1; // session start
    private DateTime _lastKeyframe = DateTime.MinValue;
    private (int Monitor, int W, int H, double Scale) _last = (-1, 0, 0, 0);

    /// <summary>A <c>{t:"keyframe"}</c> request (any thread).</summary>
    public void Request() => Interlocked.Exchange(ref _requested, 1);

    public bool Pending => Volatile.Read(ref _requested) == 1;

    /// <summary>
    /// True when the next frame must be a keyframe. Consumes a pending request atomically, so a request that arrives
    /// while this frame is being encoded is kept for the next one instead of being lost. (If the encode then fails
    /// the encoder is reset, which forces a keyframe anyway.)
    /// </summary>
    public bool ShouldSend(DateTime now, int monitor, int width, int height, double scale)
    {
        bool changed = _last != (monitor, width, height, scale);
        _last = (monitor, width, height, scale);
        bool requested = Interlocked.Exchange(ref _requested, 0) == 1;
        return changed | requested | now - _lastKeyframe >= Interval;
    }

    /// <summary>A keyframe went out (forced or because most of the picture changed): restarts the safety interval.</summary>
    public void OnSent(DateTime now) => _lastKeyframe = now;
}
