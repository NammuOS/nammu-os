import StandaloneWindowContent from '@/components/desktop/StandaloneWindowContent';

export default async function StandaloneAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StandaloneWindowContent kind="app" id={id} />;
}
