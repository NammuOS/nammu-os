import { readFileSync } from 'node:fs';

import { openDesktopDatabase } from '../../src/server/runtime/desktopDatabase.mjs';
import { createDesktopGoogleDriveService } from '../../src/server/runtime/desktopGoogleDrive.mjs';
import { GOOGLE_DESKTOP_OAUTH_SCOPE } from '../../src/server/runtime/desktopGoogleOAuth.mjs';

const [, , dataDirectory] = process.argv;
if (!dataDirectory) throw new Error('A Google Drive probe data path is required.');

const CLIENT_ID = '1234567890-native.apps.googleusercontent.com';
const CLIENT_SECRET = 'desktop-client-metadata-for-test';
const VAULT_KEY = Buffer.alloc(32, 17);
let refreshUsesClientMetadata = false;

function googleResponse(input, init) {
  const url = new URL(String(input));
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(init?.body));
    refreshUsesClientMetadata =
      body.get('client_id') === CLIENT_ID &&
      body.get('client_secret') === CLIENT_SECRET &&
      body.get('grant_type') === 'refresh_token' &&
      body.get('refresh_token') === 'initial-refresh-token';
    return new Response(
      JSON.stringify({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        scope: GOOGLE_DESKTOP_OAUTH_SCOPE,
        token_type: 'Bearer',
      }),
      { status: 200 },
    );
  }
  if (url.href === 'https://oauth2.googleapis.com/revoke') {
    if (!String(init?.body).includes('rotated-refresh-token')) {
      throw new Error('Disconnect did not revoke the rotated refresh token.');
    }
    return new Response('', { status: 200 });
  }
  if (url.pathname.endsWith('/about')) {
    return new Response(
      JSON.stringify({
        user: { emailAddress: 'desktop@example.com' },
        storageQuota: { limit: '1000000', usage: '250000' },
      }),
      { status: 200 },
    );
  }
  if (url.pathname.endsWith('/files/root')) {
    return new Response(JSON.stringify({ id: 'root-id' }), { status: 200 });
  }
  if (url.pathname.endsWith('/files')) {
    if (!String(url.searchParams.get('fields')).includes('sharedWithMeTime')) {
      throw new Error('The Drive index did not request Shared with me classification.');
    }
    const query = String(url.searchParams.get('q') || '');
    if (query.includes("'shared-folder-remote-id' in parents")) {
      return new Response(
        JSON.stringify({
          files: [
            {
              id: 'shared-video-remote-id',
              name: 'Shared Clip.mp4',
              mimeType: 'video/mp4',
              size: '2048',
              parents: ['shared-folder-remote-id'],
              createdTime: '2026-01-06T00:00:00.000Z',
              modifiedTime: '2026-01-07T00:00:00.000Z',
            },
            {
              id: 'shared-nested-folder-id',
              name: 'Edited',
              mimeType: 'application/vnd.google-apps.folder',
              parents: ['shared-folder-remote-id'],
              createdTime: '2026-01-06T00:00:00.000Z',
              modifiedTime: '2026-01-07T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (query.includes("'shared-nested-folder-id' in parents")) {
      return new Response(
        JSON.stringify({
          files: [
            {
              id: 'shared-nested-video-id',
              name: 'Final Cut.mp4',
              mimeType: 'video/mp4',
              size: '4096',
              parents: ['shared-nested-folder-id'],
              createdTime: '2026-01-08T00:00:00.000Z',
              modifiedTime: '2026-01-09T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        files: [
          {
            id: 'folder-remote-id',
            name: 'Documents',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['root-id'],
            createdTime: '2026-01-01T00:00:00.000Z',
            modifiedTime: '2026-01-02T00:00:00.000Z',
          },
          {
            id: 'file-remote-id',
            name: 'Plan.txt',
            mimeType: 'text/plain',
            size: '25',
            parents: ['folder-remote-id'],
            shared: true,
            createdTime: '2026-01-01T00:00:00.000Z',
            modifiedTime: '2026-01-03T00:00:00.000Z',
          },
          {
            id: 'shared-file-remote-id',
            name: 'Shared Brief.txt',
            mimeType: 'text/plain',
            size: '18',
            parents: ['external-parent-id'],
            shared: true,
            sharedWithMeTime: '2026-01-04T00:00:00.000Z',
            ownedByMe: false,
            createdTime: '2026-01-04T00:00:00.000Z',
            modifiedTime: '2026-01-05T00:00:00.000Z',
          },
          {
            id: 'shared-folder-remote-id',
            name: 'Luxury Clips',
            mimeType: 'application/vnd.google-apps.folder',
            shared: true,
            sharedWithMeTime: '2026-01-06T00:00:00.000Z',
            ownedByMe: false,
            createdTime: '2026-01-06T00:00:00.000Z',
            modifiedTime: '2026-01-07T00:00:00.000Z',
          },
        ],
      }),
      { status: 200 },
    );
  }
  throw new Error(`Unexpected Google request: ${url.origin}${url.pathname}`);
}

let database = openDesktopDatabase(dataDirectory, VAULT_KEY);
const drive = createDesktopGoogleDriveService({
  database,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  fetchImplementation: googleResponse,
  now: () => Date.parse('2026-02-01T00:00:00.000Z'),
});
const connected = await drive.completeAuthorization({
  tokens: {
    accessToken: 'initial-access-token',
    refreshToken: 'initial-refresh-token',
    expiresAt: Date.parse('2026-02-01T01:00:00.000Z'),
    scope: GOOGLE_DESKTOP_OAUTH_SCOPE,
    tokenType: 'Bearer',
  },
  label: 'Primary Drive',
});
const rootFiles = drive.listFiles({ path: '/' });
const childFiles = drive.listFiles({ path: '/Documents/' });
const sharedFiles = drive.listFiles({ shared: true });
const sharedFolder = sharedFiles.find((file) => file.remote_file_id === 'shared-folder-remote-id');
const sharedFolderChildren = await drive.listSharedFolder(sharedFolder.id);
const nestedFolder = sharedFolderChildren.find(
  (file) => file.remote_file_id === 'shared-nested-folder-id',
);
const nestedSharedChildren = await drive.listSharedFolder(nestedFolder.id);
const leakedSharedChildren = drive.listFiles({ path: '/Luxury Clips/' });
const accountRow = database.cloudAccounts.get(connected.account.id);
const credentialRef = accountRow.credential_ref;
database.close();

database = openDesktopDatabase(dataDirectory, VAULT_KEY);
const restartedDrive = createDesktopGoogleDriveService({
  database,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  fetchImplementation: googleResponse,
  now: () => Date.parse('2026-02-01T02:00:00.000Z'),
});
const restartAccounts = restartedDrive.listAccounts();
await restartedDrive.syncAll();
const rotated = database.credentials.retrieve(credentialRef);
database.credentials.store(credentialRef, { ...rotated, expiresAt: 0 });
const revokedDrive = createDesktopGoogleDriveService({
  database,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  fetchImplementation: (input, init) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    return googleResponse(input, init);
  },
  now: () => Date.parse('2026-02-01T03:00:00.000Z'),
});
const revokedSync = await revokedDrive.syncAll();
const revokedStatus = database.cloudAccounts.get(connected.account.id).status;
await restartedDrive.disconnect(connected.account.id);
const afterDisconnect = {
  accounts: restartedDrive.listAccounts(),
  credential: database.credentials.retrieve(credentialRef),
  files: database.cloudFiles.list(),
};
const databasePath = database.path;
database.close();

process.stdout.write(
  JSON.stringify({
    databasePath,
    connected: connected.account,
    serializedConnectionContainsToken: JSON.stringify(connected).includes('initial-access-token'),
    rootFileNames: rootFiles.map((file) => file.file_name),
    childFile: childFiles[0],
    sharedFileNames: sharedFiles.map((file) => file.file_name).sort(),
    sharedFolderChildNames: sharedFolderChildren.map((file) => file.file_name),
    nestedSharedChildNames: nestedSharedChildren.map((file) => file.file_name),
    leakedSharedChildNames: leakedSharedChildren.map((file) => file.file_name),
    accountColumnsContainToken:
      Object.hasOwn(accountRow, 'access_token') || Object.hasOwn(accountRow, 'refresh_token'),
    restartAccountCount: restartAccounts.length,
    rotatedCredentials:
      rotated.accessToken === 'rotated-access-token' &&
      rotated.refreshToken === 'rotated-refresh-token',
    refreshUsesClientMetadata,
    databaseContainsClientMetadata:
      readFileSync(databasePath).includes(Buffer.from(CLIENT_ID)) ||
      readFileSync(databasePath).includes(Buffer.from(CLIENT_SECRET)),
    revokedFailureCount: revokedSync.failures.length,
    revokedStatus,
    afterDisconnect,
  }),
);
