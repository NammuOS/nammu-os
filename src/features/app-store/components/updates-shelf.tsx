'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { AppCard } from '@/features/app-store/components/app-card';
import { nammuAppPath } from '@/lib/appStore';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useAppStatusMap } from '@/features/app-store/hooks/use-app-status';
import type { AppStoreStatus, NammuAppManifest } from '@/lib/appStore';

export function UpdatesShelf() {
  const { t } = useTranslation();
  const { apps } = useAvailableApps();
  const statuses = useAppStatusMap();

  // In a real implementation, this would come from user apps
  const updates: NammuAppManifest[] = [];

  if (updates.length === 0) return null;

  return (
    <section className='flex flex-col gap-4' aria-label={t('app-updates.available-updates')}>
      <div className='flex items-center justify-between'>
        <h3 className='text-lg font-semibold'>{t('app-updates.available-updates')}</h3>
      </div>
      <div className='grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3'>
        {updates.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            status={statuses.get(app.id)}
            to={nammuAppPath(app.id)}
          />
        ))}
      </div>
    </section>
  );
}