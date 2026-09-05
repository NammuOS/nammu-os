import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { resolveGoogleDesktopClientMetadata } from './desktopGoogleClientMetadata.mjs';

export const GOOGLE_DESKTOP_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_DESKTOP_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALLBACK_PATHNAME = '/';
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const MAX_ACTIVE_ATTEMPTS = 3;

export class DesktopGoogleOAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DesktopGoogleOAuthError';
    this.code = code;
    this.status = status;
  }
}

function randomBase64Url(bytes) {
  return randomBytes(bytes).toString('base64url');
}

export function createGooglePkce() {
  const verifier = randomBase64Url(64);
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return Object.freeze({ verifier, challenge, method: 'S256' });
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sendCallbackPage(response, status, title, message) {
  const safeTitle = title.replace(/[<>&"']/g, '');
  const safeMessage = message.replace(/[<>&"']/g, '');
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html{color-scheme:dark;font-family:system-ui,sans-serif;background:#070b12;color:#dce8f3}body{min-height:100vh;margin:0;display:grid;place-items:center}.card{max-width:30rem;margin:2rem;padding:2rem;border:1px solid #26394b;background:#0b121c}h1{font-size:1.25rem;margin:0 0 .75rem}p{color:#9db1c3;line-height:1.55;margin:0}</style></head><body><main class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p></main></body></html>`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (text.length > 1024 * 1024) {
    throw new DesktopGoogleOAuthError(
      'token_response_invalid',
      'Google returned an unexpectedly large OAuth response.',
      502,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DesktopGoogleOAuthError(
      'token_response_invalid',
      'Google returned an invalid OAuth response.',
      502,
    );
  }
}

function tokenExchangeProviderError(payload) {
  const providerCode =
    payload && typeof payload === 'object' && typeof payload.error === 'string'
      ? payload.error
      : null;

  switch (providerCode) {
    case 'access_denied':
      return new DesktopGoogleOAuthError(
        'authorization_denied',
        'Google Drive authorization was denied.',
        400,
      );
    case 'invalid_client':
    case 'unauthorized_client':
      return new DesktopGoogleOAuthError(
        'token_exchange_client_rejected',
        'Google rejected the configured Desktop OAuth client.',
        400,
      );
    case 'invalid_grant':
      return new DesktopGoogleOAuthError(
        'token_exchange_grant_rejected',
        'Google rejected the one-time authorization grant. Start a new Google Drive connection attempt.',
        400,
      );
    case 'redirect_uri_mismatch':
      return new DesktopGoogleOAuthError(
        'token_exchange_redirect_rejected',
        'Google rejected the Desktop OAuth loopback address during token exchange.',
        400,
      );
    case 'invalid_request':
      return new DesktopGoogleOAuthError(
        'token_exchange_request_rejected',
        'Google rejected the Desktop OAuth token request.',
        400,
      );
    default:
      return new DesktopGoogleOAuthError(
        'token_exchange_failed',
        'Google could not complete the authorization-code exchange.',
        502,
      );
  }
}

function validateTokenResponse(payload, now) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.access_token !== 'string' ||
    payload.access_token.length < 10 ||
    payload.access_token.length > 16_384 ||
    !Number.isFinite(Number(payload.expires_in)) ||
    Number(payload.expires_in) <= 0 ||
    (payload.refresh_token !== undefined &&
      (typeof payload.refresh_token !== 'string' || payload.refresh_token.length > 16_384))
  ) {
    throw new DesktopGoogleOAuthError(
      'token_response_invalid',
      'Google returned incomplete OAuth credentials.',
      502,
    );
  }

  return Object.freeze({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: now() + Number(payload.expires_in) * 1000,
    scope: typeof payload.scope === 'string' ? payload.scope : GOOGLE_DESKTOP_OAUTH_SCOPE,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
  });
}

function publicStatus(session) {
  return Object.freeze({
    attemptId: session.attemptId,
    provider: 'google_drive',
    status: session.status,
    expiresAt: new Date(session.expiresAt).toISOString(),
    ...(session.error
      ? { error: { code: session.error.code, message: session.error.message } }
      : {}),
    ...(session.account ? { account: session.account } : {}),
    ...(session.warning ? { warning: session.warning } : {}),
  });
}

export function createDesktopGoogleOAuthManager({
  clientId,
  clientSecret,
  instanceId,
  completeAuthorization,
  fetchImplementation = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = GOOGLE_DESKTOP_OAUTH_TIMEOUT_MS,
}) {
  if (typeof completeAuthorization !== 'function') {
    throw new TypeError('Google desktop OAuth requires an authorization completion handler.');
  }
  const sessions = new Map();
  let closed = false;

  function configuredMetadata() {
    const metadata = resolveGoogleDesktopClientMetadata(clientId, clientSecret);
    if (!metadata) {
      throw new DesktopGoogleOAuthError(
        'google_desktop_oauth_not_configured',
        'Google Drive desktop OAuth is not configured for this build.',
        503,
      );
    }
    return metadata;
  }

  function closeListener(session) {
    clearTimeout(session.timeout);
    session.server?.close();
    session.server = null;
  }

  function fail(session, code, message, status = 'failed') {
    closeListener(session);
    session.verifier = null;
    session.state = null;
    session.clientSecret = null;
    session.status = status;
    session.error = Object.freeze({ code, message });
    session.finishedAt = now();
  }

  async function exchangeCode(session, code) {
    const requestBody = new URLSearchParams({
      client_id: session.clientId,
      client_secret: session.clientSecret,
      code,
      code_verifier: session.verifier,
      grant_type: 'authorization_code',
      redirect_uri: session.redirectUri,
    });

    let response;
    try {
      response = await fetchImplementation(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: requestBody,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DesktopGoogleOAuthError(
        'token_exchange_network_error',
        'Nammu could not reach Google to finish authorization. Try connecting again.',
        502,
      );
    }

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw tokenExchangeProviderError(payload);
    }
    return validateTokenResponse(payload, now);
  }

  async function consumeValidCallback(session, code, response) {
    session.stateUsed = true;
    session.status = 'exchanging';
    closeListener(session);
    const verifier = session.verifier;
    try {
      const tokens = await exchangeCode(session, code);
      const result = await completeAuthorization({
        tokens,
        label: session.label,
        attemptId: session.attemptId,
      });
      session.status = 'completed';
      session.account = result.account;
      session.warning = result.warning || null;
      session.finishedAt = now();
      sendCallbackPage(
        response,
        200,
        'Google Drive connected',
        'Authorization is complete. You can return to Nammu OS and close this tab.',
      );
    } catch (error) {
      const oauthError =
        error instanceof DesktopGoogleOAuthError
          ? error
          : new DesktopGoogleOAuthError(
              'authorization_completion_failed',
              'Nammu could not finish connecting this Google Drive account.',
              502,
            );
      fail(session, oauthError.code, oauthError.message);
      sendCallbackPage(
        response,
        oauthError.status >= 500 ? 502 : 400,
        'Connection not completed',
        oauthError.message,
      );
    } finally {
      if (typeof verifier === 'string') {
        session.verifier = null;
      }
      session.clientSecret = null;
    }
  }

  async function handleCallback(session, request, response) {
    const expectedHost = `127.0.0.1:${session.port}`;
    if (
      request.method !== 'GET' ||
      request.headers.host !== expectedHost ||
      request.headers.forwarded !== undefined ||
      Object.keys(request.headers).some((name) => name.startsWith('x-forwarded-'))
    ) {
      sendCallbackPage(response, 400, 'Invalid callback', 'This OAuth callback was rejected.');
      return;
    }

    let url;
    try {
      if (!request.url || request.url.length > 8_192) throw new Error('invalid');
      url = new URL(request.url, `http://${expectedHost}`);
    } catch {
      sendCallbackPage(response, 400, 'Invalid callback', 'The OAuth callback was malformed.');
      return;
    }
    if (url.pathname !== CALLBACK_PATHNAME || url.hash) {
      sendCallbackPage(response, 404, 'Not found', 'This callback address is not available.');
      return;
    }
    if (session.stateUsed || session.status !== 'awaiting_authorization') {
      sendCallbackPage(response, 409, 'Already used', 'This OAuth attempt has already finished.');
      return;
    }

    const states = url.searchParams.getAll('state');
    const suppliedState = states.length === 1 ? states[0] : null;
    if (!sameSecret(suppliedState, session.state)) {
      sendCallbackPage(response, 400, 'Invalid callback', 'The OAuth state did not match.');
      return;
    }

    const providerErrors = url.searchParams.getAll('error');
    const providerError = providerErrors.length === 1 ? providerErrors[0] : null;
    if (providerErrors.length > 1 || (providerError && url.searchParams.has('code'))) {
      session.stateUsed = true;
      fail(session, 'malformed_callback', 'Google returned an invalid OAuth callback.');
      sendCallbackPage(response, 400, 'Invalid callback', session.error.message);
      return;
    }
    if (providerError) {
      session.stateUsed = true;
      fail(
        session,
        providerError === 'access_denied' ? 'authorization_denied' : 'provider_authorization_error',
        providerError === 'access_denied'
          ? 'Google Drive authorization was cancelled or denied.'
          : 'Google returned an authorization error.',
        providerError === 'access_denied' ? 'cancelled' : 'failed',
      );
      sendCallbackPage(response, 400, 'Google Drive not connected', session.error.message);
      return;
    }

    const codes = url.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0] || codes[0].length > 8_192) {
      session.stateUsed = true;
      fail(session, 'malformed_callback', 'Google returned an incomplete OAuth callback.');
      sendCallbackPage(response, 400, 'Invalid callback', session.error.message);
      return;
    }
    await consumeValidCallback(session, codes[0], response);
  }

  function prune() {
    const cutoff = now() - 10 * 60 * 1000;
    for (const [attemptId, session] of sessions) {
      if (session.finishedAt && session.finishedAt < cutoff) sessions.delete(attemptId);
    }
  }

  return Object.freeze({
    /** @param {{ label?: string | null }} [options] */
    async start({ label = null } = {}) {
      if (closed) {
        throw new DesktopGoogleOAuthError(
          'oauth_manager_closed',
          'Google Drive authorization is unavailable while Nammu is shutting down.',
          503,
        );
      }
      prune();
      const activeCount = [...sessions.values()].filter((session) =>
        ['awaiting_authorization', 'exchanging'].includes(session.status),
      ).length;
      if (activeCount >= MAX_ACTIVE_ATTEMPTS) {
        throw new DesktopGoogleOAuthError(
          'too_many_oauth_attempts',
          'Finish or cancel an existing Google Drive connection attempt first.',
          429,
        );
      }

      const metadata = configuredMetadata();
      const pkce = createGooglePkce();
      const session = {
        attemptId: randomBase64Url(24),
        binding: instanceId,
        clientId: metadata.clientId,
        clientSecret: metadata.clientSecret,
        state: randomBase64Url(32),
        stateUsed: false,
        verifier: pkce.verifier,
        label:
          typeof label === 'string' && label.trim()
            ? [...label.trim()]
                .filter((character) => character.charCodeAt(0) >= 0x20)
                .join('')
                .slice(0, 80)
            : null,
        status: 'awaiting_authorization',
        error: null,
        account: null,
        warning: null,
        createdAt: now(),
        expiresAt: now() + timeoutMs,
        finishedAt: null,
        port: null,
        redirectUri: null,
        server: null,
        timeout: null,
      };
      if (!ATTEMPT_ID_PATTERN.test(session.attemptId)) throw new Error('Invalid OAuth attempt ID.');

      const server = createServer((request, response) => {
        void handleCallback(session, request, response).catch(() => {
          if (!response.headersSent) {
            sendCallbackPage(
              response,
              500,
              'Connection not completed',
              'Nammu could not process the OAuth callback.',
            );
          } else {
            response.destroy();
          }
        });
      });
      server.maxHeadersCount = 32;
      server.maxConnections = 8;
      server.headersTimeout = 10_000;
      server.requestTimeout = 15_000;
      server.on('clientError', (_error, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      });
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Nammu could not allocate a loopback OAuth callback port.');
      }
      session.server = server;
      session.port = address.port;
      session.redirectUri = `http://127.0.0.1:${address.port}`;
      server.on('error', () => {
        if (session.status === 'awaiting_authorization') {
          fail(
            session,
            'callback_listener_failed',
            'The local Google authorization callback became unavailable.',
          );
        }
      });
      session.timeout = setTimeout(() => {
        if (session.status === 'awaiting_authorization') {
          fail(session, 'callback_timeout', 'Google Drive authorization timed out.', 'expired');
        }
      }, timeoutMs);
      session.timeout.unref?.();
      sessions.set(session.attemptId, session);

      const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      authorizationUrl.search = new URLSearchParams({
        access_type: 'offline',
        client_id: metadata.clientId,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        include_granted_scopes: 'true',
        prompt: 'consent',
        redirect_uri: session.redirectUri,
        response_type: 'code',
        scope: GOOGLE_DESKTOP_OAUTH_SCOPE,
        state: session.state,
      }).toString();

      return Object.freeze({
        attemptId: session.attemptId,
        authorizationUrl: authorizationUrl.toString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    },

    status(attemptId) {
      if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) return null;
      const session = sessions.get(attemptId);
      return session ? publicStatus(session) : null;
    },

    cancel(attemptId) {
      if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) return false;
      const session = sessions.get(attemptId);
      if (!session || !['awaiting_authorization'].includes(session.status)) return false;
      session.stateUsed = true;
      fail(
        session,
        'authorization_cancelled',
        'Google Drive authorization was cancelled.',
        'cancelled',
      );
      return true;
    },

    close() {
      closed = true;
      for (const session of sessions.values()) {
        if (['awaiting_authorization', 'exchanging'].includes(session.status)) {
          fail(session, 'application_shutdown', 'Google Drive authorization was interrupted.');
        }
      }
    },
  });
}
