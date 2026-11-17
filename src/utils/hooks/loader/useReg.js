import { useEffect } from 'react';
import { BareMuxConnection } from 'bare-mux-fork';
import { useOptions } from '/src/utils/optionsContext';
import { peekStored, testURL, clearStored, discover } from './findWisp';
import { READY_TIMEOUT_MS, connectWisp, waitActive, withTimeout } from './bootLogic';
import { bootScramjet, setScramjetWisp } from './sj';
import store from './useLoaderStore';

const registerSw = async (sw) => {
  try {
    return await navigator.serviceWorker.register(sw.path, sw.scope ? { scope: sw.scope } : undefined);
  } catch (err) {
    console.warn(`SW reg err (${sw.path}):`, err);
    return null;
  }
};

export default function useReg(active = true) {
  const { options } = useOptions();
  const uvScopePath = '/q/r/';
  const sjScopePath = '/k/';
  const ws = `${location.protocol == 'http:' ? 'ws:' : 'wss:'}//${location.host}/connection/`;
  const sws = isStaticBuild ? [
    { path: new URL('./sw.js', location.href).href, scope: new URL(`.${uvScopePath}`, location.href).href },
    { path: new URL('./s_sw.js', location.href).href, scope: new URL(`.${sjScopePath}`, location.href).href }
  ] : [
    { path: new URL('/sw.js', location.origin).href, scope: new URL(uvScopePath, location.origin).href },
    { path: new URL('/s_sw.js', location.origin).href, scope: new URL(sjScopePath, location.origin).href }
  ];
  const setWispStatus = store((s) => s.setWispStatus);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const { setRuntimeReady } = store.getState();

    const init = async () => {
      const manual = options.wServer != null && options.wServer !== '' ? options.wServer : null;
      const baremuxPath = isStaticBuild
        ? new URL('./y/a.js', location.href).href
        : new URL('/y/a.js', location.origin).href;
      const libcurlPath = isStaticBuild
        ? new URL('./x/a.mjs', location.href).pathname
        : '/x/a.mjs';

      let activeWisp = null;

      isStaticBuild && store.getState().wispStatus !== true && setWispStatus('init');
      setRuntimeReady(false);
      performance.mark?.('proxy:init-start');

      try {
        const connection = new BareMuxConnection(baremuxPath);

        const applyTransport = (wispUrl) =>
          withTimeout(
            (async () => {
              if (cancelled) return;
              const target = isStaticBuild ? wispUrl : ws;
              await Promise.all([
                connection.setTransport(libcurlPath, [{ wisp: target }]),
                setScramjetWisp(target),
              ]);
            })().catch((err) => console.warn('setTransport err:', err)),
            READY_TIMEOUT_MS,
          );

        const uvBranch = registerSw(sws[0]);

        const sjBranch = registerSw(sws[1]).then(async (reg) => {
          await waitActive(reg);
          await bootScramjet(reg).catch((err) => console.warn('Scramjet init err:', err));
          return reg;
        });

        const transportBranch = (async () => {
          try {
            if (!isStaticBuild) {
              await applyTransport();
            } else if (manual) {
              activeWisp = manual;
              await applyTransport(manual);
            } else {
              activeWisp = await connectWisp({
                stored: await peekStored(),
                testStored: testURL,
                discover,
                clearStored,
                applyTransport,
              });
            }
          } catch (e) {
            console.warn(e);
          }
        })();

        const swBranch = withTimeout(
          Promise.all([uvBranch, sjBranch]).then((regs) => Promise.all(regs.map(waitActive))),
          READY_TIMEOUT_MS,
        );

        await Promise.all([transportBranch, swBranch]);
      } catch (e) {
        console.warn(e);
      } finally {
        if (!cancelled) {
          isStaticBuild && setWispStatus(activeWisp ? true : false);
          setRuntimeReady(true);
          performance.mark?.('proxy:runtime-ready');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      setRuntimeReady(false);
    };
  }, [active, options.wServer]);
}
