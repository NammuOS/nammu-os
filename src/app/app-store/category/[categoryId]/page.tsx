import Category from '@/features/app-store/components/category';
import { ErrorBoundaryCardFallback } from '@/components/ui/error-boundary-card-fallback';

export default function CategoryPage({ params }: { params: Promise<{ categoryId: string }> }) {
  return <Category />;
}