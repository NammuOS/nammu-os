import { NextRequest, NextResponse } from 'next/server';

type NominatimResult = {
  place_id?: number;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  type?: string;
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) {
    return NextResponse.json(
      { results: [], error: 'Enter at least two characters.' },
      { status: 400 },
    );
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query.slice(0, 160));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '0');
  url.searchParams.set('limit', '6');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': request.headers.get('accept-language') ?? 'en',
        'User-Agent': 'NammuOS-Maps/4.1 (place search)',
      },
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`Place service returned ${response.status}`);
    const data = (await response.json()) as NominatimResult[];
    const results = data.flatMap((place, index) => {
      const latitude = Number(place.lat);
      const longitude = Number(place.lon);
      const displayName = place.display_name?.trim();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !displayName) return [];
      const [first, ...rest] = displayName.split(',').map((part) => part.trim());
      return [
        {
          id: String(place.place_id ?? `${latitude}-${longitude}-${index}`),
          name: place.name?.trim() || first,
          description: rest.join(', ') || displayName,
          latitude,
          longitude,
          type: place.type ?? 'place',
        },
      ];
    });

    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    return NextResponse.json(
      { results: [], error: error instanceof Error ? error.message : 'Place search unavailable' },
      { status: 502 },
    );
  }
}
