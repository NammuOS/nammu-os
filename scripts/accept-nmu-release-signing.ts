import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHelloNammuPackage } from '../tests/fixtures/helloNammuFixture';
import { unpackNapp } from '../src/platform/nmu/nappArchive';
import { getPublisherKeyring, OFFICIAL_NAMMU_KEY_ID } from '../src/platform/nmu/packageSecurity';
import { signOfficialNapp } from './sign-nammu-release';

const privateKeyPath = process.env.NAMMU_RELEASE_PRIVATE_KEY_PATH;
if (!privateKeyPath) {
  throw new Error('NAMMU_RELEASE_PRIVATE_KEY_PATH is required for release-signing acceptance.');
}

const unsignedPackage = createHelloNammuPackage({
  appId: 'os.nammu.signing-acceptance',
  publisher: 'nammu-official',
  publisherKeyId: OFFICIAL_NAMMU_KEY_ID,
});
const privateKey = await readFile(resolve(privateKeyPath));
const signedPackage = await signOfficialNapp(unsignedPackage, privateKey);
const unpacked = await unpackNapp(signedPackage);
const trust = await getPublisherKeyring().verifyPackageTrust(
  unpacked.manifest,
  unpacked.files,
  unpacked.signature,
);

if (!trust.verified || !trust.isOfficial || trust.keyId !== OFFICIAL_NAMMU_KEY_ID) {
  throw new Error('Signed package did not verify as the configured official Nammu identity.');
}

process.stdout.write(
  `NMU release-signing acceptance passed for ${unpacked.manifest.id} with ${trust.keyId}.\n`,
);
