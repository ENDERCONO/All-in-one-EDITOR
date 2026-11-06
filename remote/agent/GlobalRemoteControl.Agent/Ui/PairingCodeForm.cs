using System.Drawing;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>Shows the one-time pairing code in large type with its 5-minute countdown.</summary>
internal sealed class PairingCodeForm : Form
{
    private readonly Label _code = new()
    {
        AutoSize = true, Font = new Font("Consolas", 40f, FontStyle.Bold), Text = "…",
        Anchor = AnchorStyles.None, Margin = new Padding(0, 10, 0, 10),
    };
    private readonly Label _status = new() { AutoSize = true, Anchor = AnchorStyles.None, ForeColor = SystemColors.GrayText };
    private readonly Button _newCode = new() { Text = "Get a new code", AutoSize = true, Enabled = false, MinimumSize = new Size(130, 32) };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 500 };
    private readonly Func<Task> _requestCode;
    private DateTimeOffset? _expires;

    public PairingCodeForm(Func<Task> requestCode)
    {
        _requestCode = requestCode;
        Text = "Pair a new device";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 10f);
        Icon = AppIcons.Create(TrayState.Connected, 32);
        Padding = new Padding(20);

        var layout = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Dock = DockStyle.Fill };
        layout.Controls.Add(new Label
        {
            AutoSize = true, MaximumSize = new Size(460, 0),
            Text = "On the other device, open the Remote tab of the site, choose \"Pair a device\" and type this code:",
        });
        layout.Controls.Add(_code);
        layout.Controls.Add(_status);
        layout.Controls.Add(new Label
        {
            AutoSize = true, MaximumSize = new Size(460, 0), Margin = new Padding(0, 12, 0, 0),
            Text = "The code works once and expires after 5 minutes. Entering it does not give access by itself: " +
                   "you will be asked here to approve the device (check that its fingerprint matches).",
        });
        var close = new Button { Text = "Close", AutoSize = true, MinimumSize = new Size(100, 32), DialogResult = DialogResult.Cancel };
        close.Click += (_, _) => Close();
        _newCode.Click += async (_, _) => await RequestAsync();
        var row = new FlowLayoutPanel { AutoSize = true, Anchor = AnchorStyles.Right, Margin = new Padding(0, 16, 0, 0) };
        row.Controls.Add(_newCode);
        row.Controls.Add(close);
        layout.Controls.Add(row);
        Controls.Add(layout);
        CancelButton = close;
        _timer.Tick += (_, _) => Tick();
    }

    /// <summary>The code shown right now (for UI Automation / tests), or null.</summary>
    public string? CurrentCode { get; private set; }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _timer.Start();
        await RequestAsync();
    }

    private async Task RequestAsync()
    {
        _newCode.Enabled = false;
        _expires = null;
        CurrentCode = null;
        _code.Text = "…";
        _status.Text = "Asking the server for a code…";
        try { await _requestCode(); }
        catch (Exception ex) { _status.Text = "Could not request a code: " + ex.Message; _newCode.Enabled = true; }
    }

    public void SetCode(string code, DateTimeOffset expiresAt)
    {
        CurrentCode = code;
        _expires = expiresAt;
        _code.Text = code;
        _code.AccessibleName = "Pairing code " + code;
        Tick();
    }

    public void SetNotConnected()
    {
        if (_code.Text == "—") return;
        _expires = null; // the server forgets a device's code when its connection drops
        CurrentCode = null;
        _code.AccessibleName = null;
        _code.Text = "—";
        _status.Text = "Not connected to the server yet. The code will appear once connected.";
        _newCode.Enabled = true;
    }

    public void SetPaired(string name)
    {
        _expires = null;
        CurrentCode = null;
        _code.Text = "✓";
        _status.Text = $"\"{name}\" was approved and can now request sessions.";
        _newCode.Enabled = true;
    }

    private void Tick()
    {
        if (_expires == null) return;
        var left = _expires.Value - DateTimeOffset.UtcNow;
        if (left <= TimeSpan.Zero)
        {
            _expires = null;
            CurrentCode = null;
            _code.Text = "expired";
            _status.Text = "This code has expired.";
            _newCode.Enabled = true;
            return;
        }
        _status.Text = $"Expires in {UiText.Countdown(left)}";
        _newCode.Enabled = true;
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _timer.Dispose();
        base.OnFormClosed(e);
    }
}
