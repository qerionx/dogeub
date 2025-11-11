import { useState, useEffect } from 'react';
import LocalGmLoader from './localGmLoader';

export const useLocalGmLoader = (app) => {
  const [gameUrl, setGameUrl] = useState(null);
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
      
      const result = await loader.loadGm(app.url);
      
      if (!result.fromCache) {
        setDownloading(true);
      }
      
      setGameUrl(result.url);
    } catch (error) {
      console.error('error loading game:', error);
    } finally {
      setLoading(false);
      setDownloading(false);
    }
  };

  return {
    gameUrl,
    loading,
    downloading
  };
};
