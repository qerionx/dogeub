const LOADER_SW_SUFFIX = '/loadersw.js';
const STATIC_BUILD = typeof isStaticBuild !== 'undefined' && isStaticBuild;

const loaderSwPath = () => (STATIC_BUILD ? './loadersw.js' : '/loadersw.js');
const loaderSwScope = () => (STATIC_BUILD ? './' : '/');

const isLoaderWorkerScript = (scriptURL = '') => {
  try {
    return new URL(scriptURL, window.location.href).pathname.endsWith(LOADER_SW_SUFFIX);
  } catch {
    return scriptURL.includes(LOADER_SW_SUFFIX);
  }
};

const expectedScope = () => new URL(loaderSwScope(), window.location.href).href;

const withTimeout = (promise, timeoutMs) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });

const getExistingRegistration = async () => {
  const scope = expectedScope();
  const registration = await navigator.serviceWorker.getRegistration(scope);
  if (!registration || registration.scope !== scope) {
    return null;
  }

  return [registration.active, registration.waiting, registration.installing].some((worker) =>
    isLoaderWorkerScript(worker?.scriptURL),
  )
    ? registration
    : null;
};

const waitForActivation = (registration) => {
  const worker = registration?.installing;
  if (!worker || worker.state === 'activated') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onStateChange = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange);
        resolve();
      }
    };

    worker.addEventListener('statechange', onStateChange);
  });
};

const waitForController = (timeoutMs = 4000) => {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onControllerChange = () => {
      clearTimeout(timer);
      resolve(true);
    };

    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(false);
    }, timeoutMs);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, {
      once: true,
    });
  });
};

export const ensureLoaderServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  let registration = await getExistingRegistration();

  if (!registration) {
    registration = await navigator.serviceWorker.register(loaderSwPath(), {
      scope: loaderSwScope(),
      updateViaCache: 'none',
    });
  }

  await withTimeout(waitForActivation(registration), 10000);
  await withTimeout(navigator.serviceWorker.ready, 5000);

  if (!navigator.serviceWorker.controller) {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await waitForController();
  }

  return registration;
};
