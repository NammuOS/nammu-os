'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { AppIcon } from '@/components/app-icon';
import { nammuAppPath } from '@/lib/appStore';
import type { NammuAppManifest, NammuInstalledApp, NammuAppStateOrLoading } from '@/lib/appStore';
import { getAppStoreAction, type AppStoreStatus } from '@/lib/appStore';
import { useStoreActions } from '@/features/app-store/providers/store-actions';
import { preloadFirstFewGalleryImages } from '@/features/app-store/data/gallery-preload';
import { ProgressButton } from '@/components/progress-button';

interface AppPageHeroProps {
  app: NammuAppManifest;
  userApp?: NammuInstalledApp;
  renderActions: () => React.ReactNode;
}

export function AppPageHero({ app, userApp, renderActions }: AppPageHeroProps) {
  const { t } = useTranslation();
  const actions = useStoreActions();

  const status: AppStoreStatus = userApp
    ? app.version !== userApp.version
      ? 'update-available'
      : 'installed'
    : 'available';

  return (
    <header
      onMouseEnter={() => preloadFirstFewGalleryImages(app)}
      className={cn(
        'relative flex flex-col gap-4 md:flex-row md:items-start md:gap-6',
        'group',
      )}
    >
      <div className='relative flex-shrink-0'>
        <AppIcon src={app.icon} size={96} className='rounded-2xl' />
        {app.optimizedForNammuHome && (
          <span className='absolute bottom-0 right-0 flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400'>
            <span className='h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse' />
            Optimized for Nammu
          </span>
        )}
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-2 md:pt-4'>
        <div className='flex flex-col gap-1'>
          <h1 className='truncate text-2xl leading-tight font-semibold md:text-3xl'>{app.name}</h1>
          <p className='text-base opacity-60 md:text-lg'>{app.tagline}</p>
        </div>
        <div className='flex flex-wrap items-center gap-2 text-sm opacity-50'>
          <span className='flex items-center gap-1'>
            <span className='px-2 py-0.5 rounded-full bg-white/5 text-white/60'>{app.category}</span>
          </span>
          <span className='flex items-center gap-1 text-white/40'>{app.version}</span>
          {app.developer && (
            <span className='flex items-center gap-1 text-white/40'>by {app.developer}</span>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-3 pt-2'>{renderActions()}</div>
      </div>
    </header>
  );
}

interface InstallButtonProps {
  app: NammuAppManifest;
  userApp?: NammuInstalledApp;
  state?: NammuAppStateOrLoading;
}

export function InstallButton({ app, userApp, state = 'not-installed' }: InstallButtonProps) {
  const { t } = useTranslation();
  const actions = useStoreActions();

  const status: AppStoreStatus = userApp
    ? app.version !== userApp.version
      ? 'update-available'
      : 'installed'
    : 'available';

  const action = getAppStoreAction(status, false);

  const onClick = () => {
    switch (action) {
      case 'install':
        return actions?.installApp(app);
      case 'open':
        return actions?.openApp(app.id);
      case 'update':
        return actions?.updateApp(app);
    }
  };

  const labels = {
    install: t('app.install'),
    open: t('app.open'),
    update: t('app-updates.update'),
  };

  if (!action) return null;

  return (
    <ProgressButton
      size='md'
      state={state}
      onClick={onClick}
      className={cn(
        action === 'install'
          ? 'bg-[#4aa3ff]/15 border border-[#4aa3ff]/30 text-[#4aa3ff] hover:bg-[#4aa3ff]/25 hover:border-[#4aa3ff]/50'
          : action === 'open'
            ? 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20'
            : 'bg-[#4aa3ff]/15 border border-[#4aa3ff]/30 text-[#4aa3ff] hover:bg-[#4aa3ff]/25 hover:border-[#4aa3ff]/50',
      )}
    >
      {labels[action]}
    </ProgressButton>
  );
}