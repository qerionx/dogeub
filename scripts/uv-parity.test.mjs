import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = s => process.stdout.write(s + "\n");
const configSrc = fs.readFileSync(path.join(root, "public/portal/uv.config.js"), "utf8");
const bundleSrc = fs.readFileSync(path.join(root, "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.bundle.js"), "utf8");

let failures = 0;
const fail = m => {
    failures++;
    if (failures <= 25) out("FAIL " + m);
};
const check = (name, cond) => {
    out((cond ? "ok   " : "FAIL ") + name);
    if (!cond) failures++;
};

const HOST = "dogeub.example.com";

const browserGlobals = () => ({
    navigator: { serviceWorker: {} },
    localStorage: {},
    WebSocket: globalThis.WebSocket ?? { prototype: { send() {} } },
    fetch: globalThis.fetch,
    Request: globalThis.Request,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    setTimeout,
});

const makeContext = (withBundle, extra = {}) => {
    const ctx = {
        TextEncoder, TextDecoder, URL, btoa, atob, Date, Uint8Array, Int8Array, Proxy, Array, Object, Math, String, decodeURIComponent,
        location: new URL("https://" + HOST + "/q/r/x"),
        ...browserGlobals(),
        ...extra,
    };
    ctx.self = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    if (withBundle) vm.runInContext(bundleSrc, ctx);
    vm.runInContext(configSrc, ctx);
    return ctx;
};

const k = new TextEncoder().encode(btoa(new Date().toISOString().slice(0, 10) + HOST).split("").reverse().join("").slice(6.7));

const oldEncodeUrl = s => {
    if (!s) return s;
    try {
        const d = new TextEncoder().encode(s), o = new Uint8Array(d.length);
        for (let i = 0; i < d.length; i++) o[i] = d[i] ^ k[i % 8];
        return Array.from(o, b => b.toString(16).padStart(2, "0")).join("");
    } catch { return s; }
};
const oldDecodeUrl = s => {
    if (!s) return s;
    try {
        const n = Math.min(s.indexOf("?") + 1 || s.length + 1, s.indexOf("#") + 1 || s.length + 1, s.indexOf("&") + 1 || s.length + 1) - 1;
        let h = 0;
        for (let i = 0; i < n && i < s.length; i++) {
            const c = s.charCodeAt(i);
            if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102))) break;
            h = i + 1;
        }
        if (h < 2 || h % 2) return decodeURIComponent(s);
        const l = h >> 1, o = new Uint8Array(l);
        for (let i = 0; i < l; i++) {
            const x = i << 1;
            o[i] = parseInt(s[x] + s[x + 1], 16) ^ k[i % 8];
        }
        return new TextDecoder().decode(o) + s.slice(h);
    } catch { return decodeURIComponent(s); }
};

const run = (f, a) => {
    try { return { v: f(a) }; } catch (e) { return { e: e && e.name }; }
};
const same = (a, b) => ("e" in a || "e" in b) ? a.e === b.e : Object.is(a.v, b.v);

let seed = 123456789;
const rnd = n => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
};
const pick = a => a[rnd(a.length)];
const hexChars = "0123456789abcdefABCDEF";
const alphabet = "abcxyz019-._~/:?&#=%+ éü中文\u{1f600}𐏿@!$'()*;,[]{}|\\^`\"<>";
const randStr = (len, chars) => {
    const arr = Array.from(chars);
    let s = "";
    for (let i = 0; i < len; i++) s += arr[rnd(arr.length)];
    return s;
};

const ctx = makeContext(false);
const cfg = ctx.__uv$config;
check("config defines encodeUrl and decodeUrl", typeof cfg.encodeUrl === "function" && typeof cfg.decodeUrl === "function");
check("config loads without Ultraviolet", ctx.Ultraviolet === undefined);
check("console replaced by silent proxy", typeof ctx.console.log === "function" && ctx.console.log("x") === undefined);

const encodeInputs = [undefined, null, "", "a", "?", "&", "#", "%3F", "\ud800", "é", "\u{1f600}", "https://example.com/", "https://example.com/?", "https://example.com/#", 0, false, 5, [], {}];
for (let i = 0; i < 20000; i++) {
    const mode = i % 5;
    if (mode === 0) encodeInputs.push("https://cdn" + i + ".example.com/p/ü/" + i + "/a.js?x=" + i + "&y=é#h" + i);
    else if (mode === 1) encodeInputs.push(randStr(rnd(60), alphabet));
    else if (mode === 2) encodeInputs.push(randStr(rnd(40), hexChars));
    else if (mode === 3) encodeInputs.push(randStr(rnd(200) + 1, "abcdefghijklmnopqrstuvwxyz0123456789/.-_?&=#%"));
    else encodeInputs.push("https://example.com/" + randStr(rnd(500), alphabet));
}

let encBad = 0;
for (const s of encodeInputs) {
    if (!same(run(oldEncodeUrl, s), run(cfg.encodeUrl, s))) {
        encBad++;
        fail("encodeUrl differs for " + JSON.stringify(s));
    }
}
check("encodeUrl byte-identical over " + encodeInputs.length + " inputs", encBad === 0);

const suffixes = ["", "?", "?a=1", "&", "&b=2", "#", "#h", "%3F", "%3f", "?%3F", "/", "%", "%E0%A4%A", "z", " "];
const decodeInputs = [undefined, null, "", "a", "ab", "abc", "zz", "zzab", "ab zz", "ABCDEF", "abcdef", "abcdeF", "0", "00", "000", "%41%42", "%", "%E0%A4%A", "?", "&", "#", "5", 5, [], ["ab"], {}, "g1", "1g", "éé", "abéab"];
for (let i = 0; i < 20000; i++) {
    const base = encodeInputs[i + 19];
    const e = oldEncodeUrl(typeof base === "string" ? base : "https://example.com/" + i);
    const m = i % 10;
    let s;
    if (m === 0) s = e + pick(suffixes);
    else if (m === 1) s = e.toUpperCase() + pick(suffixes);
    else if (m === 2) s = e.slice(0, rnd(e.length + 1)) + pick(suffixes);
    else if (m === 3) s = e.slice(0, e.length - 1);
    else if (m === 4) s = randStr(rnd(6), "zxq-") + e;
    else if (m === 5) s = e.slice(0, rnd(e.length + 1)) + pick(["?", "&", "#"]) + e.slice(0, rnd(e.length + 1));
    else if (m === 6) s = randStr(rnd(80), hexChars + "?&#%");
    else if (m === 7) s = randStr(rnd(80), alphabet);
    else if (m === 8) s = e.slice(0, 2 * rnd(Math.max(1, e.length >> 1))) + "%3F" + randStr(rnd(10), hexChars);
    else s = e.slice(0, 2 * rnd(Math.max(1, e.length >> 1))) + "&" + e.slice(0, 8);
    decodeInputs.push(s);
}

let decBad = 0;
for (const s of decodeInputs) {
    if (!same(run(oldDecodeUrl, s), run(cfg.decodeUrl, s))) {
        decBad++;
        fail("decodeUrl differs for " + JSON.stringify(s));
    }
}
check("decodeUrl identical over " + decodeInputs.length + " inputs", decBad === 0);

let rtBad = 0;
for (const s of encodeInputs) {
    if (typeof s !== "string" || !s) continue;
    const r = run(cfg.decodeUrl, cfg.encodeUrl(s));
    if (r.e || r.v !== new TextDecoder().decode(new TextEncoder().encode(s))) rtBad++;
}
check("decodeUrl(encodeUrl(x)) round-trips", rtBad === 0);

const patched = makeContext(true);
check("patched context has Ultraviolet", typeof patched.Ultraviolet === "function");
check("patched context keeps codec identical", encodeInputs.slice(0, 2000).every(s => same(run(oldEncodeUrl, s), run(patched.__uv$config.encodeUrl, s))));

const stock = (() => {
    const c = { TextEncoder, TextDecoder, URL, btoa, atob, location: new URL("https://" + HOST + "/q/r/x"), ...browserGlobals() };
    c.self = c;
    c.globalThis = c;
    vm.createContext(c);
    vm.runInContext(bundleSrc, c);
    c.__uv$config = {
        prefix: "/q/r/",
        encodeUrl: oldEncodeUrl,
        decodeUrl: oldDecodeUrl,
    };
    return c;
})();

check("stock context is unpatched", String(Object.getPrototypeOf(new stock.Ultraviolet({ vanilla: true }).js).iterate).includes("forEach"));
check("patched context iterate overridden", !String(Object.getPrototypeOf(new patched.Ultraviolet({ vanilla: true }).js).iterate).includes("forEach"));

const mkUv = (c, cf) => {
    const u = new c.Ultraviolet(cf);
    u.meta.base = u.meta.url = new URL("https://example.com/dir/a.js");
    u.meta.origin = "https://" + HOST;
    return u;
};
const uvStock = mkUv(stock, stock.__uv$config);
const uvPatched = mkUv(patched, patched.__uv$config);

const files = [
    "node_modules/react/cjs/react.development.js",
    "node_modules/react-dom/cjs/react-dom.development.js",
    "node_modules/react-dom/cjs/react-dom-client.development.js",
    "node_modules/ajv/dist/ajv.bundle.js",
    "node_modules/acorn/dist/acorn.js",
    "node_modules/lodash.merge/index.js",
    "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.client.js",
    "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.handler.js",
    "node_modules/@titaniumnetwork-dev/ultraviolet/dist/uv.sw.js",
    "node_modules/zustand/esm/middleware.mjs",
].map(f => path.join(root, f)).filter(f => fs.existsSync(f));

const samples = files.map(f => [path.relative(root, f), fs.readFileSync(f, "utf8")]);
samples.push(
    ...[
        "var a = eval('1+1'); var b = location.href;",
        "with (window) { var b = location.href; }",
        "const t = `x ${document.domain} y ${top.location}`;",
        "import('./m.js').then(m => m.default); import x from './y.js'; export { x }; export * from './z.js'; location.href;",
        "function f(){ return window.location.href + parent.location + self.top + this.eval('z'); }",
        "var o = { location: 1, eval: 2, postMessage(){}, get top(){ return 1; } }; o.location.href = 'http://a/'; o[location] = top;",
        "new Function('return location')(); globalThis.eval('x'); (0, eval)('y'); location = 'http://b'; location.assign('c'); eval(location);",
        "try { throw 1 } catch ({ location }) { location.x } for (const location of []) {} label: for(;;){ break label }",
        "class A extends B { q = this.location; static s = top; m(){ return super.x + top } }",
        "async function* g(){ for await (const x of y) yield x + location }",
        "class C { get z(){ return this.q + location } set z(v){ top = v } static m(){ return parent } }",
        "a?.b?.[location]?.(top); x ??= window; y ||= document; z &&= parent; var re = /location/gi; var n = 10n ** 2n;",
        "function g(location, top = parent, ...rest) { return [location, top, rest, `${location}`, tag`${top}`]; } g.parent.postMessage(1, '*');",
        "window.__uv$location; __uv.$wrap(location); __uv.$get(top); __uv.rewriteUrl('x'); __uv.js.rewrite('y'); a.__uv$setSource(__uv).__uv$eval(1);",
    ].map((src, i) => ["synthetic:" + i, src]),
    ["synthetic:unicode-regex", "var s = '\\u00e9\\u{1f600}'; var r = /[\\u{1f600}-\\u{1f64f}]/u; r.test(s); var l = location.href; var t = `中${top}`;"],
    ["synthetic:syntax-error", "function ( { location"],
    ["synthetic:empty", ""],
    ["synthetic:deep-nesting", "var x = " + "(".repeat(200) + "location" + ")".repeat(200) + ";"],
    ["synthetic:long-chain", "var x = " + Array.from({ length: 800 }, (_, i) => "a" + i).join(" + ") + " + location;"],
);

let walkBad = 0;
let totalLen = 0;
for (const [name, src] of samples) {
    for (const mode of ["rewrite", "source"]) {
        const a = uvStock.js[mode](src);
        const b = uvPatched.js[mode](src);
        totalLen += src.length;
        const ok = a === b;
        if (!ok) { walkBad++; fail("js." + mode + " output differs for " + name); }
        if (mode === "rewrite") out("     " + name + " " + src.length + " bytes -> " + (ok ? "identical" : "DIFFERENT") + (a !== src ? " (rewritten)" : " (unchanged)"));
    }
}
check("js rewriter output identical on " + samples.length + " sources (" + totalLen + " bytes)", walkBad === 0);

const changed = samples.filter(([, src]) => uvPatched.js.rewrite(src) !== src).length;
check("rewriter actually rewrites most samples (" + changed + "/" + samples.length + ")", changed >= Math.floor(samples.length / 2));

const t0 = performance.now();
for (let r = 0; r < 3; r++) for (const [, src] of samples) uvStock.js.rewrite(src);
const t1 = performance.now();
for (let r = 0; r < 3; r++) for (const [, src] of samples) uvPatched.js.rewrite(src);
const t2 = performance.now();
out("     rewrite time stock " + (t1 - t0).toFixed(0) + "ms patched " + (t2 - t1).toFixed(0) + "ms");

const noUvCtx = (() => {
    try { return makeContext(false), true; } catch (e) { return false; }
})();
check("config does not throw when Ultraviolet is undefined", noUvCtx);

const brokenCtx = (() => {
    try {
        const c = makeContext(false, { Ultraviolet: function () { throw new Error("boom"); } });
        return typeof c.__uv$config.encodeUrl === "function";
    } catch (e) { return false; }
})();
check("config does not throw when Ultraviolet constructor throws", brokenCtx);

const foreignCtx = (() => {
    try {
        class FakeJS { iterate() {} recast() {} }
        const c = makeContext(false, { Ultraviolet: function () { this.js = new FakeJS(); } });
        return typeof c.__uv$config.encodeUrl === "function" && Object.getPrototypeOf(new c.Ultraviolet().js).iterate === FakeJS.prototype.iterate;
    } catch (e) { return false; }
})();
check("config leaves an unrecognised rewriter untouched", foreignCtx);

const pageCtx = (() => {
    try {
        const c = makeContext(true, { document: { currentScript: { src: "https://" + HOST + "/q/e.js" } } });
        return c.__uv$config.prefix === "/q/r/" && c.__uv$config.handler === "/q/a.js";
    } catch (e) { return false; }
})();
check("config works in a page context (document.currentScript)", pageCtx);

const swCtx = (() => {
    try {
        const c = makeContext(true, { location: new URL("https://" + HOST + "/sw.js") });
        return c.__uv$config.prefix === "/q/r/" && c.__uv$config.sw === "/q/d.js";
    } catch (e) { return false; }
})();
check("config works in a service worker context (no document)", swCtx);

out(failures === 0 ? "PASS" : "FAILED " + failures);
process.exit(failures === 0 ? 0 : 1);
