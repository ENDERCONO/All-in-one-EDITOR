using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Nodes;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Mcp;
using GlobalRemoteControl.Agent.Settings;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>Runs only on Windows (named-pipe ACLs, WindowsIdentity, process launching).</summary>
public sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows()) Skip = "Windows only (named-pipe ACLs / WindowsIdentity).";
    }
}

/// <summary>
/// The tray app's side as the MCP process sees it: routes pipe commands straight into a real
/// <see cref="AgentPipeCommands"/> (no pipe), or reports "not running".
/// </summary>
internal sealed class FakeAgent : IAgentBridge, IDisposable
{
    private readonly TempDir _dir = new();
    public AuditLog Audit { get; }
    public AgentPipeCommands Commands { get; }
    public bool Running { get; set; } = true;
    public bool McpAllowed { get; set; }
    public int PairingTriggered { get; private set; }
    public int Launches { get; private set; }
    public string? LaunchError { get; set; }
    public bool StartOnLaunch { get; set; } = true;
    public List<string> Sent { get; } = new();
    public Func<string, JsonObject?>? Override { get; set; }

    public FakeAgent()
    {
        Audit = new AuditLog(_dir.File("audit.log"));
        Commands = new AgentPipeCommands(Audit, () => McpAllowed, Status, ct =>
        {
            PairingTriggered++;
            return Task.FromResult(new JsonObject
            {
                ["ok"] = true, ["code"] = "123456", ["expiresAt"] = "2026-11-06T12:05:00Z",
                ["server"] = "wss://example.test/remote/ws",
            });
        });
    }

    public JsonObject Status() => new()
    {
        ["ok"] = true, ["running"] = true, ["connectedToServer"] = true, ["server"] = "wss://example.test/remote/ws",
        ["deviceName"] = "HOME-PC", ["fingerprint"] = "AB:CD", ["trustedDevices"] = 2, ["sessionActive"] = false,
        ["mcpAllowed"] = McpAllowed,
    };

    public string[] AuditLines() => File.Exists(Audit.FilePath) ? File.ReadAllLines(Audit.FilePath) : Array.Empty<string>();

    public async Task<JsonObject?> SendAsync(string cmd, TimeSpan timeout, CancellationToken ct)
    {
        Sent.Add(cmd);
        if (Override != null) return Override(cmd);
        if (!Running) return null;
        var reply = await Commands.HandleLineAsync(new JsonObject { ["cmd"] = cmd }.ToJsonString(), ct);
        return (JsonObject)JsonNode.Parse(reply)!;
    }

    public string? Launch()
    {
        Launches++;
        if (LaunchError != null) return LaunchError;
        if (StartOnLaunch) Running = true;
        return null;
    }

    public void Dispose() => _dir.Dispose();
}

public class McpStdioServerTests : IDisposable
{
    private readonly FakeAgent _agent = new();
    private readonly McpStdioServer _server;

    public McpStdioServerTests() => _server = new McpStdioServer(_agent, openTimeout: TimeSpan.FromSeconds(2));
    public void Dispose() => _agent.Dispose();

    private async Task<JsonObject> Rpc(string line)
    {
        var reply = await _server.HandleLineAsync(line, CancellationToken.None);
        Assert.NotNull(reply);
        Assert.DoesNotContain('\n', reply);
        var obj = (JsonObject)JsonNode.Parse(reply!)!;
        Assert.Equal("2.0", obj["jsonrpc"]!.GetValue<string>());
        return obj;
    }

    private Task<JsonObject> Call(string tool, int id = 7) =>
        Rpc($"{{\"jsonrpc\":\"2.0\",\"id\":{id},\"method\":\"tools/call\",\"params\":{{\"name\":\"{tool}\",\"arguments\":{{}}}}}}");

    private static JsonObject Structured(JsonObject resp, bool expectError)
    {
        var result = resp["result"]!.AsObject();
        Assert.Equal(expectError, result["isError"]!.GetValue<bool>());
        var content = result["content"]!.AsArray();
        Assert.Equal("text", content[0]!["type"]!.GetValue<string>());
        var structured = result["structuredContent"]!.AsObject();
        // The text content is the same JSON as structuredContent (for clients without structured output).
        Assert.Equal(structured.ToJsonString(), JsonNode.Parse(content[0]!["text"]!.GetValue<string>())!.ToJsonString());
        return structured;
    }

    private static int ErrorCode(JsonObject resp)
    {
        Assert.Null(resp["result"]);
        return resp["error"]!["code"]!.GetValue<int>();
    }

    [Fact]
    public async Task Initialize_ReturnsProtocolVersionServerInfoAndToolsCapability()
    {
        var r = await Rpc("""{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}""");
        Assert.Equal(1, r["id"]!.GetValue<int>());
        var result = r["result"]!.AsObject();
        Assert.Equal("2025-06-18", result["protocolVersion"]!.GetValue<string>());
        Assert.Equal("globalremotecontrol", result["serverInfo"]!["name"]!.GetValue<string>());
        Assert.False(string.IsNullOrEmpty(result["serverInfo"]!["version"]!.GetValue<string>()));
        Assert.NotNull(result["capabilities"]!["tools"]);
        Assert.Null(result["capabilities"]!["resources"]);
        Assert.Null(result["capabilities"]!["prompts"]);
    }

    [Fact]
    public async Task StringIds_AreEchoed()
    {
        var r = await Rpc("""{"jsonrpc":"2.0","id":"abc","method":"ping"}""");
        Assert.Equal("abc", r["id"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("""{"jsonrpc":"2.0","method":"notifications/initialized"}""")]
    [InlineData("""{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}""")]
    [InlineData("""{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_pairing_code"}}""")]
    [InlineData("""{"jsonrpc":"2.0","method":"no/such/method"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":5,"result":{}}""")] // a response from the client: never answered
    public async Task Notifications_AndClientResponses_GetNoReply(string line)
    {
        Assert.Null(await _server.HandleLineAsync(line, CancellationToken.None));
        Assert.Equal(0, _agent.PairingTriggered); // a notification never runs a tool
        Assert.Empty(_agent.Sent);
    }

    [Fact]
    public async Task Ping_ReturnsEmptyResult()
    {
        var r = await Rpc("""{"jsonrpc":"2.0","id":2,"method":"ping"}""");
        Assert.Empty(r["result"]!.AsObject());
    }

    [Fact]
    public async Task ToolsList_ExactlyThreeTools_WithObjectInputSchemas()
    {
        var r = await Rpc("""{"jsonrpc":"2.0","id":3,"method":"tools/list"}""");
        var tools = r["result"]!["tools"]!.AsArray();
        Assert.Equal(new[] { "create_pairing_code", "get_agent_status", "open_agent" },
            tools.Select(t => t!["name"]!.GetValue<string>()).OrderBy(n => n, StringComparer.Ordinal).ToArray());
        foreach (var t in tools)
        {
            Assert.False(string.IsNullOrWhiteSpace(t!["description"]!.GetValue<string>()));
            var schema = t["inputSchema"]!.AsObject();
            Assert.Equal("object", schema["type"]!.GetValue<string>());
            Assert.Empty(schema["properties"]!.AsObject());
        }
        Assert.Equal(McpStdioServer.ToolNames.OrderBy(n => n, StringComparer.Ordinal),
            tools.Select(t => t!["name"]!.GetValue<string>()).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public async Task GetAgentStatus_Running_ReturnsAllFields()
    {
        var s = Structured(await Call("get_agent_status"), expectError: false);
        foreach (var k in new[] { "running", "connectedToServer", "server", "deviceName", "fingerprint", "trustedDevices", "sessionActive", "mcpAllowed" })
            Assert.True(s.ContainsKey(k), k);
        Assert.True(s["running"]!.GetValue<bool>());
        Assert.False(s["mcpAllowed"]!.GetValue<bool>());
        Assert.False(s.ContainsKey("ok"));
        Assert.Contains(_agent.AuditLines(), l => l.Contains("mcp-pipe-command") && l.Contains("status ok"));
    }

    [Fact]
    public async Task GetAgentStatus_NotRunning_ReturnsRunningFalse_AndNeverLaunches()
    {
        _agent.Running = false;
        var s = Structured(await Call("get_agent_status"), expectError: false);
        Assert.False(s["running"]!.GetValue<bool>());
        Assert.Equal(0, _agent.Launches);
    }

    [Fact]
    public async Task GetAgentStatus_PipeAnswersWithError_IsRunningButErrorResult()
    {
        _agent.Override = _ => AgentPipeProtocol.Error("timeout", "slow");
        var s = Structured(await Call("get_agent_status"), expectError: true);
        Assert.True(s["running"]!.GetValue<bool>());
        Assert.Equal("timeout", s["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task OpenAgent_AlreadyRunning_DoesNotLaunch()
    {
        var s = Structured(await Call("open_agent"), expectError: false);
        Assert.True(s["running"]!.GetValue<bool>());
        Assert.Equal(0, _agent.Launches);
    }

    [Fact]
    public async Task OpenAgent_PipeAnswersWithError_DoesNotLaunchSecondCopy()
    {
        _agent.Override = _ => AgentPipeProtocol.Error("bad-reply", "x");
        Structured(await Call("open_agent"), expectError: true);
        Assert.Equal(0, _agent.Launches);
    }

    [Fact]
    public async Task OpenAgent_NotRunning_LaunchesAndWaitsForPipe()
    {
        _agent.Running = false;
        var s = Structured(await Call("open_agent"), expectError: false);
        Assert.Equal(1, _agent.Launches);
        Assert.True(s["running"]!.GetValue<bool>());
        Assert.Equal("HOME-PC", s["deviceName"]!.GetValue<string>());
    }

    [Fact]
    public async Task OpenAgent_NeverAnswers_TimesOutWithError()
    {
        _agent.Running = false;
        _agent.StartOnLaunch = false;
        var server = new McpStdioServer(_agent, openTimeout: TimeSpan.FromMilliseconds(700));
        var reply = await server.HandleLineAsync("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"open_agent"}}""", default);
        var s = Structured((JsonObject)JsonNode.Parse(reply!)!, expectError: true);
        Assert.False(s["running"]!.GetValue<bool>());
        Assert.Equal(1, _agent.Launches);
    }

    [Fact]
    public async Task OpenAgent_LaunchFails_ReturnsError()
    {
        _agent.Running = false;
        _agent.LaunchError = "nope";
        var s = Structured(await Call("open_agent"), expectError: true);
        Assert.Equal("nope", s["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task CreatePairingCode_RefusedWhenMcpNotAllowed_AndDoesNotTriggerPairing()
    {
        _agent.McpAllowed = false;
        var s = Structured(await Call("create_pairing_code"), expectError: true);
        Assert.Equal("mcp-disabled", s["error"]!.GetValue<string>());
        Assert.Contains("Allow Claude (MCP)", s["message"]!.GetValue<string>());
        Assert.False(s.ContainsKey("code"));
        Assert.Equal(0, _agent.PairingTriggered);
        Assert.Contains(_agent.AuditLines(), l => l.Contains("mcp-pipe-command") && l.Contains("pairing-code refused: mcp-disabled"));
    }

    [Fact]
    public async Task CreatePairingCode_Allowed_ReturnsCodeExpiryAndWebUrl()
    {
        _agent.McpAllowed = true;
        var s = Structured(await Call("create_pairing_code"), expectError: false);
        Assert.Equal(1, _agent.PairingTriggered);
        Assert.Equal("123456", s["code"]!.GetValue<string>());
        Assert.Equal("2026-11-06T12:05:00Z", s["expiresAt"]!.GetValue<string>());
        Assert.Equal("https://example.test/remote/web/", s["webUrl"]!.GetValue<string>());
        Assert.Equal(3, s.Count);
        Assert.Contains(_agent.AuditLines(), l => l.Contains("pairing-code ok"));
    }

    [Fact]
    public async Task CreatePairingCode_NotRunning_ErrorResult()
    {
        _agent.Running = false;
        var s = Structured(await Call("create_pairing_code"), expectError: true);
        Assert.Equal("not-running", s["error"]!.GetValue<string>());
        Assert.Equal(0, _agent.Launches); // does not start the app by itself
    }

    [Fact]
    public async Task CreatePairingCode_ReplyWithoutCode_IsError()
    {
        _agent.Override = _ => new JsonObject { ["ok"] = true };
        var s = Structured(await Call("create_pairing_code"), expectError: true);
        Assert.Equal("bad-reply", s["error"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("wss://all-in-one-editor.onrender.com/remote/ws", "https://all-in-one-editor.onrender.com/remote/web/")]
    [InlineData("ws://localhost:3000/remote/ws", "http://localhost:3000/remote/web/")]
    [InlineData("wss://h.test/remote/ws/", "https://h.test/remote/web/")]
    [InlineData("wss://h.test/other", McpStdioServer.WebUrl)]
    [InlineData("https://h.test/remote/ws", McpStdioServer.WebUrl)]
    [InlineData(null, McpStdioServer.WebUrl)]
    public void WebUrl_DerivedFromAgentServer(string? server, string expected) =>
        Assert.Equal(expected, McpStdioServer.WebUrlFor(server));

    [Fact]
    public async Task UnknownTool_IsInvalidParamsError_AndTouchesNothing()
    {
        var r = await Call("capture_screen");
        Assert.Equal(-32602, ErrorCode(r));
        Assert.Contains("capture_screen", r["error"]!["message"]!.GetValue<string>());
        Assert.Empty(_agent.Sent);
    }

    [Theory]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":"tools/call"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":5}}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_status","arguments":"x"}}""")]
    public async Task ToolsCall_BadParams_IsInvalidParams(string line) => Assert.Equal(-32602, ErrorCode(await Rpc(line)));

    [Theory]
    [InlineData("{not json")]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":"ping" """)]
    public async Task MalformedJson_IsParseError_WithNullId(string line)
    {
        var r = await Rpc(line);
        Assert.Equal(-32700, ErrorCode(r));
        Assert.True(r.ContainsKey("id"));
        Assert.Null(r["id"]);
    }

    [Fact]
    public async Task UnknownMethod_IsMethodNotFound()
    {
        var r = await Rpc("""{"jsonrpc":"2.0","id":9,"method":"resources/list"}""");
        Assert.Equal(-32601, ErrorCode(r));
        Assert.Equal(9, r["id"]!.GetValue<int>());
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("""{"jsonrpc":"2.0","id":1}""")]
    [InlineData("""{"jsonrpc":"1.0","id":1,"method":"ping"}""")]
    [InlineData("""{"id":1,"method":"ping"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":null,"method":"ping"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1,"method":7}""")]
    public async Task InvalidRequests_AreInvalidRequest(string line) => Assert.Equal(-32600, ErrorCode(await Rpc(line)));

    [Fact]
    public async Task RunAsync_StdoutCarriesOnlyJsonRpcResponses_OnePerRequest()
    {
        _agent.McpAllowed = true;
        var input = new StringReader(string.Join("\n",
            """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}""",
            """{"jsonrpc":"2.0","method":"notifications/initialized"}""",
            "",
            """{"jsonrpc":"2.0","id":2,"method":"tools/list"}""",
            "garbage",
            """{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_pairing_code"}}""") + "\n");
        var output = new StringWriter { NewLine = "\n" };
        await _server.RunAsync(input, output, CancellationToken.None);
        var lines = output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(4, lines.Length);
        var parsed = lines.Select(l => (JsonObject)JsonNode.Parse(l)!).ToArray();
        Assert.All(parsed, p => Assert.Equal("2.0", p["jsonrpc"]!.GetValue<string>()));
        Assert.Equal(1, parsed[0]["id"]!.GetValue<int>());
        Assert.Equal(2, parsed[1]["id"]!.GetValue<int>());
        Assert.Equal(-32700, parsed[2]["error"]!["code"]!.GetValue<int>());
        Assert.Equal("123456", parsed[3]["result"]!["structuredContent"]!["code"]!.GetValue<string>());
    }

    [Fact]
    public void ClaudeSetup_ContainsClaudeMcpAddCommand()
    {
        var text = McpStdioServer.ClaudeSetupText(@"C:\Apps\GlobalRemoteControl.exe");
        Assert.StartsWith("claude mcp add globalremotecontrol -- \"C:\\Apps\\GlobalRemoteControl.exe\" --mcp\r\n", text);
        var json = text[text.IndexOf('{')..];
        using var doc = JsonDocument.Parse(json);
        var entry = doc.RootElement.GetProperty("mcpServers").GetProperty("globalremotecontrol");
        Assert.Equal(@"C:\Apps\GlobalRemoteControl.exe", entry.GetProperty("command").GetString());
        Assert.Equal("--mcp", entry.GetProperty("args")[0].GetString());
        Assert.DoesNotContain("\r\r", text);
    }
}

public class AgentPipeCommandsTests : IDisposable
{
    private readonly FakeAgent _agent = new();
    public void Dispose() => _agent.Dispose();

    private async Task<JsonObject> Handle(string? line) =>
        (JsonObject)JsonNode.Parse(await _agent.Commands.HandleLineAsync(line, CancellationToken.None))!;

    [Fact]
    public async Task Status_ReturnsStatus_AndIsAudited()
    {
        var r = await Handle("""{"cmd":"status"}""");
        Assert.True(r["ok"]!.GetValue<bool>());
        Assert.True(r["running"]!.GetValue<bool>());
        Assert.Single(_agent.AuditLines(), l => l.Contains("\tmcp-pipe-command\t") && l.Contains("Claude (MCP)") && l.Contains("status ok"));
    }

    [Theory]
    [InlineData("""{"cmd":"approve"}""", "unknown-command")]
    [InlineData("""{"cmd":"Status"}""", "unknown-command")]
    [InlineData("""{"cmd":"capture"}""", "unknown-command")]
    [InlineData("""{"cmd":5}""", "bad-request")]
    [InlineData("""{}""", "bad-request")]
    [InlineData("""["status"]""", "bad-request")]
    [InlineData("not json", "bad-request")]
    [InlineData(null, "bad-request")]
    public async Task BadOrUnknownCommands_AreRejected_AndAudited(string? line, string error)
    {
        var r = await Handle(line);
        Assert.False(r["ok"]!.GetValue<bool>());
        Assert.Equal(error, r["error"]!.GetValue<string>());
        Assert.Equal(0, _agent.PairingTriggered);
        Assert.Single(_agent.AuditLines(), l => l.Contains("\tmcp-pipe-rejected\t") && l.Contains(error));
    }

    [Fact]
    public async Task OversizedLine_IsRejected_WithoutParsing_AndAudited()
    {
        _agent.McpAllowed = true;
        var big = """{"cmd":"pairing-code","pad":" """ + new string('x', AgentPipeProtocol.MaxMessageBytes) + "\"}";
        var r = await Handle(big);
        Assert.Equal("too-large", r["error"]!.GetValue<string>());
        Assert.Equal(0, _agent.PairingTriggered);
        Assert.Single(_agent.AuditLines(), l => l.Contains("mcp-pipe-rejected") && l.Contains("too-large"));

        var r2 = await _agent.Commands.HandleAsync(null, tooLarge: true, CancellationToken.None);
        Assert.Equal("too-large", r2["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task PairingCode_Disabled_RefusedWithoutTrigger()
    {
        _agent.McpAllowed = false;
        var r = await Handle("""{"cmd":"pairing-code"}""");
        Assert.Equal("mcp-disabled", r["error"]!.GetValue<string>());
        Assert.Equal(0, _agent.PairingTriggered);
        Assert.Single(_agent.AuditLines(), l => l.Contains("pairing-code refused: mcp-disabled"));
    }

    [Fact]
    public async Task PairingCode_TogglesAreReadPerRequest()
    {
        _agent.McpAllowed = true;
        Assert.True((await Handle("""{"cmd":"pairing-code"}"""))["ok"]!.GetValue<bool>());
        _agent.McpAllowed = false;
        Assert.False((await Handle("""{"cmd":"pairing-code"}"""))["ok"]!.GetValue<bool>());
        Assert.Equal(1, _agent.PairingTriggered);
        Assert.Equal(2, _agent.AuditLines().Count(l => l.Contains("mcp-pipe-command")));
    }

    [Fact]
    public async Task HandlerException_BecomesErrorReply_AndIsAudited()
    {
        using var d = new TempDir();
        var audit = new AuditLog(d.File("a.log"));
        var cmds = new AgentPipeCommands(audit, () => true, () => throw new InvalidOperationException("boom"),
            _ => throw new InvalidOperationException("boom2"));
        var r = (JsonObject)JsonNode.Parse(await cmds.HandleLineAsync("""{"cmd":"status"}""", default))!;
        Assert.Equal("internal-error", r["error"]!.GetValue<string>());
        Assert.Contains(File.ReadAllLines(audit.FilePath), l => l.Contains("status refused: internal-error"));
    }

    [Fact]
    public async Task ReadLine_StopsAtNewline_AndFlagsOversize()
    {
        var (line, big) = await AgentPipeProtocol.ReadLineAsync(new MemoryStream("{\"cmd\":\"status\"}\r\nextra"u8.ToArray()), 4096, default);
        Assert.Equal("{\"cmd\":\"status\"}", line);
        Assert.False(big);

        var huge = new byte[5000]; Array.Fill(huge, (byte)'a');
        (line, big) = await AgentPipeProtocol.ReadLineAsync(new MemoryStream(huge), 4096, default);
        Assert.Null(line);
        Assert.True(big);

        (line, big) = await AgentPipeProtocol.ReadLineAsync(new MemoryStream(), 4096, default);
        Assert.Null(line);
        Assert.False(big);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("{\"ok\":true}", false)]
    [InlineData("nope", true)]
    [InlineData("[1]", true)]
    public void ParseReply_NeverThrows(string? line, bool expectError)
    {
        var r = AgentPipeProtocol.ParseReply(line, false);
        if (line == null) Assert.Equal("bad-reply", r["error"]!.GetValue<string>());
        else Assert.Equal(expectError, r["error"] != null);
        Assert.Equal("bad-reply", AgentPipeProtocol.ParseReply("{}", tooLarge: true)["error"]!.GetValue<string>());
    }
}

public class McpSettingsTests
{
    [Fact]
    public void McpEnabled_DefaultsOff()
    {
        Assert.False(new AgentSettings().McpEnabled);
        using var d = new TempDir();
        Assert.False(AgentSettings.Load(d.File("missing.json")).McpEnabled);
        File.WriteAllText(d.File("old.json"), """{"ServerUrl":"wss://x.test/remote/ws","DeviceName":"PC"}""");
        Assert.False(AgentSettings.Load(d.File("old.json")).McpEnabled);
        File.WriteAllText(d.File("bad.json"), "{corrupt");
        Assert.False(AgentSettings.Load(d.File("bad.json")).McpEnabled);
    }

    [Fact]
    public void McpEnabled_Persists()
    {
        using var d = new TempDir();
        var path = d.File("settings.json");
        new AgentSettings { McpEnabled = true }.Save(path);
        Assert.True(AgentSettings.Load(path).McpEnabled);
        var s = AgentSettings.Load(path);
        s.McpEnabled = false;
        s.Save(path);
        Assert.False(AgentSettings.Load(path).McpEnabled);
    }
}

/// <summary>Real pipe round trips: the client and the accept loop, over an injected pipe.</summary>
public class AgentPipeRoundTripTests
{
    private static async Task<JsonObject?> SendWithRetry(AgentPipeClient client, string cmd)
    {
        for (int i = 0; i < 20; i++)
        {
            var r = await client.SendAsync(cmd, TimeSpan.FromSeconds(5), default);
            if (r != null) return r;
            await Task.Delay(100);
        }
        return null;
    }

    [Fact]
    public async Task PlainPipe_StatusAndPairingRefusal_RoundTrip()
    {
        // No ACL off Windows (pipe ACLs are Windows-only). On Windows the client only talks to a pipe owned by the
        // user SID, and a plain pipe's owner is the token's default owner (Administrators when elevated, e.g. on CI),
        // so use the production security there; production always uses CurrentUserOnlySecurity.
        using var agent = new FakeAgent();
        var name = "grc-test-" + Guid.NewGuid().ToString("N")[..12];
        using var server = new AgentPipeServer(name, agent.Commands, agent.Audit,
            () => OperatingSystem.IsWindows()
                ? NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 4, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, AgentPipeServer.CurrentUserOnlySecurity())
                : new NamedPipeServerStream(name, PipeDirection.InOut, 4, PipeTransmissionMode.Byte, PipeOptions.Asynchronous));
        server.Start();
        var client = new AgentPipeClient(name, null);

        var status = await SendWithRetry(client, "status");
        Assert.NotNull(status);
        Assert.True(status!["running"]!.GetValue<bool>());

        var pair = await SendWithRetry(client, "pairing-code");
        Assert.Equal("mcp-disabled", pair!["error"]!.GetValue<string>());
        Assert.Equal(0, agent.PairingTriggered);

        // Through the MCP server too.
        var mcp = new McpStdioServer(client);
        var reply = await mcp.HandleLineAsync("""{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_status"}}""", default);
        Assert.Equal("HOME-PC", JsonNode.Parse(reply!)!["result"]!["structuredContent"]!["deviceName"]!.GetValue<string>());
    }

    [Fact]
    public async Task NoPipe_IsNotRunning()
    {
        var client = new AgentPipeClient("grc-test-absent-" + Guid.NewGuid().ToString("N")[..12], null);
        Assert.Null(await client.SendAsync("status", TimeSpan.FromSeconds(1), default));
    }

    [WindowsFact]
    public void PipeName_IsPerUserSid()
    {
        using var id = WindowsIdentity.GetCurrent();
        Assert.Equal("GlobalRemoteControl-" + id.User!.Value, AgentPipeProtocol.PipeNameForCurrentUser());
    }

    [WindowsFact]
    public void PipeAcl_AllowsOnlyCurrentUser_NoInheritance()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var id = WindowsIdentity.GetCurrent();
        var sec = AgentPipeServer.CurrentUserOnlySecurity();
        Assert.True(sec.AreAccessRulesProtected);
        var rules = sec.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<PipeAccessRule>().ToList();
        var rule = Assert.Single(rules);
        Assert.Equal(id.User, rule.IdentityReference);
        Assert.Equal(AccessControlType.Allow, rule.AccessControlType);
        Assert.Equal(id.User, sec.GetOwner(typeof(SecurityIdentifier)));
    }

    [WindowsFact]
    public async Task AclPipe_RoundTrip_ProductionConstructor()
    {
        using var agent = new FakeAgent { McpAllowed = true };
        var name = "GlobalRemoteControl-test-" + Guid.NewGuid().ToString("N")[..12];
        using var server = new AgentPipeServer(name, agent.Commands, agent.Audit);
        server.Start();
        var client = new AgentPipeClient(name, null);
        var r = await SendWithRetry(client, "pairing-code");
        Assert.True(r != null, "no reply from the ACL'd pipe (client refused it or the server could not create it)");
        Assert.True(r!["code"] != null, "unexpected reply: " + r.ToJsonString());
        Assert.Equal("123456", r["code"]!.GetValue<string>());
        Assert.Equal(1, agent.PairingTriggered);
    }

    [WindowsFact]
    public void Client_AcceptsOnlyPipesOwnedByTheUserSid_NotTheTokenDefaultOwner()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var id = WindowsIdentity.GetCurrent();
        // what the tray app creates: owner = user SID (also when it runs elevated)
        Assert.True(AgentPipeClient.OwnedByCurrentUser(AgentPipeServer.CurrentUserOnlySecurity()));
        // a pipe someone else created under our name
        foreach (var other in new[] { WellKnownSidType.WorldSid, WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.LocalSystemSid })
        {
            var sec = new PipeSecurity();
            sec.SetOwner(new SecurityIdentifier(other, null));
            Assert.False(AgentPipeClient.OwnedByCurrentUser(sec), other.ToString());
        }
        Assert.False(AgentPipeClient.OwnedByCurrentUser(null));
    }
}
