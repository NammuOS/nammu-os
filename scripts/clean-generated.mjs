import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const fixedTargets = [
  '.next',
  'dist-desktop',
  'src-tauri/resources/local-server',
  'tsconfig.tsbuildinfo',
  '.codex-temp',
];

const generatedRootEntries = readdirSync(repositoryRoot).filter(
  (name) => name.startsWith('.codex-edge-') || /^\.codex-horizon-.*\.png$/u.test(name),
);

function removeGeneratedTarget(relativePath) {
  const target = resolve(repositoryRoot, relativePath);
  const targetRelativePath = relative(repositoryRoot, target);

  if (
    !targetRelativePath ||
    targetRelativePath.startsWith('..') ||
    targetRelativePath === '.' ||
    target === repositoryRoot
  ) {
    throw new Error(`Refusing to clean unsafe path: ${relativePath}`);
  }

  if (!existsSync(target)) return false;

  rmSync(target, { force: true, recursive: true });
  return true;
}

const removed = [...fixedTargets, ...generatedRootEntries].filter(removeGeneratedTarget);

if (removed.length === 0) {
  console.log('Generated web, desktop, staging, and QA outputs are already clean.');
} else {
  console.log(`Removed ${removed.length} generated path${removed.length === 1 ? '' : 's'}:`);
  for (const target of removed) console.log(`- ${target}`);
}

console.log('Installed dependencies, source files, donor repositories, and user data were preserved.');
