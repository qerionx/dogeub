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

function getmime(fname) {
  const ext = fname.split('.').pop().toLowerCase();
  const types = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'json': 'application/json',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'svg': 'image/svg+xml', 'ico': 'image/x-icon',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf',
    'mp3': 'audio/mpeg', 'mp4': 'video/mp4', 'ogg': 'audio/ogg',
    'wasm': 'application/wasm',
    'data': 'application/octet-stream',
    'unityweb': 'application/octet-stream',
    'bundle': 'application/octet-stream',
    'bin': 'application/octet-stream',
    'dat': 'application/octet-stream'
  };
  return types[ext] || 'application/octet-stream';
}

function isBin(fname) {
  return /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|mp3|mp4|ogg|webm|wasm|data|unityweb|bundle|bin|dat)$/i.test(fname);
}

function b64tooBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([new Uint8Array(arr)], { type: mimeType });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const gameMatch = url.pathname.match(/^\/game\/([^\/]+)\/(.+)$/);
  if (gameMatch) {
    const gameId = gameMatch[1];
    const filePath = gameMatch[2];
    event.respondWith(
      (async () => {
        try {
          const gameData = await getGms(gameId);
          if (!gameData || !gameData.files) {
            return new Response('game not found', { status: 404 });
          }
          let fileContent = null;
          let foundPath = null;
          if (gameData.files[filePath]) {
            fileContent = gameData.files[filePath];
            foundPath = filePath;
          } else {
            for (const path in gameData.files) {
              if (path.endsWith('/' + filePath) || path === filePath) {
                fileContent = gameData.files[path];
                foundPath = path;
                break;
              }
            }
          }
          if (!fileContent) {
            return new Response('file not found: ' + filePath, { status: 404 });
          }
          const mimeType = getmime(foundPath);
          let response;
          if (isBin(foundPath)) {
            const blob = b64tooBlob(fileContent, mimeType);
            response = new Response(blob, { headers: { 'Content-Type': mimeType } });
          } else {
            response = new Response(fileContent, { headers: { 'Content-Type': mimeType } });
          }
          return response;
        } catch (error) {
          console.error(error);
          return new Response('error: ' + error.message, { status: 500 });
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
