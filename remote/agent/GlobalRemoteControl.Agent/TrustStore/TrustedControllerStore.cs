using System.Text.Json;
using GlobalRemoteControl.Agent.Crypto;

namespace GlobalRemoteControl.Agent.TrustStore;

public sealed record TrustedController(string Id, string Name, string PublicKey, DateTimeOffset AddedAt)
{
    public string Fingerprint => IdentityUtil.Fingerprint(Convert.FromBase64String(PublicKey));
}

/// <summary>
/// Controllers the local user approved at pairing. The stored public key (not anything the server says later) is
/// what session signatures are verified against.
/// </summary>
public sealed class TrustedControllerStore
{
    private readonly string _path;
    private readonly object _lock = new();
    private List<TrustedController> _items = new();

    public TrustedControllerStore(string path)
    {
        _path = path;
        Load();
    }

    public event Action? Changed;

    public IReadOnlyList<TrustedController> All { get { lock (_lock) return _items.ToList(); } }

    public TrustedController? Get(string? id)
    {
        if (id == null) return null;
        lock (_lock) return _items.FirstOrDefault(c => c.Id == id);
    }

    /// <summary>Adds (or replaces) a controller. The id must be derived from the key and the key must be P-256.</summary>
    public TrustedController Add(string id, string name, string publicKeyB64)
    {
        var spki = IdentityUtil.ParseP256Spki(publicKeyB64) ?? throw new ArgumentException("Invalid P-256 public key");
        if (IdentityUtil.DeriveId(spki) != id) throw new ArgumentException("Controller id does not match its public key");
        var c = new TrustedController(id, Settings.AgentSettings.NormalizeName(name), publicKeyB64, DateTimeOffset.UtcNow);
        lock (_lock)
        {
            _items.RemoveAll(x => x.Id == id);
            _items.Add(c);
            Save();
        }
        Changed?.Invoke();
        return c;
    }

    public bool Revoke(string id)
    {
        bool removed;
        lock (_lock)
        {
            removed = _items.RemoveAll(x => x.Id == id) > 0;
            if (removed) Save();
        }
        if (removed) Changed?.Invoke();
        return removed;
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
