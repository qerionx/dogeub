import { useEffect } from 'react';
import { BareMuxConnection } from '@mercuryworkshop/bare-mux';
import { useOptions } from '/src/utils/optionsContext';

export default function useReg() {
  const { options } = useOptions();
  const ws = `${location.protocol == 'http:' ? 'ws:' : 'wss:'}//${location.host}/wisp/`;
  const sws = [{ path: '/s_sw.js', scope: '/scramjet/' }, { path: '/uv/sw.js' }];

  useEffect(() => {
    const init = async () => {
      for (const sw of sws) {
        try {
          await navigator.serviceWorker.register(sw.path, sw.scope ? { scope: sw.scope } : undefined);
        } catch (err) {
          console.warn(`SW reg err (${sw.path}):`, err);
        }
      }

      const connection = new BareMuxConnection('/baremux/worker.js');
      await connection.setTransport('/libcurl/index.mjs', [{ wisp: options.wServer ?? ws }]);
    };

    init();
  }, [options.wServer]);
}
