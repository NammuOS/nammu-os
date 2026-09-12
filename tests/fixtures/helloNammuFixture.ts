/**
 * Test Fixture: Hello Nammu Reference Application Package Generator
 *
 * Constructs deterministic, hardened .napp packages for dev.nammu.hello,
 * including linked app/main.js logic that drives real sandbox operations,
 * and optional Ed25519 cryptographic signing.
 */

import { packNapp } from '@/platform/nmu/nappArchive';
import type {
  NammuAppManifest,
  NappSignatureEnvelope,
  PermissionIdentifier,
} from '@/platform/nmu/nappSpec';
import { computeCanonicalPayloadDigest } from '@/platform/nmu/packageSecurity';

export const TEST_NAMMU_KEY_ID = 'nammu-test-fixture-2026';
export const TEST_NAMMU_PUBLIC_KEY_HEX =
  'b35d1af8342cdd057b0a2f5a3ceb0976bd71b4f3082d6b3f4143756d59ffe9f7';
const TEST_NAMMU_PRIVATE_KEY_PKCS8_HEX =
  '302e020100300506032b65700422042016c8846a02e5ee54f70096580f9e9b9dc48fbc36404016c5508c916e9f167283';

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signTestDigest(privateKeyPkcs8Hex: string, digestHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    hexToBytes(privateKeyPkcs8Hex) as unknown as ArrayBuffer,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(digestHex));
  return bytesToHex(new Uint8Array(signature));
}

export interface FixtureOptions {
  appId?: string;
  name?: string;
  version?: string;
  manifestVersion?: any;
  minNammuVersion?: string;
  dataSchemaVersion?: number;
  permissions?: PermissionIdentifier[];
  runtime?: any;
  entry?: string;
  customFiles?: Record<string, string>;
  publisher?: string;
  publisherKeyId?: string;
}

export function createHelloNammuManifest(options: FixtureOptions = {}): NammuAppManifest {
  return {
    manifestVersion: options.manifestVersion !== undefined ? options.manifestVersion : 1,
    id: options.appId || 'dev.nammu.hello',
    name: options.name || 'Hello Nammu',
    version: options.version || '1.0.0',
    runtime: options.runtime || 'web',
    entry: options.entry || 'app/index.html',
    minNammuVersion: options.minNammuVersion || '0.8.0',
    dataSchemaVersion: options.dataSchemaVersion !== undefined ? options.dataSchemaVersion : 1,
    permissions: options.permissions || [
      'notifications.send',
      'filesystem.appdata.read',
      'filesystem.appdata.write',
    ],
    publisher: options.publisher || 'dev.nammu',
    publisherKeyId: options.publisherKeyId || 'dev-key-1',
  };
}

export function createHelloNammuPackage(options: FixtureOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const manifest = createHelloNammuManifest(options);

  const defaultHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${manifest.name}</title>
</head>
<body>
  <h1>${manifest.name} v${manifest.version}</h1>
  <div id="root"></div>
  <script src="main.js"></script>
</body>
</html>`;

  const defaultJs = `
(function() {
  async function runHello() {
    var transport = window.__NAMMU_IPC_TRANSPORT__;
    if (!transport) return;

    var reqCounter = 0;
    function call(method, params) {
      return new Promise(function(resolve, reject) {
        var id = 'call_' + (++reqCounter) + '_' + Date.now();
        var cleanup = transport.onMessage(function(msg) {
          if (msg && msg.id === id) {
            cleanup();
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        });
        transport.send({ id: id, method: method, params: params || {} });
      });
    }

    try {
      // 1. Set window title
      await call('window.setTitle', { title: 'Hello Nammu Active Workspace' });
      // 2. Persist setting
      await call('settings.set', { key: 'status', value: 'initialized' });
      // 3. Write userdata file
      await call('files.writeText', { path: 'welcome.txt', content: 'Welcome to NammuOS sandboxed ecosystem!' });
      // 4. Send notification
      await call('notifications.send', { title: 'Hello Nammu', body: 'Application loaded and active' });
      // 5. Acknowledge startup readiness
      await call('app.ready', {});
    } catch (e) {
      console.error('[Hello Nammu Exec Error]', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runHello);
  } else {
    runHello();
  }
})();
`;

  const files = [
    {
      path: 'nammu.app.json',
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
    },
    {
      path: 'app/index.html',
      data: encoder.encode(defaultHtml),
    },
    {
      path: 'app/main.js',
      data: encoder.encode(defaultJs),
    },
  ];

  if (options.customFiles) {
    for (const [subpath, content] of Object.entries(options.customFiles)) {
      files.push({
        path: subpath,
        data: encoder.encode(content),
      });
    }
  }

  return packNapp(files);
}

export interface SignedPackageOptions extends FixtureOptions {
  privateKeyPkcs8Hex?: string;
  publicKeyRawHex?: string;
}

/**
 * Creates a cryptographically signed .napp package
 */
export async function createSignedHelloNammuPackage(
  options: SignedPackageOptions = {},
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const manifest = createHelloNammuManifest(options);

  const isOfficial = manifest.id.startsWith('os.nammu.');
  if (isOfficial && options.publisher === undefined) manifest.publisher = 'nammu-official';
  const keyId = options.publisherKeyId || (isOfficial ? TEST_NAMMU_KEY_ID : 'dev-key-1');
  manifest.publisherKeyId = keyId;

  const privKey = options.privateKeyPkcs8Hex || TEST_NAMMU_PRIVATE_KEY_PKCS8_HEX;
  const pubKey = options.publicKeyRawHex || TEST_NAMMU_PUBLIC_KEY_HEX;

  const defaultHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${manifest.name}</title>
</head>
<body>
  <h1>${manifest.name} v${manifest.version}</h1>
  <script src="main.js"></script>
</body>
</html>`;

  const defaultJs = `
// Sandboxed Hello Nammu
console.log("Signed Hello Nammu Loaded");
`;

  const files = [
    {
      path: 'nammu.app.json',
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
    },
    {
      path: 'app/index.html',
      data: encoder.encode(defaultHtml),
    },
    {
      path: 'app/main.js',
      data: encoder.encode(defaultJs),
    },
  ];

  if (options.customFiles) {
    for (const [subpath, content] of Object.entries(options.customFiles)) {
      files.push({
        path: subpath,
        data: encoder.encode(content),
      });
    }
  }

  // 1. Calculate canonical payload digest EXCLUDING signature.json
  const canonicalDigest = await computeCanonicalPayloadDigest(files);

  // 2. Sign canonical digest with Ed25519
  const signatureHex = await signTestDigest(privKey, canonicalDigest);

  // 3. Create signature envelope
  const signatureEnvelope: NappSignatureEnvelope = {
    version: 1,
    algorithm: 'Ed25519',
    keyId,
    publisher: manifest.publisher || (isOfficial ? 'nammu-official' : 'developer'),
    digest: canonicalDigest,
    signature: signatureHex,
    timestamp: new Date().toISOString(),
    publicKeyRawHex: pubKey,
  };

  // 4. Add signature.json to files and pack
  files.push({
    path: 'signature.json',
    data: encoder.encode(JSON.stringify(signatureEnvelope, null, 2)),
  });

  return packNapp(files);
}
