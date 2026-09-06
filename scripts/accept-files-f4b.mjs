import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import process from 'node:process';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F4B_EXECUTABLE;
if (!executableInput)
  throw new Error('Set NAMMU_F4B_EXECUTABLE to the packaged Nammu OS executable.');
const executable = resolve(executableInput);
const keepFixtures = process.env.NAMMU_KEEP_F4B_FIXTURES === '1';
await access(executable);
const isolatedRoot = join(tmpdir(), `NammuFilesF4BTest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
const fixtureRoot = join(isolatedRoot, 'PDF preview fixture');
const execFile = promisify(execFileCallback);
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function removeGeneratedDirectory(path) {
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) || Date.now() >= deadline) {
        throw error;
      }
      await delay(100);
    }
  }
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

async function createPdf({
  width = 612,
  height = 792,
  pages = 1,
  firstColor,
  label = 'Nammu PDF',
} = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([width, height]);
    const color = index === 0 && firstColor ? firstColor : rgb(0.08, 0.12, 0.2);
    page.drawRectangle({ x: 0, y: 0, width, height, color });
    page.drawText(`${label} page ${index + 1}`, {
      x: 36,
      y: height - 72,
      size: 24,
      font,
      color: rgb(1, 1, 1),
    });
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function createFixtures() {
  await mkdir(fixtureRoot, { recursive: true });
  const portraitBytes = await createPdf({ label: 'Portrait' });
  const landscapeBytes = await createPdf({ width: 792, height: 612, label: 'Landscape' });
  const multiBytes = await createPdf({
    pages: 4,
    firstColor: rgb(0.9, 0.08, 0.08),
    label: 'First only',
  });
  const minimalBytes = await createPdf({ label: '' });
  const portrait = join(fixtureRoot, 'one page portrait.pdf');
  const landscape = join(fixtureRoot, 'landscape.pdf');
  const multi = join(fixtureRoot, 'multi page.pdf');
  const minimal = join(fixtureRoot, 'minimal.pdf');
  const unicode = join(fixtureRoot, 'Résumé नमस्ते 東京.pdf');
  await Promise.all([
    writeFile(portrait, portraitBytes),
    writeFile(landscape, landscapeBytes),
    writeFile(multi, multiBytes),
    writeFile(minimal, minimalBytes),
    writeFile(unicode, portraitBytes),
    writeFile(join(fixtureRoot, 'corrupt.pdf'), 'not a PDF'),
    writeFile(join(fixtureRoot, 'fake renamed.pdf'), 'plain text with a PDF extension'),
    writeFile(
      join(fixtureRoot, 'truncated.pdf'),
      portraitBytes.subarray(0, Math.floor(portraitBytes.length / 2)),
    ),
  ]);

  const encryptedDocument = new jsPDF({
    encryption: {
      userPassword: 'nammu-test',
      ownerPassword: 'nammu-owner',
      userPermissions: ['print'],
    },
  });
  encryptedDocument.text('Password protected fixture', 20, 20);
  const encrypted = join(fixtureRoot, 'password protected.pdf');
  await writeFile(encrypted, Buffer.from(encryptedDocument.output('arraybuffer')));

  const hostile = join(fixtureRoot, 'hostile dimensions.pdf');
  await writeFile(hostile, await createPdf({ width: 1_000_000, height: 792, label: 'Too wide' }));
  const oversized = join(fixtureRoot, 'oversized automatic preview.pdf');
  const oversizedHandle = await open(oversized, 'w');
  await oversizedHandle.truncate(256 * 1024 * 1024 + 1);
  await oversizedHandle.close();

  let longRoot = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 10; index += 1) {
    longRoot = join(
      longRoot,
      `segment-${String(index).padStart(2, '0')}-nammu-pdf-preview-long-path`,
    );
    await mkdir(longRoot, { recursive: true });
  }
  const longPdf = join(longRoot, 'first page preview.pdf');
  await writeFile(longPdf, portraitBytes);
  expect(longPdf.length > 260, 'Long-path fixture is not longer than 260 characters.');

  const pdfDirectory = join(fixtureRoot, 'PDFs 1000');
  await mkdir(pdfDirectory);
  for (let offset = 0; offset < 1_000; offset += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(
          join(pdfDirectory, `document-${String(offset + index).padStart(4, '0')}.pdf`),
          portraitBytes,
        ),
      ),
    );
  }

  const mixedDirectory = join(fixtureRoot, 'Mixed 400');
  await mkdir(mixedDirectory);
  const image = await sharp({
    create: { width: 320, height: 180, channels: 4, background: '#3182ce' },
  })
    .png()
    .toBuffer();
  for (let offset = 0; offset < 100; offset += 25) {
    await Promise.all(
      Array.from({ length: 25 }, async (_, index) => {
        const item = offset + index;
        await Promise.all([
          writeFile(join(mixedDirectory, `image-${String(item).padStart(3, '0')}.png`), image),
          writeFile(
            join(mixedDirectory, `pdf-${String(item).padStart(3, '0')}.pdf`),
            portraitBytes,
          ),
          writeFile(
            join(mixedDirectory, `text-${String(item).padStart(3, '0')}.txt`),
            `text ${item}`,
          ),
          writeFile(
            join(mixedDirectory, `data-${String(item).padStart(3, '0')}.bin`),
            Buffer.from([0, item]),
          ),
        ]);
      }),
    );
  }

  const complexDocument = await PDFDocument.create();
  const complexPage = complexDocument.addPage([612, 792]);
  for (let index = 0; index < 12_000; index += 1) {
    complexPage.drawRectangle({
      x: index % 600,
      y: (index * 7) % 780,
      width: 8,
      height: 8,
      color: rgb((index % 11) / 11, (index % 7) / 7, (index % 5) / 5),
    });
  }
  const complex = join(fixtureRoot, 'complex cancellation.pdf');
  await writeFile(complex, Buffer.from(await complexDocument.save({ useObjectStreams: false })));

  return {
    portrait,
    portraitBytes,
    landscape,
    multi,
    minimal,
    unicode,
    encrypted,
    hostile,
    oversized,
    longPdf,
    pdfDirectory,
    mixedDirectory,
    complex,
  };
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
  throw new Error('Timed out waiting for the packaged F4B runtime.');
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
      `(async()=>{const v=await window.__TAURI_INTERNALS__.invoke('take_native_file_preview_bytes',{id:${JSON.stringify(initial.id)}});const b=v instanceof Uint8Array?v:new Uint8Array(v);const url=URL.createObjectURL(new Blob([b],{type:'image/png'}));const image=document.createElement('img');image.hidden=true;image.src=url;document.body.append(image);await image.decode();const rendered={width:image.naturalWidth,height:image.naturalHeight};image.remove();URL.revokeObjectURL(url);return {length:b.byteLength,prefix:Array.from(b.slice(0,8)),rendered};})()`,
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
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString()) + ',' + ($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)))`;
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
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
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
  const childProcessesBefore = await childProcessNames(child.pid);

  const cold = await runPreview(client, {
    path: fixture.portrait,
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(
    cold.state.state === 'completed',
    `Cold PDF thumbnail failed: ${JSON.stringify(cold.state.error)}`,
  );
  expect(cold.bytes?.prefix.join(',') === '137,80,78,71,13,10,26,10', 'PDF thumbnail was not PNG.');
  expect(cold.state.result.pageCount === 1, 'One-page PDF page count is incorrect.');
  expect(
    cold.bytes.rendered.height > cold.bytes.rendered.width,
    'Portrait PDF aspect ratio was not preserved.',
  );

  const warm = await runPreview(client, {
    path: fixture.portrait,
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(warm.state.result.cacheHit, 'Warm PDF thumbnail missed the F4A memory cache.');

  const inspector = await runPreview(client, {
    path: fixture.portrait,
    mode: 'image-preview',
    requestedWidth: 512,
    requestedHeight: 512,
  });
  expect(
    inspector.state.state === 'completed' && inspector.bytes.rendered.height === 512,
    'PDF inspector preview failed.',
  );

  const landscape = await runPreview(client, {
    path: fixture.landscape,
    mode: 'thumbnail',
    requestedWidth: 128,
    requestedHeight: 128,
  });
  expect(
    landscape.bytes.rendered.width > landscape.bytes.rendered.height,
    'Landscape PDF aspect ratio was not preserved.',
  );

  const multi = await runPreview(client, {
    path: fixture.multi,
    mode: 'thumbnail',
    requestedWidth: 128,
    requestedHeight: 128,
  });
  expect(multi.state.result.pageCount === 4, 'Multi-page PDF page count is incorrect.');
  const multiPng = await sharp(
    Buffer.from(
      await (async () => {
        const initial = value(
          await invoke(client, 'start_native_file_preview', {
            request: {
              path: fixture.multi,
              mode: 'thumbnail',
              requestedWidth: 128,
              requestedHeight: 128,
            },
          }),
          'start first-page proof',
        );
        let state = initial;
        while (!['completed', 'cancelled', 'failed'].includes(state.state)) {
          await delay(3);
          state = value(
            await invoke(client, 'get_native_file_preview', { id: initial.id }),
            'poll first-page proof',
          );
        }
        const bytes = await evaluate(
          client,
          `(async()=>{const value=await window.__TAURI_INTERNALS__.invoke('take_native_file_preview_bytes',{id:${JSON.stringify(initial.id)}});return Array.from(value instanceof Uint8Array?value:new Uint8Array(value));})()`,
        );
        value(
          await invoke(client, 'release_native_file_preview', { id: initial.id }),
          'release first-page proof',
        );
        return bytes;
      })(),
    ),
  ).stats();
  expect(
    multiPng.channels[0].mean > multiPng.channels[2].mean * 2,
    'Multi-page thumbnail was not rendered from page 1.',
  );

  for (const path of [fixture.minimal, fixture.unicode, fixture.longPdf]) {
    const result = await runPreview(client, {
      path,
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    expect(result.state.state === 'completed', `${basename(path)} PDF preview failed.`);
  }

  for (const [name, expectedCodes] of [
    ['corrupt.pdf', ['DECODE_FAILED']],
    ['truncated.pdf', ['DECODE_FAILED']],
    ['fake renamed.pdf', ['DECODE_FAILED']],
    ['password protected.pdf', ['PDF_ENCRYPTED']],
  ]) {
    const result = await runPreview(client, {
      path: join(fixtureRoot, name),
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    expect(
      result.state.state === 'failed' && expectedCodes.includes(result.state.error?.code),
      `${name} did not fail as ${expectedCodes.join(' or ')}: ${JSON.stringify(result.state)}.`,
    );
  }
  const hostile = await runPreview(client, {
    path: join(fixtureRoot, 'hostile dimensions.pdf'),
    mode: 'thumbnail',
    requestedWidth: 64,
    requestedHeight: 64,
  });
  const hostileFailedSafely =
    hostile.state.state === 'failed' &&
    ['DECODE_FAILED', 'PREVIEW_UNSUPPORTED'].includes(hostile.state.error?.code);
  const hostileRenderedWithinBounds =
    hostile.state.state === 'completed' &&
    hostile.state.result?.width <= 64 &&
    hostile.state.result?.height <= 64 &&
    hostile.state.result?.byteLength <= 8 * 1024 * 1024;
  expect(
    hostileFailedSafely || hostileRenderedWithinBounds,
    `Hostile page dimensions were not safely bounded: ${JSON.stringify(hostile.state)}.`,
  );
  const oversizedResponse = await invoke(client, 'start_native_file_preview', {
    request: {
      path: fixture.oversized,
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    },
  });
  expect(
    oversizedResponse.status === 'error' && oversizedResponse.error?.code === 'PREVIEW_UNSUPPORTED',
    'Oversized PDF was not rejected before rendering.',
  );

  const cancellationStart = performance.now();
  const cancellationRequest = {
    path: fixture.complex,
    mode: 'image-preview',
    requestedWidth: 1024,
    requestedHeight: 1024,
  };
  const cancelling = value(
    await invoke(client, 'start_native_file_preview', { request: cancellationRequest }),
    'start cancellation preview',
  );
  let running = cancelling;
  while (running.state === 'queued') {
    await delay(1);
    running = value(
      await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
      'wait for running preview',
    );
  }
  value(
    await invoke(client, 'cancel_native_file_preview', { id: cancelling.id }),
    'cancel PDF preview',
  );
  let cancelled = value(
    await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
    'poll cancelled PDF preview',
  );
  while (!['completed', 'cancelled', 'failed'].includes(cancelled.state)) {
    await delay(2);
    cancelled = value(
      await invoke(client, 'get_native_file_preview', { id: cancelling.id }),
      'poll cancelled PDF preview',
    );
  }
  expect(cancelled.state === 'cancelled', 'Running PDF preview did not retire after cancellation.');
  value(
    await invoke(client, 'release_native_file_preview', { id: cancelling.id }),
    'release cancelled PDF preview',
  );
  const cancellationMs = performance.now() - cancellationStart;

  const visibleIndices = Array.from({ length: 24 }, (_, index) => index);
  const initialLargeStart = performance.now();
  const initialLarge = await mapConcurrent(visibleIndices, 3, (index) =>
    runPreview(client, {
      path: join(fixture.pdfDirectory, `document-${String(index).padStart(4, '0')}.pdf`),
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    }),
  );
  expect(
    initialLarge.every((item) => item.state.state === 'completed'),
    'Near-visible PDF batch failed.',
  );
  const initialLargeMs = performance.now() - initialLargeStart;

  const hundredStart = performance.now();
  const hundred = await mapConcurrent(
    Array.from({ length: 100 }, (_, index) => index),
    3,
    (index) =>
      runPreview(client, {
        path: join(fixture.pdfDirectory, `document-${String(index).padStart(4, '0')}.pdf`),
        mode: 'thumbnail',
        requestedWidth: 64,
        requestedHeight: 64,
      }),
  );
  expect(
    hundred.every((item) => item.state.state === 'completed'),
    '100-PDF burst was incomplete.',
  );
  const hundredMs = performance.now() - hundredStart;

  const mixedItems = Array.from({ length: 50 }, (_, index) => [
    {
      path: join(fixture.mixedDirectory, `pdf-${String(index).padStart(3, '0')}.pdf`),
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    },
    {
      path: join(fixture.mixedDirectory, `image-${String(index).padStart(3, '0')}.png`),
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    },
  ]).flat();
  const mixedStart = performance.now();
  const mixed = await mapConcurrent(mixedItems, 3, (request) => runPreview(client, request));
  expect(
    mixed.every((item) => item.state.state === 'completed'),
    'Mixed image/PDF workload was incomplete.',
  );
  const mixedMs = performance.now() - mixedStart;

  await delay(20);
  await writeFile(
    fixture.portrait,
    await createPdf({ width: 792, height: 612, label: 'Modified landscape' }),
  );
  const modified = await runPreview(client, {
    path: fixture.portrait,
    mode: 'thumbnail',
    requestedWidth: 96,
    requestedHeight: 96,
  });
  expect(
    !modified.state.result.cacheHit &&
      modified.state.result.sourceWidth > modified.state.result.sourceHeight,
    'Modified PDF did not invalidate its cached preview.',
  );

  for (let index = 0; index < 30; index += 1) {
    const pdfPath = join(fixture.pdfDirectory, `document-${String(index).padStart(4, '0')}.pdf`);
    await runPreview(client, {
      path: pdfPath,
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    await runPreview(client, {
      path: pdfPath,
      mode: 'image-preview',
      requestedWidth: 256,
      requestedHeight: 256,
    });
  }
  const diagnostics = value(
    await invoke(client, 'get_native_file_preview_diagnostics'),
    'preview diagnostics',
  );
  expect(
    diagnostics.activeJobs === 0 && diagnostics.retainedJobs === 0,
    'PDF preview jobs remained retained.',
  );
  expect(
    diagnostics.cacheEntries <= diagnostics.cacheMaxEntries &&
      diagnostics.cacheBytes <= diagnostics.cacheMaxBytes,
    'Shared preview cache exceeded its bounds.',
  );

  const after = await processSample(child.pid);
  await delay(2_000);
  const idle = await processSample(child.pid);
  const childProcessesAfter = await childProcessNames(child.pid);
  const newChildProcessNames = childProcessesAfter.filter(
    (name) => !childProcessesBefore.includes(name),
  );
  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(isolatedRoot),
      fixtures: {
        pdfs: 1_000,
        mixedImages: 100,
        mixedPdfs: 100,
        mixedText: 100,
        mixedUnsupported: 100,
      },
      lazyGeneration: {
        directoryEntries: 1_000,
        initiallyRequested: 24,
        initiallyRendered: initialLarge.length,
      },
      timingsMs: {
        coldPdfThumbnail: Number(cold.latencyMs.toFixed(2)),
        warmPdfThumbnail: Number(warm.latencyMs.toFixed(2)),
        pdfInspectorPreview: Number(inspector.latencyMs.toFixed(2)),
        hundredPdfThumbnails: Number(hundredMs.toFixed(2)),
        mixedFiftyImageFiftyPdf: Number(mixedMs.toFixed(2)),
        initialNearVisibleTwentyFour: Number(initialLargeMs.toFixed(2)),
        navigationCancellation: Number(cancellationMs.toFixed(2)),
      },
      lifecycle: diagnostics,
      resources: {
        hostWorkingSetBeforeBytes: baseline.workingSetBytes,
        hostWorkingSetAfterBytes: after.workingSetBytes,
        hostWorkingSetDeltaBytes: after.workingSetBytes - baseline.workingSetBytes,
        hostCpuSecondsDuringBurst: Number((after.cpuSeconds - baseline.cpuSeconds).toFixed(4)),
        hostIdleCpuSecondsOverTwoSeconds: Number((idle.cpuSeconds - after.cpuSeconds).toFixed(4)),
        rendererChildProcessesCreated: newChildProcessNames,
      },
      pageOneOnly: true,
      cacheInvalidation: true,
      longPathCharacters: fixture.longPdf.length,
      clipboardTouched: false,
      personalFilesRead: false,
    }),
  );
} finally {
  try {
    if (client) {
      await client
        .send('Runtime.evaluate', {
          expression: `void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`,
          awaitPromise: false,
          returnByValue: false,
        })
        .catch(() => {});
      client.close();
    }
    if (child.exitCode === null) {
      const exited = await Promise.race([
        new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
        delay(10_000).then(() => false),
      ]);
      if (!exited && child.exitCode === null) {
        child.kill('SIGTERM');
        console.error('Packaged Nammu did not shut down cleanly within 10 seconds.');
        process.exitCode = 1;
      }
    }
  } finally {
    const root = normalize(resolve(isolatedRoot));
    const profile = normalize(resolve(isolatedProfile));
    const temp = normalize(resolve(tmpdir()));
    if (keepFixtures) {
      console.error(`Retained F4B diagnostic fixtures at ${root}`);
    } else if (root.startsWith(`${temp}\\`) && basename(root).startsWith('NammuFilesF4BTest-')) {
      await removeGeneratedDirectory(root);
      if (profile.startsWith(`${temp}\\`) && basename(profile).startsWith('NammuFilesF4BTest-'))
        await removeGeneratedDirectory(profile);
    } else {
      console.error('Refusing to clean an unexpected F4B directory.');
      process.exitCode = 1;
    }
  }
}
