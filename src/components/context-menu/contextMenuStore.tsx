import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ContextMenuRequest, ContextMenuSafeArea } from './contextMenuTypes';

interface ContextMenuState extends ContextMenuRequest {
  key: number;
}

interface ContextMenuStoreValue {
  menu: ContextMenuState | null;
  defaultSafeArea: ContextMenuSafeArea;
  openMenu: (request: ContextMenuRequest) => void;
  closeMenu: () => void;
}

const ContextMenuStore = createContext<ContextMenuStoreValue | null>(null);

export function ContextMenuProvider({
  children,
  safeArea = {},
}: {
  children: ReactNode;
  safeArea?: ContextMenuSafeArea;
}) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const openMenu = useCallback((request: ContextMenuRequest) => {
    setMenu({ ...request, key: Date.now() + Math.random() });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const value = useMemo(
    () => ({ menu, defaultSafeArea: safeArea, openMenu, closeMenu }),
    [closeMenu, menu, openMenu, safeArea],
  );
  return <ContextMenuStore.Provider value={value}>{children}</ContextMenuStore.Provider>;
}

export function useContextMenuStore() {
  const store = useContext(ContextMenuStore);
  if (!store) throw new Error('useContextMenuStore must be used inside ContextMenuProvider');
  return store;
}
