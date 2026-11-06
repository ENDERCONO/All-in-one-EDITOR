using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Signaling;

/// <summary>
/// PROTOCOL.md section 2, device side. The local user approves every new controller — at the PC, or from a
/// "my device" (section 8), which may also ask for a pairing code.
/// </summary>
public sealed class PairingHandler
{
    public static readonly TimeSpan ApprovalTimeout = TimeSpan.FromSeconds(60); // server gives up at 90 s
    public static readonly TimeSpan CodeRequestSkew = TimeSpan.FromMinutes(2);
    public const int CodeRequestsPer10Min = 5;

    private readonly ISignalSender _signal;
    private readonly TrustedControllerStore _store;
    private readonly IUserPrompts _prompts;
    private readonly AuditLog _audit;
    private readonly OwnerApprovals? _approvals;
    private readonly string? _deviceId;
    private int _pendingPrompts;
    private CancellationTokenSource _cancel = new();
    private readonly object _codeLock = new();
    private readonly Dictionary<string, DateTimeOffset> _seenCodeRequests = new();
    private readonly Queue<DateTimeOffset> _codeRequestTimes = new();
    private TaskCompletionSource<(string, DateTimeOffset)>? _codeWaiter;

    public PairingHandler(ISignalSender signal, TrustedControllerStore store, IUserPrompts prompts, AuditLog audit,
        OwnerApprovals? approvals = null, string? deviceId = null)
    {
        _signal = signal; _store = store; _prompts = prompts; _audit = audit; _approvals = approvals; _deviceId = deviceId;
    }

    /// <summary>Latest pairing code from the server (code, expiresAt).</summary>
    public event Action<string, DateTimeOffset>? CodeReceived;

    /// <summary>A my-device asked for a code: the UI must open a fresh code window (which requests one code), as for
    /// "Pair a new device". Without a subscriber the handler requests the code itself.</summary>
    public event Action? RemoteCodeRequested;

    /// <summary>Clock for the code-request freshness check (tests).</summary>
    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;

    /// <summary>Signaling lost: the server can no longer deliver our answer, so close any open pairing dialog.</summary>
    public void OnDisconnected()
    {
        var old = Interlocked.Exchange(ref _cancel, new CancellationTokenSource());
        try { old.Cancel(); } catch (Exception) { }
    }

    public Task RequestCodeAsync()
    {
        _audit.Write("pairing-code-requested");
        return _signal.SendAsync(new { type = "pairing-code-request" });
    }

    public void OnPairingCode(JsonElement m)
    {
        var code = Json.Str(m, "code", 16, 4);
        var exp = Json.Int(m, "expiresAt");
        if (code == null || exp == null) return;
        var expires = DateTimeOffset.FromUnixTimeMilliseconds(exp.Value);
        CodeReceived?.Invoke(code, expires);
        lock (_codeLock) { _codeWaiter?.TrySetResult((code, expires)); _codeWaiter = null; }
    }

    public async Task OnPairRequestAsync(JsonElement m)
    {
        var requestId = Json.Str(m, "requestId", 64, 1);
        var c = Json.Obj(m, "controller");
        if (requestId == null || c == null) return;
        var id = Json.Str(c.Value, "id", 22, 22);
        var name = Json.Str(c.Value, "name", 64, 1);
        var publicKey = Json.Str(c.Value, "publicKey", 400, 1);
        var spki = IdentityUtil.ParseP256Spki(publicKey);
        // Never trust the server's word: the id must be derived from the key we will store.
        if (id == null || name == null || spki == null || IdentityUtil.DeriveId(spki) != id)
        {
            _audit.Write("pair-rejected", name, id, "malformed or mismatched controller identity");
            await _signal.SendAsync(new { type = "pair-result", requestId, approved = false });
            return;
        }
        if (Interlocked.Increment(ref _pendingPrompts) > 1)
        {
            Interlocked.Decrement(ref _pendingPrompts);
            _audit.Write("pair-rejected", name, id, "another pairing request is already waiting");
            await _signal.SendAsync(new { type = "pair-result", requestId, approved = false });
            return;
        }
        try
        {
            var fp = IdentityUtil.Fingerprint(spki);
            var shownName = Settings.AgentSettings.NormalizeName(name);
            _audit.Write("pair-request", name, id, "fingerprint " + fp);
            string decision; // "trust" | "once" | "deny"
            string by = "at the PC";
            try
            {
                if (_approvals == null)
                    decision = await _prompts.ApprovePairingAsync(shownName, id, fp, ApprovalTimeout, _cancel.Token) ? "trust" : "deny";
                else
                {
                    var (local, remote) = await _approvals.RaceAsync(
                        t => _prompts.ApprovePairingAsync(shownName, id, fp, ApprovalTimeout, t),
                        "pair", id, shownName, fp, ApprovalTimeout, _cancel.Token);
                    if (remote != null) by = "from a my-device";
                    decision = remote ?? (local ? "trust" : "deny");
                }
            }
            catch (Exception) { decision = "deny"; }

            bool temporary = false;
            if (decision == "trust") _store.Add(id, name, publicKey!);
            else if (decision == "once")
            {
                try { _store.AddTemporary(id, name, publicKey!); temporary = true; }
                catch (InvalidOperationException) { decision = "trust"; } // already paired: keep it as is
            }
            var approved = decision != "deny";
            _audit.Write(!approved ? "pair-denied" : temporary ? "pair-approved-once" : "pair-approved", name, id, $"fingerprint {fp}, {by}");
            if (temporary) await _signal.SendAsync(new { type = "pair-result", requestId, approved, temporary = true });
            else await _signal.SendAsync(new { type = "pair-result", requestId, approved });
        }
        finally { Interlocked.Decrement(ref _pendingPrompts); }
    }

    /// <summary>code-request from a my-device (PROTOCOL section 8).</summary>
    public async Task OnCodeRequestAsync(JsonElement m)
    {
        var controllerId = Json.Str(m, "controllerId", 22, 22);
        var requestId = Json.Str(m, "requestId", 22, 22);
        var ts = Json.Int(m, "ts");
        var sig = Json.Str(m, "signature", 100, 1);
        if (controllerId == null || !Json.IsId(requestId) || ts == null) return;
        var owner = _store.Get(controllerId);
        string? error = null;
        var now = Now();
        if (_deviceId == null || owner == null || !owner.Owner) error = "not-allowed";
        else if (!IdentityUtil.Verify(owner.PublicKey, IdentityUtil.CodeRequestString(_deviceId, requestId!, ts.Value), sig)) error = "not-allowed";
        else if ((now - DateTimeOffset.FromUnixTimeMilliseconds(ts.Value)).Duration() > CodeRequestSkew) error = "stale";
        else
        {
            lock (_codeLock)
            {
                foreach (var k in _seenCodeRequests.Where(kv => now - kv.Value > TimeSpan.FromMinutes(10)).Select(kv => kv.Key).ToList())
                    _seenCodeRequests.Remove(k);
                while (_codeRequestTimes.Count > 0 && now - _codeRequestTimes.Peek() > TimeSpan.FromMinutes(10)) _codeRequestTimes.Dequeue();
                if (_seenCodeRequests.ContainsKey(requestId!)) error = "replayed";
                else if (_codeRequestTimes.Count >= CodeRequestsPer10Min) error = "rate-limited";
                else { _seenCodeRequests[requestId!] = now; _codeRequestTimes.Enqueue(now); }
            }
        }
        if (error != null)
        {
            _audit.Write("code-request-refused", owner?.Name, controllerId, error);
            await _signal.SendAsync(new { type = "code-reply", to = controllerId, requestId, error });
            return;
        }

        _audit.Write("code-request", owner!.Name, owner.Id, "pairing code requested from a my-device");
        var waiter = new TaskCompletionSource<(string, DateTimeOffset)>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_codeLock) { _codeWaiter?.TrySetCanceled(); _codeWaiter = waiter; }
        // The UI opens a fresh code window, which requests exactly one code (a second request would replace it).
        var ui = RemoteCodeRequested;
        if (ui != null) { try { ui(); } catch (Exception) { await RequestCodeAsync().ConfigureAwait(false); } }
        else await RequestCodeAsync().ConfigureAwait(false);
        try
        {
            var (code, expires) = await waiter.Task.WaitAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
            await _signal.SendAsync(new { type = "code-reply", to = controllerId, requestId, code, expiresAt = expires.ToUnixTimeMilliseconds() });
        }
        catch (Exception)
        {
            await _signal.SendAsync(new { type = "code-reply", to = controllerId, requestId, error = "failed" });
        }
    }
}
