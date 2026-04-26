import { initSettingsStore } from './utils/settingsStore';

await initSettingsStore();

await import('./utils/utils.js');
await import('./main.jsx');
