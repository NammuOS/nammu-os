import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'url parameter is required' }, { status: 400 });
  }

  const cacheKey = `proxy_cache:${url}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      return new NextResponse(data.body, {
        status: data.status,
        headers: {
          'Content-Type': data.contentType || 'text/html',
          'X-Cache': 'HIT',
        },
      });
    } catch {}
  }

  try {
    const upstreamRes = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 NammuOS/4.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    const contentType = upstreamRes.headers.get('content-type') || 'text/html';
    const body = await upstreamRes.text();

    await redis.set(
      cacheKey,
      JSON.stringify({ status: upstreamRes.status, contentType, body }),
      120,
    );

    return new NextResponse(body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': contentType,
        'X-Cache': 'MISS',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
