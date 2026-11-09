using System.Collections.Concurrent;
using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Signaling;

/// <summary>
/// PROTOCOL section 8, device side: while a pairing or session dialog is open, the same question also goes to every
/// saved trusted controller (not only "my device" ones: the owner's call, 2026-11-09, so a trusted phone or laptop can
/// let a new computer in without remoting into the PC first). "Allow once" controllers are never asked. A reply counts
/// only if it answers a request we sent to that controller, that controller is still saved as trusted now, and it is
/// signed with the key stored at pairing.
/// </summary>
public sealed class OwnerApprovals
{
    public static readonly string[] PairDecisions = { "once", "trust", "deny" };
    public static readonly string[] SessionDecisions = { "control", "view", "deny" };

    private sealed record Outstanding(string OwnerId, string Kind, TaskCompletionSource<string> Result);

    private readonly ISignalSender _signal;
    private readonly DeviceIdentity _identity;
    private readonly TrustedControllerStore _store;
    private readonly AuditLog _audit;
    private readonly ConcurrentDictionary<string, Outstanding> _out = new();

    public OwnerApprovals(ISignalSender signal, DeviceIdentity identity, TrustedControllerStore store, AuditLog audit)
    {
        _signal = signal; _identity = identity; _store = store; _audit = audit;
    }

    /// <summary>Requests currently waiting for an answer (tests).</summary>
    public int Pending => _out.Count;

    /// <summary>The controllers that may approve: every saved trusted one ("once" controllers are not saved).</summary>
    private IEnumerable<TrustedController> Approvers => _store.All;

    /// <summary>True if some trusted controller other than <paramref name="subjectId"/> could be asked.</summary>
    public bool CanAsk(string subjectId) => Approvers.Any(o => o.Id != subjectId);

    /// <summary>
    /// Asks every trusted controller (except the subject itself). Completes with the first valid decision, or null when
    /// <paramref name="cancel"/> fires or the time is up. Outstanding requests are withdrawn either way.
    /// </summary>
    public async Task<string?> AskAsync(string kind, string subjectId, string subjectName, string subjectFingerprint,
        TimeSpan timeout, CancellationToken cancel)
    {
        var owners = Approvers.Where(o => o.Id != subjectId).ToList();
        if (owners.Count == 0) return null;
        var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var expiresAt = DateTimeOffset.UtcNow.Add(timeout).ToUnixTimeMilliseconds();
        var sent = new List<(string ApprovalId, string OwnerId)>();
        try
        {
            foreach (var o in owners)
            {
                var approvalId = IdentityUtil.RandomId();
                _out[approvalId] = new Outstanding(o.Id, kind, result);
                sent.Add((approvalId, o.Id));
                await _signal.SendAsync(new
                {
                    type = "approval-request", to = o.Id, approvalId, kind,
                    subject = new { id = subjectId, name = subjectName, fingerprint = subjectFingerprint },
                    expiresAt,
                    signature = _identity.Sign(IdentityUtil.ApprovalRequestString(approvalId, kind, subjectId, subjectFingerprint, expiresAt, subjectName)),
                }).ConfigureAwait(false);
            }
            _audit.Write("approval-asked", subjectName, subjectId, $"{kind}: sent to {string.Join(", ", owners.Select(o => o.Name))}");
            try { return await result.Task.WaitAsync(timeout, cancel).ConfigureAwait(false); }
            catch (Exception ex) when (ex is TimeoutException or OperationCanceledException) { return null; }
        }
        finally
        {
            foreach (var (approvalId, ownerId) in sent)
            {
                _out.TryRemove(approvalId, out _);
                // closes the prompt on the other trusted devices (and on this one if it never answered)
                _ = _signal.SendAsync(new { type = "approval-cancel", to = ownerId, approvalId });
            }
        }
    }

    /// <summary>approval-result from the server.</summary>
    public void OnResult(JsonElement m)
    {
        var controllerId = Json.Str(m, "controllerId", 22, 22);
        var approvalId = Json.Str(m, "approvalId", 22, 22);
        var decision = Json.Str(m, "decision", 16, 1);
        var signature = Json.Str(m, "signature", 100, 1);
        if (approvalId == null || !_out.TryGetValue(approvalId, out var o)) return; // unknown, answered or withdrawn
        var owner = Approvers.FirstOrDefault(c => c.Id == controllerId);
        string? why = null;
        if (controllerId != o.OwnerId) why = "answered by a device it was not sent to";
        else if (owner == null) why = "no longer a trusted device";
        else if (decision == null || !(o.Kind == "pair" ? PairDecisions : SessionDecisions).Contains(decision)) why = "invalid decision";
        else if (!IdentityUtil.Verify(owner.PublicKey, IdentityUtil.ApproveString(_identity.DeviceId, approvalId, o.Kind, decision), signature))
            why = "bad signature";
        if (why != null)
        {
            _audit.Write("approval-rejected", owner?.Name, controllerId, why);
            return;
        }
        if (_out.TryRemove(approvalId, out _) && o.Result.TrySetResult(decision!))
            _audit.Write("approval-answered", owner!.Name, owner.Id, $"{o.Kind}: {decision}");
    }

    /// <summary>
    /// The PC dialog and the trusted-device question run side by side; whichever answers first wins and the other is
    /// closed. <paramref name="local"/> gets a token that is cancelled when the remote answer wins (the dialog then
    /// closes itself). Returns (decision text, answeredRemotely).
    /// </summary>
    public async Task<(T Local, string? Remote)> RaceAsync<T>(Func<CancellationToken, Task<T>> local, string kind,
        string subjectId, string subjectName, string subjectFingerprint, TimeSpan timeout, CancellationToken cancel)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        var localTask = local(cts.Token);
        if (!CanAsk(subjectId)) return (await localTask.ConfigureAwait(false), null);
        var remoteTask = AskAsync(kind, subjectId, subjectName, subjectFingerprint, timeout, cts.Token);
        var first = await Task.WhenAny(localTask, remoteTask).ConfigureAwait(false);
        if (first == remoteTask && remoteTask.Result is { } remote)
        {
            cts.Cancel(); // close the PC dialog; don't wait for it to finish closing
            _ = localTask.ContinueWith(t => _ = t.Exception, CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
            return (default!, remote);
        }
        if (first == localTask)
        {
            cts.Cancel(); // withdraw the trusted-device question
            try { await remoteTask.ConfigureAwait(false); } catch (Exception) { }
            return (await localTask.ConfigureAwait(false), null);
        }
        // the remote side gave up (timeout / nobody answered): the PC dialog decides
        return (await localTask.ConfigureAwait(false), null);
    }
}
