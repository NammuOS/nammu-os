import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { calculateSubmenuPosition } from './contextMenuPosition';
import type { CalculatedMenuPosition, ContextMenuSafeArea } from './contextMenuTypes';

export default function ContextSubmenu({
  parentRef,
  safeArea,
  children,
  ariaLabel,
}: {
  parentRef: RefObject<HTMLElement | null>;
  safeArea: ContextMenuSafeArea;
  children: ReactNode;
  ariaLabel: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CalculatedMenuPosition | null>(null);

  useLayoutEffect(() => {
    const calculate = () => {
      const menu = menuRef.current;
      const parent = parentRef.current;
      if (!menu || !parent) return;
      const rect = menu.getBoundingClientRect();
      setPosition(
        calculateSubmenuPosition({
          parentRect: parent.getBoundingClientRect(),
          menuWidth: rect.width,
          menuHeight: rect.height,
          safeArea,
        }),
      );
    };
    calculate();
    window.addEventListener('resize', calculate);
    window.addEventListener('orientationchange', calculate);
    const observer =
      typeof ResizeObserver !== 'undefined' && menuRef.current
        ? new ResizeObserver(calculate)
        : null;
    if (menuRef.current && observer) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener('resize', calculate);
      window.removeEventListener('orientationchange', calculate);
      observer?.disconnect();
    };
  }, [parentRef, safeArea]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className={`nammu-context-surface is-submenu ${position ? 'is-positioned' : 'is-measuring'}`}
      style={
        position
          ? { left: position.left, top: position.top, transformOrigin: position.transformOrigin }
          : { left: 0, top: 0 }
      }
    >
      {children}
    </div>,
    document.body,
  );
}
