import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type NetworkLocationResponse = {
  success?: boolean;
  message?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  country?: string;
};

const getClientIp = (request: NextRequest) => {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    forwarded,
  ];
  return candidates.find((candidate) => candidate && isIP(candidate)) ?? null;
};

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const endpoint = new URL(clientIp ? `/${clientIp}` : '/', 'https://ipwho.is');

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Location service returned ${response.status}`);

    const data = (await response.json()) as NetworkLocationResponse;
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (data.success === false || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(data.message || 'Network location is unavailable');
    }

    const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
    return NextResponse.json(
      {
        latitude,
        longitude,
        accuracy: 25000,
        label: label || 'Approximate network location',
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Network location is unavailable' },
      { status: 502 },
    );
  }
}
