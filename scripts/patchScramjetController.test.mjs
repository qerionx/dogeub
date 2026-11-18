import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  patchControllerApi,
  patchControllerInject,
  patchControllerSw,
  patchLibcurl,
} from './patchScramjetController.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'node_modules/@mercuryworkshop/scramjet-controller/dist');

const apiSrc = fs.readFileSync(path.join(dist, 'controller.api.js'), 'utf8');
const injectSrc = fs.readFileSync(path.join(dist, 'controller.inject.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(dist, 'controller.sw.js'), 'utf8');
const libv1Src = fs.readFileSync(
  path.join(root, 'node_modules/@mercuryworkshop/libcurl-transport/dist/index.mjs'),
  'utf8',
);
const libv2Src = fs.readFileSync(
  path.join(root, 'node_modules/libcurl-transport-v2/dist/index.mjs'),
  'utf8',
);

const apiOut = patchControllerApi(apiSrc);
const injectOut = patchControllerInject(injectSrc);
const swOut = patchControllerSw(swSrc);
const libv1Out = patchLibcurl(libv1Src);
const libv2Out = patchLibcurl(libv2Src);

assert.ok(libv1Out.includes('response_info.status === 304'), 'libcurl v1 handles 304');
assert.ok(libv2Out.includes('response_info.status === 304'), 'libcurl v2 handles 304');
for (const [name, out] of [
  ['v1', libv1Out],
  ['v2', libv2Out],
]) {
  assert.ok(
    out.includes('if (error === 0) stream_controller.close(); else stream_controller.error('),
    `libcurl ${name} errors a body cut off after the headers`,
  );
}
assert.ok(!swOut.includes('timed out waiting for set cookie response'), 'sw cookie deadlock capped');

assert.ok(apiOut.includes('this.wasmRaw='), 'controller.api caches wasmRaw');
assert.ok(!apiOut.includes('.reduce((e,t)=>(e.push(String.fromCharCode(t))'), 'no slow array-reduce base64 left in controller.api');
assert.ok(!apiOut.includes('Uint8Array.from(atob(self.WASM)'), 'no Uint8Array.from(atob) left in controller.api');
assert.ok(apiOut.includes('.__cp=setTimeout('), 'controller.api debounces persistCookies');

assert.ok(!injectOut.includes('Uint8Array.from(atob(self.WASM)'), 'no Uint8Array.from(atob) left in controller.inject');
assert.ok(injectOut.includes('Uint8Array.fromBase64'), 'controller.inject uses fast base64 decode');

assert.ok(swOut.includes('const __cu=new Map,__gc=async'), 'controller.sw caches client URLs');

new vm.Script(apiOut);
new vm.Script(injectOut);
new vm.Script(swOut);

{
  const listeners = {};
  const swCtx = {
    URL,
    Response,
    Headers,
    ReadableStream,
    ArrayBuffer,
    Map,
    Date,
    Math,
    Promise,
    Error,
    Symbol,
    Object,
    console: { log() {}, error() {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    self: {
      skipWaiting() {},
      clients: { matchAll: async () => [] },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      get: async (id) => ({ url: `http://localhost:5173/page/${id}` }),
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
  };
  swCtx.globalThis = swCtx;
  vm.createContext(swCtx);
  vm.runInContext(swOut, swCtx);

  const initController = (id, prefix) => {
    let portHandler = null;
    const fakePort = {
      postMessage(msg) {
        const inner = msg[`tabchannel-${id}`];
        if (inner && inner.$type === 'request' && inner.$method === 'request') {
          portHandler({
            data: {
              [`tabchannel-${id}`]: {
                $type: 'response',
                $token: inner.$token,
                $data: { body: 'ok', status: 200, statusText: 'OK', headers: [] },
              },
            },
          });
        }
      },
      set onmessage(fn) {
        portHandler = fn;
      },
      set onmessageerror(_fn) {},
    };
    for (const fn of listeners.message || []) {
      fn({ data: { $controller$init: { id, prefix } }, ports: [fakePort] });
    }
  };

  initController('ctrl1', '/k/ctrl1/');
  const fakeEvent = {
    clientId: 'client-1',
    request: new Request('http://localhost:5173/k/ctrl1/frame1/deadbeef'),
  };
  assert.equal(typeof swCtx.$scramjetController.shouldRoute, 'function');
  assert.equal(swCtx.$scramjetController.shouldRoute(fakeEvent), true);
  const res1 = await swCtx.$scramjetController.route(fakeEvent);
  assert.equal(res1.status, 200);
  assert.equal(
    typeof swCtx.$scramjetController.shouldRoute,
    'function',
    'shouldRoute must remain a function after route()',
  );
  initController('ctrl2', '/k/ctrl2/');
  assert.equal(
    swCtx.$scramjetController.shouldRoute({
      clientId: 'client-1',
      request: new Request('http://localhost:5173/k/ctrl2/frame1/deadbeef'),
    }),
    true,
    'Controller constructor must remain intact after route()',
  );
}

const ofCode = fs
  .readFileSync(path.join(root, 'src/utils/hooks/loader/of.js'), 'utf8')
  .replace(/export const /g, 'const ') + '\nglobalThis.__exports = { mango, makeSjCodec };';

const ctx = {
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Int8Array,
  Array,
  Date,
  btoa,
  decodeURIComponent,
  Function,
  location: { host: 'dogeub.example.com' },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(ofCode, ctx);

const { mango, makeSjCodec } = ctx.__exports;
const sjCodec = makeSjCodec();

const samples = [
  'https://discord.com/login?redirect=%2Fchannels%2F@me',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
  'https://en.wikipedia.org/wiki/UTF-8#Description',
  'https://github.com/qerionx/dogeub?tab=readme-ov-file',
  'https://example.com/üñîçødé/🔥?a=1&b=2#hash',
];

for (const url of samples) {
  const mEnc = mango.enc(url);
  const sEnc = sjCodec.encode(url);
  assert.equal(mEnc, sEnc, `encode parity for ${url}`);
  assert.equal(mango.dnc(mEnc), url, `mango round-trip for ${url}`);
  assert.equal(sjCodec.decode(sEnc), url, `sjCodec round-trip for ${url}`);
  assert.equal(sjCodec.decode(sEnc + '?extra=1'), url + '?extra=1', `suffix preservation for ${url}`);
}

console.log('PASS patchScramjetController & codec parity');
