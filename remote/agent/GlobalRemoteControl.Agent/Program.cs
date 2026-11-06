using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Settings;
using GlobalRemoteControl.Agent.Ui;

namespace GlobalRemoteControl.Agent;

static class Program
{
    private const string MutexName = @"Local\GlobalRemoteControl.Agent.SingleInstance";
    private const string ShowEventName = @"Local\GlobalRemoteControl.Agent.ShowWindow";

    /// <summary>Command line: [--server ws(s)://host/remote/ws] [--tray]</summary>
    internal sealed record Options(string? Server, bool StartHidden, string? Error);

    internal static Options ParseArgs(string[] args)
    {
        string? server = null, error = null;
        bool hidden = false;
        for (int i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (a == "--tray") hidden = true;
            else if (a == "--server" && i + 1 < args.Length) server = args[++i];
            else if (a.StartsWith("--server=", StringComparison.Ordinal)) server = a["--server=".Length..];
        }
        if (server != null && !AgentSettings.IsValidServerUrl(server))
        {
            error = $"Ignoring --server \"{server}\": it must be a ws:// or wss:// URL.";
            server = null;
        }
        return new Options(server, hidden, error);
    }

    [STAThread]
    static void Main(string[] args)
    {
        using var mutex = new Mutex(initiallyOwned: true, MutexName, out bool first);
        if (!first)
        {
            // Already running: ask that instance to show its window, then quit.
            try { using var ev = EventWaitHandle.OpenExisting(ShowEventName); ev.Set(); } catch (Exception) { }
            return;
        }
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

        var paths = new AgentPaths();
        var audit = new AuditLog(paths.AuditLogFile);
        Application.ThreadException += (_, e) => audit.Write("error", details: "UI thread: " + Describe(e.Exception));
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            audit.Write("fatal", details: (e.IsTerminating ? "terminating: " : "") + Describe(e.ExceptionObject as Exception));
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            audit.Write("error", details: "unobserved task: " + Describe(e.Exception));
            e.SetObserved();
        };

        var options = ParseArgs(args);
        if (options.Error != null) audit.Write("bad-argument", details: options.Error);

        using var ui = new UiDispatcher();
        AgentHost host;
        try { host = new AgentHost(paths, audit, new WinFormsPrompts(ui), options.Server); }
        catch (Exception ex)
        {
            audit.Write("fatal", details: "startup: " + Describe(ex));
            MessageBox.Show("GlobalRemoteControl could not start:\n\n" + ex.Message, "GlobalRemoteControl",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        using (host)
        {
            var context = new TrayApplicationContext(host, ui, options.StartHidden);
            var wait = ThreadPool.RegisterWaitForSingleObject(showEvent, (_, _) => context.BringToFront(), null, Timeout.Infinite, executeOnlyOnce: false);
            try
            {
                host.Start();
                Application.Run(context);
            }
            finally { wait.Unregister(null); }
        }
        GC.KeepAlive(mutex);
    }

    private static string Describe(Exception? ex) =>
        ex == null ? "unknown" : $"{ex.GetType().Name}: {ex.Message} @ {ex.StackTrace?.Split('\n').FirstOrDefault()?.Trim()}";
}
