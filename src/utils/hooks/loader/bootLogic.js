export const RETRY_DELAYS = [0, 250, 1000, 3000];
export const READY_TIMEOUT_MS = 8000;

export const retryDelay = (count) =>
  Number.isInteger(count) && count >= 0 && count < RETRY_DELAYS.length ? RETRY_DELAYS[count] : null;

export function createRetryTracker(schedule = setTimeout, cancel = clearTimeout) {
  const entries = new Map();

  const entryFor = (id, url) => {
    let entry = entries.get(id);
    if (!entry || entry.url !== url) {
      if (entry && entry.timer) cancel(entry.timer);
      entry = { url, count: 0, timer: null, exhausted: false };
      entries.set(id, entry);
    }
    return entry;
  };

  return {
    request(id, url, fire) {
      const entry = entryFor(id, url);
      if (entry.exhausted || entry.timer) return 'skip';
      const delay = retryDelay(entry.count);
      if (delay === null) {
        entry.exhausted = true;
        return 'exhausted';
      }
      entry.count += 1;
      entry.timer = schedule(() => {
        entry.timer = null;
        fire();
      }, delay);
      return 'scheduled';
    },
    succeeded(id) {
      const entry = entries.get(id);
      if (!entry) return;
      if (entry.timer) cancel(entry.timer);
      entries.delete(id);
    },
    dispose() {
      entries.forEach((entry) => entry.timer && cancel(entry.timer));
      entries.clear();
    },
    peek(id) {
      return entries.get(id);
    },
  };
}

export function withTimeout(promise, ms, schedule = setTimeout, cancel = clearTimeout) {
  return new Promise((resolve) => {
    const timer = schedule(() => resolve('timeout'), ms);
    const done = (v) => {
      cancel(timer);
      resolve(v);
    };
    Promise.resolve(promise).then(done, () => done('error'));
  });
}

export function waitActive(reg) {
  if (!reg || reg.active) return Promise.resolve();
  const worker = reg.installing || reg.waiting;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', check);
        resolve();
      }
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

export async function connectWisp({ stored, testStored, discover, clearStored, applyTransport }) {
  if (stored) {
    const [ok] = await Promise.all([
      Promise.resolve(testStored(stored)).catch(() => false),
      applyTransport(stored),
    ]);
    if (ok) return stored;
    await clearStored();
  }
  const url = await discover();
  if (!url) return null;
  await applyTransport(url);
  return url;
}
