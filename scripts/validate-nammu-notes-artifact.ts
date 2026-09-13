import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unpackNapp } from '../src/platform/nmu/nappArchive';
import { validateNammuAppManifest } from '../src/platform/nmu/manifestValidator';
import { getPublisherKeyring, OFFICIAL_NAMMU_KEY_ID } from '../src/platform/nmu/packageSecurity';
import { InMemoryNMUDatabase } from '../src/platform/nmu/nmuDatabase';
import { NMUEngine } from '../src/platform/nmu/nmuEngine';
import { InMemoryNammuVFS } from '../src/platform/vfs/nammuVFS';

const EXPECTED_HASH = 'e535510bbde478a0d76d6656c2d0f48d7f743fc8bc513e51870d8e3043674927';
const EXPECTED_COMMIT = 'c365318e1cf11d42f41e77ff4a30a2ba65cb566a';
const EXPECTED_APP_ID = 'os.nammu.notes';
const EXPECTED_VERSION = '1.0.0';
const workspace = resolve(import.meta.dirname, '..');
const notesRepository = resolve(workspace, '..', 'nammu-notes');
const packagePath = resolve(
  process.env.NAMMU_NOTES_PACKAGE_PATH ??
    join(notesRepository, 'dist', 'os.nammu.notes-1.0.0-signed.napp'),
);

function git(...args: string[]): string {
  const result = spawnSync('git', ['-C', notesRepository, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Git provenance check failed: ${result.stderr}`);
  return result.stdout.trim();
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function configuredSensitiveValues(contents: string): Array<{ name: string; value: string }> {
  const desktopMetadata = new Set(['GOOGLE_DESKTOP_CLIENT_ID', 'GOOGLE_DESKTOP_CLIENT_SECRET']);
  const values: Array<{ name: string; value: string }> = [];
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || desktopMetadata.has(match[1])) continue;
    if (!/(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|REDIS_URL|ACCESS_KEY)/.test(match[1])) {
      continue;
    }
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length >= 8 && !/^your[-_]/i.test(value)) values.push({ name: match[1], value });
  }
  return values;
}

const packageBytes = new Uint8Array(await readFile(packagePath));
const archive = await unpackNapp(packageBytes);
if (archive.packageHash !== EXPECTED_HASH) {
  throw new Error(`Candidate SHA-256 mismatch: ${archive.packageHash}`);
}

const validation = validateNammuAppManifest(archive.manifest, { allowOfficialNamespace: true });
if (!validation.valid || !validation.manifest) {
  throw new Error(`Manifest validation failed: ${validation.errors.join('; ')}`);
}
const manifest = validation.manifest;
if (manifest.id !== EXPECTED_APP_ID || manifest.version !== EXPECTED_VERSION) {
  throw new Error(`Unexpected package identity: ${manifest.id}@${manifest.version}`);
}
if (manifest.publisher !== 'nammu-official' || manifest.publisherKeyId !== OFFICIAL_NAMMU_KEY_ID) {
  throw new Error('Package does not declare the current official Nammu publisher identity.');
}
const trust = await getPublisherKeyring().verifyPackageTrust(
  manifest,
  archive.files,
  archive.signature,
);
if (!trust.verified || !trust.isOfficial || trust.keyId !== OFFICIAL_NAMMU_KEY_ID) {
  throw new Error(`Production trust verification failed: ${trust.error ?? 'untrusted package'}`);
}

if (git('rev-parse', 'HEAD') !== EXPECTED_COMMIT)
  throw new Error('Notes HEAD is not the v1.0.0 source commit.');
if (git('rev-parse', 'v1.0.0^{commit}') !== EXPECTED_COMMIT) {
  throw new Error('Notes v1.0.0 tag does not resolve to the approved source commit.');
}
if (git('status', '--porcelain')) throw new Error('Notes tracked source is not clean.');

const sourceManifest = JSON.parse(await readFile(join(notesRepository, 'nammu.app.json'), 'utf8'));
const expectedFiles = new Map<string, Uint8Array>([
  ['nammu.app.json', new TextEncoder().encode(JSON.stringify(sourceManifest, null, 2))],
  ['app/index.html', new Uint8Array(await readFile(join(notesRepository, 'src', 'index.html')))],
  ['app/styles.css', new Uint8Array(await readFile(join(notesRepository, 'src', 'styles.css')))],
]);
const bundle = await Bun.build({
  entrypoints: [join(notesRepository, 'src', 'main.js')],
  target: 'browser',
  format: 'esm',
  minify: true,
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw new Error('Tagged Notes source did not bundle.');
expectedFiles.set('app/main.js', new Uint8Array(await bundle.outputs[0].arrayBuffer()));
for (const [path, expected] of expectedFiles) {
  const packaged = archive.files.get(path);
  if (!packaged || !bytesEqual(packaged, expected)) {
    throw new Error(`Package payload does not match tagged source output: ${path}`);
  }
}
const allowedPaths = new Set([...expectedFiles.keys(), 'signature.json']);
for (const path of archive.files.keys()) {
  if (!allowedPaths.has(path)) throw new Error(`Unexpected package payload file: ${path}`);
}

const environmentPath = join(workspace, '.env');
let environment = '';
try {
  environment = await readFile(environmentPath, 'utf8');
} catch {}
const packageText = new TextDecoder('utf-8', { fatal: false }).decode(packageBytes);
for (const { name, value } of configuredSensitiveValues(environment)) {
  if (packageText.includes(value))
    throw new Error(`Sensitive configuration entered package: ${name}`);
}
for (const forbidden of [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'refresh_token',
  'authorization_code',
  'pkce_verifier',
  'wisp_capability',
  'api_capability',
]) {
  if (packageText.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`Forbidden sensitive marker entered package: ${forbidden}`);
  }
}

const vfs = new InMemoryNammuVFS();
const database = new InMemoryNMUDatabase();
const engine = new NMUEngine(vfs, database, getPublisherKeyring());
const approvedPermissions = ['clipboard.write', 'filesystem.user-selected.write'] as const;
const installed = await engine.install(packageBytes, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
if (
  !installed.signatureVerified ||
  !installed.isOfficial ||
  installed.packageHash !== EXPECTED_HASH
) {
  throw new Error('Exact candidate did not install through the production nmu trust path.');
}
const data = vfs.createScopedVFS(EXPECTED_APP_ID);
const durableNote = JSON.stringify({
  schemaVersion: 1,
  notes: [{ id: 'exact', title: 'Exact artifact' }],
});
await data.writeUserData('notes.json', durableNote);
await engine.repair(EXPECTED_APP_ID, packageBytes);
if ((await data.readUserDataText('notes.json')) !== durableNote)
  throw new Error('Repair changed Notes data.');
await engine.uninstall(EXPECTED_APP_ID, { purgeUserData: false, purgeCache: true });
if (!(await vfs.exists(`/userdata/${EXPECTED_APP_ID}/notes.json`))) {
  throw new Error('Data-retaining uninstall removed Notes user data.');
}
await engine.install(packageBytes, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
if ((await data.readUserDataText('notes.json')) !== durableNote) {
  throw new Error('Exact-artifact reinstall did not recover Notes user data.');
}

process.stdout.write(
  JSON.stringify({
    status: 'ok',
    packageHash: archive.packageHash,
    appId: manifest.id,
    version: manifest.version,
    publisher: trust.publisher,
    keyId: trust.keyId,
    sourceCommit: EXPECTED_COMMIT,
    payloadFiles: archive.files.size,
    sensitiveMatches: 0,
    lifecycle: ['install', 'repair', 'uninstall-retain-data', 'reinstall-recover-data'],
  }) + '\n',
);
