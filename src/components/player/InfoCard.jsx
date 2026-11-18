import theming from '/src/styles/theming.module.css';
import clsx from 'clsx';
import { LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { useOptions } from '/src/utils/optionsContext';

const InfoCard = ({ app, theme }) => {
  const { options } = useOptions();
  const [imgErr, setImgErr] = useState(false);
  const shrinkHeader = options.shrinkHeader ?? false;
  const sizeCls = shrinkHeader ? 'w-8 h-8' : 'w-12 h-12';

  return (
    <div
      className={clsx(
        'flex w-full items-center rounded-xl overflow-hidden',
        shrinkHeader ? 'h-8 px-2' : 'h-13 p-2.5 py-7',
        theming[`theme-${theme || 'default'}`],
      )}
    >
      {app?.icon && !imgErr ? (
        <img
          src={app.icon}
          onError={() => setImgErr(true)}
          className={clsx('rounded-md object-cover', sizeCls)}
        />
      ) : (
        <LayoutGrid className={clsx('rounded-md shrink-0 opacity-75', sizeCls)} />
      )}
      <div
        className={clsx(
          'ml-4 flex',
          shrinkHeader
            ? 'flex-row items-center gap-2 overflow-hidden whitespace-nowrap'
            : 'flex-col gap-1',
        )}
      >
        <p className="font-bold whitespace-nowrap">{app?.appName || 'Unknown App'}</p>
        <span
          className={clsx(
            'text-ellipsis',
            shrinkHeader && 'overflow-hidden truncate opacity-80 text-sm',
          )}
        >
          {app?.desc || 'No description available.'}
        </span>
      </div>
    </div>
  );
};

export default InfoCard;
