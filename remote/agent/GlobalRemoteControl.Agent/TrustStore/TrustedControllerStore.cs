using System.Text.Json;
using System.Text.Json.Serialization;
using GlobalRemoteControl.Agent.Crypto;

namespace GlobalRemoteControl.Agent.TrustStore;

/// <param name="Owner">"My device" (PROTOCOL section 8): sessions and uploads need no dialog, and it may answer
/// approvals for the PC. Off by default; only the local UI sets it.</param>
public sealed record TrustedController(string Id, string Name, string PublicKey, DateTimeOffset AddedAt, bool Owner = false)
{
    public string Fingerprint => IdentityUtil.Fingerprint(Convert.FromBase64String(PublicKey));

    /// <summary>Approved "once" from a my-device: in memory only, good for one session (never saved).</summary>
    [JsonIgnore] public bool Temporary { get; init; }
}

/// <summary>
/// Controllers the local user approved at pairing. The stored public key (not anything the server says later) is
/// what session signatures are verified against.
/// </summary>
public sealed class TrustedControllerStore
{
    /// <summary>How long a "once" approval waits for its single session.</summary>
    public static readonly TimeSpan OnceWindow = TimeSpan.FromMinutes(10);

    private sealed class Temp
    {
        public required TrustedController Controller;
        public required DateTimeOffset Expires;
        public bool Used;
    }

    private readonly string _path;
    private readonly object _lock = new();
    private readonly Func<DateTimeOffset> _now;
    private List<TrustedController> _items = new();
    private readonly Dictionary<string, Temp> _temps = new();

    public TrustedControllerStore(string path, Func<DateTimeOffset>? now = null)
    {
        _path = path;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        Load();
    }

    public event Action? Changed;

    /// <summary>Saved (paired) controllers. "Once" controllers are not listed.</summary>
    public IReadOnlyList<TrustedController> All { get { lock (_lock) return _items.ToList(); } }

    /// <summary>My-device controllers.</summary>
    public IReadOnlyList<TrustedController> Owners { get { lock (_lock) return _items.Where(c => c.Owner).ToList(); } }

    /// <summary>A saved controller, or an unused, unexpired "once" controller.</summary>
    public TrustedController? Get(string? id)
    {
        if (id == null) return null;
        lock (_lock)
        {
            var c = _items.FirstOrDefault(c => c.Id == id);
            if (c != null) return c;
            return _temps.TryGetValue(id, out var t) && !t.Used && t.Expires > _now() ? t.Controller : null;
        }
    }

    /// <summary>Adds (or replaces) a controller. The id must be derived from the key and the key must be P-256.</summary>
    public TrustedController Add(string id, string name, string publicKeyB64)
    {
        var c = Validate(id, name, publicKeyB64);
        lock (_lock)
        {
            var old = _items.FirstOrDefault(x => x.Id == id);
            if (old != null) c = c with { Owner = old.Owner }; // re-pairing keeps the local user's choice
            _items.RemoveAll(x => x.Id == id);
            _temps.Remove(id);
            _items.Add(c);
            Save();
        }
        Changed?.Invoke();
        return c;
    }

    /// <summary>"Once" approval (PROTOCOL section 8): kept in memory for one session within <see cref="OnceWindow"/>.</summary>
    public TrustedController AddTemporary(string id, string name, string publicKeyB64)
    {
        var c = Validate(id, name, publicKeyB64) with { Temporary = true };
        lock (_lock)
        {
            if (_items.Any(x => x.Id == id)) throw new InvalidOperationException("Already paired");
            _temps[id] = new Temp { Controller = c, Expires = _now() + OnceWindow };
        }
        return c;
    }

    /// <summary>Uses up a "once" approval. True exactly once, and only before it expires.</summary>
    public bool TryUseOnce(string id)
    {
        lock (_lock)
        {
            if (!_temps.TryGetValue(id, out var t) || t.Used || t.Expires <= _now()) return false;
            t.Used = true;
            return true;
        }
    }

    public void RemoveTemporary(string id)
    {
        lock (_lock) _temps.Remove(id);
    }

    /// <summary>Marks a saved controller as "my device" or not. Local UI only.</summary>
    public bool SetOwner(string id, bool owner)
    {
        lock (_lock)
        {
            var i = _items.FindIndex(x => x.Id == id);
            if (i < 0 || _items[i].Owner == owner) return false;
            _items[i] = _items[i] with { Owner = owner };
            Save();
        }
        Changed?.Invoke();
        return true;
    }

    public bool Revoke(string id)
    {
        bool removed;
        lock (_lock)
        {
            removed = _items.RemoveAll(x => x.Id == id) > 0;
            _temps.Remove(id);
            if (removed) Save();
        }
        if (removed) Changed?.Invoke();
        return removed;
    }

    private static TrustedController Validate(string id, string name, string publicKeyB64)
    {
        var spki = IdentityUtil.ParseP256Spki(publicKeyB64) ?? throw new ArgumentException("Invalid P-256 public key");
        if (IdentityUtil.DeriveId(spki) != id) throw new ArgumentException("Controller id does not match its public key");
        return new TrustedController(id, Settings.AgentSettings.NormalizeName(name), publicKeyB64, DateTimeOffset.UtcNow);
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var list = JsonSerializer.Deserialize<List<TrustedController>>(File.ReadAllText(_path)) ?? new();
            // Drop anything that does not validate (tampered file).
            _items = list.Where(c => c.Id != null && c.PublicKey != null &&
                                     IdentityUtil.ParseP256Spki(c.PublicKey) is { } spki &&
                                     IdentityUtil.DeriveId(spki) == c.Id).ToList();
        }
        catch (Exception) { _items = new(); }
    }

    private void Save() => AgentPaths.WriteAtomic(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
}
