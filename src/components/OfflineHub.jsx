import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Play } from 'lucide-react';
import { getDownloadedGameIds, getDownloadedPlayableGames } from '/src/utils/offlineAssets';

const OfflineHub = () => {
  const nav = useNavigate();
  const [gamesByCategory, setGamesByCategory] = useState({});
  const [downloadedIds, setDownloadedIds] = useState([]);
  const [fallback, setFallback] = useState({});

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      const [appsModule, ids] = await Promise.all([import('/src/data/apps.json'), getDownloadedGameIds()]);

      if (!mounted) {
        return;
      }

      setGamesByCategory(appsModule.default?.games || {});
      setDownloadedIds(ids || []);
    };

    loadData().catch(() => {
      if (!mounted) {
        return;
      }

      setGamesByCategory({});
      setDownloadedIds([]);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const downloadedGames = useMemo(
    () => getDownloadedPlayableGames(gamesByCategory, downloadedIds),
    [gamesByCategory, downloadedIds],
  );

  const onPlay = useCallback(
    (app) => {
      nav('/docs/r', { state: { app } });
    },
    [nav],
  );

  const onImgError = useCallback((name) => {
    setFallback((prev) => ({ ...prev, [name]: true }));
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center px-6 pt-16 pb-12">
      <img src="/logo.svg" alt="logo" className="w-72 max-w-[84vw] select-none" draggable="false" />
      <p className="mt-4 text-center text-sm font-semibold">
        You&apos;re offline, but you can still play your downloaded games:
      </p>

      {downloadedGames.length === 0 ? (
        <p className="mt-7 text-center text-sm opacity-70">
          No downloaded local games found yet. Connect once and open a local game to save it.
        </p>
      ) : (
        <div className="mt-8 w-full max-w-6xl flex flex-wrap justify-center gap-4">
          {downloadedGames.map((app) => (
            <button
              key={app.appName}
              className="w-full max-w-sm rounded-xl border border-white/12 bg-white/6 hover:bg-white/10 transition-colors px-4 py-3 text-left"
              onClick={() => onPlay(app)}
            >
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-black/20 flex items-center justify-center">
                  {fallback[app.appName] ? (
                    <LayoutGrid className="w-8 h-8 opacity-70" />
                  ) : (
                    <img
                      src={app.icon}
                      alt={app.appName}
                      className="w-full h-full object-cover"
                      loading="eager"
                      onError={() => onImgError(app.appName)}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{app.appName}</p>
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-white/12 px-2.5 py-1 text-xs font-medium">
                    <Play size={14} fill="currentColor" />
                    Play
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default OfflineHub;
