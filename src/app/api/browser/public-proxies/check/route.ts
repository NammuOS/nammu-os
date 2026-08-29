import { NextRequest, NextResponse } from 'next/server';
import { checkDiscoveredPublicProxies } from '@/server/browser/publicProxyService';

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const ids =
      body && typeof body === 'object' && Array.isArray((body as { ids?: unknown }).ids)
        ? (body as { ids: unknown[] }).ids.filter((id): id is string => typeof id === 'string')
        : [];
    const targetUrl =
      body &&
      typeof body === 'object' &&
      typeof (body as { targetUrl?: unknown }).targetUrl === 'string'
        ? (body as { targetUrl: string }).targetUrl
        : undefined;

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one discovered proxy ID is required.' },
        { status: 400 },
      );
    }

    const data = await checkDiscoveredPublicProxies(ids, targetUrl);
    return NextResponse.json({ data, checkedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy health check failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
