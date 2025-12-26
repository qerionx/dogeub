import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import { useOptions } from '/src/utils/optionsContext';

export default function Menu() {
  const { showMenu, toggleMenu, tabs, addTab, setActive, removeTab, activeFrameRef, toggleUI } =
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

  const items = [
    {
      name: 'New Tab',
      shortcut: 'alt + n',
      fn: newTab,
    },
    {
      name: 'Clear Tabs',
      shortcut: 'alt + c',
      fn: () => {
        tabs.forEach((tab) => {
          removeTab(tab.id);
        });
        newTab();
      },
    },
    {
      name: 'Fullscreen',
      shortcut: 'shift + f',
      fn: fs,
      disabled: !activeFrameRef?.current,
      divider: true,
    },

    { name: 'Hide UI', shortcut: 'alt + z', fn: toggleUI },
    { name: 'DevTools', shortcut: 'alt + i', disabled: !activeFrameRef?.current, divider: true },
    { name: 'Return Home', fn: () => nav('/') },
  ];

  const cnt = clsx(
    'absolute right-2 mt-21 w-45 rounded-lg shadow-lg overflow-hidden text-sm z-50',
    'border transition-all duration-200 origin-top-right',
    showMenu ? 'scale-100 opacity-100 pointer-events-auto' : 'scale-95 opacity-0 pointer-events-none',
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
