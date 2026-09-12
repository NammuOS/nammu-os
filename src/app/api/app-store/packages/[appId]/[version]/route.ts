import { createHash } from 'node:crypto';
import { OFFICIAL_NAMMU_REGISTRY } from '@/platform/store/storeRegistry';

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ appId: string; version: string }> },
) {
  const { appId, version } = await params;
  const app = OFFICIAL_NAMMU_REGISTRY.apps.find(
    (candidate) => candidate.id === appId && candidate.release.version === version,
  );
  if (!app) return Response.json({ error: 'Store release not found.' }, { status: 404 });

  try {
    const source = new URL(app.release.packageUrl);
    if (source.protocol !== 'https:' || source.username || source.password || source.hash) {
      return Response.json({ error: 'Store release source is invalid.' }, { status: 503 });
    }
    const upstream = await fetch(source, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      return Response.json({ error: 'Store release is currently unavailable.' }, { status: 502 });
    }
    if (upstream.url && new URL(upstream.url).protocol !== 'https:') {
      return Response.json({ error: 'Store release redirect was rejected.' }, { status: 502 });
    }
    const declaredLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_BYTES) {
      return Response.json({ error: 'Store release exceeds the download limit.' }, { status: 413 });
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) {
      return Response.json({ error: 'Store release is empty or too large.' }, { status: 502 });
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== app.release.sha256) {
      return Response.json({ error: 'Store release integrity validation failed.' }, { status: 502 });
    }
    return new Response(Uint8Array.from(bytes).buffer, {
      headers: {
        'Content-Type': 'application/vnd.nammu.app',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Nammu-Package-SHA256': digest,
      },
    });
  } catch {
    return Response.json({ error: 'Store release download failed safely.' }, { status: 502 });
  }
}
