using System.Drawing;
using GlobalRemoteControl.Agent.Session;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>
/// Topmost borderless bar across the top of the primary monitor while a session is active:
/// "● Remote session: name — full control   [Stop]". Excluded from screen capture so it is not streamed, but always
/// visible to the person at the PC.
/// </summary>
internal sealed class SessionBar : Form
{
    private const int WS_EX_TOOLWINDOW = 0x80, WS_EX_TOPMOST = 0x8, WS_EX_NOACTIVATE = 0x08000000;

    private readonly Label _text;
    private readonly Button _stop;
    private readonly System.Windows.Forms.Timer _keepOnTop = new() { Interval = 1500 };

    public event Action? StopClicked;

    public SessionBar()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(0xB3, 0x1B, 0x1B);
        ForeColor = Color.White;
        Font = new Font("Segoe UI Semibold", 10.5f);
        Text = "GlobalRemoteControl session";

        _stop = new Button
        {
            Text = "Stop", Dock = DockStyle.Right, AutoSize = true, MinimumSize = new Size(90, 0),
            FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Color.FromArgb(0xB3, 0x1B, 0x1B),
            Font = new Font("Segoe UI", 10f, FontStyle.Bold), Cursor = Cursors.Hand, TabStop = false,
        };
        _stop.FlatAppearance.BorderSize = 0;
        _stop.Click += (_, _) => StopClicked?.Invoke();

        var hint = new Label
        {
            Text = "Ctrl+Alt+Shift+F12 stops it too", Dock = DockStyle.Right, AutoSize = true,
            TextAlign = ContentAlignment.MiddleRight, Font = new Font("Segoe UI", 9f), ForeColor = Color.FromArgb(255, 220, 220),
            Padding = new Padding(0, 0, 12, 0),
        };
        _text = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0), AutoEllipsis = true };
        Controls.Add(_text);
        Controls.Add(hint);
        Controls.Add(_stop);
        Padding = new Padding(0, 3, 6, 3);

        _keepOnTop.Tick += (_, _) => { if (Visible) { TopMost = false; TopMost = true; } };
        SystemEvents_DisplaySettingsChanged();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Windows 10 2004+: invisible to capture. Older: shows as black in captures (still never hides it locally).
        if (!SetWindowDisplayAffinity(Handle, WDA_EXCLUDEFROMCAPTURE)) SetWindowDisplayAffinity(Handle, WDA_MONITOR);
    }

    public void ShowFor(SessionInfo info)
    {
        _text.Text = $"●  Remote session: {info.Label} — {info.ModeText}";
        SystemEvents_DisplaySettingsChanged();
        if (!Visible) Show();
        TopMost = true;
        _keepOnTop.Start();
    }

    public void HideBar()
    {
        _keepOnTop.Stop();
        Hide();
    }

    private void OnDisplayChanged(object? sender, EventArgs e)
    {
        if (IsHandleCreated) BeginInvoke(SystemEvents_DisplaySettingsChanged);
    }

    private void SystemEvents_DisplaySettingsChanged()
    {
        var screen = Screen.PrimaryScreen ?? Screen.AllScreens[0];
        int h = (int)Math.Round(34 * (DeviceDpi / 96.0));
        Bounds = new Rectangle(screen.Bounds.Left, screen.Bounds.Top, screen.Bounds.Width, h);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
            _keepOnTop.Dispose();
        }
        base.Dispose(disposing);
    }
}
