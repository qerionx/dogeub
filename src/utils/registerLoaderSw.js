const LOADER_SW_SUFFIX = '/loadersw.js';

const loaderSwPath = () => (isStaticBuild ? './loadersw.js' : '/loadersw.js');
const loaderSwScope = () => (isStaticBuild ? './' : '/');

const isLoaderWorkerScript = (scriptURL = '') => {
  try {
    return new URL(scriptURL).pathname.endsWith(LOADER_SW_SUFFIX);
  } catch {
    return scriptURL.includes(LOADER_SW_SUFFIX);
  }
};

const getExistingRegistration = async () => {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return (
    registrations.find((registration) =>
      [registration.active, registration.waiting, registration.installing].some((worker) =>
        isLoaderWorkerScript(worker?.scriptURL),
      ),
    ) || null
  );
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

  await waitForActivation(registration);
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await waitForController();
  }

  return registration;
};
