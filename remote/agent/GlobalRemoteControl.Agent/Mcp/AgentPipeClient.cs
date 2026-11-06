using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json.Nodes;

namespace GlobalRemoteControl.Agent.Mcp;

/// <summary>What the MCP server needs from the outside world (faked in tests).</summary>
public interface IAgentBridge
{
    /// <summary>Sends one pipe command; null when the tray app isn't running (no pipe).</summary>
    Task<JsonObject?> SendAsync(string cmd, TimeSpan timeout, CancellationToken ct);

    /// <summary>Starts the visible tray app (this exe with <c>--tray</c>). Returns an error message or null.</summary>
    string? Launch();
}

/// <summary>The <c>--mcp</c> process's side of the pipe, plus launching the tray app.</summary>
public sealed class AgentPipeClient : IAgentBridge
{
    private readonly string _pipeName;
    private readonly string? _serverUrl;

    /// <param name="serverUrl">Forwarded to a launched tray app as <c>--server</c> (validated by the caller).</param>
    public AgentPipeClient(string pipeName, string? serverUrl)
    {
        _pipeName = pipeName; _serverUrl = serverUrl;
    }

    public async Task<JsonObject?> SendAsync(string cmd, TimeSpan timeout, CancellationToken ct)
    {
        // CurrentUserOnly: refuse to talk to a pipe that someone else created under our name.
        using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        try { await pipe.ConnectAsync(TimeSpan.FromMilliseconds(800), ct).ConfigureAwait(false); }
        catch (TimeoutException) { return null; }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }

        // The pipe exists from here on: every failure is a reply-level error object, never null ("not running" would
        // make open_agent start a second copy) and never an exception (that would surface as a JSON-RPC internal error).
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        try
        {
            await AgentPipeProtocol.WriteLineAsync(pipe, new JsonObject { ["cmd"] = cmd }, cts.Token).ConfigureAwait(false);
            var (line, tooLarge) = await AgentPipeProtocol.ReadLineAsync(pipe, AgentPipeProtocol.MaxMessageBytes, cts.Token).ConfigureAwait(false);
            return AgentPipeProtocol.ParseReply(line, tooLarge);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return AgentPipeProtocol.Error("timeout", $"GlobalRemoteControl did not answer within {timeout.TotalSeconds:0} s.");
        }
        catch (IOException)
        {
            return AgentPipeProtocol.Error("bad-reply", "The connection to GlobalRemoteControl broke.");
        }
    }

    public string? Launch()
    {
        var exe = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exe)) return "Cannot find this program's path.";
        // UseShellExecute: the tray app must not inherit this process's stdio pipes (the MCP client waits for them to close).
        var psi = new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" };
        psi.ArgumentList.Add("--tray");
        if (_serverUrl != null) { psi.ArgumentList.Add("--server"); psi.ArgumentList.Add(_serverUrl); }
        try { using var p = Process.Start(psi); return null; }
        catch (Exception ex) { return "Could not start GlobalRemoteControl: " + ex.Message; }
    }
}
