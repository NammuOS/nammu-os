import AppStoreLayout from '@/features/app-store';
import { ReactNode, Suspense } from 'react';
import { Loading } from '@/components/ui/loading';

export default function AppStoreLayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <AppStoreLayout>{children}</AppStoreLayout>
    </Suspense>
  );
}