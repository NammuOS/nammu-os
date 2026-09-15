import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const executable = resolve(
  process.env.NAMMU_BROWSER_DESKTOP_EXECUTABLE ||
    process.argv[2] ||
    'src-tauri/target/release/nammu-os.exe',
);
await access(executable);

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const profileRoot = await mkdtemp(join(tmpdir(), 'nammu-browser-desktop-'));
const output = [];
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
child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

let socket;
let playwrightBrowser;
try {
  const listTargets = async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) throw new Error(`CDP target lookup failed with HTTP ${response.status}.`);
    return response.json();
  };
  const targetDeadline = Date.now() + 60_000;
  let mainTarget;
  while (!mainTarget && Date.now() < targetDeadline) {
    try {
      mainTarget = (await listTargets()).find(
        (candidate) =>
          candidate.type === 'page' && /tauri\.localhost|tauri:\/\//.test(candidate.url),
      );
    } catch {}
    if (!mainTarget) await delay(100);
  }
  if (!mainTarget) throw new Error(`Packaged Nammu did not start. ${output.join('').slice(-2_000)}`);

  socket = new WebSocket(mainTarget.webSocketDebuggerUrl);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.once('open', resolveSocket);
    socket.once('error', rejectSocket);
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
      }, 15_000);
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
  const waitFor = async (expression, label, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression).catch(() => false)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  const clickByText = (text, root = 'document') =>
    evaluate(`(() => {
      const root = ${root};
      const expected = ${JSON.stringify(text)};
      const button = [...root.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.replace(/\\s+/g, ' ').trim() === expected);
      button?.click();
      return Boolean(button);
    })()`);

  await send('Runtime.enable');
  console.info('desktop-accept: shell-ready');
  await waitFor(`Boolean(document.querySelector('button[title="NammuOS apps"]'))`, 'NammuOS launcher');
  await evaluate(`document.querySelector('button[title="NammuOS apps"]')?.click()`);
  await waitFor(`Boolean(document.querySelector('.start-menu-app[title="App Store"]'))`, 'App Store');
  await evaluate(`document.querySelector('.start-menu-app[title="App Store"]')?.click()`);
  await waitFor(`Boolean(document.querySelector('[data-nammu-app="app-store"]'))`, 'Store window');
  console.info('desktop-accept: store-open');
  const browserCardOpened = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.nammu-store-card')]
      .find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === 'Browser');
    card?.click();
    return Boolean(card);
  })()`);
  if (!browserCardOpened) throw new Error('Browser Store card was not found.');
  await waitFor(
    `Boolean([...document.querySelectorAll('[data-nammu-app="app-store"] button')]
      .find((button) => ['Install', 'Open'].includes(button.textContent?.trim())))`,
    'Browser Store details',
  );
  const action = await evaluate(`(() => {
    const root = document.querySelector('[data-nammu-app="app-store"]');
    const button = [...root.querySelectorAll('button')]
      .find((candidate) => ['Install', 'Open'].includes(candidate.textContent?.trim()));
    const action = button?.textContent?.trim();
    button?.click();
    return action;
  })()`);
  if (action === 'Install') {
    await waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, 'permission review');
    if (!(await clickByText('Install', `document.querySelector('[role="dialog"]')`))) {
      throw new Error('Permission review could not be confirmed.');
    }
    await waitFor(
      `Boolean([...document.querySelectorAll('[data-nammu-app="app-store"] button')]
        .find((button) => button.textContent?.trim() === 'Open'))`,
      'installed Browser',
      90_000,
    );
    await clickByText('Open', `document.querySelector('[data-nammu-app="app-store"]')`);
  }
  console.info(`desktop-accept: browser-${action === 'Install' ? 'installed-and-opened' : 'opened'}`);

  playwrightBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const playwrightPage = playwrightBrowser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => /tauri\.localhost|tauri:\/\//.test(page.url()));
  if (!playwrightPage) throw new Error('Playwright could not attach to the Nammu host page.');
  const packageFrame = playwrightPage.frameLocator('iframe[title="Browser"]');
  const omnibox = packageFrame.locator('.browser-omnibox-input');
  try {
    await omnibox.waitFor({ timeout: 45_000 });
  } catch (error) {
    const playwrightFrames = await Promise.all(
      playwrightPage.frames().map(async (frame) => ({
        name: frame.name(),
        url: frame.url(),
        body: await frame.locator('body').innerText().catch(() => ''),
      })),
    );
    const diagnostics = await evaluate(`(() => ({
      frames: [...document.querySelectorAll('iframe')].map((frame) => ({
        title: frame.title,
        src: frame.getAttribute('src'),
        hasSrcDoc: frame.hasAttribute('srcdoc'),
      })),
      windows: [...document.querySelectorAll('.window-title')].map((node) => node.textContent?.trim()),
      store: document.querySelector('[data-nammu-app="app-store"]')?.innerText?.slice(0, 1000),
      sandboxErrors: [...document.querySelectorAll('.text-rose-400')]
        .map((node) => node.textContent?.trim()).filter(Boolean),
    }))()`);
    throw new Error(
      `Browser package UI did not start: ${JSON.stringify({ ...diagnostics, playwrightFrames })}; ${error}`,
    );
  }
  console.info('desktop-accept: package-ui-ready');
  await omnibox.fill('https://example.com/');
  await omnibox.press('Enter');
  console.info('desktop-accept: navigation-dispatched');

  const navigationDeadline = Date.now() + 45_000;
  let remoteTarget;
  while (!remoteTarget && Date.now() < navigationDeadline) {
    remoteTarget = (await listTargets()).find(
      (candidate) => candidate.type === 'page' && /^https:\/\/example\.com\/?/.test(candidate.url),
    );
    if (!remoteTarget) await delay(150);
  }
  if (!remoteTarget) throw new Error('The Desktop Browser never created a WebView2 page target.');
  console.info('desktop-accept: native-webview-ready');

  const uploadSocket = new WebSocket(remoteTarget.webSocketDebuggerUrl);
  const uploadPending = new Map();
  let uploadId = 0;
  await new Promise((resolveSocket, rejectSocket) => {
    uploadSocket.once('open', resolveSocket);
    uploadSocket.once('error', rejectSocket);
  });
  uploadSocket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const request = uploadPending.get(message.id);
    if (!request) return;
    uploadPending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const uploadSend = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++uploadId;
      const timeout = setTimeout(() => {
        uploadPending.delete(id);
        rejectRequest(new Error(`${method} timed out.`));
      }, 15_000);
      uploadPending.set(id, {
        resolve(value) {
          clearTimeout(timeout);
          resolveRequest(value);
        },
        reject(error) {
          clearTimeout(timeout);
          rejectRequest(error);
        },
      });
      uploadSocket.send(JSON.stringify({ id, method, params }));
    });
  const uploadFixture = join(profileRoot, 'website-upload-fixture.txt');
  const uploadContents = 'Nammu Browser packaged WebView2 upload acceptance';
  await writeFile(uploadFixture, uploadContents, 'utf8');
  await uploadSend('Runtime.evaluate', {
    expression:
      "(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'nammu-upload-acceptance'; document.body.append(input); })()",
  });
  const uploadDocument = await uploadSend('DOM.getDocument', { depth: -1, pierce: true });
  const uploadInput = await uploadSend('DOM.querySelector', {
    nodeId: uploadDocument.root.nodeId,
    selector: '#nammu-upload-acceptance',
  });
  if (!uploadInput.nodeId) throw new Error('The website did not expose its file input.');
  await uploadSend('DOM.setFileInputFiles', {
    files: [uploadFixture],
    nodeId: uploadInput.nodeId,
  });
  const uploadValue = await uploadSend('Runtime.evaluate', {
    expression:
      "(() => { const input = document.querySelector('#nammu-upload-acceptance'); const file = input?.files?.[0]; return file ? { name: file.name, size: file.size } : null; })()",
    returnByValue: true,
  });
  if (
    uploadValue.result?.value?.name !== 'website-upload-fixture.txt' ||
    uploadValue.result?.value?.size !== Buffer.byteLength(uploadContents)
  ) {
    throw new Error(`WebView2 did not mediate the selected website file: ${JSON.stringify(uploadValue)}`);
  }
  uploadSocket.close();
  console.info('desktop-accept: website-file-upload-mediated');

  const diagnostics = await playwrightPage.evaluate(() => ({
    packageFrames: document.querySelectorAll('iframe[title="Browser"]').length,
    geckoFrames: document.querySelectorAll('iframe[title*="Gecko"], iframe[src*="firefox"]').length,
  }));
  if (diagnostics.packageFrames !== 1) throw new Error('Duplicate Browser package hosts were created.');
  if (diagnostics.geckoFrames !== 0) throw new Error('Desktop Browser unexpectedly created Gecko UI.');

  const processExit =
    child.exitCode === null
      ? new Promise((resolveExit) => child.once('exit', resolveExit))
      : Promise.resolve(child.exitCode);
  await playwrightPage
    .evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }))
    .catch((error) => {
      if (!/Target page, context or browser has been closed/i.test(String(error))) throw error;
    });
  await Promise.race([
    processExit,
    delay(15_000).then(() => {
      throw new Error('Packaged Nammu did not shut down after the host close request.');
    }),
  ]);
  console.info(
    JSON.stringify({
      status: 'passed',
      runtime: 'WebView2',
      remoteUrl: remoteTarget.url,
      websiteFileUpload: 'mediated',
      desktopGeckoInstances: 0,
      packageHosts: diagnostics.packageFrames,
      shutdown: 'clean',
    }),
  );
} finally {
  socket?.close();
  await playwrightBrowser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  await Promise.race([new Promise((done) => child.once('exit', done)), delay(5_000)]);
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
