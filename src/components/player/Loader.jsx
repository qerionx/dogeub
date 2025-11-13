import { useRef, useState, useCallback, useMemo } from 'react';
import Control from './Controls';
import { Maximize2, SquareArrowOutUpRight, ZoomIn, ZoomOut, Cloud, HardDrive } from 'lucide-react';
import InfoCard from './InfoCard';
import theming from '/src/styles/theming.module.css';
import clsx from 'clsx';
import { useLocalGmLoader } from '/src/utils/useLocalGmLoader';
import Tooltip from '@mui/material/Tooltip';

const Loader = ({ theme, app }) => {
  const gmRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const { gmUrl, loading, downloading } = useLocalGmLoader(app);
  const isLocal = app?.local;

  const fs = useCallback(() => gmRef.current?.requestFullscreen?.(), []);

  const external = useCallback(() => {
    sessionStorage.setItem('query', app?.url);
    window.open('/indev', '_blank');
  }, [app?.url]);

  const handleZoom = useCallback((direction) => {
    if (!gmRef.current) return;
    setZoom(prev => {
      const newZoom = direction === 'in' ? Math.min(prev + 0.1, 2) : Math.max(prev - 0.1, 0.5);
      gmRef.current.style.zoom = newZoom;
      return newZoom;
    });
  }, []);

  const iframeSrc = useMemo(() => 
    isLocal ? gmUrl : '/src/static/loader.html?ui=false',
    [isLocal, gmUrl]
  );

  return (
    <div
      className={clsx(
        'flex flex-col h-[calc(100vh-38px)] w-full rounded-xl',
        theming.appItemColor,
        theming[`theme-${theme || 'default'}`],
      )}
    >
      <div className="p-2 pl-1 border-b flex gap-2 items-center">
        <InfoCard app={app} theme={theme} />
        <Tooltip title={isLocal ? "Fetched locally" : "Fetched from web"} arrow placement="top">
          <div className="flex items-center ml-auto mr-5">
            {isLocal ? <HardDrive size={18} className="opacity-80" /> : <Cloud size={18} className="opacity-80" />}
          </div>
        </Tooltip>
      </div>

      {loading ? (
        <div className="w-full flex-grow flex items-center justify-center">
          {downloading ? 'Downloading...' : 'Loading...'}
        </div>
      ) : (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          ref={gmRef}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full flex-grow"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
        />
      )}

      <div className="p-2.5 flex gap-2 border-t">
        {isLocal ? (
          <Tooltip title="Local games can't open in browser" arrow placement="top">
            <div className="cursor-not-allowed">
              <Control icon={SquareArrowOutUpRight} fn={null} className="cursor-not-allowed opacity-50 pointer-events-none" />
            </div>
          </Tooltip>
        ) : (
          <Control icon={SquareArrowOutUpRight} fn={external} />
        )}
        <Control icon={ZoomIn} fn={() => handleZoom('in')} className="ml-auto" />
        <Control icon={ZoomOut} fn={() => handleZoom('out')} />
        <Control icon={Maximize2} fn={fs} />
      </div>
    </div>
  );
};

export default Loader;