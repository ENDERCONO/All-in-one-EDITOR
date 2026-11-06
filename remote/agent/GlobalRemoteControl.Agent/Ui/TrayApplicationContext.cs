using System.Diagnostics;
using GlobalRemoteControl.Agent.Session;
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
    private readonly ToolStripMenuItem _sendFile, _stop, _startAtLogin;
    private PairingCodeForm? _pairing;
    private int _pairedCountAtOpen;
    private bool _exiting;

    public TrayApplicationContext(AgentHost host, UiDispatcher ui, bool startHidden)
    {
        _host = host;
        _ui = ui;
        var size = SystemInformation.SmallIconSize.Width;
        foreach (var s in Enum.GetValues<TrayState>()) _icons[s] = AppIcons.Create(s, Math.Max(16, size));

        _main = new MainForm(host);
        _main.PairRequested += ShowPairing;
        _main.StopRequested += () => Kill("main window");
        _main.OpenAuditLogRequested += OpenAuditLog;
        _main.StartAtLoginChanged += () => _startAtLogin!.Checked = SafeStartAtLogin();

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
        _host.Pairing.CodeReceived += (code, exp) => _ui.Post(() => _pairing?.SetCode(code, exp));
        _host.Store.Changed += () => _ui.Post(OnStoreChanged);

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
        _pairing = new PairingCodeForm(async () =>
        {
            if (_host.Signaling.State != SignalingState.Connected) { _pairing?.SetNotConnected(); return; }
            await _host.Pairing.RequestCodeAsync();
        });
        _pairing.FormClosed += (_, _) => _pairing = null;
        _pairing.Show();
        _pairing.Activate();
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
        _tray.Visible = false;
        _hotKey.Dispose();
        _pairing?.Close();
        _bar.Close();
        _main.Dispose();
        _tray.Dispose();
        base.ExitThreadCore();
    }
}
