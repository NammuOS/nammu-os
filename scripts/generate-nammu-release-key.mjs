import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, closeSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error('Pass an output directory outside the NammuOS repository.');
}

const resolvedOutput = resolve(outputDirectory);
const repositoryRoot = resolve(import.meta.dirname, '..');
if (
  resolvedOutput === repositoryRoot ||
  resolvedOutput.startsWith(`${repositoryRoot}\\`) ||
  resolvedOutput.startsWith(`${repositoryRoot}/`)
) {
  throw new Error('The release private key must be generated outside the NammuOS repository.');
}

mkdirSync(resolvedOutput, { recursive: true });

const privateKeyPath = join(resolvedOutput, 'official-ed25519-private.pk8');
const publicKeyPath = join(resolvedOutput, 'official-ed25519-public.raw');
if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
  throw new Error('Refusing to overwrite an existing release-signing keypair.');
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
const publicSpki = publicKey.export({ type: 'spki', format: 'der' });
const publicRaw = publicSpki.subarray(publicSpki.length - 32);

const privateFd = openSync(privateKeyPath, 'wx', 0o600);
try {
  writeFileSync(privateFd, privatePkcs8);
} finally {
  closeSync(privateFd);
}

const publicFd = openSync(publicKeyPath, 'wx', 0o644);
try {
  writeFileSync(publicFd, publicRaw);
} finally {
  closeSync(publicFd);
}

process.stdout.write(
  `${JSON.stringify({
    algorithm: 'Ed25519',
    publicKeyRawHex: publicRaw.toString('hex'),
    privateKeyPath,
    publicKeyPath,
  })}\n`,
);
