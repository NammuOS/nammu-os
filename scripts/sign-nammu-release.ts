import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { packNapp, unpackNapp } from '../src/platform/nmu/nappArchive';
import {
  OFFICIAL_NAMMU_KEY_ID,
  OFFICIAL_NAMMU_PUBLIC_KEY_HEX,
} from '../src/platform/nmu/packageSecurity';
import type { NappSignatureEnvelope } from '../src/platform/nmu/nappSpec';

const OFFICIAL_PUBLISHER = 'nammu-official';

export async function signOfficialNapp(
  unsignedArchive: Uint8Array,
  privateKeyPkcs8: Uint8Array,
): Promise<Uint8Array> {
  const unpacked = await unpackNapp(unsignedArchive);
  if (unpacked.signature || unpacked.files.has('signature.json')) {
    throw new Error('Refusing to release-sign a package that already contains signature.json.');
  }
  if (!unpacked.manifest.id.startsWith('os.nammu.')) {
    throw new Error('Official release signing is restricted to the os.nammu.* namespace.');
  }
  if (
    unpacked.manifest.publisher !== OFFICIAL_PUBLISHER ||
    unpacked.manifest.publisherKeyId !== OFFICIAL_NAMMU_KEY_ID
  ) {
    throw new Error(
      'Package manifest does not declare the configured official publisher identity.',
    );
  }

  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8),
    type: 'pkcs8',
    format: 'der',
  });
  const publicSpki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const derivedPublicKey = publicSpki.subarray(publicSpki.length - 32).toString('hex');
  if (derivedPublicKey !== OFFICIAL_NAMMU_PUBLIC_KEY_HEX) {
    throw new Error('Release private key does not match the official public verification key.');
  }

  const signature = sign(null, Buffer.from(unpacked.digest, 'utf8'), privateKey).toString('hex');
  const envelope: NappSignatureEnvelope = {
    version: 1,
    algorithm: 'Ed25519',
    keyId: OFFICIAL_NAMMU_KEY_ID,
    publisher: OFFICIAL_PUBLISHER,
    digest: unpacked.digest,
    signature,
    timestamp: new Date().toISOString(),
  };

  const files = [...unpacked.files].map(([path, data]) => ({ path, data }));
  files.push({
    path: 'signature.json',
    data: new TextEncoder().encode(JSON.stringify(envelope, null, 2)),
  });
  return packNapp(files);
}

async function main(): Promise<void> {
  const [, , inputArgument, outputArgument] = process.argv;
  const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;
  if (!inputArgument || !outputArgument || !privateKeyPath) {
    throw new Error(
      'Usage: set NAMMU_RELEASE_PRIVATE_KEY_PATH outside the repository, then run sign-nammu-release.ts <unsigned.napp> <signed.napp>.',
    );
  }

  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  if (inputPath === outputPath) throw new Error('Input and output package paths must differ.');

  const [unsignedArchive, privateKeyPkcs8] = await Promise.all([
    readFile(inputPath),
    readFile(resolve(privateKeyPath)),
  ]);
  const signedArchive = await signOfficialNapp(unsignedArchive, privateKeyPkcs8);
  const temporaryOutput = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryOutput, signedArchive, { flag: 'wx' });
    await rename(temporaryOutput, outputPath);
  } finally {
    await rm(temporaryOutput, { force: true });
  }

  process.stdout.write(`Signed official package: ${outputPath}\n`);
}

if (import.meta.main) {
  await main();
}
