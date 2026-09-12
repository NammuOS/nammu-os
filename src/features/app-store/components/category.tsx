'use client';

import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorBoundaryCardFallback } from '@/components/ui/error-boundary-card-fallback';
import { VirtualAppGrid } from '@/features/app-store/components/virtual-app-grid';
import { SectionHeading } from '@/features/app-store/components/section-heading';
import { SortControl, useSortParam } from '@/features/app-store/components/sort-control';
import { nammuCategoryPath, getCategoryLabel, getAvailableSorts, sortApps, storeRevealClass, storeRevealDelay } from '@/lib/appStore';
import { useStorefront } from '@/features/app-store/providers/storefront';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useAppStatusMap } from '@/features/app-store/hooks/use-app-status';
import { useAppCardStateMap } from '@/features/app-store/hooks/use-app-status';
import { AppIcon } from '@/components/app-icon';
import { FadeInImg } from '@/components/ui/fade-in-img';
import { AppCardAction } from '@/features/app-store/components/app-card';
import { preloadFirstFewGalleryImages } from '@/features/app-store/data/gallery-preload';
import { cn } from '@/utils/cn';
import type { NammuAppManifest } from '@/lib/appStore';

interface CategoryProps {
  categoryId?: string;
}

export default function Category({ categoryId }: CategoryProps) {
  return (
    <ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
      <CategoryContent categoryId={categoryId} />
    </ErrorBoundary>
  );
}

function CategoryContent({ categoryId }: { categoryId?: string }) {
  const { t } = useTranslation();
  const { apps, appsGroupedByCategory, isLoading } = useAvailableApps();
  const storefront = useStorefront();
  const statuses = useAppStatusMap();
  const appStates = useAppCardStateMap(apps ?? []);
  const availableSorts = getAvailableSorts(storefront.dates);
  const { sort } = useSortParam(availableSorts, storefront.dates);

  if (!categoryId) return null;
  if (isLoading) return null;

  const isAll = categoryId === 'all';
  const categoryApps = isAll ? (apps ?? []) : (appsGroupedByCategory?.[categoryId] ?? []);

  if (categoryApps.length === 0) return null;

  const sortedApps = sortApps(categoryApps, sort, storefront.dates);
  const featuredApps = isAll ? [] : (storefront.featuredByCategory.get(categoryId)?.slice(0, 3) ?? []);

  return (
    <>
      <header className={cn('flex items-center gap-2 md:gap-2.5', storeRevealClass)}>
        <h2 className='min-w-0 flex-1 truncate text-2xl leading-tight font-semibold md:text-3xl'>
          {getCategoryLabel(categoryId, t)}
        </h2>
      </header>
      {featuredApps.length > 0 && (
        <section className={cn('flex flex-col gap-3', storeRevealClass)} style={storeRevealDelay(70)} aria-label={t('app-store.featured-apps')}>
          <h3 className='truncate px-2.5 text-xl leading-tight font-semibold md:text-2xl'>
            {t('app-store.featured-apps')}
          </h3>
          <div className='grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3'>
            {featuredApps.map((app, index) => {
              const actionState = appStates.get(app.id);
              return (
                <FeaturedAppCard
                  key={app.id}
                  app={app}
                  status={statuses?.get(app.id)}
                  lifecycleState={actionState?.state}
                  progress={actionState?.progress}
                  className={index === 2 ? 'max-xl:hidden' : undefined}
                />
              );
            })}
          </div>
        </section>
      )}
      <section className={cn('flex flex-col gap-3', featuredApps.length > 0 && 'mt-2')}>
        <div className={cn('flex items-center justify-between gap-3 px-2.5', storeRevealClass)} style={storeRevealDelay(featuredApps.length > 0 ? 130 : 70)}>
          <h3 className='min-w-0 truncate text-xl leading-tight font-semibold md:text-2xl'>
            {isAll ? t('app-store.section.all-apps') : t('app-store.all-category-apps', { category: getCategoryLabel(categoryId, t) })}
          </h3>
          <SortControl availableSorts={availableSorts} />
        </div>
        <VirtualAppGrid apps={sortedApps} statuses={statuses} revealDelayStart={featuredApps.length > 0 ? 180 : 130} />
      </section>
    </>
  );
}

function FeaturedAppCard({
  app,
  status,
  lifecycleState,
  progress,
  className,
}: {
  app: NammuAppManifest;
  status?: import('@/lib/appStore').AppStoreStatus;
  lifecycleState?: import('@/lib/appStore').NammuAppStateOrLoading;
  progress?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const gallerySrc = app.gallery[0];

  return (
    <div
      onMouseEnter={() => preloadFirstFewGalleryImages(app)}
      className={cn(
        'group relative flex h-[280px] flex-col justify-end overflow-hidden p-4 transition-colors duration-300 hover:bg-white/5',
        'rounded-2xl border border-white/5 bg-white/3',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:ring-1 after:ring-white/5 after:ring-inset',
        className,
      )}
    >
      {gallerySrc ? (
        <div aria-hidden className='absolute inset-x-0 top-0 h-[200px] [mask-image:linear-gradient(to_bottom,black_64%,rgba(0,0,0,0.75)_78%,rgba(0,0,0,0.35)_90%,transparent)]'>
          <FadeInImg
            src={gallerySrc}
            alt=''
            loading='lazy'
            className='h-full w-full object-cover object-top opacity-80 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.02]'
          />
        </div>
      ) : (
        <div aria-hidden className='absolute top-2 left-1/2 isolate h-24 w-24 -translate-x-1/2 scale-150 opacity-30 blur-xl'>
          <div className='absolute inset-0 bg-neutral-400' />
          <img src={app.icon} alt='' className='absolute inset-0 h-full w-full mix-blend-color' draggable={false} />
        </div>
      )}
      <a href={nammuCategoryPath(app.id)} className='absolute inset-0 rounded-2xl outline-hidden ring-inset focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/30' />
      <div className='pointer-events-none relative flex items-center gap-3'>
        <AppIcon src={app.icon} size={56} className='shrink-0 rounded-xl' />
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <h3 className='truncate text-base leading-tight font-semibold md:text-lg'>{app.name}</h3>
          <p className='line-clamp-2 w-full min-w-0 text-sm leading-tight opacity-40 md:text-base'>{app.tagline}</p>
        </div>
        <span className='pointer-events-auto'>
          <AppCardAction app={app} status={status} lifecycleState={lifecycleState} progress={progress} />
        </span>
      </div>
    </div>
  );
}