import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(projectRoot, 'docs', 'screenshots');
const baseUrl = process.env.NAMMU_SCREENSHOT_BASE_URL || 'http://localhost:3000';
const debuggingPort = 9400 + Math.floor(Math.random() * 400);
const profileDirectory = join(tmpdir(), `nammu-readme-capture-${process.pid}`);
const execFileAsync = promisify(execFile);

const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const screenshots = [
  { name: 'desktop', path: '/', wait: 3500, width: 1440, height: 900 },
  { name: 'projects', path: '/apps/projects' },
  { name: 'browser', path: '/browser', wait: 11000 },
  { name: 'cloud', path: '/apps/cloud', wait: 5000 },
  { name: 'files', path: '/apps/files' },
  { name: 'whatsapp', path: '/apps/whatsapp', wait: 11000 },
  { name: 'maps', path: '/apps/maps', wait: 6000 },
  { name: 'notes', path: '/apps/notes' },
  { name: 'calendar', path: '/apps/calendar' },
  { name: 'mail', path: '/apps/mail' },
  { name: 'editor', path: '/apps/editor' },
  { name: 'shell', path: '/apps/terminal' },
  { name: 'calculator', path: '/apps/calculator' },
  { name: 'qr-studio', path: '/apps/qr-gen' },
  { name: 'nammu-ai', path: '/apps/ai' },
  { name: 'settings', path: '/apps/settings' },
  { name: 'subdomain-inspector', path: '/tools/subdomain-discovery' },
];
const requestedNames = new Set(process.argv.slice(2));
const selectedScreenshots = requestedNames.size
  ? screenshots.filter((screenshot) => requestedNames.has(screenshot.name))
  : screenshots;

if (requestedNames.size && selectedScreenshots.length !== requestedNames.size) {
  const knownNames = new Set(screenshots.map((screenshot) => screenshot.name));
  const unknownNames = [...requestedNames].filter((name) => !knownNames.has(name));
  throw new Error(`Unknown screenshot target: ${unknownNames.join(', ')}`);
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForJson(url, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePending, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolvePending(message.result);
      return;
    }
    if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params);
    }
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    socket.once('open', resolveReady);
    socket.once('error', rejectReady);
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolveEvent) => {
        const listener = (params) => {
          listeners.get(method)?.delete(listener);
          resolveEvent(params);
        };
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(listener);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function captureScreenshot(shot) {
  const targetResponse = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent('about:blank')}`,
    { method: 'PUT' },
  );
  const target = await targetResponse.json();
  const client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: shot.width ?? 1280,
    height: shot.height ?? 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: new URL(shot.path, baseUrl).href });
  await Promise.race([loaded, delay(15000)]);
  await delay(shot.wait ?? 3000);

  const result = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 88,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(join(outputDirectory, `${shot.name}.jpg`), Buffer.from(result.data, 'base64'));
  client.close();
  await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`);
  process.stdout.write(`Captured ${shot.name}.jpg\n`);
}

const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
if (!edgePath) {
  throw new Error('Microsoft Edge was not found. Set EDGE_PATH to a Chromium-compatible browser.');
}

const healthResponse = await fetch(baseUrl);
if (!healthResponse.ok) {
  throw new Error(
    `Nammu OS is not reachable at ${baseUrl}. Start it before capturing screenshots.`,
  );
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(profileDirectory, { recursive: true });

const browser = spawn(
  edgePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
);

try {
  await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
  for (const shot of selectedScreenshots) await captureScreenshot(shot);
} finally {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/pid', String(browser.pid), '/t', '/f']).catch(() => {});
  } else {
    browser.kill('SIGTERM');
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profileDirectory, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 9) {
        process.stderr.write(`Could not remove temporary browser profile: ${error.message}\n`);
        break;
      }
      await delay(250);
    }
  }
}
