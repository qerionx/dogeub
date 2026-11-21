import { mango, makeSjCodec } from './of.js';
import { cachedTransportRequest } from './pxCache.js';

const FRAME_HANDLE = Symbol.for('controller frame handle');
const ROUTED_PATH = /^[a-z0-9]+\/[a-z0-9]+\/(.*)$/;
const ERROR_PREFIXES = [
  'Internal Service Worker Error',
  'This page is no longer connected to the proxy',
];

const appPath = (path) =>
  isStaticBuild ? new URL(`./${path}`, location.href).pathname : `/${path}`;
const versioned = (path) => `${appPath(path)}?v=${SJ_ASSET_VERSION}`;

let cachedSjPrefix = null;
export const sjPrefix = () => cachedSjPrefix || (cachedSjPrefix = appPath('k/'));

const state = {
  controller: null,
  frame: null,
  codec: null,
  transport: null,
  rawClient: null,
  boot: null,
  scripts: null,
  libcurlMod: null,
  wasmWarm: false,
  transportChain: Promise.resolve(),
  transportWaiters: [],
};

const loadScriptsOrdered = (srcs) => {
  if (typeof $scramjetController !== 'undefined') return Promise.resolve();
  if (state.scripts) return state.scripts;
  state.scripts = Promise.all(
    srcs.map(
      (src) =>
        new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.async = false;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`failed to load ${src}`));
          document.head.appendChild(script);
        }),
    ),
  ).catch((err) => {
    state.scripts = null;
    throw err;
  });
  return state.scripts;
};

const importLibcurlV2 = () => {
  if (!state.libcurlMod) {
    const modUrl = `${location.origin}${versioned('x/c.mjs')}`;
    state.libcurlMod = Function('u', 'return import(u)')(modUrl).catch((err) => {
      state.libcurlMod = null;
      throw err;
    });
  }
  return state.libcurlMod;
};

export const warmScramjetAssets = () => {
  importLibcurlV2().catch(() => {});
  loadScriptsOrdered([versioned('z/b.js'), versioned('z/c.js')]).catch(() => {});
  if (!state.wasmWarm) {
    state.wasmWarm = true;
    fetch(versioned('z/a.w')).catch(() => {});
  }
};

const settleWorker = (worker) =>
  new Promise((resolve) => {
    if (!worker || worker.state === 'activated' || worker.state === 'redundant') return resolve();
    const onChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', onChange);
        resolve();
      }
    };
    worker.addEventListener('statechange', onChange);
  });

const timeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);

const normalizeWisp = (url) => (url.endsWith('/') ? url : `${url}/`);

const HEADER_TIMEOUT_MS = [8000, 8000, 12000];
const FAILOVER_WINDOW_MS = 60000;
const FAILOVER_STALLS = 4;
const SOCKET_IDLE_MS = 4000;
const QUEUED_TIMEOUT_MS = 60000;
const PROBE_URL = 'https://www.gstatic.com/generate_204';
const PROBE_TIMEOUT_MS = 5000;
const HEALTHY_FOR_MS = 30000;
const RETRY_DELAYS_MS = [300, 1200];
const LIBCURL_CONNECTIONS = [32, 10, 8];
const wispUrls = new Set();
const wispSockets = new Set();

const trackWispSockets = () => {
  if (window.WebSocket.dubTracked) return;
  const NativeWebSocket = window.WebSocket;
  class TrackedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (!wispUrls.has(String(url))) return;
      this.lastActivity = Date.now();
      wispSockets.add(this);
      this.addEventListener('message', () => {
        this.lastActivity = Date.now();
      });
      this.addEventListener('close', () => wispSockets.delete(this));
    }
  }
  TrackedWebSocket.dubTracked = true;
  window.WebSocket = TrackedWebSocket;
};

const wispReceiving = () => {
  const now = Date.now();
  for (const socket of wispSockets) {
    if (now - socket.lastActivity < SOCKET_IDLE_MS) return true;
  }
  return false;
};

const recycleStalledSockets = () => {
  const now = Date.now();
  for (const socket of wispSockets) {
    if (now - socket.lastActivity > SOCKET_IDLE_MS) socket.close();
  }
};

let stallLog = [];
let wispFailover = null;
let lastFailover = 0;
let failoverPending = null;
let serverProbe = null;
let lastHealthy = 0;
let lastProbeOk = 0;

export const setWispFailover = (handler) => {
  wispFailover = handler;
};

const failover = () => {
  const now = Date.now();
  if (!wispFailover || failoverPending || now - lastFailover <= FAILOVER_WINDOW_MS) return;
  lastFailover = now;
  stallLog = [];
  failoverPending = Promise.resolve(wispFailover(state.transport?.wisp))
    .catch(() => {})
    .finally(() => {
      failoverPending = null;
    });
};

const noteStall = () => {
  const now = Date.now();
  stallLog = stallLog.filter((at) => now - at < FAILOVER_WINDOW_MS);
  stallLog.push(now);
  if (stallLog.length >= FAILOVER_STALLS) failover();
  recycleStalledSockets();
};

const checkServer = (client, since) => {
  if (serverProbe) return serverProbe;
  if (lastHealthy > since || Date.now() - lastProbeOk < HEALTHY_FOR_MS) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  serverProbe = client
    .request(new URL(PROBE_URL), 'GET', null, [], controller.signal)
    .then((res) => {
      lastProbeOk = Date.now();
      lastHealthy = lastProbeOk;
      res.body?.cancel?.().catch(() => {});
    })
    .catch(() => failover())
    .finally(() => {
      clearTimeout(timer);
      serverProbe = null;
    });
  return serverProbe;
};

const CONNECT_FAILURE = /code (7|35|56):/;
const NOT_SENT_FAILURE = /code (7|35):/;
const UNREACHABLE_FAILURE = /code 7:/;

const IFRAME_DEST_HOSTS = new Set(['rawcdn.githack.com', 'raw.githack.com']);

const asIframeRequest = (remote, headers) =>
  IFRAME_DEST_HOSTS.has(remote.hostname)
    ? headers.map(([name, value]) =>
        name.toLowerCase() === 'sec-fetch-dest' && value === 'document'
          ? [name, 'iframe']
          : [name, value],
      )
    : headers;

const guardTransport = (inner) => {
  const rawFetch = async (remote, method, body, rawHeaders, signal) => {
    const headers = asIframeRequest(remote, rawHeaders);
    const retryable = (method === 'GET' || method === 'HEAD') && !body;
    const replayable = !(body instanceof ReadableStream);
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward, { once: true });
      const startedAt = Date.now();
      let timer = null;
      const checkStall = () => {
        if (wispReceiving() && Date.now() - startedAt < QUEUED_TIMEOUT_MS) {
          timer = setTimeout(checkStall, 1000);
          return;
        }
        noteStall();
        forward();
      };
      if (retryable) timer = setTimeout(checkStall, HEADER_TIMEOUT_MS[attempt]);
      const client = state.rawClient || inner;
      try {
        const res = await client.request(remote, method, body, headers, controller.signal);
        lastHealthy = Date.now();
        return res;
      } catch (err) {
        const message = String(err?.message || err);
        if (CONNECT_FAILURE.test(message)) recycleStalledSockets();
        const probe = UNREACHABLE_FAILURE.test(message) ? checkServer(client, startedAt) : null;
        const canRetry = retryable || (replayable && NOT_SENT_FAILURE.test(message));
        if (!canRetry || attempt >= RETRY_DELAYS_MS.length || signal?.aborted) throw err;
        if (probe) await probe;
        if (failoverPending) await failoverPending;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forward);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  };

  return {
    ready: true,
    wisp: inner.wisp,
    init: async () => {},
    meta: async () => {},
    connect: (...args) => inner.connect(...args),
    request(remote, method, body, rawHeaders, signal) {
      return cachedTransportRequest(remote, method, body, rawHeaders, signal, rawFetch);
    },
  };
};

export const setScramjetWisp = (wispUrl) => {
  if (!wispUrl) return state.transportChain;
  state.transportChain = state.transportChain
    .then(async () => {
      const { LibcurlClient } = await importLibcurlV2();
      trackWispSockets();
      wispUrls.add(normalizeWisp(wispUrl));
      const client = new LibcurlClient({
        wisp: normalizeWisp(wispUrl),
        connections: LIBCURL_CONNECTIONS,
      });
      await client.init();
      const transport = guardTransport(client);
      state.rawClient = client;
      state.transport = transport;
      state.controller?.setTransport(transport);
      state.transportWaiters.splice(0).forEach((resolve) => resolve(transport));
    })
    .catch((err) => console.warn('scramjet transport err:', err));
  return state.transportChain;
};

const waitForTransport = () =>
  state.transport
    ? Promise.resolve(state.transport)
    : new Promise((resolve) => state.transportWaiters.push(resolve));

const activeWorker = async (registration) => {
  if (registration?.active && !registration.installing && !registration.waiting) {
    registration.update?.().catch(() => {});
    return registration.active;
  }
  await registration?.update?.().catch(() => {});
  await timeout(
    settleWorker(registration?.installing || registration?.waiting),
    10000,
    'scramjet service worker did not activate',
  );
  const worker = registration?.active;
  if (!worker) throw new Error('scramjet service worker is not active');
  return worker;
};

const createController = async (worker, transport, waitMs) => {
  const controller = new $scramjetController.Controller({
    serviceworker: worker,
    transport,
    config: {
      prefix: sjPrefix(),
      codec: state.codec,
      scramjetPath: versioned('z/b.js'),
      injectPath: versioned('z/d.js'),
      wasmPath: versioned('z/a.w'),
    },
    scramjetConfig: {
      flags: {
        sourcemaps: false,
        rewriterLogs: false,
        debugTrampolines: false,
        debugSourceURL: false,
      },
    },
  });
  await timeout(controller.wait(), waitMs, 'scramjet controller did not become ready');
  return controller;
};

const keepControllerAttached = (controller, registration) => {
  Object.defineProperty(controller, 'guardServiceWorkerRevive', {
    configurable: true,
    get: () => true,
    set: () => {},
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data?.$controller$swrevive) return;
    const worker = registration.active;
    if (!worker || event.source !== worker) return;
    controller.serviceWorkerController = worker;
    controller.setupMessagePort();
  });
};

export const bootScramjet = (registration) => {
  if (state.boot) return state.boot;
  state.boot = (async () => {
    const scriptsTask = loadScriptsOrdered([versioned('z/b.js'), versioned('z/c.js')]);
    const [worker, transport] = await Promise.all([
      activeWorker(registration),
      waitForTransport(),
      scriptsTask,
    ]);
    state.codec = makeSjCodec();
    const controller = await createController(worker, transport, 5000).catch(async () =>
      createController(await activeWorker(registration), state.transport || transport, 10000),
    );
    state.controller = controller;
    state.frame = controller.createFrame(document.createElement('iframe'));
    if (state.transport && state.transport !== transport) controller.setTransport(state.transport);
    keepControllerAttached(controller, registration);
  })().catch((err) => {
    state.boot = null;
    throw err;
  });
  return state.boot;
};

export const decodeSjPath = (rest) => {
  const match = rest.match(ROUTED_PATH);
  if (!match) return mango.dnc(rest);
  const encoded = match[1];
  if (state.codec) return state.codec.decode(encoded.split(/[?#]/)[0]);
  return mango.dnc(encoded);
};

export const toFrameSrc = (url) => {
  if (!state.frame || !url || typeof url !== 'string') return url;
  let parsed;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return url;
  }
  const base = sjPrefix();
  if (parsed.origin !== location.origin || !parsed.pathname.startsWith(base)) return url;
  if (parsed.pathname.startsWith(state.frame.prefix)) return url;
  const real = decodeSjPath(parsed.pathname.slice(base.length) + parsed.search);
  if (!/^https?:\/\//i.test(real || '')) return url;
  return location.origin + state.frame.prefix + state.codec.encode(real);
};

export const attachFrame = (iframe) => {
  if (iframe && state.frame) iframe[FRAME_HANDLE] = state.frame;
};

export const isProxyErrorPage = (doc) => {
  try {
    if (doc?.contentType !== 'text/plain') return false;
    const text = doc.body?.innerText || '';
    return ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
  } catch {
    return false;
  }
};
