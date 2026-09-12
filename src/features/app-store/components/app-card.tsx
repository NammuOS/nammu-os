'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { cn } from '@/utils/cn';
import { AppIcon } from '@/components/app-icon';
import { ProgressButton } from '@/components/progress-button';
import { nammuAppPath, getAppStoreAction, type AppStoreStatus } from '@/lib/appStore';
import { preloadFirstFewGalleryImages } from '@/features/app-store/data/gallery-preload';
import { useStoreActions } from '@/features/app-store/providers/store-actions';
import type { NammuAppManifest, NammuAppStateOrLoading } from '@/lib/appStore';

const inProgressStates = ['installing', 'uninstalling', 'updating', 'starting', 'restarting', 'stopping'] as const;

export function AppCard({
  app,
  status,
  lifecycleState,
  progress,
  to,
  className,
  style,
}: {
  app: NammuAppManifest;
  status?: AppStoreStatus;
  lifecycleState?: NammuAppStateOrLoading;
  progress?: number;
  to?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();

  return (
    <div
      onMouseEnter={() => preloadFirstFewGalleryImages(app)}
      style={style}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl p-2.5 transition-colors duration-200 focus-within:bg-white/5 hover:bg-white/5',
        className,
      )}
    >
      <Link
        href={to ?? nammuAppPath(app.id)}
        aria-label={app.name}
        className='absolute inset-0 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/30'
      />
      <AppIcon src={app.icon} className='pointer-events-none relative size-12 rounded-xl md:size-14' />
      <div className='pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5'>
        <h3 className='truncate text-base leading-tight font-semibold md:text-lg'>{app.name}</h3>
        <p className='line-clamp-2 w-full min-w-0 text-sm leading-tight opacity-40 md:text-base'>{app.tagline}</p>
      </div>
      <AppCardAction app={app} status={status} lifecycleState={lifecycleState} progress={progress} />
    </div>
  );
}

const cardActionClass = 'relative z-10 h-7 shrink-0 rounded-full border-0 bg-white/10 px-3 text-xs shadow-none hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-white/25';

export function AppCardAction({
  app,
  status,
  lifecycleState,
  progress,
}: {
  app: NammuAppManifest;
  status?: AppStoreStatus;
  lifecycleState?: NammuAppStateOrLoading;
  progress?: number;
}) {
  const { t } = useTranslation();
  const actions = useStoreActions();

  if (!status || !actions) return null;

  const state = lifecycleState ?? (status === 'available' || status === 'incompatible' ? 'not-installed' : 'ready');
  const transitioning = inProgressStates.includes(state as typeof inProgressStates[number]);
  const showProgress = transitioning && ['installing', 'updating'].includes(state) && progress !== undefined;
  const candidateAction = getAppStoreAction(status, transitioning);
  const appIdConflict = actions.isAppIdAmbiguous(app.id) && (candidateAction === 'install' || candidateAction === 'update');
  const action = appIdConflict
    ? undefined
    : candidateAction === 'update' && !transitioning
      ? undefined
      : candidateAction;

  const label = transitioning
    ? `${state}...`
    : status === 'in-progress'
      ? `${t('app-store.status.in-progress')}...`
      : {
          available: t('app.install'),
          incompatible: t('app.install'),
          installed: t('app.open'),
          'update-available': t('app-updates.update'),
        }[status];

  const onClick = () => {
    switch (action) {
      case 'install':
        return actions.installApp(app);
      case 'open':
        return actions.openApp(app.id);
      case 'update':
        return actions.updateApp(app);
      case undefined:
        return;
    }
  };

  return (
    <span
      className='relative z-10 shrink-0'
      title={appIdConflict ? t('app-store.app-id-conflict') : undefined}
      tabIndex={appIdConflict ? 0 : undefined}
    >
      <ProgressButton
        size='sm'
        state={!transitioning && ['available', 'incompatible'].includes(status) ? 'not-installed' : state}
        progress={progress}
        onClick={onClick}
        disabled={!action}
        className={cardActionClass}
      >
        {label}
        {showProgress && (
          <span className='ml-1 inline-block w-[4ch] text-right opacity-60'>{Math.round(progress)}%</span>
        )}
      </ProgressButton>
    </span>
  );
}

export function AppCardCompact({ app, status }: { app: NammuAppManifest; status?: AppStoreStatus }) {
  const { t } = useTranslation();

  return (
    <Link
      href={nammuAppPath(app.id)}
      onMouseEnter={() => preloadFirstFewGalleryImages(app)}
      className='group relative flex w-[140px] shrink-0 flex-col items-center gap-2.5 rounded-2xl p-4 pt-5 outline-hidden focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/30 md:w-[164px]'
    >
      <div
        aria-hidden
        className='absolute inset-0 overflow-hidden rounded-2xl bg-white/5 transition-colors duration-300 group-hover:bg-white/8'
      >
        <div className='absolute top-4 left-1/2 isolate h-20 w-20 -translate-x-1/2 scale-125 opacity-30 blur-xl transition-opacity duration-500 group-hover:opacity-45'>
          <div className='absolute inset-0 bg-neutral-400' />
          <img src={app.icon} alt='' className='absolute inset-0 h-full w-full mix-blend-color' draggable={false} />
        </div>
      </div>
      <div className='relative flex flex-col items-center gap-2'>
        <AppIcon
          src={app.icon}
          size={72}
          className='rounded-xl transition-transform duration-300 group-hover:scale-[1.05]'
        />
        <div aria-hidden className='pointer-events-none absolute top-[72px] left-1/2 h-12 w-[72px] -translate-x-1/2'>
          <div className='origin-[50%_40px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)] opacity-10 blur-[2px] transition-transform duration-300 group-hover:scale-[1.05]'>
            <AppIcon src={app.icon} size={72} className='-scale-y-100 rounded-xl' />
          </div>
        </div>
        <div className='relative flex w-full min-w-0 flex-col items-center gap-0.5 pt-0.5 text-center'>
          <h3 className='w-full truncate text-sm leading-tight font-semibold md:text-base'>{app.name}</h3>
          <AppStatusLabel
            status={status && status !== 'available' && status !== 'incompatible' ? status : undefined}
            fallback={<span className='w-full truncate text-xs opacity-35'>{app.developer?.toString() || 'Unknown'}</span>}
          />
        </div>
      </div>
    </Link>
  );
}

export function AppStatusLabel({
  status,
  className,
  fallback,
}: {
  status?: AppStoreStatus;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const { t } = useTranslation();

  if (!status || status === 'available') return fallback ? <>{fallback}</> : null;

  const labelClass = cn('text-xs leading-tight font-medium whitespace-nowrap', className);

  switch (status) {
    case 'installed':
      return <span className={cn(labelClass, 'text-white/35')}>{t('app.installed')}</span>;
    case 'update-available':
      return <span className={cn(labelClass, 'text-[#4aa3ff]')}>{t('app-store.status.update-available')}</span>;
    case 'in-progress':
      return <span className={cn(labelClass, 'animate-pulse text-white/50')}>{t('app-store.status.in-progress')}</span>;
    case 'incompatible':
      return <span className={cn(labelClass, 'text-white/30')}>{t('app-store.status.incompatible')}</span>;
  }
}

export function AppChip({ app, className }: { app: NammuAppManifest; className?: string }) {
  return (
    <Link
      href={nammuAppPath(app.id)}
      onMouseEnter={() => preloadFirstFewGalleryImages(app)}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full bg-black/35 py-1.5 pr-3 pl-1.5 outline-hidden backdrop-blur-md transition-colors duration-200 hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-[#4aa3ff]/40',
        className,
      )}
    >
      <AppIcon src={app.icon} size={22} className='rounded-lg' />
      <span className='text-sm font-medium whitespace-nowrap text-white/90'>{app.name}</span>
    </Link>
  );
}

export function AppStoreEmptyState({ title, description }: { title: string; description?: string }) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col items-center justify-center gap-3 px-6 py-12 text-center'>
      <div className='text-4xl'>📦</div>
      <p className='text-lg font-semibold text-white/80'>{title || t('app-store.search.no-results')}</p>
      {description && <p className='max-w-sm text-sm text-white/40'>{description}</p>}
    </div>
  );
}