import { afterEach, describe, expect, test } from 'bun:test';

import {
  createDesktopGoogleOAuthManager,
  GOOGLE_DESKTOP_OAUTH_SCOPE,
} from '../src/server/runtime/desktopGoogleOAuth.mjs';

const CLIENT_ID = '1234567890-native.apps.googleusercontent.com';
const CLIENT_SECRET = 'desktop-client-metadata-for-test';
const managers: Array<{ close(): void }> = [];

afterEach(() => {
  while (managers.length) managers.pop()?.close();
});

describe('desktop Google OAuth', () => {
  test('uses PKCE S256, a dynamic numeric loopback callback, and a one-time state', async () => {
    let tokenRequest = new URLSearchParams();
    const manager = createDesktopGoogleOAuthManager({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      instanceId: 'a'.repeat(32),
      fetchImplementation: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        tokenRequest = new URLSearchParams(String(init?.body));
        return new Response(
          JSON.stringify({
            access_token: 'access-token-for-test',
            refresh_token: 'refresh-token-for-test',
            expires_in: 3600,
            scope: GOOGLE_DESKTOP_OAUTH_SCOPE,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
      completeAuthorization: async () => ({
        account: { id: 'account', provider: 'google_drive' },
      }),
    });
    managers.push(manager);

    const started = await manager.start({ label: 'Primary' });
    const authorization = new URL(started.authorizationUrl);
    const authorizationRedirectUri = authorization.searchParams.get('redirect_uri')!;
    const callback = new URL(authorizationRedirectUri);
    expect(authorization.origin).toBe('https://accounts.google.com');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get('scope')).toBe(GOOGLE_DESKTOP_OAUTH_SCOPE);
    expect(callback.hostname).toBe('127.0.0.1');
    expect(Number(callback.port)).toBeGreaterThan(0);
    expect(authorizationRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(callback.pathname).toBe('/');

    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'single-use-authorization-code');
    const result = await fetch(callback);
    expect(result.status).toBe(200);
    const callbackPage = await result.text();
    expect(callbackPage.toLowerCase()).toContain('google drive connected');
    expect(callbackPage).not.toContain(CLIENT_SECRET);
    expect(manager.status(started.attemptId)?.status).toBe('completed');
    expect(tokenRequest?.get('code')).toBe('single-use-authorization-code');
    expect(tokenRequest?.get('redirect_uri')).toBe(authorizationRedirectUri);
    expect(tokenRequest?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(tokenRequest?.get('client_secret')).toBe(CLIENT_SECRET);
    expect(authorization.search).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(manager.status(started.attemptId))).not.toContain(CLIENT_SECRET);
    expect(started.attemptId).not.toBe(authorization.searchParams.get('state'));
  });

  test.each([
    {
      providerError: 'invalid_client',
      publicCode: 'token_exchange_client_rejected',
      publicMessage: 'Google rejected the configured Desktop OAuth client.',
    },
    {
      providerError: 'invalid_grant',
      publicCode: 'token_exchange_grant_rejected',
      publicMessage:
        'Google rejected the one-time authorization grant. Start a new Google Drive connection attempt.',
    },
    {
      providerError: 'redirect_uri_mismatch',
      publicCode: 'token_exchange_redirect_rejected',
      publicMessage:
        'Google rejected the Desktop OAuth loopback address during token exchange.',
    },
    {
      providerError: 'invalid_request',
      publicCode: 'token_exchange_request_rejected',
      publicMessage: 'Google rejected the Desktop OAuth token request.',
    },
  ])(
    'reports a sanitized $providerError token-exchange category',
    async ({ providerError, publicCode, publicMessage }) => {
      const sensitiveDescription = `private-provider-detail-${providerError}`;
      const manager = createDesktopGoogleOAuthManager({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        instanceId: 'e'.repeat(32),
        fetchImplementation: (async () =>
          new Response(
            JSON.stringify({
              error: providerError,
              error_description: sensitiveDescription,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )) as unknown as typeof fetch,
        completeAuthorization: async () => ({ account: {} }),
      });
      managers.push(manager);

      const started = await manager.start();
      const authorization = new URL(started.authorizationUrl);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('code', 'single-use-authorization-code');

      const response = await fetch(callback);
      const body = await response.text();
      expect(response.status).toBe(400);
      expect(body).toContain(publicMessage);
      expect(body).not.toContain(sensitiveDescription);
      expect(manager.status(started.attemptId)).toMatchObject({
        status: 'failed',
        error: { code: publicCode, message: publicMessage },
      });
    },
  );

  test('does not expose unknown provider token-response details', async () => {
    const manager = createDesktopGoogleOAuthManager({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      instanceId: 'f'.repeat(32),
      fetchImplementation: (async () =>
        new Response(
          JSON.stringify({
            error: 'provider_internal_detail',
            error_description: 'must-never-reach-the-callback-page',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )) as unknown as typeof fetch,
      completeAuthorization: async () => ({ account: {} }),
    });
    managers.push(manager);

    const started = await manager.start();
    const authorization = new URL(started.authorizationUrl);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'single-use-authorization-code');

    const response = await fetch(callback);
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain('Google could not complete the authorization-code exchange.');
    expect(body).not.toContain('provider_internal_detail');
    expect(body).not.toContain('must-never-reach-the-callback-page');
  });

  test('rejects mismatched state without consuming the valid attempt', async () => {
    const manager = createDesktopGoogleOAuthManager({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      instanceId: 'b'.repeat(32),
      fetchImplementation: (async () =>
        new Response(
          JSON.stringify({
            access_token: 'access-token-for-test',
            refresh_token: 'refresh-token-for-test',
            expires_in: 3600,
            scope: GOOGLE_DESKTOP_OAUTH_SCOPE,
          }),
        )) as unknown as typeof fetch,
      completeAuthorization: async () => ({ account: { id: 'account' } }),
    });
    managers.push(manager);
    const started = await manager.start();
    const authorization = new URL(started.authorizationUrl);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', 'incorrect-state');
    callback.searchParams.set('code', 'attacker-code');
    expect((await fetch(callback)).status).toBe(400);
    expect(manager.status(started.attemptId)?.status).toBe('awaiting_authorization');

    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'valid-code');
    expect((await fetch(callback)).status).toBe(200);
    expect(manager.status(started.attemptId)?.status).toBe('completed');
  });

  test('handles denial, explicit cancellation, and callback timeout without token exchange', async () => {
    let exchanges = 0;
    const manager = createDesktopGoogleOAuthManager({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      instanceId: 'c'.repeat(32),
      timeoutMs: 40,
      fetchImplementation: (async () => {
        exchanges += 1;
        return new Response('{}');
      }) as unknown as typeof fetch,
      completeAuthorization: async () => ({ account: {} }),
    });
    managers.push(manager);

    const denied = await manager.start();
    const deniedAuth = new URL(denied.authorizationUrl);
    const deniedCallback = new URL(deniedAuth.searchParams.get('redirect_uri')!);
    deniedCallback.searchParams.set('state', deniedAuth.searchParams.get('state')!);
    deniedCallback.searchParams.set('error', 'access_denied');
    expect((await fetch(deniedCallback)).status).toBe(400);
    expect(manager.status(denied.attemptId)?.status).toBe('cancelled');

    const cancelled = await manager.start();
    expect(manager.cancel(cancelled.attemptId)).toBe(true);
    expect(manager.cancel(cancelled.attemptId)).toBe(false);
    expect(manager.status(cancelled.attemptId)?.status).toBe('cancelled');

    const expired = await manager.start();
    await Bun.sleep(70);
    expect(manager.status(expired.attemptId)?.status).toBe('expired');
    expect(exchanges).toBe(0);
  });

  test.each([
    { clientId: null, clientSecret: null },
    { clientId: CLIENT_ID, clientSecret: null },
    { clientId: null, clientSecret: CLIENT_SECRET },
  ])('requires complete Desktop client metadata', async (metadata) => {
    const manager = createDesktopGoogleOAuthManager({
      ...metadata,
      instanceId: 'd'.repeat(32),
      completeAuthorization: async () => ({ account: {} }),
    });
    managers.push(manager);
    await expect(manager.start()).rejects.toMatchObject({
      code: 'google_desktop_oauth_not_configured',
      message: 'Google Drive desktop OAuth is not configured for this build.',
      status: 503,
    });
    expect(JSON.stringify(manager.status('x'.repeat(32)))).not.toContain(CLIENT_SECRET);
  });
});
