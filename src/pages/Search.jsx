import Tabs from '/src/components/loader/Tabs';
import Omnibox from '/src/components/loader/Omnibox';
import Viewer from '/src/components/loader/Viewer';
import Menu from '/src/components/loader/Menu';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import { process } from '/src/utils/hooks/loader/utils';
import { useOptions } from '../utils/optionsContext';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const closeMenuIfOpen = () => {
  const s = loaderStore.getState();
  if (s.showMenu) s.toggleMenu();
};

export default function Loader({ config = {} }) {
  const { url, ui = true, zoom, alerts = false } = config;
  const { options } = useOptions();
  const location = useLocation();
  const navigate = useNavigate();
  const stateUrl = location.state?.url;
  const initialShowTb = useRef(options.showTb ?? true);
  const mountedRef = useRef(false);
  const lastHandledRef = useRef(null);

  const barStyle = {
    backgroundColor: options.barColor || '#09121e',
  };

  useEffect(() => {
    const store = loaderStore.getState();
    if (!mountedRef.current) {
      mountedRef.current = true;
      store.clearStore({ showTb: initialShowTb.current });
    }
    const target = url || stateUrl;
    if (!target) {
      lastHandledRef.current = null;
      return;
    }
    if (lastHandledRef.current === target) return;
    lastHandledRef.current = target;

    const freshTabs = loaderStore.getState().tabs;
    const tab = freshTabs.find((t) => t.active) || freshTabs[0];
    if (tab) {
      const processedUrl = process(
        target,
        false,
        options.prType || 'auto',
        options.engine || undefined,
      );
      if (processedUrl && tab.url !== processedUrl) {
        loaderStore.getState().updateUrl(tab.id, processedUrl);
      }
    }
    if (stateUrl) {
      navigate('.', { replace: true, state: null });
    }
  }, [url, stateUrl, navigate, options.prType, options.engine]);

  return (
    <div className="flex flex-col w-full h-screen">
      {ui && (
        <>
          <div className="flex flex-col w-full" style={barStyle} onClick={closeMenuIfOpen}>
            <Tabs />
            <Omnibox />
          </div>
          <Menu />
        </>
      )}
      <div className="flex-1 w-full" onClick={closeMenuIfOpen}>
        <Viewer conf={{ zoom, alerts }} />
      </div>
    </div>
  );
}
