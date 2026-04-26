const acok = 'https://cdn.jsdelivr.net/gh/ashxmed/symmetrical-adventure@latest/synapses.js';

const j = (u) => fetch(u).then((r) => r.json());

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
  let tx = await j(acok);
  let arr = (await dc(tx, await dc())).split(',').map((u) => `wss://${u}/wisp/`);

  return new Promise((resolve) => {
    let index = 0;

    function testNext() {
      if (index >= arr.length) {
        resolve(null);
        return;
      }

      const url = arr[index];
      index++;
      let ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        ws.close();
        testNext();
      }, 2500);

      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(url);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        testNext();
      };
    }

    testNext();
  });
}
