import { createHmac, timingSafeEqual } from 'node:crypto';
import { classifyDesktopRoute } from './desktopRoutePolicy.mjs';

export const DESKTOP_REQUEST_HEADER = 'x-nammu-request';
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const MAX_CLOCK_SKEW_MS = 2_000;
const MAX_TOKEN_LIFETIME_MS = 20_000;
const FORWARDED_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-server',
  'x-real-ip',
];

function singleHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? null : value;
}

function corsHeaders(frontendOrigin) {
  return {
    'Access-Control-Allow-Origin': frontendOrigin,
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function unauthorized(status, error) {
  return { accepted: false, status, error, headers: { 'Cache-Control': 'no-store' } };
}

export function createDesktopRequestGate({
  instanceId,
  apiCapability,
  frontendOrigin,
  now = () => Date.now(),
}) {
  const consumedNonces = new Map();

  function pruneNonces(currentTime) {
    for (const [nonce, expiresAt] of consumedNonces) {
      if (expiresAt < currentTime - MAX_CLOCK_SKEW_MS) consumedNonces.delete(nonce);
    }
  }

  function verifyRequestToken(token, method, pathAndQuery) {
    if (typeof token !== 'string' || token.length > 2_048) return false;
    const segments = token.split('.');
    if (segments.length !== 2 || !segments[0] || !segments[1]) return false;

    let payload;
    let suppliedSignature;
    try {
      payload = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'));
      suppliedSignature = Buffer.from(segments[1], 'base64url');
    } catch {
      return false;
    }

    const expectedSignature = createHmac('sha256', apiCapability).update(segments[0]).digest();
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return false;
    }

    const currentTime = now();
    if (
      payload?.protocolVersion !== 1 ||
      payload?.instanceId !== instanceId ||
      payload?.method !== method ||
      payload?.pathAndQuery !== pathAndQuery ||
      typeof payload?.expiresAt !== 'number' ||
      payload.expiresAt < currentTime - MAX_CLOCK_SKEW_MS ||
      payload.expiresAt > currentTime + MAX_TOKEN_LIFETIME_MS ||
      !NONCE_PATTERN.test(payload?.nonce || '')
    ) {
      return false;
    }

    pruneNonces(currentTime);
    if (consumedNonces.has(payload.nonce)) return false;
    consumedNonces.set(payload.nonce, payload.expiresAt);
    return true;
  }

  return Object.freeze({
    authorize(request, activePort) {
      const expectedHost = `127.0.0.1:${activePort}`;
      if (singleHeader(request.headers, 'host') !== expectedHost) {
        return unauthorized(421, 'Invalid desktop service host.');
      }
      if (FORWARDED_HEADERS.some((header) => request.headers[header] !== undefined)) {
        return unauthorized(400, 'Forwarded requests are not accepted.');
      }

      const requestOrigin = singleHeader(request.headers, 'origin');
      if (requestOrigin !== frontendOrigin) {
        return unauthorized(403, 'Invalid desktop application origin.');
      }

      let url;
      try {
        url = new URL(request.url || '/', `http://${expectedHost}`);
      } catch {
        return unauthorized(400, 'Invalid request target.');
      }
      const route = classifyDesktopRoute(url.pathname);
      if (!route || !route.enabled) return unauthorized(404, 'Desktop route is not enabled.');

      const method = (request.method || 'GET').toUpperCase();
      const requestedMethod =
        method === 'OPTIONS'
          ? singleHeader(request.headers, 'access-control-request-method')?.toUpperCase()
          : method;
      if (!requestedMethod || !route.methods.includes(requestedMethod)) {
        return unauthorized(405, 'Method is not allowed for this desktop route.');
      }

      const responseCorsHeaders = corsHeaders(frontendOrigin);
      if (method === 'OPTIONS') {
        const requestedHeaders = (
          singleHeader(request.headers, 'access-control-request-headers') || ''
        )
          .split(',')
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        const allowedHeaders = new Set([DESKTOP_REQUEST_HEADER, 'content-type']);
        if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
          return unauthorized(403, 'Requested CORS headers are not allowed.');
        }
        return {
          accepted: true,
          preflight: true,
          route,
          status: 204,
          headers: {
            ...responseCorsHeaders,
            'Access-Control-Allow-Headers': `${DESKTOP_REQUEST_HEADER}, content-type`,
            'Access-Control-Allow-Methods': route.methods.join(', '),
            'Access-Control-Max-Age': '0',
          },
        };
      }

      const requestToken = singleHeader(request.headers, DESKTOP_REQUEST_HEADER);
      if (!verifyRequestToken(requestToken, method, request.url || '/')) {
        return {
          ...unauthorized(401, 'Desktop request authorization failed.'),
          headers: responseCorsHeaders,
        };
      }

      return {
        accepted: true,
        preflight: false,
        route,
        status: 200,
        headers: responseCorsHeaders,
      };
    },
  });
}

export function createDesktopRequestTokenForTest(apiCapability, payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', apiCapability).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}
