using System.Text.Json;
using GlobalRemoteControl.Agent.Audio;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Settings;
using GlobalRemoteControl.Agent.Signaling;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent;

/// <summary>
/// Composition root without any UI: owns the identity, trust store, signaling connection, pairing and session
/// negotiation, and routes signaling messages to them. The WinForms layer talks only to this class.
/// </summary>
public sealed class AgentHost : IDisposable
{
    private readonly string? _serverOverride;
    private SignalingState _lastState = SignalingState.Disconnected;

    public AgentHost(AgentPaths paths, AuditLog audit, IUserPrompts prompts, string? serverOverride)
    {
        Paths = paths;
        Audit = audit;
        Settings = AgentSettings.Load(paths.SettingsFile); // McpEnabled: persisted, off by default (PROTOCOL section 6)
        _serverOverride = serverOverride;
        Identity = DeviceIdentity.LoadOrCreate(paths.DeviceKeyFile);
        Store = new TrustedControllerStore(paths.TrustedControllersFile);
        Gate = new SessionGate();
        Signaling = new SignalingClient(Identity, () => Settings.DeviceName);
        Pairing = new PairingHandler(Signaling, Store, prompts, audit);
        var services = new SessionServices
        {
            Monitors = Monitors.Enumerate,
            CreateCapturer = () => new ScreenCapturer(),
            InputSink = new SendInputSink(),
            VirtualScreen = Monitors.VirtualScreen,
            AudioAvailable = LoopbackAudio.IsAvailable,
            Prompts = prompts,
            Audit = audit,
        };
        Negotiator = new SessionNegotiator(Signaling, Identity, Store, Gate, prompts, audit,
            (info, fp) => new RemoteSession(info, fp, Signaling.IceServers, Gate, services));

        Signaling.StateChanged += OnSignalingState;
        Signaling.MessageReceived += OnMessage;
        Gate.Ended += (info, reason) => Audit.Write("session-closed", info.ControllerName, info.ControllerId, reason);
    }

    public AgentPaths Paths { get; }
    public AuditLog Audit { get; }
    public AgentSettings Settings { get; }
    public DeviceIdentity Identity { get; }
    public TrustedControllerStore Store { get; }
    public SessionGate Gate { get; }
    public SignalingClient Signaling { get; }
    public PairingHandler Pairing { get; }
    public SessionNegotiator Negotiator { get; }

    /// <summary>The URL actually in use: the --server argument if given, else the saved setting.</summary>
    public string EffectiveServerUrl => _serverOverride ?? Settings.ServerUrl;
    public bool ServerOverridden => _serverOverride != null;

    public RemoteSession? ActiveSession => Negotiator.ActivePeer as RemoteSession;

    public void Start()
    {
        Audit.Write("agent-started", Settings.DeviceName, Identity.DeviceId,
            $"version {typeof(AgentHost).Assembly.GetName().Version}, server {EffectiveServerUrl}");
        Signaling.Start(EffectiveServerUrl);
    }

    /// <summary>Saves a new server URL (from the settings box) and reconnects. Any session is ended first.</summary>
    public void ChangeServer(string url)
    {
        if (!AgentSettings.IsValidServerUrl(url)) throw new ArgumentException("The server URL must start with wss:// or ws://");
        Kill("server changed");
        Settings.ServerUrl = url;
        Settings.Save(Paths.SettingsFile);
        Audit.Write("server-changed", details: url);
        Signaling.Start(url);
    }

    /// <summary>Kill switch: stop any session immediately, release held input, close the peer.</summary>
    public void Kill(string source)
    {
        var active = Gate.Active;
        if (active != null || Gate.IsBusy)
            Audit.Write("kill-switch", active?.ControllerName, active?.ControllerId, source);
        Gate.Kill("killed");             // input gate closes at once; Ended → negotiator disposes the peer (releases keys)
        Negotiator.AbortPending("killed"); // a request still waiting for approval
    }

    private void OnSignalingState(SignalingState s)
    {
        var prev = _lastState;
        _lastState = s;
        if (s == SignalingState.Connected)
            Audit.Write("signaling-connected", Settings.DeviceName, Identity.DeviceId, Signaling.ServerUrl);
        else if (s == SignalingState.Disconnected && prev == SignalingState.Connected)
        {
            Audit.Write("signaling-disconnected", details: Signaling.LastError);
            Negotiator.OnDisconnected();
            Pairing.OnDisconnected();
        }
    }

    private void OnMessage(string type, JsonElement m)
    {
        // Runs on the receive loop: start each handler and let it continue asynchronously, so a dialog waiting for
        // the local user never blocks the next message (e.g. the session-end that should close that dialog).
        Task t = type switch
        {
            "pairing-code" => Run(() => Pairing.OnPairingCode(m)),
            "pair-request" => Pairing.OnPairRequestAsync(m),
            "session-request" or "session-auth" or "signal" or "session-end" => Negotiator.HandleAsync(type, m),
            "error" => Run(() => Audit.Write("server-error", details:
                $"{Json.Str(m, "code", 64) ?? "?"} {Json.Str(m, "message", 256)}".Trim())),
            _ => Task.CompletedTask,
        };
        if (!t.IsCompleted) _ = t.ContinueWith(x => Audit.Write("handler-error", details: x.Exception?.GetBaseException().Message),
            CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        else if (t.IsFaulted) Audit.Write("handler-error", details: t.Exception?.GetBaseException().Message);
    }

    private static Task Run(Action a)
    {
        try { a(); return Task.CompletedTask; }
        catch (Exception ex) { return Task.FromException(ex); }
    }

    public void Dispose()
    {
        try { Kill("exit"); } catch (Exception) { }
        Signaling.Dispose();
        Audit.Write("agent-stopped");
        Identity.Dispose();
    }
}
