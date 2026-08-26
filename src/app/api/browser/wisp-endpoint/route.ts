export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || requestUrl.host;
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(':', '');
  const websocketProtocol = protocol === 'https' ? 'wss' : 'ws';

  return new Response(`${websocketProtocol}://${host}/firefox-wisp/`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
