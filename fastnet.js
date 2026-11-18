import net from 'node:net';
import dns from 'node:dns/promises';

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blocked.addSubnet(a, p, 'ipv4');
}
for (const [a, p] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
  ['2002::', 16],
]) {
  blocked.addSubnet(a, p, 'ipv6');
}

const mapped = new net.BlockList();
mapped.addSubnet('::ffff:0:0', 96, 'ipv6');

function isBlocked(a) {
  return blocked.check(a, a.includes(':') ? 'ipv6' : 'ipv4');
}

const resolver = new dns.Resolver({ timeout: 1500, tries: 2 });
resolver.setServers(['1.1.1.3', '1.0.0.3']);

const cache = new Map();
const inflight = new Map();
const MIN_TTL = 30000;
const MAX_TTL = 300000;
const NEG_TTL = 5000;
const DUAL_STACK_GRACE_MS = 35;

function extractValid(rows) {
  const valid = [];
  let minTtl = Infinity;
  for (const r of rows) {
    if (!isBlocked(r.address)) {
      valid.push(r.address);
      if (r.ttl < minTtl) minTtl = r.ttl;
    }
  }
  return { valid, minTtl };
}

async function query(host) {
  let rows4 = null;
  let rows6 = null;
  let done4 = false;
  let done6 = false;

  const p4 = resolver.resolve4(host, { ttl: true }).then(
    (v) => {
      rows4 = v;
      done4 = true;
      return v;
    },
    () => {
      done4 = true;
      return [];
    },
  );
  const p6 = resolver.resolve6(host, { ttl: true }).then(
    (v) => {
      rows6 = v;
      done6 = true;
      return v;
    },
    () => {
      done6 = true;
      return [];
    },
  );

  await Promise.race([p4, p6]);

  const firstRows = [...(rows4 || []), ...(rows6 || [])];
  const firstValid = extractValid(firstRows);

  if (firstValid.valid.length > 0 && !(done4 && done6)) {
    const other = done4 ? p6 : p4;
    let graceTimer;
    await Promise.race([
      other,
      new Promise((r) => {
        graceTimer = setTimeout(r, DUAL_STACK_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimer);

    if (!(done4 && done6)) {
      other.then((lateRows) => {
        if (!lateRows || !lateRows.length) return;
        const cur = cache.get(host);
        if (!cur || !cur.addrs) return;
        const merged = [
          ...extractValid(rows4 || []).valid,
          ...extractValid(rows6 || []).valid,
        ];
        if (merged.length > cur.addrs.length) cur.addrs = merged;
      });
    }
  } else if (!(done4 && done6)) {
    await Promise.all([p4, p6]);
  }

  const allRows = [...(rows4 || []), ...(rows6 || [])];
  const { valid: addrs, minTtl } = extractValid(allRows);
  if (!addrs.length) {
    const err = new Error('dns failure');
    if (allRows.length) err.blocked = allRows[0].address;
    throw err;
  }
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, minTtl * 1000));
  return { addrs, ttl };
}

export function resolveHost(host) {
  const ipVer = net.isIP(host);
  if (ipVer) {
    if (ipVer === 6 && mapped.check(host, 'ipv6') && isBlocked(host)) {
      return Promise.reject(new Error('blocked address'));
    }
    return Promise.resolve([host]);
  }
  const hit = cache.get(host);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.err ? Promise.reject(hit.err) : Promise.resolve(hit.addrs);
  if (hit && hit.addrs && !inflight.has(host)) refresh(host).catch(() => {});
  if (hit && hit.addrs) return Promise.resolve(hit.addrs);
  return refresh(host);
}

function refresh(host) {
  let p = inflight.get(host);
  if (p) return p;
  p = query(host)
    .then(
      (r) => {
        cache.set(host, {
          addrs: r.addrs,
          exp: Date.now() + r.ttl,
          stale: Date.now() + r.ttl * 4,
        });
        return r.addrs;
      },
      (err) => {
        cache.set(host, { err, exp: Date.now() + NEG_TTL });
        throw err;
      },
    )
    .finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [h, e] of cache) if ((e.stale ?? e.exp) < now) cache.delete(h);
}, 60000).unref();

const SOCKET_HWM = 256 * 1024;

function dial(host, port, timeout, activeSockets) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket({
      readableHighWaterMark: SOCKET_HWM,
      writableHighWaterMark: SOCKET_HWM,
    });
    activeSockets.add(s);
    s.setNoDelay(true);
    s.setTimeout(timeout, () => s.destroy(new Error('connect timeout')));
    const onError = (err) => {
      activeSockets.delete(s);
      reject(err);
    };
    s.once('error', onError);
    s.connect({ host, port }, () => {
      s.setTimeout(0);
      s.removeListener('error', onError);
      resolve(s);
    });
  });
}

function race(addrs, port) {
  const list = addrs.slice(0, 4);
  if (list.length === 1) {
    return dial(list[0], port, 6000, new Set());
  }
  return new Promise((resolve, reject) => {
    const launched = new Set();
    const activeSockets = new Set();
    const timers = [];
    let failed = 0;
    let done = false;
    const launch = (i) => {
      if (done || i >= list.length || launched.has(i)) return;
      launched.add(i);
      dial(list[i], port, 6000, activeSockets).then(
        (s) => {
          activeSockets.delete(s);
          if (done) {
            s.destroy();
            return;
          }
          done = true;
          timers.forEach(clearTimeout);
          for (const other of activeSockets) other.destroy();
          activeSockets.clear();
          resolve(s);
        },
        (e) => {
          if (done) return;
          if (++failed === list.length) return reject(e);
          launch(launched.size);
        },
      );
    };
    launch(0);
    for (let i = 1; i < list.length; i++) {
      timers.push(setTimeout(() => launch(i), i * 200));
    }
  });
}

const HIGH = 1024 * 1024;
const LOW = 256 * 1024;
const MAX_COALESCE = 128 * 1024;

export class FastTCPSocket {
  constructor(hostname, port) {
    this.hostname = hostname;
    this.port = port;
    this.socket = null;
    this.chunks = [];
    this.head = 0;
    this.bytes = 0;
    this.waiter = null;
    this.ended = false;
    this.held = false;
  }

  async connect() {
    const addrs = await resolveHost(this.hostname);
    const s = await race(addrs, this.port);
    this.socket = s;
    s.setKeepAlive(true, 60000);
    s.on('data', (d) => {
      this.chunks.push(d);
      this.bytes += d.length;
      if (this.bytes >= HIGH && !this.held) {
        this.held = true;
        s.pause();
      }
      this.wake();
    });
    s.on('close', () => {
      this.ended = true;
      this.wake();
    });
    s.on('error', () => {});
  }

  wake() {
    const w = this.waiter;
    this.waiter = null;
    if (w) w();
  }

  async recv() {
    while (this.head >= this.chunks.length) {
      if (this.ended) return null;
      await new Promise((r) => {
        this.waiter = r;
      });
    }

    const first = this.chunks[this.head];
    this.chunks[this.head] = null;
    this.head += 1;

    let out = first;
    if (this.head < this.chunks.length && first.length < MAX_COALESCE) {
      let total = first.length;
      let end = this.head;
      while (end < this.chunks.length && total + this.chunks[end].length <= MAX_COALESCE) {
        total += this.chunks[end].length;
        end += 1;
      }
      if (end > this.head) {
        const batch = new Array(end - this.head + 1);
        batch[0] = first;
        for (let i = this.head, j = 1; i < end; i++, j++) {
          batch[j] = this.chunks[i];
          this.chunks[i] = null;
        }
        this.head = end;
        out = Buffer.concat(batch, total);
      }
    }

    if (this.head >= this.chunks.length) {
      this.chunks.length = 0;
      this.head = 0;
    } else if (this.head >= 64 && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }

    this.bytes -= out.length;
    if (this.held && this.bytes < LOW && this.socket) {
      this.held = false;
      this.socket.resume();
    }
    return out;
  }

  send(data) {
    const s = this.socket;
    if (!s || s.destroyed || !s.writable) return;
    if (s.write(data)) return;
    return new Promise((resolve) => {
      const done = () => {
        s.removeListener('drain', done);
        s.removeListener('close', done);
        resolve();
      };
      s.once('drain', done);
      s.once('close', done);
    });
  }

  async close() {
    const s = this.socket;
    if (!s) return;
    this.socket = null;
    s.destroySoon();
  }

  pause() {}
  resume() {}
}
