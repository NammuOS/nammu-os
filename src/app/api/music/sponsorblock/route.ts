import { NextRequest, NextResponse } from 'next/server';

const CATEGORIES = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'music_offtopic'];

interface SponsorBlockSegment {
  category?: string;
  segment?: [number, number];
}

export async function GET(request: NextRequest) {
  const videoId = (request.nextUrl.searchParams.get('videoId') || '').trim();
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return NextResponse.json({ error: 'A valid video ID is required.' }, { status: 400 });
  }
  const query = new URLSearchParams({
    videoID: videoId,
    categories: JSON.stringify(CATEGORIES),
  });
  try {
    const response = await fetch(`https://sponsor.ajay.app/api/skipSegments?${query}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 3600 },
    });
    if (response.status === 404) return NextResponse.json({ data: [] });
    if (!response.ok) {
      return NextResponse.json({ error: 'SponsorBlock is unavailable.' }, { status: 502 });
    }
    const payload = (await response.json()) as SponsorBlockSegment[];
    const data = payload
      .filter(
        (item): item is SponsorBlockSegment & { segment: [number, number] } =>
          Array.isArray(item.segment) &&
          item.segment.length === 2 &&
          Number.isFinite(item.segment[0]) &&
          Number.isFinite(item.segment[1]) &&
          item.segment[1] > item.segment[0],
      )
      .sort((left, right) => left.segment[0] - right.segment[0]);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SponsorBlock lookup failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
