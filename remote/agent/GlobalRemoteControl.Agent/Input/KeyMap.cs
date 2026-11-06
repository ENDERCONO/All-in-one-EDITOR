namespace GlobalRemoteControl.Agent.Input;

public readonly record struct KeyInfo(ushort Vk, ushort Scan, bool Extended);

/// <summary>KeyboardEvent.code (physical key) → Windows virtual key + set-1 scan code (+ extended flag).</summary>
public static class KeyMap
{
    public const ushort VK_SHIFT_L = 0xA0, VK_SHIFT_R = 0xA1, VK_CONTROL_L = 0xA2, VK_CONTROL_R = 0xA3,
        VK_ALT_L = 0xA4, VK_ALT_R = 0xA5, VK_F12 = 0x7B;

    private static readonly Dictionary<string, KeyInfo> Map = Build();

    public static bool TryGet(string code, out KeyInfo info) => Map.TryGetValue(code, out info);

    public static IReadOnlyCollection<string> Codes => Map.Keys;

    private static Dictionary<string, KeyInfo> Build()
    {
        var m = new Dictionary<string, KeyInfo>(StringComparer.Ordinal);
        void K(string code, int vk, int scan, bool ext = false) => m[code] = new KeyInfo((ushort)vk, (ushort)scan, ext);

        // Letters
        var letterScans = new[] { 0x1E, 0x30, 0x2E, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32,
                                  0x31, 0x18, 0x19, 0x10, 0x13, 0x1F, 0x14, 0x16, 0x2F, 0x11, 0x2D, 0x15, 0x2C };
        for (int i = 0; i < 26; i++) K("Key" + (char)('A' + i), 'A' + i, letterScans[i]);
        // Digit row
        for (int d = 1; d <= 9; d++) K("Digit" + d, '0' + d, 0x01 + d);
        K("Digit0", '0', 0x0B);
        // Function keys
        for (int f = 1; f <= 10; f++) K("F" + f, 0x6F + f, 0x3A + f);
        K("F11", 0x7A, 0x57); K("F12", 0x7B, 0x58);
        var fHigh = new[] { 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x76 };
        for (int f = 13; f <= 24; f++) K("F" + f, 0x7C + (f - 13), fHigh[f - 13]);

        K("Escape", 0x1B, 0x01); K("Backquote", 0xC0, 0x29); K("Minus", 0xBD, 0x0C); K("Equal", 0xBB, 0x0D);
        K("Backspace", 0x08, 0x0E); K("Tab", 0x09, 0x0F); K("BracketLeft", 0xDB, 0x1A); K("BracketRight", 0xDD, 0x1B);
        K("Backslash", 0xDC, 0x2B); K("CapsLock", 0x14, 0x3A); K("Semicolon", 0xBA, 0x27); K("Quote", 0xDE, 0x28);
        K("Enter", 0x0D, 0x1C); K("Comma", 0xBC, 0x33); K("Period", 0xBE, 0x34); K("Slash", 0xBF, 0x35);
        K("Space", 0x20, 0x39); K("IntlBackslash", 0xE2, 0x56); K("IntlRo", 0xC1, 0x73);

        // Modifiers
        K("ShiftLeft", VK_SHIFT_L, 0x2A); K("ShiftRight", VK_SHIFT_R, 0x36);
        K("ControlLeft", VK_CONTROL_L, 0x1D); K("ControlRight", VK_CONTROL_R, 0x1D, true);
        K("AltLeft", VK_ALT_L, 0x38); K("AltRight", VK_ALT_R, 0x38, true);
        K("MetaLeft", 0x5B, 0x5B, true); K("MetaRight", 0x5C, 0x5C, true); K("ContextMenu", 0x5D, 0x5D, true);

        // Navigation block (extended)
        K("Insert", 0x2D, 0x52, true); K("Delete", 0x2E, 0x53, true); K("Home", 0x24, 0x47, true); K("End", 0x23, 0x4F, true);
        K("PageUp", 0x21, 0x49, true); K("PageDown", 0x22, 0x51, true);
        K("ArrowUp", 0x26, 0x48, true); K("ArrowDown", 0x28, 0x50, true); K("ArrowLeft", 0x25, 0x4B, true); K("ArrowRight", 0x27, 0x4D, true);
        K("PrintScreen", 0x2C, 0x37, true); K("ScrollLock", 0x91, 0x46); K("Pause", 0x13, 0);

        // Numpad
        K("NumLock", 0x90, 0x45, true); K("NumpadDivide", 0x6F, 0x35, true); K("NumpadMultiply", 0x6A, 0x37);
        K("NumpadSubtract", 0x6D, 0x4A); K("NumpadAdd", 0x6B, 0x4E); K("NumpadEnter", 0x0D, 0x1C, true); K("NumpadDecimal", 0x6E, 0x53);
        var numScans = new[] { 0x52, 0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47, 0x48, 0x49 };
        for (int n = 0; n <= 9; n++) K("Numpad" + n, 0x60 + n, numScans[n]);

        // Media (extended)
        K("AudioVolumeMute", 0xAD, 0x20, true); K("AudioVolumeDown", 0xAE, 0x2E, true); K("AudioVolumeUp", 0xAF, 0x30, true);
        K("MediaPlayPause", 0xB3, 0x22, true); K("MediaStop", 0xB2, 0x24, true);
        K("MediaTrackNext", 0xB0, 0x19, true); K("MediaTrackPrevious", 0xB1, 0x10, true);
        return m;
    }

    /// <summary>Maps friendly names used in MCP combos ("Control+C", "Alt+Tab") to codes.</summary>
    public static string? ResolveComboPart(string part)
    {
        var p = part.Trim();
        if (p.Length == 0 || p.Length > 32) return null;
        switch (p.ToLowerInvariant())
        {
            case "control": case "ctrl": return "ControlLeft";
            case "shift": return "ShiftLeft";
            case "alt": return "AltLeft";
            case "meta": case "win": case "windows": case "super": case "cmd": return "MetaLeft";
            case "esc": return "Escape";
            case "return": return "Enter";
            case "del": return "Delete";
            case "up": return "ArrowUp";
            case "down": return "ArrowDown";
            case "left": return "ArrowLeft";
            case "right": return "ArrowRight";
            case "space": return "Space";
        }
        if (p.Length == 1)
        {
            char c = char.ToUpperInvariant(p[0]);
            if (c is >= 'A' and <= 'Z') return "Key" + c;
            if (c is >= '0' and <= '9') return "Digit" + c;
        }
        // Case-insensitive match against known codes ("enter", "f5", "tab", "keyc" ...)
        return Map.Keys.FirstOrDefault(k => string.Equals(k, p, StringComparison.OrdinalIgnoreCase));
    }
}
