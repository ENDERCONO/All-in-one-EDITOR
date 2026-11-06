using System.Security.Cryptography;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Session;

namespace GlobalRemoteControl.Agent.FileTransfer;

/// <summary>
/// File transfer for one browser session: at most one active transfer per direction. Incoming files need local
/// approval + a Save dialog each time; outgoing files start from the local user's tray action.
/// </summary>
public sealed class FileTransferManager : IDisposable
{
    public const int ChunkSize = 16000;
    private const long ProgressEvery = 1024 * 1024;
    private const ulong MaxFileBuffered = 1024 * 1024;

    private readonly string _label, _controllerId, _fingerprint;
    private readonly bool _viewOnly;
    private readonly Action<object> _sendControl;
    private readonly Action<byte[]> _sendChunk;
    private readonly Func<ulong> _fileBuffered;
    private readonly IUserPrompts _prompts;
    private readonly AuditLog _audit;
    private readonly string? _tempDir;
    private readonly string? _autoAcceptDir;
    private readonly object _lock = new();

    // incoming
    private string? _inId;           // set from offer until done
    private IncomingFile? _inFile;   // set once accepted
    private string? _inSha;          // set by file-end
    private long _lastProgress;
    private CancellationTokenSource? _inPromptCts; // while the approval dialog for _inId is open
    // outgoing
    private string? _outId;
    private TaskCompletionSource<bool>? _outAnswer;
    private CancellationTokenSource? _outCts;
    private bool _disposed;

    public FileTransferManager(string label, string controllerId, string fingerprint, bool viewOnly,
        Action<object> sendControl, Action<byte[]> sendChunk, Func<ulong> fileBuffered,
        IUserPrompts prompts, AuditLog audit, string? tempDir = null, string? autoAcceptDir = null)
    {
        _label = label; _controllerId = controllerId; _fingerprint = fingerprint; _viewOnly = viewOnly;
        _sendControl = sendControl; _sendChunk = sendChunk; _fileBuffered = fileBuffered;
        _prompts = prompts; _audit = audit; _tempDir = tempDir; _autoAcceptDir = autoAcceptDir;
    }

    /// <summary>The folder uploads from a "my device" go to without a dialog.</summary>
    public static string DefaultInbox => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "GlobalRemoteControl");

    /// <summary><paramref name="dir"/>\name, or "name (2).ext", "name (3).ext" … — never an existing file.</summary>
    internal static string UniquePath(string dir, string safeName)
    {
        Directory.CreateDirectory(dir);
        var stem = Path.GetFileNameWithoutExtension(safeName);
        var ext = Path.GetExtension(safeName);
        for (int i = 1; i < 10000; i++)
        {
            var candidate = Path.Combine(dir, i == 1 ? safeName : $"{stem} ({i}){ext}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
        }
        throw new IOException("Too many files with that name");
    }

    public bool OutgoingActive { get { lock (_lock) return _outId != null; } }

    /// <summary>Handles file-* control messages. Returns a task only so tests can await the approval flow.</summary>
    public Task Handle(ControlMessage msg) => msg switch
    {
        FileOfferMsg o => OnOfferAsync(o),
        FileEndMsg e => Run(() => OnEnd(e)),
        FileCancelMsg c => Run(() => OnCancel(c.Id)),
        FileAcceptMsg a => Run(() => OnOutgoingAnswer(a.Id, true)),
        FileRejectMsg r => Run(() => OnOutgoingAnswer(r.Id, false)),
        _ => Task.CompletedTask,
    };

    private static Task Run(Action a) { a(); return Task.CompletedTask; }

    private async Task OnOfferAsync(FileOfferMsg o)
    {
        string? reject = null;
        lock (_lock)
        {
            if (_disposed) return;
            if (_viewOnly) reject = "view-only";
            else if (_inId != null) reject = "busy";
            else if (o.Size > IncomingFile.MaxSize) reject = "too-large";
            else { _inId = o.Id; _inPromptCts = new CancellationTokenSource(); }
        }
        if (reject != null)
        {
            _audit.Write("file-offer-rejected", _label, _controllerId, $"{FileNameSanitizer.Sanitize(o.Name)} ({o.Size} bytes): {reject}");
            _sendControl(new { t = "file-reject", id = o.Id, reason = reject });
            return;
        }

        var safeName = FileNameSanitizer.Sanitize(o.Name);
        _audit.Write("file-offer", _label, _controllerId, $"{safeName} ({o.Size} bytes)");
        string? dest = null;
        CancellationToken promptToken;
        lock (_lock) promptToken = _inPromptCts?.Token ?? new CancellationToken(true);
        if (_autoAcceptDir != null)
        {
            // "my device" (PROTOCOL section 8): no dialog, fixed folder, never overwrites
            try { dest = UniquePath(_autoAcceptDir, safeName); }
            catch (Exception) { dest = null; }
        }
        else
        {
            try { dest = await _prompts.ApproveIncomingFileAsync(_label, _fingerprint, safeName, o.Size, TimeSpan.FromSeconds(60), promptToken); }
            catch (Exception) { dest = null; }
        }
        lock (_lock) { _inPromptCts?.Dispose(); _inPromptCts = null; }

        bool finalizeNow = false;
        lock (_lock)
        {
            if (_disposed || _inId != o.Id) return; // cancelled meanwhile
            if (dest == null) { _inId = null; reject = "denied"; }
            else
            {
                try { _inFile = new IncomingFile(dest, o.Size, _tempDir); _lastProgress = 0; finalizeNow = o.Size == 0 && _inSha != null; }
                catch (Exception) { _inId = null; reject = "write-failed"; }
            }
        }
        if (reject != null)
        {
            _audit.Write("file-denied", _label, _controllerId, safeName);
            _sendControl(new { t = "file-reject", id = o.Id, reason = reject });
            return;
        }
        _audit.Write("file-accepted", _label, _controllerId, $"{safeName} -> {dest}");
        _sendControl(new { t = "file-accept", id = o.Id });
        if (finalizeNow) TryFinalize();
    }

    /// <summary>Binary message on the "file" channel.</summary>
    public void OnChunk(byte[] data)
    {
        string? failId = null;
        object? progress = null;
        lock (_lock)
        {
            if (_inFile == null || _inId == null) return; // not accepted: ignore
            if (!_inFile.Write(data))
            {
                failId = _inId;
                _inFile.Abort(); _inFile = null; _inId = null; _inSha = null;
            }
            else if (_inFile.Received - _lastProgress >= ProgressEvery || _inFile.IsComplete)
            {
                _lastProgress = _inFile.Received;
                progress = new { t = "file-progress", id = _inId, received = _inFile.Received };
            }
        }
        if (failId != null)
        {
            _audit.Write("file-failed", _label, _controllerId, "more data than announced");
            _sendControl(new { t = "file-done", id = failId, ok = false, reason = "size-mismatch" });
            return;
        }
        if (progress != null) _sendControl(progress);
        TryFinalize();
    }

    private void OnEnd(FileEndMsg e)
    {
        lock (_lock)
        {
            if (_inId != e.Id) return;
            _inSha = e.Sha256;
        }
        TryFinalize();
    }

    /// <summary>Finalize only once both file-end (hash) and all bytes have arrived (separate SCTP streams).</summary>
    private void TryFinalize()
    {
        IncomingFile? file; string? id, sha;
        lock (_lock)
        {
            if (_inFile == null || _inSha == null || !_inFile.IsComplete) return;
            file = _inFile; id = _inId; sha = _inSha;
            _inFile = null; _inId = null; _inSha = null;
        }
        var (ok, reason) = file.Finish(sha);
        file.Dispose();
        _audit.Write(ok ? "file-received" : "file-failed", _label, _controllerId, ok ? file.DestinationPath : reason);
        _sendControl(ok ? new { t = "file-done", id, ok = true } : (object)new { t = "file-done", id, ok = false, reason });
    }

    private void OnCancel(string id)
    {
        bool cancelledIn = false;
        lock (_lock)
        {
            if (_inId == id)
            {
                CancelPrompt();
                _inFile?.Abort(); _inFile?.Dispose(); _inFile = null; _inId = null; _inSha = null;
                cancelledIn = true;
            }
            else if (_outId == id) _outCts?.Cancel();
        }
        if (cancelledIn) _audit.Write("file-cancelled", _label, _controllerId, id);
    }

    private void OnOutgoingAnswer(string id, bool accepted)
    {
        lock (_lock) if (_outId == id) _outAnswer?.TrySetResult(accepted);
    }

    /// <summary>Local user chose "Send a file to the remote device". Streams after the controller accepts.</summary>
    public async Task<bool> SendFileAsync(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length > IncomingFile.MaxSize) return false;
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        var answer = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cts = new CancellationTokenSource();
        lock (_lock)
        {
            if (_disposed || _outId != null) return false;
            _outId = id; _outAnswer = answer; _outCts = cts;
        }
        var name = FileNameSanitizer.Sanitize(info.Name);
        try
        {
            _audit.Write("file-send-offer", _label, _controllerId, $"{name} ({info.Length} bytes)");
            _sendControl(new { t = "file-offer", id, name, size = info.Length });
            bool accepted;
            try { accepted = await answer.Task.WaitAsync(TimeSpan.FromMinutes(2), cts.Token); }
            catch (Exception) { accepted = false; }
            if (!accepted) { _audit.Write("file-send-declined", _label, _controllerId, name); return false; }

            using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true);
            var buf = new byte[ChunkSize];
            int n;
            while ((n = await fs.ReadAsync(buf, cts.Token)) > 0)
            {
                while (_fileBuffered() > MaxFileBuffered) await Task.Delay(10, cts.Token);
                var chunk = buf.AsSpan(0, n).ToArray();
                sha.AppendData(chunk);
                _sendChunk(chunk);
            }
            _sendControl(new { t = "file-end", id, sha256 = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant() });
            _audit.Write("file-sent", _label, _controllerId, name);
            return true;
        }
        catch (Exception ex)
        {
            _audit.Write("file-send-failed", _label, _controllerId, $"{name}: {ex.Message}");
            return false;
        }
        finally
        {
            lock (_lock) { _outId = null; _outAnswer = null; _outCts = null; }
            cts.Dispose();
        }
    }

    /// <summary>Closes an open "accept this file?" dialog (caller holds the lock).</summary>
    private void CancelPrompt()
    {
        try { _inPromptCts?.Cancel(); } catch (Exception) { }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _disposed = true;
            CancelPrompt();
            _inFile?.Abort(); _inFile?.Dispose(); _inFile = null; _inId = null;
            _outCts?.Cancel();
        }
    }
}
