'use client';

import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from 'react-error-boundary';
import { useStorefront } from '@/features/app-store/providers/storefront';
import { useAvailableApps } from '@/features/app-store/providers/available-apps';
import { useAppStatusMap } from '@/features/app-store/hooks/use-app-status';
import { SortControl } from '@/features/app-store/components/sort-control';
import { VirtualAppGrid } from '@/features/app-store/components/virtual-app-grid';
import { SectionHeading } from '@/features/app-store/components/section-heading';
import { nammuCategoryPath, getAvailableSorts, sortApps, storeRevealClass, storeRevealDelay } from '@/lib/appStore';
import { preloadFirstFewGalleryImages } from '@/features/app-store/data/gallery-preload';
import { ErrorBoundaryCardFallback } from '@/components/ui/error-boundary-card-fallback';
import { FadeInImg } from '@/components/ui/fade-in-img';
import type { NammuAppManifest } from '@/lib/appStore';

export default function Discover() {
  return (
    <ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
      <DiscoverContent />
    </ErrorBoundary>
  );
}

function DiscoverContent() {
  const { t } = useTranslation();
  const availableApps = useAvailableApps();
  const storefront = useStorefront();
  const statuses = useAppStatusMap();
  const availableSorts = getAvailableSorts(storefront.dates);
  const allApps = sortApps(availableApps.apps ?? [], 'name', storefront.dates);

  if (availableApps.isLoading || storefront.isLoading) return null;
  if (storefront.isUnavailable) return <div>Storefront unavailable</div>;

  const sectionDelay = (index: number) => storeRevealDelay(Math.min(90 + index * 70, 440));

  return (
    <>
      {storefront.sections.map((section, index) => (
        <div key={section.id} className={storeRevealClass} style={sectionDelay(index)}>
          <StorefrontSectionView section={section} statuses={statuses} />
        </div>
      ))}
      <section className='flex flex-col gap-4'>
        <div className={storeRevealClass} style={storeRevealDelay(90)}>
          <SectionHeading
            title={t('app-store.section.all-apps')}
            rightChildren={<SortControl availableSorts={availableSorts} />}
          />
        </div>
        <VirtualAppGrid apps={allApps} statuses={statuses} revealDelayStart={130} />
      </section>
    </>
  );
}

function StorefrontSectionView({
  section,
  statuses,
}: {
  section: import('@/lib/appStore').NammuResolvedStorefrontSection;
  statuses: Map<string, import('@/lib/appStore').AppStoreStatus>;
}) {
  const { t } = useTranslation();

  if (section.type === 'app-list' && section.apps?.length) {
    return (
      <section className='flex flex-col gap-4'>
        <SectionHeading title={section.title} subtitle={section.subtitle} />
        <VirtualAppGrid
          apps={section.apps}
          statuses={statuses}
          revealDelayStart={70}
        />
      </section>
    );
  }

  if (section.type === 'spotlight' && section.banners?.length) {
    return (
      <section className='flex flex-col gap-4' aria-label={t('app-store.featured-apps')}>
        <h3 className='text-lg font-semibold'>{t('app-store.featured-apps')}</h3>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {section.banners.map((banner: { app: NammuAppManifest; artwork: { dark: string } }, index: number) => (
            <div
              key={banner.app.id}
              onMouseEnter={() => preloadFirstFewGalleryImages(banner.app)}
              className='relative aspect-video rounded-2xl overflow-hidden bg-white/5 group'
            >
              <FadeInImg
                src={banner.artwork.dark}
                alt={banner.app.name}
                loading='lazy'
                className='h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]'
              />
              <div className='absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end'>
                <h4 className='text-lg font-semibold'>{banner.app.name}</h4>
                <p className='text-sm opacity-80'>{banner.app.tagline}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (section.type === 'category-feature' && section.apps?.length) {
    return (
      <section className='flex flex-col gap-4'>
        <div className='relative aspect-video rounded-2xl overflow-hidden bg-white/5'>
          <FadeInImg
            src={section.artwork.dark}
            alt={section.title}
            className='h-full w-full object-cover'
          />
          <div className='absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent p-6 flex flex-col justify-center'>
            <h3 className='text-2xl font-semibold'>{section.title}</h3>
            <p className='mt-2 text-white/70 max-w-md'>{section.description}</p>
          </div>
        </div>
        <VirtualAppGrid apps={section.apps} statuses={statuses} revealDelayStart={70} />
      </section>
    );
  }

  return null;
}