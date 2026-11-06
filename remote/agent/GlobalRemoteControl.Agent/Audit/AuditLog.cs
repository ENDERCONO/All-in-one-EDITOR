using System.Globalization;
using System.Text;

namespace GlobalRemoteControl.Agent.Audit;

/// <summary>
/// Append-only audit log: one line per event, tab separated: UTC time, event, actor "name (id)", details.
/// </summary>
public sealed class AuditLog
{
    private readonly object _lock = new();

    public AuditLog(string path) => FilePath = path;

    public string FilePath { get; }

    public void Write(string evt, string? actorName = null, string? actorId = null, string? details = null)
    {
        var actor = actorName == null && actorId == null ? "-" : $"{Clean(actorName ?? "?")} ({Clean(actorId ?? "?")})";
        var line = string.Join('\t',
            DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture),
            Clean(evt), actor, Clean(details ?? "")) + Environment.NewLine;
        lock (_lock)
        {
            try
            {
                using var fs = new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                var bytes = Encoding.UTF8.GetBytes(line);
                fs.Write(bytes, 0, bytes.Length);
            }
            catch (IOException) { /* never crash the agent because of logging */ }
            catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>Strips control characters so remote-supplied text cannot forge extra log lines/columns.</summary>
    internal static string Clean(string s)
    {
        var sb = new StringBuilder(Math.Min(s.Length, 512));
        foreach (var c in s)
        {
            if (sb.Length >= 512) { sb.Append('…'); break; }
            sb.Append(char.IsControl(c) ? ' ' : c);
        }
        return sb.ToString();
    }
}
