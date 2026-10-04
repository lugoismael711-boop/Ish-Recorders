/**
 * Tiny IndexedDB wrapper for storing recordings.
 * Each record: { id, title, createdAt, duration, mime, transcript, blob }
 * Audio blobs can be large, so IndexedDB is used instead of localStorage.
 */
const RecordingsDB = (() => {
  const DB_NAME = "ish-recorders";
  const STORE = "recordings";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode) {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    async add(record) {
      const store = await tx("readwrite");
      await promisify(store.put(record));
      return record;
    },
    async update(id, changes) {
      const store = await tx("readwrite");
      const existing = await promisify(store.get(id));
      if (!existing) return null;
      const merged = { ...existing, ...changes };
      await promisify(store.put(merged));
      return merged;
    },
    async remove(id) {
      const store = await tx("readwrite");
      await promisify(store.delete(id));
    },
    async all() {
      const store = await tx("readonly");
      const records = await promisify(store.getAll());
      return records.sort((a, b) => b.createdAt - a.createdAt);
    },
  };
})();
