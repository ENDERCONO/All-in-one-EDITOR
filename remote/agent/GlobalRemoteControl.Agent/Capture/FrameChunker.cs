using System.Buffers.Binary;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Splits an encoded frame into video-channel messages (PROTOCOL.md section 5):
/// 8-byte little-endian header <c>u32 frameId, u16 chunkIndex, u16 chunkCount</c> followed by at most 16 000 bytes.
/// </summary>
public static class FrameChunker
{
    public const int HeaderSize = 8;
    public const int MaxPayload = 16000;

    public static List<byte[]> Split(uint frameId, ReadOnlySpan<byte> frame)
    {
        int count = Math.Max(1, (frame.Length + MaxPayload - 1) / MaxPayload);
        if (count > ushort.MaxValue) throw new ArgumentException("Frame too large", nameof(frame));
        var chunks = new List<byte[]>(count);
        for (int i = 0; i < count; i++)
        {
            int offset = i * MaxPayload;
            int len = Math.Min(MaxPayload, frame.Length - offset);
            var msg = new byte[HeaderSize + len];
            BinaryPrimitives.WriteUInt32LittleEndian(msg.AsSpan(0, 4), frameId);
            BinaryPrimitives.WriteUInt16LittleEndian(msg.AsSpan(4, 2), (ushort)i);
            BinaryPrimitives.WriteUInt16LittleEndian(msg.AsSpan(6, 2), (ushort)count);
            frame.Slice(offset, len).CopyTo(msg.AsSpan(HeaderSize));
            chunks.Add(msg);
        }
        return chunks;
    }
}

/// <summary>Reassembles chunks into frames the way the browser does (used by tests).</summary>
public sealed class FrameReassembler
{
    private uint _frameId;
    private byte[]?[]? _parts;
    private int _received;

    /// <summary>Returns the complete frame when the last missing chunk arrives, else null.</summary>
    public (uint FrameId, byte[] Data)? Add(byte[] message)
    {
        if (message.Length < FrameChunker.HeaderSize) return null;
        uint id = BinaryPrimitives.ReadUInt32LittleEndian(message.AsSpan(0, 4));
        ushort index = BinaryPrimitives.ReadUInt16LittleEndian(message.AsSpan(4, 2));
        ushort count = BinaryPrimitives.ReadUInt16LittleEndian(message.AsSpan(6, 2));
        if (count == 0 || index >= count) return null;
        if (_parts == null || id != _frameId)
        {
            if (_parts != null && id < _frameId) return null; // older partial frame: ignore
            _frameId = id; _parts = new byte[count][]; _received = 0;
        }
        if (_parts.Length != count || _parts[index] != null) return null;
        _parts[index] = message.AsSpan(FrameChunker.HeaderSize).ToArray();
        if (++_received < count) return null;
        var data = _parts.SelectMany(p => p!).ToArray();
        _parts = null;
        return (id, data);
    }
}
