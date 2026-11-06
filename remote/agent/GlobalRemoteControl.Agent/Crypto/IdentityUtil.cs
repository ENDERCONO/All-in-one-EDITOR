using System.Security.Cryptography;
using System.Text;

namespace GlobalRemoteControl.Agent.Crypto;

/// <summary>Identity derivation and signature verification exactly as PROTOCOL.md "Trust model" specifies.</summary>
public static class IdentityUtil
{
    public const int SignatureLength = 64; // IEEE P1363 r||s for P-256

    /// <summary>id = base64url(SHA-256(SPKI DER)).slice(0, 22)</summary>
    public static string DeriveId(byte[] spki) => Base64Url(SHA256.HashData(spki))[..22];

    /// <summary>First 8 bytes of SHA-256(SPKI) as uppercase hex in groups of 4: AB12-CD34-EF56-7890.</summary>
    public static string Fingerprint(byte[] spki)
    {
        var hex = Convert.ToHexString(SHA256.HashData(spki), 0, 8);
        return $"{hex[..4]}-{hex[4..8]}-{hex[8..12]}-{hex[12..16]}";
    }

    public static string Base64Url(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decodes a base64 SPKI and checks it is an ECDSA P-256 public key. Returns null otherwise.</summary>
    public static byte[]? ParseP256Spki(string? b64)
    {
        if (string.IsNullOrEmpty(b64) || b64.Length > 400) return null;
        try
        {
            var der = Convert.FromBase64String(b64);
            using var ec = ECDsa.Create();
            ec.ImportSubjectPublicKeyInfo(der, out int read);
            if (read != der.Length) return null;
            if (ec.KeySize != 256) return null;
            var oid = ec.ExportParameters(false).Curve.Oid;
            bool isP256 = oid.Value == "1.2.840.10045.3.1.7" ||
                          (oid.Value == null && (oid.FriendlyName == "nistP256" || oid.FriendlyName == "ECDSA_P256"));
            if (!isP256) return null;
            return der;
        }
        catch (Exception) { return null; }
    }

    /// <summary>Verifies an ECDSA-SHA256 P1363 signature (base64) over the UTF-8 bytes of <paramref name="data"/>.
    /// Never throws; any malformed input is simply "not valid".</summary>
    public static bool Verify(string? publicKeyB64, string data, string? signatureB64)
    {
        try
        {
            var spki = ParseP256Spki(publicKeyB64);
            if (spki == null || string.IsNullOrEmpty(signatureB64) || signatureB64.Length > 100) return false;
            var sig = Convert.FromBase64String(signatureB64);
            if (sig.Length != SignatureLength) return false;
            using var ec = ECDsa.Create();
            ec.ImportSubjectPublicKeyInfo(spki, out _);
            return ec.VerifyData(Encoding.UTF8.GetBytes(data), sig, HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception) { return false; }
    }

    // Signed strings (PROTOCOL.md sections 1 and 4)
    public static string AuthString(string role, string nonce) => $"grc-auth:{role}:{nonce}";
    public static string SessionAuthString(string sessionId, string nonce, string deviceId) => $"grc-session:{sessionId}:{nonce}:{deviceId}";
    // ecdh = the sender's ephemeral ECDH P-256 public key (base64 SPKI); it keys the relay fallback (section 7)
    public static string OfferString(string sessionId, string ecdh, string sdp) => $"grc-offer:{sessionId}:{ecdh}:{sdp}";
    public static string AnswerString(string sessionId, string ecdh, string sdp) => $"grc-answer:{sessionId}:{ecdh}:{sdp}";

    public static string RandomNonce() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
}
