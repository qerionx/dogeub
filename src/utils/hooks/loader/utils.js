const k = new TextEncoder().encode(
  btoa(new Date().toISOString().slice(0, 10) + location.host)
    .split('')
    .reverse()
    .join('')
    .slice(6.7),
);
export const encoding = {
  enc: (s) => {
    if (!s) return s;
    try {
      const d = new TextEncoder().encode(s),
        o = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) o[i] = d[i] ^ k[i % 8];
      return Array.from(o, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return s;
    }
  },
  dnc: (s) => {
    if (!s) return s;
    try {
      const n =
        Math.min(
          s.indexOf('?') + 1 || s.length + 1,
          s.indexOf('#') + 1 || s.length + 1,
          s.indexOf('&') + 1 || s.length + 1,
        ) - 1;
      let h = 0;
      for (let i = 0; i < n && i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102))) break;
        h = i + 1;
      }
      if (h < 2 || h % 2) return decodeURIComponent(s);
      const l = h >> 1,
        o = new Uint8Array(l);
      for (let i = 0; i < l; i++) {
        const x = i << 1;
        o[i] = parseInt(s[x] + s[x + 1], 16) ^ k[i % 8];
      }
      return new TextDecoder().decode(o) + s.slice(h);
    } catch {
      return decodeURIComponent(s);
    }
  },
};

const check = (inp) => {
  const trimmed = inp.trim();
  if (!trimmed) return '';

  const isUrl =
    /^https?:\/\//i.test(trimmed) ||
    /^[\w-]+\.[\w.-]+/i.test(trimmed) ||
    trimmed.startsWith('localhost');

  if (isUrl) {
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  } else {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
};

import whitelist from '/src/data/whitelist.json';
import appsData from '/src/data/apps.json';

const scrwlist = new Set([
  ...whitelist,
  ...Object.values(appsData.games || {}).flatMap(cat => 
    cat.filter(g => g.url && !g.local).map(g => {
      try { return new URL(g.url.startsWith('http') ? g.url : `https://${g.url}`).hostname.replace(/^www\./, ''); }
      catch { return null; }
    }).filter(Boolean)
  )
]);

export const process = (input, decode = false, prType) => {
  let prefix;

  switch (prType) {
    case 'uv':
      prefix = '/uv/service/';
      break;
    case 'scr':
      prefix = '/scramjet/';
      break;
    default:
      const url = check(input);
      const match = [...scrwlist].some(d => url.includes(d));
      prefix = match ? '/scramjet/' : '/uv/service/';
  }

  if (decode) {
    const uvPart = input.split('/uv/service/')[1];
    const scrPart = input.split('/scramjet/')[1];
    const decoded = uvPart ? encoding.dnc(uvPart) : scrPart ? decodeURIComponent(scrPart) : input;
    return decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  } else {
    const final = check(input);
    const encoded = prefix === '/scramjet/' ? encodeURIComponent(final) : encoding.enc(final);
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