using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using GlobalRemoteControl.Agent.Crypto;

namespace GlobalRemoteControl.Agent.Signaling;

public enum SignalingState { Disconnected, Connecting, Connected }

public sealed record IceServerConfig(IReadOnlyList<string> Urls, string? Username, string? Credential);

public interface ISignalSender
{
    /// <summary>Sends a JSON message to the signaling server (dropped silently when disconnected).</summary>
    Task SendAsync(object message);

    /// <summary>Sends one binary frame (encrypted relay, PROTOCOL.md section 7); dropped when disconnected.
    /// Completes when the frame has been written to the socket, so callers can pace themselves.</summary>
    Task SendBinaryAsync(byte[] frame);
}

/// <summary>
/// Device side of PROTOCOL.md section 1 over a ClientWebSocket with automatic reconnect (exponential backoff).
/// Authenticated messages after "ready" are raised through <see cref="MessageReceived"/>.
/// </summary>
public sealed class SignalingClient : ISignalSender, IDisposable
{
    private readonly DeviceIdentity _identity;
    private readonly Func<string> _deviceName;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private CancellationTokenSource? _cts;
    private ClientWebSocket? _ws;
    private Task? _loop;
    private volatile bool _ready;

    public SignalingClient(DeviceIdentity identity, Func<string> deviceName)
    {
        _identity = identity;
        _deviceName = deviceName;
    }

    public SignalingState State { get; private set; } = SignalingState.Disconnected;
    public string? LastError { get; private set; }
    public string? ServerUrl { get; private set; }
    public IReadOnlyList<IceServerConfig> IceServers { get; private set; } = DefaultIce;

    private static readonly IReadOnlyList<IceServerConfig> DefaultIce =
        new[] { new IceServerConfig(new[] { "stun:stun.l.google.com:19302" }, null, null) };

    public event Action<SignalingState>? StateChanged;
    public event Action<string, JsonElement>? MessageReceived;

    /// <summary>
    /// Binary frames (encrypted relay) after authentication, raised synchronously on the receive loop in arrival
    /// order, interleaved correctly with <see cref="MessageReceived"/>: the next message is not read until the
    /// handler returns, so a relay-start handled synchronously is in effect before the frames that follow it.
    /// </summary>
    public event Action<byte[]>? BinaryReceived;

    public void Start(string url)
    {
        Stop();
        ServerUrl = url;
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _loop = Task.Run(() => RunAsync(new Uri(url), token));
    }

    public void Stop()
    {
        _cts?.Cancel();
        try { _ws?.Abort(); } catch (Exception) { }
        _cts = null;
        SetState(SignalingState.Disconnected);
    }

    private void SetState(SignalingState s)
    {
        if (State == s) return;
        State = s;
        StateChanged?.Invoke(s);
    }

    private async Task RunAsync(Uri uri, CancellationToken ct)
    {
        int attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            SetState(SignalingState.Connecting);
            try
            {
                using var ws = new ClientWebSocket();
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                _ws = ws;
                using (var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    connectCts.CancelAfter(TimeSpan.FromSeconds(20)); // Render free tier can take a while to wake up
                    await ws.ConnectAsync(uri, connectCts.Token);
                }
                await ReceiveLoopAsync(ws, ct, () => attempt = 0);
                LastError = ws.CloseStatusDescription ?? "connection closed";
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) { LastError = ex.Message; }
            finally { _ready = false; _ws = null; }

            SetState(SignalingState.Disconnected);
            if (ct.IsCancellationRequested) break;
            var delay = Backoff(attempt++);
            try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>1 s, 2 s, 4 s ... capped at 30 s, plus up to 20 % jitter.</summary>
    public static TimeSpan Backoff(int attempt)
    {
        double s = Math.Min(30, Math.Pow(2, Math.Min(attempt, 5)));
        return TimeSpan.FromSeconds(s * (1 + Random.Shared.NextDouble() * 0.2));
    }

    /// <summary>Messages (text or binary) larger than this are read to the end and dropped.</summary>
    public const int MaxFrameBytes = Json.MaxMessageBytes;

    /// <summary>Reads messages strictly one after another; each is fully handled before the next is read.</summary>
    internal async Task ReceiveLoopAsync(WebSocket ws, CancellationToken ct, Action onReady)
    {
        var buffer = new byte[MaxFrameBytes + 1];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            int len = 0;
            bool oversize = false;
            WebSocketReceiveResult r;
            do
            {
                if (len >= buffer.Length) { oversize = true; len = 0; } // keep draining, drop it at the end
                r = await ws.ReceiveAsync(new ArraySegment<byte>(buffer, len, buffer.Length - len), ct);
                if (r.MessageType == WebSocketMessageType.Close) return;
                len += r.Count;
            } while (!r.EndOfMessage);
            if (oversize || len > MaxFrameBytes) continue;

            if (r.MessageType == WebSocketMessageType.Binary)
            {
                if (!_ready || len == 0) continue; // nothing before authentication
                try { BinaryReceived?.Invoke(buffer.AsSpan(0, len).ToArray()); }
                catch (Exception ex) { LastError = "binary handler: " + ex.Message; }
                continue;
            }
            var text = Encoding.UTF8.GetString(buffer, 0, len);
            if (!Json.TryParseObject(text, "type", out var msg, out var type)) continue;
            await HandleAsync(type, msg, onReady);
        }
    }

    private async Task HandleAsync(string type, JsonElement msg, Action onReady)
    {
        switch (type)
        {
            case "challenge":
                var nonce = Json.Str(msg, "nonce", 128, 1);
                if (nonce == null) return;
                await SendRawAsync(new
                {
                    type = "hello",
                    role = "device",
                    publicKey = _identity.PublicKeyBase64,
                    name = _deviceName(),
                    signature = _identity.Sign(IdentityUtil.AuthString("device", nonce)),
                });
                return;
            case "ready":
                IceServers = ParseIceServers(msg);
                var id = Json.Str(msg, "id", 64);
                if (id != _identity.DeviceId) LastError = "server reported an unexpected device id";
                _ready = true;
                onReady();
                LastError = null;
                SetState(SignalingState.Connected);
                MessageReceived?.Invoke(type, msg);
                return;
            default:
                if (!_ready) return; // nothing before authentication
                MessageReceived?.Invoke(type, msg);
                return;
        }
    }

    public static IReadOnlyList<IceServerConfig> ParseIceServers(JsonElement msg)
    {
        var list = new List<IceServerConfig>();
        if (msg.TryGetProperty("iceServers", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var s in arr.EnumerateArray().Take(8))
            {
                if (s.ValueKind != JsonValueKind.Object || !s.TryGetProperty("urls", out var u)) continue;
                var urls = new List<string>();
                if (u.ValueKind == JsonValueKind.String) urls.Add(u.GetString()!);
                else if (u.ValueKind == JsonValueKind.Array)
                    urls.AddRange(u.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).Take(8));
                urls = urls.Where(x => x.Length <= 256 && (x.StartsWith("stun:") || x.StartsWith("turn:") || x.StartsWith("turns:"))).ToList();
                if (urls.Count == 0) continue;
                list.Add(new IceServerConfig(urls, Json.Str(s, "username", 256), Json.Str(s, "credential", 256)));
            }
        }
        return list.Count > 0 ? list : DefaultIce;
    }

    public Task SendAsync(object message) => _ready ? SendRawAsync(message) : Task.CompletedTask;

    private async Task SendRawAsync(object message)
    {
        var ws = _ws;
        if (ws == null || ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(Json.Serialize(message));
        if (bytes.Length > Json.MaxMessageBytes) return;
        await _sendLock.WaitAsync();
        try { await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None); }
        catch (Exception ex) { LastError = ex.Message; }
        finally { _sendLock.Release(); }
    }

    public async Task SendBinaryAsync(byte[] frame)
    {
        var ws = _ws;
        if (!_ready || ws == null || ws.State != WebSocketState.Open || frame.Length == 0 || frame.Length > MaxFrameBytes) return;
        await _sendLock.WaitAsync().ConfigureAwait(false);
        try { await ws.SendAsync(frame, WebSocketMessageType.Binary, true, CancellationToken.None).ConfigureAwait(false); }
        catch (Exception ex) { LastError = ex.Message; }
        finally { _sendLock.Release(); }
    }

    public void Dispose() => Stop();
}
