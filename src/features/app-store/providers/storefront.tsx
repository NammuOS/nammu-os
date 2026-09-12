'use client';

import { useQuery } from '@tanstack/react-query';
import { useAvailableApps } from './available-apps';
import { resolveStorefront } from '@/features/app-store/data/storefront';
import type { NammuResolvedStorefront } from '@/lib/appStore';
import { appStoreStorefrontQueryOptions } from '@/features/app-store/data/query-options';

const emptyStorefront: NammuResolvedStorefront = {
  sections: [],
  featuredByCategory: new Map(),
  dates: new Map(),
};

export function useStorefront(): NammuResolvedStorefront & { isLoading: boolean; isUnavailable: boolean } {
  const storefrontQ = useQuery(appStoreStorefrontQueryOptions());
  const availableApps = useAvailableApps();

  const hasFailed = storefrontQ.isError || storefrontQ.errorUpdateCount > 0;
  const isLoading = !storefrontQ.data && !hasFailed && storefrontQ.isLoading;
  const isUnavailable = !storefrontQ.data && (hasFailed || storefrontQ.isPaused);

  if (!storefrontQ.data || availableApps.isLoading || !availableApps.appsKeyed) {
    return { ...emptyStorefront, isLoading, isUnavailable };
  }

  return {
    ...resolveStorefront(storefrontQ.data, availableApps.appsKeyed, availableApps.appsGroupedByCategory ?? {}),
    isLoading,
    isUnavailable,
  };
}