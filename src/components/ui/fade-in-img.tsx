'use client';

import { useState } from 'react';
import { cn } from '@/utils/cn';

interface FadeInImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  fallback?: React.ReactNode;
}

export function FadeInImg({ className, fallback, onLoad, onError, ...props }: FadeInImgProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {!loaded && !error && (
        <div
          className='absolute inset-0 animate-pulse bg-linear-to-r from-white/5 via-white/10 to-white/5'
          aria-hidden='true'
        />
      )}
      <img
        {...props}
        onLoad={(e) => {
          setLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          setError(true);
          onError?.(e);
        }}
        className={cn('transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0', className)}
      />
      {error && fallback && <div className='absolute inset-0 flex items-center justify-center'>{fallback}</div>}
    </div>
  );
}