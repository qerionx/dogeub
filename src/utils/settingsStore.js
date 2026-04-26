const DB_NAME = 'dub-opt';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const OPTIONS_KEY = 'options';

let dbPromise = null;
let cachedOptions = null;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeOptions = (value) => (isObject(value) ? value : {});

const readLegacyOptions = () => {
  try {
    return normalizeOptions(JSON.parse(localStorage.getItem('options') || '{}'));
  } catch {
    return {};
  }
};

const removeLegacyOptions = () => {
  try {
    localStorage.removeItem('options');
  } catch {}
};

const openDb = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  return dbPromise;
};

const readRecord = async (key) => {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

const writeRecord = async (key, value) => {
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
    return value;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => resolve(value);
      tx.onabort = () => resolve(value);
    } catch {
      resolve(value);
    }
  });
};

const clearRecord = async (key) => {
  const db = await openDb();
  if (!db) {
    try {
      localStorage.removeItem(key);
    } catch {}
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

export const getStoredOptionsSync = () => cachedOptions ?? readLegacyOptions();

export const initSettingsStore = async () => {
  const stored = normalizeOptions(await readRecord(OPTIONS_KEY));
  if (Object.keys(stored).length > 0) {
    cachedOptions = stored;
    removeLegacyOptions();
    return stored;
  }

  const legacy = readLegacyOptions();
  cachedOptions = legacy;
  if (Object.keys(legacy).length > 0) {
    await writeRecord(OPTIONS_KEY, legacy);
    removeLegacyOptions();
  }

  return legacy;
};

export const getStoredOptions = async () => {
  if (cachedOptions) return cachedOptions;
  return initSettingsStore();
};

export const setStoredOptions = async (options) => {
  const next = normalizeOptions(options);
  cachedOptions = next;
  await writeRecord(OPTIONS_KEY, next);
  removeLegacyOptions();
  return next;
};

export const updateStoredOptions = async (patch) => {
  const next = { ...getStoredOptionsSync(), ...normalizeOptions(patch) };
  return setStoredOptions(next);
};

export const clearStoredOptions = async () => {
  cachedOptions = {};
  await clearRecord(OPTIONS_KEY);
  removeLegacyOptions();
};