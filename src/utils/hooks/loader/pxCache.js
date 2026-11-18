const CACHE_NAME = 'dogeub-px-v1';
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_MEM_ENTRY = 512 * 1024;
const MAX_MEM_TOTAL = 16 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const TRIM_INTERVAL_MS = 10 * 60 * 1000;

const REQ_SKIP = new Set([
  'range',
  'authorization',
  'if-none-match',
  'if-modified-since',
  'if-range',
]);
const ALLOWED_VARY = new Set(['accept-encoding', 'origin']);

let cachePromise = null;
let lastTrim = 0;
let memBytes = 0;
const memCache = new Map();
const inflightGets = new Map();

const openCache = () => {
  if (typeof caches === 'undefined') return Promise.resolve(null);
  return cachePromise || (cachePromise = caches.open(CACHE_NAME).catch(() => null));
};

const lowerMap = (tuples) => {
  const out = {};
  if (!Array.isArray(tuples)) return out;
  for (let i = 0; i < tuples.length; i++) {
    const [k, v] = tuples[i];
    const lk = k.toLowerCase();
    out[lk] = lk in out ? `${out[lk]}, ${v}` : String(v);
  }
  return out;
};

const hasSkippedReqHeader = (tuples) => {
  if (!Array.isArray(tuples)) return false;
  for (let i = 0; i < tuples.length; i++) {
    const lk = tuples[i][0].toLowerCase();
    if (REQ_SKIP.has(lk)) return true;
    if (lk === 'sec-fetch-dest') {
      const dest = String(tuples[i][1]).toLowerCase();
      if (dest === 'document' || dest === 'iframe') return true;
    }
    if (lk === 'cache-control' && String(tuples[i][1]).toLowerCase().includes('no-store')) {
      return true;
    }
  }
  return false;
};

const computeFreshMs = (hdrs) => {
  const cc = (hdrs['cache-control'] || '').toLowerCase();
  if (cc.includes('no-store') || cc.includes('private') || 'set-cookie' in hdrs) return null;
  const ct = (hdrs['content-type'] || '').toLowerCase();
  if (
    ct.includes('text/html') ||
    ct.includes('text/event-stream') ||
    ct.startsWith('video/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('multipart/')
  ) {
    return null;
  }
  if (Number(hdrs['content-length']) > MAX_CACHE_BYTES) return null;
  if (hdrs.vary) {
    const parts = hdrs.vary.toLowerCase().split(',');
    for (let i = 0; i < parts.length; i++) {
      const v = parts[i].trim();
      if (v && !ALLOWED_VARY.has(v)) return null;
    }
  }
  const m = /(?:^|[\s,])max-age\s*=\s*"?(\d+)/.exec(cc);
  let fresh = m
    ? Math.min(Number(m[1]) * 1000, MAX_TTL_MS)
    : cc.includes('immutable')
      ? MAX_TTL_MS
      : 0;
  if (cc.includes('no-cache')) fresh = 0;
  fresh = Math.max(0, fresh - (Number(hdrs.age) || 0) * 1000);
  if (!fresh && !hdrs.etag && !hdrs['last-modified']) return null;
  return fresh;
};

const memPut = (url, entry) => {
  const prev = memCache.get(url);
  if (prev) {
    memBytes -= prev.buf.byteLength;
    memCache.delete(url);
  }
  if (entry.buf.byteLength > MAX_MEM_ENTRY) return;
  memCache.set(url, entry);
  memBytes += entry.buf.byteLength;
  for (const [k, v] of memCache) {
    if (memBytes <= MAX_MEM_TOTAL) break;
    memCache.delete(k);
    memBytes -= v.buf.byteLength;
  }
};

const makeStreamResponse = (body, meta) => ({
  body,
  headers: meta.h,
  status: 200,
  statusText: meta.s,
});

const maybeTrimDisk = async () => {
  const now = Date.now();
  if (now - lastTrim < TRIM_INTERVAL_MS) return;
  lastTrim = now;
  const cache = await openCache();
  if (!cache) return;
  const keys = await cache.keys();
  if (keys.length > MAX_ENTRIES) {
    const drop = keys.slice(0, keys.length - Math.floor(MAX_ENTRIES * 0.8));
    await Promise.all(drop.map((k) => cache.delete(k)));
  }
};

const storeResponse = (url, res, hdrMap, freshMs, resolveShared) => {
  if (!res.body || typeof res.body.tee !== 'function') {
    resolveShared?.(null);
    return res;
  }
  const meta = {
    h: res.headers,
    s: res.statusText || '',
    t: Date.now(),
    f: freshMs,
    etag: hdrMap.etag || '',
    lm: hdrMap['last-modified'] || '',
  };
  const [callerStream, storeStream] = res.body.tee();
  (async () => {
    try {
      const buf = new Uint8Array(await new Response(storeStream).arrayBuffer());
      resolveShared?.({
        buf,
        headers: res.headers,
        status: res.status,
        statusText: res.statusText,
      });
      if (buf.byteLength > MAX_CACHE_BYTES) return;
      if (freshMs > 0 && buf.byteLength <= MAX_MEM_ENTRY) {
        memPut(url, { buf, meta });
      }
      const cache = await openCache();
      if (cache) {
        await cache.put(
          url,
          new Response(buf, {
            headers: { 'x-m': encodeURIComponent(JSON.stringify(meta)) },
          }),
        );
        await maybeTrimDisk();
      }
    } catch {
      resolveShared?.(null);
    }
  })();
  return {
    body: callerStream,
    headers: res.headers,
    status: res.status,
    statusText: res.statusText,
  };
};

const fetchAndCache = async (url, remote, headers, signal, doFetch) => {
  const existing = inflightGets.get(url);
  if (existing) {
    const shared = await existing;
    if (shared) {
      return {
        body: new Response(shared.buf).body,
        headers: shared.headers,
        status: shared.status,
        statusText: shared.statusText,
      };
    }
  }

  const canCoalesce =
    !signal &&
    /\.(?:m?js|css|woff2?|ttf|otf|wasm|svg|png|jpe?g|webp|avif|gif|ico)(?:\?|$)/i.test(
      remote.pathname,
    );

  let finishShared = null;
  if (canCoalesce) {
    let resolveShared;
    const sharedPromise = new Promise((r) => {
      resolveShared = r;
    });
    inflightGets.set(url, sharedPromise);
    finishShared = (val) => {
      inflightGets.delete(url);
      resolveShared(val);
    };
  }

  try {
    const res = await doFetch(remote, 'GET', null, headers, signal);
    if (res.status !== 200 || !res.body) {
      finishShared?.(null);
      return res;
    }
    const hdrMap = lowerMap(res.headers);
    const freshMs = computeFreshMs(hdrMap);
    if (freshMs === null) {
      finishShared?.(null);
      return res;
    }
    return storeResponse(url, res, hdrMap, freshMs, finishShared);
  } catch (err) {
    finishShared?.(null);
    throw err;
  }
};

export async function cachedTransportRequest(remote, method, body, headers, signal, doFetch) {
  if (
    method !== 'GET' ||
    body ||
    (remote.protocol !== 'https:' && remote.protocol !== 'http:') ||
    hasSkippedReqHeader(headers)
  ) {
    return doFetch(remote, method, body, headers, signal);
  }

  const url = remote.href;
  const now = Date.now();

  const memHit = memCache.get(url);
  if (memHit && now - memHit.meta.t < memHit.meta.f) {
    return makeStreamResponse(new Response(memHit.buf).body, memHit.meta);
  }

  const cache = await openCache();
  const diskHit = cache ? await cache.match(url) : null;
  if (diskHit) {
    let meta = null;
    try {
      meta = JSON.parse(decodeURIComponent(diskHit.headers.get('x-m') || ''));
    } catch {
      meta = null;
    }
    if (meta) {
      if (now - meta.t < meta.f) {
        return makeStreamResponse(diskHit.body, meta);
      }
      const cond = meta.etag
        ? ['if-none-match', meta.etag]
        : meta.lm
          ? ['if-modified-since', meta.lm]
          : null;
      if (cond) {
        const reval = await doFetch(remote, 'GET', null, [...headers, cond], signal);
        if (reval.status === 304) {
          const fresh = computeFreshMs({
            ...lowerMap(meta.h),
            ...lowerMap(reval.headers),
          });
          const nextMeta = { ...meta, t: Date.now(), f: fresh ?? meta.f };
          if (cache && diskHit.body) {
            const [retStream, saveStream] = diskHit.body.tee();
            cache
              .put(
                url,
                new Response(saveStream, {
                  headers: { 'x-m': encodeURIComponent(JSON.stringify(nextMeta)) },
                }),
              )
              .catch(() => {});
            return makeStreamResponse(retStream, nextMeta);
          }
          return makeStreamResponse(diskHit.body, nextMeta);
        }
        if (reval.status === 200 && reval.body) {
          const hdrMap = lowerMap(reval.headers);
          const freshMs = computeFreshMs(hdrMap);
          return freshMs === null ? reval : storeResponse(url, reval, hdrMap, freshMs);
        }
        return reval;
      }
    }
  }

  return fetchAndCache(url, remote, headers, signal, doFetch);
}
