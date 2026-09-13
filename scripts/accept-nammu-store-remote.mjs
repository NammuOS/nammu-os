import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';

const workspace = process.cwd();
const nextOrigin = process.env.NAMMU_STORE_ACCEPTANCE_ORIGIN || 'http://127.0.0.1:3000';
const expectedHash = 'e535510bbde478a0d76d6656c2d0f48d7f743fc8bc513e51870d8e3043674927';
const expectedUrl =
  'https://github.com/NammuOS/nammu-notes/releases/download/v1.0.0/os.nammu.notes-1.0.0-signed.napp';
const expectedPermissions = [
  'Copy text',
  'Save private app data',
  'Save selected files',
  'Migrate legacy data',
  'Read private app data',
  'Manage its window',
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
    root: join(workspace, 'tests/browser/store-remote-runtime'),
    plugins: [react()],
    resolve: { alias: { '@': join(workspace, 'src') } },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [workspace] },
      proxy: { '/api': { target: origin.origin, changeOrigin: false } },
    },
    logLevel: 'error',
  });
  await server.listen();
  const harnessOrigin = server.resolvedUrls?.local[0];
  assert.ok(harnessOrigin, 'Vite did not publish a loopback acceptance URL.');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(harnessOrigin, { waitUntil: 'domcontentloaded', timeout: 15_000 });

  const state = () => page.evaluate(() => window.__remoteStoreAcceptance);
  const waitForInstalled = () =>
    page.waitForFunction(
      () => window.__remoteStoreAcceptance?.record?.state === 'Installed',
      undefined,
      { timeout: 30_000 },
    );
  const waitForUninstalled = () =>
    page.waitForFunction(() => window.__remoteStoreAcceptance?.record === null, undefined, {
      timeout: 15_000,
    });
  const reviewAndConfirm = async (action) => {
    const dialog = page.getByRole('dialog', { name: 'Review permissions' });
    await dialog.waitFor({ timeout: 30_000 });
    const labels = (
      await dialog.locator('.nammu-store-permission strong').allTextContents()
    ).sort();
    assert.deepEqual(
      labels,
      expectedPermissions,
      'Permission review must come from the package manifest.',
    );
    await dialog.getByRole('button', { name: action, exact: true }).click();
  };
  const openNotes = async () => {
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('[data-acceptance-notes] iframe').waitFor({ timeout: 15_000 });
    const notes = page.frameLocator('[data-acceptance-notes] iframe');
    await notes.locator('[data-title]').waitFor({ timeout: 15_000 });
    return notes;
  };
  const closeNotes = async () => {
    await page.evaluate(() => window.__closeAcceptedNotes?.());
    await page.locator('[data-acceptance-notes]').waitFor({ state: 'detached' });
  };

  await page.waitForFunction(() =>
    Object.prototype.hasOwnProperty.call(window.__remoteStoreAcceptance ?? {}, 'record'),
  );
  assert.equal((await state())?.record, null, 'Acceptance must begin with Notes not installed.');

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

  let notes = await openNotes();
  await notes.locator('[data-title]').fill('Remote Store acceptance note');
  await notes
    .locator('[data-content]')
    .fill('Installed from the immutable GitHub Release through the Nammu Store delivery route.');
  await page.waitForFunction(
    () =>
      window.__remoteStoreAcceptance?.notes?.notes?.some(
        (note) => note.title === 'Remote Store acceptance note',
      ),
    undefined,
    { timeout: 10_000 },
  );
  await closeNotes();
  notes = await openNotes();
  assert.equal(await notes.locator('[data-title]').inputValue(), 'Remote Store acceptance note');
  await closeNotes();

  await page.getByRole('button', { name: 'Repair installation', exact: true }).click();
  await reviewAndConfirm('Repair');
  await waitForInstalled();
  await page.waitForFunction(() => window.__remoteStoreAcceptance?.packageRequests === 2);
  notes = await openNotes();
  assert.equal(await notes.locator('[data-title]').inputValue(), 'Remote Store acceptance note');
  await closeNotes();

  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  const uninstallDialog = page.getByRole('alertdialog', { name: 'Uninstall Notes?' });
  await uninstallDialog.waitFor();
  await uninstallDialog.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await waitForUninstalled();
  assert.ok(
    (await state())?.notes?.notes?.some((note) => note.title === 'Remote Store acceptance note'),
    'Uninstall must retain Notes userdata.',
  );

  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await reviewAndConfirm('Install');
  await waitForInstalled();
  await page.waitForFunction(() => window.__remoteStoreAcceptance?.packageRequests === 3);
  notes = await openNotes();
  assert.equal(await notes.locator('[data-title]').inputValue(), 'Remote Store acceptance note');

  acceptance = await state();
  assert.equal(acceptance?.record?.packageHash, expectedHash);
  assert.equal(acceptance?.record?.signatureVerified, true);
  assert.equal(acceptance?.packageRequests, 3);
  assert.deepEqual(pageErrors, []);

  process.stdout.write(
    JSON.stringify({
      status: 'ok',
      route: '/api/app-store/packages/os.nammu.notes/1.0.0',
      packageUrl: expectedUrl,
      sha256: expectedHash,
      packageRequests: acceptance?.packageRequests,
      signatureVerified: acceptance?.record?.signatureVerified,
      publisher: acceptance?.record?.publisher,
      lifecycle: [
        'remote-install',
        'sandbox-launch',
        'edit-persist',
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
