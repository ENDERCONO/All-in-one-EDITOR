using System.Text.Json;
using System.Text.RegularExpressions;

namespace GlobalRemoteControl.Agent.Signaling;

/// <summary>Defensive accessors for untrusted JSON (signaling messages and control-channel messages).</summary>
public static partial class Json
{
    public const int MaxMessageBytes = 64 * 1024;

    /// <summary>Parses a JSON object with a string discriminator field (<paramref name="typeField"/>).</summary>
    public static bool TryParseObject(string? text, string typeField, out JsonElement root, out string type)
    {
        root = default; type = "";
        if (string.IsNullOrEmpty(text) || text.Length > MaxMessageBytes) return false;
        try
        {
            using var doc = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 16 });
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty(typeField, out var t) || t.ValueKind != JsonValueKind.String) return false;
            type = t.GetString()!;
            if (type.Length > 64) return false;
            root = doc.RootElement.Clone();
            return true;
        }
        catch (JsonException) { return false; }
    }

    public static string? Str(JsonElement o, string name, int maxLen, int minLen = 0)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString()!;
        return s.Length < minLen || s.Length > maxLen ? null : s;
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
    }

    /// <summary>Finite number or null.</summary>
    public static double? Num(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number) return null;
        if (!v.TryGetDouble(out var d) || !double.IsFinite(d)) return null;
        return d;
    }

    /// <summary>Integral number (no fraction) within long range, or null.</summary>
    public static long? Int(JsonElement o, string name)
    {
        var d = Num(o, name);
        if (d == null || Math.Floor(d.Value) != d.Value || Math.Abs(d.Value) > 9.0e15) return null;
        return (long)d.Value;
    }

    public static bool Has(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null;

    public static JsonElement? Obj(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? v : null;

    [GeneratedRegex(@"^[A-Za-z0-9_-]{22}\z")]
    private static partial Regex IdRegex();

    /// <summary>deviceId / controllerId / sessionId: 22 base64url chars.</summary>
    public static bool IsId(string? s) => s != null && IdRegex().IsMatch(s);

    public static string Serialize(object o) => JsonSerializer.Serialize(o);
}
