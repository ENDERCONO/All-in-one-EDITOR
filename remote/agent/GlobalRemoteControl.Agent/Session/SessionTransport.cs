using System.Text;
using GlobalRemoteControl.Agent.Crypto;

namespace GlobalRemoteControl.Agent.Session;

/// <summary>The four session channels; the numbers are the relay's channel byte (PROTOCOL.md section 7).</summary>
public enum RelayChannel : byte { Control = 0, Video = 1, Audio = 2, File = 3 }

/// <summary>
/// How a session sends to the controller: the WebRTC data channels, or the encrypted relay over the signaling
/// WebSocket. Senders (video, audio, files, control) don't care which; they self-throttle with <see cref="Buffered"/>.
/// </summary>
public interface ISessionTransport
{
    /// <summary>Sends one binary message on <paramref name="channel"/>. False = not sent (closed / dropped).</summary>
    bool Send(RelayChannel channel, byte[] payload);
    /// <summary>Sends one JSON text message on the control channel.</summary>
    bool SendControl(string json);
    /// <summary>Bytes still queued towards the controller for <paramref name="channel"/>.</summary>
    ulong Buffered(RelayChannel channel);
    /// <summary>Whether <paramref name="channel"/> can carry data at all.</summary>
    bool HasChannel(RelayChannel channel);
}

/// <summary>
/// Agent→controller half of the relay: a bounded send queue drained in order by one pump, which encrypts (assigning
/// the counter) and writes each frame to the WebSocket. Throttling per channel: video is limited by its ack window
/// (it reads <see cref="Buffered"/>), audio is dropped above <see cref="AudioDropAbove"/>, file chunks wait while the
/// queue is over <see cref="FileWaitAbove"/> (1 MB, PROTOCOL section 7), and anything is dropped above <see cref="HardLimit"/>.
/// </summary>
public sealed class RelayTransport : ISessionTransport, IDisposable
{
    public const long AudioDropAbove = 64 * 1024;
    public const long FileWaitAbove = 1024 * 1024;
    public const long HardLimit = 8 * 1024 * 1024;
    public static readonly TimeSpan FileWaitLimit = TimeSpan.FromSeconds(15);

    private readonly RelayCodec _codec;
    private readonly Func<byte[], Task> _sendFrame;
    private readonly Queue<(RelayChannel Ch, byte[] Payload)> _queue = new();
    private readonly SemaphoreSlim _signal = new(0);
    private readonly CancellationTokenSource _cts = new();
    private readonly object _lock = new();
    private long _pending; // queued + being sent
    private int _disposed;

    public RelayTransport(RelayCodec codec, Func<byte[], Task> sendFrame)
    {
        _codec = codec;
        _sendFrame = sendFrame;
        _ = Task.Run(PumpAsync);
    }

    public Action<string>? Log { get; set; }
    public long Pending => Interlocked.Read(ref _pending);
    public long FramesSent { get; private set; }

    public bool HasChannel(RelayChannel channel) => _disposed == 0;
    public ulong Buffered(RelayChannel channel) => (ulong)Math.Max(0, Interlocked.Read(ref _pending));
    public bool SendControl(string json) => Send(RelayChannel.Control, Encoding.UTF8.GetBytes(json));

    public bool Send(RelayChannel channel, byte[] payload)
    {
        if (_disposed != 0 || payload.Length > RelayCodec.MaxPayloadLength) return false;
        switch (channel)
        {
            case RelayChannel.Audio when Pending > AudioDropAbove:
                return false;
            case RelayChannel.File:
                // FileTransferManager already waits (async) above 1 MB via Buffered; this backstop enforces it for any sender
                var deadline = DateTime.UtcNow + FileWaitLimit;
                while (Pending > FileWaitAbove && _disposed == 0 && DateTime.UtcNow < deadline) Thread.Sleep(5);
                break;
        }
        lock (_lock)
        {
            if (_disposed != 0 || _pending + payload.Length > HardLimit) return false;
            _queue.Enqueue((channel, payload));
            _pending += payload.Length;
        }
        _signal.Release();
        return true;
    }

    private async Task PumpAsync()
    {
        var ct = _cts.Token;
        while (true)
        {
            try { await _signal.WaitAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
            (RelayChannel Ch, byte[] Payload) item;
            lock (_lock) { if (!_queue.TryDequeue(out item)) continue; }
            try
            {
                await _sendFrame(_codec.Encrypt((byte)item.Ch, item.Payload)).ConfigureAwait(false);
                FramesSent++;
            }
            catch (Exception ex) { Log?.Invoke("relay send failed: " + ex.Message); }
            finally { lock (_lock) _pending -= item.Payload.Length; }
        }
    }

    /// <summary>Waits until everything queued so far has been handed to the WebSocket (tests).</summary>
    internal async Task<bool> DrainAsync(TimeSpan timeout)
    {
        var end = DateTime.UtcNow + timeout;
        while (Pending > 0) { if (DateTime.UtcNow > end) return false; await Task.Delay(2); }
        return true;
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _cts.Cancel();
        lock (_lock) { _queue.Clear(); _pending = 0; }
    }
}
