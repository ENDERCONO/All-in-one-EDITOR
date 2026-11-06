using System.Drawing;
using GlobalRemoteControl.Agent.Input;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;

namespace GlobalRemoteControl.Agent.Tests;

public class ControlMessageParserTests
{
    private static ControlMessage? P(string json) => ControlMessageParser.Parse(json, out _);

    [Fact] public void MouseMove_Valid() => Assert.Equal(new MouseMoveMsg(0.25, 1), P("{\"t\":\"mouse-move\",\"x\":0.25,\"y\":1}"));

    [Theory]
    [InlineData("{\"t\":\"mouse-move\",\"x\":1.0001,\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":-0.1,\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":1e999,\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":\"0.5\",\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":null,\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":0.5}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":[0.5],\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":NaN,\"y\":0}")]
    [InlineData("{\"t\":\"mouse-move\",\"x\":Infinity,\"y\":0}")]
    public void MouseMove_OutOfRangeOrWrongType_Rejected(string json) => Assert.Null(P(json));

    [Fact]
    public void MouseButton_Variants()
    {
        Assert.Equal(new MouseButtonMsg(MouseButton.Left, true, null, null), P("{\"t\":\"mouse-button\",\"button\":\"left\",\"down\":true}"));
        Assert.Equal(new MouseButtonMsg(MouseButton.Middle, false, 0.5, 0.5), P("{\"t\":\"mouse-button\",\"button\":\"middle\",\"down\":false,\"x\":0.5,\"y\":0.5}"));
        Assert.Null(P("{\"t\":\"mouse-button\",\"button\":\"back\",\"down\":true}"));
        Assert.Null(P("{\"t\":\"mouse-button\",\"button\":\"left\",\"down\":1}"));
        Assert.Null(P("{\"t\":\"mouse-button\",\"button\":\"left\",\"down\":true,\"x\":0.5}"));
        Assert.Null(P("{\"t\":\"mouse-button\",\"button\":\"left\",\"down\":true,\"x\":2,\"y\":0}"));
    }

    [Fact]
    public void Wheel_ClampedAndTyped()
    {
        Assert.Equal(new WheelMsg(0, 1200), P("{\"t\":\"wheel\",\"dy\":99999}"));
        Assert.Equal(new WheelMsg(-1200, 120), P("{\"t\":\"wheel\",\"dx\":-5000,\"dy\":120}"));
        Assert.Null(P("{\"t\":\"wheel\",\"dy\":1.5}"));
        Assert.Null(P("{\"t\":\"wheel\",\"dy\":\"10\"}"));
        Assert.Null(P("{\"t\":\"wheel\",\"dy\":1e300}"));
        Assert.Null(P("{\"t\":\"wheel\",\"dy\":9007199254740993000}"));
    }

    [Theory]
    [InlineData("KeyA", true)]
    [InlineData("ArrowUp", false)]
    public void Key_Valid(string code, bool down) => Assert.Equal(new KeyMsg(code, down), P($"{{\"t\":\"key\",\"code\":\"{code}\",\"down\":{down.ToString().ToLower()}}}"));

    [Theory]
    [InlineData("{\"t\":\"key\",\"code\":\"\",\"down\":true}")]
    [InlineData("{\"t\":\"key\",\"code\":\"../../etc\",\"down\":true}")]
    [InlineData("{\"t\":\"key\",\"code\":\"Key A\",\"down\":true}")]
    [InlineData("{\"t\":\"key\",\"code\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\",\"down\":true}")]
    [InlineData("{\"t\":\"key\",\"code\":5,\"down\":true}")]
    [InlineData("{\"t\":\"key\",\"code\":\"KeyA\"}")]
    public void Key_Malicious_Rejected(string json) => Assert.Null(P(json));

    [Fact]
    public void Text_LengthBoundary()
    {
        Assert.NotNull(P("{\"t\":\"text\",\"text\":\"" + new string('a', 256) + "\"}"));
        Assert.Null(P("{\"t\":\"text\",\"text\":\"" + new string('a', 257) + "\"}"));
        Assert.Null(P("{\"t\":\"text\",\"text\":\"\"}"));
        Assert.Null(P("{\"t\":\"text\",\"text\":12}"));
    }

    [Fact]
    public void SelectMonitor_Range()
    {
        Assert.Equal(new SelectMonitorMsg(0), P("{\"t\":\"select-monitor\",\"index\":0}"));
        Assert.Null(P("{\"t\":\"select-monitor\",\"index\":-1}"));
        Assert.Null(P("{\"t\":\"select-monitor\",\"index\":32}"));
        Assert.Null(P("{\"t\":\"select-monitor\",\"index\":0.5}"));
    }

    [Theory]
    [InlineData(1, 10, 0.25, true)]
    [InlineData(30, 95, 1, true)]
    [InlineData(0, 50, 1, false)]
    [InlineData(31, 50, 1, false)]
    [InlineData(10, 9, 1, false)]
    [InlineData(10, 96, 1, false)]
    [InlineData(10, 50, 0.24, false)]
    [InlineData(10, 50, 1.01, false)]
    public void Quality_Range(int fps, int q, double scale, bool ok)
    {
        var r = P($"{{\"t\":\"quality\",\"fps\":{fps},\"quality\":{q},\"scale\":{scale.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}");
        Assert.Equal(ok, r != null);
    }

    [Fact]
    public void Ack_Range()
    {
        Assert.Equal(new AckMsg(uint.MaxValue), P("{\"t\":\"ack\",\"frameId\":4294967295}"));
        Assert.Null(P("{\"t\":\"ack\",\"frameId\":4294967296}"));
        Assert.Null(P("{\"t\":\"ack\",\"frameId\":-1}"));
        Assert.Null(P("{\"t\":\"ack\",\"frameId\":1.5}"));
    }

    [Fact] public void Audio_Bool() { Assert.Equal(new AudioMsg(true), P("{\"t\":\"audio\",\"enabled\":true}")); Assert.Null(P("{\"t\":\"audio\",\"enabled\":\"yes\"}")); }

    [Fact]
    public void FileOffer_Validation()
    {
        Assert.Equal(new FileOfferMsg("abc-1", "a.txt", 5), P("{\"t\":\"file-offer\",\"id\":\"abc-1\",\"name\":\"a.txt\",\"size\":5}"));
        Assert.Null(P("{\"t\":\"file-offer\",\"id\":\"a b\",\"name\":\"a.txt\",\"size\":5}"));
        Assert.Null(P("{\"t\":\"file-offer\",\"id\":\"a\",\"name\":\"\",\"size\":5}"));
        Assert.Null(P("{\"t\":\"file-offer\",\"id\":\"a\",\"name\":\"a\",\"size\":-1}"));
        Assert.Null(P("{\"t\":\"file-offer\",\"id\":\"a\",\"name\":\"a\",\"size\":1e30}"));
        // over the 2 GiB cap still parses; the manager rejects it with a reply
        Assert.NotNull(P("{\"t\":\"file-offer\",\"id\":\"a\",\"name\":\"a\",\"size\":2147483649}"));
    }

    [Fact]
    public void FileEnd_Sha256Hex_Validated_AndLowercased()
    {
        var hex = new string('A', 64);
        Assert.Equal(new FileEndMsg("x", new string('a', 64)), P($"{{\"t\":\"file-end\",\"id\":\"x\",\"sha256\":\"{hex}\"}}"));
        Assert.Null(P("{\"t\":\"file-end\",\"id\":\"x\",\"sha256\":\"zz\"}"));
        Assert.Null(P($"{{\"t\":\"file-end\",\"id\":\"x\",\"sha256\":\"{new string('g', 64)}\"}}"));
    }

    [Fact]
    public void FileCancelAcceptReject()
    {
        Assert.Equal(new FileCancelMsg("x"), P("{\"t\":\"file-cancel\",\"id\":\"x\"}"));
        Assert.Equal(new FileAcceptMsg("x"), P("{\"t\":\"file-accept\",\"id\":\"x\"}"));
        Assert.Equal(new FileRejectMsg("x", "rejected"), P("{\"t\":\"file-reject\",\"id\":\"x\"}"));
        Assert.Null(P("{\"t\":\"file-cancel\",\"id\":\"../x\"}"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("42")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("{\"t\":5}")]
    [InlineData("{\"t\":\"hello\"}")]
    [InlineData("{\"t\":\"shell\",\"cmd\":\"calc\"}")]
    [InlineData("{\"t\":\"__proto__\"}")]
    public void NotAMessage_Rejected_WithReason(string json)
    {
        Assert.Null(ControlMessageParser.Parse(json, out var err));
        Assert.False(string.IsNullOrEmpty(err));
    }

    [Fact]
    public void TooBig_OrTooDeep_Rejected()
    {
        Assert.Null(P("{\"t\":\"text\",\"text\":\"" + new string('a', 70_000) + "\"}"));
        var deep = "{\"t\":\"mouse-move\",\"x\":0,\"y\":0,\"z\":" + new string('[', 40) + new string(']', 40) + "}";
        Assert.Null(P(deep));
        Assert.Null(P("{\"t\":\"" + new string('x', 65) + "\"}"));
    }

    [Fact]
    public void ErrorText_DoesNotEchoLongType()
    {
        P("{\"t\":\"" + new string('x', 60) + "\"}");
        ControlMessageParser.Parse("{\"t\":\"" + new string('x', 60) + "\"}", out var err);
        Assert.True(err!.Length < 80);
    }

    [Fact]
    public void JsonHelpers_IsId_RejectsTrailingNewline() => Assert.False(Json.IsId(new string('a', 22) + "\n"));

    [Fact]
    public void JsonHelpers_IsId()
    {
        Assert.True(Json.IsId(new string('a', 22)));
        Assert.False(Json.IsId(new string('a', 21)));
        Assert.False(Json.IsId(new string('a', 21) + "!"));
        Assert.False(Json.IsId(null));
    }
}

public class KeyMapTests
{
    [Theory]
    [InlineData("ArrowUp")] [InlineData("ArrowDown")] [InlineData("ArrowLeft")] [InlineData("ArrowRight")]
    [InlineData("Insert")] [InlineData("Delete")] [InlineData("Home")] [InlineData("End")]
    [InlineData("PageUp")] [InlineData("PageDown")] [InlineData("ControlRight")] [InlineData("AltRight")]
    [InlineData("NumpadEnter")] [InlineData("NumpadDivide")] [InlineData("MetaLeft")] [InlineData("MetaRight")]
    [InlineData("NumLock")] [InlineData("PrintScreen")]
    public void ExtendedKeys_AreFlaggedExtended(string code)
    {
        Assert.True(KeyMap.TryGet(code, out var k));
        Assert.True(k.Extended);
    }

    [Theory]
    [InlineData("Enter")] [InlineData("ControlLeft")] [InlineData("AltLeft")] [InlineData("ShiftLeft")] [InlineData("Numpad0")] [InlineData("KeyA")] [InlineData("F12")]
    public void NormalKeys_AreNotExtended(string code)
    {
        Assert.True(KeyMap.TryGet(code, out var k));
        Assert.False(k.Extended);
    }

    [Fact]
    public void EnterAndNumpadEnter_SameVk_DifferOnlyByExtended()
    {
        KeyMap.TryGet("Enter", out var a); KeyMap.TryGet("NumpadEnter", out var b);
        Assert.Equal(a.Vk, b.Vk); Assert.Equal(a.Scan, b.Scan);
        Assert.NotEqual(a.Extended, b.Extended);
    }

    [Fact]
    public void KnownVirtualKeys()
    {
        KeyMap.TryGet("KeyA", out var a); Assert.Equal(0x41, a.Vk); Assert.Equal(0x1E, a.Scan);
        KeyMap.TryGet("KeyZ", out var z); Assert.Equal(0x5A, z.Vk);
        KeyMap.TryGet("Digit0", out var d0); Assert.Equal(0x30, d0.Vk);
        KeyMap.TryGet("Digit1", out var d1); Assert.Equal(0x31, d1.Vk); Assert.Equal(0x02, d1.Scan);
        KeyMap.TryGet("F1", out var f1); Assert.Equal(0x70, f1.Vk);
        KeyMap.TryGet("F12", out var f12); Assert.Equal(KeyMap.VK_F12, f12.Vk);
        KeyMap.TryGet("Space", out var sp); Assert.Equal(0x20, sp.Vk);
    }

    [Fact]
    public void EveryCode_HasNonZeroVk_AndKeyCodesAreUniqueByVkScanExt()
    {
        var seen = new HashSet<(ushort, ushort, bool)>();
        foreach (var code in KeyMap.Codes)
        {
            KeyMap.TryGet(code, out var k);
            Assert.NotEqual(0, k.Vk);
            Assert.True(seen.Add((k.Vk, k.Scan, k.Extended)), $"duplicate mapping for {code}");
        }
    }

    [Theory]
    [InlineData("Foo")] [InlineData("keya")] [InlineData("")] [InlineData("Unidentified")]
    public void UnknownCodes_NotMapped(string code) => Assert.False(KeyMap.TryGet(code, out _));

    [Theory]
    [InlineData("Control", "ControlLeft")] [InlineData("ctrl", "ControlLeft")] [InlineData("c", "KeyC")] [InlineData("5", "Digit5")]
    [InlineData("Enter", "Enter")] [InlineData("f5", "F5")] [InlineData("Esc", "Escape")] [InlineData("win", "MetaLeft")]
    public void ComboParts_Resolve(string part, string code) => Assert.Equal(code, KeyMap.ResolveComboPart(part));

    [Theory]
    [InlineData("")] [InlineData("nonsense")] [InlineData("   ")]
    public void ComboParts_Unknown_Null(string part) => Assert.Null(KeyMap.ResolveComboPart(part));
}

public class InputControllerTests
{
    private sealed class Sink : IInputSink
    {
        public List<string> Calls = new();
        public void MoveAbsolute(int nx, int ny) => Calls.Add($"move {nx},{ny}");
        public void Button(MouseButton b, bool down) => Calls.Add($"btn {b} {(down ? "down" : "up")}");
        public void Wheel(int dx, int dy) => Calls.Add($"wheel {dx},{dy}");
        public void Key(KeyInfo k, bool down) => Calls.Add($"key {k.Vk:X2} {(down ? "down" : "up")}");
        public void UnicodeChar(char c, bool down) => Calls.Add($"char {c} {(down ? "down" : "up")}");
    }

    private static readonly Rectangle Screen = new(0, 0, 1920, 1080);

    private static (InputController c, Sink s, SessionGate g) Make(SessionMode mode = SessionMode.Control, bool activate = true)
    {
        var g = new SessionGate(); var s = new Sink();
        if (activate) { g.TryReserve("k"); g.Activate("k", SessionKind.Browser, "n", "i", mode); }
        var c = new InputController(s, () => g.IsInputAllowed("k"), () => Screen, () => Screen);
        return (c, s, g);
    }

    private static readonly ControlMessage[] AllInput =
    {
        new MouseMoveMsg(0.5, 0.5), new MouseButtonMsg(MouseButton.Left, true, 0.1, 0.1), new MouseButtonMsg(MouseButton.Left, false, null, null),
        new WheelMsg(0, 120), new KeyMsg("KeyA", true), new KeyMsg("KeyA", false), new TextMsg("hi"),
    };

    [Fact]
    public void NoSession_NothingInjected()
    {
        var (c, s, _) = Make(activate: false);
        foreach (var m in AllInput) Assert.False(c.Handle(m));
        Assert.False(c.Key("KeyA", true)); Assert.False(c.Type("x")); Assert.False(c.Click(MouseButton.Left)); Assert.False(c.Scroll(5));
        Assert.False(c.MoveTo(0.5, 0.5, true)); Assert.False(c.Combo("Control+C"));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void ViewMode_NothingInjected()
    {
        var (c, s, _) = Make(SessionMode.View);
        foreach (var m in AllInput) Assert.False(c.Handle(m));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void AfterKill_NothingInjected()
    {
        var (c, s, g) = Make();
        Assert.True(c.Handle(new MouseMoveMsg(0, 0)));
        g.Kill();
        s.Calls.Clear();
        foreach (var m in AllInput) Assert.False(c.Handle(m));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void ControlMode_InjectsEverything()
    {
        var (c, s, _) = Make();
        Assert.True(c.Handle(new MouseMoveMsg(1, 1)));
        Assert.Equal("move 65535,65535", s.Calls[0]);
        Assert.True(c.Handle(new WheelMsg(0, 120)));
        Assert.True(c.Handle(new KeyMsg("KeyA", true)));
        Assert.True(c.Handle(new KeyMsg("KeyA", false)));
        Assert.True(c.Handle(new TextMsg("é")));
        Assert.Contains("wheel 0,120", s.Calls);
        Assert.Contains("key 41 down", s.Calls);
        Assert.Contains("char é down", s.Calls);
    }

    [Fact]
    public void KillChord_NeverInjected_InAnyOrder()
    {
        var orders = new[]
        {
            new[] { "ControlLeft", "AltLeft", "ShiftLeft", "F12" },
            new[] { "F12", "ShiftRight", "AltRight", "ControlRight" },
            new[] { "ShiftLeft", "F12", "ControlLeft", "AltLeft" },
        };
        foreach (var order in orders)
        {
            var (c, s, _) = Make();
            foreach (var code in order) c.Handle(new KeyMsg(code, true));
            Assert.Equal(3, s.Calls.Count); // the last key, which would complete the chord, is dropped
            Assert.DoesNotContain(c.HeldKeys, k => k == order[^1]);
        }
    }

    [Fact]
    public void F12_AloneAndWithTwoModifiers_IsAllowed()
    {
        var (c, s, _) = Make();
        Assert.True(c.Handle(new KeyMsg("F12", true)));
        c.Handle(new KeyMsg("F12", false));
        c.Handle(new KeyMsg("ControlLeft", true)); c.Handle(new KeyMsg("AltLeft", true));
        Assert.True(c.Handle(new KeyMsg("F12", true)));
    }

    [Fact]
    public void Combo_KillChord_Refused_AndReleasesWhatItPressed()
    {
        var (c, s, _) = Make();
        Assert.False(c.Combo("Control+Alt+Shift+F12"));
        Assert.DoesNotContain("key 7B down", s.Calls);
        Assert.Empty(c.HeldKeys);
        Assert.Equal(s.Calls.Count(x => x.EndsWith("down")), s.Calls.Count(x => x.EndsWith("up")));
    }

    [Fact]
    public void Combo_Valid_PressesAndReleases()
    {
        var (c, s, _) = Make();
        Assert.True(c.Combo("Control+C"));
        Assert.Equal(new[] { "key A2 down", "key 43 down", "key 43 up", "key A2 up" }, s.Calls);
        Assert.False(c.Combo("Control+Bogus"));
    }

    [Fact]
    public void ReleaseAll_ReleasesHeldKeysAndButtons_EvenAfterGateClosed()
    {
        var (c, s, g) = Make();
        c.Handle(new KeyMsg("ShiftLeft", true)); c.Handle(new KeyMsg("KeyA", true));
        c.Handle(new MouseButtonMsg(MouseButton.Left, true, null, null));
        g.Kill();
        s.Calls.Clear();
        c.ReleaseAll();
        Assert.Contains("key A0 up", s.Calls); Assert.Contains("key 41 up", s.Calls); Assert.Contains("btn Left up", s.Calls);
        Assert.Empty(c.HeldKeys);
        s.Calls.Clear(); c.ReleaseAll();
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void KeyUp_ForKeyWeNeverPressed_Ignored()
    {
        var (c, s, _) = Make();
        Assert.False(c.Handle(new KeyMsg("KeyA", false)));
        Assert.False(c.Handle(new MouseButtonMsg(MouseButton.Right, false, null, null)));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void UnknownKeyCode_Ignored()
    {
        var (c, s, _) = Make();
        Assert.False(c.Handle(new KeyMsg("NotAKey", true)));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void Text_ControlCharsDropped_NewlineIsEnter_TooLongRefused()
    {
        var (c, s, _) = Make();
        Assert.True(c.Type("a\u0007b\n"));
        Assert.Equal(new[] { "char a down", "char a up", "char b down", "char b up", "key 0D down", "key 0D up" }, s.Calls);
        s.Calls.Clear();
        Assert.False(c.Type(new string('a', 257)));
        Assert.Empty(s.Calls);
    }

    [Fact]
    public void Text_CannotTypeKillChord()
    {
        // Unicode injection carries no virtual keys, so it cannot form the chord
        var (c, s, _) = Make();
        c.Type("");
        Assert.DoesNotContain(s.Calls, x => x.StartsWith("key"));
    }

    [Fact]
    public void Wheel_ClampedAtSink()
    {
        var (c, s, _) = Make();
        c.Handle(new WheelMsg(100000, -100000));
        Assert.Equal("wheel 1200,-1200", s.Calls[0]);
        Assert.False(c.Handle(new WheelMsg(0, 0)));
    }

    [Fact]
    public void Mouse_DoublePress_NotRepeated()
    {
        var (c, s, _) = Make();
        Assert.True(c.Handle(new MouseButtonMsg(MouseButton.Left, true, null, null)));
        Assert.False(c.Handle(new MouseButtonMsg(MouseButton.Left, true, null, null)));
        Assert.Single(s.Calls);
    }

    [Fact]
    public void MapToVirtualDesk_CornersAndMultiMonitor()
    {
        Assert.Equal((0, 0), InputController.MapToVirtualDesk(0, 0, Screen, Screen));
        Assert.Equal((65535, 65535), InputController.MapToVirtualDesk(1, 1, Screen, Screen));
        var virt = new Rectangle(-1920, 0, 3840, 1080);
        var secondary = new Rectangle(0, 0, 1920, 1080);
        var (x, _) = InputController.MapToVirtualDesk(0, 0, secondary, virt);
        Assert.InRange(x, 32770, 32780);
        Assert.Equal(65535, InputController.MapToVirtualDesk(1, 0, secondary, virt).X);
        Assert.Equal(0, InputController.MapToVirtualDesk(0, 0, new Rectangle(-1920, 0, 1920, 1080), virt).X);
    }

    [Fact]
    public void OutOfRangeMouseCoords_ClampedAtController()
    {
        var (c, s, _) = Make();
        c.MoveTo(5, -5, true);
        Assert.Equal("move 65535,0", s.Calls[0]);
    }
}
