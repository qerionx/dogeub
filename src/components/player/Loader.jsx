import { useRef, useState, useEffect } from 'react';
import Control from './Controls';
import { Maximize2, SquareArrowOutUpRight, ZoomIn, ZoomOut } from 'lucide-react';
import InfoCard from './InfoCard';
import theming from '/src/styles/theming.module.css';
import clsx from 'clsx';
import JSZip from 'jszip';

const DB_NAME = 'gm loader db';
const Db_VER = 1;
const STORE_NAME = 'gms';

const Loader = ({ theme, app }) => {
  const gmRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [gameUrl, setgmUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (app?.local && app?.url) {
      loadGm();
    }
  }, [app]);

  const initDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, Db_VER);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  };

  const save = async (db, gmName, files) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const gameData = {
        id: gmName,
        name: gmName,
        files: files,
        uploadDate: new Date().toISOString(),
        lastPlayed: new Date().toISOString()
      };
      const request = store.put(gameData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };

  const lastPlayedUpdate = async (db, gmName) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(gmName);
      
      getRequest.onsuccess = () => {
        const gameData = getRequest.result;
        if (gameData) {
          gameData.lastPlayed = new Date().toISOString();
          const putRequest = store.put(gameData);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  };

  const cleanupOldGms = async (db) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      const thweeDays = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const game = cursor.value;
          const lastPlayed = new Date(game.lastPlayed || game.uploadDate);
          if (lastPlayed < thweeDays) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  };

  const fetchDb = async (db, gmName) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(gmName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const extractZip = async (zipUrl) => {
    const response = await fetch(zipUrl);
    const blob = await response.blob();
    const zip = new JSZip();
    const contents = await zip.loadAsync(blob);
    const files = {};
    //jsizp checking
    for (const [path, zipEntry] of Object.entries(contents.files)) {
      if (!zipEntry.dir) {
        const isBinary = /\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|mp3|mp4|ogg|webm|wasm|data|unityweb|bundle|bin|dat)$/i.test(path);
        if (isBinary) {
          files[path] = await zipEntry.async('base64');
        } else {
          files[path] = await zipEntry.async('string');
        }
      }
    }
    return files;
  };

  const regSw = async () => {
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const existing = regs.find(reg => reg.active?.scriptURL.includes('/loadersw.js'));
        if (!existing) {
          await navigator.serviceWorker.register('/loadersw.js');
        }
      } catch (error) {
        console.error('sw error:', error);
      }
    }
  };

  const loadGm = async () => {
    try {
      setLoading(true);
      await regSw();
      const db = await initDB();
      
      await cleanupOldGms(db);
      
      const gmName = app.url.split('/').pop().replace('.zip', '') || 'game-' + Date.now();
      
      const existing = await fetchDb(db, gmName);
      if (existing) {
        await lastPlayedUpdate(db, gmName);
        setgmUrl(`/game/${gmName}/index.html`);
        setLoading(false);
        return;
      }

      setDownloading(true);
      const files = await extractZip(app.url);
      await save(db, gmName, files);
      setgmUrl(`/game/${gmName}/index.html`);
    } catch (error) {
      console.error('error loading game:', error);
    } finally {
      setLoading(false);
      setDownloading(false);
    }
  };

  const fs = () => gmRef.current?.requestFullscreen?.();

  const external = () => {
    sessionStorage.setItem('query', app?.url);
    window.open('/indev', '_blank');
  };

  const zoomIn = () => {
    if (!gmRef.current) return;
    const newZoom = Math.min(zoom + 0.1, 2);
    gmRef.current.style.zoom = newZoom;
    setZoom(newZoom);
  };

  const zoomOut = () => {
    if (!gmRef.current) return;
    const newZoom = Math.max(zoom - 0.1, 0.5);
    gmRef.current.style.zoom = newZoom;
    setZoom(newZoom);
  };

  const iframeSrc = app?.local ? gameUrl : '/src/static/loader.html?ui=false';

  return (
    <div
      className={clsx(
        'flex flex-col h-[calc(100vh-38px)] w-full rounded-xl',
        theming.appItemColor,
        theming[`theme-${theme || 'default'}`],
      )}
    >
      <div className="p-2 pl-1 border-b flex gap-2">
        <InfoCard app={app} theme={theme} />
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
        />
      )}

      <div className="p-2.5 flex gap-2 border-t">
        <Control icon={SquareArrowOutUpRight} fn={external} />
        <Control icon={ZoomIn} fn={zoomIn} className="ml-auto" />
        <Control icon={ZoomOut} fn={zoomOut} />
        <Control icon={Maximize2} fn={fs} />
      </div>
    </div>
  );
};

export default Loader;
