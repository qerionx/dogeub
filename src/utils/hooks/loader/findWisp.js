import { mango } from './of.js';

const DB_NAME = 'save';
const DB_STORE = 'w';
const DB_KEY = 'url';

const LIST_KEY = 'list';
const LIST_TTL = 6 * 60 * 60 * 1000;
const BAD_KEY = 'bad';
const BAD_TTL = 6 * 60 * 60 * 1000;

const te = new TextEncoder();
const td = new TextDecoder();
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
      req.onsuccess = (e) => {
        const db = e.target.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = (e) => {
        dbPromise = null;
        reject(e.target.error);
      };
    });
  }
  return dbPromise;
}

async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbWrite(run) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      run(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    return;
  }
}

const isWispUrl = (url) => typeof url === 'string' && /^wss?:\/\/[^\s]+$/.test(url);

async function loadBad() {
  const row = await idbGet(BAD_KEY);
  const now = Date.now();
  const bad = new Set();
  if (row && typeof row === 'object') {
    for (const [key, at] of Object.entries(row)) {
      if (typeof at === 'number' && now - at < BAD_TTL) bad.add(mango.dnc(key));
    }
  }
  return bad;
}

export async function markBad(url) {
  if (!isWispUrl(url)) return;
  const row = (await idbGet(BAD_KEY)) || {};
  const now = Date.now();
  const next = {};
  for (const [key, at] of Object.entries(row)) {
    if (typeof at === 'number' && now - at < BAD_TTL) next[key] = at;
  }
  next[mango.enc(url)] = now;
  await idbWrite((os) => os.put(next, BAD_KEY));
}

export async function loadStored() {
  const [raw, bad] = await Promise.all([idbGet(DB_KEY), loadBad()]);
  const url = raw ? mango.dnc(raw) : null;
  if (!isWispUrl(url) || bad.has(url)) return null;
  return url;
}

const saveStored = (url) => idbWrite((os) => os.put(mango.enc(url), DB_KEY));

export const clearStored = () => idbWrite((os) => os.delete(DB_KEY));

async function loadList() {
  const row = await idbGet(LIST_KEY);
  if (!row || typeof row.t !== 'number' || Date.now() - row.t > LIST_TTL) return null;
  const urls = toUrls(mango.dnc(row.v));
  return urls.length && urls.every(isWispUrl) ? urls : null;
}

const saveList = (csv) => idbWrite((os) => os.put({ t: Date.now(), v: mango.enc(csv) }, LIST_KEY));

const clearList = () => idbWrite((os) => os.delete(LIST_KEY));

const toUrls = (csv) =>
  String(csv || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => `wss://${u}/connection/`);

export function testURL(url, timeout = 2500, signal) {
  return new Promise((resolve) => {
    let done = false;
    let ws = null;
    let timer = null;
    const onAbort = () => finish(false);
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (ws) {
        ws.onopen = ws.onerror = ws.onclose = null;
        try {
          ws.close();
        } catch {
          ws = null;
        }
      }
      resolve(ok);
    };
    if (signal?.aborted) {
      finish(false);
      return;
    }
    try {
      ws = new WebSocket(url);
    } catch {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(false), timeout);
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

const acok = [
  'https://cdn.jsdelivr.net/gh/ashxmed/symmetrical-adventure@latest/synapses.js',
  'https://storage.googleapis.com/foigeredu/synapses.js?' +
    ((97 + Math.random() * 26) | 0).toString(36),
];
const LIST_TIMEOUT = 2500;
const listSignal = () =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(LIST_TIMEOUT)
    : undefined;
const j = (urls) =>
  Promise.any(
    (Array.isArray(urls) ? urls : [urls]).map(async (url) => {
      const res = await fetch(url, { cache: 'no-store', signal: listSignal() });
      if (!res.ok) throw new Error();
      return res.json();
    }),
  );

let baseKeyPromise = null;
async function dc(payload, key) {
  const a = [64, 56, 107],
    b = '*Km',
    c = '01011',
    e = '&&';
  if (!payload && !key) return String.fromCharCode(...a) + b + c + e;
  const km =
    baseKeyPromise ||
    (baseKeyPromise = crypto.subtle.importKey('raw', te.encode(key), 'PBKDF2', false, [
      'deriveKey',
    ]));
  const K = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(payload.s), iterations: 1e5, hash: 'SHA-256' },
    await km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const d = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(payload.i) },
    K,
    new Uint8Array(payload.d),
  );
  return td.decode(d);
}

export const peekStored = loadStored;

function raceServers(urls) {
  return new Promise((resolve) => {
    let left = urls.length;
    let settled = false;
    if (!left) return resolve(null);
    const ctrl = new AbortController();
    urls.forEach((url) =>
      testURL(url, 2500, ctrl.signal).then((ok) => {
        left -= 1;
        if (settled) return;
        if (ok) {
          settled = true;
          ctrl.abort();
          resolve(url);
        } else if (left === 0) {
          settled = true;
          resolve(null);
        }
      }),
    );
  });
}

const sameList = (a, b) => a.length === b.length && a.every((u, i) => u === b[i]);

export async function discover(exclude = []) {
  const [bad, cached] = await Promise.all([loadBad(), loadList()]);
  exclude.forEach((url) => bad.add(url));
  const usable = (urls) => {
    const good = urls.filter((url) => !bad.has(url));
    return good.length ? good : urls.filter((url) => !exclude.includes(url));
  };
  if (cached) {
    const hit = await raceServers(usable(cached));
    if (hit) {
      saveStored(hit);
      return hit;
    }
    await clearList();
  }

  let csv;
  try {
    csv = await dc(await j(acok), await dc());
  } catch {
    return null;
  }
  const urls = toUrls(csv);
  if (!urls.length || (cached && sameList(cached, urls))) return null;
  const hit = await raceServers(usable(urls));
  if (hit) {
    saveStored(hit);
    saveList(csv);
  }
  return hit;
}
