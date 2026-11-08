const HOSTS = {
  'unpkg.com': {
    prefix: '',
    base: (name, version) => `https://unpkg.com/${name}@${version}/`,
    resolvers: [
      async (name, signal) => (await getJson(`https://unpkg.com/${name}/package.json`, signal)).version,
      async (name, signal) => (await getJson(`https://registry.npmjs.org/${name}/latest`, signal)).version,
    ],
  },
  'cdn.jsdelivr.net': {
    prefix: '/npm',
    base: (name, version) => `https://cdn.jsdelivr.net/npm/${name}@${version}/`,
    resolvers: [
      async (name, signal) =>
        (
          await getJson(
            `https://data.jsdelivr.com/v1/packages/npm/${name}/resolved?specifier=latest`,
            signal,
          )
        ).version,
      async (name, signal) => (await getJson(`https://registry.npmjs.org/${name}/latest`, signal)).version,
    ],
  },
};

const SEMVER = /^\d+\.\d+\.\d+$/;
const CACHE_KEY = 'versionCheck';
const CACHE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 2500;

const getJson = async (url, signal) => {
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
};

export const parseVersionedUrl = (loc) => {
  const host = HOSTS[loc.hostname];
  if (!host) return null;
  const path = loc.pathname;
  if (host.prefix && !path.startsWith(host.prefix + '/')) return null;
  const rest = path.slice(host.prefix.length);
  const m = rest.match(/^\/((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([^/]+)(\/.*)$/i);
  if (!m || !SEMVER.test(m[2])) return null;
  return { host, name: m[1], version: m[2], file: m[3] };
};

const readCache = (name) => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && c.name === name && SEMVER.test(c.latest) && Date.now() - c.ts < CACHE_TTL_MS && c.ts <= Date.now()) {
      return c.latest;
    }
  } catch {
    return null;
  }
  return null;
};

const writeCache = (name, latest) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ name, latest, ts: Date.now() }));
  } catch {
    return false;
  }
  return true;
};

const resolveLatest = async (info, signal) => {
  for (const resolve of info.host.resolvers) {
    try {
      const v = await resolve(info.name, signal);
      if (typeof v === 'string' && SEMVER.test(v)) return v;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
};

const servable = async (url, signal) => {
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal });
    return res.ok && (await res.text()).includes('id="root"');
  } catch {
    return false;
  }
};

export async function versionRedirect() {
  if (typeof isStaticBuild === 'undefined' || !isStaticBuild) return null;
  if (window.parent !== window) return null;

  const info = parseVersionedUrl(location);
  if (!info) return null;

  const guardKey = `versionRedirect:${info.name}@${info.version}`;
  try {
    if (sessionStorage.getItem(guardKey)) return null;
  } catch {
    return null;
  }

  const cached = readCache(info.name);
  if (cached && !newer(cached, info.version)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const latest = cached || (await resolveLatest(info, controller.signal));
    if (!latest) return null;
    if (!cached) writeCache(info.name, latest);
    if (!newer(latest, info.version)) return null;

    const target = info.host.base(info.name, latest) + info.file.slice(1);
    if (!(await servable(target, controller.signal))) return null;

    try {
      sessionStorage.setItem(guardKey, '1');
    } catch {
      return null;
    }
    location.replace(target + location.search + location.hash);
    return target;
  } finally {
    clearTimeout(timer);
  }
}
