const DB_NAME = 'gm loader db';
const DB_VER = 1;
const STORE_NAME = 'gms';

const APP_SHELL_CACHE = 'dogeub-shell-v1';
const APP_ASSET_CACHE = 'dogeub-assets-v1';
const GAME_ROUTE_REGEX = /\/game\/([^/]+)\/(.+)$/;

const TEXT_EXTENSIONS = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'json',
  'xml',
  'txt',
  'md',
  'csv',
  'svg',
]);

const CACHEABLE_DESTINATIONS = new Set([
  'script',
  'style',
  'worker',
  'font',
  'image',
  'manifest',
  'document',
]);

const MIME_BY_EXTENSION = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  wasm: 'application/wasm',
  zip: 'application/zip',
  gz: 'application/gzip',
  pdf: 'application/pdf',
  data: 'application/octet-stream',
  unityweb: 'application/octet-stream',
  bundle: 'application/octet-stream',
  bin: 'application/octet-stream',
  dat: 'application/octet-stream',
  mem: 'application/octet-stream',
  asset: 'application/octet-stream',
  resource: 'application/octet-stream',
};

const gmCache = new Map();

const scopeUrl = (path) => new URL(path, self.registration.scope).toString();

const getPrecacheUrls = () => ['.', './index.html', './icon.svg', './logo.svg'].map(scopeUrl);

const isSameOrigin = (url) => url.origin === self.location.origin;

const canCacheResponse = (response, request) => {
  if (!response) {
    return false;
  }

  if (response.type === 'opaque') {
    return request?.destination === 'image';
  }

  return response.ok && (response.type === 'basic' || response.type === 'default');
};

async function warmAppShellCache() {
  const cache = await caches.open(APP_SHELL_CACHE);
  const urls = getPrecacheUrls();

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (canCacheResponse(response)) {
          await cache.put(url, response.clone());
        }
      } catch {
        // Ignore failures during install; runtime requests will populate cache later.
      }
    }),
  );
}

async function cleanupOldCaches() {
  const activeCaches = new Set([APP_SHELL_CACHE, APP_ASSET_CACHE]);
  const keys = await caches.keys();

  await Promise.all(
    keys.map((key) => {
      if ((key.startsWith('dogeub-shell-') || key.startsWith('dogeub-assets-')) && !activeCaches.has(key)) {
        return caches.delete(key);
      }

      return Promise.resolve(false);
    }),
  );
}

async function handleNavigationRequest(request) {
  const shellCache = await caches.open(APP_SHELL_CACHE);

  try {
    const networkResponse = await fetch(request);

    if (canCacheResponse(networkResponse)) {
      await shellCache.put(request, networkResponse.clone());
      await shellCache.put(scopeUrl('./index.html'), networkResponse.clone());
      await shellCache.put(scopeUrl('./'), networkResponse.clone());
    }

    return networkResponse;
  } catch {
    const exactMatch = await shellCache.match(request, { ignoreSearch: true });
    if (exactMatch) {
      return exactMatch;
    }

    const indexFallback = await shellCache.match(scopeUrl('./index.html'));
    if (indexFallback) {
      return indexFallback;
    }

    const rootFallback = await shellCache.match(scopeUrl('./'));
    if (rootFallback) {
      return rootFallback;
    }

    return new Response('Offline and no cached app shell is available yet.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
}

const shouldHandleAssetRequest = (request, url) => {
  if (GAME_ROUTE_REGEX.test(url.pathname)) {
    return false;
  }

  if (!isSameOrigin(url)) {
    const looksLikeIcon = /\.(?:png|jpe?g|gif|svg|webp|ico|avif|bmp)$/i.test(url.pathname);
    return request.destination === 'image' || looksLikeIcon;
  }

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return false;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    return true;
  }

  return /\.(?:css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|wasm)$/i.test(url.pathname);
};

const shouldStoreAssetResponse = (request, url) => {
  if (request.destination === 'image') {
    return url.pathname === '/logo.svg';
  }

  return true;
};

async function handleAssetRequest(request) {
  const assetCache = await caches.open(APP_ASSET_CACHE);
  const cachedResponse = await assetCache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    const requestUrl = new URL(request.url);

    if (canCacheResponse(networkResponse, request) && shouldStoreAssetResponse(request, requestUrl)) {
      await assetCache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch {
    const fallbackMatch = await assetCache.match(request, { ignoreSearch: true });
    if (fallbackMatch) {
      return fallbackMatch;
    }

    if (request.destination === 'document') {
      const shellCache = await caches.open(APP_SHELL_CACHE);
      const indexFallback = await shellCache.match(scopeUrl('./index.html'));

      if (indexFallback) {
        return indexFallback;
      }
    }

    return new Response('Offline resource unavailable.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }
}

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VER);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getGm(gmName) {
  if (gmCache.has(gmName)) {
    return gmCache.get(gmName);
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).get(gmName);

    request.onsuccess = () => {
      const game = request.result;
      if (game) {
        gmCache.set(gmName, game);
      }
      resolve(game);
    };

    request.onerror = () => reject(request.error);
  });
}

function b64ToBlob(base64Content, mimeType) {
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function normalizePath(path) {
  return path.replace(/^\/+/, '').replace(/\\/g, '/');
}

function findFile(files, requestedPath) {
  const normalizedRequest = normalizePath(requestedPath);

  if (files[requestedPath]) {
    return { data: files[requestedPath], path: requestedPath };
  }

  if (files[normalizedRequest]) {
    return { data: files[normalizedRequest], path: normalizedRequest };
  }

  for (const filePath in files) {
    const normalizedFilePath = normalizePath(filePath);

    if (
      normalizedFilePath === normalizedRequest ||
      normalizedFilePath === `${normalizedRequest}/` ||
      `${normalizedFilePath}/` === normalizedRequest
    ) {
      return { data: files[filePath], path: filePath };
    }
  }

  const requestBaseName = normalizedRequest.split('/').pop();
  if (requestBaseName) {
    for (const filePath in files) {
      const normalizedFilePath = normalizePath(filePath);
      const fileBaseName = normalizedFilePath.split('/').pop();

      if (
        fileBaseName === requestBaseName &&
        (normalizedFilePath.endsWith(normalizedRequest) || normalizedRequest.endsWith(normalizedFilePath))
      ) {
        return { data: files[filePath], path: filePath };
      }
    }
  }

  const lowercaseRequest = normalizedRequest.toLowerCase();
  for (const filePath in files) {
    if (normalizePath(filePath).toLowerCase() === lowercaseRequest) {
      return { data: files[filePath], path: filePath };
    }
  }

  return null;
}

function getMimeFromPath(path) {
  const extension = path.split('.').pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

async function handleLocalGameRequest(gameName, requestedPath) {
  try {
    const game = await getGm(gameName);

    if (!game || !game.files) {
      return new Response('game not found', { status: 404 });
    }

    const decodedPath = decodeURIComponent(requestedPath);
    const found = findFile(game.files, decodedPath);

    if (!found) {
      return new Response(`couldnt find file: ${decodedPath}`, { status: 404 });
    }

    const extension = found.path.split('.').pop()?.toLowerCase() || '';
    const fileData = found.data;
    let content = fileData;
    let mimeType = getMimeFromPath(found.path);
    let isBinary = !TEXT_EXTENSIONS.has(extension);

    if (typeof fileData === 'object' && fileData !== null && fileData.content !== undefined) {
      content = fileData.content;
      mimeType = fileData.mime || fileData.mimeType || mimeType;
      isBinary = fileData.binary ?? fileData.isBinary ?? isBinary;
    }

    const responseHeaders = new Headers({
      'Content-Type': `${mimeType}${isBinary ? '' : '; charset=utf-8'}`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    const body = isBinary ? b64ToBlob(content, mimeType) : content;

    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(`err: ${error.message}`, { status: 500 });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await warmAppShellCache();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await cleanupOldCaches();
      await clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const gameMatch = url.pathname.match(GAME_ROUTE_REGEX);

  if (request.method === 'OPTIONS' && gameMatch) {
    event.respondWith(
      new Response(null, {
        status: 200,
        headers: new Headers({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        }),
      }),
    );
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return;
  }

  if (gameMatch) {
    event.respondWith(handleLocalGameRequest(gameMatch[1], gameMatch[2]));
    return;
  }

  if (request.mode === 'navigate') {
    if (!isSameOrigin(url)) {
      return;
    }
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (shouldHandleAssetRequest(request, url)) {
    event.respondWith(handleAssetRequest(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    gmCache.clear();
    event.ports?.[0]?.postMessage({ success: true });
  }
});
