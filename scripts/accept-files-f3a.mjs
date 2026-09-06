import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F3A_EXECUTABLE;
if (!executableInput) {
  throw new Error('Set NAMMU_F3A_EXECUTABLE to the packaged Nammu OS executable.');
}

const executable = resolve(executableInput);
await access(executable);
const isolatedRoot = join(tmpdir(), `NammuFilesF3ATest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
const fixtureRoot = join(isolatedRoot, 'Search fixture');
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const execFile = promisify(execFileCallback);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function allocateDebugPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not allocate an isolated WebView2 debugging port.'));
        return;
      }
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
}

async function createNumberedFiles(root, count, prefix) {
  await mkdir(root, { recursive: true });
  const batchSize = 250;
  for (let offset = 0; offset < count; offset += batchSize) {
    await Promise.all(
      Array.from({ length: Math.min(batchSize, count - offset) }, (_, index) => {
        const number = String(offset + index).padStart(5, '0');
        return writeFile(join(root, `${prefix}-${number}.txt`), '');
      }),
    );
  }
}

async function createFixtures() {
  await mkdir(join(fixtureRoot, 'Reports'), { recursive: true });
  await mkdir(join(fixtureRoot, 'Source', 'nested'), { recursive: true });
  await mkdir(join(fixtureRoot, 'Media'), { recursive: true });
  await mkdir(join(fixtureRoot, 'Empty directory'), { recursive: true });
  await writeFile(join(fixtureRoot, 'Reports', 'invoice-2025.pdf'), 'invoice');
  await writeFile(join(fixtureRoot, 'Reports', 'invoice-2026.pdf'), 'invoice');
  await writeFile(join(fixtureRoot, 'Source', 'report.ts'), 'export {};');
  await writeFile(join(fixtureRoot, 'Source', 'nested', 'invoice.json'), '{}');
  await writeFile(join(fixtureRoot, 'Media', 'holiday.mp4'), 'video');
  await writeFile(join(fixtureRoot, 'Résumé 東京 report.txt'), 'unicode');
  await mkdir(join(fixtureRoot, 'Projects archive'), { recursive: true });

  let deepRoot = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 11; index += 1) {
    deepRoot = join(deepRoot, `segment-${String(index).padStart(2, '0')}-nammu-search-fixture`);
    await mkdir(deepRoot, { recursive: true });
  }
  const longFile = join(deepRoot, 'long-path-needle.txt');
  await writeFile(longFile, 'long path');
  expect(longFile.length > 260, 'The long-path fixture did not exceed 260 characters.');

  await createNumberedFiles(join(fixtureRoot, 'Bench 1000'), 1_000, 'bench-one');
  await createNumberedFiles(join(fixtureRoot, 'Bench 10000'), 10_000, 'bench-ten');
  await createNumberedFiles(join(fixtureRoot, 'Cap 5200'), 5_200, 'cap-result');
  return { longFile };
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

async function waitForTarget(debugPort, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (candidate) =>
            candidate.type === 'page' && /tauri\.localhost|tauri:\/\//.test(candidate.url),
        );
        if (target) return target;
      }
    } catch {}
    await delay(200);
  }
  throw new Error('Timed out waiting for the packaged Nammu OS WebView2 target.');
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'WebView evaluation failed.');
  }
  return result.result?.value;
}

async function waitForValue(client, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(client, expression).catch(() => null);
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out waiting for packaged F3A state.');
}

async function invoke(client, command, args = {}) {
  return evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`,
  );
}

function value(response, operation) {
  if (response?.status !== 'success') {
    throw new Error(`${operation} failed: ${response?.error?.code || 'INVALID_RESPONSE'}`);
  }
  return response.value;
}

function query(rootPath, text, extensions = [], kind = 'files', scope = 'current-tree') {
  return { rootPath, text, scope, kind, extensions };
}

async function startSearch(client, searchQuery) {
  return value(
    await invoke(client, 'start_native_file_search', { query: searchQuery }),
    'start native file search',
  );
}

async function getSearch(client, id, resultOffset) {
  return value(
    await invoke(client, 'get_native_file_search', { id, resultOffset }),
    'get native file search',
  );
}

async function cancelSearch(client, id) {
  return value(
    await invoke(client, 'cancel_native_file_search', { id }),
    'cancel native file search',
  );
}

async function releaseSearch(client, id) {
  return value(
    await invoke(client, 'release_native_file_search', { id }),
    'release native file search',
  );
}

async function diagnostics(client) {
  return value(
    await invoke(client, 'get_native_file_search_diagnostics'),
    'native file search diagnostics',
  );
}

async function runSearch(client, searchQuery, { release = true } = {}) {
  const startedAt = performance.now();
  const initial = await startSearch(client, searchQuery);
  let snapshot = initial;
  let offset = 0;
  let firstResultMs = null;
  let hundredResultsMs = null;
  const results = [];
  while (true) {
    snapshot = await getSearch(client, initial.id, offset);
    expect(snapshot.id === initial.id, 'A search response carried the wrong job identity.');
    expect(snapshot.resultOffset === offset, 'A search response carried the wrong result offset.');
    if (snapshot.results.length > 0) {
      results.push(...snapshot.results);
      offset += snapshot.results.length;
      if (firstResultMs === null) firstResultMs = performance.now() - startedAt;
      if (hundredResultsMs === null && results.length >= 100) {
        hundredResultsMs = performance.now() - startedAt;
      }
    }
    if (
      ['completed', 'cancelled', 'failed'].includes(snapshot.state) &&
      offset >= snapshot.retainedResults
    ) {
      break;
    }
    await delay(5);
  }
  if (release) await releaseSearch(client, initial.id);
  return {
    id: initial.id,
    snapshot,
    results,
    firstResultMs,
    hundredResultsMs,
    completeMs: performance.now() - startedAt,
  };
}

async function waitForNoSearches(client, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await diagnostics(client);
    if (state.activeSearches === 0 && state.retainedSearches === 0 && state.retainedResults === 0) {
      return state;
    }
    await delay(10);
  }
  throw new Error('Native search jobs or result buffers remained retained.');
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
  expect(Number.isFinite(workingSetBytes), 'Could not measure the packaged process working set.');
  expect(Number.isFinite(cpuSeconds), 'Could not measure the packaged process CPU time.');
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
let mainClient;
const unreleased = new Set();

try {
  const target = await waitForTarget(debugPort);
  mainClient = createCdpClient(target.webSocketDebuggerUrl);
  await mainClient.ready;
  await waitForValue(mainClient, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  await waitForValue(
    mainClient,
    `(() => { const button = document.querySelector('button[title^="Files"]'); button?.click(); return Boolean(button); })()`,
  );
  expect((await diagnostics(mainClient)).activeSearches === 0, 'Search started before a query.');
  const resourceBaseline = await processSample(child.pid);

  const exact = await runSearch(mainClient, query(fixtureRoot, 'invoice-2025.pdf'));
  expect(exact.results.length === 1, 'Exact filename search did not return one result.');
  const partial = await runSearch(mainClient, query(fixtureRoot, 'INVOICE'));
  expect(
    partial.results.length === 3,
    'Case-insensitive partial search did not find nested matches.',
  );
  const currentFolder = await runSearch(
    mainClient,
    query(fixtureRoot, 'invoice', [], 'files', 'current-folder'),
  );
  expect(currentFolder.results.length === 0, 'Current Folder search incorrectly recursed.');
  const pdf = await runSearch(mainClient, query(fixtureRoot, '', ['pdf']));
  expect(pdf.results.length === 2, 'PDF extension filtering returned incorrect results.');
  const folders = await runSearch(mainClient, query(fixtureRoot, 'PROJECTS', [], 'folders'));
  expect(folders.results.length === 1, 'Folder-only matching failed.');
  const unicode = await runSearch(mainClient, query(fixtureRoot, '東京'));
  expect(unicode.results.length === 1, 'Unicode matching failed.');
  const spaces = await runSearch(mainClient, query(fixtureRoot, 'Résumé 東京'));
  expect(spaces.results.length === 1, 'Filename matching with spaces failed.');
  const longPath = await runSearch(mainClient, query(fixtureRoot, 'long-path-needle'));
  expect(
    longPath.results[0]?.path === fixture.longFile,
    'Long-path search did not preserve its path.',
  );
  const zero = await runSearch(mainClient, query(fixtureRoot, 'definitely-no-result'));
  expect(zero.results.length === 0, 'Zero-result search returned an entry.');

  const thousand = await runSearch(mainClient, query(join(fixtureRoot, 'Bench 1000'), 'bench-one'));
  expect(thousand.results.length === 1_000, 'The 1,000-file fixture was incomplete.');
  const tenThousand = await runSearch(
    mainClient,
    query(join(fixtureRoot, 'Bench 10000'), 'bench-ten'),
  );
  expect(tenThousand.snapshot.matchedEntries === 10_000, 'The 10,000-file scan was incomplete.');
  expect(tenThousand.results.length === 5_000, 'The retained result cap was not enforced.');
  expect(tenThousand.snapshot.truncated, 'A capped result set was not marked truncated.');
  const cap = await runSearch(mainClient, query(join(fixtureRoot, 'Cap 5200'), 'cap-result'));
  expect(cap.snapshot.matchedEntries === 5_200, 'Matched count stopped at the result cap.');
  expect(cap.results.length === 5_000 && cap.snapshot.truncated, 'Result cap reporting failed.');

  const cancelled = await startSearch(
    mainClient,
    query(join(fixtureRoot, 'Bench 10000'), 'bench-ten'),
  );
  unreleased.add(cancelled.id);
  const cancelStarted = performance.now();
  await cancelSearch(mainClient, cancelled.id);
  let cancelledSnapshot;
  do {
    cancelledSnapshot = await getSearch(mainClient, cancelled.id, 0);
    if (!['cancelled', 'completed', 'failed'].includes(cancelledSnapshot.state)) await delay(2);
  } while (!['cancelled', 'completed', 'failed'].includes(cancelledSnapshot.state));
  const cancelLatencyMs = performance.now() - cancelStarted;
  expect(cancelledSnapshot.state === 'cancelled', 'The large packaged search did not cancel.');
  await releaseSearch(mainClient, cancelled.id);
  unreleased.delete(cancelled.id);

  const replaced = await startSearch(
    mainClient,
    query(join(fixtureRoot, 'Bench 10000'), 'bench-ten'),
  );
  unreleased.add(replaced.id);
  await releaseSearch(mainClient, replaced.id);
  unreleased.delete(replaced.id);
  const replacement = await runSearch(mainClient, query(fixtureRoot, 'holiday.mp4'));
  expect(replacement.id !== replaced.id, 'Replacement search reused a stale identity.');
  expect(
    replacement.results.length === 1 && replacement.results[0].name === 'holiday.mp4',
    'Replacement results were contaminated by the prior query.',
  );

  const location = value(
    await invoke(mainClient, 'list_native_directory', {
      path: join(fixtureRoot, 'Reports'),
    }),
    'open file location path resolution',
  );
  expect(
    location.entries.some((entry) => entry.name === 'invoice-2025.pdf'),
    'The result parent could not be opened and reselected.',
  );

  for (let index = 0; index < 30; index += 1) {
    const repeated = await runSearch(mainClient, query(fixtureRoot, `repeat-${index}-missing`));
    expect(repeated.results.length === 0, 'A repeated zero-result search returned an entry.');
  }
  const stopped = await waitForNoSearches(mainClient);
  const resourceAfterSearches = await processSample(child.pid);
  await delay(2_000);
  const resourceAfterIdle = await processSample(child.pid);

  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(isolatedRoot),
      fixtureEntries: 16_200,
      timingsMs: {
        firstResult1000: Number(thousand.firstResultMs?.toFixed(2)),
        hundredResults1000: Number(thousand.hundredResultsMs?.toFixed(2)),
        complete1000: Number(thousand.completeMs.toFixed(2)),
        firstResult10000: Number(tenThousand.firstResultMs?.toFixed(2)),
        hundredResults10000: Number(tenThousand.hundredResultsMs?.toFixed(2)),
        complete10000: Number(tenThousand.completeMs.toFixed(2)),
        cancelLatency: Number(cancelLatencyMs.toFixed(2)),
      },
      progressive: {
        batchLimit: 200,
        resultLimit: tenThousand.snapshot.resultLimit,
        matched: tenThousand.snapshot.matchedEntries,
        retained: tenThousand.snapshot.retainedResults,
        truncated: tenThousand.snapshot.truncated,
      },
      longPathCharacters: fixture.longFile.length,
      lifecycle: stopped,
      resources: {
        workingSetBeforeBytes: resourceBaseline.workingSetBytes,
        workingSetAfterBytes: resourceAfterSearches.workingSetBytes,
        workingSetDeltaBytes:
          resourceAfterSearches.workingSetBytes - resourceBaseline.workingSetBytes,
        idleCpuSecondsOverTwoSeconds: Number(
          (resourceAfterIdle.cpuSeconds - resourceAfterSearches.cpuSeconds).toFixed(4),
        ),
      },
      openFileLocationResolved: true,
      clipboardTouched: false,
      personalFilesSearched: false,
    }),
  );
} finally {
  try {
    if (mainClient) {
      for (const id of unreleased) await releaseSearch(mainClient, id).catch(() => {});
      await evaluate(mainClient, 'window.close()').catch(() => {});
      mainClient.close();
    }
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(10_000),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  } finally {
    const resolvedRoot = normalize(resolve(isolatedRoot));
    const resolvedProfile = normalize(resolve(isolatedProfile));
    const resolvedTemp = normalize(resolve(tmpdir()));
    if (
      resolvedRoot.startsWith(`${resolvedTemp}\\`) &&
      basename(resolvedRoot).startsWith('NammuFilesF3ATest-')
    ) {
      await rm(resolvedRoot, { recursive: true, force: true });
      if (
        resolvedProfile.startsWith(`${resolvedTemp}\\`) &&
        basename(resolvedProfile).startsWith('NammuFilesF3ATest-')
      ) {
        await rm(resolvedProfile, { recursive: true, force: true });
      } else {
        console.error('Refusing to clean an unexpected F3A WebView2 profile directory.');
        process.exitCode = 1;
      }
    } else {
      console.error('Refusing to clean an unexpected F3A acceptance directory.');
      process.exitCode = 1;
    }
  }
}
