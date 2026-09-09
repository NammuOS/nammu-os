import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = join(repositoryRoot, 'src-tauri', 'resources', 'local-server');
const appRoot = join(resourceRoot, 'app');
const desktopBundle = join(repositoryRoot, 'dist-desktop');
const releaseExecutable = process.env.NAMMU_RELEASE_EXECUTABLE
  ? resolve(process.env.NAMMU_RELEASE_EXECUTABLE)
  : join(repositoryRoot, 'src-tauri', 'target', 'release', 'nammu-os.exe');
const tauriConfig = JSON.parse(
  readFileSync(join(repositoryRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const installer = process.env.NAMMU_RELEASE_INSTALLER
  ? resolve(process.env.NAMMU_RELEASE_INSTALLER)
  : join(
      repositoryRoot,
      'src-tauri',
      'target',
      'release',
      'bundle',
      'nsis',
      `Nammu OS_${tauriConfig.version}_x64-setup.exe`,
    );
const requireInstaller = process.env.NAMMU_VERIFY_INSTALLER !== 'false';
const expectedRuntimePackages = [
  'better-sqlite3',
  'busboy',
  'next',
  'react',
  'react-dom',
];
const desktopClientMetadata = new Set([
  'GOOGLE_DESKTOP_CLIENT_ID',
  'GOOGLE_DESKTOP_CLIENT_SECRET',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesUnder(path) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function parseEnvironment(path) {
  if (!existsSync(path)) return [];
  const values = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (desktopClientMetadata.has(name)) continue;
    if (!/(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|REDIS_URL|ACCESS_KEY)/.test(name)) {
      continue;
    }
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length >= 8 && !/^your[-_]/i.test(value)) values.push({ name, value });
  }
  return values;
}

async function matchingSecretNames(path, secrets) {
  if (secrets.length === 0) return [];
  const needles = secrets.map(({ name, value }) => ({ name, bytes: Buffer.from(value) }));
  const overlap = Math.max(...needles.map(({ bytes }) => bytes.length)) - 1;
  const matched = new Set();
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(path)) {
    const combined = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    for (const { name, bytes } of needles) {
      if (!matched.has(name) && combined.indexOf(bytes) !== -1) matched.add(name);
    }
    carry =
      overlap > 0 ? combined.subarray(Math.max(0, combined.length - overlap)) : Buffer.alloc(0);
  }
  return [...matched];
}

for (const required of [
  resourceRoot,
  desktopBundle,
  releaseExecutable,
  ...(requireInstaller ? [installer] : []),
  join(resourceRoot, 'runtime', 'node.exe'),
]) {
  assert(
    existsSync(required),
    `Required desktop release artifact is missing: ${relative(repositoryRoot, required)}`,
  );
}

assert(
  !existsSync(join(desktopBundle, 'firefox-wasm')),
  'The Desktop bundle must not contain the Web-only Gecko/WASM runtime.',
);

const runtimeManifest = JSON.parse(readFileSync(join(resourceRoot, 'manifest.json'), 'utf8'));
assert(
  runtimeManifest.strategy === 'packaged-node-resource-v1',
  'The packaged runtime strategy is invalid.',
);
assert(
  runtimeManifest.target === 'win32-x64',
  'The packaged runtime is not the Windows x64 target.',
);

const runtimePackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
assert(runtimePackage.private === true, 'The packaged local server must remain private.');
assert(
  !runtimePackage.devDependencies,
  'The packaged local server contains development dependencies.',
);
assert(
  JSON.stringify(Object.keys(runtimePackage.dependencies || {}).sort()) ===
    JSON.stringify([...expectedRuntimePackages].sort()),
  'The packaged local server dependency allowlist changed.',
);

const providerConfig = JSON.parse(
  readFileSync(join(appRoot, 'desktop-provider-config.json'), 'utf8'),
);
assert(
  JSON.stringify(Object.keys(providerConfig).sort()) ===
    JSON.stringify(['googleDesktopClientId', 'googleDesktopClientSecret']),
  'Desktop provider configuration contains an unexpected field.',
);
assert(
  providerConfig.googleDesktopClientId === null ||
    /^[A-Za-z0-9._-]{8,220}\.apps\.googleusercontent\.com$/.test(
      providerConfig.googleDesktopClientId,
    ),
  'Desktop provider configuration contains an invalid public client ID.',
);
assert(
  providerConfig.googleDesktopClientSecret === null ||
    /^[A-Za-z0-9._-]{8,512}$/.test(providerConfig.googleDesktopClientSecret),
  'Desktop provider configuration contains invalid Desktop client metadata.',
);
assert(
  (providerConfig.googleDesktopClientId === null) ===
    (providerConfig.googleDesktopClientSecret === null),
  'Desktop Google OAuth client metadata must be configured as a complete pair.',
);

const stagedFiles = filesUnder(resourceRoot);
const forbiddenEnvironmentFiles = stagedFiles.filter((path) =>
  /^\.env(?:\.|$)/.test(basename(path)),
);
assert(
  forbiddenEnvironmentFiles.length === 0,
  `Environment files were packaged: ${forbiddenEnvironmentFiles
    .map((path) => relative(repositoryRoot, path))
    .join(', ')}`,
);
assert(
  stagedFiles.some((path) => path.endsWith('.node') && path.includes('better-sqlite3')),
  'The packaged better-sqlite3 native binding is missing.',
);
assert(
  stagedFiles.every((path) => !path.endsWith('.map')),
  'Generated JavaScript source maps must not be shipped in the desktop local runtime.',
);
assert(
  Number.isInteger(runtimeManifest.prunedSourceMaps?.files) &&
    runtimeManifest.prunedSourceMaps.files > 0 &&
    Number.isInteger(runtimeManifest.prunedSourceMaps?.bytes) &&
    runtimeManifest.prunedSourceMaps.bytes > 0,
  'The packaged runtime manifest is missing source-map pruning evidence.',
);

const secrets = parseEnvironment(join(repositoryRoot, '.env'));
const scanTargets = [
  ...filesUnder(resourceRoot),
  ...filesUnder(desktopBundle),
  releaseExecutable,
  ...(requireInstaller ? [installer] : []),
];
const leaks = [];
for (const path of scanTargets) {
  const names = await matchingSecretNames(path, secrets);
  for (const name of names) leaks.push({ name, file: relative(repositoryRoot, path) });
}
assert(
  leaks.length === 0,
  `Sensitive environment values were packaged: ${leaks
    .map(({ name, file }) => `${name} in ${file}`)
    .join(', ')}`,
);

const providerConfigPath = join(appRoot, 'desktop-provider-config.json');
const metadataValue = providerConfig.googleDesktopClientSecret;
if (metadataValue !== null) {
  const metadataNeedle = [{ name: 'GOOGLE_DESKTOP_CLIENT_SECRET', value: metadataValue }];
  const unintendedMetadataTargets = [
    ...stagedFiles.filter((path) => path !== providerConfigPath),
    ...filesUnder(desktopBundle),
  ];
  const unintendedMetadataMatches = [];
  for (const path of unintendedMetadataTargets) {
    const names = await matchingSecretNames(path, metadataNeedle);
    for (const name of names) {
      unintendedMetadataMatches.push({ name, file: relative(repositoryRoot, path) });
    }
  }
  assert(
    unintendedMetadataMatches.length === 0,
    `Desktop OAuth client metadata escaped its server-only configuration file: ${unintendedMetadataMatches
      .map(({ file }) => file)
      .join(', ')}`,
  );
}

const resourceBytes = stagedFiles.reduce((total, path) => total + statSync(path).size, 0);
console.info(
  JSON.stringify({
    status: 'ok',
    target: runtimeManifest.target,
    runtimeFiles: stagedFiles.length,
    runtimeBytes: resourceBytes,
    executableBytes: statSync(releaseExecutable).size,
    installerBytes: requireInstaller ? statSync(installer).size : null,
    installerVerification: requireInstaller ? 'verified' : 'not-requested',
    sensitiveConfigurationMatches: 0,
    desktopClientMetadataScope: 'local-server-config-only',
  }),
);
