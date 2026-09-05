import { describe, expect, test } from 'bun:test';
import {
  createDesktopRequestGate,
  createDesktopRequestTokenForTest,
} from '../src/server/runtime/desktopSecurity.mjs';

const instanceId = 'a'.repeat(32);
const apiCapability = 'b'.repeat(64);
const foreignCapability = 'c'.repeat(64);
const frontendOrigin = 'http://127.0.0.1:1420';
const now = 1_800_000_000_000;

function request(
  overrides: Partial<{ method: string; url: string; headers: Record<string, string> }> = {},
) {
  return {
    method: 'GET',
    url: '/api/health',
    ...overrides,
    headers: {
      host: '127.0.0.1:43127',
      origin: frontendOrigin,
      ...overrides.headers,
    },
  };
}

function token(secret = apiCapability, overrides: Record<string, unknown> = {}) {
  return createDesktopRequestTokenForTest(secret, {
    protocolVersion: 1,
    instanceId,
    method: 'GET',
    pathAndQuery: '/api/health',
    expiresAt: now + 10_000,
    nonce: 'd'.repeat(32),
    ...overrides,
  });
}

describe('desktop local request security', () => {
  test('requires exact Host and frontend Origin and rejects forwarding metadata', () => {
    const gate = createDesktopRequestGate({
      instanceId,
      apiCapability,
      frontendOrigin,
      now: () => now,
    });
    expect(gate.authorize(request({ headers: { host: 'localhost:43127' } }), 43127).status).toBe(
      421,
    );
    expect(
      gate.authorize(request({ headers: { origin: 'http://evil.example' } }), 43127).status,
    ).toBe(403);
    expect(
      gate.authorize(request({ headers: { 'x-forwarded-host': 'evil.example' } }), 43127).status,
    ).toBe(400);
  });

  test('allows narrow CORS preflight without wildcard or credential mode', () => {
    const gate = createDesktopRequestGate({
      instanceId,
      apiCapability,
      frontendOrigin,
      now: () => now,
    });
    const result = gate.authorize(
      request({
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-nammu-request',
        },
      }),
      43127,
    );
    const responseHeaders = result.headers as Record<string, string>;
    expect(result.accepted).toBe(true);
    expect(result.status).toBe(204);
    expect(responseHeaders['Access-Control-Allow-Origin']).toBe(frontendOrigin);
    expect(responseHeaders['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  test('accepts a one-time API proof and rejects replay or a foreign capability', () => {
    const gate = createDesktopRequestGate({
      instanceId,
      apiCapability,
      frontendOrigin,
      now: () => now,
    });
    const authorizedRequest = request({ headers: { 'x-nammu-request': token() } });
    expect(gate.authorize(authorizedRequest, 43127).accepted).toBe(true);
    expect(gate.authorize(authorizedRequest, 43127).status).toBe(401);

    const separateGate = createDesktopRequestGate({
      instanceId,
      apiCapability,
      frontendOrigin,
      now: () => now,
    });
    expect(
      separateGate.authorize(
        request({ headers: { 'x-nammu-request': token(foreignCapability) } }),
        43127,
      ).status,
    ).toBe(401);
  });

  test('binds proofs to the exact method and target and denies disabled or unknown routes', () => {
    const gate = createDesktopRequestGate({
      instanceId,
      apiCapability,
      frontendOrigin,
      now: () => now,
    });
    expect(
      gate.authorize(
        request({
          url: '/api/health?detail=1',
          headers: { 'x-nammu-request': token(apiCapability, { pathAndQuery: '/api/health' }) },
        }),
        43127,
      ).status,
    ).toBe(401);
    expect(gate.authorize(request({ url: '/api/browser/proxy' }), 43127).status).toBe(404);
    expect(gate.authorize(request({ url: '/api/unreviewed' }), 43127).status).toBe(404);
  });
});
