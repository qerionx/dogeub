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
  } else {
    return engine + encodeURIComponent(trimmed);
  }
};

const uvHosts = new Set(uvSites);

const prefersUv = (url) => {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
  for (const d of uvHosts) {
    if (host === d || host.endsWith(`.${d}`)) return true;
  }
  return false;
};

export const process = (input, decode = false, prType, engine = "https://www.google.com/search?q=") => {
  const upwefix = isStaticBuild 
    ? new URL('./q/r/', location.href).pathname
    : '/q/r/';
  const eggowaffle = isStaticBuild
    ? new URL('./k/', location.href).pathname
    : '/k/';
  
  let prefix;

  switch (prType) {
    case 'uv':
      prefix = upwefix;
      break;
    case 'scr':
      prefix = eggowaffle;
      break;
    default:
      prefix = prefersUv(check(input, engine)) ? upwefix : eggowaffle;
  }

  if (decode) {
    const uvPart = input.split(upwefix)[1];
    const scrPart = input.split(eggowaffle)[1];
    const decoded = uvPart ? mango.dnc(uvPart) : scrPart ? decodeSjPath(scrPart) : input;
    return decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  } else {
    const final = check(input, engine);
    if (!final || final.trim() === '') {
      return null;
    }
    const encoded = prefix === eggowaffle ? mango.enc(final) : mango.enc(final);
    return `${location.protocol}//${location.host}${prefix}${encoded}`;
  }
};

export function openEmbed(url) {
  var win = window.open();
  win.document.body.style.margin = "0";
  win.document.body.style.height = "100vh";
  var iframe = win.document.createElement("iframe");
  iframe.style.border = "none";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.margin = "0";
  iframe.src = url;
  win.document.body.appendChild(iframe);
}