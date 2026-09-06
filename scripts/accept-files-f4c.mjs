import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import process from 'node:process';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import WebSocket from 'ws';
import { filesF4cVideoFixtures } from './fixtures/files-f4c-videos.mjs';

const executableInput = process.env.NAMMU_F4C_EXECUTABLE;
if (!executableInput) throw new Error('Set NAMMU_F4C_EXECUTABLE to the release executable.');
const executable = resolve(executableInput);
await access(executable);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const execFile = promisify(execFileCallback);
const isolatedRoot = join(tmpdir(), `NammuFilesF4CTest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
const fixtureRoot = join(isolatedRoot, 'Video preview fixture');
const videos = filesF4cVideoFixtures();

async function removeGeneratedDirectory(path) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) || Date.now() >= deadline)
        throw error;
      await delay(100);
    }
  }
}

async function createPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([320, 180]);
  page.drawRectangle({ x: 0, y: 0, width: 320, height: 180, color: rgb(0.1, 0.3, 0.8) });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function createFixtures() {
  await mkdir(fixtureRoot, { recursive: true });
  for (const [name, bytes] of Object.entries(videos))
    await writeFile(join(fixtureRoot, name), bytes);
  await writeFile(join(fixtureRoot, 'Résumé नमस्ते 東京.mp4'), videos['landscape.mp4']);
  await writeFile(join(fixtureRoot, 'video with spaces.mp4'), videos['landscape.mp4']);
  await writeFile(join(fixtureRoot, 'corrupt.mp4'), Buffer.from('not an mp4'));
  await writeFile(join(fixtureRoot, 'truncated.mp4'), videos['landscape.mp4'].subarray(0, 160));
  await writeFile(join(fixtureRoot, 'fake renamed.mp4'), Buffer.from('plain text'));

  let longRoot = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 10; index += 1) {
    longRoot = join(
      longRoot,
      `segment-${String(index).padStart(2, '0')}-nammu-video-preview-long-path`,
    );
    await mkdir(longRoot, { recursive: true });
  }
  const longVideo = join(longRoot, 'poster frame.mp4');
  await writeFile(longVideo, videos['landscape.mp4']);
  expect(longVideo.length > 260, 'Long video fixture did not exceed 260 characters.');

  const largeDirectory = join(fixtureRoot, 'Videos 2000');
  await mkdir(largeDirectory);
  for (let offset = 0; offset < 2_000; offset += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(
          join(largeDirectory, `video-${String(offset + index).padStart(4, '0')}.mp4`),
          videos['landscape.mp4'],
        ),
      ),
    );
  }

  const mixedDirectory = join(fixtureRoot, 'Mixed 150');
  await mkdir(mixedDirectory);
  const image = await sharp({
    create: { width: 160, height: 90, channels: 4, background: '#3467eb' },
  })
    .png()
    .toBuffer();
  const pdf = await createPdf();
  for (let offset = 0; offset < 50; offset += 10) {
    await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const item = offset + index;
        await Promise.all([
          writeFile(join(mixedDirectory, `image-${String(item).padStart(2, '0')}.png`), image),
          writeFile(join(mixedDirectory, `pdf-${String(item).padStart(2, '0')}.pdf`), pdf),
          writeFile(
            join(mixedDirectory, `video-${String(item).padStart(2, '0')}.mp4`),
            videos['landscape.mp4'],
          ),
        ]);
      }),
    );
  }
  return { longVideo, largeDirectory, mixedDirectory };
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
  throw new Error('Timed out waiting for the packaged F4C runtime.');
}

const invoke = (client, command, args = {}) =>
  evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`,
  );

function value(response, operation) {
  if (response?.status !== 'success')
    throw new Error(`${operation} failed: ${response?.error?.code || 'INVALID_RESPONSE'}`);
  return response.value;
}

async function runPreview(client, request) {
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
  if (state.state === 'completed') {
    bytes = await evaluate(
      client,
      `(async()=>{const v=await window.__TAURI_INTERNALS__.invoke('take_native_file_preview_bytes',{id:${JSON.stringify(initial.id)}});const b=v instanceof Uint8Array?v:new Uint8Array(v);const u=URL.createObjectURL(new Blob([b],{type:'image/png'}));const i=new Image();i.src=u;await i.decode();const r={length:b.byteLength,prefix:Array.from(b.slice(0,8)),width:i.naturalWidth,height:i.naturalHeight};URL.revokeObjectURL(u);return r})()`,
    );
  }
  value(await invoke(client, 'release_native_file_preview', { id: initial.id }), 'release preview');
  return { state, bytes, latencyMs: performance.now() - startedAt };
}

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

async function processSample(pid) {
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString())+','+($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)))`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const [workingSetBytes, cpuSeconds] = stdout.trim().split(',').map(Number);
  return { workingSetBytes, cpuSeconds };
}

async function childProcessNames(pid) {
  const command = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(pid)}" | Select-Object -ExpandProperty Name`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  return stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

await mkdir(isolatedRoot);
await mkdir(isolatedProfile);
const fixture = await createFixtures();
const debugPort = await allocateDebugPort();
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
let report;
try {
  const target = await waitForTarget(debugPort);
  client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  await waitForValue(client, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  const baseline = await processSample(child.pid);
  const childrenBefore = await childProcessNames(child.pid);

  const requestFor = (path, size = 96, mode = 'thumbnail') => ({
    path,
    mode,
    requestedWidth: size,
    requestedHeight: size,
  });
  const cold = await runPreview(client, requestFor(join(fixtureRoot, 'landscape.mp4')));
  expect(
    cold.state.state === 'completed',
    `Cold video failed: ${JSON.stringify(cold.state.error)}`,
  );
  expect(cold.bytes.prefix.join(',') === '137,80,78,71,13,10,26,10', 'Video poster was not PNG.');
  expect(cold.bytes.width > cold.bytes.height, 'Landscape aspect ratio was not preserved.');
  expect(
    cold.state.result.sourceWidth === 320 &&
      cold.state.result.sourceHeight === 180 &&
      cold.bytes.width === 96 &&
      cold.bytes.height === 54,
    'Media Foundation did not produce the requested bounded landscape poster.',
  );
  expect(cold.state.result.durationMs >= 400, 'Video duration metadata was unavailable.');

  const warm = await runPreview(client, requestFor(join(fixtureRoot, 'landscape.mp4')));
  expect(warm.state.result.cacheHit, 'Warm video poster missed the shared cache.');
  const inspector = await runPreview(
    client,
    requestFor(join(fixtureRoot, 'landscape.mp4'), 512, 'image-preview'),
  );
  expect(inspector.state.state === 'completed', 'Inspector poster failed.');
  const portrait = await runPreview(client, requestFor(join(fixtureRoot, 'portrait.mp4'), 128));
  expect(
    portrait.state.result.sourceWidth === 180 &&
      portrait.state.result.sourceHeight === 320 &&
      portrait.bytes.width === 72 &&
      portrait.bytes.height === 128,
    'Portrait aspect ratio or bounded size was not preserved.',
  );

  for (const name of ['Résumé नमस्ते 東京.mp4', 'video with spaces.mp4']) {
    const result = await runPreview(client, requestFor(join(fixtureRoot, name), 64));
    expect(result.state.state === 'completed', `${name} preview failed.`);
  }
  const longPath = await runPreview(client, requestFor(fixture.longVideo, 64));
  expect(longPath.state.state === 'completed', 'Long-path video preview failed.');

  const formatResults = {};
  for (const name of [
    'sample.m4v',
    'sample.mov',
    'sample.mkv',
    'sample.webm',
    'sample.wmv',
    'sample.avi',
  ]) {
    const result = await runPreview(client, requestFor(join(fixtureRoot, name), 64));
    formatResults[name] = {
      state: result.state.state,
      code: result.state.error?.code ?? null,
    };
  }
  for (const name of ['corrupt.mp4', 'truncated.mp4', 'fake renamed.mp4']) {
    const result = await runPreview(client, requestFor(join(fixtureRoot, name), 64));
    expect(result.state.state === 'failed', `${name} did not fail safely.`);
  }

  const cancellationStartedAt = performance.now();
  const cancelling = value(
    await invoke(client, 'start_native_file_preview', {
      request: requestFor(join(fixtureRoot, 'landscape.mp4'), 1_024, 'image-preview'),
    }),
    'start video cancellation',
  );
  value(
    await invoke(client, 'cancel_native_file_preview', { id: cancelling.id }),
    'cancel video preview',
  );
  let cancelled = value(
    await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
    'poll cancelled video preview',
  );
  while (!['completed', 'cancelled', 'failed'].includes(cancelled.state)) {
    await delay(2);
    cancelled = value(
      await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
      'poll cancelled video preview',
    );
  }
  expect(cancelled.state === 'cancelled', 'Stale video work did not retire as cancelled.');
  value(
    await invoke(client, 'release_native_file_preview', { id: cancelling.id }),
    'release cancelled video preview',
  );
  const cancellationMs = performance.now() - cancellationStartedAt;

  const initialPaths = Array.from({ length: 24 }, (_, index) =>
    join(fixture.largeDirectory, `video-${String(index).padStart(4, '0')}.mp4`),
  );
  const initialStart = performance.now();
  const initial = await mapConcurrent(initialPaths, 3, (path) =>
    runPreview(client, requestFor(path)),
  );
  expect(
    initial.every((item) => item.state.state === 'completed'),
    'Near-visible video batch failed.',
  );
  const initialMs = performance.now() - initialStart;

  const hundredStart = performance.now();
  const hundred = await mapConcurrent(
    Array.from({ length: 100 }, (_, index) =>
      join(fixture.largeDirectory, `video-${String(index).padStart(4, '0')}.mp4`),
    ),
    3,
    (path) => runPreview(client, requestFor(path, 64)),
  );
  expect(
    hundred.every((item) => item.state.state === 'completed'),
    '100-video burst failed.',
  );
  const hundredMs = performance.now() - hundredStart;

  const rapidStart = performance.now();
  const rapid = await mapConcurrent(
    Array.from({ length: 24 }, (_, index) =>
      join(fixture.largeDirectory, `video-${String(1_500 + index).padStart(4, '0')}.mp4`),
    ),
    3,
    (path) => runPreview(client, requestFor(path, 64)),
  );
  expect(
    rapid.every((item) => item.state.state === 'completed'),
    'Final rapid-scroll range failed.',
  );
  const rapidMs = performance.now() - rapidStart;

  const mixedRequests = Array.from({ length: 50 }, (_, index) => {
    const item = String(index).padStart(2, '0');
    return [
      requestFor(join(fixture.mixedDirectory, `image-${item}.png`)),
      requestFor(join(fixture.mixedDirectory, `pdf-${item}.pdf`)),
      requestFor(join(fixture.mixedDirectory, `video-${item}.mp4`)),
    ];
  }).flat();
  const mixedStart = performance.now();
  const mixed = await mapConcurrent(mixedRequests, 3, (request) => runPreview(client, request));
  expect(
    mixed.every((item) => item.state.state === 'completed'),
    'Mixed preview workload failed.',
  );
  const mixedMs = performance.now() - mixedStart;

  await delay(20);
  await writeFile(join(fixtureRoot, 'landscape.mp4'), videos['portrait.mp4']);
  const modified = await runPreview(client, requestFor(join(fixtureRoot, 'landscape.mp4')));
  expect(
    !modified.state.result.cacheHit &&
      modified.state.result.sourceHeight > modified.state.result.sourceWidth,
    'Video metadata change did not invalidate the cached poster.',
  );

  for (let index = 0; index < 30; index += 1) {
    const path = join(fixture.largeDirectory, `video-${String(index).padStart(4, '0')}.mp4`);
    await runPreview(client, requestFor(path, 64));
    await runPreview(client, requestFor(path, 256, 'image-preview'));
  }
  const diagnostics = value(
    await invoke(client, 'get_native_file_preview_diagnostics'),
    'preview diagnostics',
  );
  expect(
    diagnostics.activeJobs === 0 && diagnostics.retainedJobs === 0,
    'Video jobs remained retained.',
  );
  expect(
    diagnostics.cacheEntries <= diagnostics.cacheMaxEntries &&
      diagnostics.cacheBytes <= diagnostics.cacheMaxBytes,
    'Shared preview cache exceeded its bound.',
  );
  const after = await processSample(child.pid);
  await delay(2_000);
  const idle = await processSample(child.pid);
  const childrenAfter = await childProcessNames(child.pid);
  report = {
    status: 'passed',
    executable,
    fixtures: { videos: 2_000, mixedImages: 50, mixedPdfs: 50, mixedVideos: 50 },
    formatResults: { 'h264.mp4': { state: 'completed', code: null }, ...formatResults },
    lazyGeneration: {
      directoryEntries: 2_000,
      initiallyRequested: 24,
      initiallyRendered: initial.length,
    },
    timingsMs: {
      coldVideoThumbnail: Number(cold.latencyMs.toFixed(2)),
      warmVideoThumbnail: Number(warm.latencyMs.toFixed(2)),
      inspectorPoster: Number(inspector.latencyMs.toFixed(2)),
      hundredVideoThumbnails: Number(hundredMs.toFixed(2)),
      initialNearVisibleTwentyFour: Number(initialMs.toFixed(2)),
      rapidScrollFinalRange: Number(rapidMs.toFixed(2)),
      navigationCancellation: Number(cancellationMs.toFixed(2)),
      mixedFiftyEachImagePdfVideo: Number(mixedMs.toFixed(2)),
    },
    lifecycle: diagnostics,
    resources: {
      hostWorkingSetBeforeBytes: baseline.workingSetBytes,
      hostWorkingSetAfterBytes: after.workingSetBytes,
      hostWorkingSetDeltaBytes: after.workingSetBytes - baseline.workingSetBytes,
      hostCpuSecondsDuringWork: Number((after.cpuSeconds - baseline.cpuSeconds).toFixed(4)),
      hostIdleCpuSecondsOverTwoSeconds: Number((idle.cpuSeconds - after.cpuSeconds).toFixed(4)),
      rendererChildProcessesCreated: childrenAfter.filter((name) => !childrenBefore.includes(name)),
    },
    invalidation: true,
    longPathCharacters: fixture.longVideo.length,
    clipboardTouched: false,
    personalFilesRead: false,
  };
} finally {
  if (client) {
    await client
      .send('Runtime.evaluate', {
        expression: `void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`,
        awaitPromise: false,
      })
      .catch(() => {});
    client.close();
  }
  if (child.exitCode === null) {
    const exited = await Promise.race([
      new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
      delay(10_000).then(() => false),
    ]);
    if (!exited && child.exitCode === null) child.kill('SIGTERM');
  }
  const root = normalize(resolve(isolatedRoot));
  const profile = normalize(resolve(isolatedProfile));
  const temp = normalize(resolve(tmpdir()));
  expect(
    root.startsWith(`${temp}\\`) && basename(root).startsWith('NammuFilesF4CTest-'),
    'Unsafe cleanup root.',
  );
  await removeGeneratedDirectory(root);
  if (profile.startsWith(`${temp}\\`) && basename(profile).startsWith('NammuFilesF4CTest-')) {
    await removeGeneratedDirectory(profile);
  }
}

let fixtureRemains = true;
try {
  await access(isolatedRoot);
} catch {
  fixtureRemains = false;
}
expect(!fixtureRemains, 'F4C fixtures remained after acceptance.');
console.info(JSON.stringify({ ...report, remainingFixtures: 0 }));
