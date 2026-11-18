import clsx from 'clsx';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import StaticError from './viewer/StaticError';
import { useOptions } from '/src/utils/optionsContext';
import { useRef, useEffect } from 'react';
import { Loader } from 'lucide-react';
import { createRetryTracker } from '/src/utils/hooks/loader/bootLogic';
import { attachFrame, isProxyErrorPage, sjPrefix, toFrameSrc } from '/src/utils/hooks/loader/sj';
import { process } from '/src/utils/hooks/loader/utils';
import { forgetProxyTab, reportProxySite } from '/src/utils/siteStats';
import NewTab from './NewTab';

const Viewer = ({ conf = {} }) => {
  const tabs = loaderStore((state) => state.tabs);
  const updateUrl = loaderStore((state) => state.updateUrl);
  const updateTitle = loaderStore((state) => state.updateTitle);
  const setLoading = loaderStore((state) => state.setLoading);
  const reloadIframe = loaderStore((state) => state.reloadIframe);
  const setFrameRefs = loaderStore((state) => state.setFrameRefs);
  const wispStatus = loaderStore((state) => state.wispStatus);
  const runtimeReady = loaderStore((state) => state.runtimeReady);
  const iframeReloads = loaderStore((state) => state.iframeReloads);
  const setIframeUrl = loaderStore((state) => state.setIframeUrl);
  const showMenu = loaderStore((state) => state.showMenu);
  const toggleMenu = loaderStore((state) => state.toggleMenu);
  const updateActiveFrameRef = loaderStore((state) => state.updateActiveFrameRef);
  const activeFrameRef = loaderStore((state) => state.activeFrameRef);

  const frameRefs = useRef({});
  const prevURL = useRef({});
  const prevTitle = useRef({});
  const retries = useRef(null);
  if (!retries.current) retries.current = createRetryTracker();
  const { options } = useOptions();
  const enableAlerts = conf.alerts ?? true;

  useEffect(() => () => retries.current.dispose(), []);

  useEffect(() => {
    setFrameRefs(frameRefs);
    const tabIds = new Set(tabs.map((t) => t.id));
    Object.keys(frameRefs.current).forEach((id) => {
      if (!tabIds.has(id)) {
        delete frameRefs.current[id];
        delete prevURL.current[id];
        delete prevTitle.current[id];
        forgetProxyTab(id);
      }
    });
  }, [setFrameRefs, tabs]);

  useEffect(() => {
    const listeners = [];
    const retryOrGiveUp = (tab) => {
      const outcome = retries.current.request(tab.id, tab.url, () => reloadIframe(tab.id));
      if (outcome === 'scheduled') setLoading(tab.id, true);
      else if (outcome === 'exhausted') setLoading(tab.id, false);
    };

    tabs.forEach((tab) => {
      if (tab.url === 'tabs://new') return;
      const iframe = frameRefs.current[tab.id];
      if (!iframe) return;

      const handleLoad = () => {
        setLoading(tab.id, false);
        try {
          const d = iframe.contentWindow?.document;
          if (
            d?.getElementById('errorTrace-wrapper') ||
            d?.getElementById('uvHostname') ||
            isProxyErrorPage(d)
          ) {
            retryOrGiveUp(tab);
            return;
          }
          retries.current.succeeded(tab.id);
          const frameUrl = iframe.contentWindow?.location?.href || '';
          if (frameUrl && frameUrl !== 'about:blank') {
            const engine = new URL(frameUrl).pathname.startsWith(sjPrefix())
              ? 'scramjet'
              : 'ultraviolet';
            const decodedFrameUrl = process(frameUrl, true);
            reportProxySite(tab.id, decodedFrameUrl, engine);
            if (frameUrl !== prevURL.current[tab.id]) {
              prevURL.current[tab.id] = frameUrl;
              setIframeUrl(tab.id, frameUrl);
              if (!tab.isLoading && decodedFrameUrl !== process(tab.url, true)) {
                updateUrl(tab.id, frameUrl);
                setLoading(tab.id, false);
              }
            }
          }
          const curTTL = d?.title;
          if (curTTL && curTTL !== prevTitle.current[tab.id] && curTTL !== tab.title) {
            prevTitle.current[tab.id] = curTTL;
            updateTitle(tab.id, curTTL);
          }
          if (!enableAlerts && iframe.contentWindow) {
            iframe.contentWindow.alert = () => {};
          }
        } catch {
          void 0;
        }
      };

      iframe.addEventListener('load', handleLoad);
      listeners.push({ iframe, handleLoad });

      if (!enableAlerts) {
        try {
          if (iframe.contentWindow) iframe.contentWindow.alert = () => {};
        } catch {
          void 0;
        }
      }
    });

    const interval = setInterval(() => {
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (tab.url === 'tabs://new' || (!tab.active && !tab.isLoading)) continue;
        const iframe = frameRefs.current[tab.id];
        if (!iframe) continue;
        try {
          const win = iframe.contentWindow;
          const curURL = win?.location?.href;
          if (!curURL || curURL === 'about:blank') continue;
          const d = win?.document;
          if (
            d?.getElementById('errorTrace-wrapper') ||
            d?.getElementById('uvHostname') ||
            isProxyErrorPage(d)
          ) {
            retryOrGiveUp(tab);
            continue;
          }
          if (!enableAlerts && win) win.alert = () => {};
          if (!tab.isLoading && curURL !== prevURL.current[tab.id]) {
            prevURL.current[tab.id] = curURL;
            setIframeUrl(tab.id, curURL);
          }
          const curTTL = d?.title;
          if (curTTL && curTTL !== prevTitle.current[tab.id] && curTTL !== tab.title) {
            prevTitle.current[tab.id] = curTTL;
            updateTitle(tab.id, curTTL);
          }
        } catch {
          void 0;
        }
      }
    }, 200);

    return () => {
      listeners.forEach(({ iframe, handleLoad }) => {
        iframe.removeEventListener('load', handleLoad);
      });
      clearInterval(interval);
    };
  }, [
    tabs,
    iframeReloads,
    setLoading,
    updateTitle,
    updateUrl,
    setIframeUrl,
    enableAlerts,
    reloadIframe,
  ]);

  useEffect(() => {
    if (activeFrameRef?.current) {
      try {
        activeFrameRef.current.contentWindow.document.body.style.zoom = conf.zoom;
      } catch {
        void 0;
      }
    }
  }, [activeFrameRef, conf.zoom]);

  useEffect(() => {
    const activeTab = tabs.find((tab) => tab.active);
    if (!activeTab) return;
    const el = frameRefs.current[activeTab.id] || null;
    if (loaderStore.getState().activeFrameRef?.current !== el) {
      updateActiveFrameRef({ current: el });
    }
  }, [tabs, iframeReloads, updateActiveFrameRef]);

  const activeNewTab = tabs.find((tab) => tab.url === 'tabs://new' && tab.active);
  const canMountFrame = !isStaticBuild ? runtimeReady : wispStatus === true;

  return (
    <div className="relative w-full h-full">
      {tabs.map(({ id, url, active }) => {
        if (url === 'tabs://new') return null;
        return (
          <div
            key={id}
            className={clsx(
              'absolute inset-0 w-full h-full',
              active ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none',
            )}
          >
            {active && (
              <div
                className="absolute inset-0 w-full h-full flex items-center justify-center -z-20"
                style={{ backgroundColor: options.tabBarColor || '#070e15' }}
              >
                {!isStaticBuild ? (
                  <Loader size={32} className="animate-spin" />
                ) : wispStatus ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader size={32} className="animate-spin" />
                    {wispStatus === 'init' && (
                      <p className="mt-2">Finding a Wisp server to route your request...</p>
                    )}
                  </div>
                ) : (
                  wispStatus === false && <StaticError />
                )}
              </div>
            )}
            {canMountFrame && (
              <iframe
                ref={(el) => {
                  frameRefs.current[id] = el;
                  attachFrame(el);
                }}
                key={`${id}:${iframeReloads[id] || 0}`}
                src={toFrameSrc(url)}
                style={{ display: 'block', width: '100%', height: '100%' }}
                className="absolute inset-0 w-full h-full transition-opacity duration-200"
              />
            )}
            {showMenu && (
              <div className="absolute inset-0 w-full h-full z-50" onClick={() => toggleMenu()} />
            )}
          </div>
        );
      })}
      {activeNewTab && (
        <div
          key={activeNewTab.id}
          className="absolute inset-0 w-full h-full opacity-100 z-10 pointer-events-auto"
        >
          <NewTab id={activeNewTab.id} updateFn={updateUrl} options={options} />
        </div>
      )}
    </div>
  );
};

export default Viewer;
