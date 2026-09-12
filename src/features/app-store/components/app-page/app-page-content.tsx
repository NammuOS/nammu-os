'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { AppIcon } from '@/components/app-icon';
import { FadeInImg } from '@/components/ui/fade-in-img';
import { nammuAppPath, getAppStoreAction, type AppStoreStatus } from '@/lib/appStore';
import { useStoreActions } from '@/features/app-store/providers/store-actions';
import { preloadFirstFewGalleryImages } from '@/features/app-store/data/gallery-preload';
import type { NammuAppManifest, NammuInstalledApp } from '@/lib/appStore';

interface AppPageContentProps {
  app: NammuAppManifest;
  userApp?: NammuInstalledApp;
  releaseTimeline?: Array<{ version: string; date: string; notes: string }>;
  highlightLatestRelease?: boolean;
  showDependencies?: (dependencyId?: string) => void;
  registryId?: string;
  makeAppPath?: (appId: string) => string;
}

export function AppPageContent({
  app,
  userApp,
  releaseTimeline,
  highlightLatestRelease,
  showDependencies,
  registryId,
  makeAppPath = nammuAppPath,
}: AppPageContentProps) {
  const { t } = useTranslation();
  const actions = useStoreActions();

  const status: AppStoreStatus = userApp
    ? app.version !== userApp.version
      ? 'update-available'
      : 'installed'
    : 'available';

  const action = getAppStoreAction(status, false);

  return (
    <div className='flex flex-col gap-6 md:gap-8'>
      <section className='flex flex-col gap-4' aria-label={t('app-page.section.description')}>
        <h2 className='text-lg font-semibold'>{t('app-page.section.description')}</h2>
        <div className='prose prose-invert max-w-none text-white/70' style={{ lineHeight: 1.7 }}>
          {app.description}
        </div>
      </section>

      {app.gallery.length > 0 && (
        <section className='flex flex-col gap-4' aria-label={t('app-page.section.gallery')}>
          <h2 className='text-lg font-semibold'>{t('app-page.section.gallery')}</h2>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {app.gallery.map((src, index) => (
              <div
                key={src}
                onMouseEnter={() => preloadFirstFewGalleryImages(app)}
                className='relative aspect-video rounded-xl overflow-hidden bg-white/5 group'
              >
                <FadeInImg
                  src={src}
                  alt={`${app.name} screenshot ${index + 1}`}
                  loading='lazy'
                  className='h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]'
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {(app.dependencies?.length ?? 0) > 0 && (
        <section className='flex flex-col gap-4' aria-label={t('app-page.section.dependencies')}>
          <h2 className='text-lg font-semibold'>{t('app-page.section.dependencies')}</h2>
          <div className='flex flex-wrap gap-2'>
            {(app.dependencies ?? []).map((depId) => (
              <button
                key={depId}
                onClick={() => showDependencies?.(depId)}
                className='inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 transition-colors'
              >
                <AppIcon src={''} size={16} className='text-white/40' />
                <span>{depId}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {releaseTimeline && releaseTimeline.length > 0 && (
        <section className='flex flex-col gap-4' aria-label={t('app-page.section.release-history')}>
          <h2 className='text-lg font-semibold'>{t('app-page.section.release-history')}</h2>
          <div className='space-y-3'>
            {releaseTimeline.map((release, index) => (
              <div
                key={release.version}
                className={cn(
                  'flex flex-col gap-2 rounded-xl p-4 transition-colors',
                  'border border-white/5 bg-white/3',
                  highlightLatestRelease && index === 0 && 'border-[#4aa3ff]/30 bg-[#4aa3ff]/5',
                )}
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-mono text-white/50'>{release.date}</span>
                    <span className='px-2 py-0.5 rounded-full bg-white/10 text-xs font-medium text-white/70'>
                      v{release.version}
                    </span>
                    {highlightLatestRelease && index === 0 && (
                      <span className='px-2 py-0.5 rounded-full bg-[#4aa3ff]/20 text-xs font-medium text-[#4aa3ff]'>
                        {t('app-page.latest-release')}
                      </span>
                    )}
                  </div>
                </div>
                <p className='text-sm text-white/60'>{release.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className='flex flex-col gap-4 border-t border-white/5 pt-4' aria-label={t('app-page.section.details')}>
        <h2 className='text-lg font-semibold'>{t('app-page.section.details')}</h2>
        <dl className='grid gap-3 sm:grid-cols-2 text-sm'>
          <div>
            <dt className='text-white/40'>{t('app-page.details.version')}</dt>
            <dd className='font-mono text-white/70'>{app.version}</dd>
          </div>
          <div>
            <dt className='text-white/40'>{t('app-page.details.category')}</dt>
            <dd className='text-white/70'>{app.category}</dd>
          </div>
          {app.developer && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.developer')}</dt>
              <dd className='text-white/70'>{app.developer}</dd>
            </div>
          )}
          {app.website && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.website')}</dt>
              <dd>
                <a href={app.website} target='_blank' rel='noopener noreferrer' className='text-[#4aa3ff] hover:underline'>
                  {app.website}
                </a>
              </dd>
            </div>
          )}
          {app.support && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.support')}</dt>
              <dd>
                <a href={app.support} target='_blank' rel='noopener noreferrer' className='text-[#4aa3ff] hover:underline'>
                  {app.support}
                </a>
              </dd>
            </div>
          )}
          {app.repo && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.repository')}</dt>
              <dd>
                <a href={app.repo} target='_blank' rel='noopener noreferrer' className='text-[#4aa3ff] hover:underline'>
                  {app.repo}
                </a>
              </dd>
            </div>
          )}
          {app.installSize && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.install-size')}</dt>
              <dd className='font-mono text-white/70'>{formatBytes(app.installSize)}</dd>
            </div>
          )}
          {registryId && (
            <div>
              <dt className='text-white/40'>{t('app-page.details.source')}</dt>
              <dd className='font-mono text-white/70'>{registryId}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}