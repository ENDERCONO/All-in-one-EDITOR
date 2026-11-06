using System.Drawing;
using System.Globalization;
using GlobalRemoteControl.Agent.Settings;
using GlobalRemoteControl.Agent.Signaling;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>
/// Main window: connection status, this device's name + fingerprint, pairing, trusted controllers (revoke),
/// server URL, start at login. Closing it hides it to the tray; Exit is in the tray menu.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly AgentHost _host;
    private readonly Label _statusDot = new() { AutoSize = true, Font = new Font("Segoe UI", 14f), Text = "●" };
    private readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 11f), Anchor = AnchorStyles.Left };
    private readonly Label _statusDetail = new() { AutoSize = true, ForeColor = SystemColors.GrayText, MaximumSize = new Size(640, 0) };
    private readonly Label _session = new() { AutoSize = true, Anchor = AnchorStyles.Left };
    private readonly Button _stopSession = new() { Text = "Stop session", AutoSize = true, Visible = false, MinimumSize = new Size(110, 30) };
    private readonly TextBox _deviceName = new() { ReadOnly = true, BorderStyle = BorderStyle.None, Width = 420 };
    private readonly TextBox _fingerprint = new() { ReadOnly = true, BorderStyle = BorderStyle.None, Width = 420, Font = new Font("Consolas", 11f, FontStyle.Bold) };
    private readonly ListView _controllers = new()
    {
        View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false, Height = 150, Width = 640,
        HeaderStyle = ColumnHeaderStyle.Nonclickable,
    };
    private readonly Button _revoke = new() { Text = "Revoke", AutoSize = true, Enabled = false, MinimumSize = new Size(100, 30) };
    private readonly TextBox _serverUrl = new() { Width = 470 };
    private readonly Label _serverNote = new() { AutoSize = true, ForeColor = SystemColors.GrayText, MaximumSize = new Size(640, 0) };
    private readonly CheckBox _startAtLogin = new() { Text = "Start at login (adds a visible entry for your Windows user only)", AutoSize = true };
    private bool _updatingCheckbox;

    public event Action? PairRequested;
    public event Action? StopRequested;
    public event Action? OpenAuditLogRequested;

    public MainForm(AgentHost host)
    {
        _host = host;
        Text = "GlobalRemoteControl";
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10f);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(18);
        Icon = AppIcons.Create(TrayState.Idle, 32);

        var root = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Dock = DockStyle.Fill };

        // status
        var statusRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0) };
        statusRow.Controls.Add(_statusDot);
        statusRow.Controls.Add(_status);
        root.Controls.Add(statusRow);
        root.Controls.Add(_statusDetail);
        var sessionRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 6, 0, 0) };
        sessionRow.Controls.Add(_session);
        sessionRow.Controls.Add(_stopSession);
        root.Controls.Add(sessionRow);
        _stopSession.Click += (_, _) => StopRequested?.Invoke();

        // this device
        root.Controls.Add(Header("This PC"));
        var dev = new TableLayoutPanel { AutoSize = true, ColumnCount = 2 };
        dev.Controls.Add(Caption("Name"));
        dev.Controls.Add(_deviceName);
        dev.Controls.Add(Caption("Fingerprint"));
        dev.Controls.Add(_fingerprint);
        root.Controls.Add(dev);
        root.Controls.Add(new Label
        {
            AutoSize = true, MaximumSize = new Size(640, 0), ForeColor = SystemColors.GrayText,
            Text = "The browser shows this fingerprint when pairing; check that it matches.",
        });

        // pairing + controllers
        root.Controls.Add(Header("Trusted devices"));
        var pair = new Button { Text = "Pair a new device", AutoSize = true, MinimumSize = new Size(170, 34), Name = "PairButton", AccessibleName = "Pair a new device" };
        pair.Click += (_, _) => PairRequested?.Invoke();
        root.Controls.Add(pair);
        _controllers.Columns.Add("Name", 200);
        _controllers.Columns.Add("Fingerprint", 210);
        _controllers.Columns.Add("Added", 200);
        _controllers.Margin = new Padding(0, 8, 0, 4);
        _controllers.SelectedIndexChanged += (_, _) => _revoke.Enabled = _controllers.SelectedItems.Count == 1;
        root.Controls.Add(_controllers);
        _revoke.Click += (_, _) => RevokeSelected();
        root.Controls.Add(_revoke);

        // settings
        root.Controls.Add(Header("Settings"));
        var srv = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0) };
        srv.Controls.Add(Caption("Server"));
        srv.Controls.Add(_serverUrl);
        var save = new Button { Text = "Save", AutoSize = true, MinimumSize = new Size(70, 28) };
        save.Click += (_, _) => SaveServer();
        srv.Controls.Add(save);
        var reset = new Button { Text = "Default", AutoSize = true, MinimumSize = new Size(70, 28) };
        reset.Click += (_, _) => _serverUrl.Text = AgentSettings.DefaultServerUrl;
        srv.Controls.Add(reset);
        root.Controls.Add(srv);
        root.Controls.Add(_serverNote);
        root.Controls.Add(_startAtLogin);
        _startAtLogin.CheckedChanged += (_, _) => ToggleStartAtLogin();
        var audit = new LinkLabel { Text = "Open audit log", AutoSize = true, Margin = new Padding(0, 8, 0, 0) };
        audit.LinkClicked += (_, _) => OpenAuditLogRequested?.Invoke();
        root.Controls.Add(audit);
        root.Controls.Add(new Label
        {
            AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 8, 0, 0), MaximumSize = new Size(640, 0),
            Text = "Closing this window keeps GlobalRemoteControl running in the tray (bottom-right). Use Exit in the tray menu to quit.",
        });

        Controls.Add(root);
        _host.Store.Changed += () => { if (IsHandleCreated) BeginInvoke(RefreshControllers); };
        RefreshAll();
    }

    private static Label Header(string text) => new()
    {
        Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 11.5f), Margin = new Padding(0, 16, 0, 4),
    };

    private static Label Caption(string text) => new()
    {
        Text = text, AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 4, 10, 4), Anchor = AnchorStyles.Left,
    };

    public void RefreshAll()
    {
        _deviceName.Text = _host.Settings.DeviceName;
        _fingerprint.Text = _host.Identity.Fingerprint;
        _serverUrl.Text = _host.EffectiveServerUrl;
        _serverNote.Text = _host.ServerOverridden
            ? "This run uses the server given with --server. Saving here changes the saved setting and reconnects."
            : "Default: " + AgentSettings.DefaultServerUrl;
        _updatingCheckbox = true;
        try { _startAtLogin.Checked = StartupRegistration.IsEnabled(); } catch (Exception) { }
        finally { _updatingCheckbox = false; }
        RefreshStatus();
        RefreshSession();
        RefreshControllers();
    }

    public void RefreshStatus()
    {
        var s = _host.Signaling;
        switch (s.State)
        {
            case SignalingState.Connected:
                _statusDot.ForeColor = AppIcons.ColorFor(TrayState.Connected);
                _status.Text = "Online — ready for paired devices";
                _statusDetail.Text = s.ServerUrl ?? "";
                break;
            case SignalingState.Connecting:
                _statusDot.ForeColor = Color.Goldenrod;
                _status.Text = "Connecting to the server…";
                _statusDetail.Text = (s.ServerUrl ?? "") + (s.LastError != null ? "  (last error: " + s.LastError + ")" : "");
                break;
            default:
                _statusDot.ForeColor = AppIcons.ColorFor(TrayState.Idle);
                _status.Text = "Offline — retrying";
                _statusDetail.Text = (s.ServerUrl ?? "") + (s.LastError != null ? "  (" + s.LastError + ")" : "");
                break;
        }
    }

    public void RefreshSession()
    {
        var a = _host.Gate.Active;
        if (a == null)
        {
            _session.Text = "No remote session.";
            _session.ForeColor = SystemColors.ControlText;
            _stopSession.Visible = false;
        }
        else
        {
            _session.Text = $"● Remote session: {a.Label} — {a.ModeText}";
            _session.ForeColor = AppIcons.ColorFor(TrayState.Session);
            _stopSession.Visible = true;
        }
    }

    private void RefreshControllers()
    {
        var selected = _controllers.SelectedItems.Count == 1 ? _controllers.SelectedItems[0].Tag as string : null;
        _controllers.BeginUpdate();
        _controllers.Items.Clear();
        foreach (var c in _host.Store.All.OrderBy(c => c.AddedAt))
        {
            var item = new ListViewItem(new[] { c.Name, c.Fingerprint, c.AddedAt.ToLocalTime().ToString("g", CultureInfo.CurrentCulture) }) { Tag = c.Id };
            _controllers.Items.Add(item);
            if (c.Id == selected) item.Selected = true;
        }
        if (_controllers.Items.Count == 0)
            _controllers.Items.Add(new ListViewItem(new[] { "(no devices paired yet)", "", "" }) { ForeColor = SystemColors.GrayText });
        _controllers.EndUpdate();
        _revoke.Enabled = _controllers.SelectedItems.Count == 1 && _controllers.SelectedItems[0].Tag is string;
    }

    private void RevokeSelected()
    {
        if (_controllers.SelectedItems.Count != 1 || _controllers.SelectedItems[0].Tag is not string id) return;
        var c = _host.Store.Get(id);
        if (c == null) return;
        if (MessageBox.Show(this, $"Revoke \"{c.Name}\" ({c.Fingerprint})?\n\nIt will need a new pairing code and your approval to connect again." +
                (_host.Gate.Active?.ControllerId == id ? "\n\nIts current session will be stopped." : ""),
                "Revoke device", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        if (_host.Gate.Active?.ControllerId == id) _host.Kill("revoked");
        if (_host.Store.Revoke(id)) _host.Audit.Write("controller-revoked", c.Name, c.Id, "fingerprint " + c.Fingerprint);
    }

    private void SaveServer()
    {
        var url = _serverUrl.Text.Trim();
        if (!AgentSettings.IsValidServerUrl(url))
        {
            MessageBox.Show(this, "The server URL must start with wss:// (or ws:// for a local test server).", "Server URL",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (_host.Gate.Active != null && MessageBox.Show(this, "Changing the server stops the current session. Continue?", "Server URL",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        _host.ChangeServer(url);
        RefreshAll();
    }

    private void ToggleStartAtLogin()
    {
        if (_updatingCheckbox) return;
        try
        {
            StartupRegistration.Set(_startAtLogin.Checked);
            _host.Audit.Write(_startAtLogin.Checked ? "start-at-login-enabled" : "start-at-login-disabled", details: StartupRegistration.Command);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Could not change the setting: " + ex.Message, "Start at login", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        StartAtLoginChanged?.Invoke();
    }

    public event Action? StartAtLoginChanged;

    public void ShowAndActivate()
    {
        RefreshAll();
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        TopMost = true; TopMost = false; // bring to front even if another app has focus
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(e);
    }
}
