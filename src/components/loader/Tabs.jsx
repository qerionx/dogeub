import loaderStore from '/src/utils/hooks/loader/useLoaderStore';
import { Globe, X, Plus, Loader } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOptions } from '/src/utils/optionsContext'
import clsx from 'clsx';

const TabBar = () => {
  const { tabs, addTab, removeTab, setActive, showTabs, setLastActive, showUI } = loaderStore();
  const { options } = useOptions();

  return (
    <div className={clsx("h-10 items-center overflow-hidden gap-1 px-1", showTabs && showUI ? 'flex' : 'hidden')} style={{ backgroundColor: options.tabBarColor || "#070e15" }}>
      {tabs.map(({ title, id, active, isLoading, url }) => {
        const showGlobe = url === 'tabs://new' || !isLoading;
        return (
          <div
            className={clsx(
              'flex flex-1 flex-shrink px-2 h-[calc(100%-7px)] min-w-[60px] max-w-[200px]',
              'items-center border rounded-md duration-150',
            )}
            onClick={() => setActive(id)}
            key={id}
            style={{ backgroundColor: active ? options.tabColor || "#111e2fb0" : "", borderColor: active ? options.tabOutline || "#344646" : "#ffffff0c" }}
          >
            {showGlobe ? (
              <Globe size={15} className="flex-shrink-0" />
            ) : (
              <Loader size={15} className="flex-shrink-0 animate-spin" />
            )}
            <span className="truncate text-[0.79rem] ml-1 min-w-0">{url === 'tabs://new' ? 'New Tab' : title}</span>
            <X
              size={13}
              className={clsx("ml-auto flex-shrink-0 duration-200", tabs.length < 2 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',)}
              onClick={(e) => {
                e.stopPropagation();
                if (tabs.length > 1) {
                  active && setLastActive(id);
                  removeTab(id);
                }
              }}
            />
          </div>
        );
      })}

      <button
        disabled={tabs.length >= 20}
        className={clsx(
          'flex-none mx-1 w-6 h-6',
          'flex items-center justify-center',
          'duration-100 rounded-lg',
          options.type != 'light' ? "hover:bg-[#ffffff1e]" : "hover:bg-[#a7a7a7]",
          tabs.length >= 20 ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
        )}
        onClick={() => {
          if (tabs.length < 20) {
            let uuid = crypto.randomUUID();
            addTab({
              title: 'New Tab',
              id: uuid,
              url: "tabs://new"
            });
            setActive(uuid);
          }
        }}
      >
        <Plus size={15} />
      </button>
    </div>
  );
};

export default TabBar;
