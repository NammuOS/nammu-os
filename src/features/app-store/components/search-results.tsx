'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { AppGrid } from '@/features/app-store/components/app-grid';
import { AppStoreEmptyState } from '@/features/app-store/components/app-card';
import { SectionHeading } from '@/features/app-store/components/section-heading';
import { useStorefront } from '@/features/app-store/providers/storefront';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useAppStatusMap } from '@/features/app-store/hooks/use-app-status';
import { sortApps, storeRevealClass, storeRevealDelay } from '@/lib/appStore';
import type { NammuAppManifest } from '@/lib/appStore';

interface SearchResultsProps {
  query: string;
}

export function SearchResults({ query }: SearchResultsProps) {
  const { t } = useTranslation();
  const { apps } = useAvailableApps();
  const storefront = useStorefront();
  const statuses = useAppStatusMap();

  if (!query.trim()) return null;

  const results = apps
    ?.filter(
      (app) =>
        app.name.toLowerCase().includes(query.toLowerCase()) ||
        app.tagline.toLowerCase().includes(query.toLowerCase()) ||
        app.description.toLowerCase().includes(query.toLowerCase()) ||
        app.category.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const aName = a.name.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      const bName = b.name.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      return aName - bName;
    }) ?? [];

  return (
    <section className={cn('flex flex-col gap-4', storeRevealClass)} style={storeRevealDelay(90)}>
      <SectionHeading title={t('app-store.search.results', { query })} />
      {results.length > 0 ? (
        <AppGrid apps={results} statuses={statuses} revealDelayStart={130} />
      ) : (
        <AppStoreEmptyState
          title={t('app-store.search.no-results')}
          description={t('app-store.search.no-results-description', { query })}
        />
      )}
    </section>
  );
}