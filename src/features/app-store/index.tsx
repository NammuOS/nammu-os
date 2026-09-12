'use client';

import { useState, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SearchResults } from '@/features/app-store/components/search-results';
import { StoreHeader } from '@/features/app-store/components/store-header';
import { UpdatesShelf } from '@/features/app-store/components/updates-shelf';
import Discover from '@/features/app-store/components/discover';
import Category from '@/features/app-store/components/category';
import { nammuCategoryPath, NAMMU_DISCOVER_PATH } from '@/lib/appStore';
import { useStoreSearch } from '@/features/app-store/hooks/use-store-search';
import { StoreActionsProvider } from '@/features/app-store/providers/store-actions';
import { ReactNode } from 'react';

type AppStorePage = 'discover' | 'category' | 'search';

interface AppStoreState {
  page: AppStorePage;
  categoryId?: string;
  searchQuery?: string;
}

interface AppStoreLayoutProps {
  children?: ReactNode;
}

export default function AppStoreLayout({ children }: AppStoreLayoutProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = useStoreSearch();

  const [state, setState] = useState<AppStoreState>(() => {
    if (pathname === NAMMU_DISCOVER_PATH) return { page: 'discover' };
    if (pathname.startsWith('/app-store/category/')) {
      return { page: 'category', categoryId: pathname.split('/app-store/category/')[1] };
    }
    return { page: 'discover' };
  });

  // Update state when pathname changes
  useMemo(() => {
    if (pathname === NAMMU_DISCOVER_PATH) setState({ page: 'discover' });
    else if (pathname.startsWith('/app-store/category/')) {
      setState({ page: 'category', categoryId: pathname.split('/app-store/category/')[1] });
    }
  }, [pathname]);

  // Handle search
  const isSearching = search.deferredQuery && search.deferredQuery.trim().length > 0;
  const displayState = isSearching ? { page: 'search' as const, searchQuery: search.deferredQuery } : state;

  const renderContent = () => {
    // If there are children (from nested routes), render them
    if (children && !isSearching && displayState.page === 'discover' && pathname === NAMMU_DISCOVER_PATH) {
      return children;
    }
    switch (displayState.page) {
      case 'search':
        return <SearchResults query={displayState.searchQuery!} />;
      case 'category':
        return <Category categoryId={displayState.categoryId} />;
      case 'discover':
      default:
        return <Discover />;
    }
  };

  const showUpdatesShelf = !isSearching && (state.page === 'discover' || (state.page === 'category' && state.categoryId === 'all'));

  return (
    <StoreActionsProvider>
      <div className='flex flex-col gap-4 md:gap-5 h-full'>
        <StoreHeader search={search} isOwner={false} />
        <div className='flex-1 overflow-auto flex flex-col gap-4 md:gap-5'>
          {showUpdatesShelf && <UpdatesShelf />}
          <div key={isSearching ? 'search' : state.page + (state.categoryId || '')} className='flex flex-col gap-4 md:gap-5 flex-1'>
            {renderContent()}
          </div>
        </div>
      </div>
    </StoreActionsProvider>
  );
}