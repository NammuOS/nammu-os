import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const executable = resolve(
  process.env.NAMMU_FILES_STARTUP_EXECUTABLE ||
    process.argv[2] ||
    'src-tauri/target/release/nammu-os.exe',
);
await access(executable);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const profileRoot = await mkdtemp(join(tmpdir(), 'nammu-files-startup-'));
const runtimeOutput = [];

const debugPort = await new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once('error', rejectPort);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      rejectPort(new Error('No CDP port was allocated.'));
      return;
    }
    server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
  });
});

const processStartedAt = performance.now();
const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profileRoot,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.on('data', (chunk) => runtimeOutput.push(chunk.toString()));
child.stderr.on('data', (chunk) => runtimeOutput.push(chunk.toString()));

let socket;
try {
  const deadline = Date.now() + 60_000;
  let target;
  while (!target && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        target = (await response.json()).find(
          (candidate) =>
            candidate.type === 'page' && /tauri\.localhost|tauri:\/\//.test(candidate.url),
        );
      }
    } catch {}
    if (!target) await delay(100);
  }
  if (!target) {
    throw new Error(`Packaged Nammu did not start. ${runtimeOutput.join('').slice(-2_000)}`);
  }
  const webviewAvailableMs = performance.now() - processStartedAt;

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveReady, rejectReady) => {
    socket.once('open', resolveReady);
    socket.once('error', rejectReady);
  });
  const pending = new Map();
  let nextId = 0;
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`${method} timed out.`));
      }, 10_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timeout);
          resolveRequest(value);
        },
        reject(error) {
          clearTimeout(timeout);
          rejectRequest(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed.');
    }
    return result.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 20_000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };

  await send('Runtime.enable');
  await waitFor(`Boolean(document.querySelector('button[title^="Files"]'))`, 'the Files launcher');
  const desktopReadyMs = performance.now() - processStartedAt;
  const openedAt = performance.now();
  await evaluate(`document.querySelector('button[title^="Files"]')?.click()`);
  await waitFor(
    `document.querySelector('[data-testid="nammu-files-app"]')?.dataset.filesSource === 'nammu'`,
    'the Files workspace',
    5_000,
  );
  const openDurationMs = performance.now() - openedAt;
  const before = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('get_native_file_drag_drop_diagnostics')`,
  );
  if (before?.status !== 'success' || before.value.registeredTargets !== 0) {
    throw new Error('Files initialized native OLE drag/drop during its normal startup path.');
  }

  // Keep probing beyond the asynchronous React effect window. The regression
  // used to register OLE after Files appeared, freezing the host only after the
  // previous short startup smoke had already passed.
  const responsivenessStarted = performance.now();
  let maximumRoundTripMs = 0;
  for (let index = 0; index < 50; index += 1) {
    const roundTripStarted = performance.now();
    const value = await evaluate(`(${index} + 1)`);
    if (value !== index + 1) throw new Error('The Nammu WebView stopped responding.');
    maximumRoundTripMs = Math.max(maximumRoundTripMs, performance.now() - roundTripStarted);
    await delay(100);
  }
  const responsivenessMs = performance.now() - responsivenessStarted;
  const afterSettling = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('get_native_file_drag_drop_diagnostics')`,
  );
  if (afterSettling?.status !== 'success' || afterSettling.value.registeredTargets !== 0) {
    throw new Error('Files registered native OLE drag/drop after its normal startup settled.');
  }

  await evaluate(
    `([...document.querySelectorAll('[data-testid="nammu-files-app"] button')].find((button) => button.textContent?.includes('This PC')))?.click()`,
  );
  await waitFor(
    `document.querySelector('[data-testid="nammu-files-app"]')?.dataset.filesSource === 'computer'`,
    'This PC mode',
  );
  await waitFor(
    `window.__TAURI_INTERNALS__.invoke('get_native_file_drag_drop_diagnostics').then((result) => result?.status === 'success' && result.value.registeredTargets === 1)`,
    'the lazy native drop target',
  );
  const after = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('get_native_file_drag_drop_diagnostics')`,
  );
  if (after.value.dropShieldVisible || after.value.dropShieldExpanded) {
    throw new Error('The native file-drop shield remained active while This PC was idle.');
  }

  const thisPcResponsivenessStarted = performance.now();
  let thisPcMaximumRoundTripMs = 0;
  for (let index = 0; index < 50; index += 1) {
    const roundTripStarted = performance.now();
    const value = await evaluate(`(${index} + 101)`);
    if (value !== index + 101) throw new Error('This PC stopped the Nammu WebView responding.');
    thisPcMaximumRoundTripMs = Math.max(
      thisPcMaximumRoundTripMs,
      performance.now() - roundTripStarted,
    );
    await delay(100);
  }
  const thisPcResponsivenessMs = performance.now() - thisPcResponsivenessStarted;
  const afterThisPcSettling = await evaluate(
    `window.__TAURI_INTERNALS__.invoke('get_native_file_drag_drop_diagnostics')`,
  );
  if (
    afterThisPcSettling.value.dropShieldVisible ||
    afterThisPcSettling.value.dropShieldExpanded
  ) {
    throw new Error('The native file-drop shield activated without an external drag.');
  }

  console.info(
    JSON.stringify({
      status: 'passed',
      executable: basename(executable),
      webviewAvailableMs: Number(webviewAvailableMs.toFixed(1)),
      desktopReadyMs: Number(desktopReadyMs.toFixed(1)),
      openDurationMs: Number(openDurationMs.toFixed(1)),
      fiftyProbesOverMs: Number(responsivenessMs.toFixed(1)),
      maximumRoundTripMs: Number(maximumRoundTripMs.toFixed(1)),
      nativeDropTargetsAtOpen: before.value.registeredTargets,
      nativeDropTargetsAfterSettling: afterSettling.value.registeredTargets,
      nativeDropTargetsInThisPc: after.value.registeredTargets,
      dropShieldVisibleInThisPc: afterThisPcSettling.value.dropShieldVisible,
      fiftyThisPcProbesOverMs: Number(thisPcResponsivenessMs.toFixed(1)),
      thisPcMaximumRoundTripMs: Number(thisPcMaximumRoundTripMs.toFixed(1)),
    }),
  );
} finally {
  socket?.close();
  child.kill();
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(5_000)]);
  // WebView2 can retain its profile lock for a short interval after the host
  // process exits while its utility processes finish shutting down.
  await rm(profileRoot, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}
