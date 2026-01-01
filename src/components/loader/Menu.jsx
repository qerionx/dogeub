import clsx from 'clsx';
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptions } from '/src/utils/optionsContext';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';

const devTools = (fr) => {
  if (!fr?.contentWindow || !fr?.contentDocument) return;
  
  try {
    const doc = fr.contentDocument;
    const win = fr.contentWindow;
    const erudaEl = doc.getElementById('eruda');
    
    if (erudaEl?.shadowRoot) {
      win.eruda?.destroy();
      return;
    }
    
    const s = doc.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = () => {
      win.eruda?.init();
      win.eruda?.show();
      win.eruda?.show('elements');
      setTimeout(() => {
        const root = doc.getElementById('eruda')?.shadowRoot;
        root?.querySelector('div.eruda-entry-btn')?.remove();
      }, 100);
    };
    doc.body.appendChild(s);
  } catch (e) {
    console.error(e);
  }
};

export default function Menu() {
  const { showMenu, toggleMenu, tabs, addTab, setActive, removeTab, showTabs, activeFrameRef, toggleUI } =
    loaderStore();
  const { options } = useOptions();
  const nav = useNavigate();

  const newTab = useCallback(() => {
    if (tabs.length < 20) {
      let uuid = crypto.randomUUID();
      addTab({
        title: 'New Tab',
        id: uuid,
        url: 'tabs://new',
      });
      setActive(uuid);
    }
  }, [tabs.length]);

  const fs = useCallback(() => {
    activeFrameRef?.current && activeFrameRef.current?.requestFullscreen?.();
  }, [activeFrameRef]);

  const clearTabs = useCallback(() => {
    tabs.forEach((tab) => removeTab(tab.id));
    newTab();
  }, [tabs, removeTab, newTab]);

  const togEruda = useCallback(() => {
    activeFrameRef?.current && devTools(activeFrameRef.current);
  }, [activeFrameRef]);

  const items = [
    {
      name: 'New Tab',
      shortcut: 'alt + n',
      fn: newTab,
    },
    {
      name: 'Clear Tabs',
      shortcut: 'alt + c',
      fn: clearTabs,
    },
    {
      name: 'Fullscreen',
      shortcut: 'shift + f',
      fn: fs,
      disabled: !activeFrameRef?.current,
      divider: true,
    },

    { name: 'Hide UI', shortcut: 'alt + z', fn: toggleUI },
    { name: 'DevTools', shortcut: 'alt + i', fn: togEruda, disabled: !activeFrameRef?.current, divider: true },
    { name: 'Return Home', fn: () => nav('/') },
  ];

  useEffect(() => {
    const shortcuts = {
      'alt+n': newTab,
      'alt+c': clearTabs,
      'shift+F': () => activeFrameRef?.current && fs(),
      'alt+z': toggleUI,
      'alt+i': togEruda,
    };

    const handleKey = (e) => {
      const key = `${e.altKey ? 'alt+' : ''}${e.shiftKey ? 'shift+' : ''}${e.key}`;
      const action = shortcuts[key];

      if (action) {
        e.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [newTab, clearTabs, fs, activeFrameRef, toggleUI, togEruda]);

  const cnt = clsx(
    'absolute right-2 w-45 rounded-lg shadow-lg overflow-hidden text-sm z-50',
    'border transition-all duration-200 origin-top-right',
    showTabs ? 'mt-21' : 'mt-11',
    showMenu
      ? 'scale-100 opacity-100 pointer-events-auto'
      : 'scale-95 opacity-0 pointer-events-none',
  );

  const item = clsx(
    'w-full flex justify-between items-center text-left text-[0.8rem] px-3 py-2 focus:outline-none',
    options.type === 'light' ? 'hover:bg-gray-100' : 'hover:bg-[#ffffff0c]',
  );

  return (
    <div className={cnt} style={{ backgroundColor: options.menuColor || '#1a252f' }}>
      {items.map(({ name, shortcut = null, divider = null, fn = null, disabled = false }, id) => (
        <div
          key={id}
          disabled={disabled}
          className={clsx(disabled ? 'opacity-50 pointer-events-none' : '')}
        >
          <button
            type="button"
            onClick={() => {
              !disabled && fn();
              showMenu && toggleMenu();
            }}
            className={item}
          >
            <span>{name}</span>
            {shortcut && (
              <span className="text-[0.7rem] text-gray-500 dark:text-gray-400">{shortcut}</span>
            )}
          </button>
          {divider && (
            <hr
              className={clsx(
                'border-t',
                options.type === 'light' ? 'border-gray-300' : 'border-gray-700',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
