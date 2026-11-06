import { useState, useEffect, useCallback } from 'react';
import LocalGmLoader from '../../localGmLoader';
import { warmOfflineVisualAssets } from '../../offlineAssets';

export const useLocalGmLoader = (app) => {
  const [gmUrl, setGmUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [loader] = useState(() => new LocalGmLoader());

  const loadGm = useCallback(async () => {
    if (!app?.url) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await loader.load(app.url, setDownloading);
      setGmUrl(result.url);
      if (navigator.onLine) {
        warmOfflineVisualAssets().catch(() => {});
      }
      setLoading(false);
    } catch (err) {
      console.error('error loading gm:', err);
      setError(err?.message || 'Failed to load this local game.');
      setLoading(false);
      setDownloading(false);
    }
  }, [app?.url, loader]);

  useEffect(() => {
    if (app?.local && app?.url) {
      loadGm();
    }
  }, [app?.local, app?.url, loadGm]);

  return { gmUrl, loading, downloading, error };
};
