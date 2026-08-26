import StandaloneWindowContent from '@/components/desktop/StandaloneWindowContent';

export default async function StandaloneToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StandaloneWindowContent kind="tool" id={id} />;
}
