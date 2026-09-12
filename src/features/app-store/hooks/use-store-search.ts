'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { appStoreSearchQueryOptions } from '@/features/app-store/data/query-options';
import { useQuery } from '@tanstack/react-query';
import type { NammuAppManifest } from '@/lib/appStore';

export function useStoreSearch() {
  const searchParams = useSearchParams();
  const [deferredQuery, setDeferredQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);

  const queryFromUrl = searchParams?.get('q') ?? '';
  const effectiveQuery = deferredQuery || queryFromUrl;

  const { data: results, isLoading, error } = useQuery(
    appStoreSearchQueryOptions(effectiveQuery, 50),
  );

  const startSearch = useCallback((query: string) => {
    setDeferredQuery(query.trim());
    setIsSearching(true);
  }, []);

  const clearSearch = useCallback(() => {
    setDeferredQuery('');
    setIsSearching(false);
  }, []);

  useEffect(() => {
    if (deferredQuery === '' && queryFromUrl === '') {
      setIsSearching(false);
    }
  }, [deferredQuery, queryFromUrl]);

  return {
    query: effectiveQuery,
    deferredQuery,
    results: results as NammuAppManifest[] | undefined,
    isLoading,
    isSearching,
    error,
    startSearch,
    clearSearch,
  };
}