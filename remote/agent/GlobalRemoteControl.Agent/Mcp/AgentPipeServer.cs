using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json.Nodes;
using GlobalRemoteControl.Agent.Audit;

namespace GlobalRemoteControl.Agent.Mcp;

/// <summary>
/// Named pipe in the tray app (<c>\\.\pipe\GlobalRemoteControl-&lt;SID&gt;</c>). The ACL allows only the current
/// user; each connection sends one request line (≤ 4 KB) and gets one response line.
/// </summary>
public sealed class AgentPipeServer : IDisposable
{
    private const int MaxInstances = 4;
    private static readonly TimeSpan ReadTimeout = TimeSpan.FromSeconds(5);

    private readonly string _pipeName;
    private readonly AgentPipeCommands _commands;
    private readonly AuditLog _audit;
    private readonly CancellationTokenSource _cts = new();

    private readonly Func<NamedPipeServerStream> _createPipe;

    public AgentPipeServer(string pipeName, AgentPipeCommands commands, AuditLog audit)
        : this(pipeName, commands, audit, createPipe: null) { }

    /// <param name="createPipe">Tests only (non-Windows has no pipe ACLs); production always uses the current-user ACL.</param>
    internal AgentPipeServer(string pipeName, AgentPipeCommands commands, AuditLog audit, Func<NamedPipeServerStream>? createPipe)
    {
        _pipeName = pipeName; _commands = commands; _audit = audit;
        _createPipe = createPipe ?? (() => NamedPipeServerStreamAcl.Create(_pipeName, PipeDirection.InOut, MaxInstances,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous, AgentPipeProtocol.MaxMessageBytes, AgentPipeProtocol.MaxMessageBytes,
            CurrentUserOnlySecurity()));
    }

    public string PipeName => _pipeName;

    public void Start()
    {
        for (int i = 0; i < 2; i++) _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    internal static PipeSecurity CurrentUserOnlySecurity()
    {
        using var id = WindowsIdentity.GetCurrent();
        var sec = new PipeSecurity();
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        sec.AddAccessRule(new PipeAccessRule(id.User!, PipeAccessRights.FullControl, AccessControlType.Allow));
        sec.SetOwner(id.User!);
        return sec;
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        int failures = 0;
        while (!ct.IsCancellationRequested)
        {
            NamedPipeServerStream pipe;
            try { pipe = _createPipe(); }
            catch (Exception ex)
            {
                if (++failures == 1) _audit.Write("mcp-pipe-error", details: "create: " + ex.Message);
                try { await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, failures)), ct); } catch (OperationCanceledException) { return; }
                continue;
            }
            failures = 0;
            try
            {
                await pipe.WaitForConnectionAsync(ct).ConfigureAwait(false);
                await ServeAsync(pipe, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { _audit.Write("mcp-pipe-error", details: ex.Message); }
            finally { pipe.Dispose(); }
        }
    }

    private async Task ServeAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        using var readCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        readCts.CancelAfter(ReadTimeout);
        var (line, tooLarge) = await AgentPipeProtocol.ReadLineAsync(pipe, AgentPipeProtocol.MaxMessageBytes, readCts.Token).ConfigureAwait(false);
        if (line == null && !tooLarge) return; // client went away without a request
        JsonObject reply = await _commands.HandleAsync(line, tooLarge, ct).ConfigureAwait(false);
        await AgentPipeProtocol.WriteLineAsync(pipe, reply, ct).ConfigureAwait(false);
        try { pipe.WaitForPipeDrain(); } catch (IOException) { } catch (PlatformNotSupportedException) { }
    }

    public void Dispose()
    {
        try { _cts.Cancel(); } catch (ObjectDisposedException) { }
    }
}
