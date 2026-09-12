import AppStoreApp from '@/components/app-store/AppStoreApp';

export default async function AppStoreDetailsPage({ params }: PageProps<'/app-store/[id]'>) {
  const { id } = await params;
  return <AppStoreApp initialAppId={id} />;
}
