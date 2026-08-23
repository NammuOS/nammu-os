import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ContextMenuItem from './ContextMenuItem';
import ContextSubmenu from './ContextSubmenu';
import { calculateContextMenuPosition } from './contextMenuPosition';
import { useContextMenuStore } from './contextMenuStore';
import type {
  CalculatedMenuPosition,
  ContextMenuEntry,
  ContextMenuSafeArea,
} from './contextMenuTypes';
import './contextMenu.css';

const selectableIndexes = (items: ContextMenuEntry[]) =>
  items
    .map((item, index) =>
      item.type !== 'separator' && item.type !== 'header' && !item.disabled ? index : -1,
    )
    .filter((index) => index >= 0);

function MenuSurface({
  items,
  safeArea,
  closeMenu,
  onBack,
  autoFocus = false,
}: {
  items: ContextMenuEntry[];
  safeArea: ContextMenuSafeArea;
  closeMenu: () => void;
  onBack?: () => void;
  autoFocus?: boolean;
}) {
  const available = useMemo(() => selectableIndexes(items), [items]);
  const [activeIndex, setActiveIndex] = useState(available[0] ?? -1);
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (autoFocus && activeIndex >= 0) refs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, autoFocus]);

  const focusIndex = (index: number) => {
    setActiveIndex(index);
    refs.current[index]?.focus({ preventScroll: true });
  };
  const move = (amount: number) => {
    if (!available.length) return;
    const current = Math.max(0, available.indexOf(activeIndex));
    focusIndex(available[(current + amount + available.length) % available.length]);
    setSubmenuIndex(null);
  };
  const activate = (index: number) => {
    const item = items[index];
    if (!item || item.type === 'separator' || item.type === 'header' || item.disabled) return;
    if (item.items?.length) {
      setSubmenuIndex(index);
      return;
    }
    item.action?.();
    if (!item.keepOpen) closeMenu();
  };
  const handleKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      if (available.length) focusIndex(available[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      if (available.length) focusIndex(available[available.length - 1]);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const item = items[index];
      if (item.type !== 'separator' && item.type !== 'header' && item.items?.length)
        setSubmenuIndex(index);
    } else if (event.key === 'ArrowLeft' && onBack) {
      event.preventDefault();
      onBack();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'Tab') closeMenu();
  };

  return (
    <>
      {items.map((entry, index) => {
        if (entry.type === 'separator')
          return <div key={entry.id} className="nammu-context-separator" role="separator" />;
        if (entry.type === 'header')
          return (
            <div key={entry.id} className="nammu-context-header">
              {entry.label}
            </div>
          );
        const parentRef = {
          get current() {
            return refs.current[index];
          },
        } as React.RefObject<HTMLButtonElement | null>;
        return (
          <div key={entry.id} className="nammu-context-item-wrap">
            <ContextMenuItem
              ref={(node) => {
                refs.current[index] = node;
              }}
              item={entry}
              active={activeIndex === index}
              submenuOpen={submenuIndex === index}
              onHover={() => {
                setActiveIndex(index);
                setSubmenuIndex(entry.items?.length ? index : null);
              }}
              onActivate={() => activate(index)}
              onKeyDown={(event) => handleKey(event, index)}
            />
            {submenuIndex === index && entry.items?.length ? (
              <ContextSubmenu parentRef={parentRef} safeArea={safeArea} ariaLabel={entry.label}>
                <MenuSurface
                  items={entry.items}
                  safeArea={safeArea}
                  closeMenu={closeMenu}
                  onBack={() => {
                    setSubmenuIndex(null);
                    refs.current[index]?.focus();
                  }}
                  autoFocus
                />
              </ContextSubmenu>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function PositionedContextMenu({
  menu,
  closeMenu,
  safeArea,
}: {
  menu: NonNullable<ReturnType<typeof useContextMenuStore>['menu']>;
  closeMenu: () => void;
  safeArea: ContextMenuSafeArea;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CalculatedMenuPosition | null>(null);
  useEffect(() => {
    const closeOnPointer = (event: PointerEvent) => {
      if (
        menuRef.current?.contains(event.target as Node) ||
        (event.target as Element | null)?.closest('.nammu-context-surface')
      )
        return;
      closeMenu();
    };
    const closeOnBlur = () => closeMenu();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('blur', closeOnBlur);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer, true);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('blur', closeOnBlur);
    };
  }, [closeMenu, menu]);

  useLayoutEffect(() => {
    const calculate = () => {
      const node = menuRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setPosition(
        calculateContextMenuPosition({
          anchorX: menu.anchor.x,
          anchorY: menu.anchor.y,
          menuWidth: rect.width,
          menuHeight: rect.height,
          safeArea,
        }),
      );
    };
    calculate();
    window.addEventListener('resize', calculate);
    window.addEventListener('orientationchange', calculate);
    return () => {
      window.removeEventListener('resize', calculate);
      window.removeEventListener('orientationchange', calculate);
    };
  }, [menu, safeArea]);
  return createPortal(
    <div
      key={menu.key}
      ref={menuRef}
      role="menu"
      aria-label={menu.ariaLabel ?? 'Context menu'}
      className={`nammu-context-surface ${position ? 'is-positioned' : 'is-measuring'}`}
      style={
        position
          ? { left: position.left, top: position.top, transformOrigin: position.transformOrigin }
          : { left: 0, top: 0 }
      }
    >
      <MenuSurface items={menu.items} safeArea={safeArea} closeMenu={closeMenu} autoFocus />
    </div>,
    document.body,
  );
}

export default function ContextMenu() {
  const { menu, closeMenu, defaultSafeArea } = useContextMenuStore();
  const safeArea = useMemo(
    () => ({ ...defaultSafeArea, ...menu?.safeArea }),
    [defaultSafeArea, menu?.safeArea],
  );

  useEffect(() => {
    const suppress = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', suppress, true);
    return () => document.removeEventListener('contextmenu', suppress, true);
  }, []);

  if (!menu) return null;
  return (
    <PositionedContextMenu key={menu.key} menu={menu} closeMenu={closeMenu} safeArea={safeArea} />
  );
}
