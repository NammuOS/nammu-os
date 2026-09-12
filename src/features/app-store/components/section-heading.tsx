'use client';

import { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export function SectionHeading({
  overline,
  title,
  subtitle,
  rightChildren,
  className,
}: {
  overline?: string;
  title: ReactNode;
  subtitle?: string;
  rightChildren?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        {overline && <p className='text-xs font-medium text-white/40 uppercase tracking-wider'>{overline}</p>}
        <h2 className='text-xl leading-tight font-semibold -tracking-2 md:text-2xl'>{title}</h2>
        {subtitle && <p className='text-sm text-white/50'>{subtitle}</p>}
      </div>
      {rightChildren && <div className='shrink-0 mt-2 sm:mt-0'>{rightChildren}</div>}
    </div>
  );
}