import {
  useCallback,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useContextMenuStore } from './contextMenuStore';
import type { ContextMenuEntry, ContextMenuSafeArea } from './contextMenuTypes';

type ContextMenuOptions = {
  safeArea?: ContextMenuSafeArea;
  ariaLabel?: string;
};

export function useContextMenu() {
  const { openMenu, closeMenu } = useContextMenuStore();
  const longPressTimer = useRef<number | null>(null);

  const openAtEvent = useCallback(
    (
      event: {
        clientX: number;
        clientY: number;
        currentTarget?: EventTarget | null;
        preventDefault?: () => void;
        stopPropagation?: () => void;
      },
      items: ContextMenuEntry[],
      options?: ContextMenuOptions,
    ) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const target = event.currentTarget instanceof Element ? event.currentTarget : undefined;
      openMenu({
        items,
        anchor: { x: event.clientX, y: event.clientY, rect: target?.getBoundingClientRect() },
        safeArea: options?.safeArea,
        ariaLabel: options?.ariaLabel,
      });
    },
    [openMenu],
  );

  const openForKeyboard = useCallback(
    (
      event: KeyboardEvent<HTMLElement>,
      items: ContextMenuEntry[],
      options?: ContextMenuOptions,
    ) => {
      if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return false;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu({
        items,
        anchor: {
          x: rect.left + Math.min(20, rect.width / 2),
          y: rect.top + Math.min(20, rect.height / 2),
          rect,
        },
        safeArea: options?.safeArea,
        ariaLabel: options?.ariaLabel,
      });
      return true;
    },
    [openMenu],
  );

  const startLongPress = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      items: ContextMenuEntry[],
      options?: ContextMenuOptions,
    ) => {
      if (event.pointerType === 'mouse') return;
      const { clientX, clientY, currentTarget } = event;
      const rect = currentTarget.getBoundingClientRect();
      longPressTimer.current = window.setTimeout(
        () =>
          openMenu({
            items,
            anchor: { x: clientX, y: clientY, rect },
            safeArea: options?.safeArea,
            ariaLabel: options?.ariaLabel,
          }),
        520,
      );
    },
    [openMenu],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);

  return { openMenu, closeMenu, openAtEvent, openForKeyboard, startLongPress, cancelLongPress };
}
