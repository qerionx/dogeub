import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { patches, applyPatches, countMatches, patchScramjet } from './patchScramjet.js';

const scramjetDist = scramjetPath;
const bundlePath = path.join(scramjetDist, 'scramjet.all.js');
const wasmPath = path.join(scramjetDist, 'scramjet.wasm.wasm');

const orig = fs.readFileSync(bundlePath, 'utf8');
const wasmBytes = fs.readFileSync(wasmPath);

let failures = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (err) {
    failures++;
    results.push(`FAIL ${name}\n     ${String(err && err.stack ? err.stack : err).split('\n').join('\n     ')}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg || 'not equal'}\n  left:  ${x}\n  right: ${y}`);
}
function throws(fn, pattern, msg) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`${msg}: did not throw`);
  if (pattern && !pattern.test(err.message)) throw new Error(`${msg}: wrong error ${err.message}`);
}

const patched = patchScramjet(orig);

function sliceModule(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  assert(a >= 0, `module start ${startMarker} not found`);
  const b = text.indexOf(endMarker, a);
  assert(b > a, `module end ${endMarker} not found`);
  return text.slice(a + startMarker.length, b);
}

function makeFakeIdb() {
  const stores = new Map();
  const stats = { opens: 0, ops: 0, optionsSeen: [] };
  const key = (store, k) => `${store}\u0000${k}`;
  const db = {
    close() {
      stats.closed = (stats.closed || 0) + 1;
    },
    async get(store, k) {
      stats.ops++;
      const v = stores.get(key(store, k));
      return v === undefined ? undefined : structuredClone(v);
    },
    async put(store, v, k) {
      stats.ops++;
      stores.set(key(store, k), structuredClone(v));
    },
    async delete(store, k) {
      stats.ops++;
      stores.delete(key(store, k));
    },
  };
  const P2 = async (name, version, options) => {
    assert(name === '$scramjet' && version === 1, 'unexpected db open');
    stats.opens++;
    stats.optionsSeen.push(options);
    return db;
  };
  return { P2, stores, stats, db };
}

function loadModule(text, startMarker, endMarker, idb, extraSuffix = '') {
  const body = sliceModule(text, startMarker, endMarker);
  const r = () => ({ P2: idb.P2 });
  r.d = (target, defs) => {
    for (const k in defs) Object.defineProperty(target, k, { get: defs[k], enumerable: true });
  };
  const exportsObj = {};
  new Function('e', 't', 'r', body + extraSuffix)({}, exportsObj, r);
  return exportsObj;
}

const TRACKER_START = '6684:function(e,t,r){';
const TRACKER_END = '},2416:function';
const PSL_START = '8228:function(e,t,r){';
const PSL_END = '},2794:function';

await test('patched output differs from input and passes node --check', () => {
  assert(patched !== orig, 'output equals input');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sjpatch-'));
  try {
    const file = path.join(dir, 'scramjet.all.patched.js');
    fs.writeFileSync(file, patched);
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert(res.status === 0, `node --check failed: ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('expected counts per patch on the installed bundle', () => {
  const expected = {
    'wasm-decode': 1,
    'idb-handle': 2,
    'tracker-get': 1,
    'tracker-put': 1,
    'tracker-delete': 1,
    'regdomain-memo': 1,
    'wasm-payload': 1,
    'fetch-fn-prefix': 1,
  };
  eq(
    patches.map((p) => p.name),
    Object.keys(expected),
    'patch names/order',
  );
  for (const p of patches) {
    eq(p.expected, expected[p.name], `${p.name} configured count`);
    eq(countMatches(orig, p.regex), expected[p.name], `${p.name} actual count`);
  }
});

await test('patched bundle contains the markers and no leftover unpatched forms', () => {
  assert(!/Uint8Array\.from\(atob\(self\.WASM\)/.test(patched), 'wasm decode still present');
  assert(!/\.get\("redirectTrackers"/.test(patched), 'tracker get still present');
  assert(!/\.put\("redirectTrackers"/.test(patched), 'tracker put still present');
  assert(!/\.delete\("redirectTrackers"/.test(patched), 'tracker delete still present');
  assert(!/reduce\(\(e,t\)=>\(e\.push\(String\.fromCharCode\(t\)\)/.test(patched), 'slow base64 still present');
  eq(countMatches(patched, /let __sjdb;/g), 2, 'idb handle declarations');
  eq(countMatches(patched, /let __sjw;/g), 1, 'payload memo declaration');
});

await test('applying the patch twice throws', () => {
  throws(() => patchScramjet(patched), /scramjet patch mismatch/, 'double patch');
});

for (const p of patches) {
  await test(`guard throws when "${p.name}" matches 0 times (all removed)`, () => {
    let mutated = orig;
    const first = orig.match(p.regex)[0];
    mutated = mutated.split(first).join('GONE');
    assert(countMatches(mutated, p.regex) === 0, 'mutation did not zero matches');
    throws(() => patchScramjet(mutated), new RegExp(`${p.name}: expected ${p.expected} match\\(es\\), found 0`), p.name);
  });
  await test(`guard throws when "${p.name}" matches ${p.expected + 1} times (one extra)`, () => {
    const first = orig.match(p.regex)[0];
    const mutated = `${orig}\n${first}`;
    assert(countMatches(mutated, p.regex) === p.expected + 1, 'mutation did not add a match');
    throws(
      () => patchScramjet(mutated),
      new RegExp(`${p.name}: expected ${p.expected} match\\(es\\), found ${p.expected + 1}`),
      p.name,
    );
  });
  if (p.expected > 1) {
    await test(`guard throws when "${p.name}" matches ${p.expected - 1} times (one removed)`, () => {
      const first = orig.match(p.regex)[0];
      const mutated = orig.replace(first, 'GONE');
      throws(
        () => patchScramjet(mutated),
        new RegExp(`${p.name}: expected ${p.expected} match\\(es\\), found ${p.expected - 1}`),
        p.name,
      );
    });
  }
}

await test('guard reports every mismatching patch in one error', () => {
  let mutated = orig;
  for (const name of ['wasm-decode', 'tracker-get']) {
    const p = patches.find((x) => x.name === name);
    mutated = mutated.split(orig.match(p.regex)[0]).join('GONE');
  }
  throws(() => applyPatches(mutated), /wasm-decode[\s\S]*tracker-get/, 'multi report');
});

await test('guard does not modify anything when it throws', () => {
  const copy = `${orig}`;
  try {
    applyPatches(`${orig}\n${orig.match(patches[0].regex)[0]}`);
  } catch {}
  assert(copy === orig, 'input changed');
});

const SYNTH_PSL = [
  '\u002f\u002f comment line',
  '',
  'com',
  'org',
  'net',
  'uk',
  'co.uk',
  'org.uk',
  'jp',
  '*.kobe.jp',
  '!city.kobe.jp',
  '*.ck',
  '!www.ck',
  'github.io',
  'blogspot.com',
  'appspot.com',
  'herokuapp.com',
  'io',
  'dev',
  'app',
].join('\n');

function loadPsl(text) {
  const idb = makeFakeIdb();
  const mod = loadModule(text, PSL_START, PSL_END, idb);
  let fetches = 0;
  const client = {
    fetch: async () => {
      fetches++;
      return { text: async () => SYNTH_PSL };
    },
  };
  return { ps: mod.ps, client, idb, fetches: () => fetches };
}

const PSL_CASES = [
  ['https://cdn.jsdelivr.net/a.js', 'https://www.example.com/k/x'],
  ['https://fonts.gstatic.com/f.woff2', 'https://www.google.com/'],
  ['https://a.b.example.co.uk/x', 'https://c.example.co.uk/y'],
  ['https://example.com/', 'https://example.com/'],
  ['https://foo.github.io/', 'https://bar.github.io/'],
  ['https://foo.github.io/', 'https://foo.github.io/page'],
  ['https://x.blogspot.com/', 'https://y.blogspot.com/'],
  ['https://a.kobe.jp/', 'https://b.kobe.jp/'],
  ['https://x.a.kobe.jp/', 'https://y.a.kobe.jp/'],
  ['https://city.kobe.jp/', 'https://a.city.kobe.jp/'],
  ['https://www.ck/', 'https://x.www.ck/'],
  ['https://a.b.ck/', 'https://c.b.ck/'],
  ['https://localhost/', 'https://localhost:3000/'],
  ['http://127.0.0.1/', 'http://127.0.0.2/'],
  ['https://EXAMPLE.org/', 'https://sub.example.org/'],
  ['https://a.dev/', 'https://b.dev/'],
  ['https://my-app.herokuapp.com/', 'https://other.herokuapp.com/'],
  ['https://unknown.tld123/', 'https://other.tld123/'],
  ['https://a.example.com/', null],
  ['https://a.example.com:8080/', 'https://a.example.com/'],
];

await test('PSL module: patched output identical to original over hostname set', async () => {
  const a = loadPsl(orig);
  const b = loadPsl(patched);
  for (let round = 0; round < 3; round++) {
    for (const [u, rf] of PSL_CASES) {
      const ref = rf ? new URL(rf) : null;
      const ra = await a.ps({ origin: new URL(u) }, ref, a.client);
      const rb = await b.ps({ origin: new URL(u) }, ref, b.client);
      eq(rb, ra, `ps(${u}, ${rf}) round ${round}`);
    }
  }
});

await test('PSL module: sanity values and opens reduced to 1', async () => {
  const b = loadPsl(patched);
  const call = (u, rf) => b.ps({ origin: new URL(u) }, new URL(rf), b.client);
  eq(await call('https://a.example.com/', 'https://b.example.com/'), 'same-site', 'same-site');
  eq(await call('https://example.com/', 'https://example.com/'), 'same-origin', 'same-origin');
  eq(await call('https://a.github.io/', 'https://b.github.io/'), 'cross-site', 'cross-site');
  eq(await b.ps({ origin: new URL('https://a.com/') }, null, b.client), 'none', 'none');
  assert(b.idb.stats.opens === 1, `expected 1 open, got ${b.idb.stats.opens}`);
  const a = loadPsl(orig);
  await a.ps({ origin: new URL('https://a.example.com/') }, new URL('https://b.example.com/'), a.client);
  assert(a.idb.stats.opens > 1, 'original should open repeatedly');
});

await test('PSL module: memo cap does not change results across >4000 hostnames', async () => {
  const a = loadPsl(orig);
  const b = loadPsl(patched);
  for (let i = 0; i < 4200; i++) {
    const host = `h${i}.sub${i % 7}.${i % 3 === 0 ? 'co.uk' : i % 3 === 1 ? 'github.io' : 'example.com'}`;
    const ref = new URL(`https://other${i % 11}.${i % 3 === 0 ? 'co.uk' : 'example.com'}/`);
    const ra = await a.ps({ origin: new URL(`https://${host}/`) }, ref, a.client);
    const rb = await b.ps({ origin: new URL(`https://${host}/`) }, ref, b.client);
    if (ra !== rb) throw new Error(`mismatch at ${host}: ${ra} vs ${rb}`);
  }
  for (const [u, rf] of PSL_CASES.slice(0, 6)) {
    const ref = new URL(rf);
    eq(
      await b.ps({ origin: new URL(u) }, ref, b.client),
      await a.ps({ origin: new URL(u) }, ref, a.client),
      `post-cap ${u}`,
    );
  }
});

await test('PSL module: failed list fetch is not memoized and recovers', async () => {
  const idb = makeFakeIdb();
  const mod = loadModule(patched, PSL_START, PSL_END, idb);
  let fail = true;
  const client = {
    fetch: async () => {
      if (fail) throw new Error('boom');
      return { text: async () => SYNTH_PSL };
    },
  };
  let threw = false;
  try {
    await mod.ps({ origin: new URL('https://a.example.com/') }, new URL('https://b.example.com/'), client);
  } catch {
    threw = true;
  }
  assert(threw, 'expected rejection');
  fail = false;
  eq(await mod.ps({ origin: new URL('https://a.example.com/') }, new URL('https://b.example.com/'), client), 'same-site', 'recovered');
});

function makeScript(seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const urls = Array.from({ length: 6 }, (_, i) => `https://site${i}.example.com/p?${i}`);
  const sites = ['none', 'same-origin', 'same-site', 'cross-site'];
  const policies = ['', 'no-referrer', 'origin', 'strict-origin-when-cross-origin'];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ops = [];
  for (let i = 0; i < 600; i++) {
    const k = rnd();
    if (k < 0.2) ops.push(['rj', pick(urls), rnd() < 0.3 ? null : pick(urls), pick(sites)]);
    else if (k < 0.4) ops.push(['YH', pick(urls), pick(urls), rnd() < 0.5 ? pick(policies) : undefined]);
    else if (k < 0.7) ops.push(['hU', pick(urls), pick(sites)]);
    else if (k < 0.85) ops.push(['Sn', pick(urls)]);
    else if (k < 0.93) ops.push(['pL', pick(urls), pick(policies), pick(urls)]);
    else ops.push(['Yq', pick(urls)]);
  }
  return ops;
}

async function runTrackerScript(text, ops) {
  const idb = makeFakeIdb();
  const mod = loadModule(text, TRACKER_START, TRACKER_END, idb, ';t.__map=typeof __sjrt==="undefined"?null:__sjrt;');
  const out = [];
  const realNow = Date.now;
  let tick = 1000;
  Date.now = () => tick++;
  try {
    for (const op of ops) {
      const [name, ...args] = op;
      out.push([name, await mod[name](...args)]);
    }
  } finally {
    Date.now = realNow;
  }
  let dump;
  if (mod.__map) {
    dump = [...mod.__map.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
  } else {
    dump = [...idb.stores.entries()]
      .filter(([k]) => k.startsWith('redirectTrackers\u0000'))
      .map(([k, v]) => [k.split('\u0000')[1], v])
      .sort(([x], [y]) => (x < y ? -1 : 1));
  }
  const policies = [...idb.stores.entries()].filter(([k]) => k.startsWith('referrerPolicies')).sort(([x], [y]) => (x < y ? -1 : 1));
  return { out, dump, policies, stats: idb.stats };
}

for (const seed of [1, 2, 3, 42, 1234]) {
  await test(`tracker module: patched == original under random op script (seed ${seed})`, async () => {
    const ops = makeScript(seed);
    const a = await runTrackerScript(orig, ops);
    const b = await runTrackerScript(patched, ops);
    eq(b.out, a.out, 'op results');
    eq(b.dump, a.dump, 'final tracker state');
    eq(b.policies, a.policies, 'referrer policy store');
    assert(b.stats.opens <= 1, `patched opened db ${b.stats.opens} times`);
    assert(a.stats.opens > 100, 'original should open repeatedly');
  });
}

await test('tracker module: explicit get/put/delete/redirect semantics', async () => {
  for (const [label, text] of [['orig', orig], ['patched', patched]]) {
    const idb = makeFakeIdb();
    const m = loadModule(text, TRACKER_START, TRACKER_END, idb);
    await m.rj('u1', 'ref', 'same-site');
    await m.rj('u1', 'other', 'cross-site');
    eq(await m.hU('u1', 'none'), 'same-site', `${label} existing tracker wins over later init`);
    eq(await m.hU('u1', 'cross-site'), 'cross-site', `${label} escalates`);
    eq(await m.hU('u1', 'same-origin'), 'cross-site', `${label} keeps most restrictive`);
    await m.YH('u1', 'u2', 'origin');
    eq(await m.hU('u1', 'none'), 'none', `${label} old key removed after redirect`);
    eq(await m.hU('u2', 'none'), 'cross-site', `${label} new key inherits`);
    await m.Sn('u2');
    eq(await m.hU('u2', 'same-origin'), 'same-origin', `${label} cleaned`);
    await m.YH('missing', 'u9', 'origin');
    eq(await m.hU('u9', 'same-site'), 'same-site', `${label} update of missing is a no-op`);
    await m.pL('u3', 'no-referrer', 'r3');
    eq(await m.Yq('u3'), { policy: 'no-referrer', referrer: 'r3' }, `${label} referrer policy roundtrip`);
    eq(await m.Yq('nope'), null, `${label} missing policy is null`);
  }
});

await test('tracker module: put stores a copy so later mutation of the original is isolated', async () => {
  const idb2 = makeFakeIdb();
  const m2 = loadModule(patched, TRACKER_START, TRACKER_END, idb2, ';t.__map=__sjrt;');
  await m2.rj('a', 'ref', 'same-site');
  const before = m2.__map.get('a');
  await m2.hU('a', 'cross-site');
  assert(m2.__map.get('a') !== before, 'put must store a copy, not the caller object');
});

await test('tracker module: map is capped at 4000 entries and eviction only drops oldest', async () => {
  const idb = makeFakeIdb();
  const m = loadModule(patched, TRACKER_START, TRACKER_END, idb, ';t.__map=__sjrt;');
  for (let i = 0; i < 4100; i++) await m.rj(`u${i}`, '', 'none');
  eq(m.__map.size, 4000, 'size');
  assert(!m.__map.has('u0') && m.__map.has('u4099'), 'oldest evicted, newest kept');
  eq(await m.hU('u0', 'same-site'), 'same-site', 'evicted entry behaves as no tracker');
});

await test('idb handle: single open, reset on blocking/terminated/rejection', async () => {
  const idb = makeFakeIdb();
  const m = loadModule(patched, TRACKER_START, TRACKER_END, idb);
  await m.pL('a', 'p', 'r');
  await m.pL('b', 'p', 'r');
  await m.Yq('a');
  eq(idb.stats.opens, 1, 'opens after 3 calls');
  const opts = idb.stats.optionsSeen[0];
  assert(typeof opts.blocking === 'function' && typeof opts.terminated === 'function', 'handlers present');
  opts.blocking(1, 2, { target: idb.db });
  eq(idb.stats.closed, 1, 'blocking closes the db');
  await m.Yq('a');
  eq(idb.stats.opens, 2, 'reopen after blocking');
  idb.stats.optionsSeen[1].terminated();
  await m.Yq('a');
  eq(idb.stats.opens, 3, 'reopen after terminated');

  let failOpen = true;
  let opens = 0;
  const flaky = {
    P2: async () => {
      opens++;
      if (failOpen) throw new Error('open failed');
      return idb.db;
    },
  };
  const body = sliceModule(patched, TRACKER_START, TRACKER_END);
  const r = () => ({ P2: flaky.P2 });
  r.d = (target, defs) => {
    for (const k in defs) Object.defineProperty(target, k, { get: defs[k], enumerable: true });
  };
  const ex = {};
  new Function('e', 't', 'r', body)({}, ex, r);
  let threw = false;
  try {
    await ex.Yq('a');
  } catch {
    threw = true;
  }
  assert(threw, 'first open should reject');
  failOpen = false;
  await ex.Yq('a');
  await ex.Yq('a');
  eq(opens, 2, 'rejected open not cached, success then cached');
});

function extractWasmFn(text, withPrefix) {
  const startMarker = withPrefix ? 'let __sjw;async function m(e,t){try{' : 'async function m(e,t){try{let r,n,o=new URL(e.url);if(o.pathname===this.config.files.wasm)';
  const a = text.indexOf(startMarker);
  assert(a >= 0, 'wasm function not found');
  const b = text.indexOf(';let u="",d={};for(let[e,t]of[...o.searchParams.entries()])', a);
  assert(b > a, 'wasm function end not found');
  const head = text.slice(a, b);
  return `${head}}catch(i){throw i}}return m`;
}

function makeWasmHarness(text, withPrefix, fetchImpl) {
  const src = extractWasmFn(text, withPrefix);
  const factory = new Function('fetch', 'btoa', 'self', 'document', src);
  const m = factory(fetchImpl, btoa, {}, undefined);
  const self = { config: { files: { wasm: '/z/a.w' } } };
  return (url = 'https://h.example/z/a.w') => m.call(self, { url, destination: 'script', mode: 'no-cors', headers: new Headers() });
}

function okFetch(counter) {
  return async () => {
    counter.n++;
    return new Response(wasmBytes, { status: 200 });
  };
}

await test('wasm payload: byte-identical to original construction', async () => {
  const c1 = { n: 0 };
  const c2 = { n: 0 };
  const runOrig = makeWasmHarness(orig, false, okFetch(c1));
  const runPatched = makeWasmHarness(patched, true, okFetch(c2));
  const ra = await runOrig();
  const rb = await runPatched();
  const ta = await ra.text();
  const tb = await rb.text();
  assert(ta.length > wasmBytes.length, 'payload implausibly small');
  assert(ta === tb, 'payload text differs');
  eq(ra.headers.get('content-type'), rb.headers.get('content-type'), 'content-type');
  eq(ra.status, rb.status, 'status');
  const sw = new Uint8Array(Buffer.from(tb.slice(tb.indexOf("self.WASM = '") + 13, tb.lastIndexOf("';")), 'base64'));
  assert(Buffer.compare(Buffer.from(sw), wasmBytes) === 0, 'payload does not decode back to the wasm file');
});

await test('wasm payload: memoized (one fetch for many requests), concurrent safe', async () => {
  const c = { n: 0 };
  const run = makeWasmHarness(patched, true, okFetch(c));
  const rs = await Promise.all([run(), run(), run()]);
  const texts = await Promise.all(rs.map((r) => r.text()));
  assert(texts[0] === texts[1] && texts[1] === texts[2], 'texts differ');
  await (await run()).text();
  eq(c.n, 1, 'fetch count');
  const ca = { n: 0 };
  const runO = makeWasmHarness(orig, false, okFetch(ca));
  await runO();
  await runO();
  eq(ca.n, 2, 'original fetches every time');
});

await test('wasm payload: memo resets on rejection and on non-ok status', async () => {
  let mode = 'reject';
  let n = 0;
  const f = async () => {
    n++;
    if (mode === 'reject') throw new Error('net');
    if (mode === 'bad') return new Response('nope', { status: 503 });
    return new Response(wasmBytes, { status: 200 });
  };
  const run = makeWasmHarness(patched, true, f);
  let threw = false;
  try {
    await run();
  } catch {
    threw = true;
  }
  assert(threw, 'expected rejection');
  mode = 'bad';
  await (await run()).text();
  mode = 'good';
  const good = await (await run()).text();
  assert(good.length > wasmBytes.length, 'recovered payload');
  const before = n;
  await (await run()).text();
  eq(n, before, 'good payload memoized');
});

await test('wasm payload: non-wasm requests do not enter the memo path', async () => {
  const c = { n: 0 };
  const run = makeWasmHarness(patched, true, okFetch(c));
  let reachedBody = false;
  try {
    const r = await run('https://h.example/other.js');
    reachedBody = r === undefined;
  } catch {
    reachedBody = true;
  }
  eq(c.n, 0, 'no wasm fetch for other paths');
});

await test('wasm decode: indexed loop equals Uint8Array.from for the real wasm and edge strings', () => {
  const m = patched.match(/\(\(\)=>\{let s=atob\(self\.WASM\),u=new Uint8Array\(s\.length\);for\(let i=0;i<s\.length;i\+\+\)u\[i\]=s\.charCodeAt\(i\);return u\}\)\(\)/);
  assert(m, 'decode snippet missing in patched bundle');
  const decode = (b64) => new Function('self', `return ${m[0]}`)({ WASM: b64, atob });
  for (const bytes of [wasmBytes, Buffer.alloc(0), Buffer.from([0, 255, 128, 1]), Buffer.from('\0asm\u0001\0\0\0')]) {
    const b64 = Buffer.from(bytes).toString('base64');
    const expectedBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const got = decode(b64);
    assert(got instanceof Uint8Array, 'not Uint8Array');
    assert(Buffer.compare(Buffer.from(got), Buffer.from(expectedBytes)) === 0, 'bytes differ');
  }
});

await test('transform wiring semantics: handler gets (content, filename) and returns a string', () => {
  const handler = (content) => patchScramjet(content);
  const out = handler(orig, bundlePath);
  assert(typeof out === 'string' && out.length > orig.length - 1000, 'bad output');
});

for (const line of results) process.stdout.write(`${line}\n`);
process.stdout.write(`\n${results.length - failures}/${results.length} passed\n`);
process.exit(failures ? 1 : 0);
