using GlobalRemoteControl.Agent.Session;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>
/// <see cref="IUserPrompts"/> with topmost WinForms dialogs. Every dialog shows who is asking (name + fingerprint),
/// defaults to Deny, denies itself on timeout and closes itself when the request is cancelled.
/// </summary>
internal sealed class WinFormsPrompts : IUserPrompts
{
    private readonly UiDispatcher _ui;

    public WinFormsPrompts(UiDispatcher ui) => _ui = ui;

    public Task<bool> ApprovePairingAsync(string controllerName, string controllerId, string fingerprint, TimeSpan timeout) =>
        ApprovePairingAsync(controllerName, controllerId, fingerprint, timeout, CancellationToken.None);

    public Task<ApprovalResult> ApproveSessionAsync(string label, string fingerprint, string? reason, bool allowControl, TimeSpan timeout) =>
        ApproveSessionAsync(label, fingerprint, reason, allowControl, timeout, CancellationToken.None);

    public Task<string?> ApproveIncomingFileAsync(string label, string fingerprint, string fileName, long size, TimeSpan timeout) =>
        ApproveIncomingFileAsync(label, fingerprint, fileName, size, timeout, CancellationToken.None);

    public async Task<bool> ApprovePairingAsync(string controllerName, string controllerId, string fingerprint, TimeSpan timeout,
        CancellationToken cancel)
    {
        var r = await ShowAsync(() => new ApprovalDialog(
            "GlobalRemoteControl — pair a new device",
            "A new device wants to be allowed to connect to this PC",
            new[] { ("Device", controllerName, false), ("Fingerprint", fingerprint, true), ("Device id", controllerId, false) },
            "Approve only if you just entered the pairing code yourself and this fingerprint matches the one shown in " +
            "that browser. Approving does not start a session: every session must still be allowed here.",
            new[] { "Approve", "Deny" }, timeout, "Automatically denied"), cancel);
        return r == 0;
    }

    public async Task<ApprovalResult> ApproveSessionAsync(string label, string fingerprint, string? reason, bool allowControl,
        TimeSpan timeout, CancellationToken cancel)
    {
        var buttons = allowControl ? new[] { "Allow full control", "View only", "Deny" } : new[] { "View only", "Deny" };
        var details = new List<(string, string, bool)> { ("From", label, false), ("Fingerprint", fingerprint, true) };
        if (!string.IsNullOrWhiteSpace(reason)) details.Add(("Reason", reason, false));
        var r = await ShowAsync(() => new ApprovalDialog(
            "GlobalRemoteControl — remote session request",
            $"{label} wants to see this screen" + (allowControl ? " and control this PC" : ""),
            details,
            "Full control lets them use the mouse and keyboard. View only shows the screen. A bar at the top of the " +
            "screen stays visible during the session; stop it any time with its Stop button or Ctrl+Alt+Shift+F12.",
            buttons, timeout, "Automatically denied"), cancel);
        if (r == ApprovalDialog.TimedOut) return ApprovalResult.Timeout;
        if (r < 0 || r == buttons.Length - 1) return ApprovalResult.Deny;
        return allowControl && r == 0 ? ApprovalResult.Control : ApprovalResult.View;
    }

    public async Task<string?> ApproveIncomingFileAsync(string label, string fingerprint, string fileName, long size, TimeSpan timeout,
        CancellationToken cancel)
    {
        string? path = null;
        var r = await ShowAsync(() =>
        {
            var d = new ApprovalDialog(
                "GlobalRemoteControl — incoming file",
                $"{label} wants to send you a file",
                new[] { ("File", fileName, false), ("Size", UiText.Size(size), false), ("From", label, false), ("Fingerprint", fingerprint, true) },
                "If you accept you choose where it is saved. Only open files you expected.",
                new[] { "Accept…", "Decline" }, timeout, "Automatically declined");
            d.ConfirmChoice = _ =>
            {
                using var save = new SaveFileDialog
                {
                    Title = "Save incoming file",
                    InitialDirectory = KnownFolders.DownloadsFolder(),
                    FileName = fileName,
                    OverwritePrompt = true,
                    Filter = "All files (*.*)|*.*",
                };
                if (save.ShowDialog(d) != DialogResult.OK) return false;
                path = save.FileName;
                return true;
            };
            return d;
        }, cancel);
        return r == 0 ? path : null;
    }

    public Task<string?> PickFileToSendAsync() => _ui.InvokeAsync<string?>(() =>
    {
        using var open = new OpenFileDialog
        {
            Title = "Send a file to the remote device",
            CheckFileExists = true,
            Multiselect = false,
            Filter = "All files (*.*)|*.*",
        };
        return Task.FromResult(open.ShowDialog() == DialogResult.OK ? open.FileName : null);
    });

    private Task<int> ShowAsync(Func<ApprovalDialog> create, CancellationToken cancel)
    {
        if (cancel.IsCancellationRequested) return Task.FromResult(ApprovalDialog.Cancelled);
        return _ui.InvokeAsync(() =>
        {
            if (cancel.IsCancellationRequested) return Task.FromResult(ApprovalDialog.Cancelled);
            var d = create();
            d.AttachCancellation(cancel, _ui);
            d.Show(); // modeless: Close() disposes it
            return d.Result;
        });
    }
}
