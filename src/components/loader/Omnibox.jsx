import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Folders,
  Menu,
  SquareArrowOutUpRight,
  Info,
  Search,
  Lock,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useEffect, useRef, useCallback } from 'react';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import { process, openEmbed } from '/src/utils/hooks/loader/utils';
import { useOptions } from '/src/utils/optionsContext';
import { warmProxy } from '/src/utils/hooks/loader/warm';

const isProxied = (url) => url?.includes('q/r/') || url?.includes('k/');
const isNewTab = (url) => !url || url === 'tabs://new' || url.endsWith('/new');

const Action = ({
  icon: IconComp,
  size = 15,
  action = () => alert('nothing here yet'),
  disabled = false,
}) => {
  const { options } = useOptions();
  return (
    <button
      className={clsx(
        'flex justify-center items-center',
        'h-6 w-7 rounded-md',
        disabled ? 'cursor-not-allowed opacity-70' : '',
        options.type != 'light' ? 'hover:bg-[#fff3]' : 'hover:bg-[#97979773]',
      )}
      onClick={(e) => {
        if (!disabled) action(e);
      }}
    >
      <IconComp size={size} />
    </button>
  );
};

const Omnibox = () => {
  const [StatusIcon, setStatusIcon] = useState(() => Info);
  const activeTab = loaderStore((state) => state.tabs.find((tab) => tab.active));
  const updateUrl = loaderStore((state) => state.updateUrl);
  const refreshTab = loaderStore((state) => state.refreshTab);
  const goBack = loaderStore((state) => state.goBack);
  const goForward = loaderStore((state) => state.goForward);
  const toggleTabs = loaderStore((state) => state.toggleTabs);
  const toggleMenu = loaderStore((state) => state.toggleMenu);
  const showUI = loaderStore((state) => state.showUI);
  const activeTabId = activeTab?.id;
  const activeTabUrl = activeTab?.url;
  const activeIframeUrl = loaderStore((state) =>
    activeTabId ? state.iframeUrls[activeTabId] : undefined,
  );

  const inputRef = useRef(null);
  const { options } = useOptions();

  const updateIcon = useCallback(
    (url) => {
      if (isNewTab(url)) {
        setStatusIcon(() => Info);
      } else if (isProxied(url)) {
        const decoded = process(url, true, options.prType || 'auto', options.engine || undefined);
        setStatusIcon(() => (decoded.startsWith('https://') ? Lock : Info));
      } else {
        setStatusIcon(() => Info);
      }
    },
    [options.prType, options.engine],
  );

  const getDisplayUrl = useCallback(
    (url) => {
      if (isNewTab(url)) return '';
      if (isProxied(url)) {
        const decoded = process(url, true, options.prType || 'auto', options.engine || undefined);
        return decoded.startsWith('https://') ? decoded.slice(8) : decoded;
      }
      return url;
    },
    [options.prType, options.engine],
  );

  const [input, setInput] = useState(() => getDisplayUrl(activeTabUrl));

  useEffect(() => {
    if (activeTabUrl === 'tabs://new') {
      setInput('');
      setStatusIcon(() => Info);
    } else if (activeIframeUrl && activeIframeUrl !== 'about:blank') {
      setInput(getDisplayUrl(activeIframeUrl));
      updateIcon(activeIframeUrl);
    } else if (activeTabUrl) {
      setInput(getDisplayUrl(activeTabUrl));
      updateIcon(activeTabUrl);
    }
  }, [activeIframeUrl, activeTabId, activeTabUrl, getDisplayUrl, updateIcon]);

  return (
    <div
      className={clsx(
        'h-10 flex items-center overflow-hidden gap-1 px-2',
        showUI ? '' : 'hidden',
      )}
    >
      <Action
        icon={ArrowLeft}
        size="17"
        action={() =>
          activeTabId &&
          goBack(activeTabId, () => {
            setInput('');
          })
        }
      />
      <Action icon={ArrowRight} size="17" action={() => activeTabId && goForward(activeTabId)} />
      <Action icon={RotateCw} size="16" action={() => activeTabId && refreshTab(activeTabId)} />
      <div
        className={clsx(
          'h-[calc(100%-8px)] w-full',
          'rounded-lg border flex items-center px-2 ml-1 mr-1',
        )}
        style={{
          backgroundColor: options.omninputColor || '#06080d8f',
          borderColor: options.type == 'light' ? '#a1a1a173' : '#efefef30',
        }}
      >
        <StatusIcon size="15" />
        <input
          className="h-full w-full outline-0 text-[0.8rem] ml-2"
          placeholder="Search with Google or enter address"
          onSelect={() => setStatusIcon(() => Search)}
          onBlur={() => updateIcon(activeIframeUrl || activeTabUrl)}
          value={input}
          ref={inputRef}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.value.trim() && warmProxy();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && activeTabId) {
              const raw = e.currentTarget.value.trim();
              if (!raw) return;
              const processedUrl = process(
                raw,
                false,
                options.prType || 'auto',
                options.engine || undefined,
              );
              if (processedUrl) {
                updateUrl(activeTabId, processedUrl);
              }
              inputRef.current.blur();
            }
          }}
        />
      </div>
      <Action
        icon={SquareArrowOutUpRight}
        size="15"
        action={() => openEmbed(activeTabUrl)}
        disabled={activeTabUrl == 'tabs://new'}
      />
      <Action icon={Folders} size="17" action={toggleTabs} />
      <Action
        icon={Menu}
        size="17"
        action={(e) => {
          e?.stopPropagation();
          toggleMenu();
        }}
      />
    </div>
  );
};

export default Omnibox;
