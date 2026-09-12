import AppPage from '@/features/app-store/components/app-page';
import { ErrorBoundaryCardFallback } from '@/components/ui/error-boundary-card-fallback';

export default function AppPageRoute({ params }: { params: Promise<{ id: string }> }) {
  return <AppPage />;
}