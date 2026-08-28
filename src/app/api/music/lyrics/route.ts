import { NextRequest, NextResponse } from 'next/server';

interface LrcLibResult {
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
  trackName?: string;
}

function clean(value: string | null, maxLength: number): string {
  return (value || '').trim().slice(0, maxLength);
}

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function overlap(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let matches = 0;
  for (const word of a) if (b.has(word)) matches += 1;
  return matches / Math.max(a.size, b.size);
}

export async function GET(request: NextRequest) {
  const track = clean(request.nextUrl.searchParams.get('track'), 180);
  const artist = clean(request.nextUrl.searchParams.get('artist'), 180);
  const duration = Math.max(0, Number(request.nextUrl.searchParams.get('duration')) || 0);
  if (!track) return NextResponse.json({ error: 'A track title is required.' }, { status: 400 });

  const query = new URLSearchParams({ track_name: track });
  if (artist) query.set('artist_name', artist);

  try {
    const response = await fetch(`https://lrclib.net/api/search?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Nammu-OS/4.1' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'The lyrics provider is unavailable.' }, { status: 502 });
    }
    const candidates = ((await response.json()) as LrcLibResult[]).filter(
      (item) => item.plainLyrics || item.syncedLyrics || item.instrumental,
    );
    const ranked = candidates
      .map((item) => ({
        item,
        score:
          overlap(track, item.trackName || '') * 4 +
          overlap(artist, item.artistName || '') * 3 -
          (duration && item.duration ? Math.min(2, Math.abs(duration - item.duration) / 15) : 0),
      }))
      .sort((left, right) => right.score - left.score);
    const selected = ranked[0]?.item;
    if (!selected) return NextResponse.json({ data: null });

    return NextResponse.json({
      data: {
        plain: selected.plainLyrics || '',
        synced: selected.syncedLyrics || '',
        instrumental: Boolean(selected.instrumental),
        source: 'LRCLIB',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lyrics lookup failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
