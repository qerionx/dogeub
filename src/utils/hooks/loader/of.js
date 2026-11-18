const te = new TextEncoder();
const td = new TextDecoder();
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const HV = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
  HV['0123456789abcdef'.charCodeAt(i)] = i;
  HV['0123456789ABCDEF'.charCodeAt(i)] = i;
}

const k = te.encode(
  btoa(new Date().toISOString().slice(0, 10) + location.host)
    .split('')
    .reverse()
    .join('')
    .slice(6),
);

export const mango = {
  enc: (s) => {
    if (!s) return s;
    try {
      const d = te.encode(s);
      let r = '';
      for (let i = 0; i < d.length; i++) r += HEX[d[i] ^ k[i & 7]];
      return r;
    } catch {
      return s;
    }
  },
  dnc: (s) => {
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
      for (let i = 0, x = 0; x < h; i++, x += 2) {
        o[i] = ((HV[s.charCodeAt(x)] << 4) | HV[s.charCodeAt(x + 1)]) ^ k[i & 7];
      }
      return td.decode(o) + s.slice(h);
    } catch {
      return decodeURIComponent(s);
    }
  },
};

export const makeSjCodec = () => {
  const key = Array.from(k.slice(0, 8));
  const initRuntime = `const c=globalThis.__dubC||(globalThis.__dubC=(()=>{const hx=Array.from({length:256},(_,i)=>i.toString(16).padStart(2,'0')),hv=new Int8Array(128).fill(-1);for(let i=0;i<16;i++){hv['0123456789abcdef'.charCodeAt(i)]=i;hv['0123456789ABCDEF'.charCodeAt(i)]=i}return{te:new TextEncoder(),td:new TextDecoder(),hx,hv,k:[${key}]}})());`;
  const encode = new Function(
    's',
    `if(!s)return s;${initRuntime}const d=c.te.encode(s),hx=c.hx,k=c.k;let o='';for(let i=0;i<d.length;i++)o+=hx[d[i]^k[i&7]];return o;`,
  );
  const decode = new Function(
    's',
    `if(!s)return s;${initRuntime}const hv=c.hv,k=c.k,n=s.length;let h=0;while(h<n){const x=s.charCodeAt(h);if(x>127||hv[x]<0)break;h++}if(h<2||h&1){try{return decodeURIComponent(s)}catch{return s}}const o=new Uint8Array(h>>1);for(let i=0,x=0;x<h;i++,x+=2)o[i]=((hv[s.charCodeAt(x)]<<4)|hv[s.charCodeAt(x+1)])^k[i&7];return c.td.decode(o)+s.slice(h);`,
  );
  return { encode, decode };
};
