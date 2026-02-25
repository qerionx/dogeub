import { mango } from './of.js';
import whitelist from '/src/data/whitelist.json';
import appsData from '/src/data/apps.json';

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

const scrwlist = new Set([
  ...whitelist,
  ...Object.values(appsData.games || {}).flatMap(cat => 
    cat.filter(g => g.url && !g.local).map(g => {
      try { return new URL(g.url.startsWith('http') ? g.url : `https://${g.url}`).hostname.replace(/^www\./, ''); }
      catch { return null; }
    }).filter(Boolean)
  )
]);

export const process = (input, decode = false, prType, engine = "https://www.google.com/search?q=") => {
  let prefix;

  switch (prType) {
    case 'uv':
      prefix = '/portal/k12/';
      break;
    case 'scr':
      prefix = '/ham/';
      break;
    default:
      const url = check(input, engine);
      const match = [...scrwlist].some(d => url.includes(d));
      prefix = match ? '/ham/' : '/portal/k12/';
  }

  if (decode) {
    const uvPart = input.split('/portal/k12/')[1];
    const scrPart = input.split('/ham/')[1];
    const decoded = uvPart ? mango.dnc(uvPart) : scrPart ? mango.dnc(scrPart) : input;
    return decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  } else {
    const final = check(input, engine);
    if (!final || final.trim() === '') {
      return null;
    }
    const encoded = prefix === '/ham/' ? mango.enc(final) : mango.enc(final);
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