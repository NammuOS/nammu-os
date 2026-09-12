'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { AppCard } from './app-card';
import { cn } from '@/utils/cn';
import { nammuAppPath, storeRevealClass, storeRevealDelay, appGridClass } from '@/lib/appStore';
import type { AppStoreStatus, NammuAppManifest } from '@/lib/appStore';
import { useAppCardStateMap } from '@/features/app-store/hooks/use-app-status';

interface VirtualAppGridProps {
  apps: readonly NammuAppManifest[];
  statuses?: Map<string, AppStoreStatus>;
  revealDelayStart?: number;
  itemHeight?: number;
  overscan?: number;
}

export function VirtualAppGrid({
  apps,
  statuses,
  revealDelayStart,
  itemHeight = 80,
  overscan = 5,
}: VirtualAppGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const appStates = useAppCardStateMap(apps);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(apps.length, startIndex + visibleCount);
  const visibleApps = apps.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const stagger = revealDelayStart !== undefined;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(appGridClass, 'h-full overflow-y-auto os-scrollbar')}
      style={{ height: '100%' }}
    >
      <div style={{ height: apps.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleApps.map((app, index) => {
            const actionState = appStates.get(app.id);
            const actualIndex = startIndex + index;
            return (
              <AppCard
                key={app.id}
                app={app}
                status={statuses?.get(app.id)}
                lifecycleState={actionState?.state}
                progress={actionState?.progress}
                className={stagger ? storeRevealClass : undefined}
                style={{
                  ...(stagger ? storeRevealDelay(revealDelayStart! + Math.min(actualIndex * 12, 240)) : {}),
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}