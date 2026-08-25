import { NextRequest, NextResponse } from 'next/server';

type CrtNameEntry = {
  sub?: string;
  first_seen?: string | null;
};

type SubdomainEntry = {
  name: string;
  firstSeen: string | null;
  depth: number;
  wildcard: boolean;
};

const MAX_RESULTS = 50000;

const normalizeDomain = (input: string) => {
  const value = input.trim().toLowerCase();
  if (!value || value.length > 2048) return null;

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    let hostname = url.hostname.replace(/^\*\./, '').replace(/\.$/, '');
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    const labels = hostname.split('.');
    const valid =
      hostname.length <= 253 &&
      labels.length >= 2 &&
      labels.every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          /^[a-z0-9-]+$/.test(label) &&
          !label.startsWith('-') &&
          !label.endsWith('-'),
      );
    return valid ? hostname : null;
  } catch {
    return null;
  }
};

const normalizeDate = (value: string | null | undefined) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

export async function GET(request: NextRequest) {
  const domain = normalizeDomain(request.nextUrl.searchParams.get('domain') ?? '');
  if (!domain) {
    return NextResponse.json(
      { error: 'Enter a valid public domain, such as example.com.' },
      { status: 400 },
    );
  }

  const endpoint = new URL('/v1/search', 'https://crt.name');
  endpoint.searchParams.set('apex', domain);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('dates', '1');
  const startedAt = performance.now();

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NammuOS/4.1 (passive subdomain discovery)',
      },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });

    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      const message =
        response.status === 429
          ? 'The crt.name daily request limit has been reached. Try again later.'
          : `Certificate index returned ${response.status}.`;
      return NextResponse.json({ error: message }, { status });
    }

    const payload = (await response.json()) as CrtNameEntry[];
    if (!Array.isArray(payload)) throw new Error('Certificate index returned an invalid response.');

    const domainSuffix = `.${domain}`;
    const unique = new Map<string, SubdomainEntry>();
    for (const item of payload) {
      const rawName = item.sub?.trim().toLowerCase().replace(/\.$/, '');
      if (!rawName) continue;
      const wildcard = rawName.startsWith('*.');
      const name = wildcard ? rawName.slice(2) : rawName;
      if (name === domain || !name.endsWith(domainSuffix)) continue;
      if (!name.split('.').every((label) => /^[a-z0-9-]{1,63}$/.test(label))) continue;

      const firstSeen = normalizeDate(item.first_seen);
      const existing = unique.get(name);
      if (!existing) {
        unique.set(name, {
          name,
          firstSeen,
          depth: name.split('.').length - domain.split('.').length,
          wildcard,
        });
        continue;
      }

      existing.wildcard ||= wildcard;
      if (firstSeen && (!existing.firstSeen || firstSeen < existing.firstSeen)) {
        existing.firstSeen = firstSeen;
      }
    }

    const allResults = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    const results = allResults.slice(0, MAX_RESULTS);
    return NextResponse.json(
      {
        domain,
        results,
        stats: {
          total: allResults.length,
          dated: allResults.filter((item) => item.firstSeen).length,
          wildcard: allResults.filter((item) => item.wildcard).length,
          maxDepth: allResults.reduce((maximum, item) => Math.max(maximum, item.depth), 0),
          elapsedMs: Math.round(performance.now() - startedAt),
        },
        truncated: allResults.length > MAX_RESULTS,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'TimeoutError'
        ? 'Certificate index timed out. Try the search again.'
        : error instanceof Error
          ? error.message
          : 'Subdomain discovery is unavailable.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
