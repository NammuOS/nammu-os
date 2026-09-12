'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryCardFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
  fallback?: React.ReactNode;
}

export function ErrorBoundaryCardFallback({ error, resetErrorBoundary, fallback }: ErrorBoundaryCardFallbackProps) {
  const { t } = useTranslation();

  if (fallback) return <>{fallback}</>;

  const errorMessage = error instanceof Error ? error.message : String(error);

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 p-6 text-center', 'rounded-xl border border-white/5 bg-white/3')}>
      <AlertTriangle size={32} className='text-amber-400' />
      <div className='flex flex-col gap-1'>
        <p className='text-base font-medium text-white/80'>{t('error-boundary.something-went-wrong')}</p>
        <p className='text-sm text-white/40 font-mono'>{errorMessage}</p>
      </div>
      <button
        onClick={resetErrorBoundary}
        className='mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 transition-colors'
      >
        <RefreshCw size={14} />
        {t('error-boundary.try-again')}
      </button>
    </div>
  );
}