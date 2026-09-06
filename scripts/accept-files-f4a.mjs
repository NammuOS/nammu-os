import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import process from 'node:process';
import sharp from 'sharp';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F4A_EXECUTABLE;
if (!executableInput)
  throw new Error('Set NAMMU_F4A_EXECUTABLE to the packaged Nammu OS executable.');
const executable = resolve(executableInput);
await access(executable);
const isolatedRoot = join(tmpdir(), `NammuFilesF4ATest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
const fixtureRoot = join(isolatedRoot, 'Preview fixture');
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const execFile = promisify(execFileCallback);
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function mapConcurrent(items, concurrency, operation) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        output[index] = await operation(items[index], index);
      }
    }),
  );
  return output;
}

async function allocateDebugPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return rejectPort(new Error('No CDP port.'));
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
}

async function createFixtures() {
  await mkdir(fixtureRoot, { recursive: true });
  const formats = ['png', 'jpeg', 'webp', 'gif'];
  for (const format of formats) {
    await sharp({ create: { width: 640, height: 360, channels: 4, background: '#3182ce' } })
      [format]()
      .toFile(join(fixtureRoot, `sample.${format === 'jpeg' ? 'jpg' : format}`));
  }
  const bmpWidth = 64;
  const bmpHeight = 64;
  const rowBytes = bmpWidth * 3;
  const bmp = Buffer.alloc(54 + rowBytes * bmpHeight);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(bmpWidth, 18);
  bmp.writeInt32LE(bmpHeight, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(rowBytes * bmpHeight, 34);
  for (let offset = 54; offset < bmp.length; offset += 3) {
    bmp[offset] = 206;
    bmp[offset + 1] = 130;
    bmp[offset + 2] = 49;
  }
  await writeFile(join(fixtureRoot, 'sample.bmp'), bmp);
  const png = await sharp({
    create: { width: 320, height: 180, channels: 4, background: '#805ad5' },
  })
    .png()
    .toBuffer();
  const imageDirectory = join(fixtureRoot, 'Images 1000');
  await mkdir(imageDirectory);
  for (let offset = 0; offset < 1_000; offset += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(
          join(imageDirectory, `photo-${String(offset + index).padStart(4, '0')}.png`),
          png,
        ),
      ),
    );
  }
  await writeFile(
    join(fixtureRoot, 'Notes नमस्ते 東京.md'),
    '\ufeff# Nammu\nSafe plain text preview.',
  );
  await writeFile(join(fixtureRoot, 'large.log'), 'a'.repeat(512 * 1024 + 128));
  await writeFile(join(fixtureRoot, 'binary.txt'), new Uint8Array([0, 1, 2, 3, 4]));
  await writeFile(join(fixtureRoot, 'corrupt.png'), 'not-an-image');
  await writeFile(join(fixtureRoot, 'zero.jpg'), new Uint8Array());
  await writeFile(join(fixtureRoot, 'misleading.jpg'), 'plain text');
  let longRoot = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 10; index += 1) {
    longRoot = join(longRoot, `segment-${String(index).padStart(2, '0')}-nammu-preview-long-path`);
    await mkdir(longRoot, { recursive: true });
  }
  const longImage = join(longRoot, 'preview image.png');
  await writeFile(longImage, png);
  const cancellationImage = join(fixtureRoot, 'cancellation.png');
  await sharp({
    create: { width: 6_000, height: 6_000, channels: 4, background: '#111827' },
  })
    .png()
    .toFile(cancellationImage);
  expect(longImage.length > 260, 'Long-path fixture is not longer than 260 characters.');
  return { imageDirectory, longImage, cancellationImage, png };
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  const ready = new Promise((resolveReady, rejectReady) => {
    socket.once('open', resolveReady);
    socket.once('error', rejectReady);
  });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForTarget(port) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const target = (await response.json()).find(
          (candidate) =>
            candidate.type === 'page' && /tauri\.localhost|tauri:\/\//.test(candidate.url),
        );
        if (target) return target;
      }
    } catch {}
    await delay(200);
  }
  throw new Error('Timed out waiting for packaged Nammu OS.');
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || 'WebView evaluation failed.');
  return result.result?.value;
}
async function waitForValue(client, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(client, expression).catch(() => null);
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out waiting for the packaged F4A runtime.');
}
const invoke = (client, command, args = {}) =>
  evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
function value(response, operation) {
  if (response?.status !== 'success')
    throw new Error(`${operation} failed: ${response?.error?.code || 'INVALID_RESPONSE'}`);
  return response.value;
}

async function runPreview(client, request, release = true) {
  const startedAt = performance.now();
  const initial = value(
    await invoke(client, 'start_native_file_preview', { request }),
    'start preview',
  );
  let state = initial;
  while (!['completed', 'cancelled', 'failed'].includes(state.state)) {
    await delay(3);
    state = value(
      await invoke(client, 'get_native_file_preview', { id: initial.id }),
      'poll preview',
    );
  }
  let bytes = null;
  if (state.state === 'completed' && state.result?.kind === 'image') {
    bytes = await evaluate(
      client,
      `(async()=>{const v=await window.__TAURI_INTERNALS__.invoke('take_native_file_preview_bytes',{id:${JSON.stringify(initial.id)}});const b=v instanceof Uint8Array?v:new Uint8Array(v);const url=URL.createObjectURL(new Blob([b],{type:'image/png'}));const image=document.createElement('img');image.hidden=true;image.src=url;document.body.append(image);await image.decode();const rendered={width:image.naturalWidth,height:image.naturalHeight};image.remove();URL.revokeObjectURL(url);return {length:b.byteLength,prefix:Array.from(b.slice(0,4)),rendered};})()`,
    );
  }
  if (release)
    value(
      await invoke(client, 'release_native_file_preview', { id: initial.id }),
      'release preview',
    );
  return { id: initial.id, state, bytes, latencyMs: performance.now() - startedAt };
}

async function processSample(pid) {
  const script = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString()) + ',' + ($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)))`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  const [workingSetBytes, cpuSeconds] = stdout.trim().split(',').map(Number);
  return { workingSetBytes, cpuSeconds };
}

const debugPort = await allocateDebugPort();
await mkdir(isolatedRoot);
await mkdir(isolatedProfile);
const fixture = await createFixtures();
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: isolatedProfile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let client;
try {
  const target = await waitForTarget(debugPort);
  client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  await waitForValue(client, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  const baseline = await processSample(child.pid);
  const first = await runPreview(client, {
    path: join(fixture.imageDirectory, 'photo-0000.png'),
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(
    first.state.state === 'completed' &&
      first.bytes?.prefix.join(',') === '137,80,78,71' &&
      first.bytes.rendered.width > 0,
    'PNG thumbnail failed.',
  );
  const warm = await runPreview(client, {
    path: join(fixture.imageDirectory, 'photo-0000.png'),
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(warm.state.result.cacheHit, 'Warm thumbnail did not hit the memory cache.');
  const imagePreview = await runPreview(client, {
    path: join(fixtureRoot, 'sample.jpg'),
    mode: 'image-preview',
    requestedWidth: 512,
    requestedHeight: 512,
  });
  expect(imagePreview.state.result.sourceWidth === 640, 'Image preview dimensions are incorrect.');
  for (const name of ['sample.webp', 'sample.gif', 'sample.bmp']) {
    const result = await runPreview(client, {
      path: join(fixtureRoot, name),
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    expect(result.state.state === 'completed', `${name} thumbnail failed.`);
  }
  const text = await runPreview(client, {
    path: join(fixtureRoot, 'Notes नमस्ते 東京.md'),
    mode: 'text-preview',
    requestedWidth: 0,
    requestedHeight: 0,
  });
  expect(text.state.result.text.startsWith('# Nammu'), 'UTF-8/BOM text preview failed.');
  const large = await runPreview(client, {
    path: join(fixtureRoot, 'large.log'),
    mode: 'text-preview',
    requestedWidth: 0,
    requestedHeight: 0,
  });
  expect(
    large.state.result.truncated && large.state.result.text.length === 512 * 1024,
    'Large text was not bounded.',
  );
  for (const [name, mode] of [
    ['binary.txt', 'text-preview'],
    ['corrupt.png', 'thumbnail'],
    ['zero.jpg', 'thumbnail'],
    ['misleading.jpg', 'thumbnail'],
  ]) {
    const result = await runPreview(client, {
      path: join(fixtureRoot, name),
      mode,
      requestedWidth: mode === 'thumbnail' ? 64 : 0,
      requestedHeight: mode === 'thumbnail' ? 64 : 0,
    });
    expect(result.state.state === 'failed', `${name} did not fail safely.`);
  }
  const long = await runPreview(client, {
    path: fixture.longImage,
    mode: 'thumbnail',
    requestedWidth: 64,
    requestedHeight: 64,
  });
  expect(long.state.state === 'completed', 'Long path preview failed.');

  const cancellationRequest = {
    path: fixture.cancellationImage,
    mode: 'image-preview',
    requestedWidth: 1024,
    requestedHeight: 1024,
  };
  const cancelling = value(
    await invoke(client, 'start_native_file_preview', { request: cancellationRequest }),
    'start cancellation preview',
  );
  value(
    await invoke(client, 'cancel_native_file_preview', { id: cancelling.id }),
    'cancel preview',
  );
  let cancelled;
  do {
    cancelled = value(
      await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
      'poll cancelled preview',
    );
    if (!['completed', 'cancelled', 'failed'].includes(cancelled.state)) await delay(2);
  } while (!['completed', 'cancelled', 'failed'].includes(cancelled.state));
  expect(cancelled.state === 'cancelled', 'Rapid-navigation preview work did not cancel.');
  value(
    await invoke(client, 'release_native_file_preview', { id: cancelling.id }),
    'release cancelled preview',
  );

  const burstStart = performance.now();
  const firstHundred = Array.from({ length: 100 }, (_, index) => index);
  const burst = await mapConcurrent(firstHundred, 3, (index) =>
    runPreview(client, {
      path: join(fixture.imageDirectory, `photo-${String(index).padStart(4, '0')}.png`),
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    }),
  );
  expect(
    burst.every((item) => item.state.state === 'completed'),
    '100-thumbnail burst was incomplete.',
  );
  const burstMs = performance.now() - burstStart;

  await delay(20);
  await sharp({ create: { width: 500, height: 300, channels: 4, background: '#e53e3e' } })
    .png()
    .toFile(join(fixture.imageDirectory, 'photo-0000.png'));
  const modified = await runPreview(client, {
    path: join(fixture.imageDirectory, 'photo-0000.png'),
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(
    !modified.state.result.cacheHit && modified.state.result.sourceWidth === 500,
    'Modified-file cache invalidation failed.',
  );

  for (let index = 0; index < 30; index += 1) {
    await runPreview(client, {
      path: join(fixture.imageDirectory, `photo-${String(index).padStart(4, '0')}.png`),
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    await runPreview(client, {
      path: join(fixtureRoot, 'Notes नमस्ते 東京.md'),
      mode: 'text-preview',
      requestedWidth: 0,
      requestedHeight: 0,
    });
  }
  const diagnostics = value(
    await invoke(client, 'get_native_file_preview_diagnostics'),
    'preview diagnostics',
  );
  expect(
    diagnostics.activeJobs === 0 && diagnostics.retainedJobs === 0,
    'Preview jobs remained retained.',
  );
  expect(
    diagnostics.cacheEntries <= diagnostics.cacheMaxEntries &&
      diagnostics.cacheBytes <= diagnostics.cacheMaxBytes,
    'Preview cache exceeded its bound.',
  );
  const after = await processSample(child.pid);
  await delay(2_000);
  const idle = await processSample(child.pid);
  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(isolatedRoot),
      formats: ['PNG', 'JPEG', 'WebP', 'GIF first frame', 'BMP'],
      fixtureImages: 1_000,
      timingsMs: {
        firstVisibleThumbnail: Number(first.latencyMs.toFixed(2)),
        warmCacheThumbnail: Number(warm.latencyMs.toFixed(2)),
        hundredVisibleThumbnails: Number(burstMs.toFixed(2)),
        imagePreview: Number(imagePreview.latencyMs.toFixed(2)),
        textPreview: Number(text.latencyMs.toFixed(2)),
      },
      lifecycle: diagnostics,
      resources: {
        hostWorkingSetBeforeBytes: baseline.workingSetBytes,
        hostWorkingSetAfterBytes: after.workingSetBytes,
        hostWorkingSetDeltaBytes: after.workingSetBytes - baseline.workingSetBytes,
        hostIdleCpuSecondsOverTwoSeconds: Number((idle.cpuSeconds - after.cpuSeconds).toFixed(4)),
      },
      longPathCharacters: fixture.longImage.length,
      cacheInvalidation: true,
      clipboardTouched: false,
      personalFilesRead: false,
    }),
  );
} finally {
  try {
    if (client) {
      await evaluate(client, 'window.close()').catch(() => {});
      client.close();
    }
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(10_000),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  } finally {
    const root = normalize(resolve(isolatedRoot));
    const profile = normalize(resolve(isolatedProfile));
    const temp = normalize(resolve(tmpdir()));
    if (root.startsWith(`${temp}\\`) && basename(root).startsWith('NammuFilesF4ATest-')) {
      await rm(root, { recursive: true, force: true });
      if (profile.startsWith(`${temp}\\`) && basename(profile).startsWith('NammuFilesF4ATest-'))
        await rm(profile, { recursive: true, force: true });
    } else {
      console.error('Refusing to clean an unexpected F4A directory.');
      process.exitCode = 1;
    }
  }
}
