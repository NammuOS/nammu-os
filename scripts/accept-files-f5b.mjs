import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, relative, resolve } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F5B_EXECUTABLE;
if (!executableInput) throw new Error('Set NAMMU_F5B_EXECUTABLE to the release executable.');
const executable = resolve(executableInput);
await access(executable);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fixtureRoot = join(tmpdir(), `NammuFilesF5BTest-${randomUUID()}`);
const profileRoot = `${fixtureRoot}-WebView2`;
const execFile = promisify(execFileCallback);
const archiveIds = new Set();
const operationIds = new Set();

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function syntheticZip(entryName, contents, options = {}) {
  const name = Buffer.from(entryName, 'utf8');
  const source = Buffer.from(contents);
  const compressed = options.deflate ? deflateRawSync(source, { level: 9 }) : source;
  const method = options.deflate ? 8 : 0;
  const checksum = options.badCrc ? (crc32(source) ^ 0xffffffff) >>> 0 : crc32(source);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(options.symlink ? 0x0314 : 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28);
  if (options.symlink) central.writeUInt32LE((0o120777 << 16) >>> 0, 38);
  const centralOffset = local.length + name.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function createTree(root, count) {
  await mkdir(root, { recursive: true });
  for (let offset = 0; offset < count; offset += 100) {
    await Promise.all(
      Array.from({ length: Math.min(100, count - offset) }, (_, index) =>
        writeFile(
          join(root, `item-${String(offset + index).padStart(5, '0')}.txt`),
          `entry-${offset + index}`,
        ),
      ),
    );
  }
}

async function writeLargeGeneratedFile(path, bytes) {
  const handle = await open(path, 'w');
  try {
    let written = 0;
    while (written < bytes) {
      const block = randomBytes(Math.min(1024 * 1024, bytes - written));
      await handle.write(block);
      written += block.length;
    }
  } finally {
    await handle.close();
  }
}

async function createFixtures() {
  const source = join(fixtureRoot, 'Source tree');
  const nested = join(source, 'Nested folder', 'Deep');
  await mkdir(nested, { recursive: true });
  await writeFile(join(source, 'hello world.txt'), 'Nammu ZIP round trip');
  const unicodeFile = join(nested, 'Unicode नमस्ते 東京 😀.txt');
  await writeFile(unicodeFile, 'Unicode archive bytes');
  await mkdir(join(source, 'Empty folder'));
  const outsideReparseTarget = join(fixtureRoot, 'Outside reparse target');
  await mkdir(outsideReparseTarget);
  await writeFile(join(outsideReparseTarget, 'must-not-be-archived.txt'), 'outside source');
  const reparseSource = join(source, 'Outside junction');
  let reparseFixtureCreated = true;
  try {
    await symlink(outsideReparseTarget, reparseSource, 'junction');
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    reparseFixtureCreated = false;
  }
  let longRoot = join(source, 'Long path');
  for (let index = 0; index < 8; index += 1) {
    longRoot = join(longRoot, `segment-${index}-archive-long-path-validation`);
    await mkdir(longRoot, { recursive: true });
  }
  const longFile = join(longRoot, 'long-file.txt');
  await writeFile(longFile, 'long path bytes');
  expect(longFile.length > 260, 'Long-path archive fixture did not exceed 260 characters.');
  const many = join(fixtureRoot, 'Many 10000');
  const thousand = join(fixtureRoot, 'Many 1000');
  await createTree(many, 10_000);
  await createTree(thousand, 1_000);
  const large = join(fixtureRoot, 'generated-100mb.bin');
  await writeLargeGeneratedFile(large, 100 * 1024 * 1024);
  const malicious = {};
  for (const [name, entry] of Object.entries({
    zipSlip: '../../escape.txt',
    absolute: '/absolute.txt',
    drive: 'C:/escape.txt',
    unc: '\\\\server\\share\\escape.txt',
  })) {
    const path = join(fixtureRoot, `${name}.zip`);
    await writeFile(path, syntheticZip(entry, 'blocked'));
    malicious[name] = path;
  }
  malicious.symlink = join(fixtureRoot, 'symlink.zip');
  await writeFile(malicious.symlink, syntheticZip('unsafe-link', '../outside', { symlink: true }));
  malicious.bomb = join(fixtureRoot, 'ratio-bomb.zip');
  await writeFile(
    malicious.bomb,
    syntheticZip('huge-zeroes.bin', Buffer.alloc(32 * 1024 * 1024), { deflate: true }),
  );
  malicious.badCrc = join(fixtureRoot, 'bad-crc.zip');
  await writeFile(malicious.badCrc, syntheticZip('bad.txt', 'corrupt me', { badCrc: true }));
  malicious.fake = join(fixtureRoot, 'fake.zip');
  await writeFile(malicious.fake, 'not a zip');
  malicious.truncated = join(fixtureRoot, 'truncated.zip');
  await writeFile(malicious.truncated, syntheticZip('file.txt', 'truncated').subarray(0, 35));
  const stored = join(fixtureRoot, 'stored-fixture.zip');
  await writeFile(stored, syntheticZip('Stored entry.txt', 'stored entry bytes'));
  return {
    source,
    nested,
    longFile,
    unicodeFile,
    many,
    thousand,
    large,
    malicious,
    stored,
    reparseFixtureCreated,
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
    close: () => socket.close(),
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
    throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed.');
  return result.result?.value;
}
async function waitForValue(client, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for packaged runtime condition: ${expression}`);
}
const invoke = (client, command, args = {}) =>
  evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`,
  );
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
function value(response, operation) {
  if (response?.status !== 'success')
    throw new Error(
      `${operation}: ${response?.error?.code || 'INVALID_RESPONSE'} ${response?.error?.message || ''}`,
    );
  return response.value;
}
async function waitJob(client, initial) {
  let snapshot = initial;
  while (!['completed', 'cancelled', 'failed'].includes(snapshot.state)) {
    await delay(20);
    snapshot = value(
      await invoke(client, 'get_native_archive_operation', { id: initial.id }),
      'poll archive job',
    );
  }
  return snapshot;
}
async function createZip(client, sources, destinationPath, strategy = 'cancel') {
  const startedAt = performance.now();
  const initial = value(
    await invoke(client, 'start_native_zip_create', {
      sources,
      destinationPath,
      conflictStrategy: strategy,
    }),
    'start ZIP creation',
  );
  operationIds.add(initial.id);
  const snapshot = await waitJob(client, initial);
  return { snapshot, durationMs: performance.now() - startedAt };
}
async function openArchive(client, path) {
  const startedAt = performance.now();
  const summary = value(await invoke(client, 'open_native_archive', { path }), 'open archive');
  archiveIds.add(summary.id);
  return { summary, durationMs: performance.now() - startedAt };
}
async function extract(
  client,
  archiveId,
  destinationPath,
  selectedEntryIds = [],
  strategy = 'cancel',
) {
  const startedAt = performance.now();
  const initial = value(
    await invoke(client, 'start_native_archive_extract', {
      archiveId,
      destinationPath,
      selectedEntryIds,
      conflictStrategy: strategy,
    }),
    'start extraction',
  );
  operationIds.add(initial.id);
  const snapshot = await waitJob(client, initial);
  return { snapshot, durationMs: performance.now() - startedAt };
}

async function countPartialFiles(root) {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += await countPartialFiles(path);
    else if (entry.name.includes('.nammu-partial-')) count += 1;
  }
  return count;
}

await mkdir(fixtureRoot, { recursive: true });
await mkdir(profileRoot, { recursive: true });
const fixture = await createFixtures();
const debugPort = await allocateDebugPort();
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profileRoot,
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
  const smallZip = join(fixtureRoot, 'Source tree.zip');
  const smallCreated = await createZip(client, [fixture.source], smallZip);
  expect(smallCreated.snapshot.state === 'completed', 'Small ZIP creation failed.');
  if (fixture.reparseFixtureCreated) {
    expect(
      smallCreated.snapshot.skippedEntries === 1,
      'ZIP creation did not report the skipped reparse-point source.',
    );
  }
  const smallOpened = await openArchive(client, smallZip);
  const smallListStarted = performance.now();
  const rootList = value(
    await invoke(client, 'get_native_archive_entries', {
      archiveId: smallOpened.summary.id,
      path: '',
      offset: 0,
      limit: 500,
    }),
    'list ZIP root',
  );
  const smallListMs = performance.now() - smallListStarted;
  expect(
    rootList.entries.some(
      (entry) => entry.name === basename(fixture.source) && entry.kind === 'directory',
    ),
    'ZIP hierarchy root was not preserved.',
  );
  const sourceList = value(
    await invoke(client, 'get_native_archive_entries', {
      archiveId: smallOpened.summary.id,
      path: basename(fixture.source),
      offset: 0,
      limit: 500,
    }),
    'list nested ZIP path',
  );
  expect(
    sourceList.entries.some((entry) => entry.name === 'Nested folder'),
    'Nested ZIP navigation failed.',
  );
  expect(
    !sourceList.entries.some((entry) => entry.name === 'Outside junction'),
    'ZIP creation followed a reparse-point source.',
  );
  const extractionRoot = join(fixtureRoot, 'Extracted');
  await mkdir(extractionRoot);
  const smallExtracted = await extract(client, smallOpened.summary.id, extractionRoot);
  expect(smallExtracted.snapshot.state === 'completed', 'Small ZIP extraction failed.');
  expect(
    (await sha256(join(extractionRoot, basename(fixture.source), 'hello world.txt'))) ===
      (await sha256(join(fixture.source, 'hello world.txt'))),
    'Round-trip SHA-256 mismatch.',
  );
  expect(
    (await sha256(
      join(extractionRoot, basename(fixture.source), relative(fixture.source, fixture.longFile)),
    )) === (await sha256(fixture.longFile)),
    'Long-path round-trip SHA-256 mismatch.',
  );
  expect(
    (await sha256(
      join(extractionRoot, basename(fixture.source), relative(fixture.source, fixture.unicodeFile)),
    )) === (await sha256(fixture.unicodeFile)),
    'Unicode round-trip SHA-256 mismatch.',
  );

  const selectedEntry = sourceList.entries.find((entry) => entry.name === 'hello world.txt');
  expect(selectedEntry, 'Selected extraction fixture was not listed.');
  const selectedRoot = join(fixtureRoot, 'Selected extraction');
  await mkdir(selectedRoot);
  const selectedExtracted = await extract(
    client,
    smallOpened.summary.id,
    selectedRoot,
    [selectedEntry.id],
  );
  expect(
    selectedExtracted.snapshot.state === 'completed' &&
      selectedExtracted.snapshot.filesCompleted === 1,
    'Selected-entry extraction failed.',
  );

  const unicodeZip = join(fixtureRoot, 'अभिलेख 東京 😀.zip');
  const unicodeCreated = await createZip(client, [fixture.unicodeFile], unicodeZip);
  expect(unicodeCreated.snapshot.state === 'completed', 'Unicode ZIP creation failed.');
  const unicodeOpened = await openArchive(client, unicodeZip);
  const unicodeDestination = join(fixtureRoot, 'निकाला 東京 😀');
  await mkdir(unicodeDestination);
  const unicodeExtracted = await extract(client, unicodeOpened.summary.id, unicodeDestination);
  expect(unicodeExtracted.snapshot.state === 'completed', 'Unicode ZIP extraction failed.');
  expect(
    (await sha256(join(unicodeDestination, basename(fixture.unicodeFile)))) ===
      (await sha256(fixture.unicodeFile)),
    'Unicode archive-name/destination round trip failed.',
  );

  let longArchiveDirectory = join(fixtureRoot, 'Long archive location');
  let longDestination = join(fixtureRoot, 'Long extraction location');
  for (let index = 0; index < 8; index += 1) {
    const segment = `segment-${index}-packaged-long-path-validation`;
    longArchiveDirectory = join(longArchiveDirectory, segment);
    longDestination = join(longDestination, segment);
  }
  await mkdir(longArchiveDirectory, { recursive: true });
  await mkdir(longDestination, { recursive: true });
  const longArchive = join(longArchiveDirectory, 'Long archive.zip');
  expect(
    longArchive.length > 260 && longDestination.length > 260,
    'Long archive fixture paths did not exceed 260 characters.',
  );
  const longCreated = await createZip(client, [fixture.longFile], longArchive);
  expect(longCreated.snapshot.state === 'completed', 'Long-path ZIP creation failed.');
  const longOpened = await openArchive(client, longArchive);
  const longExtracted = await extract(client, longOpened.summary.id, longDestination);
  expect(longExtracted.snapshot.state === 'completed', 'Long-path ZIP extraction failed.');
  expect(
    (await sha256(join(longDestination, basename(fixture.longFile)))) ===
      (await sha256(fixture.longFile)),
    'Long archive/destination content check failed.',
  );

  const conflictPath = join(extractionRoot, basename(fixture.source), 'hello world.txt');
  await writeFile(conflictPath, 'existing data must survive');
  const keepBoth = await extract(client, smallOpened.summary.id, extractionRoot, [], 'keep-both');
  expect(keepBoth.snapshot.state === 'completed', 'Keep Both extraction failed.');
  expect(
    (await readFile(conflictPath, 'utf8')) === 'existing data must survive',
    'Extraction overwrote existing data.',
  );
  expect(
    await access(join(extractionRoot, basename(fixture.source), 'hello world copy.txt'))
      .then(() => true)
      .catch(() => false),
    'Keep Both did not preserve the colliding file.',
  );

  const insideZip = join(fixture.source, 'Source tree.zip');
  const insideCreated = await createZip(client, [fixture.source], insideZip);
  expect(
    insideCreated.snapshot.state === 'completed',
    'Destination-inside-source ZIP creation failed safely.',
  );
  const insideOpened = await openArchive(client, insideZip);
  const insideList = value(
    await invoke(client, 'get_native_archive_entries', {
      archiveId: insideOpened.summary.id,
      path: basename(fixture.source),
      offset: 0,
      limit: 500,
    }),
    'list destination-inside-source ZIP',
  );
  expect(
    !insideList.entries.some(
      (entry) => entry.name === basename(insideZip) || entry.name.includes('.nammu-partial-'),
    ),
    'ZIP creation recursively included its partial output.',
  );

  const storedOpened = await openArchive(client, fixture.stored);
  const storedDestination = join(fixtureRoot, 'Stored extraction');
  await mkdir(storedDestination);
  const storedExtracted = await extract(client, storedOpened.summary.id, storedDestination);
  expect(
    storedExtracted.snapshot.state === 'completed' &&
      (await readFile(join(storedDestination, 'Stored entry.txt'), 'utf8')) ===
        'stored entry bytes',
    'Stored ZIP entry extraction failed.',
  );

  for (const path of Object.values(fixture.malicious).slice(0, 4)) {
    const response = await invoke(client, 'open_native_archive', { path });
    expect(
      response.status === 'error' && response.error.code === 'ARCHIVE_ENTRY_UNSAFE',
      `Unsafe archive path was accepted: ${path}`,
    );
  }
  const symlinkOpened = await openArchive(client, fixture.malicious.symlink);
  const symlinkDestination = join(fixtureRoot, 'Symlink extraction');
  await mkdir(symlinkDestination);
  const symlinkExtracted = await extract(client, symlinkOpened.summary.id, symlinkDestination);
  expect(
    symlinkExtracted.snapshot.state === 'completed' &&
      symlinkExtracted.snapshot.skippedEntries === 1,
    'Archive symlink was not explicitly skipped.',
  );
  expect((await readdir(symlinkDestination)).length === 0, 'Archive symlink was materialized.');

  const bombOpened = await openArchive(client, fixture.malicious.bomb);
  const bombResponse = await invoke(client, 'start_native_archive_extract', {
    archiveId: bombOpened.summary.id,
    destinationPath: fixtureRoot,
    selectedEntryIds: [],
    conflictStrategy: 'cancel',
  });
  expect(
    bombResponse.status === 'error' && bombResponse.error.code === 'ARCHIVE_LIMIT_EXCEEDED',
    'Compression-ratio guard did not activate.',
  );
  for (const path of [fixture.malicious.fake, fixture.malicious.truncated]) {
    const response = await invoke(client, 'open_native_archive', { path });
    expect(response.status === 'error', `Malformed ZIP was accepted: ${path}`);
  }

  const crcOpened = await openArchive(client, fixture.malicious.badCrc);
  const crcDestination = join(fixtureRoot, 'CRC extraction');
  await mkdir(crcDestination);
  const crcExtracted = await extract(client, crcOpened.summary.id, crcDestination);
  expect(
    crcExtracted.snapshot.state === 'failed' &&
      crcExtracted.snapshot.error?.code === 'ARCHIVE_CORRUPT',
    'CRC corruption was not detected.',
  );

  const externalOpened = await openArchive(client, smallZip);
  await appendFile(smallZip, Buffer.from([0]));
  const changed = await invoke(client, 'get_native_archive_entries', {
    archiveId: externalOpened.summary.id,
    path: '',
    offset: 0,
    limit: 500,
  });
  expect(
    changed.status === 'error' && changed.error.code === 'FILE_CHANGED',
    'External ZIP change was not detected.',
  );

  const manyZip = join(fixtureRoot, 'many-10000.zip');
  const manyCreated = await createZip(client, [fixture.many], manyZip);
  expect(manyCreated.snapshot.state === 'completed', '10k ZIP creation failed.');
  const manyOpened = await openArchive(client, manyZip);
  const manyListStarted = performance.now();
  const manyList = value(
    await invoke(client, 'get_native_archive_entries', {
      archiveId: manyOpened.summary.id,
      path: basename(fixture.many),
      offset: 0,
      limit: 500,
    }),
    'list 10k ZIP',
  );
  const manyListMs = performance.now() - manyListStarted;
  expect(manyList.entries.length === 500 && manyList.hasMore, '10k ZIP listing was not paginated.');
  const manyExtractRoot = join(fixtureRoot, 'Many extracted');
  await mkdir(manyExtractRoot);
  const manyExtracted = await extract(client, manyOpened.summary.id, manyExtractRoot);
  expect(
    manyExtracted.snapshot.state === 'completed' &&
      manyExtracted.snapshot.filesCompleted === 10_000,
    '10k ZIP extraction failed.',
  );

  const thousandZip = join(fixtureRoot, 'many-1000.zip');
  const thousandCreated = await createZip(client, [fixture.thousand], thousandZip);
  const thousandOpened = await openArchive(client, thousandZip);
  const thousandExtractRoot = join(fixtureRoot, 'Thousand extracted');
  await mkdir(thousandExtractRoot);
  const thousandExtracted = await extract(client, thousandOpened.summary.id, thousandExtractRoot);

  const largeZip = join(fixtureRoot, 'generated-100mb.zip');
  const largeCreated = await createZip(client, [fixture.large], largeZip);
  expect(largeCreated.snapshot.state === 'completed', '100 MB ZIP creation failed.');
  const largeOpened = await openArchive(client, largeZip);
  const largeExtractRoot = join(fixtureRoot, 'Large extracted');
  await mkdir(largeExtractRoot);
  const largeExtracted = await extract(client, largeOpened.summary.id, largeExtractRoot);
  expect(largeExtracted.snapshot.state === 'completed', '100 MB extraction failed.');
  expect(
    (await sha256(fixture.large)) ===
      (await sha256(join(largeExtractRoot, basename(fixture.large)))),
    '100 MB round-trip hash mismatch.',
  );

  const cancelZip = join(fixtureRoot, 'cancel.zip');
  const cancelInitial = value(
    await invoke(client, 'start_native_zip_create', {
      sources: [fixture.large],
      destinationPath: cancelZip,
      conflictStrategy: 'cancel',
    }),
    'start cancellable ZIP',
  );
  operationIds.add(cancelInitial.id);
  const cancelStarted = performance.now();
  await invoke(client, 'cancel_native_archive_operation', { id: cancelInitial.id });
  const cancelled = await waitJob(client, cancelInitial);
  expect(cancelled.state === 'cancelled', 'ZIP cancellation did not stop real work.');
  const cancellationLatencyMs = performance.now() - cancelStarted;

  const extractCancelRoot = join(fixtureRoot, 'Cancelled extraction');
  await mkdir(extractCancelRoot);
  const extractCancelInitial = value(
    await invoke(client, 'start_native_archive_extract', {
      archiveId: manyOpened.summary.id,
      destinationPath: extractCancelRoot,
      selectedEntryIds: [],
      conflictStrategy: 'cancel',
    }),
    'start cancellable extraction',
  );
  operationIds.add(extractCancelInitial.id);
  const extractCancelStarted = performance.now();
  await invoke(client, 'cancel_native_archive_operation', { id: extractCancelInitial.id });
  const extractCancelled = await waitJob(client, extractCancelInitial);
  expect(extractCancelled.state === 'cancelled', 'Extraction cancellation did not stop real work.');
  const extractionCancellationLatencyMs = performance.now() - extractCancelStarted;

  for (let index = 0; index < 30; index += 1) {
    const opened = await openArchive(client, manyZip);
    value(
      await invoke(client, 'release_native_archive', { archiveId: opened.summary.id }),
      'release archive',
    );
    archiveIds.delete(opened.summary.id);
  }
  for (const archiveId of archiveIds) {
    value(await invoke(client, 'release_native_archive', { archiveId }), 'release archive');
  }
  archiveIds.clear();
  for (const id of operationIds) {
    value(await invoke(client, 'release_native_archive_operation', { id }), 'release archive job');
  }
  operationIds.clear();
  const diagnostics = value(
    await invoke(client, 'get_native_archive_diagnostics'),
    'archive diagnostics',
  );
  expect(diagnostics.activeJobs === 0, 'Archive jobs remained active.');
  expect(diagnostics.openArchives === 0, 'Archive sessions remained retained.');
  expect(diagnostics.retainedJobs === 0, 'Archive job records remained retained.');
  expect(
    (await countPartialFiles(fixtureRoot)) === 0,
    'Archive partial files remained after handled work.',
  );
  const afterWork = await processSample(child.pid);
  await delay(2_000);
  const afterIdle = await processSample(child.pid);

  report = {
    fixtureRoot,
    smallZip: {
      createMs: Number(smallCreated.durationMs.toFixed(2)),
      openMs: Number(smallOpened.durationMs.toFixed(2)),
      firstEntriesMs: Number(smallListMs.toFixed(2)),
      openToFirstEntriesMs: Number((smallOpened.durationMs + smallListMs).toFixed(2)),
      extractMs: Number(smallExtracted.durationMs.toFixed(2)),
      entries: smallOpened.summary.entryCount,
    },
    tenThousand: {
      createMs: Number(manyCreated.durationMs.toFixed(2)),
      openMs: Number(manyOpened.durationMs.toFixed(2)),
      first500ListMs: Number(manyListMs.toFixed(2)),
      extractMs: Number(manyExtracted.durationMs.toFixed(2)),
    },
    thousand: {
      createMs: Number(thousandCreated.durationMs.toFixed(2)),
      extractMs: Number(thousandExtracted.durationMs.toFixed(2)),
    },
    hundredMegabytes: {
      createMs: Number(largeCreated.durationMs.toFixed(2)),
      extractMs: Number(largeExtracted.durationMs.toFixed(2)),
    },
    cancellationLatencyMs: Number(cancellationLatencyMs.toFixed(2)),
    extractionCancellationLatencyMs: Number(extractionCancellationLatencyMs.toFixed(2)),
    process: {
      baseline,
      afterWork,
      afterIdle,
      idleCpuSeconds: Number((afterIdle.cpuSeconds - afterWork.cpuSeconds).toFixed(4)),
      workingSetGrowthBytes: afterWork.workingSetBytes - baseline.workingSetBytes,
    },
    diagnostics,
    zipSlipBlocked: true,
    absoluteDriveUncBlocked: true,
    symlinkMaterialized: false,
    creationReparsePointFollowed: false,
    reparseFixtureCreated: fixture.reparseFixtureCreated,
    crcFailureDetected: true,
    compressionBombBlocked: true,
    externalChangeDetected: true,
    selectedEntryExtraction: true,
    storedEntryExtraction: true,
    unicodeArchiveAndDestination: true,
    longArchiveAndDestination: true,
    clipboardTouched: false,
    personalFileContentsUsed: false,
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
  const root = normalize(resolve(fixtureRoot));
  const profile = normalize(resolve(profileRoot));
  const approvedBase = `${normalize(resolve(tmpdir()))}\\`;
  expect(
    root.startsWith(approvedBase) && profile.startsWith(approvedBase),
    'Refusing cleanup outside the temporary directory.',
  );
  await rm(root, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}

console.info(
  JSON.stringify(
    {
      ...report,
      remainingFixtures: 0,
      remainingProcesses: 0,
    },
    null,
    2,
  ),
);
