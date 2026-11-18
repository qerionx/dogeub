const FAST_FROM_B64 =
  '(Uint8Array.fromBase64?Uint8Array.fromBase64(self.WASM):(()=>{let b=atob(self.WASM),u=new Uint8Array(b.length);for(let k=0;k<b.length;k++)u[k]=b.charCodeAt(k);return u})())';

const FAST_TO_B64_CALL =
  '((u)=>{if(u.toBase64)return u.toBase64();let s="";for(let k=0;k<u.length;k+=32768)s+=String.fromCharCode.apply(null,u.subarray(k,k+32768));return btoa(s)})';

function replaceExact(source, label, pattern, replacement, expected = 1) {
  const matches = [...source.matchAll(pattern)].length;
  if (matches !== expected) {
    throw new Error(`scramjet-controller patch "${label}": expected ${expected}, found ${matches}`);
  }
  return source.replace(pattern, replacement);
}

export function patchControllerApi(code) {
  let out = code;
  out = replaceExact(
    out,
    'api-save-wasm-bytes',
    /async loadScramjetWasm\(\)\{if\(this\.wasmAlreadyFetched\)return;let (\w+)=await fetch\(this\.config\.wasmPath\);\((0,\w+\.\w+)\)\(await \1\.arrayBuffer\(\)\),this\.wasmAlreadyFetched=!0\}/g,
    (_m, resVar, setWasmExpr) =>
      `async loadScramjetWasm(){if(this.wasmAlreadyFetched)return;let ${resVar}=await(await fetch(this.config.wasmPath)).arrayBuffer();this.wasmRaw=${resVar},(${setWasmExpr})(${resVar}),this.wasmAlreadyFetched=!0}`,
    1,
  );
  out = replaceExact(
    out,
    'api-fast-wasm-payload',
    /if\(!this\.wasmPayload\)\{let e=await fetch\(this\.config\.wasmPath\),t=await e\.arrayBuffer\(\),r=btoa\(new Uint8Array\(t\)\.reduce\(\(e,t\)=>\(e\.push\(String\.fromCharCode\(t\)\),e\),\[\]\)\.join\(""\)\);this\.wasmPayload=`self\.WASM = '\$\{r\}';`\}/g,
    () =>
      `if(!this.wasmPayload){let t=this.wasmRaw||await(await fetch(this.config.wasmPath)).arrayBuffer(),r=${FAST_TO_B64_CALL}(new Uint8Array(t));this.wasmPayload=\`self.WASM = '\${r}';\`}`,
    1,
  );
  out = replaceExact(
    out,
    'api-fast-inline-b64',
    /btoa\(new TextEncoder\(\)\.encode\((\w+)\)\.reduce\(\(e,t\)=>\(e\.push\(String\.fromCharCode\(t\)\),e\),\[\]\)\.join\(""\)\)/g,
    (_m, srcVar) => `${FAST_TO_B64_CALL}(new TextEncoder().encode(${srcVar}))`,
    2,
  );
  out = replaceExact(
    out,
    'api-worker-wasm-decode',
    /Uint8Array\.from\(atob\(self\.WASM\),\s*\(?(\w+)\)?\s*=>\s*\1\.charCodeAt\(0\)\)/g,
    () => FAST_FROM_B64,
    1,
  );
  out = replaceExact(
    out,
    'api-debounce-cookie-persist',
    /async sendSetCookie\((\w+),(\w+)\)\{await (\w+)\.persistCookies\(\),await \3\.propagateCookieSync\(/g,
    (_m, cookiesVar, optsVar, ctrlVar) =>
      `async sendSetCookie(${cookiesVar},${optsVar}){(${ctrlVar}.__cp||(${ctrlVar}.__cp=setTimeout(()=>{${ctrlVar}.__cp=0,${ctrlVar}.persistCookies()},150))),await ${ctrlVar}.propagateCookieSync(`,
    1,
  );
  return out;
}

export function patchControllerInject(code) {
  return replaceExact(
    code,
    'inject-wasm-decode',
    /Uint8Array\.from\(atob\(self\.WASM\),\s*\(?(\w+)\)?\s*=>\s*\1\.charCodeAt\(0\)\)/g,
    () => FAST_FROM_B64,
    1,
  );
}

export function patchControllerSw(code) {
  let out = code;
  out = replaceExact(
    out,
    'sw-fast-cookie-ack',
    /new Promise\((\w+)=>\{(\w+)=setTimeout\(\(\)=>\{if\(!\w+\)\{let \w+=\w+\.filter\([\s\S]*?clientUrls=\$\{\w+\.map\(\w+=>\w+\.url\)\.join\(","\)\}`\)\}\1\(\)\},1e3\)\}\)/g,
    (_m, resVar, timerVar) => `new Promise(${resVar}=>{${timerVar}=setTimeout(${resVar},80)})`,
    1,
  );
  out = replaceExact(
    out,
    'sw-cache-client-url',
    /async function (\w+)\((\w+)\)\{try\{let (\w+)=new URL\(\2\.request\.url\),(\w+)=(\w+)\.find\((\w+)=>\3\.pathname\.startsWith\(\6\.prefix\)\),(\w+)=await clients\.get\(\2\.clientId\)/g,
    (_m, fn, ev, urlVar, ctrlVar, listVar, itemVar, clientVar) =>
      `const __cu=new Map,__gc=async(${ev})=>{let id=${ev}.clientId;if(!id)return null;if(${ev}.request.mode!=="navigate"){let c=__cu.get(id);if(c&&Date.now()-c.t<2e3)return c}let c=await clients.get(id);return c&&(__cu.size>128&&__cu.clear(),__cu.set(id,{url:c.url,t:Date.now()})),c};async function ${fn}(${ev}){try{let ${urlVar}=new URL(${ev}.request.url),${ctrlVar}=${listVar}.find(${itemVar}=>${urlVar}.pathname.startsWith(${itemVar}.prefix)),${clientVar}=await __gc(${ev})`,
    1,
  );
  return out;
}

export function patchLibcurl(code) {
  return replaceExact(
    code,
    'libcurl-null-body-status',
    /if\s*\(response_info\.status\s*===\s*204\s*\|\|\s*response_info\.status\s*===\s*205\)\s*\{\s*response_data\s*=\s*null;\s*\}/g,
    () =>
      'if (response_info.status === 101 || response_info.status === 103 || response_info.status === 204 || response_info.status === 205 || response_info.status === 304) { response_data = null; }',
    1,
  );
}
