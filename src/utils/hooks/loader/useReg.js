import { useEffect } from 'react';
import { BareMuxConnection } from 'bare-mux-fork';
import { useOptions } from '/src/utils/optionsContext';
import { fetchW as returnWServer } from './findWisp';
import { makecodec } from './of';
import store from './useLoaderStore';

export default function useReg() {
  const { options } = useOptions();
  const retryFindWInt = 30000;
  const uvScopePath = '/q/r/';
  const sjScopePath = '/k/';
  const ws = `${location.protocol == 'http:' ? 'ws:' : 'wss:'}//${location.host}/wisp/`;
  const sws = isStaticBuild ? [
    { path: new URL('./sw.js', location.href).href, scope: new URL(`.${uvScopePath}`, location.href).href },
    { path: new URL('./s_sw.js', location.href).href, scope: new URL(`.${sjScopePath}`, location.href).href }
  ] : [
    { path: new URL('/sw.js', location.origin).href, scope: new URL(uvScopePath, location.origin).href },
    { path: new URL('/s_sw.js', location.origin).href, scope: new URL(sjScopePath, location.origin).href }
  ];
  const setWispStatus = store((s) => s.setWispStatus);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!window.scr) {
        const script = document.createElement('script');
        script.src = isStaticBuild
          ? new URL('./z/b.js', location.href).pathname
          : '/z/b.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const { ScramjetController } = $scramjetLoadController();

      const hamPrefix = isStaticBuild
        ? new URL(`.${sjScopePath}`, location.href).pathname
        : sjScopePath;
      const eggsPath = isStaticBuild
        ? new URL('./z/', location.href).pathname
        : '/z/';

      window.scr = new ScramjetController({
        prefix: hamPrefix,
        files: {
          wasm: eggsPath + 'a.w',
          all: eggsPath + 'b.js',
          sync: eggsPath + 'c.js',
        },
        flags: { rewriterLogs: false, scramitize: false, cleanErrors: true, sourcemaps: true },
        codec: makecodec()
      });

      window.scr.init();

      for (const sw of sws) {
        try {
          await navigator.serviceWorker.register(
            sw.path,
            sw.scope ? { scope: sw.scope } : undefined,
          );
        } catch (err) {
          console.warn(`SW reg err (${sw.path}):`, err);
        }
      }

      const baremuxPath = isStaticBuild
        ? new URL('./y/a.js', location.href).href
        : new URL('/y/a.js', location.origin).href;
      const connection = new BareMuxConnection(baremuxPath);
      const libcurlPath = isStaticBuild
        ? new URL('./x/a.mjs', location.href).pathname
        : '/x/a.mjs';
      const applyTransport = async (wispUrl) => {
        await connection.setTransport(libcurlPath, [
          {
            wisp: isStaticBuild ? wispUrl : ws,
          },
        ]);
      };

      isStaticBuild && setWispStatus('init');
      let socket = null;
      
      //only run if no wisp is set otherwise dont
      if (isStaticBuild && (options.wServer == null || options.wServer === '')) {
        try {
          socket = await returnWServer();
        } catch (e) {
          socket = null;
        }
      }
      
      const activeWisp = options.wServer != null && options.wServer !== ''
        ? options.wServer
        : socket;
      isStaticBuild && (!activeWisp ? setWispStatus(false) : setWispStatus(true));

      if (isStaticBuild && !activeWisp) {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        while (!cancelled) {
          await sleep(retryFindWInt);
          if (cancelled) return;

          let retryWisp = null;
          try {
            retryWisp = await returnWServer();
          } catch {
            retryWisp = null;
          }

          if (!retryWisp || cancelled) continue;

          try {
            await applyTransport(retryWisp);
            if (cancelled) return;
            setWispStatus(true);
            return;
          } catch {
            setWispStatus(false);
          }
        }
        return;
      }

      await applyTransport(activeWisp);
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [options.wServer]);
}
