import { mirrorRedirect } from './utils/mirrorRedirect';

// Static build on storage.googleapis.com: hop to a reachable mirror if there is one.
if (await mirrorRedirect()) {
  // navigating away, don't boot the app
  await new Promise(() => {});
}

const { initSettingsStore } = await import('./utils/settingsStore');

await initSettingsStore();

await import('./utils/utils.js');
await import('./main.jsx');
