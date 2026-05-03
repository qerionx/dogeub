import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo } from 'react';

const Pagination = memo(({ count, page, onChange, options = {}, variant = 'outlined', shape = 'rounded' }) => {
  const textColor = options.paginationTextColor || '#9baec8';
  const borderColor = options.paginationBorderColor || '#ffffff1c';
  const bgColor = options.paginationBgColor || '#141d2b';
  const selectedColor = options.paginationSelectedColor || '#75b3e8';
  const fontFamily = 'SFProText';

  const onprevclic = () => {
    if (page > 1) onChange(null, page - 1);
  };

  const onnexclick = () => {
    if (page < count) onChange(null, page + 1);
  };

  const getpgNums = () => {
    const pages = [];
    const maxVisible = 7;
    const halfWindow = Math.floor(maxVisible / 2);

    let start = Math.max(1, page - halfWindow);
    let end = Math.min(count, page + halfWindow);

    if (end - start < maxVisible - 1) {
      if (start === 1) {
        end = Math.min(count, start + maxVisible - 1);
      } else {
        start = Math.max(1, end - maxVisible + 1);
      }
    }

    if (start > 1) {
      pages.push(1);
      if (start > 2) {
        pages.push('...');
      }
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (end < count) {
      if (end < count - 1) {
        pages.push('...');
      }
      pages.push(count);
    }

    return pages;
  };

  const pgNums = getpgNums();
  const borderRadius = shape === 'rounded' ? '8px' : '4px';

  return (
    <div className="flex items-center justify-center gap-1" style={{ fontFamily }}>
      {/*prev btn*/}
      <button
        onClick={onprevclic}
        disabled={page === 1}
        className="p-2 rounded flex items-center justify-center transition-colors"
        style={{
          borderRadius,
          color: page === 1 ? '#6b7a8f' : textColor,
          border: `1px solid ${page === 1 ? '#ffffff0a' : borderColor}`,
          backgroundColor: page === 1 ? '#0a0f1a' : bgColor,
          cursor: page === 1 ? 'not-allowed' : 'pointer',
          opacity: page === 1 ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (page !== 1) {
            e.currentTarget.style.backgroundColor = `${borderColor}`;
          }
        }}
        onMouseLeave={(e) => {
          if (page !== 1) {
            e.currentTarget.style.backgroundColor = bgColor;
          }
        }}
      >
        <ChevronLeft size={20} />
      </button>

      {/*pg nums */}
      <div className="flex gap-1">
        {pgNums.map((num, idx) => (
          <div key={idx}>
            {num === '...' ? (
              <span
                className="px-3 py-2 flex items-center justify-center"
                style={{ color: textColor, fontFamily }}
              >
                ...
              </span>
            ) : (
              <button
                onClick={() => onChange(null, num)}
                className="px-3 py-2 rounded transition-colors text-sm font-medium"
                style={{
                  borderRadius,
                  color: num === page ? '#fff' : textColor,
                  backgroundColor: num === page ? selectedColor : bgColor,
                  border: `1px solid ${num === page ? selectedColor : borderColor}`,
                  cursor: 'pointer',
                  fontFamily,
                  minWidth: '36px',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  if (num !== page) {
                    e.currentTarget.style.backgroundColor = `${borderColor}`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (num !== page) {
                    e.currentTarget.style.backgroundColor = bgColor;
                  }
                }}
              >
                {num}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* nexy btn */}
      <button
        onClick={onnexclick}
        disabled={page === count}
        className="p-2 rounded flex items-center justify-center transition-colors"
        style={{
          borderRadius,
          color: page === count ? '#6b7a8f' : textColor,
          border: `1px solid ${page === count ? '#ffffff0a' : borderColor}`,
          backgroundColor: page === count ? '#0a0f1a' : bgColor,
          cursor: page === count ? 'not-allowed' : 'pointer',
          opacity: page === count ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (page !== count) {
            e.currentTarget.style.backgroundColor = `${borderColor}`;
          }
        }}
        onMouseLeave={(e) => {
          if (page !== count) {
            e.currentTarget.style.backgroundColor = bgColor;
          }
        }}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
});

Pagination.displayName = 'Pagination';

export default Pagination;
