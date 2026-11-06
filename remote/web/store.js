// Tiny IndexedDB wrapper: a key/value store ("kv") and the paired devices ("devices").
// Falls back to memory when IndexedDB is unavailable (the app then warns that nothing persists).

let dbPromise = null;
const mem = { kv: new Map(), devices: new Map() };
export let persistent = true;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('grc-web', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('devices', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => { persistent = false; resolve(null); };
    } catch { persistent = false; resolve(null); }
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function kvGet(key) {
  const r = await run('kv', 'readonly', (s) => s.get(key)).catch(() => null);
  return r === null ? mem.kv.get(key) : r;
}
export async function kvSet(key, value) {
  mem.kv.set(key, value);
  await run('kv', 'readwrite', (s) => s.put(value, key)).catch(() => {});
}

export async function listDevices() {
  const r = await run('devices', 'readonly', (s) => s.getAll()).catch(() => null);
  return r === null ? [...mem.devices.values()] : r;
}
export async function putDevice(dev) {
  mem.devices.set(dev.id, dev);
  await run('devices', 'readwrite', (s) => s.put(dev)).catch(() => {});
}
export async function deleteDevice(id) {
  mem.devices.delete(id);
  await run('devices', 'readwrite', (s) => s.delete(id)).catch(() => {});
}
export async function ready() { await openDb(); return persistent; }
