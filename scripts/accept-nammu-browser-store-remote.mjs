import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const workspace = process.cwd();
const nextOrigin = process.env.NAMMU_STORE_ACCEPTANCE_ORIGIN || 'http://127.0.0.1:3000';
const expectedHash = '541af4d497a43e7c2576ff3bd061565dc6fed07a84cd34019ba267a39d364ea6';
const expectedUrl =
  'https://github.com/NammuOS/nammu-browser/releases/download/v1.0.0/os.nammu.browser-1.0.0-signed.napp';
const expectedPermissions = [
  'Copy text',
  'Embedded web content',
  'Manage its window',
  'Migrate legacy data',
  'Nammu services',
  'Open selected files',
  'Read clipboard text',
  'Save selected files',
].sort();

const origin = new URL(nextOrigin);
assert.ok(
  origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname),
  'Remote Store acceptance may proxy only to a local NammuOS server.',
);

let server;
let browser;
try {
  server = await createServer({
    root: join(workspace, 'tests/browser/browser-store-remote-runtime'),
    plugins: [react()],
    resolve: { alias: { '@': join(workspace, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [workspace] },
      proxy: { '/api': { target: origin.origin, changeOrigin: false } },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    logLevel: 'error',
  });
  await server.listen();
  const harnessOrigin = server.resolvedUrls?.local[0];
  assert.ok(harnessOrigin, 'Vite did not publish a loopback acceptance URL.');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(harnessOrigin, { waitUntil: 'domcontentloaded', timeout: 15_000 });

  const state = () => page.evaluate(() => window.__browserRemoteAcceptance);
  const waitForInstalled = () =>
    page.waitForFunction(
      () => window.__browserRemoteAcceptance?.record?.state === 'Installed',
      undefined,
      { timeout: 30_000 },
    );
  const waitForUninstalled = () =>
    page.waitForFunction(() => window.__browserRemoteAcceptance?.record === null, undefined, {
      timeout: 15_000,
    });
  const reviewAndConfirm = async (action) => {
    const dialog = page.getByRole('dialog', { name: 'Review permissions' });
    await dialog.waitFor({ timeout: 30_000 });
    assert.deepEqual(
      (await dialog.locator('.nammu-store-permission strong').allTextContents()).sort(),
      expectedPermissions,
      'Permission review must come from the downloaded Browser manifest.',
    );
    await dialog.getByRole('button', { name: action, exact: true }).click();
  };
  const openBrowser = async () => {
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    try {
      await page.locator('[data-acceptance-browser] iframe[title="Browser"]').waitFor({
        state: 'attached',
        timeout: 15_000,
      });
    } catch (error) {
      throw new Error(
        `Browser did not launch from Store. State=${JSON.stringify(await state())} Body=${JSON.stringify(await page.locator('body').innerText())} Errors=${JSON.stringify(pageErrors)} Cause=${error}`,
      );
    }
    const packageFrame = page.frameLocator(
      '[data-acceptance-browser] iframe[title="Browser"]',
    );
    await packageFrame.locator('.browser-omnibox-input').waitFor({ timeout: 15_000 });
    return packageFrame;
  };
  const closeBrowser = async () => {
    await page.evaluate(() => window.__closeAcceptedBrowser?.());
    await page.locator('[data-acceptance-browser]').waitFor({ state: 'detached' });
  };

  await page.waitForFunction(() =>
    Object.prototype.hasOwnProperty.call(window.__browserRemoteAcceptance ?? {}, 'record'),
  );
  assert.equal((await state())?.record, null, 'Acceptance must begin with Browser not installed.');

  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await reviewAndConfirm('Install');
  await waitForInstalled();
  let acceptance = await state();
  assert.equal(acceptance?.packageRequests, 1);
  assert.equal(acceptance?.record?.packageHash, expectedHash);
  assert.equal(acceptance?.record?.sourceUrl, expectedUrl);
  assert.equal(acceptance?.record?.sourceRegistry, 'official');
  assert.equal(acceptance?.record?.signatureVerified, true);
  assert.equal(acceptance?.record?.publisher, 'nammu-official');
  assert.equal(acceptance?.record?.publisherKeyId, 'nammu-official-2026-09');

  let packageFrame = await openBrowser();
  await packageFrame.locator('.browser-omnibox-input').fill('https://example.com/');
  await packageFrame.locator('.browser-omnibox-input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2, undefined, {
    timeout: 15_000,
  });
  await packageFrame.getByLabel('Bookmark page').click();
  await page.waitForFunction(
    () => {
      const raw = window.__browserRemoteAcceptance?.settings?.nammu_browser_bookmarks;
      return typeof raw === 'string' && raw.includes('https://example.com/');
    },
    undefined,
    { timeout: 10_000 },
  );
  await closeBrowser();
  packageFrame = await openBrowser();
  assert.equal(await packageFrame.getByText('example.com', { exact: false }).count() > 0, true);
  await closeBrowser();

  await page.getByRole('button', { name: 'Repair installation', exact: true }).click();
  await reviewAndConfirm('Repair');
  await waitForInstalled();
  await page.waitForFunction(() => window.__browserRemoteAcceptance?.packageRequests === 2);

  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  const uninstallDialog = page.getByRole('alertdialog', { name: 'Uninstall Browser?' });
  await uninstallDialog.waitFor();
  await uninstallDialog.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await waitForUninstalled();
  assert.match(
    String((await state())?.settings?.nammu_browser_bookmarks),
    /https:\/\/example\.com\//,
    'Uninstall must retain Browser userdata.',
  );

  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await reviewAndConfirm('Install');
  await waitForInstalled();
  await page.waitForFunction(() => window.__browserRemoteAcceptance?.packageRequests === 3);
  packageFrame = await openBrowser();
  assert.equal(await packageFrame.getByText('example.com', { exact: false }).count() > 0, true);

  acceptance = await state();
  assert.equal(acceptance?.record?.packageHash, expectedHash);
  assert.equal(acceptance?.record?.signatureVerified, true);
  assert.equal(acceptance?.packageRequests, 3);
  assert.deepEqual(pageErrors, []);

  process.stdout.write(
    JSON.stringify({
      status: 'ok',
      route: '/api/app-store/packages/os.nammu.browser/1.0.0',
      packageUrl: expectedUrl,
      sha256: expectedHash,
      packageRequests: acceptance?.packageRequests,
      signatureVerified: acceptance?.record?.signatureVerified,
      lifecycle: [
        'remote-install',
        'sandbox-launch',
        'browse-and-persist-bookmark',
        'close-reopen',
        'remote-repair',
        'uninstall-retain-data',
        'remote-reinstall-recover-data',
      ],
    }) + '\n',
  );
} finally {
  await browser?.close();
  await server?.close();
}
