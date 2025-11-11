const DB_NAME = 'gm loader db';
const DB_VER = 1;
const STORE_NAME = 'gms';

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VER);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getGms(gameId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    //thank you webdev
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(gameId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function b64tooBlob(base64, mimeType) {
  const byteString = atob(base64);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  return new Blob([uint8Array], { type: mimeType });
}

function findFile(files, requestedPath) {
  if (files[requestedPath]) {
    return { data: files[requestedPath], path: requestedPath };
  }
  
  const nmalReq = requestedPath.replace(/^\/+/, '');
  
  for (const path in files) {
    const nmalPath = path.replace(/^\/+/, '');
    if (nmalPath === nmalReq) {
      return { data: files[path], path: path };
    }
  }
  
  for (const path in files) {
    if (path.endsWith('/' + requestedPath) || path.endsWith('/' + nmalReq)) {
      return { data: files[path], path: path };
    }
  }
  
  return null;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/^\/game\/([^\/]+)\/(.+)$/);
  
  if (match) {
    const gameId = match[1];
    const filePath = match[2];
    
    event.respondWith(
      (async () => {
        try {
          const gameData = await getGms(gameId);
          if (!gameData || !gameData.files) {
            return new Response('game not found', { status: 404 });
          }
          
          const found = findFile(gameData.files, filePath);
          if (!found) {
            return new Response('couldnt fine file: ' + filePath, { status: 404 });
          }
          
          const fileData = found.data;
          let content, mimeType, isBinary;
          
          if (typeof fileData === 'object' && fileData.content !== undefined) {
            content = fileData.content;
            mimeType = fileData.mime || fileData.mimeType || 'application/octet-stream';
            isBinary = fileData.binary !== undefined ? fileData.binary : fileData.isBinary;
          } else {
            content = fileData;
            const ext = found.path.split('.').pop().toLowerCase();
            const fallbackMimes = {
              html: 'text/html', css: 'text/css', js: 'application/javascript',
              json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
              gif: 'image/gif', svg: 'image/svg+xml', woff: 'font/woff',
              woff2: 'font/woff2', ttf: 'font/ttf', wasm: 'application/wasm'
            };
            mimeType = fallbackMimes[ext] || 'application/octet-stream';
            const textExts = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'xml', 'txt', 'md', 'csv', 'svg']);
            isBinary = !textExts.has(ext);
          }
          
          const headers = {
            'Content-Type': mimeType + (isBinary ? '' : '; charset=utf-8'),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000',
          };
          
          const resBody = isBinary ? b64tooBlob(content, mimeType) : content;
          return new Response(resBody, { headers });
          
        } catch (error) {
          console.error('service worker', error);
          return new Response('err: ' + error.message, { status: 500 });
        }
      })()
    );
  }
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
