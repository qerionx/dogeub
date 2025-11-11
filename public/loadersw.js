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

async function getGms(gmId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(gmId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function b64toBlob(base64, mimeType) {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mimeType });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/^\/gm\/([^\/]+)\/(.+)$/);
  if (match) {
    const gmId = match[1];
    const filePath = match[2];
    event.respondWith(
      (async () => {
        try {
          const gmData = await getGms(gmId);
          if (!gmData || !gmData.files) {
            return new Response('gm not found', { status: 404 });
          }

          let fileData = gmData.files[filePath];
          if (!fileData) {
            for (const path in gmData.files) {
              if (path.endsWith('/' + filePath) || path === filePath) {
                fileData = gmData.files[path];
                break;
              }
            }
          }
          if (!fileData) {
            return new Response('file not found: ' + filePath, { status: 404 });
          }

          let content, mimeType, isBinary;
          if (fileData.content !== undefined) {
            content = fileData.content;
            mimeType = fileData.mimeType;
            isBinary = fileData.isBinary;
          } else {
            content = fileData;
            const ext = filePath.split('.').pop().toLowerCase();
            const types = {
              html: 'text/html',
              css: 'text/css',
              js: 'application/javascript',
              json: 'application/json',
              png: 'image/png',
              jpg: 'image/jpeg',
              gif: 'image/gif',
              svg: 'image/svg+xml',
              woff: 'font/woff',
              woff2: 'font/woff2',
              ttf: 'font/ttf',
              wasm: 'application/wasm',
            };
            mimeType = types[ext] || 'application/octet-stream';
            isBinary = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|mp3|mp4|ogg|webm|wasm|data|unityweb|bundle|bin|dat)$/i.test(filePath);
          }

          const headers = {
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000',
          };

          if (isBinary) {
            const blob = b64toBlob(content, mimeType);
            return new Response(blob, { headers });
          } else {
            return new Response(content, { headers });
          }
        } catch (error) {
          console.error(error);
          return new Response('error: ' + error.message, { status: 500 });
        }
      })()
    );
  }
});

const b64toBlob = (base64, mimeType) =>
  new Blob([new Uint8Array(atob(base64).split('').map(char => char.charCodeAt(0)))], { type: mimeType });

self.addEventListener('fetch', event => {
  const reqUrl = new URL(event.request.url);
  const path = reqUrl.pathname.match(/^\/gm\/([^\/]+)\/(.+)$/);
  if (!path) return;

  event.respondWith((async () => {
    try {
      const gm = await getGms(path[1]);
      if (!gm?.files) return new Response('not found', { status: 404 });

      let file = gm.files[path[2]];
      if (!file) {
        for (const storedPath in gm.files) {
          if (storedPath.endsWith('/' + path[2]) || storedPath === path[2]) {
            file = gm.files[storedPath];
            break;
          }
        }
      }
      if (!file) return new Response('not found', { status: 404 });

      let content, mimeType, isBinary;
      if (file.content !== undefined) {
        content = file.content;
        mimeType = file.mimeType;
        isBinary = file.isBinary;
      } else {
        content = file;
        const ext = path[2].split('.').pop().toLowerCase();
        const mimeMap = {
          html: 'text/html',
          css: 'text/css',
          js: 'application/javascript',
          json: 'application/json',
          png: 'image/png',
          jpg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          woff: 'font/woff',
          woff2: 'font/woff2',
          ttf: 'font/ttf',
          wasm: 'application/wasm'
        };
        mimeType = mimeMap[ext] || 'application/octet-stream';
        isBinary = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|mp3|mp4|ogg|webm|wasm|data|unityweb|bundle|bin|dat)$/i.test(path[2]);
      }

      const headers = {
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000'
      };

      return new Response(isBinary ? b64toBlob(content, mimeType) : content, { headers });
    } catch (error) {
      return new Response('error: ' + error.message, { status: 500 });
    }
  })());
});

self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));
