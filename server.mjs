import { createServer } from 'node:http';
import next from 'next';
import { logging, server as wisp } from '@mercuryworkshop/wisp-js/server';

const dev = process.argv.includes('--dev');
const hostname = process.env.NAMMU_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

// Media CDNs commonly reset superseded range-request streams after the browser
// seeks or selects another representation. Wisp closes those streams normally;
// keep genuine server errors visible without flooding the terminal with resets.
logging.set_level(logging.ERROR);
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;

const app = next({ dev, hostname, port });
const handleRequest = app.getRequestHandler();

await app.prepare();
const handleUpgrade = app.getUpgradeHandler();
const httpServer = createServer((request, response) => {
  void handleRequest(request, response);
});

httpServer.on('upgrade', (request, socket, head) => {
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

    wisp.routeRequest(request, socket, head);
    return;
  }

  void handleUpgrade(request, socket, head);
});

httpServer.listen(port, hostname, () => {
  console.info(
    `> NammuOS ready at http://localhost:${port} (${dev ? 'development' : 'production'})`,
  );
});
