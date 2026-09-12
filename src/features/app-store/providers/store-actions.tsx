'use client';

import { createContext, useContext, useCallback, ReactNode } from 'react';
import { trpcClient } from '@/trpc/client';
import type { NammuAppManifest, NammuInstalledApp } from '@/lib/appStore';

interface StoreActionsContextValue {
  installApp: (app: NammuAppManifest) => Promise<void>;
  openApp: (appId: string) => void;
  updateApp: (app: NammuAppManifest) => Promise<void>;
  uninstallApp: (appId: string) => Promise<void>;
  isAppIdAmbiguous: (appId: string) => boolean;
}

const StoreActionsContext = createContext<StoreActionsContextValue | null>(null);

interface StoreActionsProviderProps {
  children: ReactNode;
  userAppsKeyed?: Record<string, NammuInstalledApp>;
}

export function StoreActionsProvider({ children, userAppsKeyed = {} }: StoreActionsProviderProps) {
  const installApp = useCallback(
    async (app: NammuAppManifest) => {
      console.log('Installing app:', app.id);
      window.location.href = `/app-store/${app.id}`;
    },
    [],
  );

  const openApp = useCallback((appId: string) => {
    const userApp = userAppsKeyed[appId];
    if (userApp) {
      window.dispatchEvent(
        new CustomEvent('nammu-open-app', { detail: { appId, windowId: `app:${appId}` } }),
      );
    } else {
      window.location.href = `/app-store/${appId}`;
    }
  }, [userAppsKeyed]);

  const updateApp = useCallback(
    async (app: NammuAppManifest) => {
      console.log('Updating app:', app.id);
    },
    [],
  );

  const uninstallApp = useCallback(
    async (appId: string) => {
      console.log('Uninstalling app:', appId);
    },
    [],
  );

  const isAppIdAmbiguous = useCallback((appId: string) => {
    return false;
  }, []);

  return (
    <StoreActionsContext.Provider
      value={{
        installApp,
        openApp,
        updateApp,
        uninstallApp,
        isAppIdAmbiguous,
      }}
    >
      {children}
    </StoreActionsContext.Provider>
  );
}

export function useStoreActions() {
  const context = useContext(StoreActionsContext);
  if (!context) {
    return null;
  }
  return context;
}