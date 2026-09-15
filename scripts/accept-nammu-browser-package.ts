import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { InMemoryNMUDatabase } from '../src/platform/nmu/nmuDatabase';
import { NMUEngine } from '../src/platform/nmu/nmuEngine';
import { getPublisherKeyring } from '../src/platform/nmu/packageSecurity';
import { InMemoryNammuVFS } from '../src/platform/vfs/nammuVFS';
import { signOfficialNapp } from './sign-nammu-release';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserRepository = resolve(workspace, '..', 'nammu-browser');
const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;

if (!privateKeyPath) {
  throw new Error('NAMMU_RELEASE_PRIVATE_KEY_PATH is required for Browser package acceptance.');
}
const configuredPrivateKeyPath = resolve(privateKeyPath);

async function buildSignedVersion(version: string): Promise<Uint8Array> {
  const result = spawnSync(process.execPath, ['run', 'build'], {
    cwd: browserRepository,
    env: { ...process.env, NAMMU_BROWSER_VERSION: version },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Browser ${version} build failed: ${result.stderr || result.stdout}`);
  }
  const [archive, privateKey] = await Promise.all([
    readFile(join(browserRepository, 'dist', `os.nammu.browser-${version}-unsigned.napp`)),
    readFile(configuredPrivateKeyPath),
  ]);
  return signOfficialNapp(archive, privateKey);
}

const immutableV100Url =
  'https://github.com/NammuOS/nammu-browser/releases/download/v1.0.0/os.nammu.browser-1.0.0-signed.napp';
const immutableV100Sha256 = '541af4d497a43e7c2576ff3bd061565dc6fed07a84cd34019ba267a39d364ea6';
const versionOneResponse = await fetch(immutableV100Url, { redirect: 'follow' });
if (!versionOneResponse.ok) {
  throw new Error(`Immutable Browser v1.0.0 download failed (${versionOneResponse.status}).`);
}
const versionOne = new Uint8Array(await versionOneResponse.arrayBuffer());
if (createHash('sha256').update(versionOne).digest('hex') !== immutableV100Sha256) {
  throw new Error('Immutable Browser v1.0.0 digest changed.');
}
const versionTwo = await buildSignedVersion('1.0.1');
const vfs = new InMemoryNammuVFS();
const database = new InMemoryNMUDatabase();
const engine = new NMUEngine(vfs, database, getPublisherKeyring());
const approvedPermissions = [
  'filesystem.user-selected.read',
  'filesystem.user-selected.write',
  'clipboard.read',
  'clipboard.write',
  'migration.legacy-storage',
  'integration.web-surfaces',
  'integration.services',
  'window.manage',
] as const;

const installed = await engine.install(versionOne, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
if (
  installed.appId !== 'os.nammu.browser' ||
  installed.version !== '1.0.0' ||
  !installed.signatureVerified ||
  !installed.isOfficial
) {
  throw new Error('Browser did not install as the expected verified official package.');
}
if (!installed.capabilities?.some((capability) => capability.type === 'web-surface')) {
  throw new Error('Browser lost its generic packaged WebSurface declaration.');
}

const data = vfs.createScopedVFS('os.nammu.browser');
const durableBookmarks = JSON.stringify([
  { id: 'acceptance', title: 'Nammu', url: 'https://example.com/' },
]);
await data.writeUserData('settings.json', JSON.stringify({ nammu_browser_bookmarks: durableBookmarks }));

const activating = await engine.update('os.nammu.browser', versionTwo);
if (activating.state !== 'Activating' || activating.version !== '1.0.1') {
  throw new Error('Browser update did not enter guarded activation.');
}
await engine.acknowledgeActivation('os.nammu.browser');
if ((await engine.rollback('os.nammu.browser')).version !== '1.0.0') {
  throw new Error('Browser rollback did not restore version 1.0.0.');
}

const forwardUpdate = await engine.update('os.nammu.browser', versionTwo);
if (forwardUpdate.state !== 'Activating' || forwardUpdate.version !== '1.0.1') {
  throw new Error('Browser forward update did not reactivate v1.0.1.');
}
await engine.acknowledgeActivation('os.nammu.browser');

await engine.repair('os.nammu.browser', versionTwo);
if ((await database.getApp('os.nammu.browser'))?.state !== 'Installed') {
  throw new Error('Browser repair did not leave the package installed.');
}

await engine.uninstall('os.nammu.browser', { purgeUserData: false });
if (await vfs.exists('/applications/os.nammu.browser')) {
  throw new Error('Browser package files survived uninstall.');
}
if (!(await vfs.exists('/userdata/os.nammu.browser/settings.json'))) {
  throw new Error('Browser user data was removed by data-retaining uninstall.');
}

await engine.install(versionTwo, {
  sourceRegistry: 'official',
  approvedPermissions: [...approvedPermissions],
});
const restoredSettings = JSON.parse(await data.readUserDataText('settings.json')) as Record<
  string,
  unknown
>;
if (restoredSettings.nammu_browser_bookmarks !== durableBookmarks) {
  throw new Error('Browser user data was not recovered after reinstall.');
}

process.stdout.write(
  'Nammu Browser package acceptance passed: immutable v1.0.0 install, signed v1.0.1 update, rollback, forward update, repair, data-retaining uninstall, v1.0.1 reinstall, and recovery.\n',
);
