export const DesktopRouteClass = Object.freeze({
  LOCAL_SAFE: 'LOCAL_SAFE',
  LOCAL_AUTHENTICATED: 'LOCAL_AUTHENTICATED',
  EXTERNAL_PROVIDER: 'EXTERNAL_PROVIDER',
  DISABLED_DESKTOP: 'DISABLED_DESKTOP',
  WEB_ONLY: 'WEB_ONLY',
});

export const DesktopRouteExecution = Object.freeze({
  LOCAL: 'LOCAL',
  NEXT: 'NEXT',
});

/** @param {string | null} execution */
const route = (id, pattern, classification, methods, enabled = false, execution = null) =>
  Object.freeze({
    id,
    pattern,
    classification,
    methods: Object.freeze(methods),
    enabled,
    execution,
  });

// This list is intentionally explicit. A newly-created Next route is denied in
// desktop-local mode until it is reviewed and added here.
export const desktopRoutePolicy = Object.freeze([
  route(
    'health',
    /^\/api\/health$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'preferences',
    /^\/api\/preferences$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET', 'POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'history',
    /^\/api\/history$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET', 'POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'settings',
    /^\/api\/settings$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET', 'POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'allocation',
    /^\/api\/allocation$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET', 'PATCH'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route('allocation-config', /^\/api\/allocation\/config$/, DesktopRouteClass.LOCAL_AUTHENTICATED, [
    'GET',
    'PUT',
  ]),
  route('allocation-stats', /^\/api\/allocation\/stats$/, DesktopRouteClass.LOCAL_AUTHENTICATED, [
    'GET',
  ]),
  route(
    'google-accounts',
    /^\/api\/accounts$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-account-item',
    /^\/api\/accounts\/[0-9a-f-]{36}$/i,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['DELETE'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-account-connect',
    /^\/api\/accounts\/google_drive\/connect$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-account-status',
    /^\/api\/accounts\/google_drive\/status$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET', 'DELETE'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-files',
    /^\/api\/files$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-file-bulk-delete',
    /^\/api\/files\/bulk\/delete$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-file-folder',
    /^\/api\/files\/folders$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-empty-trash',
    /^\/api\/files\/trash\/empty$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-file-download',
    /^\/api\/files\/[0-9a-f-]{36}\/download$/i,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-file-preview',
    /^\/api\/files\/[0-9a-f-]{36}\/preview$/i,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-file-item',
    /^\/api\/files\/[0-9a-f-]{36}$/i,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['DELETE'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  // Keep this reviewed dynamic route last within /api/files. Static paths and
  // purpose-specific handlers must never be shadowed by the two-segment match.
  route(
    'google-file-action',
    /^\/api\/files\/[0-9a-f-]{36}\/(?:rename|star|restore|permanent|delete)$/i,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST', 'PATCH', 'DELETE'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-upload-initiate',
    /^\/api\/uploads\/initiate$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route(
    'google-upload-stream',
    /^\/api\/uploads\/[A-Za-z0-9_-]{32}\/stream$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  route('sync', /^\/api\/sync$/, DesktopRouteClass.EXTERNAL_PROVIDER, ['POST']),
  route(
    'google-sync',
    /^\/api\/sync\/run$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.LOCAL,
  ),
  // Generic cloud/provider shapes remain explicitly reviewed but denied. They
  // follow the Google-only entries so no other provider or unvalidated dynamic
  // identifier inherits desktop access.
  route('account-item', /^\/api\/accounts\/[^/]+$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
    'DELETE',
  ]),
  route(
    'account-connect',
    /^\/api\/accounts\/[^/]+\/connect$/,
    DesktopRouteClass.DISABLED_DESKTOP,
    ['GET', 'POST'],
  ),
  route(
    'account-callback',
    /^\/api\/accounts\/[^/]+\/callback$/,
    DesktopRouteClass.DISABLED_DESKTOP,
    ['GET'],
  ),
  route('account-status', /^\/api\/accounts\/[^/]+\/status$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
    'DELETE',
  ]),
  route('file-download', /^\/api\/files\/[^/]+\/download$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
  ]),
  route('file-preview', /^\/api\/files\/[^/]+\/preview$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
  ]),
  route('file-item', /^\/api\/files\/[^/]+$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
    'DELETE',
  ]),
  route('file-action', /^\/api\/files\/[^/]+\/[^/]+$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'POST',
    'PATCH',
    'DELETE',
  ]),
  route('upload-stream', /^\/api\/uploads\/[^/]+\/stream$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'POST',
  ]),
  route(
    'maps-search',
    /^\/api\/maps\/search$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'maps-location',
    /^\/api\/maps\/location$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'browser-search',
    /^\/api\/browser\/search$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'browser-public-proxies',
    /^\/api\/browser\/public-proxies$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'browser-public-proxy-check',
    /^\/api\/browser\/public-proxies\/check$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['POST'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'browser-wisp-endpoint',
    /^\/api\/browser\/wisp-endpoint$/,
    DesktopRouteClass.LOCAL_AUTHENTICATED,
    ['GET'],
  ),
  route('browser-arbitrary-proxy', /^\/api\/browser\/proxy$/, DesktopRouteClass.DISABLED_DESKTOP, [
    'GET',
  ]),
  route(
    'music-lyrics',
    /^\/api\/music\/lyrics$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'music-sponsorblock',
    /^\/api\/music\/sponsorblock$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route(
    'subdomain-inspector',
    /^\/api\/tools\/subdomains$/,
    DesktopRouteClass.EXTERNAL_PROVIDER,
    ['GET'],
    true,
    DesktopRouteExecution.NEXT,
  ),
  route('trpc', /^\/api\/trpc(?:\/.*)?$/, DesktopRouteClass.WEB_ONLY, ['GET', 'POST']),
]);

export function classifyDesktopRoute(pathname) {
  return desktopRoutePolicy.find((entry) => entry.pattern.test(pathname)) ?? null;
}
