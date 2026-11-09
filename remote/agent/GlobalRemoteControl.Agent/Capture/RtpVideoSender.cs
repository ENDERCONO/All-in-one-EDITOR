using System.Diagnostics;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Sends H.264 access units as RTP (RFC 6184) the way low-latency streamers do (PROTOCOL 5.1):
/// <list type="bullet">
/// <item><b>Pacing</b>: packets leave at about <see cref="PacingFactor"/>× the video bitrate instead of all at once,
/// so a big keyframe can't overflow a router / Wi-Fi queue (that loss is what makes a stream freeze);</item>
/// <item><b>Retransmission</b>: the last <see cref="HistorySize"/> packets are kept and resent (same sequence number)
/// when the browser reports them lost with an RTCP NACK — ahead of new video;</item>
/// <item><b>Backlog</b> tells the encoder loop to skip a capture while the link is still busy with the previous
/// frame (latest-wins, no queue of stale frames). Whatever is queued drains within <see cref="DrainTarget"/>; a
/// stalled link (more than <see cref="MaxBacklog"/> queued) drops the queue and asks for a keyframe.</item>
/// <item><b>Unrepairable loss</b>: a NACK for a packet that already left the history, or for one resent
/// <see cref="MaxResends"/> times, raises <see cref="KeyframeNeeded"/>. The browser's own PLI can't be relied on:
/// SIPSorcery keeps one feedback message per RTCP compound packet (a PLI next to a NACK is lost) and only the first
/// NACK entry (17 packets) of each, so without this the picture froze until the next safety IDR.</item>
/// </list>
/// Thread-safe: <see cref="Send"/> from the encoder thread, <see cref="OnNack"/> from the RTCP thread.
/// </summary>
public sealed class RtpVideoSender : IDisposable
{
    public const int MaxPayload = 1180;          // fits a 1280-byte UDP datagram after SRTP + headers
    public const double PacingFactor = 2.5;
    public const int MinPacingBps = 4_000_000;
    public const int HistorySize = 1024;
    public static readonly TimeSpan MaxBacklog = TimeSpan.FromMilliseconds(400);
    public static readonly TimeSpan DrainTarget = TimeSpan.FromMilliseconds(100);
    public static readonly TimeSpan MinResendGap = TimeSpan.FromMilliseconds(20);
    public const int MaxResends = 3;
    public static readonly TimeSpan KeyframeRequestGap = TimeSpan.FromMilliseconds(500);

    /// <summary>Sends one RTP payload: (payload, timestamp, marker, sequence number).</summary>
    private readonly Action<byte[], uint, bool, ushort> _send;
    private readonly object _lock = new();
    private readonly LinkedList<Packet> _queue = new();
    private readonly Packet?[] _history = new Packet?[HistorySize];
    private readonly AutoResetEvent _wake = new(false);
    private readonly CancellationTokenSource _cts = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Thread? _thread;
    private long _queuedBytes;
    private ushort _seq;
    private uint _timestamp;
    private volatile int _rateBps = MinPacingBps;
    private bool _needKey;
    private double _drainBps; // set when something is queued: what's queued now leaves within DrainTarget
    private long _lastKeyNeededTicks = long.MinValue;

    private long _packets, _resent;

    private sealed class Packet
    {
        public required byte[] Payload;
        public uint Timestamp;
        public bool Marker;
        public ushort Seq;
        public long LastSentTicks = -1;
        public bool Resend;
        public int Resends;
    }

    /// <param name="startThread">false for tests: call <see cref="Pump"/> by hand.</param>
    public RtpVideoSender(Action<byte[], uint, bool, ushort> send, bool startThread = true)
    {
        _send = send;
        _seq = (ushort)Random.Shared.Next(0, 65536);
        _timestamp = (uint)Random.Shared.Next();
        if (startThread)
        {
            _thread = new Thread(Loop) { IsBackground = true, Name = "grc-rtp-pacer", Priority = ThreadPriority.AboveNormal };
            _thread.Start();
        }
    }

    /// <summary>Raised (pacer thread) when the queue had to be dropped: the next frame must be a keyframe.</summary>
    public event Action? Overflow;

    /// <summary>
    /// Raised (RTCP thread, at most once per <see cref="KeyframeRequestGap"/>) when the browser reports a loss that
    /// resending can't repair: the next frame must be an IDR.
    /// </summary>
    public event Action? KeyframeNeeded;

    public long PacketsSent => Interlocked.Read(ref _packets);
    public long PacketsResent => Interlocked.Read(ref _resent);
    public int RateBps => _rateBps;

    /// <summary>How long the queued packets still need at the pacing rate.</summary>
    public TimeSpan Backlog
    {
        get { lock (_lock) return TimeSpan.FromSeconds(_queuedBytes * 8.0 / _rateBps); }
    }

    /// <summary>Video bitrate (bits/s); pacing runs at <see cref="PacingFactor"/>× that.</summary>
    public void SetBitrate(int bitsPerSecond) => _rateBps = (int)Math.Clamp(bitsPerSecond * PacingFactor, MinPacingBps, 400_000_000);

    /// <summary>
    /// Queues one access unit; <paramref name="duration"/> advances the 90 kHz timestamp first. If the queue is already
    /// more than <see cref="MaxBacklog"/> behind (the link stalled), it is dropped, <see cref="Overflow"/> asks for a
    /// keyframe, and only a keyframe is accepted until one arrives (a P-frame after a gap would only show garbage).
    /// </summary>
    public void Send(uint duration, byte[] accessUnit)
    {
        var payloads = Packetize(accessUnit);
        if (payloads.Count == 0) return;
        bool overflow = false;
        lock (_lock)
        {
            _timestamp += duration;
            if (TimeSpan.FromSeconds(_queuedBytes * 8.0 / _rateBps) > MaxBacklog)
            {
                foreach (var q in _queue) q.Resend = false;
                _queue.Clear(); _queuedBytes = 0;
                _needKey = true; overflow = true;
            }
            if (_needKey && !AnnexB.HasIdr(accessUnit)) payloads.Clear();
            else _needKey = false;
            for (int i = 0; i < payloads.Count; i++)
            {
                var p = new Packet { Payload = payloads[i], Timestamp = _timestamp, Marker = i == payloads.Count - 1, Seq = _seq++ };
                _history[p.Seq % HistorySize] = p;
                _queue.AddLast(p);
                _queuedBytes += p.Payload.Length;
            }
            _drainBps = Math.Max(_drainBps, _queuedBytes * 8.0 / DrainTarget.TotalSeconds);
        }
        if (overflow) Overflow?.Invoke();
        _wake.Set();
    }

    /// <summary>RTCP generic NACK: <paramref name="pid"/> lost, plus each set bit i of <paramref name="blp"/> = pid+i+1.</summary>
    public int OnNack(ushort pid, ushort blp)
    {
        int queued = 0;
        bool unrepairable = false;
        long now = _clock.ElapsedTicks;
        long gap = (long)(MinResendGap.TotalSeconds * Stopwatch.Frequency);
        lock (_lock)
        {
            LinkedListNode<Packet>? after = null; // keep repairs in sequence order
            for (int i = -1; i < 16; i++)
            {
                if (i >= 0 && (blp & (1 << i)) == 0) continue;
                ushort seq = (ushort)(pid + i + 1);
                var p = _history[seq % HistorySize];
                if (p == null || p.Seq != seq)
                {
                    // gone from the history: only a keyframe repairs it (a seq we never sent is just ignored)
                    if (WasSent(seq)) unrepairable = true;
                    continue;
                }
                if (p.Resend) continue;                                           // already waiting to go again
                if (p.LastSentTicks < 0 || now - p.LastSentTicks < gap) continue; // not sent yet / just resent
                if (p.Resends >= MaxResends) { unrepairable = true; continue; }   // resends don't get through
                p.Resends++;
                p.Resend = true;
                after = after == null ? _queue.AddFirst(p) : _queue.AddAfter(after, p); // repairs go before new video
                _queuedBytes += p.Payload.Length;
                queued++;
            }
        }
        if (queued > 0) _wake.Set();
        if (unrepairable && RequestKeyframeAllowed(now)) KeyframeNeeded?.Invoke();
        return queued;
    }

    /// <summary>True if <paramref name="seq"/> lies before the next sequence number (within half the range).</summary>
    private bool WasSent(ushort seq)
    {
        int behind = (ushort)(_seq - seq);
        return behind is > 0 and < 32768;
    }

    private bool RequestKeyframeAllowed(long now)
    {
        long gap = (long)(KeyframeRequestGap.TotalSeconds * Stopwatch.Frequency);
        lock (_lock)
        {
            if (_lastKeyNeededTicks != long.MinValue && now - _lastKeyNeededTicks < gap) return false;
            _lastKeyNeededTicks = now;
            return true;
        }
    }

    private void Loop()
    {
        var ct = _cts.Token;
        using var timer = new PreciseTimer();
        while (!ct.IsCancellationRequested)
        {
            var wait = Pump();
            if (wait == null) { if (WaitHandle.WaitAny(new[] { _wake, ct.WaitHandle }) == 1) return; }
            else if (!timer.Wait(wait.Value, ct)) return;
        }
    }

    private double _credit;          // bytes allowed to go now
    private long _lastPumpTicks = -1;

    /// <summary>
    /// Sends what the pacing budget allows. Returns how long to wait before the next call, or null when the queue
    /// is empty. (Runs on the pacer thread; public for tests.)
    /// </summary>
    public TimeSpan? Pump()
    {
        long now = _clock.ElapsedTicks;
        int rate;
        // never take longer than DrainTarget for what was queued (a big keyframe at a low bitrate still arrives fast)
        lock (_lock)
        {
            if (_queue.Count == 0) _drainBps = 0;
            rate = (int)Math.Min(400_000_000, Math.Max(_rateBps, _drainBps));
        }
        double burst = Math.Max(4.0 * MaxPayload, rate / 8.0 * 0.002); // ≤ 2 ms worth at once
        if (_lastPumpTicks < 0) _credit = burst;
        else _credit = Math.Min(burst, _credit + (now - _lastPumpTicks) / (double)Stopwatch.Frequency * rate / 8.0);
        _lastPumpTicks = now;

        while (true)
        {
            Packet p;
            lock (_lock)
            {
                if (_queue.Count == 0) return null;
                p = _queue.First!.Value;
                if (_credit < p.Payload.Length)
                    return TimeSpan.FromSeconds(Math.Max(0.0002, (p.Payload.Length - _credit) * 8.0 / rate));
                _queue.RemoveFirst();
                _queuedBytes -= p.Payload.Length;
                _credit -= p.Payload.Length;
                if (p.Resend) Interlocked.Increment(ref _resent);
                p.Resend = false;
                p.LastSentTicks = now;
            }
            try { _send(p.Payload, p.Timestamp, p.Marker, p.Seq); Interlocked.Increment(ref _packets); }
            catch (Exception) { /* transport closing */ }
        }
    }

    /// <summary>
    /// RFC 6184 packetization-mode 1: a NAL unit that fits goes alone, a bigger one as FU-A fragments. Access unit
    /// delimiters are dropped. The caller marks the last packet of the access unit.
    /// </summary>
    public static List<byte[]> Packetize(ReadOnlySpan<byte> au)
    {
        var result = new List<byte[]>();
        foreach (var (start, length) in Nals(au))
        {
            var nal = au.Slice(start, length);
            if (nal.Length == 0) continue;
            int type = nal[0] & 0x1F;
            if (type == 9) continue; // AUD
            if (nal.Length <= MaxPayload) { result.Add(nal.ToArray()); continue; }
            byte fuIndicator = (byte)((nal[0] & 0xE0) | 28);
            int off = 1;
            while (off < nal.Length)
            {
                int n = Math.Min(MaxPayload - 2, nal.Length - off);
                var pkt = new byte[n + 2];
                pkt[0] = fuIndicator;
                pkt[1] = (byte)(type | (off == 1 ? 0x80 : 0) | (off + n == nal.Length ? 0x40 : 0));
                nal.Slice(off, n).CopyTo(pkt.AsSpan(2));
                result.Add(pkt);
                off += n;
            }
        }
        return result;
    }

    /// <summary>(offset, length) of each NAL unit in an Annex-B buffer (start codes removed, trailing zeros kept off).</summary>
    public static List<(int Start, int Length)> Nals(ReadOnlySpan<byte> au)
    {
        var starts = new List<(int Code, int Nal)>();
        for (int i = 0; i + 2 < au.Length; i++)
        {
            if (au[i] != 0 || au[i + 1] != 0) continue;
            if (au[i + 2] == 1) { starts.Add((i, i + 3)); i += 2; }
            else if (au[i + 2] == 0 && i + 3 < au.Length && au[i + 3] == 1) { starts.Add((i, i + 4)); i += 3; }
        }
        var list = new List<(int, int)>(starts.Count);
        for (int k = 0; k < starts.Count; k++)
        {
            int end = k + 1 < starts.Count ? starts[k + 1].Code : au.Length;
            while (end > starts[k].Nal && au[end - 1] == 0 && k + 1 < starts.Count) end--; // trailing_zero_8bits
            list.Add((starts[k].Nal, end - starts[k].Nal));
        }
        return list;
    }

    public void Dispose()
    {
        _cts.Cancel();
        _wake.Set();
        _thread?.Join(1000);
    }
}
