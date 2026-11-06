const WASM_DECODE = () =>
  '(()=>{let s=atob(self.WASM),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u})()';

const IDB_HANDLE = (m, fn, ns) =>
  `let __sjdb;async function ${fn}(){return __sjdb||(__sjdb=(0,${ns}.P2)("$scramjet",1,{blocking(_o,_n,_e){_e.target.close();__sjdb=null},terminated(){__sjdb=null}}).catch(e=>{__sjdb=null;throw e}))}`;

const TRACKER_GET = (_m, fn, key) =>
  `const __sjrt=new Map;async function ${fn}(${key}){let __t=__sjrt.get(${key});return __t?{...__t}:null}`;

const TRACKER_PUT = (_m, fn, key, val) =>
  `async function ${fn}(${key},${val}){!__sjrt.has(${key})&&__sjrt.size>=4e3&&__sjrt.delete(__sjrt.keys().next().value);__sjrt.set(${key},{...${val}})}`;

const TRACKER_DELETE = (_m, fn, key) =>
  `async function ${fn}(${key}){__sjrt.delete(${key})}`;

const REGDOMAIN_MEMO = (_m, fn, url, client, list, load, parts) =>
  `const __sjrd=new Map;async function ${fn}(${url},${client}){let __h=${url}.hostname,__c=__sjrd.get(__h);if(__c!==void 0)return __c;__c=await __${fn}(${url},${client});__sjrd.size>4e3&&__sjrd.clear();__sjrd.set(__h,__c);return __c}async function __${fn}(${url},${client}){let ${list}=await ${load}(${client}),${parts}=${url}.hostname.toLowerCase().split(".")`;

const WASM_PAYLOAD = () =>
  String.raw`return(__sjw||(__sjw=fetch(this.config.files.wasm).then(async e=>{e.ok||(__sjw=null);let t=new Uint8Array(await e.arrayBuffer()),r="";for(let i=0;i<t.length;i+=32768)r+=String.fromCharCode.apply(null,t.subarray(i,i+32768));return"if ('document' in self && document.currentScript) { document.currentScript.remove(); }\nself.WASM = '"+btoa(r)+"';"}).catch(e=>{__sjw=null;throw e}))).then(e=>new Response(e,{headers:{"content-type":"text/javascript"}}))`;

const FETCH_FN_PREFIX = (match) => 'let __sjw;' + match;

export const patches = [
  {
    name: 'wasm-decode',
    regex: /Uint8Array\.from\(atob\(self\.WASM\),(\w+)=>\1\.charCodeAt\(0\)\)/g,
    replacer: WASM_DECODE,
    expected: 1,
  },
  {
    name: 'idb-handle',
    regex: /async function (\w+)\(\)\{return\(0,(\w+)\.P2\)\("\$scramjet",1\)\}/g,
    replacer: IDB_HANDLE,
    expected: 2,
  },
  {
    name: 'tracker-get',
    regex:
      /async function (\w+)\((\w+)\)\{let (\w+)=await (\w+)\(\);return await \3\.get\("redirectTrackers",\2\)\|\|null\}/g,
    replacer: TRACKER_GET,
    expected: 1,
  },
  {
    name: 'tracker-put',
    regex:
      /async function (\w+)\((\w+),(\w+)\)\{let (\w+)=await (\w+)\(\);await \4\.put\("redirectTrackers",\3,\2\)\}/g,
    replacer: TRACKER_PUT,
    expected: 1,
  },
  {
    name: 'tracker-delete',
    regex:
      /async function (\w+)\((\w+)\)\{let (\w+)=await (\w+)\(\);await \3\.delete\("redirectTrackers",\2\)\}/g,
    replacer: TRACKER_DELETE,
    expected: 1,
  },
  {
    name: 'regdomain-memo',
    regex:
      /async function (\w+)\((\w+),(\w+)\)\{let (\w+)=await (\w+)\(\3\),(\w+)=\2\.hostname\.toLowerCase\(\)\.split\("\."\)/g,
    replacer: REGDOMAIN_MEMO,
    expected: 1,
  },
  {
    name: 'wasm-payload',
    regex:
      /return fetch\(this\.config\.files\.wasm\)\.then\(async e=>\{[\s\S]*?"content-type":"text\/javascript"\}\}\)\}\)/g,
    replacer: WASM_PAYLOAD,
    expected: 1,
  },
  {
    name: 'fetch-fn-prefix',
    regex:
      /async function (\w+)\((\w+),(\w+)\)\{try\{let (\w+),(\w+),(\w+)=new URL\(\2\.url\);if\(\6\.pathname===this\.config\.files\.wasm\)/g,
    replacer: FETCH_FN_PREFIX,
    expected: 1,
  },
];

export function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

export function applyPatches(text, entries = patches) {
  const bad = [];
  for (const { name, regex, expected } of entries) {
    const found = countMatches(text, regex);
    if (found !== expected) bad.push(`${name}: expected ${expected} match(es), found ${found}`);
  }
  if (bad.length) {
    throw new Error(`scramjet patch mismatch (scramjet version changed?)\n  ${bad.join('\n  ')}`);
  }
  let out = text;
  for (const { regex, replacer } of entries) out = out.replace(regex, replacer);
  return out;
}

export function patchScramjet(text) {
  return applyPatches(text);
}

export default patchScramjet;
