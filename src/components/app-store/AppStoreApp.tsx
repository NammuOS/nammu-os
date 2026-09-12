'use client';

import { useState, useEffect } from 'react';
import { AvailableAppsProvider } from '@/features/app-store/providers/available-apps';
import AppStoreLayout from '@/features/app-store';
import { ErrorBoundaryCardFallback } from '@/components/ui/error-boundary-card-fallback';
import { ErrorBoundary } from 'react-error-boundary';
import { StoreActionsProvider } from '@/features/app-store/providers/store-actions';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

interface ErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

function AppStoreErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  return <ErrorBoundaryCardFallback error={error} resetErrorBoundary={resetErrorBoundary} />;
}

export function AppStoreApp() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [internalPath, setInternalPath] = useState<string>('/app-store');

  // Sync with actual pathname on mount
  useEffect(() => {
    if (pathname.startsWith('/app-store')) {
      setInternalPath(pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : ''));
    }
  }, [pathname, searchParams]);

  const navigate = (path: string) => {
    setInternalPath(path);
    router.push(path);
  };

  return (
    <AvailableAppsProvider>
      <StoreActionsProvider>
        <div className="nammu-app-surface h-full min-h-0 w-full overflow-hidden" data-nammu-app="app-store">
          <ErrorBoundary fallback={AppStoreErrorFallback as unknown as React.ReactNode}>
            <AppStoreWindowContent currentPath={internalPath} onNavigate={navigate} />
          </ErrorBoundary>
        </div>
      </StoreActionsProvider>
    </AvailableAppsProvider>
  );
}

export default AppStoreApp;

function AppStoreWindowContent({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  // Parse the current path to determine what to render
  const isAppPage = currentPath.match(/^\/app-store\/([^/]+)$/);
  const isCategoryPage = currentPath.match(/^\/app-store\/category\/([^/]+)/);
  const isSearch = currentPath.includes('?q=') || currentPath.includes('?search=');

  return (
    <AppStoreLayout>
      {/* The AppStoreLayout will render the appropriate content based on the URL */}
    </AppStoreLayout>
  );
}