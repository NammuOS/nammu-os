import { spawn } from 'node:child_process';
import { access, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, resolve } from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F2A_EXECUTABLE;
if (!executableInput) {
  throw new Error('Set NAMMU_F2A_EXECUTABLE to the packaged Nammu OS executable.');
}

const executable = resolve(executableInput);
await access(executable);
const debugPort = 9600 + Math.floor(Math.random() * 250);
const testRoot = await mkdtemp(join(tmpdir(), 'NammuFilesF2ATest-'));
const timings = {};
const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

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

async function waitForTargets(predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const match = targets.find(predicate);
        if (match) return { match, targets };
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

async function waitForMainBridge(client, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const available = await evaluate(
      client,
      "typeof window.__TAURI_INTERNALS__?.invoke === 'function'",
    ).catch(() => false);
    if (available) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for the trusted Tauri command bridge.');
}

async function waitForValue(client, expression, timeoutMs = 30_000) {
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

async function runJob(client, command, args) {
  const started = value(await invoke(client, command, args), command);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snapshot = value(
      await invoke(client, 'get_native_file_operation', { id: started.id }),
      'get_native_file_operation',
    );
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) return snapshot;
    await delay(40);
  }
  throw new Error(`${command} did not reach a terminal state.`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
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
  const { match: mainTarget } = await waitForTargets(
    (target) => target.type === 'page' && /tauri\.localhost|tauri:\/\//.test(target.url),
  );
  mainClient = createCdpClient(mainTarget.webSocketDebuggerUrl);
  await mainClient.ready;
  await waitForMainBridge(mainClient);
  expect(
    (await evaluate(mainClient, 'typeof window.__TAURI_INTERNALS__?.invoke')) === 'function',
    'The trusted main shell did not receive the typed Tauri invoke boundary.',
  );
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
      `(() => { const text = document.body.innerText; return text.includes('New folder') && text.includes('New file') && text.includes('NATIVE · READ / WRITE'); })()`,
    ),
    'The packaged Files write controls were not rendered.',
  );

  const source = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: testRoot,
      name: 'Source',
    }),
    'create directory',
  ).entry.path;
  const destination = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: testRoot,
      name: 'Destination',
    }),
    'create destination',
  ).entry.path;
  const batchDestination = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: testRoot,
      name: 'Batch',
    }),
    'create batch destination',
  ).entry.path;

  const createdFile = value(
    await invoke(mainClient, 'create_native_file', {
      parentPath: source,
      name: 'notes.txt',
    }),
    'create empty file',
  ).entry.path;
  expect((await stat(createdFile)).size === 0, 'New File did not create an empty file.');
  const renamed = await timed('renameMs', async () =>
    value(
      await invoke(mainClient, 'rename_native_file', {
        path: createdFile,
        newName: 'README.md',
      }),
      'rename',
    ),
  );
  await writeFile(renamed.entry.path, 'Nammu F2A packaged acceptance');

  const copied = await timed('copyFileMs', () =>
    runJob(mainClient, 'start_native_copy', {
      sources: [renamed.entry.path],
      destinationPath: destination,
      conflictStrategy: 'cancel',
    }),
  );
  expect(copied.state === 'completed' && copied.successes.length === 1, 'File copy failed.');
  expect(
    (await readFile(join(destination, 'README.md'), 'utf8')) === 'Nammu F2A packaged acceptance',
    'File copy changed the payload.',
  );

  const duplicate = await runJob(mainClient, 'start_native_duplicate', {
    sources: [join(destination, 'README.md')],
  });
  expect(duplicate.successes[0]?.entry.name === 'README copy.md', 'Duplicate naming was wrong.');

  const nested = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: source,
      name: 'Nested',
    }),
    'create nested folder',
  ).entry.path;
  await invoke(mainClient, 'create_native_directory', { parentPath: nested, name: 'Empty' });
  const unicode = value(
    await invoke(mainClient, 'create_native_file', {
      parentPath: nested,
      name: 'नम्मु.txt',
    }),
    'create unicode file',
  ).entry.path;
  await writeFile(unicode, 'Unicode payload');
  const nestedCopy = await runJob(mainClient, 'start_native_copy', {
    sources: [nested],
    destinationPath: destination,
    conflictStrategy: 'cancel',
  });
  expect(nestedCopy.state === 'completed', 'Nested folder copy failed.');
  expect(
    (await stat(join(destination, 'Nested', 'Empty'))).isDirectory(),
    'Empty folder was lost.',
  );

  let longPathSource = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: source,
      name: 'LongPathSource',
    }),
    'create long-path root',
  ).entry.path;
  const longSegments = [];
  for (let index = 0; index < 12; index += 1) {
    const segment = `segment-${String(index).padStart(2, '0')}-nammu-files`;
    longSegments.push(segment);
    longPathSource = value(
      await invoke(mainClient, 'create_native_directory', {
        parentPath: longPathSource,
        name: segment,
      }),
      'create long-path segment',
    ).entry.path;
  }
  expect(longPathSource.length > 260, 'Long-path fixture did not exceed 260 characters.');
  const longPathFile = value(
    await invoke(mainClient, 'create_native_file', {
      parentPath: longPathSource,
      name: 'deep-file.txt',
    }),
    'create long-path file',
  ).entry.path;
  await writeFile(longPathFile, 'Long path payload');
  const longPathCopy = await runJob(mainClient, 'start_native_copy', {
    sources: [join(source, 'LongPathSource')],
    destinationPath: destination,
    conflictStrategy: 'cancel',
  });
  expect(longPathCopy.state === 'completed', 'Long-path directory copy failed.');
  expect(
    (await readFile(
      join(destination, 'LongPathSource', ...longSegments, 'deep-file.txt'),
      'utf8',
    )) === 'Long path payload',
    'Long-path directory copy changed the payload.',
  );

  const moveSource = value(
    await invoke(mainClient, 'create_native_file', {
      parentPath: source,
      name: 'move-me.txt',
    }),
    'create move source',
  ).entry.path;
  await writeFile(moveSource, 'move');
  const moved = await timed('moveMs', () =>
    runJob(mainClient, 'start_native_move', {
      sources: [moveSource],
      destinationPath: destination,
      conflictStrategy: 'cancel',
    }),
  );
  expect(moved.state === 'completed', 'Move failed.');
  await access(join(destination, 'move-me.txt'));
  await access(moveSource).then(
    () => {
      throw new Error('Same-volume move left its source behind.');
    },
    () => {},
  );

  const multiCopySources = [];
  for (const name of ['multi-a.txt', 'multi-b.txt']) {
    const path = value(
      await invoke(mainClient, 'create_native_file', { parentPath: source, name }),
      'create multi-copy source',
    ).entry.path;
    multiCopySources.push(path);
  }
  const multiCopy = await runJob(mainClient, 'start_native_copy', {
    sources: multiCopySources,
    destinationPath: batchDestination,
    conflictStrategy: 'cancel',
  });
  expect(multiCopy.successes.length === 2, 'Multi-selection copy did not complete both items.');

  const cutSources = [];
  for (const name of ['cut-a.txt', 'cut-b.txt']) {
    const path = value(
      await invoke(mainClient, 'create_native_file', { parentPath: source, name }),
      'create cut source',
    ).entry.path;
    cutSources.push(path);
  }
  const cutPaste = await runJob(mainClient, 'start_native_move', {
    sources: cutSources,
    destinationPath: batchDestination,
    conflictStrategy: 'cancel',
  });
  expect(cutPaste.successes.length === 2, 'Multi-selection cut/paste move failed.');

  const conflict = await runJob(mainClient, 'start_native_copy', {
    sources: [renamed.entry.path],
    destinationPath: destination,
    conflictStrategy: 'cancel',
  });
  expect(
    conflict.state === 'failed' && conflict.failures[0]?.error.code === 'ALREADY_EXISTS',
    'Conflict did not fail closed.',
  );
  const keepBoth = await runJob(mainClient, 'start_native_copy', {
    sources: [renamed.entry.path],
    destinationPath: destination,
    conflictStrategy: 'keep-both',
  });
  expect(
    keepBoth.successes[0]?.entry.name === 'README copy 2.md',
    'Keep Both was not deterministic.',
  );

  const invalidName = await invoke(mainClient, 'create_native_file', {
    parentPath: source,
    name: 'CON.txt',
  });
  expect(invalidName?.error?.code === 'INVALID_NAME', 'Reserved Windows name was accepted.');

  const loopRoot = value(
    await invoke(mainClient, 'create_native_directory', { parentPath: source, name: 'Loop' }),
    'create loop fixture',
  ).entry.path;
  const loopChild = value(
    await invoke(mainClient, 'create_native_directory', { parentPath: loopRoot, name: 'Child' }),
    'create loop child',
  ).entry.path;
  const recursiveCopy = await runJob(mainClient, 'start_native_copy', {
    sources: [loopRoot],
    destinationPath: loopChild,
    conflictStrategy: 'cancel',
  });
  expect(
    recursiveCopy.failures[0]?.error.code === 'DESTINATION_INSIDE_SOURCE',
    'Recursive descendant copy was not rejected.',
  );

  const cancelDestination = value(
    await invoke(mainClient, 'create_native_directory', {
      parentPath: testRoot,
      name: 'CancelDestination',
    }),
    'create cancellation destination',
  ).entry.path;
  const largeSource = join(source, 'cancel-large.bin');
  const largeHandle = await open(largeSource, 'w');
  await largeHandle.truncate(100 * 1024 * 1024);
  await largeHandle.close();
  const cancelStarted = value(
    await invoke(mainClient, 'start_native_copy', {
      sources: [largeSource],
      destinationPath: cancelDestination,
      conflictStrategy: 'cancel',
    }),
    'start cancellable copy',
  );
  await invoke(mainClient, 'cancel_native_file_operation', { id: cancelStarted.id });
  let cancelled;
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    cancelled = value(
      await invoke(mainClient, 'get_native_file_operation', { id: cancelStarted.id }),
      'poll cancellable copy',
    );
    if (['completed', 'failed', 'cancelled'].includes(cancelled.state)) break;
    await delay(20);
  }
  expect(cancelled?.state === 'cancelled', 'Packaged cancellation did not win the test race.');
  await access(largeSource);
  expect(
    !(await readdir(cancelDestination)).some((name) => name.includes('nammu-partial')),
    'Cancellation left a Nammu partial file behind.',
  );

  const webSurface = await invoke(mainClient, 'create_web_surface', {
    owner: 'browser',
    profileKey: 'f2a-security-proof',
    privateSession: true,
    url: 'https://example.com/',
    bounds: { x: 0, y: 0, width: 320, height: 240 },
    visible: false,
  });
  expect(
    webSurface.owner === 'browser' && /^[a-f0-9]{32}$/.test(webSurface.id),
    'The packaged native surface lifecycle did not initialize correctly.',
  );
  await invoke(mainClient, 'destroy_web_surface', { id: webSurface.id });

  const listing = value(
    await invoke(mainClient, 'list_native_directory', { path: testRoot }),
    'final directory listing',
  );
  expect(listing.entries.length >= 4, 'The packaged native read layer did not see F2A results.');

  console.info(
    JSON.stringify({
      status: 'passed',
      executable,
      isolatedDirectory: basename(testRoot),
      timings,
      cancellation: cancelled.state,
      longPathCharacters: longPathFile.length,
      remoteWebviewSecurity: 'release DevTools disabled; capability policy verified separately',
    }),
  );
} finally {
  try {
    if (mainClient) {
      await evaluate(mainClient, 'window.close()').catch(() => {});
      mainClient.close();
    }
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      delay(10_000),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  } finally {
    const resolvedRoot = normalize(resolve(testRoot));
    const resolvedTemp = normalize(resolve(tmpdir()));
    const safeTestRoot =
      resolvedRoot.startsWith(`${resolvedTemp}\\`) &&
      basename(resolvedRoot).startsWith('NammuFilesF2ATest-');
    if (safeTestRoot) {
      await rm(resolvedRoot, { recursive: true, force: true });
    } else {
      console.error('Refusing to clean an unexpected acceptance-test directory.');
      process.exitCode = 1;
    }
  }
}
