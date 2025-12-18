import Tabs from '/src/components/loader/Tabs';
import Omnibox from '/src/components/loader/Omnibox';
import Viewer from '/src/components/loader/Viewer';
import useReg from '/src/utils/hooks/loader/useReg';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import { process } from '/src/utils/hooks/loader/utils';
import { useOptions } from '../utils/optionsContext';
import { useEffect } from 'react';

export default function Loader({ url, ui = true, zoom }) {
  useReg();
  const { options } = useOptions();
  const tabs = loaderStore((state) => state.tabs);
  const updateUrl = loaderStore((state) => state.updateUrl);
  //only 1 tab on initial load so tabs[o]
  useEffect(() => {
    if (url && tabs.length > 0) {
      const tab = tabs[0];
      const processedUrl = process(url, false, options.prType || 'auto');
      if (tab.url !== processedUrl) {
        updateUrl(tab.id, processedUrl);
      }
    }
  }, [url, tabs, updateUrl, options.prType]);
  useEffect(() => {
    loaderStore.getState().clearStore();
  }, []);

  return (
    <div className="flex flex-col w-full h-screen">
      {ui && (
        <div
          className="flex flex-col w-full border-b"
          style={{ backgroundColor: options.barColor || "#09121e" }}
        >
          <Tabs />
          <Omnibox />
        </div>
      )}
      <div className="flex-1 w-full">
        <Viewer zoom={zoom} />
      </div>
    </div>
  );
}
