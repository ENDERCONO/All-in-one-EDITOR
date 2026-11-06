using System.Security.Cryptography;

namespace GlobalRemoteControl.Agent.FileTransfer;

/// <summary>
/// One incoming file: written to a temp file, size and SHA-256 verified, then moved to the destination the local
/// user chose. Nothing appears at the destination unless verification passes.
/// </summary>
public sealed class IncomingFile : IDisposable
{
    public const long MaxSize = 2L * 1024 * 1024 * 1024; // 2 GiB

    private readonly FileStream _stream;
    private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    private bool _closed;

    public IncomingFile(string destinationPath, long expectedSize, string? tempDir = null)
    {
        if (expectedSize < 0 || expectedSize > MaxSize) throw new ArgumentOutOfRangeException(nameof(expectedSize));
        DestinationPath = destinationPath;
        ExpectedSize = expectedSize;
        var dir = tempDir ?? Path.Combine(Path.GetTempPath(), "GlobalRemoteControl");
        Directory.CreateDirectory(dir);
        TempPath = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".part");
        _stream = new FileStream(TempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
    }

    public string DestinationPath { get; }
    public string TempPath { get; }
    public long ExpectedSize { get; }
    public long Received { get; private set; }
    public bool IsComplete => Received == ExpectedSize;

    /// <summary>Appends a chunk. False (and nothing written) if it would exceed the announced size.</summary>
    public bool Write(ReadOnlySpan<byte> chunk)
    {
        if (_closed || Received + chunk.Length > ExpectedSize) return false;
        _stream.Write(chunk);
        _hash.AppendData(chunk);
        Received += chunk.Length;
        return true;
    }

    /// <summary>Verifies size + hash and moves the file into place. On failure the temp file is deleted.</summary>
    public (bool Ok, string? Reason) Finish(string expectedSha256Hex)
    {
        if (_closed) return (false, "closed");
        _closed = true;
        _stream.Dispose();
        try
        {
            if (Received != ExpectedSize) { Delete(); return (false, "size-mismatch"); }
            var actual = _hash.GetHashAndReset();
            byte[] expected;
            try { expected = Convert.FromHexString(expectedSha256Hex); } catch (FormatException) { Delete(); return (false, "hash-mismatch"); }
            if (expected.Length != 32 || !CryptographicOperations.FixedTimeEquals(actual, expected)) { Delete(); return (false, "hash-mismatch"); }
            File.Move(TempPath, DestinationPath, overwrite: true); // the Save dialog already confirmed overwrite
            return (true, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Delete();
            return (false, "write-failed");
        }
    }

    public void Abort()
    {
        if (_closed) return;
        _closed = true;
        _stream.Dispose();
        Delete();
    }

    private void Delete()
    {
        try { File.Delete(TempPath); } catch (Exception) { }
    }

    public void Dispose() { Abort(); _hash.Dispose(); }

    public static string Sha256Hex(ReadOnlySpan<byte> data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}
