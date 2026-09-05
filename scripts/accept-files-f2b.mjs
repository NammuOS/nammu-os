import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F2B_EXECUTABLE;
if (!executableInput) {
  throw new Error('Set NAMMU_F2B_EXECUTABLE to the packaged Nammu OS executable.');
}

const executable = resolve(executableInput);
await access(executable);
const debugPort = 9850 + Math.floor(Math.random() * 100);
const isolatedRoot = join(tmpdir(), `NammuFilesF2BTest-${randomUUID()}`);
await mkdir(isolatedRoot);
const timings = {};
const pendingUndo = new Set();
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
    await delay(100);
  }
  throw new Error('Timed out waiting for the packaged Files interface.');
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

async function runJob(client, command, args, timeoutMs = 90_000) {
  const started = value(await invoke(client, command, args), command);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = value(
      await invoke(client, 'get_native_deletion_operation', { id: started.id }),
      'get_native_deletion_operation',
    );
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) {
      if (snapshot.undoId) pendingUndo.add(snapshot.undoId);
      return snapshot;
    }
    await delay(30);
  }
  throw new Error(`${command} did not reach a terminal state.`);
}

async function restore(client, undoId) {
  const result = await runJob(client, 'start_native_restore', { undoId });
  if (result.state === 'completed' && result.failures.length === 0) pendingUndo.delete(undoId);
  return result;
}

async function timed(name, action) {
  const started = performance.now();
  const result = await action();
  timings[name] = Number((performance.now() - started).toFixed(2));
  return result;
}

const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let mainClient;

try {
  const mainTarget = await waitForTarget();
  mainClient = createCdpClient(mainTarget.webSocketDebuggerUrl);
  await mainClient.ready;
  await waitForValue(mainClient, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  await waitForValue(
    mainClient,
    `(() => { const button = document.querySelector('button[title^="Files"]'); button?.click(); return Boolean(button); })()`,
  );
  await waitForValue(
    mainClient,
    `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('This PC')); button?.click(); return Boolean(button); })()`,
  );
  await waitForValue(
    mainClient,
    `(() => { const card = [...document.querySelectorAll('button')].find((item) => /[A-Z]:\\\\/.test(item.textContent || '') && (item.textContent || '').includes('local')); card?.click(); return Boolean(card); })()`,
  );
  expect(
    await waitForValue(
      mainClient,
      `(() => Boolean(document.querySelector('button[title="Delete (Recycle Bin)"]') && document.querySelector('button[aria-label="Undo recent file operation"]')))()`,
    ),
    'The packaged Files delete and Undo controls were not rendered.',
  );

  const payload = randomBytes(4096);
  const single = join(isolatedRoot, 'single recycle.txt');
  await writeFile(single, payload);
  const expectedHash = hash(payload);
  const recycledSingle = await timed('singleRecycleMs', () =>
    runJob(mainClient, 'start_native_trash', { sources: [single] }),
  );
  expect(recycledSingle.state === 'completed', 'Single-file recycle failed.');
  expect(recycledSingle.reversible && recycledSingle.undoId, 'Recycle did not return Undo.');
  await access(single).then(
    () => {
      throw new Error('Recycled file remained at its original path.');
    },
    () => {},
  );
  const restoredSingle = await timed('singleRestoreMs', () =>
    restore(mainClient, recycledSingle.undoId),
  );
  expect(restoredSingle.state === 'completed', 'Single-file restore failed.');
  expect(hash(await readFile(single)) === expectedHash, 'Restored content hash changed.');

  const nestedRoot = join(isolatedRoot, 'Nested Unicode Folder');
  let deepest = nestedRoot;
  await mkdir(join(nestedRoot, 'Empty'), { recursive: true });
  for (let index = 0; index < 12; index += 1) {
    deepest = join(deepest, `segment-${String(index).padStart(2, '0')}-nammu-files`);
    await mkdir(deepest);
  }
  const deepFile = join(deepest, 'Nammu unicode.txt');
  await writeFile(deepFile, 'deep payload');
  expect(deepFile.length > 260, 'Long-path fixture did not exceed 260 characters.');
  const recycledFolder = await timed('directoryRecycleMs', () =>
    runJob(mainClient, 'start_native_trash', { sources: [nestedRoot] }),
  );
  expect(recycledFolder.state === 'completed', 'Nested long-path folder recycle failed.');
  const restoredFolder = await restore(mainClient, recycledFolder.undoId);
  expect(restoredFolder.state === 'completed', 'Nested long-path folder restore failed.');
  expect((await readFile(deepFile, 'utf8')) === 'deep payload', 'Nested restore lost content.');

  const hundred = [];
  for (let index = 0; index < 100; index += 1) {
    const path = join(isolatedRoot, `batch-${String(index).padStart(3, '0')}.txt`);
    await writeFile(path, `item-${index}`);
    hundred.push(path);
  }
  const recycledHundred = await timed('hundredFileRecycleMs', () =>
    runJob(mainClient, 'start_native_trash', { sources: hundred }),
  );
  expect(recycledHundred.successes.length === 100, '100-file recycle was incomplete.');
  const restoredHundred = await timed('hundredFileRestoreMs', () =>
    restore(mainClient, recycledHundred.undoId),
  );
  expect(restoredHundred.successes.length === 100, '100-file restore was incomplete.');

  const partialPresent = join(isolatedRoot, 'partial-present.txt');
  const partialMissing = join(isolatedRoot, 'partial-missing.txt');
  await writeFile(partialPresent, 'present');
  const partial = await runJob(mainClient, 'start_native_trash', {
    sources: [partialPresent, partialMissing],
  });
  expect(
    partial.successes.length === 1 && partial.failures[0]?.error.code === 'NOT_FOUND',
    'Partial recycle did not report explicit per-item results.',
  );
  await restore(mainClient, partial.undoId);

  const conflict = join(isolatedRoot, 'restore-conflict.txt');
  await writeFile(conflict, 'original');
  const conflictTrash = await runJob(mainClient, 'start_native_trash', { sources: [conflict] });
  await writeFile(conflict, 'replacement');
  const conflictRestore = await restore(mainClient, conflictTrash.undoId);
  expect(
    conflictRestore.failures[0]?.error.code === 'ALREADY_EXISTS',
    'Restore conflict did not fail closed.',
  );
  expect((await readFile(conflict, 'utf8')) === 'replacement', 'Restore overwrote new content.');
  const replacementDelete = await runJob(mainClient, 'start_native_permanent_delete', {
    sources: [conflict],
    confirmed: true,
  });
  expect(replacementDelete.state === 'completed', 'Explicit permanent delete failed.');
  const conflictRestored = await restore(mainClient, conflictTrash.undoId);
  expect(conflictRestored.state === 'completed', 'Conflict retry restore failed.');
  expect(
    (await readFile(conflict, 'utf8')) === 'original',
    'Conflict retry restored wrong content.',
  );

  const unconfirmed = await invoke(mainClient, 'start_native_permanent_delete', {
    sources: [conflict],
    confirmed: false,
  });
  expect(
    unconfirmed?.error?.code === 'CONFIRMATION_REQUIRED' && (await readFile(conflict, 'utf8')),
    'Permanent deletion proceeded without explicit confirmation.',
  );

  const permanentTree = join(isolatedRoot, 'Permanent tree');
  await mkdir(join(permanentTree, 'Nested'), { recursive: true });
  for (let index = 0; index < 100; index += 1) {
    await writeFile(join(permanentTree, 'Nested', `item-${index}.txt`), 'delete fixture');
  }
  const permanent = await timed('permanentTreeDeleteMs', () =>
    runJob(mainClient, 'start_native_permanent_delete', {
      sources: [permanentTree],
      confirmed: true,
    }),
  );
  expect(permanent.state === 'completed', 'Permanent tree deletion failed.');
  await access(permanentTree).then(
    () => {
      throw new Error('Permanent deletion left the generated tree behind.');
    },
    () => {},
  );

  const driveRoot = resolve(isolatedRoot).slice(0, 3);
  const rootAttempt = await invoke(mainClient, 'start_native_permanent_delete', {
    sources: [driveRoot],
    confirmed: true,
  });
  expect(
    rootAttempt?.error?.code === 'ROOT_OPERATION_FORBIDDEN',
    'Drive-root deletion was not rejected.',
  );

  const cancelSources = [];
  for (let index = 0; index < 250; index += 1) {
    const path = join(isolatedRoot, `cancel-${index}.txt`);
    await writeFile(path, 'cancel');
    cancelSources.push(path);
  }
  const cancelStarted = value(
    await invoke(mainClient, 'start_native_permanent_delete', {
      sources: cancelSources,
      confirmed: true,
    }),
    'start cancellable permanent delete',
  );
  expect(
    cancelStarted.cancellationMode === 'stop-remaining-only',
    'Permanent deletion advertised transactional cancellation.',
  );
  await invoke(mainClient, 'cancel_native_deletion_operation', { id: cancelStarted.id });
  const cancelled = await runJobFromId(mainClient, cancelStarted.id);
  expect(['cancelled', 'completed'].includes(cancelled.state), 'Cancellation state was invalid.');

  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(isolatedRoot),
      timings,
      longPathCharacters: deepFile.length,
      rootProtection: rootAttempt.error.code,
      cancellation: cancelled.state,
      remoteWebviewSecurity:
        'release child DevTools disabled; main-only capability and Rust checks verified separately',
    }),
  );
} finally {
  try {
    if (mainClient) {
      for (const undoId of pendingUndo) {
        await restore(mainClient, undoId).catch(() => {});
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
    const resolvedTemp = normalize(resolve(tmpdir()));
    if (
      resolvedRoot.startsWith(`${resolvedTemp}\\`) &&
      basename(resolvedRoot).startsWith('NammuFilesF2BTest-')
    ) {
      await rm(resolvedRoot, { recursive: true, force: true });
    } else {
      console.error('Refusing to clean an unexpected F2B acceptance directory.');
      process.exitCode = 1;
    }
  }
}

async function runJobFromId(client, id, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = value(
      await invoke(client, 'get_native_deletion_operation', { id }),
      'get_native_deletion_operation',
    );
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) return snapshot;
    await delay(20);
  }
  throw new Error('Deletion cancellation did not reach a terminal state.');
}
