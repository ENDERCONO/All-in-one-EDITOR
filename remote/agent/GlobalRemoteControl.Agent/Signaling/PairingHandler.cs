using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Signaling;

/// <summary>PROTOCOL.md section 2, device side. The local user approves every new controller.</summary>
public sealed class PairingHandler
{
    public static readonly TimeSpan ApprovalTimeout = TimeSpan.FromSeconds(60); // server gives up at 90 s

    private readonly ISignalSender _signal;
    private readonly TrustedControllerStore _store;
    private readonly IUserPrompts _prompts;
    private readonly AuditLog _audit;
    private int _pendingPrompts;
    private CancellationTokenSource _cancel = new();

    public PairingHandler(ISignalSender signal, TrustedControllerStore store, IUserPrompts prompts, AuditLog audit)
    {
        _signal = signal; _store = store; _prompts = prompts; _audit = audit;
    }

    /// <summary>Latest pairing code from the server (code, expiresAt).</summary>
    public event Action<string, DateTimeOffset>? CodeReceived;

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
        CodeReceived?.Invoke(code, DateTimeOffset.FromUnixTimeMilliseconds(exp.Value));
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
            _audit.Write("pair-request", name, id, "fingerprint " + fp);
            bool approved;
            try { approved = await _prompts.ApprovePairingAsync(Settings.AgentSettings.NormalizeName(name), id, fp, ApprovalTimeout, _cancel.Token); }
            catch (Exception) { approved = false; }
            if (approved) _store.Add(id, name, publicKey!);
            _audit.Write(approved ? "pair-approved" : "pair-denied", name, id, "fingerprint " + fp);
            await _signal.SendAsync(new { type = "pair-result", requestId, approved });
        }
        finally { Interlocked.Decrement(ref _pendingPrompts); }
    }
}
