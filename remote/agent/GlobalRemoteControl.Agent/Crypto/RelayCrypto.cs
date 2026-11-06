using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace GlobalRemoteControl.Agent.Crypto;

/// <summary>
/// The per-session ephemeral ECDH P-256 key (PROTOCOL.md section 4). Its public half goes into the signed answer;
/// the private half stays in memory for the relay fallback (section 7) and dies with the session.
/// </summary>
public sealed class EphemeralEcdh : IDisposable
{
    private readonly ECDiffieHellman _key;

    public EphemeralEcdh() : this(ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256)) { }

    /// <summary>Fixed key (tests / cross-implementation vectors).</summary>
    internal EphemeralEcdh(ECDiffieHellman key)
    {
        _key = key;
        SpkiBase64 = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
    }

    internal static EphemeralEcdh FromPrivateKey(byte[] d, byte[] x, byte[] y) =>
        new(ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256, D = d, Q = new ECPoint { X = x, Y = y },
        }));

    /// <summary>Base64 SPKI DER of the public key (the <c>ecdh</c> field).</summary>
    public string SpkiBase64 { get; }

    /// <summary>True when <paramref name="b64"/> is a well-formed base64 P-256 SPKI.</summary>
    public static bool IsValidPeerKey(string? b64) => IdentityUtil.ParseP256Spki(b64) != null;

    /// <summary>Z = the 32-byte x-coordinate of the shared point (what WebCrypto deriveBits(256) returns).</summary>
    public byte[] DeriveSharedSecret(string peerSpkiB64)
    {
        var spki = IdentityUtil.ParseP256Spki(peerSpkiB64) ?? throw new CryptographicException("bad peer ECDH key");
        using var peer = ECDiffieHellman.Create();
        peer.ImportSubjectPublicKeyInfo(spki, out _);
        var z = _key.DeriveRawSecretAgreement(peer.PublicKey);
        if (z.Length != 32) throw new CryptographicException("unexpected shared secret length");
        return z;
    }

    public void Dispose() => _key.Dispose();
}

/// <summary>Relay key schedule (PROTOCOL.md section 7).</summary>
public static class RelayKeys
{
    public const string InfoC2D = "grc-relay c2d";
    public const string InfoD2C = "grc-relay d2c";

    /// <summary>key = HKDF-SHA256(Z, salt = UTF-8 sessionId, info, 32).</summary>
    public static (byte[] C2D, byte[] D2C) Derive(byte[] z, string sessionId)
    {
        var salt = Encoding.UTF8.GetBytes(sessionId);
        return (HKDF.DeriveKey(HashAlgorithmName.SHA256, z, 32, salt, Encoding.UTF8.GetBytes(InfoC2D)),
                HKDF.DeriveKey(HashAlgorithmName.SHA256, z, 32, salt, Encoding.UTF8.GetBytes(InfoD2C)));
    }
}

/// <summary>
/// Frame codec for the encrypted relay, byte-compatible with <c>RelayCodec</c> in remote/web/protocol.js:
/// <c>sessionId (22 ASCII) | counter u64 BE | AES-256-GCM(ciphertext | 16-byte tag)</c>, plaintext
/// <c>u8 channel | payload</c>, nonce <c>4 zero bytes | counter BE</c>, no additional authenticated data
/// (the counter is bound through the nonce, the sessionId through the HKDF salt). Each direction counts from 1;
/// the receiver drops counters that are not greater than the last accepted one and anything that fails to decrypt
/// (neither advances the replay counter).
/// </summary>
public sealed class RelayCodec : IDisposable
{
    public const int SessionIdLength = 22;
    public const int HeaderLength = SessionIdLength + 8;
    public const int TagLength = 16;
    public const int MinFrameLength = HeaderLength + 1 + TagLength;
    public const int MaxFrameLength = 64 * 1024;
    public const int MaxPayloadLength = MaxFrameLength - MinFrameLength;

    private readonly byte[] _sid;
    private readonly AesGcm _send, _recv;
    private readonly object _txLock = new(), _rxLock = new();
    private ulong _tx, _rxLast;

    public RelayCodec(string sessionId, byte[] sendKey, byte[] recvKey)
    {
        _sid = Encoding.ASCII.GetBytes(sessionId);
        if (_sid.Length != SessionIdLength || Encoding.UTF8.GetByteCount(sessionId) != SessionIdLength)
            throw new ArgumentException("bad sessionId", nameof(sessionId));
        _send = new AesGcm(sendKey, TagLength);
        _recv = new AesGcm(recvKey, TagLength);
    }

    /// <summary>The device end: sends with key_d2c, receives with key_c2d.</summary>
    public static RelayCodec ForDevice(string sessionId, byte[] z)
    {
        var (c2d, d2c) = RelayKeys.Derive(z, sessionId);
        try { return new RelayCodec(sessionId, d2c, c2d); }
        finally { CryptographicOperations.ZeroMemory(c2d); CryptographicOperations.ZeroMemory(d2c); }
    }

    /// <summary>The controller end (used by tests to play the browser).</summary>
    public static RelayCodec ForController(string sessionId, byte[] z)
    {
        var (c2d, d2c) = RelayKeys.Derive(z, sessionId);
        try { return new RelayCodec(sessionId, c2d, d2c); }
        finally { CryptographicOperations.ZeroMemory(c2d); CryptographicOperations.ZeroMemory(d2c); }
    }

    public ulong LastSentCounter { get { lock (_txLock) return _tx; } }
    public ulong LastReceivedCounter { get { lock (_rxLock) return _rxLast; } }

    private static void Nonce(Span<byte> nonce, ulong counter)
    {
        nonce[..4].Clear();
        BinaryPrimitives.WriteUInt64BigEndian(nonce[4..], counter);
    }

    /// <summary>Encrypts one message; the counter is assigned here, so frames must be sent in call order.</summary>
    public byte[] Encrypt(byte channel, ReadOnlySpan<byte> payload)
    {
        if (payload.Length > MaxPayloadLength) throw new ArgumentException("payload too large", nameof(payload));
        var plain = new byte[1 + payload.Length];
        plain[0] = channel;
        payload.CopyTo(plain.AsSpan(1));
        var frame = new byte[HeaderLength + plain.Length + TagLength];
        _sid.CopyTo(frame, 0);
        Span<byte> nonce = stackalloc byte[12];
        lock (_txLock)
        {
            var counter = ++_tx;
            BinaryPrimitives.WriteUInt64BigEndian(frame.AsSpan(SessionIdLength, 8), counter);
            Nonce(nonce, counter);
            _send.Encrypt(nonce, plain, frame.AsSpan(HeaderLength, plain.Length), frame.AsSpan(HeaderLength + plain.Length, TagLength));
        }
        return frame;
    }

    /// <summary>Returns false (frame dropped) for a wrong session, a replayed/old counter, tampering or a bad size.</summary>
    public bool TryDecrypt(ReadOnlySpan<byte> frame, out byte channel, out byte[] payload)
    {
        channel = 0; payload = Array.Empty<byte>();
        if (frame.Length < MinFrameLength || frame.Length > MaxFrameLength) return false;
        if (!frame[..SessionIdLength].SequenceEqual(_sid)) return false;
        var counter = BinaryPrimitives.ReadUInt64BigEndian(frame.Slice(SessionIdLength, 8));
        var ctLen = frame.Length - HeaderLength - TagLength;
        var plain = new byte[ctLen];
        Span<byte> nonce = stackalloc byte[12];
        Nonce(nonce, counter);
        lock (_rxLock)
        {
            if (counter <= _rxLast) return false;
            try { _recv.Decrypt(nonce, frame.Slice(HeaderLength, ctLen), frame.Slice(HeaderLength + ctLen, TagLength), plain); }
            catch (CryptographicException) { return false; }
            _rxLast = counter;
        }
        channel = plain[0];
        payload = plain.AsSpan(1).ToArray();
        return true;
    }

    public void Dispose()
    {
        _send.Dispose();
        _recv.Dispose();
    }
}
