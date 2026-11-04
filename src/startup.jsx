import { mirrorRedirect, signalMirrorReady } from './utils/mirrorRedirect';

if (await mirrorRedirect()) {
  await new Promise(() => {});
}

const { initSettingsStore } = await import('./utils/settingsStore');

await initSettingsStore();

await import('./utils/utils.js');
await import('./main.jsx');

signalMirrorReady();
