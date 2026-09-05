import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(repositoryRoot, 'src-tauri', 'resources', 'local-server');
const appOutput = join(outputRoot, 'app');
const runtimeOutput = join(outputRoot, 'runtime');
const localServerRuntimePackages = [
  'better-sqlite3',
  'busboy',
  'next',
  'react',
  'react-dom',
];

function requireFile(path, purpose) {
  if (!existsSync(path)) {
    throw new Error(`${purpose} is missing: ${relative(repositoryRoot, path)}`);
  }
}

function ensureGeneratedTarget(path) {
  const relativePath = relative(repositoryRoot, path);
  if (!relativePath || relativePath.startsWith('..') || resolve(path) === repositoryRoot) {
    throw new Error(
      'Refusing to prepare the desktop server outside its generated resource folder.',
    );
  }
}

function pruneGeneratedSourceMaps(path) {
  let files = 0;
  let bytes = 0;

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const removed = pruneGeneratedSourceMaps(child);
      files += removed.files;
      bytes += removed.bytes;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.map')) continue;

    bytes += statSync(child).size;
    rmSync(child);
    files += 1;
  }

  return { files, bytes };
}

if (process.release.name !== 'node') {
  throw new Error('Run this preparation script with Node so process.execPath is the Node runtime.');
}

const nextBuild = join(repositoryRoot, '.next');
const buildIdPath = join(nextBuild, 'BUILD_ID');
requireFile(buildIdPath, 'The Next.js production build');
requireFile(join(repositoryRoot, 'server.mjs'), 'The custom server entrypoint');
requireFile(join(repositoryRoot, 'next.config.ts'), 'The Next.js configuration');

ensureGeneratedTarget(outputRoot);
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(appOutput, { recursive: true });
mkdirSync(runtimeOutput, { recursive: true });

cpSync(nextBuild, join(appOutput, '.next'), {
  recursive: true,
  filter: (source) =>
    !source.includes(`${join('.next', 'cache')}`) && !source.includes(`${join('.next', 'dev')}`),
});
copyFileSync(join(repositoryRoot, 'server.mjs'), join(appOutput, 'server.mjs'));
copyFileSync(join(repositoryRoot, 'next.config.ts'), join(appOutput, 'next.config.ts'));
cpSync(
  join(repositoryRoot, 'src', 'server', 'runtime'),
  join(appOutput, 'src', 'server', 'runtime'),
  { recursive: true },
);
mkdirSync(join(appOutput, 'src', 'server', 'services'), { recursive: true });
copyFileSync(
  join(repositoryRoot, 'src', 'server', 'services', 'settingsPayloads.mjs'),
  join(appOutput, 'src', 'server', 'services', 'settingsPayloads.mjs'),
);

if (
  (!process.env.GOOGLE_DESKTOP_CLIENT_ID || !process.env.GOOGLE_DESKTOP_CLIENT_SECRET) &&
  existsSync(join(repositoryRoot, '.env'))
) {
  process.loadEnvFile(join(repositoryRoot, '.env'));
}
const googleDesktopClientId = process.env.GOOGLE_DESKTOP_CLIENT_ID || null;
const googleDesktopClientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET || null;
if (
  googleDesktopClientId !== null &&
  !/^[A-Za-z0-9._-]{8,220}\.apps\.googleusercontent\.com$/.test(googleDesktopClientId)
) {
  throw new Error('GOOGLE_DESKTOP_CLIENT_ID is not a valid Google desktop OAuth client ID.');
}
if (
  googleDesktopClientSecret !== null &&
  !/^[A-Za-z0-9._-]{8,512}$/.test(googleDesktopClientSecret)
) {
  throw new Error('GOOGLE_DESKTOP_CLIENT_SECRET is not valid Google desktop OAuth metadata.');
}
if ((googleDesktopClientId === null) !== (googleDesktopClientSecret === null)) {
  throw new Error(
    'Google desktop OAuth requires both GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET.',
  );
}
writeFileSync(
  join(appOutput, 'desktop-provider-config.json'),
  `${JSON.stringify({ googleDesktopClientId, googleDesktopClientSecret }, null, 2)}\n`,
);

const runtimeName = process.platform === 'win32' ? 'node.exe' : 'node';
copyFileSync(process.execPath, join(runtimeOutput, runtimeName));

const runtimeDependencies = Object.fromEntries(
  localServerRuntimePackages.map((packageName) => {
    const packageManifestPath = join(repositoryRoot, 'node_modules', packageName, 'package.json');
    requireFile(packageManifestPath, `The installed ${packageName} package`);
    const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    return [packageName, packageManifest.version];
  }),
);
writeFileSync(
  join(appOutput, 'package.json'),
  `${JSON.stringify(
    {
      name: 'nammu-local-server-runtime',
      private: true,
      type: 'module',
      dependencies: runtimeDependencies,
    },
    null,
    2,
  )}\n`,
);

const install = spawnSync('bun', ['install', '--production', '--exact'], {
  cwd: appOutput,
  encoding: 'utf8',
  shell: false,
  stdio: 'pipe',
});
if (install.status !== 0) {
  throw new Error(
    `The desktop production dependency tree could not be installed.\n${install.stdout}\n${install.stderr}`,
  );
}

const runtimePath = join(runtimeOutput, runtimeName);
const smoke = spawnSync(
  runtimePath,
  [
    '-e',
    "Promise.all([import('next'), import('busboy')]); const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('select 1'); db.close();",
  ],
  {
    cwd: appOutput,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  },
);
if (smoke.status !== 0) {
  throw new Error(
    `The packaged Node/Next/SQLite runtime probe failed.\n${smoke.stdout}\n${smoke.stderr}`,
  );
}

// Source maps are useful on developer machines but are not executable runtime
// inputs. Pruning them only from this regenerated staging directory keeps the
// installed application smaller without mutating dependencies or source files.
const prunedSourceMaps = pruneGeneratedSourceMaps(outputRoot);

const manifest = {
  strategy: 'packaged-node-resource-v1',
  nodeVersion: process.version,
  target: `${process.platform}-${process.arch}`,
  buildId: readFileSync(buildIdPath, 'utf8').trim(),
  runtimePackages: runtimeDependencies,
  prunedSourceMaps,
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.info(
  `Prepared desktop local server at ${relative(repositoryRoot, outputRoot)}; removed ${prunedSourceMaps.files} generated source maps (${prunedSourceMaps.bytes} bytes).`,
);
