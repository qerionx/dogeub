const k = new TextEncoder().encode(btoa(new Date().toISOString().slice(0, 10) + location.host).split('').reverse().join('').slice(6.7));
const te = new TextEncoder(), td = new TextDecoder();
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const HV = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
    HV["0123456789abcdef".charCodeAt(i)] = i;
    HV["0123456789ABCDEF".charCodeAt(i)] = i;
}
const cfg = "/q/e.js";
const pfx = "/q/r/";
const trim = s => !s || s === "/" ? "" : s.replace(/\/$/, "");

const basePath = (() => {
    const src = typeof document !== "undefined" ? document.currentScript?.src : "";
    if (src) {
        const path = new URL(src, location.href).pathname;
        if (path.endsWith(cfg)) return trim(path.slice(0, -cfg.length));
    }

    const path = location.pathname;
    if (path.endsWith("/sw.js") || path.endsWith("/s_sw.js")) {
        return trim(path.slice(0, path.lastIndexOf("/")));
    }

    const i = path.indexOf(pfx);
    return i === -1 ? "" : trim(path.slice(0, i));
})();
self.__uv$config = {
    prefix: basePath + pfx,
    encodeUrl: s => {
        if (!s) return s;
        try {
            const d = te.encode(s);
            let r = "";
            for (let i = 0; i < d.length; i++) r += HEX[d[i] ^ k[i & 7]];
            return r;
        } catch { return s; }
    },
    decodeUrl: s => {
        if (!s) return s;
        try {
            const n = s.length;
            let h = 0;
            while (h < n) {
                const c = s.charCodeAt(h);
                if (c > 127 || HV[c] < 0) break;
                h++;
            }
            if (h < 2 || h & 1) return decodeURIComponent(s);
            const o = new Uint8Array(h >> 1);
            for (let i = 0, x = 0; x < h; i++, x += 2) o[i] = ((HV[s.charCodeAt(x)] << 4) | HV[s.charCodeAt(x + 1)]) ^ k[i & 7];
            return td.decode(o) + s.slice(h);
        } catch { return decodeURIComponent(s); }
    },
    handler: basePath + "/q/a.js",
    client: basePath + "/q/b.js", 
    bundle: basePath + "/q/c.js",
    config: basePath + "/q/e.js",
    sw: basePath + "/q/d.js"
};

self.console = new Proxy({}, {
  get: () => () => {}
});

if (self.Ultraviolet) {
    try {
        const P = Object.getPrototypeOf(new self.Ultraviolet({ vanilla: true }).js);
        if (
            typeof P.iterate === "function" &&
            String(P.iterate).includes("iterateEnd") &&
            String(P.recast).includes("inTransformer")
        ) {
            P.iterate = function (ast, handler) {
                if (typeof ast != "object" || !handler) return;
                const js = this;
                const walk = (node, parent) => {
                    if (parent && parent.inTransformer) node.isTransformer = true;
                    node.parent = parent;
                    const ev = js._events;
                    if (ev && ev[node.type] !== undefined) handler(node, parent, handler);
                    for (const key in node) {
                        if (key === "parent") continue;
                        const v = node[key];
                        if (v === null || typeof v !== "object") continue;
                        if (Array.isArray(v)) {
                            const len = v.length;
                            for (let i = 0; i < len; i++) {
                                const e = v[i];
                                if (e !== null && typeof e === "object") walk(e, node);
                            }
                        } else walk(v, node);
                    }
                    if (typeof node.iterateEnd === "function") node.iterateEnd();
                };
                walk(ast, null);
            };
        }
    } catch { void 0; }
}