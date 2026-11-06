using System.Security.Cryptography;
using System.Text;

namespace GlobalRemoteControl.Agent.Crypto;

/// <summary>Protects the device's private key at rest. Production always uses <see cref="DpapiKeyProtector"/>.</summary>
public interface IKeyProtector
{
    byte[] Protect(byte[] data);
    byte[] Unprotect(byte[] data);
}

/// <summary>DPAPI, CurrentUser scope: only this Windows user on this PC can unprotect the key (Windows only).</summary>
public sealed class DpapiKeyProtector : IKeyProtector
{
    public static readonly DpapiKeyProtector Instance = new();
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("GlobalRemoteControl.DeviceKey.v1");
    public byte[] Protect(byte[] data) => ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser);
    public byte[] Unprotect(byte[] data) => ProtectedData.Unprotect(data, Entropy, DataProtectionScope.CurrentUser);
}

/// <summary>
/// The device's ECDSA P-256 key pair. Generated on first run; the PKCS#8 private key is stored DPAPI-protected
/// (CurrentUser scope) so only this Windows user on this PC can use it.
/// </summary>
public sealed class DeviceIdentity : IDisposable
{
    private readonly ECDsa _key;

    private DeviceIdentity(ECDsa key)
    {
        _key = key;
        PublicKeySpki = key.ExportSubjectPublicKeyInfo();
        PublicKeyBase64 = Convert.ToBase64String(PublicKeySpki);
        DeviceId = IdentityUtil.DeriveId(PublicKeySpki);
        Fingerprint = IdentityUtil.Fingerprint(PublicKeySpki);
    }

    public byte[] PublicKeySpki { get; }
    public string PublicKeyBase64 { get; }
    public string DeviceId { get; }
    public string Fingerprint { get; }

    /// <summary>Wraps an existing P-256 key (takes ownership). Never persisted; used by tests.</summary>
    public static DeviceIdentity FromKey(ECDsa key)
    {
        if (key.KeySize != 256) throw new ArgumentException("P-256 key required", nameof(key));
        return new DeviceIdentity(key);
    }

    /// <summary>A fresh in-memory identity that is never written anywhere (tests).</summary>
    public static DeviceIdentity CreateEphemeral() => new(ECDsa.Create(ECCurve.NamedCurves.nistP256));

    /// <summary>Loads the key from <paramref name="keyFile"/> or creates and stores a new one.
    /// <paramref name="protector"/> defaults to DPAPI, which is what the app always uses.</summary>
    public static DeviceIdentity LoadOrCreate(string keyFile, IKeyProtector? protector = null)
    {
        protector ??= DpapiKeyProtector.Instance;
        if (File.Exists(keyFile))
        {
            var pkcs8 = protector.Unprotect(File.ReadAllBytes(keyFile));
            try
            {
                var ec = ECDsa.Create();
                ec.ImportPkcs8PrivateKey(pkcs8, out _);
                return new DeviceIdentity(ec);
            }
            finally { CryptographicOperations.ZeroMemory(pkcs8); }
        }
        var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var raw = key.ExportPkcs8PrivateKey();
        try
        {
            var tmp = keyFile + ".tmp";
            File.WriteAllBytes(tmp, protector.Protect(raw));
            File.Move(tmp, keyFile, overwrite: true);
        }
        finally { CryptographicOperations.ZeroMemory(raw); }
        return new DeviceIdentity(key);
    }

    /// <summary>ECDSA-SHA256 over UTF-8 bytes, IEEE P1363 encoded, base64.</summary>
    public string Sign(string data) => Convert.ToBase64String(
        _key.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

    public void Dispose() => _key.Dispose();
}
