import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const executable = resolve(
  process.env.NAMMU_STANDALONE_EXECUTABLE ||
    process.argv[2] ||
    'src-tauri/target/release/nammu-os.exe',
);
await access(executable);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const profileRoot = await mkdtemp(join(tmpdir(), 'nammu-standalone-smoke-'));
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

const clients = new Set();
const connect = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  clients.add(socket);
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
  await send('Runtime.enable');
  return { target, socket, evaluate };
};

const listTargets = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
};

const waitForTarget = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = (await listTargets()).find(predicate);
    if (target) return target;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}. ${runtimeOutput.join('').slice(-2_000)}`);
};

const waitFor = async (client, expression, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression).catch(() => false)) return;
    await delay(75);
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

try {
  const mainTarget = await waitForTarget(
    (target) => target.type === 'page' && /tauri\.localhost|tauri:\/\//.test(target.url),
    'the main Nammu WebView',
    60_000,
  );
  const main = await connect(mainTarget);
  await waitFor(main, `Boolean(document.querySelector('[aria-label="Toggle NammuOS apps"]'))`, 'desktop');

  await main.evaluate(`document.querySelector('[aria-label="Toggle NammuOS apps"]')?.click()`);
  await waitFor(main, `Boolean(document.querySelector('button[title="Calculator"]'))`, 'Calculator launcher');
  await main.evaluate(`document.querySelector('button[title="Calculator"]')?.click()`);
  await waitFor(
    main,
    `Boolean([...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Open Calculator in new tab'))`,
    'Calculator standalone action',
  );
  await main.evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Open Calculator in new tab')?.click()`,
  );

  const standaloneTarget = await waitForTarget(
    (target) => target.type === 'page' && target.id !== mainTarget.id,
    'the standalone native window',
  );
  const standalone = await connect(standaloneTarget);
  try {
    await waitFor(
      standalone,
      `Boolean(document.querySelector('.standalone-window-shell') && document.querySelector('[data-nammu-app="calculator"]'))`,
      'the rendered standalone Calculator',
    );
  } catch (error) {
    const diagnostics = await standalone.evaluate(`({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      text: document.body?.innerText?.slice(0, 800),
      html: document.body?.innerHTML?.slice(0, 1_500),
    })`);
    throw new Error(
      `${error.message} ${JSON.stringify({ diagnostics, targets: await listTargets() })}`,
    );
  }
  const rendered = await standalone.evaluate(`({
    title: document.title,
    app: document.querySelector('[data-nammu-app]')?.getAttribute('data-nammu-app'),
    hasClose: Boolean(document.querySelector('[aria-label="Close window"]')),
    background: getComputedStyle(document.documentElement).backgroundColor,
  })`);
  if (rendered.app !== 'calculator' || !rendered.hasClose) {
    throw new Error(`The standalone window rendered an invalid shell: ${JSON.stringify(rendered)}`);
  }

  await standalone.evaluate(`document.querySelector('[aria-label="Close window"]')?.click()`);
  const closeDeadline = Date.now() + 10_000;
  while (Date.now() < closeDeadline) {
    if (!(await listTargets()).some((target) => target.id === standaloneTarget.id)) break;
    await delay(100);
  }
  if ((await listTargets()).some((target) => target.id === standaloneTarget.id)) {
    throw new Error('The standalone native window did not close from its titlebar button.');
  }
  if (!(await main.evaluate(`document.body.isConnected && document.visibilityState !== 'unloaded'`))) {
    throw new Error('Closing the standalone window also closed the main Nammu shell.');
  }

  console.info(
    JSON.stringify({
      status: 'passed',
      executable: basename(executable),
      standaloneApp: rendered.app,
      title: rendered.title,
      rendered: true,
      closeControl: true,
      mainWindowSurvived: true,
    }),
  );
} finally {
  for (const socket of clients) socket.close();
  child.kill();
  await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(5_000)]);
  await delay(1_500);
  await rm(profileRoot, {
    recursive: true,
    force: true,
    maxRetries: 40,
    retryDelay: 250,
  }).catch((error) => {
    console.warn(`Profile cleanup was deferred: ${error.message}`);
  });
}
