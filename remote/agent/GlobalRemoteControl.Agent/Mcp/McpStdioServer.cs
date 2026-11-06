using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Settings;

namespace GlobalRemoteControl.Agent.Mcp;

/// <summary>
/// PROTOCOL.md section 6: <c>GlobalRemoteControl.exe --mcp</c>. Minimal hand-rolled MCP server (JSON-RPC 2.0,
/// newline-delimited, over stdin/stdout) with exactly three tools: get_agent_status, open_agent and
/// create_pairing_code. Nothing here approves, captures, injects input or touches files.
/// </summary>
public sealed class McpStdioServer
{
    public const string ProtocolVersion = "2025-06-18";
    public const string WebUrl = "https://all-in-one-editor.onrender.com/remote/web/";
    public const string ServerUrlEnvVar = "GLOBALREMOTECONTROL_SERVER";
    private const int MaxLineChars = 1 << 20;

    private static readonly TimeSpan StatusTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PairingTimeout = TimeSpan.FromSeconds(15); // the tray app waits ≤ 10 s for the server

    private readonly IAgentBridge _bridge;
    private readonly AuditLog? _audit;
    private readonly TimeSpan _openTimeout;

    public McpStdioServer(IAgentBridge bridge, AuditLog? audit = null, TimeSpan? openTimeout = null)
    {
        _bridge = bridge; _audit = audit; _openTimeout = openTimeout ?? TimeSpan.FromSeconds(15);
    }

    /// <summary>Entry point for <c>--mcp</c>: runs until stdin closes. No UI, no single-instance mutex.</summary>
    public static int RunProcess(string? serverUrl)
    {
        serverUrl ??= Environment.GetEnvironmentVariable(ServerUrlEnvVar);
        if (serverUrl != null && !AgentSettings.IsValidServerUrl(serverUrl)) serverUrl = null;
        AuditLog? audit = null;
        try { audit = new AuditLog(new AgentPaths().AuditLogFile); } catch (Exception) { }
        var server = new McpStdioServer(new AgentPipeClient(AgentPipeProtocol.PipeNameForCurrentUser(), serverUrl), audit);
        // WinExe: there is no console, but the std handles handed over by the MCP client still work.
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        using var input = new StreamReader(Console.OpenStandardInput(), utf8);
        using var output = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true, NewLine = "\n" };
        server.RunAsync(input, output, CancellationToken.None).GetAwaiter().GetResult();
        return 0;
    }

    public async Task RunAsync(TextReader input, TextWriter output, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            string? line;
            try { line = await input.ReadLineAsync(ct).ConfigureAwait(false); }
            catch (IOException) { break; }
            if (line == null) break;
            if (line.Length == 0) continue;
            var reply = await HandleLineAsync(line, ct).ConfigureAwait(false);
            if (reply == null) continue;
            try { await output.WriteLineAsync(reply).ConfigureAwait(false); await output.FlushAsync(ct).ConfigureAwait(false); }
            catch (IOException) { break; }
        }
    }

    /// <summary>Handles one JSON-RPC message; returns the response line, or null for notifications.</summary>
    public async Task<string?> HandleLineAsync(string line, CancellationToken ct)
    {
        if (line.Length > MaxLineChars) return ErrorResponse(null, -32600, "Message too large").ToJsonString();
        JsonNode? msg;
        try { msg = JsonNode.Parse(line); }
        catch (JsonException) { return ErrorResponse(null, -32700, "Parse error").ToJsonString(); }
        if (msg is not JsonObject obj) return ErrorResponse(null, -32600, "Invalid Request").ToJsonString();

        JsonNode? id = null;
        bool hasId = obj.TryGetPropertyValue("id", out var rawId) && rawId != null;
        if (hasId)
        {
            var kind = rawId!.GetValueKind();
            if (kind != JsonValueKind.String && kind != JsonValueKind.Number)
                return ErrorResponse(null, -32600, "Invalid Request").ToJsonString();
            id = rawId.DeepClone();
        }
        string? method = null;
        if (obj["method"] is JsonValue mv && mv.GetValueKind() == JsonValueKind.String) method = mv.GetValue<string>();
        var versionOk = obj["jsonrpc"] is JsonValue jv && jv.GetValueKind() == JsonValueKind.String && jv.GetValue<string>() == "2.0";
        if (method == null || !versionOk)
            return hasId || method == null ? ErrorResponse(id, -32600, "Invalid Request").ToJsonString() : null;
        if (!hasId) return null; // notifications (notifications/initialized, cancelled, …) need no reply

        try
        {
            JsonNode result = method switch
            {
                "initialize" => Initialize(),
                "ping" => new JsonObject(),
                "tools/list" => new JsonObject { ["tools"] = ToolList() },
                "tools/call" => await CallToolAsync(obj["params"] as JsonObject, ct).ConfigureAwait(false),
                _ => throw new RpcException(-32601, "Method not found: " + method),
            };
            return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result }.ToJsonString();
        }
        catch (RpcException ex) { return ErrorResponse(id, ex.Code, ex.Message).ToJsonString(); }
        catch (Exception ex) { return ErrorResponse(id, -32603, "Internal error: " + ex.Message).ToJsonString(); }
    }

    private sealed class RpcException(int code, string message) : Exception(message)
    {
        public int Code { get; } = code;
    }

    private static JsonObject ErrorResponse(JsonNode? id, int code, string message) => new()
    {
        ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
    };

    private static JsonObject Initialize() => new()
    {
        ["protocolVersion"] = ProtocolVersion,
        ["capabilities"] = new JsonObject { ["tools"] = new JsonObject { ["listChanged"] = false } },
        ["serverInfo"] = new JsonObject
        {
            ["name"] = "globalremotecontrol",
            ["version"] = typeof(McpStdioServer).Assembly.GetName().Version?.ToString(3) ?? "1.0.0",
        },
        ["instructions"] =
            "Controls only the GlobalRemoteControl app on this PC: open it, read its status, and show a pairing code. " +
            "Pairing a device and every remote session still need the person at the PC to approve them in the app.",
    };

    internal static readonly string[] ToolNames = { "get_agent_status", "open_agent", "create_pairing_code" };

    private static JsonArray ToolList() => new(
        Tool("get_agent_status", "Agent status",
            "Reports whether the GlobalRemoteControl app is running on this PC, whether it is connected to the server, " +
            "its device name and fingerprint, how many devices are trusted, whether a remote session is active, and " +
            "whether 'Allow Claude (MCP)' is on.", readOnly: true),
        Tool("open_agent", "Open the app",
            "Starts the GlobalRemoteControl tray app on this PC if it isn't running (visible in the tray) and returns its status.",
            readOnly: false),
        Tool("create_pairing_code", "Create a pairing code",
            "Shows a new one-time pairing code on this PC's screen (same as clicking 'Pair a new device') and returns it " +
            "with its expiry and the web page to enter it on. The person at the PC must still approve the new device. " +
            "Only works when 'Allow Claude (MCP)' is turned on in the app.", readOnly: false));

    private static JsonObject Tool(string name, string title, string description, bool readOnly) => new()
    {
        ["name"] = name,
        ["title"] = title,
        ["description"] = description,
        ["inputSchema"] = new JsonObject
        {
            ["type"] = "object", ["properties"] = new JsonObject(), ["additionalProperties"] = false,
        },
        ["annotations"] = new JsonObject
        {
            ["readOnlyHint"] = readOnly, ["destructiveHint"] = false, ["openWorldHint"] = false,
        },
    };

    private async Task<JsonObject> CallToolAsync(JsonObject? p, CancellationToken ct)
    {
        if (p?["name"] is not JsonValue nv || nv.GetValueKind() != JsonValueKind.String)
            throw new RpcException(-32602, "Invalid params: missing tool name");
        var name = nv.GetValue<string>();
        return name switch
        {
            "get_agent_status" => ToolResult(await StatusAsync(ct).ConfigureAwait(false), false),
            "open_agent" => await OpenAgentAsync(ct).ConfigureAwait(false),
            "create_pairing_code" => await PairingCodeAsync(ct).ConfigureAwait(false),
            _ => throw new RpcException(-32602, "Unknown tool: " + name),
        };
    }

    private async Task<JsonObject> StatusAsync(CancellationToken ct)
    {
        var s = await _bridge.SendAsync(AgentPipeProtocol.CmdStatus, StatusTimeout, ct).ConfigureAwait(false);
        if (s == null) return new JsonObject { ["running"] = false };
        s.Remove("ok");
        return s;
    }

    private async Task<JsonObject> OpenAgentAsync(CancellationToken ct)
    {
        var s = await StatusAsync(ct).ConfigureAwait(false);
        if (s["running"]?.GetValue<bool>() == true) return ToolResult(s, false);
        _audit?.Write("mcp-open-agent", "Claude (MCP)", null, "starting the tray app");
        var err = _bridge.Launch();
        if (err != null) return ToolResult(new JsonObject { ["running"] = false, ["error"] = err }, true);
        var deadline = DateTime.UtcNow + _openTimeout;
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(300, ct).ConfigureAwait(false);
            s = await StatusAsync(ct).ConfigureAwait(false);
            if (s["running"]?.GetValue<bool>() == true) return ToolResult(s, false);
        }
        return ToolResult(new JsonObject
        {
            ["running"] = false,
            ["error"] = $"GlobalRemoteControl was started but did not answer within {_openTimeout.TotalSeconds:0} s.",
        }, true);
    }

    private async Task<JsonObject> PairingCodeAsync(CancellationToken ct)
    {
        var r = await _bridge.SendAsync(AgentPipeProtocol.CmdPairingCode, PairingTimeout, ct).ConfigureAwait(false);
        if (r == null)
            return ToolResult(new JsonObject { ["error"] = "not-running", ["message"] = "GlobalRemoteControl is not running on this PC. Call open_agent first." }, true);
        if (r["ok"]?.GetValue<bool>() != true)
        {
            r.Remove("ok");
            return ToolResult(r, true);
        }
        return ToolResult(new JsonObject
        {
            ["code"] = r["code"]?.DeepClone(),
            ["expiresAt"] = r["expiresAt"]?.DeepClone(),
            ["webUrl"] = WebUrl,
        }, false);
    }

    private static JsonObject ToolResult(JsonObject data, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = data.ToJsonString() }),
        ["structuredContent"] = data,
        ["isError"] = isError,
    };
}
