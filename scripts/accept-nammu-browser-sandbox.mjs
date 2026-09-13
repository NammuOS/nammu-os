import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const workspace = process.cwd();
const browserRepository = resolve(workspace, '..', 'nammu-browser');
const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;
if (!privateKeyPath) throw new Error('NAMMU_RELEASE_PRIVATE_KEY_PATH is required.');

const unsignedPath = join(browserRepository, 'dist', 'os.nammu.browser-1.0.0-unsigned.napp');
const signedPath = join(browserRepository, 'dist', 'os.nammu.browser-1.0.0-signed.napp');
if (process.env.NAMMU_BROWSER_USE_EXISTING_ARTIFACT !== '1') {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: browserRepository,
    env: { ...process.env, NAMMU_BROWSER_VERSION: '1.0.0' },
    encoding: 'utf8',
  });
  if (build.status !== 0) throw new Error(`Browser build failed: ${build.stderr || build.stdout}`);
  await rm(signedPath, { force: true });
  const sign = spawnSync('bun', ['run', 'nmu:release:sign', '--', unsignedPath, signedPath], {
    cwd: workspace,
    env: process.env,
    encoding: 'utf8',
  });
  if (sign.status !== 0) throw new Error(`Browser signing failed: ${sign.stderr || sign.stdout}`);
}
const archive = await readFile(signedPath);

let server;
let browser;
try {
  server = await createServer({
    root: join(workspace, 'tests/browser/browser-package-runtime'),
    publicDir: join(workspace, 'public'),
    plugins: [react()],
    define: { __BROWSER_NAPP_BASE64__: JSON.stringify(archive.toString('base64')) },
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForFunction(() => window.__browserAcceptance?.ready === true, undefined, {
    timeout: 15_000,
  });
  const packageFrame = page.frameLocator('iframe[title="os.nammu.browser"]');
  try {
    await packageFrame.locator('.browser-omnibox-input').waitFor({ timeout: 15_000 });
    if (process.env.NAMMU_BROWSER_SCREENSHOT_PATH) {
      const screenshotPath = resolve(process.env.NAMMU_BROWSER_SCREENSHOT_PATH);
      await mkdir(resolve(screenshotPath, '..'), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }
  } catch (error) {
    const frames = await page.locator('iframe').evaluateAll((nodes) =>
      nodes.map((node) => ({ title: node.title, src: node.getAttribute('src') })),
    );
    const body = await page.locator('body').innerText();
    const acceptance = await page.evaluate(() => window.__browserAcceptance);
    throw new Error(
      `Browser package UI did not start. Frames=${JSON.stringify(frames)} Acceptance=${JSON.stringify(acceptance)} Body=${JSON.stringify(body)} Errors=${JSON.stringify(errors)} Cause=${error}`,
    );
  }
  assert.equal((await page.evaluate(() => window.__browserAcceptance)).signatureVerified, true);
  await page.waitForFunction(() => window.__browserAcceptance?.legacyRemoved === true, undefined, {
    timeout: 15_000,
  });
  await packageFrame.locator('.browser-omnibox-input').fill('https://example.com/');
  await packageFrame.locator('.browser-omnibox-input').press('Enter');
  try {
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2, undefined, {
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(
      `Browser did not create its first host surface. Package=${JSON.stringify(await packageFrame.locator('body').innerText())} Errors=${JSON.stringify(errors)} Cause=${error}`,
    );
  }
  await packageFrame.getByLabel('New tab').click();
  await packageFrame.locator('.browser-omnibox-input').fill('https://example.org/');
  await packageFrame.locator('.browser-omnibox-input').press('Enter');
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('iframe').count(),
    2,
    'the package sandbox plus one pooled Core-owned Gecko session serve multiple Browser tabs',
  );
  await page.evaluate(() => window.__toggleBrowser?.());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  await page.evaluate(() => window.__toggleBrowser?.());
  await packageFrame.locator('.browser-omnibox-input').waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write(
    'Nammu Browser sandbox acceptance passed: signed package, AppSandboxHost launch, scoped migration, multi-tab pooled Gecko surfaces, teardown, and reopen.\n',
  );
} finally {
  await browser?.close();
  await server?.close();
}
