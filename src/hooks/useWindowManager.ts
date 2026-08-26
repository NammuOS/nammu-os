import { useState, useCallback, useRef } from 'react';

export type SnapEdge =
  'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface WindowState {
  id: string;
  toolId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
  snap?: SnapEdge | null;
  snapGroup?: string;
  restoreBounds?: { x: number; y: number; width: number; height: number };
  data?: any;
}

let zIndexCounter = 100;

export function useWindowManager() {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const activeIdRef = useRef<string | null>(null);

  const openWindow = useCallback((toolId: string, title: string, data?: any, rightInset = 0) => {
    const id = `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const workspaceWidth = Math.max(360, window.innerWidth - 36 - rightInset);
    const workspaceHeight = Math.max(260, window.innerHeight - 32);
    const isBrowser =
      toolId.includes('browser') || toolId.includes('whatsapp') || toolId.includes('maps');
    const width = isBrowser
      ? Math.min(1060, Math.max(480, workspaceWidth - 32))
      : Math.min(900, Math.max(320, workspaceWidth - 48));
    const preferredTop = isBrowser ? 24 : Math.min(190, Math.max(16, workspaceHeight - 240));
    const height = isBrowser
      ? Math.min(700, Math.max(400, workspaceHeight - 48))
      : Math.min(560, Math.max(220, workspaceHeight - preferredTop - 16));
    const x = 36 + Math.max(0, (workspaceWidth - width) / 2);
    const y = preferredTop;
    zIndexCounter += 1;

    const newWindow: WindowState = {
      id,
      toolId,
      title,
      x,
      y,
      width,
      height,
      zIndex: zIndexCounter,
      isMinimized: false,
      isMaximized: false,
      isFocused: true,
      snap: null,
      data,
    };

    setWindows((prev) => {
      const cleared = prev.map((w) => ({ ...w, isFocused: false }));
      activeIdRef.current = id;
      return [...cleared, newWindow];
    });
    return id;
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const closing = prev.find((w) => w.id === id);
      let filtered = prev.filter((w) => w.id !== id);
      if (closing?.snapGroup)
        filtered = filtered.map((w) =>
          w.snapGroup === closing.snapGroup && w.restoreBounds
            ? {
                ...w,
                ...w.restoreBounds,
                snap: null,
                snapGroup: undefined,
                restoreBounds: undefined,
              }
            : w,
        );
      if (activeIdRef.current === id && filtered.length > 0) {
        const last = filtered[filtered.length - 1];
        activeIdRef.current = last.id;
        return filtered.map((w) => ({ ...w, isFocused: w.id === last.id }));
      }
      return filtered;
    });
  }, []);

  const focusWindow = useCallback((id: string) => {
    zIndexCounter += 1;
    activeIdRef.current = id;
    setWindows((prev) =>
      prev.map((w) => ({
        ...w,
        isFocused: w.id === id,
        zIndex: w.id === id ? zIndexCounter : w.zIndex,
      })),
    );
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMinimized: true, isFocused: false } : w)),
    );
  }, []);

  const restoreWindow = useCallback((id: string) => {
    zIndexCounter += 1;
    activeIdRef.current = id;
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: zIndexCounter }
          : { ...w, isFocused: false },
      ),
    );
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id);
      if (!target) return prev;
      return prev.map((w) => {
        if (
          target.snapGroup &&
          w.id !== id &&
          w.snapGroup === target.snapGroup &&
          w.restoreBounds
        ) {
          return {
            ...w,
            ...w.restoreBounds,
            snap: null,
            snapGroup: undefined,
            restoreBounds: undefined,
          };
        }
        if (w.id !== id) return w;
        const restored = w.snap && w.restoreBounds ? w.restoreBounds : {};
        return {
          ...w,
          ...restored,
          snap: null,
          snapGroup: undefined,
          restoreBounds: undefined,
          isMaximized: !w.isMaximized,
          isFocused: true,
        };
      });
    });
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resizeWindow = useCallback((id: string, width: number, height: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, width, height } : w)));
  }, []);

  const snapWindow = useCallback((id: string, edge?: SnapEdge) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id);
      if (!target) return prev;
      if (target.snap && !edge) {
        return prev.map((w) => {
          const belongsToSplit = target.snapGroup && w.snapGroup === target.snapGroup;
          if ((w.id === id || belongsToSplit) && w.restoreBounds)
            return {
              ...w,
              ...w.restoreBounds,
              snap: null,
              snapGroup: undefined,
              restoreBounds: undefined,
              isMaximized: false,
            };
          return w;
        });
      }
      if (edge) {
        return prev.map((w) =>
          w.id === id
            ? {
                ...w,
                restoreBounds: w.snap
                  ? w.restoreBounds
                  : { x: w.x, y: w.y, width: w.width, height: w.height },
                snap: edge,
                snapGroup: undefined,
                isMaximized: false,
                isFocused: true,
              }
            : { ...w, isFocused: false },
        );
      }

      const partner = [...prev]
        .filter((w) => w.id !== id && !w.isMinimized)
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      const group = `split-${Date.now()}`;

      return prev.map((w) => {
        if (w.id === id)
          return {
            ...w,
            restoreBounds: w.restoreBounds ?? { x: w.x, y: w.y, width: w.width, height: w.height },
            snap: 'left' as const,
            snapGroup: partner ? group : undefined,
            isMaximized: false,
            isFocused: true,
          };
        if (partner && w.id === partner.id)
          return {
            ...w,
            restoreBounds: w.restoreBounds ?? { x: w.x, y: w.y, width: w.width, height: w.height },
            snap: 'right' as const,
            snapGroup: group,
            isMaximized: false,
            isMinimized: false,
            isFocused: false,
          };
        return { ...w, isFocused: false };
      });
    });
  }, []);

  const fitWindows = useCallback((rightInset: number) => {
    const workspaceWidth = Math.max(360, window.innerWidth - 36 - rightInset);
    const workspaceHeight = Math.max(260, window.innerHeight - 32);
    setWindows((prev) =>
      prev.map((w) => {
        if (w.snap || w.isMaximized) return w;
        const width = Math.min(w.width, 900, workspaceWidth - 24);
        const height = Math.min(w.height, workspaceHeight - 24);
        return {
          ...w,
          width,
          height,
          x: Math.max(36, Math.min(w.x, 36 + workspaceWidth - width)),
          y: Math.max(0, Math.min(w.y, workspaceHeight - height)),
        };
      }),
    );
  }, []);

  return {
    windows,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    restoreWindow,
    maximizeWindow,
    moveWindow,
    resizeWindow,
    snapWindow,
    fitWindows,
  };
}
