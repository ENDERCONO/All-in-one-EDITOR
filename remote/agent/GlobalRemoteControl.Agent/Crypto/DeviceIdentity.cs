using System.Security.Cryptography;
using System.Text;

namespace GlobalRemoteControl.Agent.Crypto;

/// <summary>
/// The device's ECDSA P-256 key pair. Generated on first run; the PKCS#8 private key is stored DPAPI-protected
/// (CurrentUser scope) so only this Windows user on this PC can use it.
/// </summary>
public sealed class DeviceIdentity : IDisposable
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("GlobalRemoteControl.DeviceKey.v1");
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

    public static DeviceIdentity LoadOrCreate(string keyFile)
    {
        if (File.Exists(keyFile))
        {
            var pkcs8 = ProtectedData.Unprotect(File.ReadAllBytes(keyFile), Entropy, DataProtectionScope.CurrentUser);
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
            File.WriteAllBytes(tmp, ProtectedData.Protect(raw, Entropy, DataProtectionScope.CurrentUser));
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
