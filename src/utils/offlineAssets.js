const GM_DB_NAME = 'gm loader db';
const GM_DB_VERSION = 1;
const GM_STORE_NAME = 'gms';
const OFFLINE_ASSET_CACHE = 'dogeub-assets-v1';

const IMAGE_EXTENSION_REGEX = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i;

const toAbsoluteUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return new URL(value, location.origin).toString();
  } catch {
    return null;
  }
};

const getGameIdFromUrl = (url) => {
  const firstUrl = Array.isArray(url) ? url[0] : url;
  if (!firstUrl || typeof firstUrl !== 'string') {
    return '';
  }

  const cleaned = firstUrl.split('?')[0].split('#')[0];
  return cleaned.split('/').pop()?.replace(/\.zip$/i, '') || '';
};

const openGamesDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(GM_DB_NAME, GM_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GM_STORE_NAME)) {
        db.createObjectStore(GM_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

export const getDownloadedGameIds = async () => {
  try {
    const db = await openGamesDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction([GM_STORE_NAME], 'readonly').objectStore(GM_STORE_NAME).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const values = request.result || [];
        const ids = values
          .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
          .filter(Boolean);
        resolve(ids);
      };
    });
  } catch {
    return [];
  }
};

const getDownloadedGameIconUrls = (gamesByCategory, downloadedIdsSet) => {
  const urls = new Set();

  Object.values(gamesByCategory || {}).forEach((list) => {
    (list || []).forEach((game) => {
      if (!game?.local || !game?.icon) {
        return;
      }

      const gameId = getGameIdFromUrl(game.url);
      if (!gameId || !downloadedIdsSet.has(gameId)) {
        return;
      }

      const absolute = toAbsoluteUrl(game.icon);
      if (absolute) {
        urls.add(absolute);
      }
    });
  });

  return urls;
};

const fetchAndCache = async (cache, url) => {
  try {
    const parsed = new URL(url);
    const sameOrigin = parsed.origin === location.origin;

    const request = sameOrigin
      ? new Request(url, { cache: 'no-store' })
      : new Request(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' });

    const response = await fetch(request);

    if (!response || (!response.ok && response.type !== 'opaque')) {
      return;
    }

    await cache.put(request, response.clone());
  } catch {
    // Ignore failed cache warmup requests.
  }
};

export const warmOfflineVisualAssets = async () => {
  if (typeof window === 'undefined' || !('caches' in window) || !navigator.onLine) {
    return;
  }

  try {
    const [appsModule, downloadedIds] = await Promise.all([
      import('../data/apps.json'),
      getDownloadedGameIds(),
    ]);

    const downloadedIdsSet = new Set(downloadedIds);
    const iconUrls = getDownloadedGameIconUrls(appsModule.default?.games || {}, downloadedIdsSet);

    const urlsToCache = new Set([
      toAbsoluteUrl('/logo.svg'),
      ...iconUrls,
    ]);

    const cache = await caches.open(OFFLINE_ASSET_CACHE);

    await Promise.all(
      [...urlsToCache]
        .filter((url) => typeof url === 'string' && (url.startsWith('http') || IMAGE_EXTENSION_REGEX.test(url)))
        .map((url) => fetchAndCache(cache, url)),
    );
  } catch {
    // Ignore warmup failures to avoid blocking the app.
  }
};

export const getDownloadedPlayableGames = (gamesByCategory, downloadedIds) => {
  const downloadedIdsSet = new Set(downloadedIds || []);
  const seen = new Set();
  const playable = [];

  Object.values(gamesByCategory || {}).forEach((list) => {
    (list || []).forEach((game) => {
      if (!game?.local) {
        return;
      }

      const gameId = getGameIdFromUrl(game.url);
      if (gameId && downloadedIdsSet.has(gameId)) {
        if (seen.has(gameId)) {
          return;
        }
        seen.add(gameId);
        playable.push(game);
      }
    });
  });

  return playable;
};

