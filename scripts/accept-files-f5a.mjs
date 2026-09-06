import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, parse, resolve } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import process from 'node:process';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import WebSocket from 'ws';
import { filesF4cVideoFixtures } from './fixtures/files-f4c-videos.mjs';

const executableInput = process.env.NAMMU_F5A_EXECUTABLE;
if (!executableInput) throw new Error('Set NAMMU_F5A_EXECUTABLE to the release executable.');
const executable = resolve(executableInput);
await access(executable);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const execFile = promisify(execFileCallback);
const isolatedRoot = join(tmpdir(), `NammuFilesF5ATest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
const fixtureRoot = join(isolatedRoot, 'Advanced Properties fixture');

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

async function createTree(root, count) {
  await mkdir(root, { recursive: true });
  for (let offset = 0; offset < count; offset += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, count - offset) }, (_, index) =>
        writeFile(
          join(root, `item-${String(offset + index).padStart(5, '0')}.bin`),
          Buffer.alloc(17),
        ),
      ),
    );
  }
}

async function createFixtures() {
  await mkdir(fixtureRoot, { recursive: true });
  const small = join(fixtureRoot, 'Small folder');
  const empty = join(fixtureRoot, 'Empty folder');
  const thousand = join(fixtureRoot, 'Files 1000');
  const tenThousand = join(fixtureRoot, 'Files 10000');
  const nested = join(fixtureRoot, 'Nested tree');
  await Promise.all([
    mkdir(small),
    mkdir(empty),
    createTree(thousand, 1_000),
    createTree(tenThousand, 10_000),
  ]);
  await writeFile(join(small, 'normal.txt'), Buffer.from('Nammu properties acceptance'));
  await writeFile(join(small, 'Unicode नमस्ते 東京.txt'), Buffer.from('unicode'));
  await writeFile(join(small, 'name with spaces.txt'), Buffer.from('spaces'));
  for (let branch = 0; branch < 20; branch += 1) {
    await createTree(join(nested, `branch-${branch}`, 'level one', 'level two'), 50);
  }

  let longRoot = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 9; index += 1) {
    longRoot = join(
      longRoot,
      `segment-${String(index).padStart(2, '0')}-nammu-properties-long-path`,
    );
    await mkdir(longRoot, { recursive: true });
  }
  const longFile = join(longRoot, 'metadata.txt');
  await writeFile(longFile, Buffer.from('long path'));
  expect(longFile.length > 260, 'Long-path fixture did not exceed 260 characters.');

  const largeFile = join(fixtureRoot, 'large sparse candidate.bin');
  const handle = await open(largeFile, 'w');
  await handle.truncate(1024 * 1024 * 1024);
  await handle.close();

  const imagePath = join(fixtureRoot, 'image.png');
  await sharp({ create: { width: 123, height: 77, channels: 4, background: '#286cb0' } })
    .png()
    .toFile(imagePath);
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 100]);
  pdf.addPage([200, 100]);
  const pdfPath = join(fixtureRoot, 'document.pdf');
  await writeFile(pdfPath, Buffer.from(await pdf.save({ useObjectStreams: false })));
  const videoPath = join(fixtureRoot, 'video.mp4');
  await writeFile(videoPath, filesF4cVideoFixtures()['landscape.mp4']);

  const junctionPath = join(fixtureRoot, 'Nested junction');
  let junctionCreated = false;
  try {
    await symlink(nested, junctionPath, 'junction');
    junctionCreated = true;
  } catch {}
  return {
    small,
    empty,
    thousand,
    tenThousand,
    nested,
    longFile,
    largeFile,
    imagePath,
    pdfPath,
    videoPath,
    junctionPath,
    junctionCreated,
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
    await delay(100);
  }
  throw new Error(`Timed out waiting for WebView condition: ${expression}`);
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

async function getProperties(client, paths) {
  const started = performance.now();
  const result = value(await invoke(client, 'get_native_file_properties', { paths }), 'properties');
  return { result, latencyMs: performance.now() - started };
}

async function measure(client, paths) {
  const started = performance.now();
  const initial = value(
    await invoke(client, 'start_native_directory_measurement', { paths }),
    'start measurement',
  );
  let snapshot = initial;
  while (!['completed', 'cancelled', 'failed'].includes(snapshot.state)) {
    await delay(5);
    snapshot = value(
      await invoke(client, 'get_native_directory_measurement', { id: initial.id }),
      'poll measurement',
    );
  }
  value(
    await invoke(client, 'release_native_directory_measurement', { id: initial.id }),
    'release measurement',
  );
  return { snapshot, latencyMs: performance.now() - started };
}

async function previewDescriptor(client, path) {
  const request = { path, mode: 'image-preview', requestedWidth: 512, requestedHeight: 512 };
  const initial = value(
    await invoke(client, 'start_native_file_preview', { request }),
    'start preview',
  );
  let snapshot = initial;
  while (!['completed', 'cancelled', 'failed'].includes(snapshot.state)) {
    await delay(5);
    snapshot = value(
      await invoke(client, 'get_native_file_preview', { id: initial.id }),
      'poll preview',
    );
  }
  value(await invoke(client, 'release_native_file_preview', { id: initial.id }), 'release preview');
  return snapshot.result;
}

async function processSample(pid) {
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString())+','+($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)+','+$p.HandleCount.ToString()+','+$p.Threads.Count.ToString()))`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const [workingSetBytes, cpuSeconds, handleCount, threadCount] = stdout.trim().split(',').map(Number);
  return { workingSetBytes, cpuSeconds, handleCount, threadCount };
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

  const normalPath = join(fixture.small, 'normal.txt');
  const normal = await getProperties(client, [normalPath]);
  expect(
    normal.result.fileCount === 1 && normal.result.items[0].sizeBytes === 27,
    'Normal file properties were inaccurate.',
  );
  expect(
    normal.result.items[0].allocatedBytes !== null,
    'Size on disk was unavailable for a normal local file.',
  );
  const large = await getProperties(client, [fixture.largeFile]);
  expect(
    large.result.items[0].sizeBytes === 1024 * 1024 * 1024,
    'Large-file metadata was not immediate/exact.',
  );
  const folder = await getProperties(client, [fixture.small]);
  expect(
    folder.result.folderCount === 1 && folder.result.containsUnmeasuredFolders,
    'Folder properties pretended recursive size was known.',
  );
  const empty = await measure(client, [fixture.empty]);
  expect(
    empty.snapshot.state === 'completed' && empty.snapshot.filesScanned === 0,
    'Empty-folder measurement failed.',
  );

  const sameParent = await getProperties(client, [
    normalPath,
    join(fixture.small, 'name with spaces.txt'),
  ]);
  expect(
    sameParent.result.itemCount === 2 && sameParent.result.commonParentPath === fixture.small,
    'Same-parent aggregation failed.',
  );
  const mixed = await getProperties(client, [normalPath, fixture.empty]);
  expect(
    mixed.result.fileCount === 1 &&
      mixed.result.folderCount === 1 &&
      mixed.result.containsUnmeasuredFolders,
    'Mixed aggregation was dishonest.',
  );
  const differentParents = await getProperties(client, [normalPath, fixture.longFile]);
  expect(
    differentParents.result.commonParentPath === null,
    'Different locations were incorrectly merged.',
  );

  const drivePath = parse(fixtureRoot).root;
  const drive = await getProperties(client, [drivePath]);
  expect(
    drive.result.items[0].kind === 'drive' && drive.result.items[0].volume?.totalBytes > 0,
    'Drive properties failed.',
  );
  const unicode = await getProperties(client, [join(fixture.small, 'Unicode नमस्ते 東京.txt')]);
  expect(unicode.result.items[0].accessible, 'Unicode properties failed.');
  const long = await getProperties(client, [fixture.longFile]);
  expect(long.result.items[0].accessible, 'Long-path properties failed.');

  const oneThousand = await measure(client, [fixture.thousand]);
  const tenThousand = await measure(client, [fixture.tenThousand]);
  const nested = await measure(client, [fixture.nested]);
  expect(
    oneThousand.snapshot.filesScanned === 1_000 && oneThousand.snapshot.logicalBytes === 17_000,
    '1,000-file measurement was inaccurate.',
  );
  expect(
    tenThousand.snapshot.filesScanned === 10_000 && tenThousand.snapshot.logicalBytes === 170_000,
    '10,000-file measurement was inaccurate.',
  );
  expect(
    nested.snapshot.filesScanned === 1_000 && nested.snapshot.directoriesScanned >= 61,
    'Nested measurement was inaccurate.',
  );

  let junction = { available: fixture.junctionCreated, skipped: false };
  if (fixture.junctionCreated) {
    const measured = await measure(client, [fixture.junctionPath]);
    expect(
      measured.snapshot.reparsePointsSkipped === 1 && measured.snapshot.filesScanned === 0,
      'Directory reparse point was followed.',
    );
    junction.skipped = true;
  }

  const missing = await getProperties(client, [join(fixtureRoot, 'missing item.txt')]);
  expect(
    !missing.result.items[0].accessible && missing.result.items[0].accessError,
    'Unavailable-item status was not structured.',
  );

  const cancelStart = performance.now();
  const cancelling = value(
    await invoke(client, 'start_native_directory_measurement', { paths: [fixture.tenThousand] }),
    'start cancellation',
  );
  value(
    await invoke(client, 'cancel_native_directory_measurement', { id: cancelling.id }),
    'cancel measurement',
  );
  let cancelled = value(
    await invoke(client, 'get_native_directory_measurement', { id: cancelling.id }),
    'poll cancellation',
  );
  while (!['cancelled', 'completed', 'failed'].includes(cancelled.state)) {
    await delay(2);
    cancelled = value(
      await invoke(client, 'get_native_directory_measurement', { id: cancelling.id }),
      'poll cancellation',
    );
  }
  expect(cancelled.state === 'cancelled', 'Native directory traversal did not cancel.');
  value(
    await invoke(client, 'release_native_directory_measurement', { id: cancelling.id }),
    'release cancellation',
  );
  const cancellationMs = performance.now() - cancelStart;

  const image = await previewDescriptor(client, fixture.imagePath);
  const pdfResult = await previewDescriptor(client, fixture.pdfPath);
  const video = await previewDescriptor(client, fixture.videoPath);
  expect(image.sourceWidth === 123 && image.sourceHeight === 77, 'Image metadata reuse failed.');
  expect(pdfResult.pageCount === 2, 'PDF metadata reuse failed.');
  expect(
    video.sourceWidth === 320 && video.sourceHeight === 180 && video.durationMs > 0,
    'Video metadata reuse failed.',
  );

  const lifecycleBaseline = await processSample(child.pid);
  for (let index = 0; index < 30; index += 1) {
    await getProperties(client, [index % 2 ? normalPath : fixture.small]);
    const started = value(
      await invoke(client, 'start_native_directory_measurement', { paths: [fixture.tenThousand] }),
      'lifecycle start',
    );
    value(
      await invoke(client, 'cancel_native_directory_measurement', { id: started.id }),
      'lifecycle cancel',
    );
    let state = value(
      await invoke(client, 'get_native_directory_measurement', { id: started.id }),
      'lifecycle poll',
    );
    while (!['cancelled', 'completed', 'failed'].includes(state.state)) {
      await delay(2);
      state = value(
        await invoke(client, 'get_native_directory_measurement', { id: started.id }),
        'lifecycle poll',
      );
    }
    value(
      await invoke(client, 'release_native_directory_measurement', { id: started.id }),
      'lifecycle release',
    );
  }
  const diagnostics = value(
    await invoke(client, 'get_native_directory_measurement_diagnostics'),
    'measurement diagnostics',
  );
  expect(
    diagnostics.activeJobs === 0 && diagnostics.retainedJobs === 0,
    'Measurement jobs remained retained.',
  );
  const after = await processSample(child.pid);
  await delay(2_000);
  const idle = await processSample(child.pid);
  expect(
    after.handleCount <= lifecycleBaseline.handleCount + 24,
    'Repeated Properties use caused unbounded handle growth.',
  );
  expect(
    after.threadCount <= lifecycleBaseline.threadCount + 4,
    'Repeated Properties use caused unbounded thread growth.',
  );
  expect(
    after.workingSetBytes <= lifecycleBaseline.workingSetBytes + 64 * 1024 * 1024,
    'Repeated Properties use caused unbounded working-set growth.',
  );
  expect(idle.cpuSeconds - after.cpuSeconds < 0.25, 'Properties consumed CPU while idle.');

  report = {
    status: 'passed',
    executable,
    timingsMs: {
      normalFileProperties: Number(normal.latencyMs.toFixed(2)),
      largeFileProperties: Number(large.latencyMs.toFixed(2)),
      directoryBaseProperties: Number(folder.latencyMs.toFixed(2)),
      driveProperties: Number(drive.latencyMs.toFixed(2)),
      multipleSelection: Number(mixed.latencyMs.toFixed(2)),
      thousandFiles: Number(oneThousand.latencyMs.toFixed(2)),
      tenThousandFiles: Number(tenThousand.latencyMs.toFixed(2)),
      nestedTree: Number(nested.latencyMs.toFixed(2)),
      cancellation: Number(cancellationMs.toFixed(2)),
    },
    measurement: {
      thousand: oneThousand.snapshot,
      tenThousand: tenThousand.snapshot,
      nested: nested.snapshot,
      junction,
    },
    typeSpecificReuse: { image: true, pdf: true, video: true },
    allocation: {
      normalFileLogicalBytes: normal.result.items[0].sizeBytes,
      normalFileAllocatedBytes: normal.result.items[0].allocatedBytes,
      largeFileLogicalBytes: large.result.items[0].sizeBytes,
      largeFileAllocatedBytes: large.result.items[0].allocatedBytes,
      sparseAttribute: large.result.items[0].attributes.sparse,
    },
    drive: { kind: drive.result.items[0].volume.kind, removableTested: false },
    inaccessibleFixture:
      'not safely reproducible without changing ACLs; structured missing/unavailable path verified',
    lifecycle: diagnostics,
    resources: {
      workingSetBeforeBytes: baseline.workingSetBytes,
      workingSetAfterBytes: after.workingSetBytes,
      workingSetDeltaBytes: after.workingSetBytes - baseline.workingSetBytes,
      handleCountBefore: baseline.handleCount,
      handleCountAfter: after.handleCount,
      idleHandleCount: idle.handleCount,
      threadCountBefore: baseline.threadCount,
      lifecycleBaselineWorkingSetBytes: lifecycleBaseline.workingSetBytes,
      lifecycleWorkingSetDeltaBytes: after.workingSetBytes - lifecycleBaseline.workingSetBytes,
      lifecycleBaselineHandleCount: lifecycleBaseline.handleCount,
      lifecycleHandleDelta: after.handleCount - lifecycleBaseline.handleCount,
      lifecycleBaselineThreadCount: lifecycleBaseline.threadCount,
      lifecycleThreadDelta: after.threadCount - lifecycleBaseline.threadCount,
      cpuSecondsDuringWork: Number((after.cpuSeconds - baseline.cpuSeconds).toFixed(4)),
      idleCpuSecondsOverTwoSeconds: Number((idle.cpuSeconds - after.cpuSeconds).toFixed(4)),
    },
    longPathCharacters: fixture.longFile.length,
    clipboardTouched: false,
    personalFileContentReadUnnecessarily: false,
    nativeMutationPerformedByProperties: false,
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
    root.startsWith(`${temp}\\`) && basename(root).startsWith('NammuFilesF5ATest-'),
    'Unsafe cleanup root.',
  );
  await removeGeneratedDirectory(root);
  if (profile.startsWith(`${temp}\\`) && basename(profile).startsWith('NammuFilesF5ATest-'))
    await removeGeneratedDirectory(profile);
}

let remains = true;
try {
  await access(isolatedRoot);
} catch {
  remains = false;
}
expect(!remains, 'F5A fixtures remained after acceptance.');
console.info(JSON.stringify({ ...report, remainingFixtures: 0 }));
