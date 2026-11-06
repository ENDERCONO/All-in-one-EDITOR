namespace GlobalRemoteControl.Agent.Audio;

/// <summary>
/// Converts interleaved float32 or s16 PCM at any rate/channel count into mono 24 kHz s16le and emits
/// 20 ms packets (480 samples = 960 bytes). Linear-interpolation resampler, state carried between calls.
/// </summary>
public sealed class PcmConverter
{
    public const int OutRate = 24000;
    public const int SamplesPerPacket = 480;
    public const int PacketBytes = SamplesPerPacket * 2;

    private readonly int _inRate;
    private readonly int _channels;
    private readonly bool _isFloat;
    private readonly double _step;
    private double _pos;          // fractional position relative to _prev (0 = _prev, 1 = first new sample)
    private float _prev;
    private bool _hasPrev;
    private readonly byte[] _packet = new byte[PacketBytes];
    private int _packetFill;

    public PcmConverter(int inRate, int channels, bool isFloat)
    {
        if (inRate <= 0 || channels <= 0) throw new ArgumentException("bad format");
        _inRate = inRate; _channels = channels; _isFloat = isFloat;
        _step = inRate / (double)OutRate;
    }

    public void Process(ReadOnlySpan<byte> data, Action<byte[]> onPacket)
    {
        int bytesPerSample = _isFloat ? 4 : 2;
        int frameBytes = bytesPerSample * _channels;
        int frames = data.Length / frameBytes;
        for (int f = 0; f < frames; f++)
        {
            float sum = 0;
            for (int c = 0; c < _channels; c++)
            {
                var s = data.Slice(f * frameBytes + c * bytesPerSample, bytesPerSample);
                sum += _isFloat ? BitConverter.ToSingle(s) : BitConverter.ToInt16(s) / 32768f;
            }
            float cur = sum / _channels;
            if (!_hasPrev) { _prev = cur; _hasPrev = true; _pos = 0; continue; }
            // emit output samples that fall between _prev (t=0) and cur (t=1)
            while (_pos < 1.0)
            {
                Emit(_prev + (float)_pos * (cur - _prev), onPacket);
                _pos += _step;
            }
            _pos -= 1.0;
            _prev = cur;
        }
    }

    private void Emit(float v, Action<byte[]> onPacket)
    {
        short s = (short)Math.Clamp((int)Math.Round(v * 32767f), short.MinValue, short.MaxValue);
        _packet[_packetFill++] = (byte)s;
        _packet[_packetFill++] = (byte)(s >> 8);
        if (_packetFill == PacketBytes)
        {
            onPacket((byte[])_packet.Clone());
            _packetFill = 0;
        }
    }
}
