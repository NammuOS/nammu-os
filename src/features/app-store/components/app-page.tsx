'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { useParams } from 'next/navigation';
import { cn } from '@/utils/cn';
import { Loading } from '@/components/ui/loading';
import { nammuAppPath, getRelatedApps, buildAppStatusMap, type AppStoreStatus } from '@/lib/appStore';
import { useAppStatusMap } from '@/features/app-store/hooks/use-app-status';
import { StoreActionsProvider } from '@/features/app-store/providers/store-actions';
import { AppPageHero, InstallButton } from './app-page/app-hero';
import { AppPageContent } from './app-page/app-page-content';
import { AppGrid } from '@/features/app-store/components/app-grid';
import { SectionHeading } from '@/features/app-store/components/section-heading';
import { appReleasesQueryOptions, reconcileReleases } from '@/features/app-store/data/releases';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useAvailableApp } from '@/features/app-store/providers/available-apps';

export default function AppPage() {
  const { t } = useTranslation();
  const params = useParams();
  const appId = params.id as string;
  const { app, isLoading: isLoadingApp } = useAvailableApp(appId);
  const { apps, isLoading: isLoadingApps } = useAvailableApps();
  const installButtonRef = useRef<{ triggerInstall: (depId?: string) => void } | null>(null);

  if (isLoadingApp || isLoadingApps) return <Loading />;
  if (!app) throw new Error('App not found');

  const statuses = useAppStatusMap();
  const relatedApps = getRelatedApps(apps ?? [], app.id, 6);

  const releasesQ = useQuery({ ...appReleasesQueryOptions(appId), enabled: Boolean(appId) });
  const releaseTimeline = reconcileReleases(app, releasesQ.data);

  const userApp = undefined; // Would come from user apps provider
  const highlightLatestRelease = false;

  const showDependencies = (dependencyId?: string) => {
    if (dependencyId) {
      installButtonRef.current?.triggerInstall(dependencyId);
    }
  };

  return (
    <StoreActionsProvider>
      <div key={app.id} className='flex flex-col gap-6 md:gap-8'>
        <ErrorBoundary
          fallback={
            <AppPageHero
              app={app}
              userApp={userApp}
              renderActions={() => (
                <div className='pointer-events-none opacity-50'>
                  <InstallButton app={app} userApp={userApp} state='not-installed' />
                </div>
              )}
            />
          }
        >
          <AppPageHero app={app} userApp={userApp} renderActions={() => <InstallButton app={app} userApp={userApp} />} />
        </ErrorBoundary>
        <div className='flex flex-col gap-6 md:gap-8'>
          <ErrorBoundary fallback={<div className='rounded-xl border border-white/5 bg-white/3 p-6'>{t('app-page.error-loading-content')}</div>}>
            <AppPageContent
              app={app}
              userApp={userApp}
              releaseTimeline={releaseTimeline}
              highlightLatestRelease={highlightLatestRelease}
              showDependencies={showDependencies}
              registryId={app.appStoreId}
              makeAppPath={nammuAppPath}
            />
            {relatedApps.length > 0 && (
              <section className='flex flex-col gap-4'>
                <SectionHeading title={t('app-page.section.recommendations')} />
                <AppGrid apps={relatedApps} statuses={statuses} />
              </section>
            )}
          </ErrorBoundary>
        </div>
      </div>
    </StoreActionsProvider>
  );
}