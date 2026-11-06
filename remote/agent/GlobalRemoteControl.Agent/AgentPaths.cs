namespace GlobalRemoteControl.Agent;

/// <summary>All agent state lives in %LOCALAPPDATA%\GlobalRemoteControl (overridable for tests).</summary>
public sealed class AgentPaths
{
    public AgentPaths(string? baseDir = null)
    {
        BaseDir = baseDir ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GlobalRemoteControl");
        Directory.CreateDirectory(BaseDir);
    }

    public string BaseDir { get; }
    public string DeviceKeyFile => Path.Combine(BaseDir, "device-key.bin");
    public string TrustedControllersFile => Path.Combine(BaseDir, "trusted-controllers.json");
    public string SettingsFile => Path.Combine(BaseDir, "settings.json");
    public string AuditLogFile => Path.Combine(BaseDir, "audit.log");
    public string McpFile => Path.Combine(BaseDir, "mcp.json");

    /// <summary>Writes a file via a temp file + replace so a crash never leaves a half-written file.</summary>
    public static void WriteAtomic(string path, string contents)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, contents);
        File.Move(tmp, path, overwrite: true);
    }
}
