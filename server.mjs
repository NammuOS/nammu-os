import { createServer } from 'node:http';
import {
  createDesktopControlChannel,
  DESKTOP_LOCAL_RUNTIME,
  serializeDesktopReadyMessage,
} from './src/server/runtime/desktopBootstrap.mjs';
import { createDesktopRequestGate } from './src/server/runtime/desktopSecurity.mjs';
import { DesktopRouteExecution } from './src/server/runtime/desktopRoutePolicy.mjs';

const dev = process.argv.includes('--dev');
const desktopLocal = process.env.NAMMU_RUNTIME === DESKTOP_LOCAL_RUNTIME;
const desktopControl = desktopLocal ? createDesktopControlChannel() : null;
const desktopBootstrap = desktopControl ? await desktopControl.bootstrap : null;
let desktopDatabase = null;
if (desktopLocal) {
  try {
    desktopDatabase = (
      await import('./src/server/runtime/desktopDatabase.mjs')
    ).openDesktopDatabase(desktopBootstrap.dataDirectory, desktopBootstrap.vaultKey);
  } finally {
    desktopBootstrap.vaultKey.fill(0);
  }
}
let desktopGoogleCloud = null;
if (desktopLocal) {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  let packagedClientId = null;
  let packagedClientSecret = null;
  const providerConfigPath = join(process.cwd(), 'desktop-provider-config.json');
  if (existsSync(providerConfigPath)) {
    try {
      const providerConfig = JSON.parse(readFileSync(providerConfigPath, 'utf8'));
      packagedClientId = providerConfig?.googleDesktopClientId || null;
      packagedClientSecret = providerConfig?.googleDesktopClientSecret || null;
    } catch {}
  }
  const googleClientId = () => process.env.GOOGLE_DESKTOP_CLIENT_ID || packagedClientId;
  const googleClientSecret = () =>
    process.env.GOOGLE_DESKTOP_CLIENT_SECRET || packagedClientSecret;
  desktopGoogleCloud = (
    await import('./src/server/runtime/desktopGoogleCloudApi.mjs')
  ).createDesktopGoogleCloudApi({
    database: desktopDatabase,
    clientId: googleClientId,
    clientSecret: googleClientSecret,
    instanceId: desktopBootstrap.instanceId,
  });
}
const desktopLocalApi = desktopLocal
  ? (await import('./src/server/runtime/desktopLocalApi.mjs')).createDesktopLocalApi(
      desktopDatabase,
      { googleCloud: desktopGoogleCloud },
    )
  : null;
const hostname = desktopLocal ? '127.0.0.1' : process.env.NAMMU_HOST || '0.0.0.0';
const port = desktopLocal ? 0 : Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 0 || port > 65535 || (!desktopLocal && port === 0)) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const { default: next } = await import('next');
const wispModule = desktopLocal ? null : await import('@mercuryworkshop/wisp-js/server');
const wisp = wispModule?.server ?? null;

// Media CDNs commonly reset superseded range-request streams after the browser
// seeks or selects another representation. Wisp closes those streams normally;
// keep genuine server errors visible without flooding the terminal with resets.
if (wispModule && wisp) {
  wispModule.logging.set_level(wispModule.logging.ERROR);
  wisp.options.allow_private_ips = false;
  wisp.options.allow_loopback_ips = false;
}

const app = next({ dev, hostname, port });
const handleRequest = app.getRequestHandler();

await app.prepare();
const handleUpgrade = app.getUpgradeHandler();
let desktopRequestGate = null;
const httpServer = createServer((request, response) => {
  if (desktopLocal) {
    const activeAddress = httpServer.address();
    if (!desktopRequestGate || !activeAddress || typeof activeAddress === 'string') {
      response.writeHead(503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ error: 'The desktop local API is starting.' }));
      return;
    }

    const authorization = desktopRequestGate.authorize(request, activeAddress.port);
    if (!authorization.accepted) {
      response.writeHead(authorization.status, {
        ...authorization.headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ error: authorization.error }));
      return;
    }
    if (authorization.preflight) {
      response.writeHead(authorization.status, authorization.headers);
      response.end();
      return;
    }
    if (authorization.route.id === 'health') {
      response.writeHead(200, {
        ...authorization.headers,
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(
        JSON.stringify({
          status: 'ok',
          runtime: DESKTOP_LOCAL_RUNTIME,
          instanceId: desktopBootstrap.instanceId,
        }),
      );
      return;
    }
    if (authorization.route.execution === DesktopRouteExecution.NEXT) {
      for (const [name, value] of Object.entries(authorization.headers)) {
        response.setHeader(name, value);
      }
      void handleRequest(request, response);
      return;
    }
    void desktopLocalApi.handle(request, response, authorization.route, authorization.headers);
    return;
  }
  void handleRequest(request, response);
});

httpServer.on('upgrade', (request, socket, head) => {
  if (desktopLocal) {
    // Desktop remote applications use NativeWebSurface. The local service has
    // no proxy/WebSocket tunnel and never imports the Wisp runtime.
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    .pathname;

  if (pathname.startsWith('/firefox-wisp/')) {
    const origin = request.headers.origin;
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(origin && new URL(origin).host === request.headers.host);
    } catch {
      sameOrigin = false;
    }

    if (!sameOrigin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    wisp?.routeRequest(request, socket, head);
    return;
  }

  void handleUpgrade(request, socket, head);
});

await new Promise((resolve, reject) => {
  const handleError = (error) => {
    httpServer.off('listening', handleListening);
    reject(error);
  };
  const handleListening = () => {
    httpServer.off('error', handleError);
    resolve();
  };
  httpServer.once('error', handleError);
  httpServer.once('listening', handleListening);
  httpServer.listen(port, hostname);
});

const address = httpServer.address();
if (!address || typeof address === 'string') {
  throw new Error('Nammu OS could not determine the local server address.');
}

if (desktopLocal) {
  desktopRequestGate = createDesktopRequestGate({
    instanceId: desktopBootstrap.instanceId,
    apiCapability: desktopBootstrap.apiCapability,
    frontendOrigin: desktopBootstrap.frontendOrigin,
  });
  process.stdout.write(
    serializeDesktopReadyMessage({
      instanceId: desktopBootstrap.instanceId,
      port: address.port,
    }),
  );
} else {
  console.info(
    `> NammuOS ready at http://localhost:${address.port} (${dev ? 'development' : 'production'})`,
  );
}

let shutdownPromise = null;
function shutdownLocalServer() {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = new Promise((resolveShutdown) => {
    const forceTimer = setTimeout(() => {
      httpServer.closeAllConnections?.();
    }, 5_000);
    forceTimer.unref();

    httpServer.close(async () => {
      clearTimeout(forceTimer);
      desktopControl?.close();
      if (typeof app.close === 'function') {
        await app.close().catch(() => undefined);
      }
      desktopGoogleCloud?.close();
      desktopDatabase?.close();
      resolveShutdown();
    });
  });

  return shutdownPromise;
}

if (desktopControl) {
  desktopControl.onShutdown(() => {
    void shutdownLocalServer().then(() => process.exit(0));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdownLocalServer().then(() => process.exit(0));
  });
}
