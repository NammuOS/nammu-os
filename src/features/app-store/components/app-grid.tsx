'use client';

import { ReactNode } from 'react';
import { AppCard, AppStoreEmptyState } from './app-card';
import { SectionHeading } from './section-heading';
import { cn } from '@/utils/cn';
import { appGridClass, storeRevealClass, storeRevealDelay } from '@/lib/appStore';
import type { AppStoreStatus, NammuAppManifest } from '@/lib/appStore';
import { useAppCardStateMap } from '@/features/app-store/hooks/use-app-status';

export function AppGrid({
  apps,
  statuses,
  makeTo,
  className,
  revealDelayStart,
}: {
  apps: readonly NammuAppManifest[];
  statuses?: Map<string, AppStoreStatus>;
  makeTo?: (app: NammuAppManifest) => string;
  className?: string;
  revealDelayStart?: number;
}) {
  const stagger = revealDelayStart !== undefined;
  const appStates = useAppCardStateMap(apps);
  return (
    <div className={cn(appGridClass, className)}>
      {apps.map((app, index) => {
        const actionState = appStates.get(app.id);
        return (
          <AppCard
            key={app.id}
            app={app}
            status={statuses?.get(app.id)}
            lifecycleState={actionState?.state}
            progress={actionState?.progress}
            to={makeTo?.(app)}
            className={stagger ? storeRevealClass : undefined}
            style={stagger ? storeRevealDelay(revealDelayStart! + Math.min(index * 12, 240)) : undefined}
          />
        );
      })}
    </div>
  );
}

export function AppGridSection({
  overline,
  title,
  rightChildren,
  apps,
  statuses,
  makeTo,
  children,
}: {
  overline?: string;
  title: ReactNode;
  rightChildren?: ReactNode;
  apps: readonly NammuAppManifest[];
  statuses?: Map<string, AppStoreStatus>;
  makeTo?: (app: NammuAppManifest) => string;
  children?: ReactNode;
}) {
  return (
    <section className='flex flex-col gap-4'>
      <SectionHeading overline={overline} title={title} rightChildren={rightChildren} />
      <AppGrid apps={apps} statuses={statuses} makeTo={makeTo} />
      {children}
    </section>
  );
}