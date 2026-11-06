using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GlobalRemoteControl.Agent.Audit;

namespace GlobalRemoteControl.Agent.Mcp;

/// <summary>
/// PROTOCOL.md section 6, pipe side: one JSON request line → one JSON response line between the short-lived
/// <c>--mcp</c> process and the running tray app. Only two commands exist; neither approves anything.
/// </summary>
public static class AgentPipeProtocol
{
    public const int MaxMessageBytes = 4096;
    public const string CmdStatus = "status";
    public const string CmdPairingCode = "pairing-code";
    public static readonly IReadOnlySet<string> Commands = new HashSet<string>(StringComparer.Ordinal) { CmdStatus, CmdPairingCode };

    /// <summary><c>GlobalRemoteControl-&lt;current user SID&gt;</c> (used as <c>\\.\pipe\…</c>).</summary>
    public static string PipeNameForCurrentUser()
    {
        using var id = WindowsIdentity.GetCurrent();
        return "GlobalRemoteControl-" + (id.User?.Value ?? throw new InvalidOperationException("no user SID"));
    }

    /// <summary>Validates one request line. Returns the command, or null with an error code.</summary>
    public static string? ParseRequest(string? line, out string? error)
    {
        error = null;
        if (line == null) { error = "bad-request"; return null; }
        if (Encoding.UTF8.GetByteCount(line) > MaxMessageBytes) { error = "too-large"; return null; }
        try
        {
            using var doc = JsonDocument.Parse(line);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("cmd", out var c) || c.ValueKind != JsonValueKind.String)
            { error = "bad-request"; return null; }
            var cmd = c.GetString()!;
            if (!Commands.Contains(cmd)) { error = "unknown-command"; return null; }
            return cmd;
        }
        catch (JsonException) { error = "bad-request"; return null; }
    }

    /// <summary>Client side: the agent's reply line as an object (an error object when it is unusable).</summary>
    public static JsonObject ParseReply(string? line, bool tooLarge)
    {
        if (line == null || tooLarge) return Error("bad-reply", "The agent sent no usable reply.");
        try { return JsonNode.Parse(line) as JsonObject ?? Error("bad-reply", "The agent sent no usable reply."); }
        catch (JsonException) { return Error("bad-reply", "The agent sent no usable reply."); }
    }

    public static JsonObject Error(string code, string message) => new() { ["ok"] = false, ["error"] = code, ["message"] = message };

    /// <summary>Reads bytes up to '\n'. Returns null on EOF before any newline; sets tooLarge past the limit.</summary>
    public static async Task<(string? Line, bool TooLarge)> ReadLineAsync(Stream s, int maxBytes, CancellationToken ct)
    {
        var buf = new MemoryStream();
        var one = new byte[512];
        while (true)
        {
            int n = await s.ReadAsync(one, ct).ConfigureAwait(false);
            if (n == 0) return (buf.Length > 0 && buf.Length <= maxBytes ? Encoding.UTF8.GetString(buf.ToArray()) : null, buf.Length > maxBytes);
            int nl = Array.IndexOf(one, (byte)'\n', 0, n);
            buf.Write(one, 0, nl < 0 ? n : nl);
            if (buf.Length > maxBytes) return (null, true);
            if (nl >= 0) return (Encoding.UTF8.GetString(buf.ToArray()).TrimEnd('\r'), false);
        }
    }

    public static async Task WriteLineAsync(Stream s, JsonNode msg, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(msg.ToJsonString() + "\n");
        await s.WriteAsync(bytes, ct).ConfigureAwait(false);
        await s.FlushAsync(ct).ConfigureAwait(false);
    }
}

/// <summary>
/// Tray-app side command handling, kept free of pipes and UI so it can be tested. Every command (accepted or not)
/// is written to the audit log. <c>pairing-code</c> is refused unless "Allow Claude (MCP)" is on.
/// </summary>
public sealed class AgentPipeCommands
{
    public const string McpDisabledMessage =
        "Claude (MCP) is not allowed on this PC. Ask the person at the PC to open GlobalRemoteControl and turn on " +
        "\"Allow Claude (MCP)\" (main window or tray menu), then try again.";

    private readonly AuditLog _audit;
    private readonly Func<bool> _mcpAllowed;
    private readonly Func<JsonObject> _status;
    private readonly Func<CancellationToken, Task<JsonObject>> _pairingCode;

    public AgentPipeCommands(AuditLog audit, Func<bool> mcpAllowed, Func<JsonObject> status,
        Func<CancellationToken, Task<JsonObject>> pairingCode)
    {
        _audit = audit; _mcpAllowed = mcpAllowed; _status = status; _pairingCode = pairingCode;
    }

    /// <summary>One request line → one response line (without the trailing newline).</summary>
    public async Task<string> HandleLineAsync(string? line, CancellationToken ct)
    {
        var tooLarge = line != null && Encoding.UTF8.GetByteCount(line) > AgentPipeProtocol.MaxMessageBytes;
        return (await HandleAsync(tooLarge ? null : line, tooLarge, ct).ConfigureAwait(false)).ToJsonString();
    }

    public async Task<JsonObject> HandleAsync(string? line, bool tooLarge, CancellationToken ct)
    {
        string? error = "too-large", cmd = null;
        if (!tooLarge) cmd = AgentPipeProtocol.ParseRequest(line, out error);
        if (cmd == null)
        {
            _audit.Write("mcp-pipe-rejected", "Claude (MCP)", null, error);
            return AgentPipeProtocol.Error(error!, error == "unknown-command" ? "Unknown command." : "Malformed request.");
        }
        JsonObject result;
        try
        {
            if (cmd == AgentPipeProtocol.CmdStatus) result = _status();
            else if (!_mcpAllowed()) result = AgentPipeProtocol.Error("mcp-disabled", McpDisabledMessage);
            else result = await _pairingCode(ct).ConfigureAwait(false);
        }
        catch (Exception ex) { result = AgentPipeProtocol.Error("internal-error", ex.Message); }
        var ok = result["ok"]?.GetValue<bool>() ?? true;
        _audit.Write("mcp-pipe-command", "Claude (MCP)", null,
            cmd + (ok ? " ok" : " refused: " + (result["error"]?.GetValue<string>() ?? "?")));
        return result;
    }
}
