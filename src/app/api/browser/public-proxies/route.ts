import { NextRequest, NextResponse } from 'next/server';
import { getDiscoveredPublicProxies } from '@/server/browser/publicProxyService';
import type { PublicProxyProtocol } from '@/components/browser/services/publicProxy';

const PROTOCOLS = new Set<PublicProxyProtocol>(['http', 'https', 'socks4', 'socks5']);

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    const requestedProtocol = query.get('protocol')?.toLowerCase() as
      PublicProxyProtocol | undefined;
    const country = query.get('country')?.toUpperCase();
    const refresh = query.get('refresh') === '1';
    const requestedLimit = Number(query.get('limit') || 80);
    const limit = Number.isFinite(requestedLimit) ? Math.min(160, Math.max(1, requestedLimit)) : 80;

    let proxies = await getDiscoveredPublicProxies({ refresh });
    if (requestedProtocol && PROTOCOLS.has(requestedProtocol)) {
      proxies = proxies.filter((proxy) => proxy.protocol === requestedProtocol);
    }
    const countries = [...new Set(proxies.map((proxy) => proxy.countryCode))].sort();
    if (country && /^[A-Z]{2}$/.test(country)) {
      proxies = proxies.filter((proxy) => proxy.countryCode === country);
    }

    return NextResponse.json(
      {
        data: proxies.slice(0, limit),
        countries,
        total: proxies.length,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy discovery failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
