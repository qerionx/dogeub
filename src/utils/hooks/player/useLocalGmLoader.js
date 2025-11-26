import { useState, useEffect } from 'react';
import LocalGmLoader from '../../localGmLoader';

export const useLocalGmLoader = (app) => {
  const [gmUrl, setGmUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loader] = useState(() => new LocalGmLoader());

  useEffect(() => {
    if (app?.local && app?.url) {
      loadGm();
    }
  }, [app]);

  const loadGm = async () => {
    try {
      setLoading(true);
      const result = await loader.load(app.url, setDownloading);
      setGmUrl(result.url);
      setLoading(false);
    } catch (err) {
      console.error('error loading gm:', err);
      setLoading(false);
      setDownloading(false);
    }
  };

  return { gmUrl, loading, downloading };
};
