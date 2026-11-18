import { mango } from './of.js';

const FRAME_HANDLE = Symbol.for('controller frame handle');
const ROUTED_PATH = /^[a-z0-9]+\/[a-z0-9]+\/(.*)$/;
const ERROR_PREFIXES = [
  'Internal Service Worker Error',
  'This page is no longer connected to the proxy',
];

const appPath = (path) =>
  isStaticBuild ? new URL(`./${path}`, location.href).pathname : `/${path}`;
const versioned = (path) => `${appPath(path)}?v=${SJ_ASSET_VERSION}`;

export const sjPrefix = () => appPath('k/');

const state = {
  controller: null,
  frame: null,
  codec: null,
  transport: null,
  boot: null,
  transportChain: Promise.resolve(),
  transportWaiters: [],
};

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });

const makeCodec = () => {
  const key = Array.from(
    new TextEncoder().encode(
      btoa(new Date().toISOString().slice(0, 10) + location.host)
        .split('')
        .reverse()
        .join('')
        .slice(6),
    ),
  ).slice(0, 8);
  const encode = new Function(
    's',
    `if(!s)return s;const k=[${key}];const d=new TextEncoder().encode(s);let o='';for(let i=0;i<d.length;i++)o+=(d[i]^k[i%8]).toString(16).padStart(2,'0');return o;`,
  );
  const decode = new Function(
    's',
    `if(!s)return s;const k=[${key}];let h=0;while(h<s.length&&/[0-9a-fA-F]/.test(s[h]))h++;if(h<2||h%2){try{return decodeURIComponent(s)}catch(e){return s}}const o=new Uint8Array(h>>1);for(let i=0;i<o.length;i++)o[i]=parseInt(s.substr(i*2,2),16)^k[i%8];return new TextDecoder().decode(o)+s.slice(h);`,
  );
  return { encode, decode };
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
const STALL_WINDOW_MS = 10000;
const FAILOVER_WINDOW_MS = 60000;
const FAILOVER_STALLS = 4;
const SOCKET_IDLE_MS = 4000;
const RETRY_DELAYS_MS = [300, 1200];
const LIBCURL_CONNECTIONS = [24, 8, 6];
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

const recycleStalledSockets = () => {
  const now = Date.now();
  for (const socket of wispSockets) {
    if (now - socket.lastActivity > SOCKET_IDLE_MS) socket.close();
  }
};

let recentStalls = [];
let stallLog = [];
let wispFailover = null;
let lastFailover = 0;

export const setWispFailover = (handler) => {
  wispFailover = handler;
};

const noteStall = () => {
  const now = Date.now();
  stallLog = stallLog.filter((at) => now - at < FAILOVER_WINDOW_MS);
  stallLog.push(now);
  if (
    wispFailover &&
    stallLog.length >= FAILOVER_STALLS &&
    now - lastFailover > FAILOVER_WINDOW_MS
  ) {
    lastFailover = now;
    stallLog = [];
    Promise.resolve(wispFailover(state.transport?.wisp)).catch(() => {});
  }
  recentStalls = recentStalls.filter((at) => now - at < STALL_WINDOW_MS);
  recentStalls.push(now);
  if (recentStalls.length < 2) return recycleStalledSockets();
  recentStalls = [];
  resetWispSockets();
};

const CONNECT_FAILURE = /code (7|35|56):/;
const NOT_SENT_FAILURE = /code (7|35):/;
let socketReset = null;

const closeSocket = (socket) =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.addEventListener('close', () => resolve(), { once: true });
    setTimeout(resolve, 1000);
    socket.close();
  });

const resetWispSockets = () => {
  if (!socketReset) {
    socketReset = Promise.all([...wispSockets].map(closeSocket)).then(() =>
      setTimeout(() => {
        socketReset = null;
      }, 2000),
    );
  }
  return socketReset;
};

const IFRAME_DEST_HOSTS = new Set(['rawcdn.githack.com', 'raw.githack.com']);

const asIframeRequest = (remote, headers) =>
  IFRAME_DEST_HOSTS.has(remote.hostname)
    ? headers.map(([name, value]) =>
        name.toLowerCase() === 'sec-fetch-dest' && value === 'document'
          ? [name, 'iframe']
          : [name, value],
      )
    : headers;

const guardTransport = (inner) => ({
  ready: true,
  wisp: inner.wisp,
  init: async () => {},
  meta: async () => {},
  connect: (...args) => inner.connect(...args),
  async request(remote, method, body, rawHeaders, signal) {
    const headers = asIframeRequest(remote, rawHeaders);
    const retryable = (method === 'GET' || method === 'HEAD') && !body;
    const replayable = !(body instanceof ReadableStream);
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward, { once: true });
      const timer = retryable
        ? setTimeout(() => {
            noteStall();
            forward();
          }, HEADER_TIMEOUT_MS[attempt])
        : null;
      try {
        return await inner.request(remote, method, body, headers, controller.signal);
      } catch (err) {
        const message = String(err?.message || err);
        const brokenSocket = CONNECT_FAILURE.test(message);
        if (brokenSocket) resetWispSockets();
        const canRetry = retryable || (replayable && NOT_SENT_FAILURE.test(message));
        if (!canRetry || attempt >= RETRY_DELAYS_MS.length || signal?.aborted) throw err;
        if (socketReset) await socketReset;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forward);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  },
});

export const setScramjetWisp = (wispUrl) => {
  if (!wispUrl) return state.transportChain;
  state.transportChain = state.transportChain
    .then(async () => {
      const { LibcurlClient } = await import(/* @vite-ignore */ versioned('x/c.mjs'));
      trackWispSockets();
      wispUrls.add(normalizeWisp(wispUrl));
      const client = new LibcurlClient({
        wisp: normalizeWisp(wispUrl),
        connections: LIBCURL_CONNECTIONS,
      });
      await client.init();
      const transport = guardTransport(client);
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
    const worker = await activeWorker(registration);
    if (typeof $scramjetController === 'undefined') {
      await loadScript(versioned('z/b.js'));
      await loadScript(versioned('z/c.js'));
    }
    const transport = await waitForTransport();
    state.codec = makeCodec();
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
