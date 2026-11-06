using System.Buffers.Binary;
using System.Security.Cryptography;
using GlobalRemoteControl.Agent.Audio;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.FileTransfer;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Settings;

namespace GlobalRemoteControl.Agent.Tests;

public class FrameChunkerTests
{
    [Theory]
    [InlineData(0, 1)] [InlineData(1, 1)] [InlineData(16000, 1)] [InlineData(16001, 2)] [InlineData(32000, 2)] [InlineData(100000, 7)]
    public void ChunkCount_AndSizes(int size, int expected)
    {
        var chunks = FrameChunker.Split(7, new byte[size]);
        Assert.Equal(expected, chunks.Count);
        Assert.All(chunks, c => Assert.InRange(c.Length, FrameChunker.HeaderSize, FrameChunker.HeaderSize + 16000));
        Assert.Equal(size, chunks.Sum(c => c.Length - FrameChunker.HeaderSize));
    }

    [Fact]
    public void Header_IsLittleEndian_FrameIdIndexCount()
    {
        var chunks = FrameChunker.Split(0x01020304, new byte[40000]);
        Assert.Equal(new byte[] { 4, 3, 2, 1, 2, 0, 3, 0 }, chunks[2].Take(8).ToArray());
        Assert.Equal(new byte[] { 4, 3, 2, 1, 0, 0, 3, 0 }, chunks[0].Take(8).ToArray());
    }

    [Fact]
    public void Roundtrip_InOrder_AndRandom()
    {
        var data = RandomNumberGenerator.GetBytes(50_000);
        var r = new FrameReassembler();
        (uint, byte[])? done = null;
        foreach (var c in FrameChunker.Split(9, data)) done = r.Add(c) ?? done;
        Assert.Equal(9u, done!.Value.Item1);
        Assert.Equal(data, done.Value.Item2);
    }

    [Fact]
    public void Reassembler_OutOfOrderChunks()
    {
        var data = RandomNumberGenerator.GetBytes(40_000);
        var chunks = FrameChunker.Split(1, data);
        var r = new FrameReassembler();
        Assert.Null(r.Add(chunks[2])); Assert.Null(r.Add(chunks[0]));
        Assert.Equal(data, r.Add(chunks[1])!.Value.Data);
    }

    [Fact]
    public void NewerFrame_DiscardsOlderPartial_AndLateOldChunkIgnored()
    {
        var r = new FrameReassembler();
        var old = FrameChunker.Split(1, new byte[40000]);
        var newer = FrameChunker.Split(2, new byte[20000]);
        r.Add(old[0]);
        Assert.Null(r.Add(newer[0]));
        Assert.Null(r.Add(old[1]));              // stale
        Assert.Equal(2u, r.Add(newer[1])!.Value.FrameId);
    }

    [Fact]
    public void Reassembler_RejectsMalformedChunks()
    {
        var r = new FrameReassembler();
        Assert.Null(r.Add(new byte[3]));
        var bad = new byte[10];
        BinaryPrimitives.WriteUInt16LittleEndian(bad.AsSpan(6), 0);   // count 0
        Assert.Null(r.Add(bad));
        BinaryPrimitives.WriteUInt16LittleEndian(bad.AsSpan(6), 2);
        BinaryPrimitives.WriteUInt16LittleEndian(bad.AsSpan(4), 2);   // index >= count
        Assert.Null(r.Add(bad));
    }

    [Fact]
    public void DuplicateChunk_NotCountedTwice()
    {
        var chunks = FrameChunker.Split(1, new byte[20000]);
        var r = new FrameReassembler();
        r.Add(chunks[0]);
        Assert.Null(r.Add(chunks[0]));
        Assert.NotNull(r.Add(chunks[1]));
    }
}

public class AckWindowTests
{
    private static readonly DateTime T0 = new(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AllowsTwoUnacked_ThenBlocks_UntilAck()
    {
        var w = new AckWindow();
        Assert.Equal(1u, w.NextFrameId());
        Assert.True(w.CanSend(0, T0)); w.OnSent(1, T0);
        Assert.True(w.CanSend(0, T0)); w.OnSent(2, T0);
        Assert.False(w.CanSend(0, T0));
        Assert.True(w.OnAck(1, T0));
        Assert.True(w.CanSend(0, T0));
        Assert.Equal(3u, w.NextFrameId());
    }

    [Fact]
    public void BackPressure_BlocksAt256KB()
    {
        var w = new AckWindow();
        Assert.True(w.CanSend(256 * 1024 - 1, T0));
        Assert.False(w.CanSend(256 * 1024, T0));
    }

    [Fact]
    public void BogusAcks_Ignored()
    {
        var w = new AckWindow();
        w.OnSent(1, T0);
        Assert.False(w.OnAck(5, T0));      // never sent
        Assert.False(w.OnAck(0, T0));
        Assert.True(w.OnAck(1, T0));
        Assert.False(w.OnAck(1, T0));      // duplicate
        Assert.Equal(1u, w.LastAcked);
    }

    [Fact]
    public void LostAcks_StallTimeout_ResetsWindow()
    {
        var w = new AckWindow();
        w.OnSent(1, T0); w.OnSent(2, T0);
        Assert.False(w.CanSend(0, T0.AddSeconds(4)));
        Assert.True(w.CanSend(0, T0.AddSeconds(6)));
    }
}

public class PcmConverterTests
{
    private static List<byte[]> Run(PcmConverter c, byte[] data, int slice = int.MaxValue)
    {
        var packets = new List<byte[]>();
        for (int i = 0; i < data.Length; i += Math.Min(slice, data.Length - i))
            c.Process(data.AsSpan(i, Math.Min(slice, data.Length - i)), packets.Add);
        return packets;
    }

    private static byte[] Floats(int frames, int channels, Func<int, float> f)
    {
        var b = new byte[frames * channels * 4];
        for (int i = 0; i < frames; i++)
            for (int ch = 0; ch < channels; ch++)
                BitConverter.TryWriteBytes(b.AsSpan((i * channels + ch) * 4), f(i));
        return b;
    }

    [Fact]
    public void Constants_Match_Protocol()
    {
        Assert.Equal(480, PcmConverter.SamplesPerPacket);
        Assert.Equal(960, PcmConverter.PacketBytes);
        Assert.Equal(24000, PcmConverter.OutRate);
    }

    [Fact]
    public void OneSecond48kStereoFloat_Gives50Packets_Of960Bytes()
    {
        var packets = Run(new PcmConverter(48000, 2, true), Floats(48000, 2, _ => 0.5f));
        Assert.InRange(packets.Count, 49, 50);
        Assert.All(packets, p => Assert.Equal(960, p.Length));
        Assert.InRange(BitConverter.ToInt16(packets[3], 100), 16383, 16384);
    }

    [Fact]
    public void Silence_StaysZero()
    {
        var packets = Run(new PcmConverter(44100, 2, true), Floats(44100, 2, _ => 0f));
        Assert.NotEmpty(packets);
        Assert.All(packets, p => Assert.All(p, b => Assert.Equal(0, b)));
    }

    [Fact]
    public void Clipping_ClampedToInt16()
    {
        var packets = Run(new PcmConverter(24000, 1, true), Floats(2000, 1, i => i % 2 == 0 ? 5f : -5f));
        var s = packets[0].Chunk(2).Select(c => BitConverter.ToInt16(c)).ToArray();
        Assert.All(s.Skip(2), v => Assert.True(v >= short.MinValue && v <= short.MaxValue));
        Assert.Contains(s, v => v == short.MaxValue); Assert.Contains(s, v => v == short.MinValue);
    }

    [Fact]
    public void SplitFeeding_GivesSameOutput_AndPartialFramesAreDropped()
    {
        var data = Floats(10000, 2, i => (float)Math.Sin(i * 0.05));
        var a = Run(new PcmConverter(48000, 2, true), data);
        var b = Run(new PcmConverter(48000, 2, true), data, 8 * 37);  // slice is a multiple of the frame size (8)
        Assert.Equal(a.Count, b.Count);
        for (int i = 0; i < a.Count; i++) Assert.Equal(a[i], b[i]);
    }

    [Fact]
    public void Int16Mono_24k_PassesThrough()
    {
        var pcm = new byte[1000 * 2];
        for (int i = 0; i < 1000; i++) BitConverter.TryWriteBytes(pcm.AsSpan(i * 2), (short)(i * 10));
        var p = Run(new PcmConverter(24000, 1, false), pcm);
        Assert.Equal(2, p.Count);
        Assert.InRange(BitConverter.ToInt16(p[0], 2) - BitConverter.ToInt16(p[0], 0), 9, 11);
    }

    [Theory]
    [InlineData(0, 2)] [InlineData(48000, 0)] [InlineData(-1, 1)]
    public void BadFormat_Throws(int rate, int ch) => Assert.Throws<ArgumentException>(() => new PcmConverter(rate, ch, true));
}

public class FileNameSanitizerTests
{
    [Theory]
    [InlineData("../../Windows/System32/evil.dll", "evil.dll")]
    [InlineData("..\\..\\evil.exe", "evil.exe")]
    [InlineData("C:\\Users\\x\\a.txt", "a.txt")]
    [InlineData("/etc/passwd", "passwd")]
    [InlineData("a.txt:hidden.exe", "a.txt_hidden.exe")]
    [InlineData("file.txt:Zone.Identifier", "file.txt_Zone.Identifier")]
    [InlineData("a<b>c|d?e*f\"g.txt", "a_b_c_d_e_f_g.txt")]
    public void Paths_Streams_InvalidChars_Neutralised(string input, string expected) => Assert.Equal(expected, FileNameSanitizer.Sanitize(input));

    [Theory]
    [InlineData("CON")] [InlineData("con")] [InlineData("NUL")] [InlineData("NUL.txt")] [InlineData("PRN")] [InlineData("AUX.log")]
    [InlineData("COM1")] [InlineData("LPT9.txt")] [InlineData("CONIN$")] [InlineData("CON .txt")]
    public void ReservedNames_Prefixed(string input)
    {
        var s = FileNameSanitizer.Sanitize(input);
        Assert.StartsWith("_", s);
    }

    [Theory]
    [InlineData("")] [InlineData(null)] [InlineData("   ")] [InlineData("...")] [InlineData("..")] [InlineData(".")] [InlineData("/")] [InlineData("\\")]
    public void EmptyOrDots_BecomeFile(string? input) => Assert.Equal("file", FileNameSanitizer.Sanitize(input));

    [Fact]
    public void LongNames_Truncated_ExtensionKept()
    {
        var s = FileNameSanitizer.Sanitize(new string('a', 500) + ".pdf");
        Assert.True(s.Length <= FileNameSanitizer.MaxLength);
        Assert.EndsWith(".pdf", s);
        Assert.True(FileNameSanitizer.Sanitize(new string('a', 300) + "." + new string('b', 100)).Length <= FileNameSanitizer.MaxLength);
    }

    [Fact]
    public void TrailingDotsSpaces_AndLeadingDots_Stripped()
    {
        Assert.Equal("a.txt", FileNameSanitizer.Sanitize("a.txt. . "));
        Assert.Equal("hidden", FileNameSanitizer.Sanitize("...hidden"));
    }

    [Fact]
    public void ControlAndBidiChars_Removed()
    {
        Assert.Equal("a_b.txt", FileNameSanitizer.Sanitize("a\nb.txt"));
        Assert.Equal("exe.txt", FileNameSanitizer.Sanitize("\u202Etxt.exe".Replace("txt.exe", "exe.txt")));
    }

    [Fact]
    public void ResultIsAlwaysAPlainFileName()
    {
        foreach (var n in new[] { "a/b", "a\\b", "..\\x", "x:y", "COM1.tar.gz", "a\0b" })
        {
            var s = FileNameSanitizer.Sanitize(n);
            Assert.Equal(s, Path.GetFileName(s));
            Assert.True(s.IndexOfAny(Path.GetInvalidFileNameChars()) < 0, n);
        }
    }

    [Fact]
    public void ReservedName_WithDoubleExtension_Prefixed()
    {
        Assert.StartsWith("_", FileNameSanitizer.Sanitize("NUL.tar.gz"));
        Assert.StartsWith("_", FileNameSanitizer.Sanitize("COM1.tar.gz"));
    }
}

public class IncomingFileTests
{
    [Fact]
    public void SizeCap_2GiB()
    {
        using var d = new TempDir();
        Assert.Equal(2L * 1024 * 1024 * 1024, IncomingFile.MaxSize);
        Assert.Throws<ArgumentOutOfRangeException>(() => new IncomingFile(d.File("x"), IncomingFile.MaxSize + 1, d.Path));
        Assert.Throws<ArgumentOutOfRangeException>(() => new IncomingFile(d.File("x"), -1, d.Path));
        using var ok = new IncomingFile(d.File("x"), IncomingFile.MaxSize, d.Path); // sparse: nothing written
    }

    [Fact]
    public void Write_BeyondAnnouncedSize_Refused()
    {
        using var d = new TempDir();
        using var f = new IncomingFile(d.File("x"), 4, d.Path);
        Assert.True(f.Write(new byte[3]));
        Assert.False(f.Write(new byte[2]));
        Assert.Equal(3, f.Received);
    }

    [Fact]
    public void HashMismatch_DestinationNotCreated_TempDeleted()
    {
        using var d = new TempDir();
        var dest = d.File("out.bin");
        using var f = new IncomingFile(dest, 3, d.Path);
        f.Write(new byte[] { 1, 2, 3 });
        var (ok, why) = f.Finish(new string('0', 64));
        Assert.False(ok); Assert.Equal("hash-mismatch", why);
        Assert.False(File.Exists(dest)); Assert.False(File.Exists(f.TempPath));
    }

    [Fact]
    public void ShortFile_SizeMismatch_NotMoved()
    {
        using var d = new TempDir();
        var dest = d.File("out.bin");
        using var f = new IncomingFile(dest, 10, d.Path);
        f.Write(new byte[] { 1, 2, 3 });
        var (ok, why) = f.Finish(IncomingFile.Sha256Hex(new byte[] { 1, 2, 3 }));
        Assert.False(ok); Assert.Equal("size-mismatch", why);
        Assert.False(File.Exists(dest));
    }

    [Theory]
    [InlineData("zz")] [InlineData("")] [InlineData("abcd")]
    public void MalformedHash_Fails(string hash)
    {
        using var d = new TempDir();
        using var f = new IncomingFile(d.File("o"), 1, d.Path);
        f.Write(new byte[1]);
        Assert.False(f.Finish(hash).Ok);
        Assert.False(File.Exists(d.File("o")));
    }

    [Fact]
    public void GoodHash_MovesFile_AcceptsUppercaseHex()
    {
        using var d = new TempDir();
        var data = RandomNumberGenerator.GetBytes(1000);
        var dest = d.File("out.bin");
        using var f = new IncomingFile(dest, 1000, d.Path);
        f.Write(data);
        Assert.True(f.Finish(IncomingFile.Sha256Hex(data).ToUpperInvariant()).Ok);
        Assert.Equal(data, File.ReadAllBytes(dest));
        Assert.False(File.Exists(f.TempPath));
    }

    [Fact]
    public void Abort_DeletesTemp()
    {
        using var d = new TempDir();
        var f = new IncomingFile(d.File("o"), 5, d.Path);
        f.Write(new byte[2]);
        f.Abort();
        Assert.False(File.Exists(f.TempPath));
        Assert.False(File.Exists(d.File("o")));
    }
}

public class FileTransferManagerTests
{
    private sealed class Rig : IDisposable
    {
        public TempDir Dir = new();
        public FakePrompts Prompts = new();
        public List<object> Control = new();
        public FileTransferManager M;
        public string Dest;
        public string TempDir => Dir.File("tmp");

        public Rig(bool viewOnly = false)
        {
            Dest = Dir.File("saved.bin");
            Prompts.IncomingFile = _ => Task.FromResult<string?>(Dest);
            M = new FileTransferManager("Browser", "cid", "AAAA-BBBB-CCCC-DDDD", viewOnly,
                o => { lock (Control) Control.Add(o); }, _ => { }, () => 0, Prompts, new AuditLog(Dir.File("a.log")), TempDir);
        }

        public List<string> Sent() { lock (Control) return Control.Select(o => Signaling.Json.Serialize(o)).ToList(); }
        public bool Saw(string needle) => Sent().Any(s => s.Contains(needle));
        public int TempFiles => Directory.Exists(TempDir) ? Directory.GetFiles(TempDir).Length : 0;
        public void Dispose() { M.Dispose(); Dir.Dispose(); }
    }

    [Fact]
    public async Task HappyPath_Accepted_Written_Verified()
    {
        using var r = new Rig();
        var data = RandomNumberGenerator.GetBytes(40_000);
        await r.M.Handle(new FileOfferMsg("f1", "../../evil.txt", data.Length));
        Assert.Equal("evil.txt", r.Prompts.LastFileName);
        Assert.True(r.Saw("file-accept"));
        for (int i = 0; i < data.Length; i += 16000) r.M.OnChunk(data[i..Math.Min(i + 16000, data.Length)]);
        await r.M.Handle(new FileEndMsg("f1", IncomingFile.Sha256Hex(data)));
        Assert.Equal(data, File.ReadAllBytes(r.Dest));
        Assert.True(r.Saw("\"ok\":true"));
        Assert.Equal(0, r.TempFiles);
    }

    [Fact]
    public async Task Sha256Mismatch_FileNotMoved()
    {
        using var r = new Rig();
        var data = new byte[100];
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 100));
        r.M.OnChunk(data);
        await r.M.Handle(new FileEndMsg("f1", new string('0', 64)));
        Assert.False(File.Exists(r.Dest));
        Assert.True(r.Saw("hash-mismatch"));
        Assert.Equal(0, r.TempFiles);
    }

    [Fact]
    public async Task FileEnd_BeforeBytes_WaitsThenFinalizes()
    {
        using var r = new Rig();
        var data = RandomNumberGenerator.GetBytes(20_000);
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", data.Length));
        await r.M.Handle(new FileEndMsg("f1", IncomingFile.Sha256Hex(data)));
        Assert.False(File.Exists(r.Dest));
        Assert.False(r.Saw("file-done"));
        r.M.OnChunk(data[..16000]);
        Assert.False(File.Exists(r.Dest));
        r.M.OnChunk(data[16000..]);
        Assert.Equal(data, File.ReadAllBytes(r.Dest));
    }

    [Fact]
    public async Task FileEnd_ForShortFile_NeverCompletes_NothingAtDestination()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 1000));
        r.M.OnChunk(new byte[10]);
        await r.M.Handle(new FileEndMsg("f1", IncomingFile.Sha256Hex(new byte[10])));
        Assert.False(File.Exists(r.Dest));
    }

    [Fact]
    public async Task MoreDataThanAnnounced_Fails_Cleans()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 10));
        r.M.OnChunk(new byte[11]);
        Assert.True(r.Saw("size-mismatch"));
        Assert.False(File.Exists(r.Dest));
        Assert.Equal(0, r.TempFiles);
    }

    [Fact]
    public async Task OverCap_Rejected_NoPrompt()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", IncomingFile.MaxSize + 1));
        Assert.True(r.Saw("too-large"));
        Assert.Equal(0, r.Prompts.FileCalls);
    }

    [Fact]
    public async Task ViewOnly_RejectsOffers_NoPrompt()
    {
        using var r = new Rig(viewOnly: true);
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 5));
        Assert.True(r.Saw("view-only"));
        Assert.Equal(0, r.Prompts.FileCalls);
    }

    [Fact]
    public async Task UserDenies_Rejected_ChunksIgnored()
    {
        using var r = new Rig();
        r.Prompts.IncomingFile = _ => Task.FromResult<string?>(null);
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 5));
        Assert.True(r.Saw("denied"));
        r.M.OnChunk(new byte[5]);
        Assert.False(File.Exists(r.Dest));
        Assert.Equal(0, r.TempFiles);
    }

    [Fact]
    public async Task ChunksWithoutAcceptedOffer_Ignored()
    {
        using var r = new Rig();
        r.M.OnChunk(new byte[100]);
        await r.M.Handle(new FileEndMsg("nope", new string('0', 64)));
        Assert.Empty(r.Sent());
        Assert.Equal(0, r.TempFiles);
    }

    [Fact]
    public async Task SecondOffer_WhileFirstActive_Busy()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 5));
        await r.M.Handle(new FileOfferMsg("f2", "b.bin", 5));
        Assert.True(r.Saw("busy"));
        Assert.Equal(1, r.Prompts.FileCalls);
    }

    [Fact]
    public async Task Cancel_DeletesTemp_NoFile()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 100));
        r.M.OnChunk(new byte[50]);
        await r.M.Handle(new FileCancelMsg("f1"));
        Assert.Equal(0, r.TempFiles);
        Assert.False(File.Exists(r.Dest));
    }

    [Fact]
    public async Task EmptyFile_Works()
    {
        using var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "e.bin", 0));
        await r.M.Handle(new FileEndMsg("f1", IncomingFile.Sha256Hex(Array.Empty<byte>())));
        Assert.True(File.Exists(r.Dest));
        Assert.Empty(File.ReadAllBytes(r.Dest));
    }

    [Fact]
    public async Task Dispose_AbortsInFlight()
    {
        var r = new Rig();
        await r.M.Handle(new FileOfferMsg("f1", "a.bin", 100));
        r.M.OnChunk(new byte[50]);
        r.M.Dispose();
        Assert.Equal(0, r.TempFiles);
        r.Dir.Dispose();
    }
}

public class AuditLogTests
{
    [Fact]
    public void ControlChars_Stripped_CannotForgeLines()
    {
        using var d = new TempDir();
        var log = new AuditLog(d.File("a.log"));
        log.Write("evt\r\nFAKE", "Mal\nlory\t(x)", "id\u0000", "details\n2025-01-01T00:00:00Z\tsession-approved\t-\tpwned");
        var lines = File.ReadAllLines(d.File("a.log"));
        Assert.Single(lines);
        Assert.Equal(4, lines[0].Split('\t').Length);
        Assert.DoesNotContain('\0', lines[0]);
    }

    [Fact]
    public void Append_OneLinePerEvent_WithUtcTimestamp()
    {
        using var d = new TempDir();
        var log = new AuditLog(d.File("a.log"));
        log.Write("one"); log.Write("two", "n", "i", "d");
        var lines = File.ReadAllLines(d.File("a.log"));
        Assert.Equal(2, lines.Length);
        Assert.Matches(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\tone\t-\t$", lines[0]);
        Assert.EndsWith("two\tn (i)\td", lines[1]);
    }

    [Fact]
    public void LongText_Truncated()
    {
        Assert.True(AuditLog.Clean(new string('a', 5000)).Length <= 513);
    }

    [Fact]
    public void UnwritablePath_DoesNotThrow()
    {
        using var d = new TempDir();
        new AuditLog(Path.Combine(d.Path, "no-such-dir", "a.log")).Write("x");
    }
}

public class SettingsTests
{
    [Theory]
    [InlineData("wss://example.com/remote/ws", true)]
    [InlineData("ws://localhost:3000/remote/ws", true)]
    [InlineData("https://example.com", false)]
    [InlineData("http://example.com", false)]
    [InlineData("file:///c:/x", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("example.com/ws", false)]
    [InlineData("/remote/ws", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void ServerUrl_Validation(string? url, bool ok) => Assert.Equal(ok, AgentSettings.IsValidServerUrl(url));

    [Fact]
    public void Load_InvalidUrl_FallsBackToDefault()
    {
        using var d = new TempDir();
        File.WriteAllText(d.File("s.json"), "{\"ServerUrl\":\"http://evil\",\"DeviceName\":\"PC\\u0007\\n1\"}");
        var s = AgentSettings.Load(d.File("s.json"));
        Assert.Equal(AgentSettings.DefaultServerUrl, s.ServerUrl);
        Assert.Equal("PC1", s.DeviceName);
    }

    [Theory]
    [InlineData("not json")] [InlineData("")] [InlineData("[]")] [InlineData("null")]
    public void Load_Corrupt_GivesDefaults(string content)
    {
        using var d = new TempDir();
        File.WriteAllText(d.File("s.json"), content);
        var s = AgentSettings.Load(d.File("s.json"));
        Assert.Equal(AgentSettings.DefaultServerUrl, s.ServerUrl);
        Assert.False(s.McpEnabled);
    }

    [Fact]
    public void Load_Missing_Defaults_AndSaveRoundtrips()
    {
        using var d = new TempDir();
        var s = AgentSettings.Load(d.File("none.json"));
        Assert.Equal(AgentSettings.DefaultServerUrl, s.ServerUrl);
        s.ServerUrl = "wss://x.example/ws"; s.DeviceName = "Home";
        s.Save(d.File("s.json"));
        var r = AgentSettings.Load(d.File("s.json"));
        Assert.Equal("wss://x.example/ws", r.ServerUrl); Assert.Equal("Home", r.DeviceName);
    }

    [Fact]
    public void NormalizeName_Rules()
    {
        Assert.Equal("Windows PC", AgentSettings.NormalizeName(null));
        Assert.Equal("Windows PC", AgentSettings.NormalizeName("  \n "));
        Assert.Equal(64, AgentSettings.NormalizeName(new string('x', 100)).Length);
        Assert.Equal("ab", AgentSettings.NormalizeName(" a\tb "));
    }
}
