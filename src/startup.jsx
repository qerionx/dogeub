import { mirrorRedirect, signalMirrorReady } from './utils/mirrorRedirect';
import { versionRedirect } from './utils/versionRedirect';

window.addEventListener('vite:preloadError', (event) => {
  if (/Unable to preload CSS/.test(event.payload?.message || '')) event.preventDefault();
});

if ((await mirrorRedirect()) || (await versionRedirect())) {
  await new Promise(() => {});
}

if (import.meta.env.PROD) {
  import('./utils/registerLoaderSw')
    .then(({ ensureLoaderServiceWorker }) => ensureLoaderServiceWorker())
    .catch((err) => {
      console.warn('loader service worker registration failed:', err);
    });
}

const { initSettingsStore } = await import('./utils/settingsStore');

await initSettingsStore();

await import('./utils/utils.js');
await import('./main.jsx');

signalMirrorReady();
