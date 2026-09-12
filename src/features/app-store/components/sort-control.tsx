'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { AppSortId } from '@/lib/appStore';
import { getAvailableSorts } from '@/lib/appStore';
import type { NammuAppDates } from '@/lib/appStore';

export function useSortParam(availableSorts: AppSortId[], dates: Map<string, NammuAppDates> | undefined) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentSort = useMemo(() => {
    const sort = searchParams?.get('sort') as AppSortId | null;
    const validSorts = getAvailableSorts(dates);
    return sort && validSorts.includes(sort) ? sort : 'name';
  }, [searchParams, dates]);

  const setSort = useCallback(
    (sort: AppSortId) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (sort === 'name') {
        params.delete('sort');
      } else {
        params.set('sort', sort);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  return { sort: currentSort, setSort };
}

export function SortControl({ availableSorts }: { availableSorts: AppSortId[] }) {
  const { sort, setSort } = useSortParam(availableSorts, undefined);

  const labels: Record<AppSortId, string> = {
    name: 'Name',
    newest: 'Newest',
    'recently-updated': 'Recently Updated',
  };

  return (
    <select
      value={sort}
      onChange={(e) => setSort(e.target.value as AppSortId)}
      className="os-input text-xs px-2 py-1 min-w-[140px] bg-black/30 border-white/10"
      style={{ colorScheme: 'dark' }}
    >
      {availableSorts.map((s) => (
        <option key={s} value={s}>
          {labels[s]}
        </option>
      ))}
    </select>
  );
}