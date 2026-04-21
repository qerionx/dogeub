import './utils/utils.js';
import { ensureLoaderServiceWorker } from './utils/registerLoaderSw';

if (typeof window !== 'undefined' && import.meta.env.PROD) {
  ensureLoaderServiceWorker().catch((err) => {
    console.warn('loader service worker registration failed:', err);
  });
}

import './main.jsx';
