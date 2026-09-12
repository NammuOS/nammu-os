import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const workspace = process.cwd();
const notesRepository = resolve(workspace, '..', 'nammu-notes');
const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;
if (!privateKeyPath) throw new Error('NAMMU_RELEASE_PRIVATE_KEY_PATH is required.');

const unsignedPath = join(notesRepository, 'dist', 'os.nammu.notes-1.0.0-unsigned.napp');
const signedPath = join(notesRepository, 'dist', 'os.nammu.notes-1.0.0-signed.napp');
const build = spawnSync('bun', ['run', 'build'], {
  cwd: notesRepository,
  env: { ...process.env, NAMMU_NOTES_VERSION: '1.0.0' },
  encoding: 'utf8',
});
if (build.status !== 0) throw new Error(`Notes build failed: ${build.stderr || build.stdout}`);
await rm(signedPath, { force: true });
const sign = spawnSync('bun', ['run', 'nmu:release:sign', '--', unsignedPath, signedPath], {
  cwd: workspace,
  env: process.env,
  encoding: 'utf8',
});
if (sign.status !== 0) throw new Error(`Notes signing failed: ${sign.stderr || sign.stdout}`);
const signedArchive = await readFile(signedPath);

let server;
let browser;
try {
  server = await createServer({
    root: join(workspace, 'tests/browser/notes-package-runtime'),
    plugins: [react()],
    define: { __NOTES_NAPP_BASE64__: JSON.stringify(signedArchive.toString('base64')) },
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
  assert.ok(origin, 'Vite did not publish a loopback acceptance URL.');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForFunction(() => window.__notesAcceptance?.ready === true, undefined, {
    timeout: 15_000,
  });
  assert.equal((await page.evaluate(() => window.__notesAcceptance)).signatureVerified, true);
  assert.equal((await page.evaluate(() => window.__notesAcceptance)).legacyRemoved, true);

  const notes = page.frameLocator('iframe');
  assert.equal(await notes.locator('[data-title]').inputValue(), 'Legacy Core note');
  await notes.locator('[data-title]').fill('Independent package note');
  await notes
    .locator('[data-content]')
    .fill('This note was edited inside the real sandboxed package.');
  await page.waitForFunction(
    () =>
      window.__notesAcceptance?.notes?.notes?.some(
        (note) => note.title === 'Independent package note',
      ),
    undefined,
    { timeout: 10_000 },
  );

  await page.evaluate(() => window.__toggleNotes?.());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  await page.evaluate(() => window.__toggleNotes?.());
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1);
  await notes.locator('[data-title]').waitFor();
  assert.equal(await notes.locator('[data-title]').inputValue(), 'Independent package note');
  assert.deepEqual(pageErrors, []);

  process.stdout.write(
    'Nammu Notes sandbox acceptance passed: signed package install, AppSandboxHost launch, real editing, private userdata persistence, close, and reopen.\n',
  );
} finally {
  await browser?.close();
  await server?.close();
}
