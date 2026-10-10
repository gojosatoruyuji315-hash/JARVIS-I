/**
 * Minimal promise wrapper around IndexedDB (key/value object stores).
 * Used for: device crypto keys (non-extractable CryptoKey objects) and file blobs.
 * Falls back to an in-memory Map if IndexedDB is unavailable (private mode, sandbox).
 * @module core/idb
 */
const DB_NAME = 'jarvis-x';
const STORES = ['keys', 'files', 'blobs'];
let dbPromise;
const memory = new Map(STORES.map((s) => [s, new Map()]));
let fallback = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { fallback = true; resolve(null); };
      req.onblocked = () => { fallback = true; resolve(null); };
    } catch { fallback = true; resolve(null); }
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, memory.get(store));
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      const r = fn(os);
      t.oncomplete = () => resolve(r instanceof IDBRequest ? r.result : r);
      t.onerror = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

export const idb = {
  get isFallback() { return fallback; },
  get: (store, key) => tx(store, 'readonly', (os, mem) => (os ? os.get(key) : mem.get(key))),
  set: (store, key, val) => tx(store, 'readwrite', (os, mem) => (os ? os.put(val, key) : mem.set(key, val))),
  del: (store, key) => tx(store, 'readwrite', (os, mem) => (os ? os.delete(key) : mem.delete(key))),
  keys: (store) => tx(store, 'readonly', (os, mem) => (os ? os.getAllKeys() : [...mem.keys()])),
  clear: (store) => tx(store, 'readwrite', (os, mem) => (os ? os.clear() : mem.clear())),
};
