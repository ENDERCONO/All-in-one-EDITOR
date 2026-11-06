using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>Per-test scratch directory, deleted on dispose.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "grc-tests-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public string File(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (Exception) { } }
}

/// <summary>A controller (browser) identity: P-256 key, signs like WebCrypto (P1363).</summary>
public sealed class TestKey : IDisposable
{
    public ECDsa Key { get; }
    public string PublicKeyB64 { get; }
    public byte[] Spki { get; }
    public string Id { get; }
    public string Name { get; }

    public TestKey(string name = "Test Browser", ECCurve? curve = null)
    {
        Name = name;
        Key = ECDsa.Create(curve ?? ECCurve.NamedCurves.nistP256);
        Spki = Key.ExportSubjectPublicKeyInfo();
        PublicKeyB64 = Convert.ToBase64String(Spki);
        Id = IdentityUtil.DeriveId(Spki);
    }

    public string Sign(string data) => Convert.ToBase64String(
        Key.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

    public string SignDer(string data) => Convert.ToBase64String(
        Key.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));

    public void Dispose() => Key.Dispose();
}

public static class Msg
{
    public static JsonElement Of(object o) => Parse(Json.Serialize(o));
    public static JsonElement Parse(string json) { using var d = JsonDocument.Parse(json); return d.RootElement.Clone(); }
    public static string NewId() => IdentityUtil.Base64Url(RandomNumberGenerator.GetBytes(16))[..22];
}

public sealed class FakeSignal : ISignalSender
{
    public List<JsonElement> Sent { get; } = new();
    public Task SendAsync(object message) { lock (Sent) Sent.Add(Msg.Of(message)); return Task.CompletedTask; }
    public List<JsonElement> OfType(string type)
    {
        lock (Sent) return Sent.Where(s => s.GetProperty("type").GetString() == type).ToList();
    }
    public JsonElement Last { get { lock (Sent) return Sent[^1]; } }
    public int Count { get { lock (Sent) return Sent.Count; } }
}

public sealed class FakePrompts : IUserPrompts
{
    public Func<Task<bool>> Pairing = () => Task.FromResult(true);
    public Func<Task<ApprovalResult>> Session = () => Task.FromResult(ApprovalResult.Control);
    public Func<string, Task<string?>> IncomingFile = _ => Task.FromResult<string?>(null);
    public int PairingCalls, SessionCalls, FileCalls;
    public string? LastFileName;

    public Task<bool> ApprovePairingAsync(string controllerName, string controllerId, string fingerprint, TimeSpan timeout)
    { Interlocked.Increment(ref PairingCalls); return Pairing(); }
    public Task<ApprovalResult> ApproveSessionAsync(string label, string fingerprint, string? reason, bool allowControl, TimeSpan timeout)
    { Interlocked.Increment(ref SessionCalls); return Session(); }
    public Task<string?> ApproveIncomingFileAsync(string label, string fingerprint, string fileName, long size, TimeSpan timeout)
    { Interlocked.Increment(ref FileCalls); LastFileName = fileName; return IncomingFile(fileName); }
    public Task<string?> PickFileToSendAsync() => Task.FromResult<string?>(null);
}
