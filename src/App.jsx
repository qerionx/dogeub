import Routing from './Routing';
import ReactGA from 'react-ga4';
import Search from './pages/Search';
import lazyLoad from './lazyWrapper';
import NotFound from './pages/NotFound';
import { useEffect, useMemo, memo, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import OfflineHub from './components/OfflineHub';
import Popunder from './components/Popunder';
import { OptionsProvider, useOptions } from './utils/optionsContext';
import { initPreload } from './utils/preload';
import { designConfig as bgDesign } from './utils/config';
import { warmOfflineVisualAssets } from './utils/offlineAssets';
import useReg from './utils/hooks/loader/useReg';
import usePopunderStore from './utils/hooks/popunder/usePopunderStore';
import { validateAdKey } from './utils/hooks/popunder/validateAdKey';
import './index.css';
import 'nprogress/nprogress.css';

const importHome = () => import('./pages/Home');
const importApps = () => import('./pages/Apps');
const importGms = () => import('./pages/Apps2');
const importSettings = () => import('./pages/Settings');
const importPlayer = () => import('./pages/Player');

const Home = lazyLoad(importHome);
const Apps = lazyLoad(importApps);
const Apps2 = lazyLoad(importGms);
const Settings = lazyLoad(importSettings);
const Player = lazyLoad(importPlayer);

initPreload('/materials', importApps);
initPreload('/docs', importGms);
initPreload('/settings', importSettings);
initPreload('/', importHome);

function useTracking() {
  const location = useLocation();

  useEffect(() => {
    ReactGA.send({ hitType: 'pageview', page: location.pathname });
  }, [location]);
}

const ThemedApp = memo(() => {
  const { options, updateOption } = useOptions();
  const location = useLocation();
  const popunderEnabled = POPUNDER_ENABLED === 'true';
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const adKeyPassed = usePopunderStore((state) => state.adKeyPassed);
  const setAdKeyPassed = usePopunderStore((state) => state.setAdKeyPassed);
  useReg();
  useTracking();

  const refreshConnectivity = useCallback(async () => {
    if (typeof navigator === 'undefined') {
      return;
    }

    if (!navigator.onLine) {
      setIsOffline(true);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`/?_connectivity=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      setIsOffline(!response.ok);
    } catch {
      setIsOffline(true);
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      refreshConnectivity().catch(() => {
        setIsOffline(true);
      });
    };

    const onOffline = () => {
      setIsOffline(true);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        onOnline();
      }
    };

    onOnline();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshConnectivity]);

  useEffect(() => {
    if (isOffline) {
      return;
    }

    Promise.all([
      warmOfflineVisualAssets(),
      importPlayer(),
      import('./utils/localGmLoader'),
    ]).catch(() => {});
  }, [isOffline]);

  useEffect(() => {
    let cancaled = false;

    const run = async () => {
      const jocc =
        typeof options.adKeyInput === 'string' && options.adKeyInput.trim()
          ? options.adKeyInput.trim()
          : typeof options.adKey === 'string' && options.adKey.trim()
            ? options.adKey.trim()
            : '';

      if (!jocc) {
        if (!cancaled) setAdKeyPassed(false);
        return;
      }

      const valid = await validateAdKey(jocc);
      if (cancaled) return;

      setAdKeyPassed(valid);

      if (valid && (options.adKey !== jocc || options.adKeyInput !== jocc)) {
        updateOption({ adKey: jocc, adKeyInput: jocc });
      }
    };

    run();

    return () => {
      cancaled = true;
    };
  }, [options.adKey, options.adKeyInput, setAdKeyPassed, updateOption]);

  const pages = useMemo(
    () => [
      { path: '/', element: <Home /> },
      { path: '/materials', element: <Apps /> },
      { path: '/docs', element: <Apps2 /> },
      { path: '/docs/r/*', element: <Player isOffline={isOffline} /> },
      { path: '/search', element: <Search />},
      { path: '/settings', element: <Settings /> },
      { path: '/portal/k12/*', element: <NotFound /> },
      { path: '/ham/*', element: <NotFound /> },
      { path: '*', element: <NotFound /> },
    ],
    [isOffline],
  );

  const backgroundStyle = useMemo(() => {
    const bgDesignConfig =
      options.bgDesign === 'None'
        ? 'none'
        : (
            bgDesign.find((d) => d.value.bgDesign === options.bgDesign) || bgDesign[0]
          ).value.getCSS?.(options.bgDesignColor || '102, 105, 109') || 'none';

    return `
      body {
        color: ${options.siteTextColor || '#a0b0c8'};
        background-image: ${bgDesignConfig};
        background-color: ${options.bgColor || '#111827'};
      }
    `;
  }, [options.siteTextColor, options.bgDesign, options.bgDesignColor, options.bgColor]);

  const isPlayerRoute = /^\/docs\/r(?:\/|$)/.test(location.pathname);
  const showOfflineHub = isOffline && !isPlayerRoute;

  return (
    <>
      {showOfflineHub ? <OfflineHub /> : <Routing pages={pages} />}
      {!showOfflineHub && popunderEnabled && !adKeyPassed ? <Popunder /> : null}
      <style>{backgroundStyle}</style>
    </>
  );
});

ThemedApp.displayName = 'ThemedApp';

const App = () => (
  <OptionsProvider>
    <ThemedApp />
  </OptionsProvider>
);

export default App;
