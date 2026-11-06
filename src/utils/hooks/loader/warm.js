import store from './useLoaderStore';

export const HOVER_DELAY_MS = 300;

export const shouldWarm = ({ staticBuild, saveData, flag, alreadyWarm }) =>
  Boolean(staticBuild) && !saveData && flag !== 'false' && !alreadyWarm;

const readFlag = () => {
  try {
    return import.meta.env.VITE_PROXY_WARMUP;
  } catch {
    return undefined;
  }
};

const readSaveData = () => {
  try {
    return Boolean(navigator.connection?.saveData);
  } catch {
    return false;
  }
};

export function warmProxy() {
  const state = store.getState();
  if (!shouldWarm({
    staticBuild: typeof isStaticBuild !== 'undefined' && isStaticBuild,
    saveData: readSaveData(),
    flag: readFlag(),
    alreadyWarm: state.warm,
  })) return;
  state.requestWarm();
}

export function createHoverWarm(delay = HOVER_DELAY_MS, fire = warmProxy) {
  let timer = null;
  return {
    enter() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, delay);
    },
    leave() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
