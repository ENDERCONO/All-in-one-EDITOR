namespace GlobalRemoteControl.Agent.Session;

public enum ApprovalResult { Control, View, Deny, Timeout }

/// <summary>
/// Everything that needs the person at the PC. Implemented by the WinForms UI (topmost dialogs, default = Deny,
/// auto-deny on timeout); tests use fakes.
/// </summary>
/// <remarks>
/// The overloads taking a <see cref="CancellationToken"/> are what the agent calls: the token is cancelled when the
/// request goes away (controller disconnected, session ended, signaling lost, kill switch), and the UI then closes
/// the dialog by itself and the call resolves as denied. They default to the token-less versions so simple fakes
/// only need to implement those.
/// </remarks>
public interface IUserPrompts
{
    Task<bool> ApprovePairingAsync(string controllerName, string controllerId, string fingerprint, TimeSpan timeout);

    /// <param name="allowControl">false when only view-only may be granted (e.g. MCP asked for view).</param>
    Task<ApprovalResult> ApproveSessionAsync(string label, string fingerprint, string? reason, bool allowControl, TimeSpan timeout);

    /// <summary>Approval dialog + Save dialog. Returns the chosen destination path, or null if denied/cancelled.</summary>
    Task<string?> ApproveIncomingFileAsync(string label, string fingerprint, string fileName, long size, TimeSpan timeout);

    /// <summary>Open dialog for "Send a file to the remote device". Null if cancelled.</summary>
    Task<string?> PickFileToSendAsync();

    Task<bool> ApprovePairingAsync(string controllerName, string controllerId, string fingerprint, TimeSpan timeout,
        CancellationToken cancel) => ApprovePairingAsync(controllerName, controllerId, fingerprint, timeout);

    Task<ApprovalResult> ApproveSessionAsync(string label, string fingerprint, string? reason, bool allowControl, TimeSpan timeout,
        CancellationToken cancel) => ApproveSessionAsync(label, fingerprint, reason, allowControl, timeout);

    Task<string?> ApproveIncomingFileAsync(string label, string fingerprint, string fileName, long size, TimeSpan timeout,
        CancellationToken cancel) => ApproveIncomingFileAsync(label, fingerprint, fileName, size, timeout);
}
