import net from "node:net";
import dns from "node:dns/promises";

const blocked = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["2002::", 16]]) blocked.addSubnet(a, p, "ipv6");

const mapped = new net.BlockList();
mapped.addSubnet("::ffff:0:0", 96, "ipv6");

function isBlocked(a) {
  return blocked.check(a, a.includes(":") ? "ipv6" : "ipv4");
}

const resolver = new dns.Resolver({ timeout: 1500, tries: 2 });
resolver.setServers(["1.1.1.3", "1.0.0.3"]);

const cache = new Map();
const inflight = new Map();
const MIN_TTL = 30000;
const MAX_TTL = 300000;
const NEG_TTL = 5000;

async function query(host) {
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(host, { ttl: true }), resolver.resolve6(host, { ttl: true })]);
  const rows = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])];
  const addrs = rows.map(r => r.address).filter(a => !isBlocked(a));
  if (!addrs.length) {
    const err = new Error("dns failure");
    if (rows.length) err.blocked = rows[0].address;
    throw err;
  }
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Math.min(...rows.map(r => r.ttl)) * 1000));
  return { addrs, ttl };
}

export function resolveHost(host) {
  if (net.isIP(host)) {
    if (net.isIP(host) === 6 && mapped.check(host, "ipv6") && isBlocked(host)) return Promise.reject(new Error("blocked address"));
    return Promise.resolve([host]);
  }
  const hit = cache.get(host);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.err ? Promise.reject(hit.err) : Promise.resolve(hit.addrs);
  if (hit && hit.addrs && !inflight.has(host)) refresh(host);
  if (hit && hit.addrs) return Promise.resolve(hit.addrs);
  return refresh(host);
}

function refresh(host) {
  let p = inflight.get(host);
  if (p) return p;
  p = query(host).then(
    r => { cache.set(host, { addrs: r.addrs, exp: Date.now() + r.ttl, stale: Date.now() + r.ttl * 4 }); return r.addrs; },
    err => { cache.set(host, { err, exp: Date.now() + NEG_TTL }); throw err; }
  ).finally(() => inflight.delete(host));
  inflight.set(host, p);
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [h, e] of cache) if ((e.stale ?? e.exp) < now) cache.delete(h);
}, 60000).unref();

function dial(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    s.setNoDelay(true);
    s.setTimeout(timeout, () => s.destroy(new Error("connect timeout")));
    s.once("error", reject);
    s.connect({ host, port }, () => {
      s.setTimeout(0);
      s.removeListener("error", reject);
      resolve(s);
    });
  });
}

function race(addrs, port) {
  const list = addrs.slice(0, 4);
  return new Promise((resolve, reject) => {
    const launched = new Set();
    const timers = [];
    let failed = 0;
    let done = false;
    const launch = i => {
      if (done || i >= list.length || launched.has(i)) return;
      launched.add(i);
      dial(list[i], port, 6000).then(
        s => {
          if (done) return s.destroy();
          done = true;
          timers.forEach(clearTimeout);
          resolve(s);
        },
        e => {
          if (++failed === list.length) return reject(e);
          launch(launched.size);
        }
      );
    };
    list.forEach((_, i) => timers.push(setTimeout(() => launch(i), i * 250)));
  });
}

const HIGH = 1024 * 1024;
const LOW = 256 * 1024;

export class FastTCPSocket {
  constructor(hostname, port) {
    this.hostname = hostname;
    this.port = port;
    this.socket = null;
    this.chunks = [];
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
    s.on("data", d => {
      this.chunks.push(d);
      this.bytes += d.length;
      if (this.bytes >= HIGH && !this.held) {
        this.held = true;
        s.pause();
      }
      this.wake();
    });
    s.on("close", () => {
      this.ended = true;
      this.wake();
    });
    s.on("error", () => {});
  }

  wake() {
    const w = this.waiter;
    this.waiter = null;
    if (w) w();
  }

  async recv() {
    while (this.chunks.length === 0) {
      if (this.ended) return null;
      await new Promise(r => (this.waiter = r));
    }
    const d = this.chunks.shift();
    this.bytes -= d.length;
    if (this.held && this.bytes < LOW && this.socket) {
      this.held = false;
      this.socket.resume();
    }
    return d;
  }

  send(data) {
    const s = this.socket;
    if (!s || s.destroyed || !s.writable) return Promise.resolve();
    return new Promise(res => s.write(data, () => res()));
  }

  async close() {
    const s = this.socket;
    if (!s) return;
    s.destroySoon();
  }

  pause() {}
  resume() {}
}
