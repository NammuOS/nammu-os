'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  search: ReturnType<typeof import('@/features/app-store/hooks/use-store-search').useStoreSearch>;
}

export function SearchInput({ search }: SearchInputProps) {
  const { t } = useTranslation();

  return (
    <div className='relative flex-1 max-w-md'>
      <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 pointer-events-none' />
      <input
        type='search'
        value={search.deferredQuery}
        onChange={(e) => search.startSearch(e.target.value)}
        onFocus={() => search.startSearch(search.deferredQuery)}
        placeholder={t('app-store.search.placeholder')}
        className={cn(
          'w-full h-10 rounded-full bg-white/5 border border-white/10 px-10 py-0 text-sm text-white placeholder-white/40',
          'focus:outline-none focus:border-[#4aa3ff]/50 focus:ring-2 focus:ring-[#4aa3ff]/20',
          'transition-all duration-200',
        )}
      />
      {search.deferredQuery && (
        <button
          onClick={search.clearSearch}
          className='absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition-colors'
          aria-label={t('app-store.search.clear')}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}