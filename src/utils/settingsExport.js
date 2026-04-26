import { getStoredOptions, setStoredOptions } from './settingsStore';

const NAME = 'dub-options.json';

const dataUrl = (o) =>
  URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }));

export const exportSettings = async (options) => {
  const resolvedOptions = options || (await getStoredOptions());
  const url = dataUrl(resolvedOptions);
  const a = document.createElement('a');
  a.href = url;
  a.download = NAME;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
};

export const importSettings = () => {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = '.json,application/json';
  i.onchange = () => {
    const f = i.files?.[0];
    if (!f) return;

    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(String(r.result));
        const s = o?.options && typeof o.options === 'object' ? o.options : o;
        if (!s || typeof s !== 'object' || Array.isArray(s)) return;
        void setStoredOptions(s).then(() => location.reload());
      } catch {}
    };
    r.readAsText(f);
  };
  i.click();
};
