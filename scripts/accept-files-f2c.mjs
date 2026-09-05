import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F2C_EXECUTABLE;
if (!executableInput) {
  throw new Error('Set NAMMU_F2C_EXECUTABLE to the packaged Nammu OS executable.');
}

const executable = resolve(executableInput);
await access(executable);
const debugPort = await new Promise((resolvePort, rejectPort) => {
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
const isolatedRoot = join(tmpdir(), `NammuFilesF2CTest-${randomUUID()}`);
const isolatedProfile = `${isolatedRoot}-WebView2`;
await mkdir(isolatedRoot);
await mkdir(isolatedProfile);
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function expect(condition, message) {
  if (!condition) throw new Error(message);
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

async function waitForTarget(timeoutMs = 90_000) {
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
  throw new Error('Timed out waiting for packaged F2C state.');
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

async function diagnostics(client) {
  return value(await invoke(client, 'get_native_directory_watch_diagnostics'), 'watch diagnostics');
}

async function startWatch(client, path) {
  return value(
    await invoke(client, 'start_native_directory_watch', { path }),
    'start native directory watch',
  );
}

async function stopWatch(client, id) {
  return value(
    await invoke(client, 'stop_native_directory_watch', { id }),
    'stop native directory watch',
  );
}

async function eventCount(client) {
  return evaluate(client, 'window.__nammuF2CEvents?.length || 0');
}

async function waitForWatchEvent(client, watchId, after, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(
      client,
      `(() => {
        const events = window.__nammuF2CEvents || [];
        const match = events.slice(${after}).find((event) => event?.watchId === ${JSON.stringify(watchId)});
        return match || null;
      })()`,
    );
    if (result) return result;
    await delay(25);
  }
  throw new Error('A native filesystem invalidation did not arrive in time.');
}

async function listDirectory(client, path) {
  return invoke(client, 'list_native_directory', { path });
}

async function pauseForResourceSample(stage, childPid, client) {
  if (process.env.NAMMU_F2C_RESOURCE_PAUSES !== '1') return;
  const pauseMs = Math.min(
    30_000,
    Math.max(1_000, Number(process.env.NAMMU_F2C_RESOURCE_PAUSE_MS) || 8_000),
  );
  console.info(
    JSON.stringify({
      resourceStage: stage,
      timestampMs: Date.now(),
      pid: childPid,
      diagnostics: await diagnostics(client),
    }),
  );
  await delay(pauseMs);
}

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
let eventId;
const activeWatches = new Set();

try {
  const mainTarget = await waitForTarget();
  mainClient = createCdpClient(mainTarget.webSocketDebuggerUrl);
  await mainClient.ready;
  await waitForValue(mainClient, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  await waitForValue(
    mainClient,
    `(() => { const button = document.querySelector('button[title^="Files"]'); button?.click(); return Boolean(button); })()`,
  );
  eventId = await evaluate(
    mainClient,
    `(async () => {
      window.__nammuF2CEvents = [];
      const handler = window.__TAURI_INTERNALS__.transformCallback((event) => {
        window.__nammuF2CEvents.push(event.payload);
      });
      return window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
        event: 'nammu://native-filesystem-change',
        target: { kind: 'Any' },
        handler,
      });
    })()`,
  );

  const baseline = await diagnostics(mainClient);
  expect(baseline.activeWatchers === 0, 'Files opened in virtual Home should not start a watcher.');
  await pauseForResourceSample('baseline', child.pid, mainClient);

  const watch = await startWatch(mainClient, isolatedRoot);
  activeWatches.add(watch.id);
  expect((await diagnostics(mainClient)).activeWatchers === 1, 'Expected exactly one watcher.');
  await pauseForResourceSample('watch-active', child.pid, mainClient);

  const timings = {};
  const unicodeFile = join(isolatedRoot, 'Unicode external file.txt');
  let marker = await eventCount(mainClient);
  let started = performance.now();
  await writeFile(unicodeFile, 'one');
  await waitForWatchEvent(mainClient, watch.id, marker);
  timings.createVisibleMs = Number((performance.now() - started).toFixed(2));
  let listing = value(await listDirectory(mainClient, isolatedRoot), 'list after create');
  expect(
    listing.entries.some((entry) => entry.path === unicodeFile),
    'External create was absent.',
  );

  marker = await eventCount(mainClient);
  started = performance.now();
  await writeFile(unicodeFile, 'externally modified content');
  await waitForWatchEvent(mainClient, watch.id, marker);
  timings.modifyVisibleMs = Number((performance.now() - started).toFixed(2));
  listing = value(await listDirectory(mainClient, isolatedRoot), 'list after modify');
  expect(
    listing.entries.find((entry) => entry.path === unicodeFile)?.sizeBytes === 27,
    'External metadata did not converge.',
  );

  const renamedFile = join(isolatedRoot, 'Renamed Unicode file.txt');
  marker = await eventCount(mainClient);
  started = performance.now();
  await rename(unicodeFile, renamedFile);
  await waitForWatchEvent(mainClient, watch.id, marker);
  timings.renameVisibleMs = Number((performance.now() - started).toFixed(2));
  listing = value(await listDirectory(mainClient, isolatedRoot), 'list after rename');
  expect(
    !listing.entries.some((entry) => entry.path === unicodeFile) &&
      listing.entries.some((entry) => entry.path === renamedFile),
    'External rename did not converge.',
  );

  marker = await eventCount(mainClient);
  started = performance.now();
  await rm(renamedFile);
  await waitForWatchEvent(mainClient, watch.id, marker);
  timings.deleteVisibleMs = Number((performance.now() - started).toFixed(2));
  listing = value(await listDirectory(mainClient, isolatedRoot), 'list after delete');
  expect(!listing.entries.some((entry) => entry.path === renamedFile), 'External delete remained.');

  const beforeBurst = await diagnostics(mainClient);
  marker = await eventCount(mainClient);
  const burstStarted = performance.now();
  await Promise.all(
    Array.from({ length: 1_000 }, (_, index) =>
      writeFile(join(isolatedRoot, `burst-${String(index).padStart(4, '0')}.txt`), `${index}`),
    ),
  );
  await waitForWatchEvent(mainClient, watch.id, marker, 20_000);
  await delay(350);
  listing = value(await listDirectory(mainClient, isolatedRoot), 'list after burst');
  timings.thousandEventConvergenceMs = Number((performance.now() - burstStarted).toFixed(2));
  expect(listing.entries.length === 1_000, '1,000-file burst did not converge to final state.');
  const afterBurst = await diagnostics(mainClient);

  const secondRoot = join(isolatedRoot, 'Second watched folder');
  await mkdir(secondRoot);
  const oldWatchId = watch.id;
  await stopWatch(mainClient, oldWatchId);
  activeWatches.delete(oldWatchId);
  const oldEventMarker = await eventCount(mainClient);
  const secondWatch = await startWatch(mainClient, secondRoot);
  activeWatches.add(secondWatch.id);
  expect((await diagnostics(mainClient)).activeWatchers === 1, 'Navigation leaked a watcher.');
  await writeFile(join(isolatedRoot, 'old-location-change.txt'), 'ignored');
  await delay(400);
  const oldEventsAfterStop = await evaluate(
    mainClient,
    `(window.__nammuF2CEvents || []).slice(${oldEventMarker}).filter((event) => event?.watchId === ${JSON.stringify(oldWatchId)}).length`,
  );
  expect(oldEventsAfterStop === 0, 'Disposed watcher delivered a stale event.');

  let deepest = secondRoot;
  for (let index = 0; index < 12; index += 1) {
    deepest = join(deepest, `segment-${String(index).padStart(2, '0')}-nammu-files`);
    await mkdir(deepest);
  }
  expect(deepest.length > 260, 'Long-path watch fixture did not exceed 260 characters.');
  await stopWatch(mainClient, secondWatch.id);
  activeWatches.delete(secondWatch.id);
  const deepWatch = await startWatch(mainClient, deepest);
  activeWatches.add(deepWatch.id);
  marker = await eventCount(mainClient);
  const deepFile = join(deepest, 'long watched file.txt');
  await writeFile(deepFile, 'long path');
  await waitForWatchEvent(mainClient, deepWatch.id, marker);
  expect((await stat(deepFile)).isFile(), 'Long-path watcher fixture was not created.');
  await stopWatch(mainClient, deepWatch.id);
  activeWatches.delete(deepWatch.id);

  const disappearing = join(isolatedRoot, 'Deleted while viewed');
  await mkdir(disappearing);
  const disappearingWatch = await startWatch(mainClient, disappearing);
  activeWatches.add(disappearingWatch.id);
  marker = await eventCount(mainClient);
  await rm(disappearing, { recursive: true });
  await waitForWatchEvent(mainClient, disappearingWatch.id, marker);
  const unavailable = await listDirectory(mainClient, disappearing);
  expect(
    unavailable?.error?.code === 'NOT_FOUND',
    'A deleted current directory did not become explicitly unavailable.',
  );
  await stopWatch(mainClient, disappearingWatch.id);
  activeWatches.delete(disappearingWatch.id);

  for (let index = 0; index < 30; index += 1) {
    const repeated = await startWatch(mainClient, isolatedRoot);
    activeWatches.add(repeated.id);
    await stopWatch(mainClient, repeated.id);
    activeWatches.delete(repeated.id);
  }
  const stopped = await diagnostics(mainClient);
  expect(stopped.activeWatchers === 0, 'Repeated navigation left native watchers active.');
  await pauseForResourceSample('watch-stopped', child.pid, mainClient);

  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(isolatedRoot),
      timings,
      longPathCharacters: deepFile.length,
      burst: {
        rawEvents: afterBurst.rawEvents - beforeBurst.rawEvents,
        emittedInvalidations: afterBurst.emittedInvalidations - beforeBurst.emittedInvalidations,
        droppedSignals: afterBurst.droppedSignals - beforeBurst.droppedSignals,
        authoritativeRefreshes: 1,
      },
      lifecycle: { baseline: baseline.activeWatchers, active: 1, stopped: stopped.activeWatchers },
      clipboardTouched: false,
    }),
  );
} finally {
  try {
    if (mainClient) {
      for (const id of activeWatches) await stopWatch(mainClient, id).catch(() => {});
      if (eventId !== undefined) {
        await evaluate(
          mainClient,
          `(async () => {
            window.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener('nammu://native-filesystem-change', ${JSON.stringify(eventId)});
            await window.__TAURI_INTERNALS__.invoke('plugin:event|unlisten', {
              event: 'nammu://native-filesystem-change',
              eventId: ${JSON.stringify(eventId)},
            });
          })()`,
        ).catch(() => {});
      }
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
      basename(resolvedRoot).startsWith('NammuFilesF2CTest-')
    ) {
      await rm(resolvedRoot, { recursive: true, force: true });
      if (
        resolvedProfile.startsWith(`${resolvedTemp}\\`) &&
        basename(resolvedProfile).startsWith('NammuFilesF2CTest-')
      ) {
        await rm(resolvedProfile, { recursive: true, force: true });
      } else {
        console.error('Refusing to clean an unexpected F2C WebView2 profile directory.');
        process.exitCode = 1;
      }
    } else {
      console.error('Refusing to clean an unexpected F2C acceptance directory.');
      process.exitCode = 1;
    }
  }
}
