using System.Runtime.InteropServices;
using SharpGen.Runtime;
using Vortice.MediaFoundation;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// H.264 through a Windows Media Foundation encoder MFT (PROTOCOL 5.1). The GPU encoder (NVENC / Quick Sync / AMF,
/// exposed by the driver as a hardware MFT, asynchronous) is tried first, then Microsoft's software encoder.
/// Settings for streaming: low-latency mode, CBR, baseline profile (no B-frames), long GOP with forced IDRs.
/// Every candidate must pass a short self-test before it is used, so a broken driver falls back cleanly.
/// </summary>
public sealed class MfH264EncoderFactory : IH264EncoderFactory
{
    private readonly object _lock = new();
    private readonly HashSet<string> _broken = new();
    private volatile bool _available;
    private volatile bool _probed;

    public bool Available => _available;
    public bool Probed => _probed;
    public string? Backend { get; private set; }

    /// <summary>Starts the one-time probe on a background (MTA) thread.</summary>
    public void ProbeInBackground(Action<string>? log = null)
    {
        if (!OperatingSystem.IsWindows()) { _probed = true; return; }
        var t = new Thread(() =>
        {
            try
            {
                using var e = Create(320, 180, 30, 1_000_000, log);
                _available = e != null;
                Backend = e?.Name;
                log?.Invoke(e != null ? "H.264 encoder ready: " + e.Name : "no working H.264 encoder (JPEG video only)");
            }
            catch (Exception ex) { log?.Invoke("H.264 probe failed: " + ex.Message); }
            finally { _probed = true; }
        }) { IsBackground = true, Name = "grc-h264-probe" };
        t.Start();
    }

    public IH264Encoder? Create(int width, int height, int fps, int bitsPerSecond, Action<string>? log = null)
    {
        if (!OperatingSystem.IsWindows()) return null;
        MfRuntime.EnsureStarted();
        foreach (var hardware in new[] { true, false })
        {
            var candidates = Enumerate(hardware);
            try
            {
                for (int i = 0; i < candidates.Count; i++)
                {
                    var activate = candidates[i];
                    var name = (hardware ? "hardware: " : "software: ") + (SafeName(activate) ?? "H.264 MFT");
                    lock (_lock) if (_broken.Contains(name)) continue;
                    MfH264Encoder? enc = null;
                    try
                    {
                        enc = new MfH264Encoder(activate, name, width, height, fps, bitsPerSecond);
                        candidates[i] = null; // the encoder owns it now
                        if (enc.SelfTest()) return enc;
                        log?.Invoke(name + ": self-test produced no picture");
                    }
                    catch (Exception ex) { log?.Invoke(name + ": " + ex.Message); }
                    if (enc != null) enc.Dispose();
                    else { try { activate.ShutdownObject(); } catch (Exception) { } }
                    lock (_lock) _broken.Add(name);
                }
            }
            finally { foreach (var a in candidates) a?.Dispose(); }
        }
        return null;
    }

    private static string? SafeName(IMFActivate a)
    {
        try { return a.GetString(TransformAttributeKeys.MftFriendlyNameAttribute); } catch (Exception) { return null; }
    }

    private static List<IMFActivate?> Enumerate(bool hardware)
    {
        var list = new List<IMFActivate?>();
        try
        {
            uint flags = (uint)((hardware ? EnumFlag.EnumFlagHardware : EnumFlag.EnumFlagSyncmft) | EnumFlag.EnumFlagSortandfilter);
            using var col = MediaFactory.MFTEnumEx(TransformCategoryGuids.VideoEncoder, flags,
                new RegisterTypeInfo { GuidMajorType = MediaTypeGuids.Video, GuidSubtype = VideoFormatGuids.NV12 },
                new RegisterTypeInfo { GuidMajorType = MediaTypeGuids.Video, GuidSubtype = VideoFormatGuids.H264 });
            foreach (var a in col) list.Add(a);
        }
        catch (Exception) { /* none of this kind */ }
        return list;
    }
}

internal static class MfRuntime
{
    private static int _started;
    public static void EnsureStarted()
    {
        if (Interlocked.Exchange(ref _started, 1) == 0) MediaFactory.MFStartup(true).CheckError();
    }
}

public sealed class MfH264Encoder : IH264Encoder
{
    private const int NeedMoreInput = unchecked((int)0xC00D6D72);  // MF_E_TRANSFORM_NEED_MORE_INPUT
    private const int StreamChange = unchecked((int)0xC00D6D61);   // MF_E_TRANSFORM_STREAM_CHANGE
    private const int NoEvents = unchecked((int)0xC00D3E80);       // MF_E_NO_EVENTS_AVAILABLE
    private const int ProvidesSamples = 0x100;                     // MFT_OUTPUT_STREAM_PROVIDES_SAMPLES
    private const int EventNoWait = 1;                             // MF_EVENT_FLAG_NO_WAIT

    // ICodecAPI properties (codecapi.h)
    private static readonly Guid LowLatency = new("9c27891a-ed7a-40e1-88e8-b22727a024ee");
    private static readonly Guid RateControl = new("1c0608e9-370c-4710-8a58-cb6181c42423");
    private static readonly Guid MeanBitRate = new("f7222374-2144-4815-b550-a37f8e12ee52");
    private static readonly Guid GopSize = new("95f31b26-95a4-41aa-9303-246a7fc6eef1");
    private static readonly Guid ForceKeyFrame = new("398c1b98-8353-475a-9ef2-8f265d260345");
    private static readonly Guid BFrames = new("8d390aac-dc5c-4200-b57f-814d04babab2");
    private static readonly Guid CodecApiIid = new("901db4c7-31ce-41a2-85dc-8fa0bf41b8da");

    private readonly IMFActivate _activate;
    private readonly IMFTransform _mft;
    private readonly IMFMediaEventGenerator? _events;
    private readonly IntPtr _codecApi;
    private readonly bool _async;
    private readonly int _fps;
    private int _needInput;
    private byte[]? _sequenceHeader;
    private IMFSample? _outSample;
    private IMFMediaBuffer? _outBuffer;
    private bool _disposed;

    public string Name { get; }
    public int Width { get; }
    public int Height { get; }

    internal MfH264Encoder(IMFActivate activate, string name, int width, int height, int fps, int bitrate)
    {
        if ((width & 1) != 0 || (height & 1) != 0) throw new ArgumentException("H.264 needs even dimensions");
        _activate = activate;
        Name = name; Width = width; Height = height; _fps = Math.Clamp(fps, 1, 120);
        _mft = activate.ActivateObject<IMFTransform>();
        var attrs = _mft.Attributes;
        _async = attrs.GetUInt32(TransformAttributeKeys.TransformAsync, out var isAsync).Success && isAsync != 0;
        if (_async)
        {
            attrs.Set(TransformAttributeKeys.TransformAsyncUnlock, 1u).CheckError();
            _events = _mft.QueryInterface<IMFMediaEventGenerator>();
        }
        attrs.Set(LowLatency, 1u); // MF_LOW_LATENCY (same GUID as the codec property)

        _codecApi = _mft.QueryInterfaceOrNull(CodecApiIid);
        SetCodec(RateControl, 0);              // eAVEncCommonRateControlMode_CBR
        SetCodecBool(LowLatency, true);
        SetCodec(MeanBitRate, (uint)bitrate);
        SetCodec(GopSize, (uint)(_fps * 10));  // IDRs are forced when needed
        SetCodec(BFrames, 0);

        using (var output = MediaFactory.MFCreateMediaType())
        {
            output.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video).CheckError();
            output.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.H264).CheckError();
            output.Set(MediaTypeAttributeKeys.AvgBitrate, (uint)bitrate).CheckError();
            output.Set(MediaTypeAttributeKeys.FrameSize, Pack(width, height)).CheckError();
            output.Set(MediaTypeAttributeKeys.FrameRate, Pack(_fps, 1)).CheckError();
            output.Set(MediaTypeAttributeKeys.PixelAspectRatio, Pack(1, 1)).CheckError();
            output.Set(MediaTypeAttributeKeys.InterlaceMode, 2u).CheckError(); // MFVideoInterlace_Progressive
            output.Set(MediaTypeAttributeKeys.Mpeg2Profile, 66u).CheckError(); // eAVEncH264VProfile_Base
            _mft.SetOutputType(0, output, 0);
        }
        using (var input = MediaFactory.MFCreateMediaType())
        {
            input.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video).CheckError();
            input.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.NV12).CheckError();
            input.Set(MediaTypeAttributeKeys.FrameSize, Pack(width, height)).CheckError();
            input.Set(MediaTypeAttributeKeys.FrameRate, Pack(_fps, 1)).CheckError();
            input.Set(MediaTypeAttributeKeys.PixelAspectRatio, Pack(1, 1)).CheckError();
            input.Set(MediaTypeAttributeKeys.InterlaceMode, 2u).CheckError();
            _mft.SetInputType(0, input, 0);
        }
        try
        {
            using var cur = _mft.GetOutputCurrentType(0);
            _sequenceHeader = cur.GetBlob(MediaTypeAttributeKeys.MpegSequenceHeader);
        }
        catch (Exception) { _sequenceHeader = null; }
        _mft.ProcessMessage(TMessageType.MessageNotifyBeginStreaming, UIntPtr.Zero);
        _mft.ProcessMessage(TMessageType.MessageNotifyStartOfStream, UIntPtr.Zero);
    }

    private static ulong Pack(int hi, int lo) => ((ulong)(uint)hi << 32) | (uint)lo;

    /// <summary>Encodes a few grey pictures and checks that an IDR comes out.</summary>
    internal bool SelfTest()
    {
        var pic = new byte[Nv12.Size(Width, Height)];
        Array.Fill(pic, (byte)128);
        for (int i = 0; i < 12; i++)
        {
            pic[i] = (byte)(16 + i * 10); // tiny change per picture
            var au = Encode(pic, i == 0, TimeSpan.FromSeconds(i / (double)_fps));
            if (au != null && AnnexB.HasIdr(au)) return true;
        }
        return false;
    }

    public void SetBitrate(int bitsPerSecond) => SetCodec(MeanBitRate, (uint)Math.Clamp(bitsPerSecond, 100_000, 100_000_000));

    public byte[]? Encode(byte[] nv12, bool keyframe, TimeSpan timestamp)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (keyframe) SetCodec(ForceKeyFrame, 1);
        using var sample = MediaFactory.MFCreateSample();
        using (var buffer = MediaFactory.MFCreateMemoryBuffer(nv12.Length))
        {
            buffer.Lock(out var ptr, out _, out _);
            try { Marshal.Copy(nv12, 0, ptr, Nv12.Size(Width, Height)); }
            finally { buffer.Unlock(); }
            buffer.CurrentLength = Nv12.Size(Width, Height);
            sample.AddBuffer(buffer);
        }
        sample.SampleTime = timestamp.Ticks;               // 100 ns units
        sample.SampleDuration = TimeSpan.TicksPerSecond / _fps;

        return _async ? EncodeAsync(sample) : EncodeSync(sample);
    }

    private byte[]? EncodeSync(IMFSample sample)
    {
        _mft.ProcessInput(0, sample, 0);
        return Drain();
    }

    /// <summary>Hardware MFTs are asynchronous: they ask for input and announce output through events.</summary>
    private byte[]? EncodeAsync(IMFSample sample)
    {
        byte[]? result = null;
        var deadline = Environment.TickCount64 + 500;
        while (_needInput == 0)
        {
            result = Concat(result, PumpEvents());
            if (_needInput > 0) break;
            if (Environment.TickCount64 > deadline) throw new TimeoutException("encoder did not ask for input");
            Thread.Sleep(1);
        }
        _mft.ProcessInput(0, sample, 0);
        _needInput--;
        // low-latency encoders give the picture back right away: wait briefly for it
        var outDeadline = Environment.TickCount64 + 40;
        while (Environment.TickCount64 < outDeadline)
        {
            var got = PumpEvents();
            result = Concat(result, got);
            if (got != null) break;
            Thread.SpinWait(200);
            Thread.Yield();
        }
        return result;
    }

    private byte[]? PumpEvents()
    {
        byte[]? result = null;
        while (true)
        {
            IMFMediaEvent ev;
            try { ev = _events!.GetEvent(EventNoWait); }
            catch (SharpGenException ex) when (ex.ResultCode.Code == NoEvents) { return result; }
            using (ev)
            {
                switch (ev.EventType)
                {
                    case MediaEventTypes.TransformNeedInput: _needInput++; break;
                    case MediaEventTypes.TransformHaveOutput: result = Concat(result, Drain(once: true)); break;
                }
            }
        }
    }

    private static byte[]? Concat(byte[]? a, byte[]? b) => a == null ? b : b == null ? a : [.. a, .. b];

    private byte[]? Drain(bool once = false)
    {
        byte[]? result = null;
        while (true)
        {
            var info = _mft.GetOutputStreamInfo(0);
            bool provides = (info.Flags & ProvidesSamples) != 0;
            if (!provides && _outSample == null)
            {
                _outSample = MediaFactory.MFCreateSample();
                _outBuffer = MediaFactory.MFCreateMemoryBuffer(Math.Max(info.Size, Width * Height * 2));
                _outSample.AddBuffer(_outBuffer);
            }
            if (!provides) _outBuffer!.CurrentLength = 0;
            var odb = new OutputDataBuffer { StreamID = 0, Sample = provides ? null! : _outSample! };
            var hr = _mft.ProcessOutput(ProcessOutputFlags.None, 1, ref odb, out _);
            try { odb.Events?.Dispose(); } catch (Exception) { }
            if (hr.Code == NeedMoreInput) return result;
            if (hr.Code == StreamChange)
            {
                using var t = _mft.GetOutputAvailableType(0, 0);
                _mft.SetOutputType(0, t, 0);
                try { _sequenceHeader = t.GetBlob(MediaTypeAttributeKeys.MpegSequenceHeader); } catch (Exception) { }
                continue;
            }
            hr.CheckError();
            var outSample = odb.Sample;
            try
            {
                using var buf = outSample.ConvertToContiguousBuffer();
                buf.Lock(out var ptr, out _, out var len);
                byte[] au;
                try { au = new byte[len]; Marshal.Copy(ptr, au, 0, len); }
                finally { buf.Unlock(); }
                if (_sequenceHeader is { Length: > 0 } && AnnexB.HasIdr(au) && !AnnexB.HasSps(au)) au = [.. _sequenceHeader, .. au];
                result = Concat(result, au);
            }
            finally { if (provides) outSample.Dispose(); }
            if (once) return result;
        }
    }

    // ICodecAPI is not wrapped by Vortice: call ICodecAPI::SetValue (vtable slot 9) with a VARIANT.
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct Variant24
    {
        [FieldOffset(0)] public ushort Vt;
        [FieldOffset(8)] public uint UI4;
        [FieldOffset(8)] public short Bool;
    }

    private unsafe void SetCodec(Guid api, uint value) => SetValue(api, new Variant24 { Vt = 19 /* VT_UI4 */, UI4 = value });
    private unsafe void SetCodecBool(Guid api, bool value) => SetValue(api, new Variant24 { Vt = 11 /* VT_BOOL */, Bool = (short)(value ? -1 : 0) });

    private unsafe void SetValue(Guid api, Variant24 v)
    {
        if (_codecApi == IntPtr.Zero) return;
        var vtbl = *(IntPtr**)_codecApi;
        var fn = (delegate* unmanaged[Stdcall]<IntPtr, Guid*, Variant24*, int>)vtbl[9];
        fn(_codecApi, &api, &v); // unsupported settings are fine: the encoder keeps its default
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _mft.ProcessMessage(TMessageType.MessageNotifyEndOfStream, UIntPtr.Zero); } catch (Exception) { }
        try { _mft.ProcessMessage(TMessageType.MessageCommandFlush, UIntPtr.Zero); } catch (Exception) { }
        if (_codecApi != IntPtr.Zero) Marshal.Release(_codecApi);
        _outBuffer?.Dispose();
        _outSample?.Dispose();
        _events?.Dispose();
        _mft.Dispose();
        try { _activate.ShutdownObject(); } catch (Exception) { }
        _activate.Dispose();
    }
}
