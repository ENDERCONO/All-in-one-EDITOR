namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Flow control for video (PROTOCOL.md section 5): at most <see cref="MaxUnacked"/> frames un-acked and the
/// channel's buffered amount under 256 KB. If the controller stops acking for <see cref="StallTimeout"/>, the
/// window is reset so a lost ack cannot freeze the stream forever.
/// </summary>
public sealed class AckWindow
{
    public const int MaxUnacked = 2;
    public const ulong MaxBuffered = 256 * 1024;
    public static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(5);

    private readonly object _lock = new();
    private uint _lastSent;
    private uint _lastAcked;
    private DateTime _lastProgress = DateTime.UtcNow;

    public uint LastSent { get { lock (_lock) return _lastSent; } }
    public uint LastAcked { get { lock (_lock) return _lastAcked; } }

    public uint NextFrameId() { lock (_lock) return _lastSent + 1; }

    public bool CanSend(ulong bufferedAmount, DateTime now)
    {
        if (bufferedAmount >= MaxBuffered) return false;
        lock (_lock)
        {
            if (_lastSent - _lastAcked < MaxUnacked) return true;
            if (now - _lastProgress > StallTimeout) { _lastAcked = _lastSent; _lastProgress = now; return true; }
            return false;
        }
    }

    public void OnSent(uint frameId, DateTime now)
    {
        lock (_lock)
        {
            if (_lastSent == _lastAcked) _lastProgress = now;
            _lastSent = frameId;
        }
    }

    /// <summary>Accepts only acks for frames actually sent and newer than the last ack.</summary>
    public bool OnAck(uint frameId, DateTime now)
    {
        lock (_lock)
        {
            if (frameId <= _lastAcked || frameId > _lastSent) return false;
            _lastAcked = frameId;
            _lastProgress = now;
            return true;
        }
    }
}
