import { useState, useRef, useEffect, memo, cloneElement, Children } from 'react';

const Tooltip = memo(({ title, arrow = true, placement = 'top', children }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const updatePos = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const trigrect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const gap = 8;
    const arrowSize = 4;

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = trigrect.top - tooltipRect.height - gap - (arrow ? arrowSize : 0);
        left = trigrect.left + (trigrect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = trigrect.bottom + gap + (arrow ? arrowSize : 0);
        left = trigrect.left + (trigrect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = trigrect.top + (trigrect.height - tooltipRect.height) / 2;
        left = trigrect.left - tooltipRect.width - gap - (arrow ? arrowSize : 0);
        break;
      case 'right':
        top = trigrect.top + (trigrect.height - tooltipRect.height) / 2;
        left = trigrect.right + gap + (arrow ? arrowSize : 0);
        break;
      default:
        break;
    }

    setPosition({
      top: Math.round(top),
      left: Math.round(left),
    });
  };

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(updatePos, 0);
      window.addEventListener('scroll', updatePos);
      window.addEventListener('resize', updatePos);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('scroll', updatePos);
        window.removeEventListener('resize', updatePos);
      };
    }
  }, [visible]);

  const getArrowStyle = () => {
    const arrowSize = 4;
    const arrcolor = '#616161';
    const baseStyle = {
      position: 'absolute',
      width: 0,
      height: 0,
      borderStyle: 'solid',
    };

    switch (placement) {
      case 'top':
        return {
          ...baseStyle,
          bottom: -arrowSize,
          left: '50%',
          transform: 'translateX(-50%)',
          borderWidth: `${arrowSize}px ${arrowSize}px 0 ${arrowSize}px`,
          borderColor: `${arrcolor} transparent transparent transparent`,
        };
      case 'bottom':
        return {
          ...baseStyle,
          top: -arrowSize,
          left: '50%',
          transform: 'translateX(-50%)',
          borderWidth: `0 ${arrowSize}px ${arrowSize}px ${arrowSize}px`,
          borderColor: `transparent transparent ${arrcolor} transparent`,
        };
      case 'left':
        return {
          ...baseStyle,
          right: -arrowSize,
          top: '50%',
          transform: 'translateY(-50%)',
          borderWidth: `${arrowSize}px 0 ${arrowSize}px ${arrowSize}px`,
          borderColor: `transparent transparent transparent ${arrcolor}`,
        };
      case 'right':
        return {
          ...baseStyle,
          left: -arrowSize,
          top: '50%',
          transform: 'translateY(-50%)',
          borderWidth: `${arrowSize}px ${arrowSize}px ${arrowSize}px 0`,
          borderColor: `transparent ${arrcolor} transparent transparent`,
        };
      default:
        return baseStyle;
    }
  };

  return (
    <>
      {Children.map(children, (child) =>
        cloneElement(child, {
          ref: triggerRef,
          onMouseEnter: () => setVisible(true),
          onMouseLeave: () => setVisible(false),
          onFocus: () => setVisible(true),
          onBlur: () => setVisible(false),
        })
      )}

      {visible && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: `${position.top}px`,
            left: `${position.left}px`,
            backgroundColor: '#616161d1',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '10.5px',
            fontWeight: '400',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1300,
            boxShadow: '0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)',
            animation: 'fadeIn 0.2s ease-in-out',
          }}
        >
          {title}
          {arrow && <div style={getArrowStyle()} />}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(0, -4px);
          }
          to {
            opacity: 1;
            transform: translate(0, 0);
          }
        }
      `}</style>
    </>
  );
});

Tooltip.displayName = 'Tooltip';

export default Tooltip;
