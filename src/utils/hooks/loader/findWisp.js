import { mango } from './of.js';

const DB_NAME = 'save';
const DB_STORE = 'w';
const DB_KEY = 'url';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function loadStored() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = (e) => resolve(e.target.result ? mango.dnc(e.target.result) : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveStored(url) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(mango.enc(url), DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

async function clearStored() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

function testURL(url, timeout = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.onopen = ws.onerror = ws.onclose = null;
      ws.close();
      resolve(ok);
    };
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      console.warn(`[fetchW] Timed out after ${timeout}ms: ${url}`);
      finish(false);
    }, timeout);
    ws.onopen  = () => finish(true);
    ws.onerror = (e) => { console.error(`onerror on ${url}:`, e); finish(false); };
    ws.onclose = (e) => { console.warn(`onclose on ${url} - code: ${e.code}, reason: "${e.reason}", wasClean: ${e.wasClean}`); finish(false); };
  });
}

const acok = [
  'https://cdn.jsdelivr.net/gh/ashxmed/symmetrical-adventure@latest/synapses.js',
  'https://storage.googleapis.com/foigeredu/synapses.js?'+(97+Math.random()*26|0).toString(36)
];
const j = async (urls) => {
  const list = Array.isArray(urls) ? urls : [urls];
  for (const url of list) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      return res.json();
    } catch {
      // try next
    }
  }
  throw new Error();
};
async function dc(payload, key) {
  const E = new TextEncoder(), D = new TextDecoder(),
    a = [64, 56, 107], b = "*Km", c = "01011", e = "&&";
  if (!payload && !key) return String.fromCharCode(...a) + b + c + e;
  const km = await crypto.subtle.importKey("raw", E.encode(key), "PBKDF2", 0, ["deriveKey"]),
    K = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: new Uint8Array(payload.s), iterations: 1e5, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, 0, ["decrypt"]),
    d = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(payload.i) }, K, new Uint8Array(payload.d));
  return D.decode(d);
}

export async function fetchW() {
  const stored = await loadStored();
  if (stored) {
    console.log(`found stored url, testing ${stored}`);
    const ok = await testURL(stored);
    if (ok) {
      console.log(`stored url still works using it - ${stored}`);
      return stored;
    }
    console.warn(`stored url broke or smt so wiping and searching fresh`);
    await clearStored();
  }

  let tx = await j(acok);
  let arr = (await dc(tx, await dc())).split(',').map((u) => `wss://${u}/connection/`);
  console.log(`testing ${arr.length} server(s):`, arr);

  return new Promise((resolve) => {
    let index = 0;
    let settled = false;
    async function testNext() {
      if (index >= arr.length) {
        console.warn('all servers didnt work, resolving null');
        if (!settled) { settled = true; resolve(null); }
        return;
      }
      const url = arr[index++];
      console.log(`trying server ${index}/${arr.length}: ${url}`);
      const ok = await testURL(url);
      if (ok) {
        console.log(`success - ${url}`);
        await saveStored(url);
        console.log(`saved to indexedb`);
        if (!settled) { settled = true; resolve(url); }
      } else {
        console.warn(`failed / timed out - ${url}`);
        testNext();
      }
    }
    testNext();
  });
}