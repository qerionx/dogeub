const MIRRORS = [
  { id: 'u1', url: 'https://unpkg.com/unblocking/index.html' },
  { id: 'j1', url: 'https://cdn.jsdelivr.net/gh/dogeub/-/index.svg' },
  { id: 'u2', url: 'https://unpkg.com/educationate/index.html' },
];

const ASSET_CHECKS = ['sw.js', 's_sw.js', 'loadersw.js'];

const STORAGE_KEY = 'mirrorCheck';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const RENDER_TIMEOUT_MS = 8000;

const isGoogleStorageHost = (hostname) =>
  hostname === 'storage.googleapis.com' || hostname.endsWith('.storage.googleapis.com');

const loadCache = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (raw && typeof raw === 'object') {
      return { ts: raw.ts, target: raw.target, bad: raw.bad || {} };
    }
  } catch {
    return { ts: 0, target: undefined, bad: {} };
  }
  return { ts: 0, target: undefined, bad: {} };
};

const saveCache = (cache) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    return false;
  }
  return true;
};

const fresh = (ts) => typeof ts === 'number' && ts <= Date.now() && Date.now() - ts < TTL_MS;

const freshBad = (cache) => {
  const out = {};
  for (const [id, ts] of Object.entries(cache.bad)) {
    if (MIRRORS.some((m) => m.id === id) && fresh(ts)) out[id] = ts;
  }
  return out;
};

const fetchText = async (url, signal) => {
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal });
  if (!res.ok) return null;
  return { text: await res.text(), type: res.headers.get('content-type') || '' };
};

const checkChain = async (mirror) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const base = mirror.url.slice(0, mirror.url.lastIndexOf('/') + 1);
    const [page, ...assets] = await Promise.all([
      fetchText(mirror.url, controller.signal),
      ...ASSET_CHECKS.map((name) => fetchText(base + name, controller.signal)),
    ]);
    if (!page || !page.text.includes('id="root"')) return false;
    return assets.every((a) => a && /javascript/i.test(a.type) && a.text.length > 20);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const randomToken = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const checkRender = (mirror, cleanups) =>
  new Promise((resolve) => {
    const token = randomToken();
    const origin = new URL(mirror.url).origin;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;visibility:hidden';

    let done = false;
    let timer;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
      resolve(ok);
    };
    const onMessage = (e) => {
      const d = e.data;
      if (
        e.source === iframe.contentWindow &&
        e.origin === origin &&
        d &&
        d.type === 'mirror-ready' &&
        d.token === token
      ) {
        finish(true);
      }
    };

    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish(false), RENDER_TIMEOUT_MS);
    cleanups.push(() => finish(false));
    iframe.src = `${mirror.url}?mirrorProbe=${token}&mid=${mirror.id}`;
    (document.body || document.documentElement).appendChild(iframe);
  });

const pickMirror = async (candidates) => {
  const cleanups = [];
  const probes = candidates.map((mirror) =>
    checkChain(mirror)
      .then((ok) => (ok ? checkRender(mirror, cleanups) : false))
      .catch(() => false),
  );
  let picked = null;
  for (let i = 0; i < candidates.length; i++) {
    if (await probes[i]) {
      picked = candidates[i];
      break;
    }
  }
  cleanups.forEach((stop) => stop());
  return picked;
};

export async function mirrorRedirect() {
  if (typeof isStaticBuild === 'undefined' || !isStaticBuild) return null;
  if (!isGoogleStorageHost(location.hostname)) return null;

  const cache = loadCache();

  const params = new URLSearchParams(location.search);
  const failedId = params.get('mirrorFailed');
  if (failedId !== null) {
    if (MIRRORS.some((m) => m.id === failedId)) {
      cache.bad[failedId] = Date.now();
      cache.ts = 0;
    }
    params.delete('mirrorFailed');
    const qs = params.toString();
    try {
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch {
      params.delete('mirrorFailed');
    }
  }

  const bad = freshBad(cache);
  let targetId;
  if (fresh(cache.ts) && (cache.target === null || MIRRORS.some((m) => m.id === cache.target))) {
    targetId = cache.target;
    if (targetId && bad[targetId]) targetId = undefined;
  }
  if (targetId === undefined) {
    const picked = await pickMirror(MIRRORS.filter((m) => !bad[m.id]));
    targetId = picked ? picked.id : null;
    saveCache({ ts: Date.now(), target: targetId, bad });
  }

  const mirror = MIRRORS.find((m) => m.id === targetId);
  if (!mirror) return null;
  const from = encodeURIComponent(location.origin + location.pathname);
  location.replace(`${mirror.url}?from=${from}&mid=${mirror.id}${location.hash}`);
  return mirror.url;
}

const waitForMount = async (timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const root = document.getElementById('root');
    if (root && root.childElementCount > 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

export async function signalMirrorReady() {
  try {
    if (typeof isStaticBuild === 'undefined' || !isStaticBuild) return;
    if (!(await waitForMount())) return;
    if (typeof window.__mirrorBooted === 'function') window.__mirrorBooted();
    const token = new URLSearchParams(location.search).get('mirrorProbe');
    if (token && /^[a-z0-9]{8,64}$/i.test(token) && window.parent !== window) {
      window.parent.postMessage({ type: 'mirror-ready', token }, '*');
    }
  } catch {
    return;
  }
}
