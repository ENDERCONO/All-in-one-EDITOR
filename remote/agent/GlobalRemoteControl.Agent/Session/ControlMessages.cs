using System.Text.Json;
using System.Text.RegularExpressions;
using GlobalRemoteControl.Agent.Signaling;

namespace GlobalRemoteControl.Agent.Session;

public enum MouseButton { Left, Right, Middle }

public abstract record ControlMessage;
public sealed record MouseMoveMsg(double X, double Y) : ControlMessage;
public sealed record MouseButtonMsg(MouseButton Button, bool Down, double? X, double? Y) : ControlMessage;
public sealed record WheelMsg(int Dx, int Dy) : ControlMessage;
public sealed record KeyMsg(string Code, bool Down) : ControlMessage;
public sealed record TextMsg(string Text) : ControlMessage;
public sealed record SelectMonitorMsg(int Index) : ControlMessage;
public sealed record QualityMsg(int Fps, int Quality, double Scale) : ControlMessage;
public sealed record AudioMsg(bool Enabled) : ControlMessage;
public sealed record AckMsg(uint FrameId) : ControlMessage;
public sealed record FileOfferMsg(string Id, string Name, long Size) : ControlMessage;
public sealed record FileEndMsg(string Id, string Sha256) : ControlMessage;
public sealed record FileCancelMsg(string Id) : ControlMessage;
public sealed record FileAcceptMsg(string Id) : ControlMessage;
public sealed record FileRejectMsg(string Id, string Reason) : ControlMessage;

/// <summary>
/// Strict parser for controller → agent control-channel messages (PROTOCOL.md section 5).
/// Anything malformed or out of range returns null with a reason (the caller logs it and ignores the message).
/// Only the wheel deltas are clamped, as the contract specifies.
/// </summary>
public static partial class ControlMessageParser
{
    public const int WheelLimit = 1200;
    public const int MaxText = 256;
    public const long MaxFileSize = 2L * 1024 * 1024 * 1024;

    [GeneratedRegex("^[A-Za-z0-9]{1,32}$")] private static partial Regex CodeRegex();
    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")] private static partial Regex FileIdRegex();
    [GeneratedRegex("^[0-9a-fA-F]{64}$")] private static partial Regex Sha256Regex();

    public static ControlMessage? Parse(string text, out string? error)
    {
        error = null;
        if (!Json.TryParseObject(text, "t", out var m, out var t)) { error = "not a JSON object with t"; return null; }
        var result = ParseTyped(t, m);
        if (result == null) error = $"invalid '{Truncate(t)}' message";
        return result;
    }

    private static ControlMessage? ParseTyped(string t, JsonElement m)
    {
        switch (t)
        {
            case "mouse-move":
            {
                var x = Unit(m, "x"); var y = Unit(m, "y");
                return x != null && y != null ? new MouseMoveMsg(x.Value, y.Value) : null;
            }
            case "mouse-button":
            {
                MouseButton? b = Json.Str(m, "button", 8) switch
                {
                    "left" => MouseButton.Left, "right" => MouseButton.Right, "middle" => MouseButton.Middle, _ => null,
                };
                var down = Json.Bool(m, "down");
                if (b == null || down == null) return null;
                bool hasX = Json.Has(m, "x"), hasY = Json.Has(m, "y");
                if (hasX != hasY) return null;
                double? x = null, y = null;
                if (hasX)
                {
                    x = Unit(m, "x"); y = Unit(m, "y");
                    if (x == null || y == null) return null;
                }
                return new MouseButtonMsg(b.Value, down.Value, x, y);
            }
            case "wheel":
            {
                var dx = Json.Int(m, "dx") ?? (Json.Has(m, "dx") ? null : 0);
                var dy = Json.Int(m, "dy") ?? (Json.Has(m, "dy") ? null : 0);
                if (dx == null || dy == null) return null;
                return new WheelMsg((int)Math.Clamp(dx.Value, -WheelLimit, WheelLimit), (int)Math.Clamp(dy.Value, -WheelLimit, WheelLimit));
            }
            case "key":
            {
                var code = Json.Str(m, "code", 32, 1);
                var down = Json.Bool(m, "down");
                return code != null && down != null && CodeRegex().IsMatch(code) ? new KeyMsg(code, down.Value) : null;
            }
            case "text":
            {
                var text = Json.Str(m, "text", MaxText, 1);
                return text != null ? new TextMsg(text) : null;
            }
            case "select-monitor":
            {
                var i = Json.Int(m, "index");
                return i is >= 0 and < 32 ? new SelectMonitorMsg((int)i) : null;
            }
            case "quality":
            {
                var fps = Json.Int(m, "fps"); var q = Json.Int(m, "quality"); var s = Json.Num(m, "scale");
                if (fps is not (>= 1 and <= 30) || q is not (>= 10 and <= 95) || s is not (>= 0.25 and <= 1)) return null;
                return new QualityMsg((int)fps, (int)q, s.Value);
            }
            case "audio":
            {
                var e = Json.Bool(m, "enabled");
                return e != null ? new AudioMsg(e.Value) : null;
            }
            case "ack":
            {
                var f = Json.Int(m, "frameId");
                return f is >= 0 and <= uint.MaxValue ? new AckMsg((uint)f) : null;
            }
            case "file-offer":
            {
                var id = FileId(m); var name = Json.Str(m, "name", 1024, 1); var size = Json.Int(m, "size");
                if (id == null || name == null || size is not (>= 0 and <= 9_000_000_000_000_000)) return null; // cap enforced (with a reply) by the transfer manager
                return new FileOfferMsg(id, name, size.Value);
            }
            case "file-end":
            {
                var id = FileId(m); var sha = Json.Str(m, "sha256", 64, 64);
                return id != null && sha != null && Sha256Regex().IsMatch(sha) ? new FileEndMsg(id, sha.ToLowerInvariant()) : null;
            }
            case "file-cancel":
            {
                var id = FileId(m);
                return id != null ? new FileCancelMsg(id) : null;
            }
            case "file-accept":
            {
                var id = FileId(m);
                return id != null ? new FileAcceptMsg(id) : null;
            }
            case "file-reject":
            {
                var id = FileId(m);
                return id != null ? new FileRejectMsg(id, Json.Str(m, "reason", 200) ?? "rejected") : null;
            }
            default:
                return null;
        }
    }

    private static double? Unit(JsonElement m, string name)
    {
        var v = Json.Num(m, name);
        return v is >= 0 and <= 1 ? v : null;
    }

    private static string? FileId(JsonElement m)
    {
        var id = Json.Str(m, "id", 64, 1);
        return id != null && FileIdRegex().IsMatch(id) ? id : null;
    }

    private static string Truncate(string s) => s.Length > 32 ? s[..32] : s;
}
