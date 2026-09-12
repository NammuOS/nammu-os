import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryNMUDatabase } from '../src/platform/nmu/nmuDatabase';
import { NMUEngine } from '../src/platform/nmu/nmuEngine';
import { getPublisherKeyring } from '../src/platform/nmu/packageSecurity';
import { InMemoryNammuVFS } from '../src/platform/vfs/nammuVFS';
import { signOfficialNapp } from './sign-nammu-release';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const notesRepository = resolve(workspace, '..', 'nammu-notes');
const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;

if (!privateKeyPath) {
  throw new Error('NAMMU_RELEASE_PRIVATE_KEY_PATH is required for Notes package acceptance.');
}
const configuredPrivateKeyPath = resolve(privateKeyPath);

async function buildSignedVersion(version: string): Promise<Uint8Array> {
  const result = spawnSync(process.execPath, ['run', 'build'], {
    cwd: notesRepository,
    env: { ...process.env, NAMMU_NOTES_VERSION: version },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Notes ${version} build failed: ${result.stderr || result.stdout}`);
  }
  const unsignedPath = join(notesRepository, 'dist', `os.nammu.notes-${version}-unsigned.napp`);
  const [unsignedArchive, privateKey] = await Promise.all([
    readFile(unsignedPath),
    readFile(configuredPrivateKeyPath),
  ]);
  return signOfficialNapp(unsignedArchive, privateKey);
}

const versionOne = await buildSignedVersion('1.0.0');
const versionTwo = await buildSignedVersion('1.1.0');
const vfs = new InMemoryNammuVFS();
const database = new InMemoryNMUDatabase();
const engine = new NMUEngine(vfs, database, getPublisherKeyring());
const approvedPermissions = ['clipboard.write', 'filesystem.user-selected.write'] as const;

const installed = await engine.install(versionOne, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
if (!installed.signatureVerified || !installed.isOfficial || installed.version !== '1.0.0') {
  throw new Error('Notes did not install as a verified official package.');
}
if (!installed.grantedPermissions.includes('clipboard.write')) {
  throw new Error('Notes clipboard permission was not granted explicitly.');
}

const data = vfs.createScopedVFS('os.nammu.notes');
const durableNote = JSON.stringify({
  schemaVersion: 1,
  notes: [{ id: 'acceptance', title: 'Durable note', content: 'Keep me across lifecycle.' }],
});
await data.writeUserData('notes.json', durableNote);

const activating = await engine.update('os.nammu.notes', versionTwo);
if (activating.state !== 'Activating' || activating.version !== '1.1.0') {
  throw new Error('Notes update did not enter guarded activation.');
}
await engine.acknowledgeActivation('os.nammu.notes');
if ((await database.getApp('os.nammu.notes'))?.state !== 'Installed') {
  throw new Error('Notes update health acknowledgement did not commit.');
}
if ((await engine.rollback('os.nammu.notes')).version !== '1.0.0') {
  throw new Error('Notes rollback did not restore the previous package.');
}
if ((await data.readUserDataText('notes.json')) !== durableNote) {
  throw new Error('Notes data changed during update/rollback.');
}

await engine.uninstall('os.nammu.notes', { purgeUserData: false });
if (await vfs.exists('/applications/os.nammu.notes')) {
  throw new Error('Notes package files survived uninstall.');
}
if (!(await vfs.exists('/userdata/os.nammu.notes/notes.json'))) {
  throw new Error('Notes data was removed by the default uninstall policy.');
}

await engine.install(versionOne, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
if ((await data.readUserDataText('notes.json')) !== durableNote) {
  throw new Error('Notes data was not recovered after reinstall.');
}

process.stdout.write(
  'Nammu Notes package acceptance passed: official signature, install, guarded update, rollback, data-retaining uninstall, reinstall, and data recovery.\n',
);
