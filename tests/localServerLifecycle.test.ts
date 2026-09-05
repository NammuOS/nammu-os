import { expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createDesktopRequestTokenForTest } from '../src/server/runtime/desktopSecurity.mjs';

const READY_PREFIX = 'NAMMU_LOCAL_READY ';

function webSocketHandshake(serviceOrigin: string, path: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const serviceUrl = new URL(serviceOrigin);
    let settled = false;
    let response = '';
    const socket = createConnection({ host: serviceUrl.hostname, port: Number(serviceUrl.port) });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('The WebSocket handshake timed out.'));
    }, 5_000);
    socket.once('connect', () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${serviceUrl.host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          `Origin: ${origin}`,
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('latin1');
      if (settled || !response.includes('\r\n\r\n')) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(Number.parseInt(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1] || '0', 10));
    });
    socket.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

test('desktop local server binds an ephemeral loopback port and exits through its control pipe', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'nammu-local-server-test-'));
  const instanceId = '1'.repeat(32);
  const apiCapability = '2'.repeat(64);
  const foreignCapability = '3'.repeat(64);
  const vaultKey = '8'.repeat(64);
  const frontendOrigin = 'http://127.0.0.1:1420';
  const child = spawn(process.env.NAMMU_TEST_NODE || 'node', ['server.mjs', '--dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NAMMU_RUNTIME: 'desktop-local',
      NAMMU_HOST: '0.0.0.0',
      PORT: '3000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (value: string) => output.push(value));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => output.push(line));

  const readyPromise = new Promise<{ origin: string; instanceId: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local server readiness timed out.')), 60_000);
    lines.on('line', (line) => {
      if (!line.startsWith(READY_PREFIX)) return;
      clearTimeout(timer);
      resolve(JSON.parse(line.slice(READY_PREFIX.length)));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Local server exited before readiness with code ${code}.`));
    });
  });

  try {
    child.stdin.write(
      `${JSON.stringify({
        protocolVersion: 1,
        instanceId,
        apiCapability,
        vaultKey,
        frontendOrigin,
        dataDirectory,
      })}\n`,
    );

    const ready = await readyPromise;
    expect(ready.instanceId).toBe(instanceId);
    expect(ready.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(ready.origin).port)).toBeGreaterThan(0);

    const missingAuthorization = await fetch(`${ready.origin}/api/health`, {
      headers: { Origin: frontendOrigin },
    });
    expect(missingAuthorization.status).toBe(401);

    const token = createDesktopRequestTokenForTest(apiCapability, {
      protocolVersion: 1,
      instanceId,
      method: 'GET',
      pathAndQuery: '/api/health',
      expiresAt: Date.now() + 10_000,
      nonce: '4'.repeat(32),
    });
    const response = await fetch(`${ready.origin}/api/health`, {
      headers: { Origin: frontendOrigin, 'x-nammu-request': token },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await response.json()).toEqual({
      status: 'ok',
      runtime: 'desktop-local',
      instanceId,
    });

    const searchTarget = '/api/browser/search?q=';
    const searchToken = createDesktopRequestTokenForTest(apiCapability, {
      protocolVersion: 1,
      instanceId,
      method: 'GET',
      pathAndQuery: searchTarget,
      expiresAt: Date.now() + 10_000,
      nonce: '7'.repeat(32),
    });
    const statelessNextRoute = await fetch(`${ready.origin}${searchTarget}`, {
      headers: { Origin: frontendOrigin, 'x-nammu-request': searchToken },
    });
    expect(statelessNextRoute.status).toBe(200);
    expect(statelessNextRoute.headers.get('access-control-allow-origin')).toBe(frontendOrigin);
    expect(await statelessNextRoute.json()).toEqual({ query: '', results: [] });

    const preferences = {
      pinned_tools: ['browser', 'files'],
      settings: { density: 'compact' },
    };
    const preferencesToken = createDesktopRequestTokenForTest(apiCapability, {
      protocolVersion: 1,
      instanceId,
      method: 'POST',
      pathAndQuery: '/api/preferences',
      expiresAt: Date.now() + 10_000,
      nonce: '6'.repeat(32),
    });
    const savedPreferences = await fetch(`${ready.origin}/api/preferences`, {
      method: 'POST',
      headers: {
        Origin: frontendOrigin,
        'Content-Type': 'application/json',
        'x-nammu-request': preferencesToken,
      },
      body: JSON.stringify(preferences),
    });
    expect(savedPreferences.status).toBe(200);
    expect(await savedPreferences.json()).toEqual(preferences);

    const wrongCapabilityToken = createDesktopRequestTokenForTest(foreignCapability, {
      protocolVersion: 1,
      instanceId,
      method: 'GET',
      pathAndQuery: '/api/health',
      expiresAt: Date.now() + 10_000,
      nonce: '5'.repeat(32),
    });
    const wrongCapability = await fetch(`${ready.origin}/api/health`, {
      headers: {
        Origin: frontendOrigin,
        'x-nammu-request': wrongCapabilityToken,
      },
    });
    expect(wrongCapability.status).toBe(401);

    expect(
      await webSocketHandshake(ready.origin, '/firefox-wisp/removed', frontendOrigin),
    ).toBe(404);

    child.stdin.write('{"type":"shutdown"}\n');
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Graceful shutdown timed out.')), 10_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);

    const persistenceProbe = spawnSync(
      process.env.NAMMU_TEST_NODE || 'node',
      [
        'tests/helpers/desktopDatabaseProbe.mjs',
        'get-setting',
        dataDirectory,
        'local-default-user',
        'user_preferences',
      ],
      { cwd: process.cwd(), encoding: 'utf8', windowsHide: true },
    );
    expect(persistenceProbe.status).toBe(0);
    expect(JSON.parse(JSON.parse(persistenceProbe.stdout).value)).toEqual(preferences);

    const combinedOutput = output.join('\n');
    expect(combinedOutput).not.toContain(apiCapability);
    expect(combinedOutput).not.toContain(foreignCapability);
    expect(combinedOutput).not.toContain(vaultKey);
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
    await rm(dataDirectory, { recursive: true, force: true });
  }
}, 75_000);
