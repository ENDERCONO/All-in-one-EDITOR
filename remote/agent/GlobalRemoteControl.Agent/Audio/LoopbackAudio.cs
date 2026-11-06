using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace GlobalRemoteControl.Agent.Audio;

/// <summary>WASAPI loopback of the default playback device → 20 ms mono 24 kHz s16le packets.</summary>
public sealed class LoopbackAudio : IDisposable
{
    private readonly Action<byte[]> _onPacket;
    private WasapiLoopbackCapture? _capture;
    private PcmConverter? _converter;

    public LoopbackAudio(Action<byte[]> onPacket) => _onPacket = onPacket;

    public static bool IsAvailable()
    {
        try
        {
            using var e = new MMDeviceEnumerator();
            return e.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }
        catch (Exception) { return false; }
    }

    public bool Running => _capture != null;

    public void Start()
    {
        if (_capture != null) return;
        var cap = new WasapiLoopbackCapture();
        var fmt = cap.WaveFormat;
        bool isFloat = fmt.Encoding == WaveFormatEncoding.IeeeFloat ||
                       (fmt is WaveFormatExtensible ext && ext.SubFormat == NAudio.Dmo.AudioMediaSubtypes.MEDIASUBTYPE_IEEE_FLOAT);
        if (!isFloat && fmt.BitsPerSample != 16) { cap.Dispose(); throw new NotSupportedException("Unsupported loopback format " + fmt); }
        _converter = new PcmConverter(fmt.SampleRate, fmt.Channels, isFloat);
        cap.DataAvailable += (_, e) => _converter?.Process(e.Buffer.AsSpan(0, e.BytesRecorded), _onPacket);
        cap.StartRecording();
        _capture = cap;
    }

    public void Stop()
    {
        var cap = _capture;
        _capture = null;
        if (cap == null) return;
        try { cap.StopRecording(); } catch (Exception) { }
        cap.Dispose();
    }

    public void Dispose() => Stop();
}
