using System.Diagnostics;
using System.Text.Json.Nodes;
using GlobalRemoteControl.Agent.Mcp;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Settings;
using GlobalRemoteControl.Agent.Signaling;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>
/// The running app: tray icon (grey idle / green online / red session) + menu, main window, session bar, pairing
/// window and the kill switch (hotkey, bar Stop, tray Stop). All UI work is marshalled to the UI thread.
/// </summary>
internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly AgentHost _host;
    private readonly UiDispatcher _ui;
    private readonly NotifyIcon _tray;
    private readonly MainForm _main;
    private readonly SessionBar _bar;
    private readonly HotKeyWindow _hotKey;
    private readonly Dictionary<TrayState, Icon> _icons = new();
    private readonly ToolStripMenuItem _sendFile, _stop, _startAtLogin, _allowMcp;
    private readonly AgentPipeServer? _pipe;
    private PairingCodeForm? _pairing;
    private string? _lastCode;
    private DateTimeOffset _lastCodeExpiry;
    private int _pairedCountAtOpen;
    private bool _exiting;

    public TrayApplicationContext(AgentHost host, UiDispatcher ui, bool startHidden)
    {
        _host = host;
        _ui = ui;
        // AgentHost still clears McpEnabled when it loads the settings; restore the persisted choice (default off).
        _host.Settings.McpEnabled = AgentSettings.Load(_host.Paths.SettingsFile).McpEnabled;
        var size = SystemInformation.SmallIconSize.Width;
        foreach (var s in Enum.GetValues<TrayState>()) _icons[s] = AppIcons.Create(s, Math.Max(16, size));

        _main = new MainForm(host);
        _main.PairRequested += ShowPairing;
        _main.StopRequested += () => Kill("main window");
        _main.OpenAuditLogRequested += OpenAuditLog;
        _main.StartAtLoginChanged += () => _startAtLogin!.Checked = SafeStartAtLogin();
        _main.McpAllowedChanged += SetMcpAllowed;

        _bar = new SessionBar();
        _bar.StopClicked += () => Kill("session bar");

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, (_, _) => _main.ShowAndActivate()).Font = new Font(menu.Font, FontStyle.Bold);
        menu.Items.Add("Pair a new device", null, (_, _) => ShowPairing());
        _sendFile = new ToolStripMenuItem("Send a file to the remote device…", null, (_, _) => _ = SendFileAsync()) { Visible = false };
        _stop = new ToolStripMenuItem("Stop session", null, (_, _) => Kill("tray")) { Enabled = false };
        menu.Items.Add(_sendFile);
        menu.Items.Add(_stop);
        menu.Items.Add(new ToolStripSeparator());
        _startAtLogin = new ToolStripMenuItem("Start at login") { CheckOnClick = true, Checked = SafeStartAtLogin() };
        _startAtLogin.Click += (_, _) => ToggleStartAtLogin(_startAtLogin.Checked);
        menu.Items.Add(_startAtLogin);
        _allowMcp = new ToolStripMenuItem("Allow Claude (MCP)") { CheckOnClick = true, Checked = _host.Settings.McpEnabled };
        _allowMcp.Click += (_, _) => SetMcpAllowed(_allowMcp.Checked);
        menu.Items.Add(_allowMcp);
        menu.Items.Add("Open audit log", null, (_, _) => OpenAuditLog());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitApp());
        menu.Opening += (_, _) => RefreshMenu();

        _tray = new NotifyIcon { ContextMenuStrip = menu, Visible = true };
        _tray.DoubleClick += (_, _) => _main.ShowAndActivate();
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) _main.ShowAndActivate(); };

        _hotKey = new HotKeyWindow(() => Kill("hotkey Ctrl+Alt+Shift+F12"));
        if (!_hotKey.Registered)
            _host.Audit.Write("hotkey-unavailable", details: $"Ctrl+Alt+Shift+F12 could not be registered (error {_hotKey.LastError}); use the bar or tray Stop");

        // Events arrive on signaling / WebRTC threads: hop to the UI thread.
        _host.Signaling.StateChanged += _ => _ui.Post(RefreshState);
        _host.Gate.Changed += () => _ui.Post(RefreshState);
        _host.Pairing.CodeReceived += (code, exp) => _ui.Post(() =>
        {
            _lastCode = code; _lastCodeExpiry = exp;
            _pairing?.SetCode(code, exp);
        });
        _host.Store.Changed += () => _ui.Post(OnStoreChanged);

        // MCP bridge pipe (PROTOCOL section 6). Always listening so status works; pairing codes need the toggle.
        try
        {
            var commands = new AgentPipeCommands(_host.Audit, () => _host.Settings.McpEnabled, McpStatus, McpPairingCodeAsync);
            _pipe = new AgentPipeServer(AgentPipeProtocol.PipeNameForCurrentUser(), commands, _host.Audit);
            _pipe.Start();
        }
        catch (Exception ex) { _host.Audit.Write("mcp-pipe-error", details: "start: " + ex.Message); }

        RefreshState();
        if (!startHidden) _main.ShowAndActivate();
        else _tray.ShowBalloonTip(4000, "GlobalRemoteControl", "Running in the tray. Remote sessions always need your approval.", ToolTipIcon.Info);
    }

    /// <summary>Second launch of the exe: bring the main window forward.</summary>
    public void BringToFront() => _ui.Post(_main.ShowAndActivate);

    private void RefreshState()
    {
        if (_exiting) return;
        var active = _host.Gate.Active;
        var state = active != null ? TrayState.Session
            : _host.Signaling.State == SignalingState.Connected ? TrayState.Connected : TrayState.Idle;
        _tray.Icon = _icons[state];
        var text = active != null ? $"GlobalRemoteControl — session: {active.Label} ({active.ModeText})"
            : state == TrayState.Connected ? "GlobalRemoteControl — online" : "GlobalRemoteControl — offline";
        _tray.Text = text.Length > 127 ? text[..127] : text;
        _main.Icon = _icons[state];
        if (active != null) _bar.ShowFor(active); else _bar.HideBar();
        _main.RefreshStatus();
        _main.RefreshSession();
        RefreshMenu();
        if (_pairing != null && !_pairing.IsDisposed && _host.Signaling.State != SignalingState.Connected) _pairing.SetNotConnected();
    }

    private void RefreshMenu()
    {
        var active = _host.Gate.Active;
        _stop.Enabled = active != null || _host.Gate.IsBusy;
        _sendFile.Visible = active != null && _host.ActiveSession != null;
        _startAtLogin.Checked = SafeStartAtLogin();
        _allowMcp.Checked = _host.Settings.McpEnabled;
    }

    private void SetMcpAllowed(bool allowed)
    {
        if (_host.Settings.McpEnabled != allowed)
        {
            _host.Settings.McpEnabled = allowed;
            try { _host.Settings.Save(_host.Paths.SettingsFile); }
            catch (Exception ex) { _host.Audit.Write("settings-error", details: ex.Message); }
            _host.Audit.Write(allowed ? "mcp-enabled" : "mcp-disabled");
        }
        _allowMcp.Checked = allowed;
        _main.RefreshMcp();
    }

    /// <summary>Pipe "status" (runs on a pipe thread; reads only).</summary>
    private JsonObject McpStatus() => new()
    {
        ["ok"] = true,
        ["running"] = true,
        ["connectedToServer"] = _host.Signaling.State == SignalingState.Connected,
        ["server"] = _host.EffectiveServerUrl,
        ["deviceName"] = _host.Settings.DeviceName,
        ["fingerprint"] = _host.Identity.Fingerprint,
        ["trustedDevices"] = _host.Store.All.Count,
        ["sessionActive"] = _host.Gate.Active != null,
        ["mcpAllowed"] = _host.Settings.McpEnabled,
    };

    /// <summary>
    /// Pipe "pairing-code" (only reached when MCP is allowed): exactly what "Pair a new device" does, so the code
    /// window appears on screen too; then waits up to 10 s for the server's pairing-code reply.
    /// </summary>
    private async Task<JsonObject> McpPairingCodeAsync(CancellationToken ct)
    {
        if (_host.Signaling.State != SignalingState.Connected)
            return AgentPipeProtocol.Error("not-connected", "GlobalRemoteControl is not connected to the server yet; try again shortly.");
        var got = new TaskCompletionSource<(string Code, DateTimeOffset Expires)>(TaskCreationOptions.RunContinuationsAsynchronously);
        Action<string, DateTimeOffset> onCode = (c, e) => got.TrySetResult((c, e));
        _host.Pairing.CodeReceived += onCode;
        try
        {
            await _ui.InvokeAsync(() =>
            {
                var open = _pairing != null && !_pairing.IsDisposed;
                if (open && _pairing!.CurrentCode is { } current && current == _lastCode
                    && _lastCodeExpiry - DateTimeOffset.UtcNow > TimeSpan.FromSeconds(30))
                {
                    _pairing.Activate(); // a valid code is already on screen: hand out that one
                    got.TrySetResult((current, _lastCodeExpiry));
                }
                else
                {
                    if (open) _pairing!.Close(); // stale window (expired / paired / offline): reopen for a fresh code
                    ShowPairing();
                }
                return Task.FromResult(true);
            }).ConfigureAwait(false);
            var (code, expires) = await got.Task.WaitAsync(TimeSpan.FromSeconds(10), ct).ConfigureAwait(false);
            return new JsonObject
            {
                ["ok"] = true, ["code"] = code,
                ["expiresAt"] = expires.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", System.Globalization.CultureInfo.InvariantCulture),
            };
        }
        catch (TimeoutException)
        {
            return AgentPipeProtocol.Error("timeout", "The server did not send a pairing code within 10 s (it may be rate-limiting); try again in a minute.");
        }
        finally { _host.Pairing.CodeReceived -= onCode; }
    }

    private void Kill(string source)
    {
        // The gate flips synchronously (no more input), the peer teardown runs off the UI thread.
        _ = Task.Run(() =>
        {
            try { _host.Kill(source); }
            catch (Exception ex) { _host.Audit.Write("kill-error", details: ex.Message); }
        });
        _bar.HideBar();
        _main.RefreshSession();
    }

    private void ShowPairing()
    {
        if (_pairing != null && !_pairing.IsDisposed) { _pairing.Activate(); return; }
        _pairedCountAtOpen = _host.Store.All.Count;
        var form = new PairingCodeForm(async () =>
        {
            if (_host.Signaling.State != SignalingState.Connected) { _pairing?.SetNotConnected(); return; }
            await _host.Pairing.RequestCodeAsync();
        });
        _pairing = form;
        form.FormClosed += (_, _) => { if (_pairing == form) _pairing = null; };
        form.Show();
        form.Activate();
    }

    private void OnStoreChanged()
    {
        var all = _host.Store.All;
        if (_pairing != null && !_pairing.IsDisposed && all.Count > _pairedCountAtOpen)
        {
            var newest = all.OrderByDescending(c => c.AddedAt).First();
            _pairing.SetPaired(newest.Name);
        }
        if (_pairing != null) _pairedCountAtOpen = all.Count;
    }

    private async Task SendFileAsync()
    {
        var session = _host.ActiveSession;
        if (session == null) return;
        if (session.Files.OutgoingActive)
        {
            _tray.ShowBalloonTip(3000, "GlobalRemoteControl", "A file is already being sent.", ToolTipIcon.Info);
            return;
        }
        string? path;
        using (var open = new OpenFileDialog { Title = "Send a file to the remote device", CheckFileExists = true, Filter = "All files (*.*)|*.*" })
            path = open.ShowDialog() == DialogResult.OK ? open.FileName : null;
        if (path == null || _host.ActiveSession != session) return;
        _tray.ShowBalloonTip(3000, "GlobalRemoteControl", $"Offering {Path.GetFileName(path)} to {session.Info.Label}…", ToolTipIcon.Info);
        var ok = await Task.Run(() => session.Files.SendFileAsync(path));
        _tray.ShowBalloonTip(3000, "GlobalRemoteControl",
            ok ? $"Sent {Path.GetFileName(path)}." : $"{Path.GetFileName(path)} was not sent (declined, cancelled or failed).",
            ok ? ToolTipIcon.Info : ToolTipIcon.Warning);
    }

    private static bool SafeStartAtLogin()
    {
        try { return StartupRegistration.IsEnabled(); } catch (Exception) { return false; }
    }

    private void ToggleStartAtLogin(bool enabled)
    {
        try
        {
            StartupRegistration.Set(enabled);
            _host.Audit.Write(enabled ? "start-at-login-enabled" : "start-at-login-disabled", details: StartupRegistration.Command);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not change the setting: " + ex.Message, "Start at login", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        _startAtLogin.Checked = SafeStartAtLogin();
        if (_main.Visible) _main.RefreshAll();
    }

    private void OpenAuditLog()
    {
        try
        {
            var path = _host.Audit.FilePath;
            if (!File.Exists(path)) File.AppendAllText(path, "");
            Process.Start(new ProcessStartInfo("notepad.exe", $"\"{path}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not open the audit log: " + ex.Message, "GlobalRemoteControl", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ExitApp()
    {
        if (_host.Gate.Active != null && MessageBox.Show("A remote session is active. Stop it and exit?", "GlobalRemoteControl",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        _exiting = true;
        try { _host.Kill("exit"); } catch (Exception) { }
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        _exiting = true;
        _pipe?.Dispose();
        _tray.Visible = false;
        _hotKey.Dispose();
        _pairing?.Close();
        _bar.Close();
        _main.Dispose();
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
