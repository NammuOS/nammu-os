'use client';

import { cn } from '@/utils/cn';

interface AppIconProps {
  src: string;
  size?: number;
  className?: string;
  fallback?: React.ReactNode;
}

export function AppIcon({ src, size = 32, className, fallback }: AppIconProps) {
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <div
        className={cn('flex items-center justify-center bg-white/5 rounded-xl', className)}
        style={{ width: size, height: size }}
      >
        {fallback || (
          <svg
            width={size * 0.5}
            height={size * 0.5}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-white/30"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn('rounded-xl object-cover', className)}
      style={{ width: size, height: size }}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}

import React from 'react';