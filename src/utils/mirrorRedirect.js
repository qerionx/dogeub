/* global isStaticBuild */
// Mirror failover for the static build.
//
// When the static build is opened from storage.googleapis.com (or a
// *.storage.googleapis.com host), check whether the mirrors below are reachable
// from the user's network. The first reachable one, in priority order, becomes
// a redirect target. If every mirror is blocked the user stays on the current
// page. Either outcome is saved in localStorage for a week, so the probe does
// not run on every reload.

const MIRRORS = [
  'https://unpkg.com/unblocking/index.html',
  'https://cdn.jsdelivr.net/gh/dogeub/-/index.svg',
  'https://unpkg.com/educationate/index.html',
];

const STORAGE_KEY = 'mirrorCheck';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // expires weekly
const PROBE_TIMEOUT_MS = 4000;

const isGoogleStorageHost = (hostname) =>
  hostname === 'storage.googleapis.com' || hostname.endsWith('.storage.googleapis.com');

const readCache = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || typeof raw.ts !== 'number') return null;
    if (Date.now() - raw.ts > TTL_MS || raw.ts > Date.now()) return null;
    if (raw.target !== null && !MIRRORS.includes(raw.target)) return null;
    return raw;
  } catch {
    return null;
  }
};

const writeCache = (target) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ target, ts: Date.now() }));
  } catch {
    // storage unavailable: the check just runs again next load
  }
};

// A mirror counts as reachable only if the request succeeds AND the body is the
// real app. Firewall block pages that answer 200 with their own HTML are rejected.
const probe = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    return (await res.text()).includes('id="root"');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

// Resolves to the redirect URL (the page is navigating) or null (stay here).
export async function mirrorRedirect() {
  if (typeof isStaticBuild === 'undefined' || !isStaticBuild) return null;
  if (!isGoogleStorageHost(location.hostname)) return null;

  const cached = readCache();
  let target;
  if (cached) {
    target = cached.target;
  } else {
    // Probe all mirrors at once but honour priority order: take the first
    // mirror in the list that is reachable.
    const results = await Promise.all(MIRRORS.map(probe));
    const idx = results.indexOf(true);
    target = idx === -1 ? null : MIRRORS[idx];
    writeCache(target);
  }

  if (!target) return null;
  location.replace(target + location.hash);
  return target;
}
