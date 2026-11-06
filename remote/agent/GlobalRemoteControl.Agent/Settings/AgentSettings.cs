using System.Text.Json;

namespace GlobalRemoteControl.Agent.Settings;

public sealed class AgentSettings
{
    public const string DefaultServerUrl = "wss://all-in-one-editor.onrender.com/remote/ws";

    public string ServerUrl { get; set; } = DefaultServerUrl;
    public string DeviceName { get; set; } = Environment.MachineName;
    /// <summary>Allow Claude (MCP) to request pairing codes (PROTOCOL section 6). Persisted; off by default.</summary>
    public bool McpEnabled { get; set; }

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static AgentSettings Load(string path)
    {
        AgentSettings s;
        try { s = File.Exists(path) ? JsonSerializer.Deserialize<AgentSettings>(File.ReadAllText(path)) ?? new() : new(); }
        catch (Exception) { s = new(); }
        if (!IsValidServerUrl(s.ServerUrl)) s.ServerUrl = DefaultServerUrl;
        s.DeviceName = NormalizeName(s.DeviceName);
        return s;
    }

    public void Save(string path) => AgentPaths.WriteAtomic(path, JsonSerializer.Serialize(this, Json));

    public static bool IsValidServerUrl(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "wss" || u.Scheme == "ws");

    /// <summary>Protocol: name is 1..64 chars.</summary>
    public static string NormalizeName(string? name)
    {
        var n = new string((name ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (n.Length == 0) n = "Windows PC";
        return n.Length > 64 ? n[..64] : n;
    }
}
