using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Ui;

/// <summary>Marshals work onto the UI thread from signaling / WebRTC threads.</summary>
internal sealed class UiDispatcher : IDisposable
{
    private readonly Control _control;

    /// <summary>Must be constructed on the UI thread.</summary>
    public UiDispatcher()
    {
        _control = new Control();
        _ = _control.Handle; // force handle creation on this thread
    }

    public bool IsShutDown => _control.IsDisposed;

    public void Post(Action a)
    {
        if (_control.IsDisposed) return;
        try { _control.BeginInvoke(a); } catch (InvalidOperationException) { /* shutting down */ }
    }

    /// <summary>Runs <paramref name="f"/> on the UI thread and returns its (asynchronous) result.</summary>
    public Task<T> InvokeAsync<T>(Func<Task<T>> f)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(async () =>
        {
            try { tcs.TrySetResult(await f()); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        });
        if (_control.IsDisposed) tcs.TrySetCanceled();
        return tcs.Task;
    }

    public void Dispose() => _control.Dispose();
}

internal enum TrayState { Idle, Connected, Session }

/// <summary>Tray / window icons drawn in code: a small monitor in grey (offline), green (online) or red (session).</summary>
internal static class AppIcons
{
    public static Color ColorFor(TrayState s) => s switch
    {
        TrayState.Connected => Color.FromArgb(0x1E, 0xA4, 0x4A),
        TrayState.Session => Color.FromArgb(0xD6, 0x2C, 0x2C),
        _ => Color.FromArgb(0x8A, 0x8A, 0x8A),
    };

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr h);

    public static Icon Create(TrayState state, int size)
    {
        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            float u = size / 16f;
            var color = ColorFor(state);
            using var fill = new SolidBrush(color);
            using var dark = new Pen(Color.FromArgb(40, 40, 40), Math.Max(1, u));
            var screen = new RectangleF(1 * u, 2 * u, 14 * u, 9.5f * u);
            using (var path = Rounded(screen, 1.5f * u)) { g.FillPath(fill, path); g.DrawPath(dark, path); }
            using var inner = new SolidBrush(Color.FromArgb(220, 255, 255, 255));
            g.FillRectangle(inner, 3 * u, 4 * u, 10 * u, 5.5f * u);
            g.FillRectangle(fill, 6.5f * u, 11.5f * u, 3 * u, 2 * u);
            g.FillRectangle(fill, 4 * u, 13.5f * u, 8 * u, 1.5f * u);
            if (state == TrayState.Session)
            {
                using var dot = new SolidBrush(color);
                g.FillEllipse(dot, 6 * u, 5 * u, 4 * u, 4 * u);
            }
        }
        var h = bmp.GetHicon();
        try { return (Icon)Icon.FromHandle(h).Clone(); }
        finally { DestroyIcon(h); }
    }

    private static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

/// <summary>Opt-in "Start at login": a visible HKCU Run entry, nothing hidden.</summary>
internal static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "GlobalRemoteControl";

    public static string Command => $"\"{Environment.ProcessPath}\" --tray";

    public static bool IsEnabled()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey);
        return k?.GetValue(ValueName) is string s && s.Length > 0;
    }

    public static void Set(bool enabled)
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        if (enabled) k.SetValue(ValueName, Command);
        else k.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}

/// <summary>Global kill-switch hotkey Ctrl+Alt+Shift+F12 via RegisterHotKey on a hidden window.</summary>
internal sealed class HotKeyWindow : NativeWindow, IDisposable
{
    private const int Id = 0x4752; // "GR"
    private readonly Action _onHotKey;

    public HotKeyWindow(Action onHotKey)
    {
        _onHotKey = onHotKey;
        CreateHandle(new CreateParams());
        Registered = RegisterHotKey(Handle, Id, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, (uint)Keys.F12);
        if (!Registered) LastError = Marshal.GetLastWin32Error();
    }

    public bool Registered { get; }
    public int LastError { get; }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam == (IntPtr)Id) _onHotKey();
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle != IntPtr.Zero)
        {
            if (Registered) UnregisterHotKey(Handle, Id);
            DestroyHandle();
        }
    }
}

internal static class KnownFolders
{
    private static readonly Guid Downloads = new("374DE290-123F-4565-9164-39C4925E467B");

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);

    public static string DownloadsFolder()
    {
        try
        {
            if (SHGetKnownFolderPath(Downloads, 0, IntPtr.Zero, out var p) == 0)
            {
                try { var s = Marshal.PtrToStringUni(p); if (!string.IsNullOrEmpty(s) && Directory.Exists(s)) return s; }
                finally { Marshal.FreeCoTaskMem(p); }
            }
        }
        catch (Exception) { }
        var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        return Directory.Exists(fallback) ? fallback : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }
}

internal static class UiText
{
    public static string Size(long bytes)
    {
        string[] u = { "bytes", "KB", "MB", "GB" };
        double v = bytes; int i = 0;
        while (v >= 1024 && i < u.Length - 1) { v /= 1024; i++; }
        return i == 0 ? $"{bytes} bytes" : $"{v:0.#} {u[i]}";
    }

    public static string Countdown(TimeSpan t)
    {
        if (t < TimeSpan.Zero) t = TimeSpan.Zero;
        return $"{(int)t.TotalMinutes}:{t.Seconds:00}";
    }
}
