import { useEffect } from 'react';
import { BareMuxConnection } from 'bare-mux-fork';
import { useOptions } from '/src/utils/optionsContext';
import { fetchW as returnWServer } from './findWisp';
import { makecodec } from './of';
import store from './useLoaderStore';

export default function useReg() {
  const { options } = useOptions();
  const ws = `${location.protocol == 'http:' ? 'ws:' : 'wss:'}//${location.host}/wisp/`;
  const sws = [
    { path: new URL('/sw.js', location.origin).href, scope: new URL('/portal/k12/', location.origin).href }, 
    { path: new URL('/s_sw.js', location.origin).href, scope: new URL('/ham/', location.origin).href }
  ];
  const setWispStatus = store((s) => s.setWispStatus);

  useEffect(() => {
    const init = async () => {
      if (!window.scr) {
        const script = document.createElement('script');
        script.src = '/eggs/scramjet.all.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const { ScramjetController } = $scramjetLoadController();

      window.scr = new ScramjetController({
        prefix: "/ham/",
        files: {
          wasm: '/eggs/scramjet.wasm.wasm',
          all: '/eggs/scramjet.all.js',
          sync: '/eggs/scramjet.sync.js',
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

      const connection = new BareMuxConnection(new URL('/baremux/worker.js', location.href).href);
      isStaticBuild && setWispStatus('init');
      let socket = null;
      try {
        socket = isStaticBuild ? await returnWServer() : null;
      } catch (e) {
        socket = null;
      }
      isStaticBuild && (!socket ? setWispStatus(false) : setWispStatus(true));

      await connection.setTransport('/libcurl/index.mjs', [
        {
          wisp:
            options.wServer != null && options.wServer !== ''
              ? options.wServer
              : isStaticBuild
                ? socket
                : ws,
        },
      ]);
    };

    init();
  }, [options.wServer]);
}
