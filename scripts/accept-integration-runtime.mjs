import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const workspace = process.cwd();
let server;
let browser;
try {
  server = await createServer({
    root: join(workspace, 'tests/browser/integration-runtime'),
    plugins: [react()],
    resolve: { alias: { '@': join(workspace, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [workspace] },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    logLevel: 'error',
  });
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  assert.ok(origin);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(
    () => window.__integrationAcceptance?.ready || window.__integrationAcceptance?.error,
    undefined,
    { timeout: 20_000 },
  );
  const result = await page.evaluate(() => window.__integrationAcceptance);
  assert.equal(result?.error, undefined);
  assert.equal(result?.surfaceIdIsOpaque, true);
  assert.equal(result?.assetSize, 28);
  assert.equal(result?.wasmSize, 8);
  assert.equal(result?.workerReady, true);
  assert.equal(result?.navigationReported, true);
  assert.equal(result?.service?.runtime, 'web');
  assert.equal(result?.lifecycle?.active, true);
  assert.equal(
    await page.locator('iframe').count(),
    2,
    'sandbox + one pooled Core-owned Gecko session for two logical surfaces',
  );
  await page.evaluate(() => window.__closeIntegrationFixture?.());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  assert.deepEqual(errors, []);
  console.info(
    'B0 integration runtime acceptance passed: signed package, SDK/IPC service + asset + lifecycle, two logical surfaces in one Core-owned Gecko session, queued navigation, and teardown cleanup.',
  );
} finally {
  await browser?.close();
  await server?.close();
}
