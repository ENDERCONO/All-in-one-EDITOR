using System.Text;

namespace GlobalRemoteControl.Agent.FileTransfer;

/// <summary>Makes a remote-supplied file name safe to suggest in a Save dialog: no paths, no reserved names.</summary>
public static class FileNameSanitizer
{
    public const int MaxLength = 200;

    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    public static string Sanitize(string? name)
    {
        var s = name ?? "";
        // Drop any directory part (both separators), then strip characters Windows does not allow.
        int cut = Math.Max(s.LastIndexOf('/'), s.LastIndexOf('\\'));
        if (cut >= 0) s = s[(cut + 1)..];
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            if (char.IsControl(c) || invalid.Contains(c) || c is ':' or '*' or '?' or '"' or '<' or '>' or '|') sb.Append('_');
            else if (char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format) continue; // RLO etc.
            else sb.Append(c);
        }
        s = sb.ToString().Trim().TrimEnd('.', ' ').TrimStart('.', ' ');
        if (s.Length == 0) s = "file";

        var stem = Path.GetFileNameWithoutExtension(s);
        var ext = Path.GetExtension(s);
        var device = s.Split('.')[0].TrimEnd();
        if (Reserved.Contains(device) || Reserved.Contains(stem.TrimEnd()) || Reserved.Contains(s)) { stem = "_" + stem; s = stem + ext; }
        if (s.Length > MaxLength)
        {
            if (ext.Length > 20) ext = "";
            s = stem[..Math.Min(stem.Length, MaxLength - ext.Length)] + ext;
        }
        return s;
    }
}
