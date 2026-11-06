using System.Drawing;
using System.Runtime.InteropServices;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>
/// Topmost consent dialog. The default (Enter / Esc / closing the window) is always the last, "deny" button; it
/// denies itself when the countdown runs out and closes itself when the request is cancelled. Injected input
/// (i.e. the remote controller's own mouse/keyboard during a session) is ignored, so only the person at the PC can
/// answer it.
/// </summary>
internal sealed class ApprovalDialog : Form
{
    public const int TimedOut = -1, Cancelled = -2;

    private readonly TaskCompletionSource<int> _result = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly DateTime _deadline;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly Label _countdown = new() { AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 10, 0, 0) };
    private readonly string _timeoutText;
    private readonly int _denyIndex;
    private readonly LocalInputFilter _filter;
    private CancellationTokenRegistration _reg;
    private bool _inChoice, _cancelPending;

    /// <summary>Called on the UI thread when a non-deny button is clicked; return false to treat it as deny.</summary>
    public Func<int, bool>? ConfirmChoice { get; set; }

    public ApprovalDialog(string title, string heading, IReadOnlyList<(string Label, string Value, bool Mono)> details,
        string? note, IReadOnlyList<string> buttons, TimeSpan timeout, string timeoutText)
    {
        Text = title;
        _deadline = DateTime.UtcNow + timeout;
        _timeoutText = timeoutText;
        _denyIndex = buttons.Count - 1;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = true;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Font = new Font("Segoe UI", 10f);
        Icon = AppIcons.Create(TrayState.Session, 32);
        Padding = new Padding(18);

        var layout = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Dock = DockStyle.Fill, MaximumSize = new Size(620, 0) };
        layout.Controls.Add(new Label
        {
            Text = heading, AutoSize = true, MaximumSize = new Size(600, 0),
            Font = new Font("Segoe UI Semibold", 13f), Margin = new Padding(0, 0, 0, 10),
        });
        var grid = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, Margin = new Padding(0) };
        foreach (var (label, value, mono) in details)
        {
            grid.Controls.Add(new Label { Text = label, AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 4, 12, 4) });
            grid.Controls.Add(new Label
            {
                Text = value, AutoSize = true, MaximumSize = new Size(460, 0), Margin = new Padding(0, 4, 0, 4),
                Font = mono ? new Font("Consolas", 12f, FontStyle.Bold) : new Font("Segoe UI Semibold", 10f),
            });
        }
        layout.Controls.Add(grid);
        if (note != null)
            layout.Controls.Add(new Label { Text = note, AutoSize = true, MaximumSize = new Size(600, 0), Margin = new Padding(0, 10, 0, 0) });
        layout.Controls.Add(_countdown);

        var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Anchor = AnchorStyles.Right, Margin = new Padding(0, 16, 0, 0) };
        Button? deny = null;
        for (int i = 0; i < buttons.Count; i++)
        {
            int index = i;
            var b = new Button { Text = buttons[i], AutoSize = true, MinimumSize = new Size(110, 34), Padding = new Padding(8, 2, 8, 2) };
            b.Click += (_, _) => Choose(index);
            row.Controls.Add(b);
            if (i == _denyIndex) deny = b;
        }
        layout.Controls.Add(row);
        Controls.Add(layout);

        AcceptButton = deny;
        CancelButton = deny;
        ActiveControl = deny;
        _filter = new LocalInputFilter(this);
        _timer.Tick += (_, _) => Tick();
    }

    public Task<int> Result => _result.Task;

    /// <summary>Closes the dialog (result <see cref="Cancelled"/>) when <paramref name="cancel"/> fires.</summary>
    public void AttachCancellation(CancellationToken cancel, UiDispatcher ui)
    {
        if (!cancel.CanBeCanceled) return;
        _reg = cancel.Register(() => ui.Post(CancelFromRequest));
    }

    private void CancelFromRequest()
    {
        if (IsDisposed || _result.Task.IsCompleted) return;
        if (_inChoice) { _cancelPending = true; return; } // a Save dialog is open on top of us
        Finish(Cancelled);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Application.AddMessageFilter(_filter);
        Tick();
        _timer.Start();
        Activate();
    }

    private void Tick()
    {
        var left = _deadline - DateTime.UtcNow;
        if (left <= TimeSpan.Zero && !_inChoice) { Finish(TimedOut); return; }
        _countdown.Text = $"{_timeoutText} in {UiText.Countdown(left)}.";
    }

    private void Choose(int index)
    {
        if (_result.Task.IsCompleted || _inChoice) return;
        if (index != _denyIndex && ConfirmChoice != null)
        {
            _inChoice = true;
            _timer.Stop();
            bool ok;
            try { ok = ConfirmChoice(index); }
            finally { _inChoice = false; }
            if (_cancelPending) { Finish(Cancelled); return; }
            if (!ok) index = _denyIndex;
        }
        Finish(index);
    }

    private void Finish(int result)
    {
        if (!_result.TrySetResult(result)) return;
        _timer.Stop();
        if (!IsDisposed) Close();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        Application.RemoveMessageFilter(_filter);
        _timer.Dispose();
        _reg.Dispose();
        _result.TrySetResult(_denyIndex); // closed with the X button = deny
        base.OnFormClosed(e);
    }

    /// <summary>Drops keyboard/mouse messages for this dialog that were produced by SendInput (remote input).</summary>
    private sealed class LocalInputFilter : IMessageFilter
    {
        private const int WM_NCMOUSEFIRST = 0x00A0, WM_NCMOUSELAST = 0x00AD, WM_KEYFIRST = 0x0100, WM_KEYLAST = 0x0109,
            WM_MOUSEFIRST = 0x0200, WM_MOUSELAST = 0x020E, IMO_INJECTED = 3, GA_ROOT = 2;
        private readonly Form _form;

        public LocalInputFilter(Form form) => _form = form;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT_MESSAGE_SOURCE { public int deviceType; public int originId; }

        [DllImport("user32.dll")] private static extern bool GetCurrentInputMessageSource(out INPUT_MESSAGE_SOURCE src);
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

        public bool PreFilterMessage(ref Message m)
        {
            bool input = (m.Msg >= WM_KEYFIRST && m.Msg <= WM_KEYLAST) || (m.Msg >= WM_MOUSEFIRST && m.Msg <= WM_MOUSELAST) ||
                         (m.Msg >= WM_NCMOUSEFIRST && m.Msg <= WM_NCMOUSELAST);
            if (!input || _form.IsDisposed || !_form.IsHandleCreated) return false;
            if (GetAncestor(m.HWnd, GA_ROOT) != _form.Handle) return false;
            return GetCurrentInputMessageSource(out var src) && src.originId == IMO_INJECTED;
        }
    }
}
