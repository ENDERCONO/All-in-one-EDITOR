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
        // Refuse to talk to a pipe that someone else created under our name. On Windows we check the owner ourselves:
        // PipeOptions.CurrentUserOnly compares it with the token's *default owner*, which in an elevated process is
        // BUILTIN\Administrators, not the user, so an elevated client would reject the real tray app's pipe (owned by
        // the user SID, see AgentPipeServer.CurrentUserOnlySecurity) and report "not running".
        var options = PipeOptions.Asynchronous | (OperatingSystem.IsWindows() ? PipeOptions.None : PipeOptions.CurrentUserOnly);
        using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut, options);
        try { await pipe.ConnectAsync(TimeSpan.FromMilliseconds(800), ct).ConfigureAwait(false); }
        catch (TimeoutException) { return null; }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
        if (OperatingSystem.IsWindows() && !OwnedByCurrentUser(GetSecurity(pipe))) return null;

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

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static PipeSecurity? GetSecurity(NamedPipeClientStream pipe)
    {
        try { return pipe.GetAccessControl(); } catch (Exception) { return null; }
    }

    /// <summary>True only when the pipe's owner is this Windows user's SID (elevated or not).</summary>
    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    internal static bool OwnedByCurrentUser(PipeSecurity? sec)
    {
        if (sec == null) return false;
        using var id = System.Security.Principal.WindowsIdentity.GetCurrent();
        return sec.GetOwner(typeof(System.Security.Principal.SecurityIdentifier)) is System.Security.Principal.SecurityIdentifier owner
            && owner == id.User;
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
