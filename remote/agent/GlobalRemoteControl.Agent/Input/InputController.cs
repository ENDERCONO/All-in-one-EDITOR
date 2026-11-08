using System.Drawing;
using GlobalRemoteControl.Agent.Session;

namespace GlobalRemoteControl.Agent.Input;

/// <summary>
/// Turns validated control messages into injected input — but only while <c>isAllowed()</c> says the session is
/// active and in control mode. Tracks held keys/buttons so they can all be released when the session ends, and
/// refuses to ever produce the kill-switch chord Ctrl+Alt+Shift+F12.
/// </summary>
public sealed class InputController
{
    private readonly IInputSink _sink;
    private readonly Func<bool> _isAllowed;
    private readonly Func<Rectangle> _monitorBounds;
    private readonly Func<Rectangle> _virtualScreen;
    private readonly object _lock = new();
    private readonly HashSet<string> _heldKeys = new();
    private readonly HashSet<MouseButton> _heldButtons = new();

    public InputController(IInputSink sink, Func<bool> isAllowed, Func<Rectangle> monitorBounds, Func<Rectangle> virtualScreen)
    {
        _sink = sink;
        _isAllowed = isAllowed;
        _monitorBounds = monitorBounds;
        _virtualScreen = virtualScreen;
    }

    /// <summary>Optional diagnostics hook (dropped messages etc.).</summary>
    public Action<string>? Log { get; set; }

    public IReadOnlyCollection<string> HeldKeys { get { lock (_lock) return _heldKeys.ToList(); } }

    /// <summary>Handles an input message. Returns true when something was injected.</summary>
    public bool Handle(ControlMessage msg)
    {
        lock (_lock)
        {
            if (!_isAllowed()) return false;
            switch (msg)
            {
                case MouseMoveMsg m:
                    MoveTo(m.X, m.Y);
                    return true;
                case MouseMoveRelMsg r:
                    if (r.Dx == 0 && r.Dy == 0) return false;
                    _sink.MoveRelative(Math.Clamp(r.Dx, -ControlMessageParser.RelMoveLimit, ControlMessageParser.RelMoveLimit),
                        Math.Clamp(r.Dy, -ControlMessageParser.RelMoveLimit, ControlMessageParser.RelMoveLimit));
                    return true;
                case MouseButtonMsg b:
                    if (b.X != null && b.Y != null) MoveTo(b.X.Value, b.Y.Value);
                    if (b.Down == _heldButtons.Contains(b.Button) && b.Down) return false; // already down
                    if (!b.Down && !_heldButtons.Contains(b.Button)) return false;        // never pressed by us
                    if (b.Down) _heldButtons.Add(b.Button); else _heldButtons.Remove(b.Button);
                    _sink.Button(b.Button, b.Down);
                    return true;
                case WheelMsg w:
                    if (w.Dx == 0 && w.Dy == 0) return false;
                    _sink.Wheel(Math.Clamp(w.Dx, -1200, 1200), Math.Clamp(w.Dy, -1200, 1200));
                    return true;
                case KeyMsg k:
                    return KeyLocked(k.Code, k.Down);
                case TextMsg t:
                    return TypeLocked(t.Text);
                default:
                    return false;
            }
        }
    }

    public bool Key(string code, bool down)
    {
        lock (_lock) return _isAllowed() && KeyLocked(code, down);
    }

    /// <summary>Presses a combo like "Control+C" (MCP). All parts must resolve; the kill chord is refused.</summary>
    public bool Combo(string combo)
    {
        var parts = combo.Split('+');
        if (parts.Length is 0 or > 5) return false;
        var codes = new List<string>();
        foreach (var p in parts)
        {
            var code = KeyMap.ResolveComboPart(p);
            if (code == null) return false;
            codes.Add(code);
        }
        lock (_lock)
        {
            if (!_isAllowed()) return false;
            var pressed = new List<string>();
            foreach (var c in codes)
            {
                if (!KeyLocked(c, true)) break;
                pressed.Add(c);
            }
            bool ok = pressed.Count == codes.Count;
            for (int i = pressed.Count - 1; i >= 0; i--) KeyLocked(pressed[i], false);
            return ok;
        }
    }

    public bool Type(string text)
    {
        lock (_lock) return _isAllowed() && TypeLocked(text);
    }

    public bool MoveTo(double x, double y, bool checkAllowed)
    {
        lock (_lock)
        {
            if (checkAllowed && !_isAllowed()) return false;
            MoveTo(x, y);
            return true;
        }
    }

    public bool Click(MouseButton button, int count = 1)
    {
        lock (_lock)
        {
            if (!_isAllowed() || _heldButtons.Contains(button)) return false;
            for (int i = 0; i < count; i++) { _sink.Button(button, true); _sink.Button(button, false); }
            return true;
        }
    }

    public bool Scroll(int dy)
    {
        lock (_lock)
        {
            if (!_isAllowed() || dy == 0) return false;
            _sink.Wheel(0, Math.Clamp(dy, -1200, 1200));
            return true;
        }
    }

    /// <summary>Releases every key and button we pressed. Runs regardless of the gate (session end / kill).</summary>
    public void ReleaseAll()
    {
        lock (_lock)
        {
            foreach (var code in _heldKeys.ToList())
                if (KeyMap.TryGet(code, out var k)) _sink.Key(k, false);
            _heldKeys.Clear();
            foreach (var b in _heldButtons.ToList()) _sink.Button(b, false);
            _heldButtons.Clear();
        }
    }

    // ---- internals (call with _lock held) ----

    private void MoveTo(double x, double y)
    {
        x = Math.Clamp(x, 0, 1); y = Math.Clamp(y, 0, 1);
        var (nx, ny) = MapToVirtualDesk(x, y, _monitorBounds(), _virtualScreen());
        _sink.MoveAbsolute(nx, ny);
    }

    /// <summary>Maps 0..1 within the monitor to the 0..65535 range of the virtual desktop (MOUSEEVENTF_VIRTUALDESK).</summary>
    public static (int X, int Y) MapToVirtualDesk(double x, double y, Rectangle monitor, Rectangle virtualScreen)
    {
        double px = monitor.Left + x * Math.Max(0, monitor.Width - 1);
        double py = monitor.Top + y * Math.Max(0, monitor.Height - 1);
        double nx = (px - virtualScreen.Left) * 65535.0 / Math.Max(1, virtualScreen.Width - 1);
        double ny = (py - virtualScreen.Top) * 65535.0 / Math.Max(1, virtualScreen.Height - 1);
        return ((int)Math.Round(Math.Clamp(nx, 0, 65535)), (int)Math.Round(Math.Clamp(ny, 0, 65535)));
    }

    private bool KeyLocked(string code, bool down)
    {
        if (!KeyMap.TryGet(code, out var info)) { Log?.Invoke($"unknown key code ignored"); return false; }
        if (down)
        {
            if (WouldCompleteKillChord(_heldKeys, code)) { Log?.Invoke("kill-switch chord refused"); return false; }
            _heldKeys.Add(code); // repeated keydown (auto-repeat) is allowed
        }
        else
        {
            if (!_heldKeys.Remove(code)) return false; // never pressed by us
        }
        _sink.Key(info, down);
        return true;
    }

    /// <summary>True if pressing <paramref name="code"/> with <paramref name="held"/> down would make Ctrl+Alt+Shift+F12.</summary>
    public static bool WouldCompleteKillChord(IReadOnlyCollection<string> held, string code)
    {
        var all = new HashSet<string>(held) { code };
        bool ctrl = all.Contains("ControlLeft") || all.Contains("ControlRight");
        bool alt = all.Contains("AltLeft") || all.Contains("AltRight");
        bool shift = all.Contains("ShiftLeft") || all.Contains("ShiftRight");
        return ctrl && alt && shift && all.Contains("F12");
    }

    private bool TypeLocked(string text)
    {
        if (text.Length > 256) return false;
        foreach (var c in text)
        {
            if (c is '\n' or '\r') { TapLocked("Enter"); continue; }
            if (c == '\t') { TapLocked("Tab"); continue; }
            if (char.IsControl(c)) continue;
            _sink.UnicodeChar(c, true);
            _sink.UnicodeChar(c, false);
        }
        return true;
    }

    private void TapLocked(string code)
    {
        if (KeyLocked(code, true)) KeyLocked(code, false);
    }
}
