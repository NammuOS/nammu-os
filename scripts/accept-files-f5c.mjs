import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F5C_EXECUTABLE;
const helperInput = process.env.NAMMU_F5C_HELPER;
if (!executableInput) throw new Error('Set NAMMU_F5C_EXECUTABLE to the release executable.');
if (!helperInput) throw new Error('Set NAMMU_F5C_HELPER to the release protocol helper.');
const executable = resolve(executableInput);
const helperExecutable = resolve(helperInput);
await Promise.all([access(executable), access(helperExecutable)]);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const fixtureRoot = join(tmpdir(), `NammuFilesF5CTest-${randomUUID()}`);
const profileRoot = `${fixtureRoot}-WebView2`;
const execFile = promisify(execFileCallback);

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

async function waitForPackagedTarget(port, child) {
  const output = [];
  child.stdout?.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk) => output.push(chunk.toString()));
  const exited = new Promise((_, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      rejectExit(
        new Error(
          `Packaged Nammu exited before WebView2 was ready (code=${code}, signal=${signal}).${output.length ? `\n${output.join('').slice(-4_000)}` : ''}`,
        ),
      );
    });
  });
  return Promise.race([waitForTarget(port), exited]);
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

function value(response, operation) {
  if (response?.status !== 'success')
    throw new Error(
      `${operation}: ${response?.error?.code || 'INVALID_RESPONSE'} ${response?.error?.message || ''}`,
    );
  return response.value;
}

async function waitFileJob(client, initial) {
  let snapshot = initial;
  while (!['completed', 'cancelled', 'failed'].includes(snapshot.state)) {
    await delay(20);
    snapshot = value(
      await invoke(client, 'get_native_file_operation', { id: initial.id }),
      'poll file job',
    );
  }
  return snapshot;
}

async function runTransfer(
  client,
  operation,
  sources,
  destinationPath,
  conflictStrategy = 'cancel',
) {
  const command = operation === 'move' ? 'start_native_move' : 'start_native_copy';
  const started = value(
    await invoke(client, command, { sources, destinationPath, conflictStrategy }),
    command,
  );
  return waitFileJob(client, started);
}

async function processSample(pid) {
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString())+','+($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)+','+$p.HandleCount.ToString()+','+$p.Threads.Count.ToString()))`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const [workingSetBytes, cpuSeconds, handleCount, threadCount] = stdout
    .trim()
    .split(',')
    .map(Number);
  return { workingSetBytes, cpuSeconds, handleCount, threadCount };
}

async function acceptanceProcesses(parentIds) {
  const ids = parentIds.map(Number).join(',');
  const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `$parents=@(${ids});$exe=${psQuote(executable)};$helper=${psQuote(helperExecutable)};$profile=${psQuote(profileRoot)};@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($parents -contains $_.ParentProcessId) -or $_.ExecutablePath -eq $exe -or $_.ExecutablePath -eq $helper -or ($_.CommandLine -and $_.CommandLine.Contains($profile))) } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

function createHelperClient(path) {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  const lines = createInterface({ input: child.stdout });
  const pending = [];
  const queued = [];
  lines.on('line', (line) => {
    const response = JSON.parse(line);
    const waiter = pending.shift();
    if (waiter) waiter.resolve(response);
    else queued.push(response);
  });
  const next = () =>
    new Promise((resolveResponse, rejectResponse) => {
      if (queued.length > 0) return resolveResponse(queued.shift());
      pending.push({ resolve: resolveResponse, reject: rejectResponse });
    });
  return {
    child,
    async ready() {
      const response = await next();
      if (!response.ok) throw new Error(response.error);
      return response.value;
    },
    async command(command) {
      child.stdin.write(`${JSON.stringify(command)}\n`);
      const response = await next();
      if (!response.ok) throw new Error(response.error);
      return response.value;
    },
    close() {
      lines.close();
      child.stdin.end();
    },
    waitForExit() {
      return exited;
    },
  };
}

async function startClipboardHold(path, milliseconds) {
  const child = spawn(path, [`--hold-clipboard=${milliseconds}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((resolveReady, rejectReady) => {
    child.once('error', rejectReady);
    child.once('exit', (code) => rejectReady(new Error(`Clipboard holder exited early: ${code}`)));
    lines.once('line', (line) => {
      const response = JSON.parse(line);
      if (!response.ok) rejectReady(new Error(response.error));
      else resolveReady(response.value);
    });
  });
  expect(ready.holding === true, 'Clipboard contention helper did not acquire the clipboard.');
  return {
    released: new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (code) => {
        lines.close();
        if (code === 0) resolveExit();
        else rejectExit(new Error(`Clipboard contention helper exited with code ${code}.`));
      });
    }),
  };
}

async function createFixtures() {
  const sourceA = join(fixtureRoot, 'Source A');
  const sourceB = join(fixtureRoot, 'Source B');
  const destinations = join(fixtureRoot, 'Destinations');
  await Promise.all([
    mkdir(sourceA, { recursive: true }),
    mkdir(sourceB, { recursive: true }),
    mkdir(destinations, { recursive: true }),
  ]);
  const single = join(sourceA, 'single file.txt');
  const unicode = join(sourceA, 'नमस्ते 東京 😀.txt');
  const folder = join(sourceA, 'Folder with spaces');
  const otherParent = join(sourceB, 'other source.txt');
  const archive = join(sourceB, 'whole archive.zip');
  await mkdir(folder);
  await Promise.all([
    writeFile(single, 'single fixture'),
    writeFile(unicode, 'unicode fixture'),
    writeFile(join(folder, 'nested.txt'), 'folder fixture'),
    writeFile(otherParent, 'other parent fixture'),
    writeFile(archive, 'whole archive clipboard fixture'),
  ]);
  let longDirectory = join(sourceB, 'Long path');
  for (let index = 0; index < 7; index += 1) {
    longDirectory = join(longDirectory, `segment-${index}-clipboard-long-path-validation`);
    await mkdir(longDirectory, { recursive: true });
  }
  const longFile = join(longDirectory, 'long clipboard file.txt');
  await writeFile(longFile, 'long fixture');
  expect(longFile.length > 260, 'Long-path clipboard fixture did not exceed 260 characters.');
  const thousandRoot = join(fixtureRoot, 'Thousand');
  await mkdir(thousandRoot);
  const thousand = Array.from({ length: 1_000 }, (_, index) =>
    join(thousandRoot, `item-${String(index).padStart(4, '0')}.txt`),
  );
  for (let offset = 0; offset < thousand.length; offset += 100) {
    await Promise.all(thousand.slice(offset, offset + 100).map((path) => writeFile(path, 'x')));
  }
  return {
    sourceA,
    sourceB,
    destinations,
    single,
    unicode,
    folder,
    otherParent,
    archive,
    longFile,
    thousand,
  };
}

await mkdir(fixtureRoot, { recursive: true });
await mkdir(profileRoot, { recursive: true });
const fixture = await createFixtures();
const helper = createHelperClient(helperExecutable);
let clipboardRestored = false;
let client;
let child;
let report;
const launchedProcessIds = [];
let lingeringProcesses = [];
try {
  const preservation = await helper.ready();
  expect(preservation.ready === true, 'Clipboard preservation helper was not ready.');

  const debugPort = await allocateDebugPort();
  child = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profileRoot,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  launchedProcessIds.push(child.pid);
  const target = await waitForPackagedTarget(debugPort, child);
  client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  await waitForValue(client, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  const baseline = await processSample(child.pid);

  const oneWriteStarted = performance.now();
  const oneWritten = value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: [fixture.single],
    }),
    'write one path',
  );
  const oneWriteMs = performance.now() - oneWriteStarted;
  const oneNativeReadStarted = performance.now();
  const oneNativeRead = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read one path in Nammu',
  );
  const oneNativeReadMs = performance.now() - oneNativeReadStarted;
  expect(
    oneNativeRead.paths.length === 1 && oneNativeRead.paths[0] === fixture.single,
    'Nammu did not read its one-path clipboard payload.',
  );
  const oneReadStarted = performance.now();
  const oneRead = await helper.command({ command: 'read' });
  const oneReadMs = performance.now() - oneReadStarted;
  expect(oneRead.operation === 'copy', 'Nammu did not publish COPY intent.');
  expect(
    oneRead.paths.length === 1 && oneRead.paths[0] === fixture.single,
    'CF_HDROP file mismatch.',
  );
  expect(
    oneWritten.sequence === oneRead.sequence,
    'Clipboard sequence mismatch after Nammu write.',
  );

  const folderWritten = value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: [fixture.folder, fixture.unicode, fixture.longFile, fixture.archive],
    }),
    'write mixed native paths',
  );
  const folderRead = await helper.command({ command: 'read' });
  expect(folderRead.sequence === folderWritten.sequence, 'Mixed clipboard sequence mismatch.');
  expect(
    JSON.stringify(folderRead.paths) ===
      JSON.stringify([fixture.folder, fixture.unicode, fixture.longFile, fixture.archive]),
    'Unicode, long, archive-file, or folder CF_HDROP round trip failed.',
  );

  const cutWritten = value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'move',
      paths: [fixture.single],
    }),
    'write move intent',
  );
  const cutRead = await helper.command({ command: 'read' });
  expect(cutRead.operation === 'move', 'Nammu did not publish MOVE intent.');
  expect((await stat(fixture.single)).isFile(), 'Publishing Cut moved the source prematurely.');
  expect(cutRead.sequence === cutWritten.sequence, 'Move-intent sequence mismatch.');
  await delay(150);
  expect((await stat(fixture.single)).isFile(), 'Waiting after Cut moved the source.');
  await helper.command({ command: 'replace-text', text: 'replace non-destructive Cut' });
  expect((await stat(fixture.single)).isFile(), 'Replacing the Cut clipboard moved the source.');

  const thousandWriteStarted = performance.now();
  value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: fixture.thousand,
    }),
    'write 1000 paths',
  );
  const thousandWriteMs = performance.now() - thousandWriteStarted;
  const thousandNativeReadStarted = performance.now();
  const thousandNativeRead = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read 1000 paths in Nammu',
  );
  const thousandNativeReadMs = performance.now() - thousandNativeReadStarted;
  expect(
    thousandNativeRead.paths.length === 1_000,
    'Nammu truncated its 1,000-path clipboard read.',
  );
  const thousandReadStarted = performance.now();
  const thousandRead = await helper.command({ command: 'read' });
  const thousandReadMs = performance.now() - thousandReadStarted;
  expect(thousandRead.paths.length === 1_000, '1,000-path clipboard payload was truncated.');

  const inboundCopyDestination = join(fixture.destinations, 'Inbound Copy');
  await mkdir(inboundCopyDestination);
  await helper.command({
    command: 'publish',
    operation: 'copy',
    paths: [fixture.unicode, fixture.folder, fixture.otherParent, fixture.longFile],
  });
  const dispatchStarted = performance.now();
  const inboundCopy = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read inbound copy',
  );
  const dispatchLatencyMs = performance.now() - dispatchStarted;
  expect(inboundCopy.operation === 'copy', 'Inbound Explorer-compatible COPY was not recognized.');
  const copied = await runTransfer(
    client,
    inboundCopy.operation,
    inboundCopy.paths,
    inboundCopyDestination,
  );
  expect(copied.state === 'completed' && copied.failures.length === 0, 'Inbound F2A copy failed.');
  expect(
    (await readFile(join(inboundCopyDestination, basename(fixture.unicode)), 'utf8')) ===
      'unicode fixture',
    'Inbound Unicode copy contents mismatch.',
  );
  expect(
    (await readFile(
      join(inboundCopyDestination, basename(fixture.folder), 'nested.txt'),
      'utf8',
    )) === 'folder fixture',
    'Inbound folder copy contents mismatch.',
  );

  const replacementDestination = join(fixture.destinations, 'Clipboard Replacement');
  await mkdir(replacementDestination);
  const staleA = value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: [fixture.single],
    }),
    'write clipboard A',
  );
  const replacementB = await helper.command({
    command: 'publish',
    operation: 'copy',
    paths: [fixture.otherParent],
  });
  expect(
    replacementB.sequence !== staleA.sequence,
    'Independent clipboard replacement was not detected.',
  );
  const authoritativeB = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read authoritative clipboard B',
  );
  expect(
    authoritativeB.paths.length === 1 && authoritativeB.paths[0] === fixture.otherParent,
    'Nammu returned stale clipboard A instead of independent clipboard B.',
  );
  const replacementCopy = await runTransfer(
    client,
    authoritativeB.operation,
    authoritativeB.paths,
    replacementDestination,
  );
  expect(replacementCopy.failures.length === 0, 'Authoritative clipboard B did not paste.');
  expect(
    await access(join(replacementDestination, basename(fixture.single))).then(
      () => false,
      () => true,
    ),
    'Stale clipboard A was pasted after replacement.',
  );

  const moveSource = join(fixture.sourceB, 'Explorer cut source.txt');
  await writeFile(moveSource, 'move fixture');
  const inboundMoveDestination = join(fixture.destinations, 'Inbound Move');
  await mkdir(inboundMoveDestination);
  await helper.command({ command: 'publish', operation: 'move', paths: [moveSource] });
  const inboundMove = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read inbound move',
  );
  const moved = await runTransfer(
    client,
    inboundMove.operation,
    inboundMove.paths,
    inboundMoveDestination,
  );
  expect(moved.state === 'completed' && moved.failures.length === 0, 'Inbound F2A move failed.');
  const completion = value(
    await invoke(client, 'complete_native_file_clipboard', {
      sequence: inboundMove.sequence,
      operation: 'move',
    }),
    'report performed move',
  );
  expect(
    completion.reported === false,
    'The raw protocol helper unexpectedly claimed IDataObject performed-effect support.',
  );
  const completedRead = await helper.command({ command: 'read' });
  expect(
    completedRead.performedOperation === null,
    'Nammu modified raw clipboard memory after its owner rejected IDataObject feedback.',
  );
  expect(
    (await readFile(join(inboundMoveDestination, basename(moveSource)), 'utf8')) === 'move fixture',
    'Inbound moved file contents mismatch.',
  );
  await expect(
    access(moveSource).then(
      () => false,
      () => true,
    ),
    'Move source still exists.',
  );

  const partialSourceA = join(fixture.sourceA, 'partial-good.txt');
  const partialSourceB = join(fixture.sourceB, 'partial-conflict.txt');
  const partialDestination = join(fixture.destinations, 'Partial Move');
  await mkdir(partialDestination);
  await Promise.all([
    writeFile(partialSourceA, 'moves'),
    writeFile(partialSourceB, 'must remain'),
    writeFile(join(partialDestination, basename(partialSourceB)), 'existing'),
  ]);
  await helper.command({
    command: 'publish',
    operation: 'move',
    paths: [partialSourceA, partialSourceB],
  });
  const partialClipboard = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read partial-move clipboard',
  );
  const partial = await runTransfer(client, 'move', partialClipboard.paths, partialDestination);
  expect(
    partial.successes.length === 1 && partial.failures.length === 1,
    'Partial move fixture did not produce one success and one failure.',
  );
  expect(
    partial.failures[0]?.error?.code === 'ALREADY_EXISTS',
    'Partial move did not preserve the structured conflict.',
  );
  const partialShellState = await helper.command({ command: 'read' });
  expect(
    partialShellState.performedOperation === null,
    'A partial move was incorrectly reported as wholly performed.',
  );
  expect(
    await access(partialSourceA).then(
      () => false,
      () => true,
    ),
    'Successful partial-move source still exists.',
  );
  expect((await stat(partialSourceB)).isFile(), 'Failed partial-move source was removed.');

  const conflictSource = join(fixture.sourceB, 'collision.txt');
  const conflictDestination = join(fixture.destinations, 'Conflicts');
  await mkdir(conflictDestination);
  await writeFile(conflictSource, 'incoming');
  await writeFile(join(conflictDestination, 'collision.txt'), 'existing');
  await helper.command({ command: 'publish', operation: 'copy', paths: [conflictSource] });
  const conflictClipboard = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read conflict clipboard',
  );
  const conflict = await runTransfer(client, 'copy', conflictClipboard.paths, conflictDestination);
  expect(
    conflict.failures[0]?.error?.code === 'ALREADY_EXISTS',
    'Clipboard conflict did not use F2A structured conflict handling.',
  );
  expect(
    (await readFile(join(conflictDestination, 'collision.txt'), 'utf8')) === 'existing',
    'Clipboard conflict overwrote existing data.',
  );
  const keptBoth = await runTransfer(
    client,
    'copy',
    conflictClipboard.paths,
    conflictDestination,
    'keep-both',
  );
  expect(keptBoth.failures.length === 0, 'Keep Both failed for clipboard input.');

  const missing = join(fixture.sourceB, 'missing.txt');
  await helper.command({ command: 'publish', operation: 'copy', paths: [missing] });
  const missingClipboard = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read missing-source clipboard',
  );
  const missingResult = await runTransfer(
    client,
    'copy',
    missingClipboard.paths,
    inboundCopyDestination,
  );
  expect(
    missingResult.failures[0]?.error?.code === 'NOT_FOUND',
    'Stale clipboard source did not return NOT_FOUND through F2A.',
  );

  const owned = value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: [fixture.single],
    }),
    'write stale-state fixture',
  );
  const replaced = await helper.command({ command: 'replace-text', text: 'F5C text clipboard' });
  const afterReplacement = value(
    await invoke(client, 'read_native_file_clipboard'),
    'read replaced clipboard',
  );
  expect(replaced.sequence !== owned.sequence, 'Clipboard replacement did not change sequence.');
  expect(
    afterReplacement.available === false,
    'Text replacement left stale file clipboard available.',
  );
  expect(
    afterReplacement.sequence === replaced.sequence,
    'Clipboard replacement sequence was stale.',
  );

  const malformedExpectations = new Map([
    ['invalid-offset', 'INVALID_CLIPBOARD_DATA'],
    ['ansi', 'CLIPBOARD_FORMAT_UNSUPPORTED'],
    ['missing-terminator', 'INVALID_CLIPBOARD_DATA'],
    ['empty', 'INVALID_CLIPBOARD_DATA'],
    ['control', 'INVALID_CLIPBOARD_DATA'],
    ['oversized', 'CLIPBOARD_TOO_LARGE'],
    ['too-many', 'CLIPBOARD_TOO_LARGE'],
  ]);
  for (const [kind, expectedCode] of malformedExpectations) {
    await helper.command({ command: 'publish-malformed', kind });
    const malformed = await invoke(client, 'read_native_file_clipboard');
    expect(
      malformed?.status === 'error' && malformed.error?.code === expectedCode,
      `Malformed ${kind} payload was not rejected as ${expectedCode}: ${JSON.stringify(malformed)}`,
    );
  }
  const clipboardHolder = await startClipboardHold(helperExecutable, 2_000);
  const busy = await invoke(client, 'read_native_file_clipboard');
  expect(
    busy?.status === 'error' && busy.error?.code === 'CLIPBOARD_BUSY',
    `Clipboard contention did not return CLIPBOARD_BUSY: ${JSON.stringify(busy)}`,
  );
  await clipboardHolder.released;

  for (let cycle = 0; cycle < 30; cycle += 1) {
    value(
      await invoke(client, 'write_native_file_clipboard', {
        operation: cycle % 2 === 0 ? 'copy' : 'move',
        paths: [fixture.single],
      }),
      `cycle ${cycle} Nammu write`,
    );
    await helper.command({ command: 'replace-text', text: `cycle-${cycle}` });
    await helper.command({
      command: 'publish',
      operation: cycle % 2 === 0 ? 'move' : 'copy',
      paths: [fixture.single],
    });
    value(await invoke(client, 'read_native_file_clipboard'), `cycle ${cycle} read`);
  }
  const diagnostics = value(
    await invoke(client, 'get_native_file_clipboard_diagnostics'),
    'clipboard diagnostics',
  );
  expect(diagnostics.openClipboardGuards === 0, 'A Windows clipboard handle remained open.');
  expect(diagnostics.maxPaths === 10_000, 'Packaged path-count bound changed unexpectedly.');
  expect(diagnostics.maxUtf16Bytes === 4 * 1024 * 1024, 'Packaged payload bound changed.');

  const afterWork = await processSample(child.pid);
  await delay(2_000);
  const afterIdle = await processSample(child.pid);

  value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'copy',
      paths: [fixture.archive],
    }),
    'write persistence fixture',
  );
  await client.send('Runtime.evaluate', {
    expression: `void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`,
    awaitPromise: false,
  });
  client.close();
  client = null;
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(10_000).then(() => false),
  ]);
  expect(exited, 'Packaged Nammu did not shut down for clipboard persistence acceptance.');
  const persisted = await helper.command({ command: 'read' });
  expect(
    persisted.operation === 'copy' && persisted.paths[0] === fixture.archive,
    'Nammu-published static file clipboard did not survive application exit.',
  );

  const cutSurvivor = join(fixture.sourceA, 'cut survives Nammu exit.txt');
  await writeFile(cutSurvivor, 'non-destructive cut fixture');
  const secondDebugPort = await allocateDebugPort();
  child = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profileRoot,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${secondDebugPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  launchedProcessIds.push(child.pid);
  const secondTarget = await waitForPackagedTarget(secondDebugPort, child);
  client = createCdpClient(secondTarget.webSocketDebuggerUrl);
  await client.ready;
  await waitForValue(client, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  value(
    await invoke(client, 'write_native_file_clipboard', {
      operation: 'move',
      paths: [cutSurvivor],
    }),
    'write shutdown cut fixture',
  );
  await client.send('Runtime.evaluate', {
    expression: `void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`,
    awaitPromise: false,
  });
  client.close();
  client = null;
  const secondExited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(10_000).then(() => false),
  ]);
  expect(secondExited, 'Second packaged Nammu process did not shut down.');
  const persistedCut = await helper.command({ command: 'read' });
  expect(
    persistedCut.operation === 'move' && persistedCut.paths[0] === cutSurvivor,
    'Nammu Cut intent did not remain readable after application exit.',
  );
  expect((await stat(cutSurvivor)).isFile(), 'Closing Nammu after Cut mutated the source.');

  report = {
    fixtureRoot,
    clipboardPreservation: preservation,
    protocol: {
      cfHdrop: true,
      unicodeWidePaths: true,
      preferredCopy: true,
      preferredMove: true,
      performedMoveForRawHelper: completion.reported,
      conservativeWhenSourceRejectsPerformedEffect: true,
      staticCopyPersistenceAfterExit: true,
      cutNonDestructiveAfterExit: true,
    },
    inboundF2A: {
      copy: true,
      move: true,
      mixedBatch: true,
      differentSourceDirectories: true,
      folder: true,
      unicode: true,
      longPath: true,
      missingSource: true,
      conflictNoOverwrite: true,
      keepBoth: true,
      partialMoveReportedComplete: false,
    },
    timingMs: {
      writeOne: Number(oneWriteMs.toFixed(3)),
      readOneNative: Number(oneNativeReadMs.toFixed(3)),
      readOneHelper: Number(oneReadMs.toFixed(3)),
      writeThousand: Number(thousandWriteMs.toFixed(3)),
      readThousandNative: Number(thousandNativeReadMs.toFixed(3)),
      readThousandHelper: Number(thousandReadMs.toFixed(3)),
      pasteDispatchBeforeF2A: Number(dispatchLatencyMs.toFixed(3)),
    },
    process: {
      baseline,
      afterWork,
      afterIdle,
      idleCpuSeconds: Number((afterIdle.cpuSeconds - afterWork.cpuSeconds).toFixed(4)),
      workingSetGrowthBytes: afterWork.workingSetBytes - baseline.workingSetBytes,
      handleGrowth: afterIdle.handleCount - baseline.handleCount,
      threadGrowth: afterIdle.threadCount - baseline.threadCount,
    },
    diagnostics,
    cycles: 30,
    clipboardReplacementInvalidatedFiles: true,
    malformedPayloadsRejected: malformedExpectations.size,
    userFilesRead: false,
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
  if (child?.exitCode === null) {
    const exited = await Promise.race([
      new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
      delay(10_000).then(() => false),
    ]);
    if (!exited && child.exitCode === null) child.kill('SIGTERM');
  }
  try {
    const restoration = await helper.command({ command: 'restore' });
    expect(restoration.restored === true, 'The original clipboard was not restored.');
    clipboardRestored = true;
    await helper.command({ command: 'exit' });
  } finally {
    helper.close();
    const helperExit = await Promise.race([
      helper.waitForExit(),
      delay(5_000).then(() => null),
    ]);
    expect(helperExit !== null, 'Clipboard helper did not terminate after acceptance.');
  }
  const root = normalize(resolve(fixtureRoot));
  const profile = normalize(resolve(profileRoot));
  const approvedBase = `${normalize(resolve(tmpdir()))}\\`;
  expect(
    root.startsWith(approvedBase) &&
      profile.startsWith(approvedBase) &&
      basename(root).startsWith('NammuFilesF5CTest-'),
    'Refusing cleanup outside the F5C temporary directory.',
  );
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  await rm(profile, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  await delay(250);
  lingeringProcesses = await acceptanceProcesses(launchedProcessIds);
  expect(
    lingeringProcesses.length === 0,
    `F5C left packaged/helper descendant processes: ${JSON.stringify(lingeringProcesses)}`,
  );
}

expect(clipboardRestored, 'Original clipboard restoration was not verified.');
console.info(
  JSON.stringify(
    {
      ...report,
      clipboardRestored,
      remainingFixtures: 0,
      remainingProcesses: lingeringProcesses.length,
      explorerUiAutomation: 'manual-smoke-required',
    },
    null,
    2,
  ),
);
