import { mango } from './of.js';
import { decodeSjPath } from './sj.js';
import uvSites from '/src/data/uvlist.json';

const check = (inp, engine) => {
  const trimmed = inp.trim();
  if (!trimmed) return '';

  const isUrl =
    /^https?:\/\//i.test(trimmed) ||
    /^[\w-]+\.[\w.-]+/i.test(trimmed) ||
    trimmed.startsWith('localhost');

  if (isUrl) {
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }
  return engine + encodeURIComponent(trimmed);
};

const uvHosts = new Set(uvSites.map((h) => h.toLowerCase()));

const prefersUv = (url) => {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  let cur = host;
  while (cur) {
    if (uvHosts.has(cur)) return true;
    const dot = cur.indexOf('.');
    if (dot === -1) break;
    cur = cur.slice(dot + 1);
  }
  return false;
};

let cachedUvPrefix = null;
let cachedSjPrefix = null;

const getPrefixes = () => {
  if (!cachedUvPrefix) {
    cachedUvPrefix = isStaticBuild ? new URL('./q/r/', location.href).pathname : '/q/r/';
    cachedSjPrefix = isStaticBuild ? new URL('./k/', location.href).pathname : '/k/';
  }
  return { upwefix: cachedUvPrefix, eggowaffle: cachedSjPrefix };
};

export const process = (
  input,
  decode = false,
  prType,
  engine = 'https://www.google.com/search?q=',
) => {
  const { upwefix, eggowaffle } = getPrefixes();

  if (decode) {
    const uvIdx = input.indexOf(upwefix);
    const scrIdx = input.indexOf(eggowaffle);
    const decoded =
      uvIdx !== -1
        ? mango.dnc(input.slice(uvIdx + upwefix.length))
        : scrIdx !== -1
          ? decodeSjPath(input.slice(scrIdx + eggowaffle.length))
          : input;
    return decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  }

  const final = check(input, engine);
  if (!final || final.trim() === '') return null;

  let prefix;
  switch (prType) {
    case 'uv':
      prefix = upwefix;
      break;
    case 'scr':
      prefix = eggowaffle;
      break;
    default:
      prefix = prefersUv(final) ? upwefix : eggowaffle;
  }

  return `${location.protocol}//${location.host}${prefix}${mango.enc(final)}`;
};

export function openEmbed(url) {
  const win = window.open();
  win.document.body.style.margin = '0';
  win.document.body.style.height = '100vh';
  const iframe = win.document.createElement('iframe');
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.margin = '0';
  iframe.src = url;
  win.document.body.appendChild(iframe);
}
