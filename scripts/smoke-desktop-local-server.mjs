import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = join(repositoryRoot, 'src-tauri', 'resources', 'local-server');
const appRoot = join(resourceRoot, 'app');
const runtimePath = join(
  resourceRoot,
  'runtime',
  process.platform === 'win32' ? 'node.exe' : 'node',
);
const readyPrefix = 'NAMMU_LOCAL_READY ';
const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-packaged-server-smoke-'));
const apiCapability = '4'.repeat(64);
const vaultKey = '9'.repeat(64);
const frontendOrigin = 'http://tauri.localhost';
const { createDesktopRequestTokenForTest } = await import(
  pathToFileURL(join(appRoot, 'src', 'server', 'runtime', 'desktopSecurity.mjs')).href
);

const child = spawn(runtimePath, [join(appRoot, 'server.mjs')], {
  cwd: appRoot,
  env: { ...process.env, NAMMU_RUNTIME: 'desktop-local', NODE_ENV: 'production' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
const diagnostics = [];
child.stderr.setEncoding('utf8');
child.stderr.on('data', (value) => diagnostics.push(value));
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on('line', (line) => diagnostics.push(line));

const ready = new Promise((resolveReady, rejectReady) => {
  const timer = setTimeout(
    () => rejectReady(new Error('The packaged local server readiness handshake timed out.')),
    60_000,
  );
  lines.on('line', (line) => {
    if (!line.startsWith(readyPrefix)) return;
    clearTimeout(timer);
    resolveReady(JSON.parse(line.slice(readyPrefix.length)));
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    rejectReady(new Error(`The packaged local server exited before readiness (${code}).`));
  });
});

try {
  child.stdin.write(
    `${JSON.stringify({
      protocolVersion: 1,
      instanceId: '6'.repeat(32),
      apiCapability,
      vaultKey,
      frontendOrigin,
      dataDirectory,
    })}\n`,
  );
  const session = await ready;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.origin)) {
    throw new Error('The packaged local server did not report a numeric loopback origin.');
  }

  const missingAuthorization = await fetch(`${session.origin}/api/health`, {
    headers: { Origin: frontendOrigin },
  });
  if (missingAuthorization.status !== 401) {
    throw new Error(
      `The packaged local server accepted a request without authorization (${missingAuthorization.status}).`,
    );
  }

  const requestToken = createDesktopRequestTokenForTest(apiCapability, {
    protocolVersion: 1,
    instanceId: '6'.repeat(32),
    method: 'GET',
    pathAndQuery: '/api/health',
    expiresAt: Date.now() + 10_000,
    nonce: '7'.repeat(32),
  });
  const response = await fetch(`${session.origin}/api/health`, {
    headers: { Origin: frontendOrigin, 'x-nammu-request': requestToken },
  });
  if (response.status !== 200) {
    throw new Error(`The packaged local server health check returned ${response.status}.`);
  }
  const health = await response.json();
  if (
    health.status !== 'ok' ||
    health.runtime !== 'desktop-local' ||
    health.instanceId !== '6'.repeat(32)
  ) {
    throw new Error('The packaged local server returned the wrong session identity.');
  }

  const accountsPath = '/api/accounts';
  const accountsToken = createDesktopRequestTokenForTest(apiCapability, {
    protocolVersion: 1,
    instanceId: '6'.repeat(32),
    method: 'GET',
    pathAndQuery: accountsPath,
    expiresAt: Date.now() + 10_000,
    nonce: 'a'.repeat(32),
  });
  const accountsResponse = await fetch(`${session.origin}${accountsPath}`, {
    headers: { Origin: frontendOrigin, 'x-nammu-request': accountsToken },
  });
  const accountsPayload = await accountsResponse.json();
  if (accountsResponse.status !== 200 || !Array.isArray(accountsPayload.data)) {
    throw new Error('The packaged Google Drive account repository is unavailable.');
  }

  const deniedProviderPath = '/api/accounts/onedrive/connect';
  const deniedProviderToken = createDesktopRequestTokenForTest(apiCapability, {
    protocolVersion: 1,
    instanceId: '6'.repeat(32),
    method: 'POST',
    pathAndQuery: deniedProviderPath,
    expiresAt: Date.now() + 10_000,
    nonce: 'b'.repeat(32),
  });
  const deniedProvider = await fetch(`${session.origin}${deniedProviderPath}`, {
    method: 'POST',
    headers: {
      Origin: frontendOrigin,
      'Content-Type': 'application/json',
      'x-nammu-request': deniedProviderToken,
    },
    body: '{}',
  });
  if (deniedProvider.status !== 404) {
    throw new Error('The packaged route policy enabled a non-Google cloud provider.');
  }

  const googleConnectPath = '/api/accounts/google_drive/connect';
  const googleConnectToken = createDesktopRequestTokenForTest(apiCapability, {
    protocolVersion: 1,
    instanceId: '6'.repeat(32),
    method: 'POST',
    pathAndQuery: googleConnectPath,
    expiresAt: Date.now() + 10_000,
    nonce: 'c'.repeat(32),
  });
  const googleConnect = await fetch(`${session.origin}${googleConnectPath}`, {
    method: 'POST',
    headers: {
      Origin: frontendOrigin,
      'Content-Type': 'application/json',
      'x-nammu-request': googleConnectToken,
    },
    body: '{}',
  });
  const googleConnectPayload = await googleConnect.json();
  if (googleConnect.status === 201) {
    const attemptId = googleConnectPayload?.data?.attemptId;
    const cancelPath = `/api/accounts/google_drive/status?attempt_id=${encodeURIComponent(attemptId)}`;
    const cancelToken = createDesktopRequestTokenForTest(apiCapability, {
      protocolVersion: 1,
      instanceId: '6'.repeat(32),
      method: 'DELETE',
      pathAndQuery: cancelPath,
      expiresAt: Date.now() + 10_000,
      nonce: 'd'.repeat(32),
    });
    const cancelled = await fetch(`${session.origin}${cancelPath}`, {
      method: 'DELETE',
      headers: { Origin: frontendOrigin, 'x-nammu-request': cancelToken },
    });
    if (cancelled.status !== 200) {
      throw new Error('The packaged Google OAuth callback listener could not be cancelled.');
    }
  } else if (
    googleConnect.status !== 503 ||
    googleConnectPayload?.error !== 'Google Drive desktop OAuth is not configured for this build.'
  ) {
    throw new Error(`The packaged Google OAuth start route returned ${googleConnect.status}.`);
  }

  const preferences = {
    pinned_tools: ['browser', 'files'],
    settings: { density: 'compact' },
  };
  const preferencesToken = createDesktopRequestTokenForTest(apiCapability, {
    protocolVersion: 1,
    instanceId: '6'.repeat(32),
    method: 'POST',
    pathAndQuery: '/api/preferences',
    expiresAt: Date.now() + 10_000,
    nonce: '8'.repeat(32),
  });
  const savedPreferences = await fetch(`${session.origin}/api/preferences`, {
    method: 'POST',
    headers: {
      Origin: frontendOrigin,
      'Content-Type': 'application/json',
      'x-nammu-request': preferencesToken,
    },
    body: JSON.stringify(preferences),
  });
  if (savedPreferences.status !== 200) {
    throw new Error(`The packaged settings repository returned ${savedPreferences.status}.`);
  }

  child.stdin.write('{"type":"shutdown"}\n');
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () => rejectExit(new Error('The packaged local server did not shut down cleanly.')),
      10_000,
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
  if (exitCode !== 0) throw new Error(`The packaged local server exited with code ${exitCode}.`);

  const { DESKTOP_SETTINGS_USER_ID, openDesktopDatabase } = await import(
    pathToFileURL(join(appRoot, 'src', 'server', 'runtime', 'desktopDatabase.mjs')).href
  );
  const reopenedDatabase = openDesktopDatabase(dataDirectory, vaultKey);
  const persistedPreferences = JSON.parse(
    (await reopenedDatabase.settings.get(DESKTOP_SETTINGS_USER_ID, 'user_preferences')) || '{}',
  );
  reopenedDatabase.close();
  if (JSON.stringify(persistedPreferences) !== JSON.stringify(preferences)) {
    throw new Error('The packaged SQLite settings write did not survive a server restart.');
  }

  const combinedDiagnostics = diagnostics.join('\n');
  if (
    combinedDiagnostics.includes(apiCapability) ||
    combinedDiagnostics.includes(vaultKey)
  ) {
    throw new Error('A desktop capability appeared in packaged runtime diagnostics.');
  }
  console.info(`Packaged Node/Next lifecycle smoke test passed at ${session.origin}.`);
} finally {
  lines.close();
  if (child.exitCode === null) child.kill();
  await rm(dataDirectory, { recursive: true, force: true });
}
