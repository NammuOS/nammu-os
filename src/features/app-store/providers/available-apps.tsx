'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/trpc/client';
import type { NammuAppManifest, NammuAppRegistry } from '@/lib/appStore';

interface AvailableAppsContextValue {
  apps: NammuAppManifest[] | undefined;
  appsKeyed: Record<string, NammuAppManifest> | undefined;
  appsGroupedByCategory: Record<string, NammuAppManifest[]> | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const AvailableAppsContext = createContext<AvailableAppsContextValue | null>(null);

export function AvailableAppsProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<NammuAppRegistry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRegistry = async () => {
    try {
      setIsLoading(true);
      const data = await trpcClient.appStore.registry.query();
      setRegistry(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch app registry'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRegistry();
  }, []);

  const apps = registry?.flatMap((r) => r.apps) ?? [];
  const appsKeyed = Object.fromEntries(apps.map((app) => [app.id, app]));
  const appsGroupedByCategory: Record<string, NammuAppManifest[]> = {};
  for (const app of apps) {
    if (!appsGroupedByCategory[app.category]) appsGroupedByCategory[app.category] = [];
    appsGroupedByCategory[app.category].push(app);
  }

  return (
    <AvailableAppsContext.Provider
      value={{
        apps,
        appsKeyed,
        appsGroupedByCategory,
        isLoading,
        error,
        refetch: fetchRegistry,
      }}
    >
      {children}
    </AvailableAppsContext.Provider>
  );
}

export function useAvailableApps() {
  const context = useContext(AvailableAppsContext);
  if (!context) throw new Error('useAvailableApps must be used within AvailableAppsProvider');
  return context;
}

export function useAvailableApp(appId: string | undefined) {
  const { appsKeyed, isLoading } = useAvailableApps();
  return {
    app: appId ? appsKeyed?.[appId] : undefined,
    isLoading,
  };
}