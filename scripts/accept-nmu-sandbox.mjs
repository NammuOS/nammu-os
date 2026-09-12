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
    root: join(workspace, 'tests/browser/sandbox-runtime'),
    plugins: [react()],
    resolve: { alias: { '@': join(workspace, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [workspace] },
    },
    logLevel: 'error',
  });
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  assert.ok(origin, 'Vite did not publish a loopback acceptance URL');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const consoleMessages = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  await page.goto(origin);
  try {
    await page.waitForFunction(() => window.__sandboxAcceptance?.ready === true, undefined, {
      timeout: 15_000,
    });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      acceptance: window.__sandboxAcceptance,
      text: document.body.innerText,
      frames: document.querySelectorAll('iframe').length,
    }));
    throw new Error(
      `Sandbox acceptance did not become ready: ${JSON.stringify({ diagnostic, errors, consoleMessages })}`,
      { cause: error },
    );
  }
  const before = await page.evaluate(() => ({
    acceptance: window.__sandboxAcceptance,
    iframeCount: document.querySelectorAll('iframe').length,
  }));
  assert.equal(before.iframeCount, 2);
  assert.deepEqual(before.acceptance?.titles, {
    'window-one': 'Sandbox Ready',
    'window-two': 'Sandbox Ready',
  });
  assert.deepEqual(before.acceptance?.settings, { browserAcceptance: true });
  assert.equal(before.acceptance?.file, 'persisted');
  assert.equal(before.acceptance?.appState, 'Installed');
  assert.deepEqual(errors, []);

  await page.evaluate(() => window.__removeFirstSandbox?.());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1);
  assert.equal(await page.locator('iframe').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
  console.info(
    'NMU sandbox browser acceptance passed: 2 isolated instances, real packaged main.js, MessageChannel RPC, durable userdata, notification, and app.ready().',
  );
} finally {
  await browser?.close();
  await server?.close();
}
