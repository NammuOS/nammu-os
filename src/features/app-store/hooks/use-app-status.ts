'use client';

import { useMemo } from 'react';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import type { NammuAppManifest, NammuInstalledApp, AppStoreStatus, NammuAppStateOrLoading } from '@/lib/appStore';
import { buildAppStatusMap, deriveAppStatus } from '@/lib/appStore';

export function useAppStatusMap(userAppsKeyed?: Record<string, NammuInstalledApp>): Map<string, AppStoreStatus> {
  const { apps } = useAvailableApps();
  return useMemo(() => buildAppStatusMap(apps ?? [], userAppsKeyed), [apps, userAppsKeyed]);
}

export function useAppCardStateMap(apps: readonly NammuAppManifest[]) {
  // This would typically come from a tRPC subscription or polling
  // For now, return empty map - can be enhanced later with real-time updates
  return useMemo(() => new Map<string, { state: NammuAppStateOrLoading; progress?: number }>(), [apps]);
}

export function useAppStatus(
  app: NammuAppManifest | undefined,
  userApp: NammuInstalledApp | undefined,
): AppStoreStatus | undefined {
  if (!app) return undefined;
  return deriveAppStatus({
    compatible: true,
    installedState: userApp?.state,
    updateAvailable: Boolean(userApp && app.version !== userApp.version),
  });
}