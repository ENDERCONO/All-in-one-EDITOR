namespace GlobalRemoteControl.Agent.Session;

public enum SessionMode { Control, View }
public enum SessionKind { Browser, Mcp }

/// <param name="Owner">The controller is a "my device" (PROTOCOL section 8): its uploads need no dialog.</param>
public sealed record SessionInfo(string Key, SessionKind Kind, string ControllerName, string ControllerId, SessionMode Mode, DateTimeOffset Started,
    bool Owner = false)
{
    public string Label => Kind == SessionKind.Mcp ? "Claude (MCP)" : ControllerName;
    public string ModeText => Mode == SessionMode.Control ? "full control" : "view only";
}

/// <summary>
/// The single source of truth for "is a session active, and may it inject input". One session at a time across
/// browser and MCP. A reservation is held while a request awaits approval so a second request gets "busy".
/// </summary>
public sealed class SessionGate
{
    private readonly object _lock = new();
    private string? _reservedKey;
    private SessionInfo? _active;

    public event Action? Changed;
    /// <summary>Raised (outside the lock) when the active session ends, with the reason ("killed", "stopped", ...).</summary>
    public event Action<SessionInfo, string>? Ended;

    public SessionInfo? Active { get { lock (_lock) return _active; } }
    public bool IsBusy { get { lock (_lock) return _active != null || _reservedKey != null; } }

    /// <summary>Reserve the device for a pending request. False = busy.</summary>
    public bool TryReserve(string key)
    {
        lock (_lock)
        {
            if (_active != null || _reservedKey != null) return false;
            _reservedKey = key;
            return true;
        }
    }

    public void CancelReservation(string key)
    {
        lock (_lock) if (_reservedKey == key) _reservedKey = null;
    }

    /// <summary>Turns a reservation into an active session (after the local user approved).</summary>
    public bool Activate(string key, SessionKind kind, string controllerName, string controllerId, SessionMode mode, bool owner = false)
    {
        lock (_lock)
        {
            if (_reservedKey != key || _active != null) return false;
            _reservedKey = null;
            _active = new SessionInfo(key, kind, controllerName, controllerId, mode, DateTimeOffset.UtcNow, owner);
        }
        Changed?.Invoke();
        return true;
    }

    /// <summary>True only while <paramref name="key"/> is the active session and it is in control mode.</summary>
    public bool IsInputAllowed(string key)
    {
        lock (_lock) return _active != null && _active.Key == key && _active.Mode == SessionMode.Control;
    }

    public bool IsActive(string key)
    {
        lock (_lock) return _active != null && _active.Key == key;
    }

    /// <summary>Ends the given session (no-op if it is not the active one).</summary>
    public void End(string key, string reason)
    {
        SessionInfo? ended;
        lock (_lock)
        {
            if (_reservedKey == key) _reservedKey = null;
            if (_active == null || _active.Key != key) return;
            ended = _active;
            _active = null;
        }
        Ended?.Invoke(ended, reason);
        Changed?.Invoke();
    }

    /// <summary>Kill switch: ends whatever is active, immediately.</summary>
    public void Kill(string reason = "killed")
    {
        SessionInfo? ended;
        lock (_lock)
        {
            ended = _active;
            _active = null;
            _reservedKey = null;
        }
        if (ended != null) Ended?.Invoke(ended, reason);
        Changed?.Invoke();
    }
}
