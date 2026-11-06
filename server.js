import dotenv from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import compress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { logging, server as wisp } from "@mercuryworkshop/wisp-js/server";
import { createBareServer } from "@tomphttp/bare-server-node";
import { MasqrMiddleware } from "./masqr.js";
import { FastTCPSocket, resolveHost } from "./fastnet.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = process.env.PORT || 2345;
const server = createServer();
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
const bare = process.env.BARE === "true" ? createBareServer("/seal/") : null;
logging.set_level(logging.NONE);

Object.assign(wisp.options, {
  dns_method: async host => {
    try {
      return (await resolveHost(host))[0];
    } catch (e) {
      if (e.blocked) return e.blocked;
      throw e;
    }
  },
  dns_ttl: 0,
  dns_servers: ["1.1.1.3", "1.0.0.3"],
  dns_result_order: "ipv4first"
});

const wispSetup = wisp.ServerConnection.prototype.setup;
wisp.ServerConnection.prototype.setup = function () {
  this.ws.send_buffer_size = 2 * 1024 * 1024;
  return wispSetup.call(this);
};

server.on("upgrade", (req, sock, head) =>
  bare?.shouldRoute(req)
    ? bare.routeUpgrade(req, sock, head)
    : req.url.endsWith("/connection/")
      ? wisp.routeRequest(req, sock, head, { TCPSocket: FastTCPSocket })
      : sock.end()
);

const app = Fastify({
  serverFactory: h => (
    server.on("request", (req, res) =>
      bare?.shouldRoute(req) ? bare.routeRequest(req, res) : h(req, res)
    ),
    server
  ),
  logger: false,
  keepAliveTimeout: 30000,
  connectionTimeout: 60000,
  forceCloseConnections: true
});

await app.register(fastifyCookie);
await app.register(compress, { global: true, encodings: ['br','gzip','deflate'] });

const distDir = join(__dirname, "dist");
const IMMUTABLE = "public, max-age=31536000, immutable";
const rootEntry = (() => {
  try {
    const html = readFileSync(join(distDir, "index.html"), "utf8");
    return html.match(/<script[^>]*type="module"[^>]*src="\/([^"/?#]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
})();
const REVALIDATE = new Set(["sw.js", "s_sw.js", "loadersw.js"]);
const ENCODED = /\.(br|gz)$/;
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|w)$/;

app.register(fastifyStatic, {
  root: distDir,
  prefix: "/",
  decorateReply: true,
  etag: true,
  lastModified: true,
  cacheControl: false,
  preCompressed: true,
  setHeaders(res, path) {
    const encoded = ENCODED.test(path);
    const rel = relative(distDir, encoded ? path.replace(ENCODED, "") : path).split(sep).join("/");
    if (rel.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    } else if (REVALIDATE.has(rel)) {
      res.setHeader("Cache-Control", "no-cache");
    } else if (rel.startsWith("chunks/") || rel.startsWith("assets/") || rel === rootEntry) {
      res.setHeader("Cache-Control", IMMUTABLE);
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
    if (COMPRESSIBLE.test(rel)) res.setHeader("Vary", "Accept-Encoding");
  }
});

if (process.env.MASQR === "true")
  app.addHook("onRequest", MasqrMiddleware);

const proxy = (url, type = "application/javascript") => async (req, reply) => {
  try {
    const res = await fetch(url(req));
    if (!res.ok) return reply.code(res.status).send();

    const hop = [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "content-encoding"
    ];
    for (const [k, v] of res.headers) {
      if (!hop.includes(k.toLowerCase())) reply.header(k, v);
    }

    if (res.headers.getSetCookie) {
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
    }

    if (!res.headers.get("content-type")) reply.type(type);

    return reply.send(res.body);
  } catch {
    return reply.code(500).send();
  }
};

const IMG_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const IMG_ENTRIES = 600;
const IMG_ENTRY_MAX = 4 * 1024 * 1024;
const IMG_TOTAL_MAX = 96 * 1024 * 1024;
const IMG_FRESH_MS = 10 * 60 * 1000;
const IMG_SKIP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "cache-control",
  "etag",
  "age",
  "date",
  "expires",
  "vary",
  "set-cookie"
]);
const imgCache = new Map();
const imgInflight = new Map();
let imgBytes = 0;

const imgHeaders = res => {
  const out = {};
  for (const [k, v] of res.headers) {
    if (!IMG_SKIP.has(k.toLowerCase())) out[k] = v;
  }
  if (!out["content-type"]) out["content-type"] = "application/octet-stream";
  return out;
};

const imgStore = (key, entry) => {
  const old = imgCache.get(key);
  if (old) {
    imgBytes -= old.body.length;
    imgCache.delete(key);
  }
  imgCache.set(key, entry);
  imgBytes += entry.body.length;
  for (const [k, e] of imgCache) {
    if (imgCache.size <= IMG_ENTRIES && imgBytes <= IMG_TOTAL_MAX) break;
    imgCache.delete(k);
    imgBytes -= e.body.length;
  }
};

const imgFetch = async (key, stale) => {
  const headers = stale ? { "if-none-match": stale.etag } : undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(key, { headers, signal: ctrl.signal });
    if (res.status === 304 && stale) {
      stale.at = Date.now();
      imgCache.delete(key);
      imgCache.set(key, stale);
      return stale;
    }
    if (!res.ok) return { status: res.status };
    const len = Number(res.headers.get("content-length"));
    if (len > IMG_ENTRY_MAX) {
      clearTimeout(timer);
      return {
        stream: res.body,
        headers: imgHeaders(res),
        etag: res.headers.get("etag")
      };
    }
    return await imgBuffer(key, res);
  } finally {
    clearTimeout(timer);
  }
};

const imgBuffer = async (key, res) => {
  const body = Buffer.from(await res.arrayBuffer());
  const entry = {
    body,
    headers: imgHeaders(res),
    etag: res.headers.get("etag") || `"${createHash("sha1").update(body).digest("hex")}"`,
    at: Date.now()
  };
  if (body.length <= IMG_ENTRY_MAX) imgStore(key, entry);
  return entry;
};

const imgLoad = (key, stale) => {
  let p = imgInflight.get(key);
  if (!p) {
    p = imgFetch(key, stale).finally(() => imgInflight.delete(key));
    imgInflight.set(key, p);
  }
  return p;
};

const etagMatches = (header, etag) => {
  if (!header) return false;
  const bare = t => t.trim().replace(/^W\//, "");
  const want = bare(etag);
  return header.split(",").some(t => t.trim() === "*" || bare(t) === want);
};

const cachedProxy = url => async (req, reply) => {
  const key = url(req);
  let entry = imgCache.get(key);
  try {
    if (!entry || Date.now() - entry.at > IMG_FRESH_MS) {
      try {
        entry = await imgLoad(key, entry);
      } catch (e) {
        if (!entry) throw e;
      }
    }
    if (entry.stream && entry.claimed) entry = await imgFetch(key);
    if (entry.stream) entry.claimed = true;
    if (entry.status) return reply.code(entry.status).send();
    if (entry.stream) {
      reply.headers(entry.headers).header("cache-control", IMG_CACHE_CONTROL);
      if (entry.etag) reply.header("etag", entry.etag);
      return reply.send(entry.stream);
    }
    reply.header("etag", entry.etag).header("cache-control", IMG_CACHE_CONTROL);
    if (etagMatches(req.headers["if-none-match"], entry.etag)) return reply.code(304).send();
    return reply.headers(entry.headers).send(entry.body);
  } catch {
    return reply.code(500).send();
  }
};

app.get("/assets/img/*", cachedProxy(req => `https://dogeub-assets.pages.dev/img/${req.params["*"]}`));
app.get("/assets-fb/*", cachedProxy(req => `https://dogeub-assets.pages.dev/img/server/${req.params["*"]}`));
app.get("/js/script.js", proxy(() => "https://byod.privatedns.org/js/script.js"));
app.get("/ds", (req, res) => res.redirect("https://discord.gg/ZBef7HnAeg"));
app.get("/return", async (req, reply) =>
  req.query?.q
    ? fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(req.query.q)}`)
        .then(r => r.json())
        .catch(() => reply.code(500).send({ error: "request failed" }))
    : reply.code(401).send({ error: "query parameter?" })
);

app.setNotFoundHandler((req, reply) =>
  req.raw.method === "GET" && req.headers.accept?.includes("text/html")
    ? reply.sendFile("index.html")
    : reply.code(404).send({ error: "Not Found" })
);

const host = process.env.HOST || "0.0.0.0";
app.listen({ port, host }).then(() => console.log(`Server running on ${port}`));
