import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/* global Bun */

const baseUrl = process.argv[2] || 'http://localhost:3000';
const edgePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const runDir = join(tmpdir(), `nammu-pdf-p4-smoke-${process.pid}`);
const profileDir = join(runDir, 'edge-profile');
const fixturePath = join(runDir, 'forms-smoke.pdf');
const debugPort = 9400 + (process.pid % 300);

const isReachable = async () => {
  try {
    return (await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
};

let localServer;
if (!(await isReachable())) {
  const target = new URL(baseUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '3000') {
    throw new Error(`The requested Nammu smoke target is unavailable: ${target.origin}`);
  }
  localServer = Bun.spawn(['node', 'server.mjs', '--dev'], {
    cwd: process.cwd(),
    stdout: 'ignore',
    stderr: 'ignore',
  });
  for (let attempt = 0; attempt < 120 && !(await isReachable()); attempt += 1) {
    if (localServer.exitCode !== null) throw new Error('Nammu development server exited early.');
    await Bun.sleep(250);
  }
  if (!(await isReachable())) throw new Error('Nammu development server did not become ready.');
}

await mkdir(runDir, { recursive: true });
const fixture = await PDFDocument.create();
const page = fixture.addPage([612, 792]);
const font = await fixture.embedFont(StandardFonts.Helvetica);
page.drawText('Nammu PDF Forms acceptance document', { x: 72, y: 710, size: 16, font });
await writeFile(fixturePath, await fixture.save());

const edge = Bun.spawn(
  [
    edgePath,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

let socket;
const exceptions = [];
try {
  let targets;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      if (targets.some((target) => target.type === 'page')) break;
    } catch {}
    await Bun.sleep(100);
  }
  const target = targets?.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Edge DevTools target did not become ready.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let messageId = 0;
  let fileChooserResolve;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    }
    if (message.method === 'Page.fileChooserOpened') fileChooserResolve?.(message.params);
  };
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools WebSocket timed out.')), 5_000);
    socket.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++messageId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 10_000);
      pending.set(id, (message) => {
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await Bun.sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };
  const clickTitle = async (title) => {
    const point = await evaluate(
      `(() => { const r = document.querySelector('button[title="${title}"]')?.getBoundingClientRect(); return r ? {x:r.left+r.width/2,y:r.top+r.height/2}:null; })()`,
    );
    if (!point) throw new Error(`${title} is unavailable.`);
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Page.navigate', { url: `${baseUrl}/apps/pdf` });
  await waitFor(
    `Boolean(document.querySelector('[data-testid="nammu-pdf-workspace"]'))`,
    'Nammu PDF',
  );
  const chooserPromise = new Promise((resolve) => {
    fileChooserResolve = resolve;
  });
  await clickTitle('Open PDF');
  const chooser = await Promise.race([
    chooserPromise,
    Bun.sleep(5_000).then(() => {
      throw new Error('The PDF picker did not open.');
    }),
  ]);
  await send('DOM.setFileInputFiles', {
    files: [fixturePath],
    backendNodeId: chooser.backendNodeId,
  });
  await waitFor(`Boolean(document.querySelector('[data-pdf-page="1"] canvas'))`, 'rendered page');
  await clickTitle('Create and edit PDF forms');
  await waitFor(`Boolean(document.querySelector('button[title="Text field"]'))`, 'Forms toolbar');
  await clickTitle('Text field');
  const layer = await evaluate(
    `(() => { const r = document.querySelector('[data-pdf-form-layer="1"]')?.getBoundingClientRect(); return r ? {x:r.left+90,y:r.top+120}:null; })()`,
  );
  if (!layer) throw new Error('Form authoring layer is unavailable.');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: layer.x,
    y: layer.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: layer.x + 180,
    y: layer.y + 32,
    button: 'left',
    buttons: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: layer.x + 180,
    y: layer.y + 32,
    button: 'left',
    clickCount: 1,
  });
  await Bun.sleep(1_000);
  const gestureDiagnostic = await evaluate(`(() => ({
    workspace: document.querySelector('[data-testid="nammu-pdf-workspace"]')?.getAttribute('data-workspace-mode'),
    fieldWidgets: document.querySelectorAll('[data-pdf-form-widget]').length,
    body: document.body.innerText.slice(-600)
  }))()`);
  if (!gestureDiagnostic?.fieldWidgets) {
    throw new Error(
      `Form gesture did not commit: ${JSON.stringify(gestureDiagnostic)}; exceptions=${exceptions.join(' | ')}`,
    );
  }
  await waitFor(
    `document.body.innerText.includes('1 field') && document.body.innerText.includes('Modified')`,
    'committed AcroForm field',
  );
  await clickTitle('Return to Read workspace');
  await waitFor(
    `Boolean(document.querySelector('[data-pdf-form-widget] input'))`,
    'interactive form control',
  );
  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(' | ')}`);
  console.info(
    JSON.stringify({
      status: 'passed',
      workspace: 'Forms',
      document: 'rendered',
      field: 'real AcroForm text field committed',
      browserExceptions: 0,
    }),
  );
} finally {
  socket?.close();
  edge.kill();
  await edge.exited.catch(() => undefined);
  if (localServer) {
    localServer.kill('SIGTERM');
    await Promise.race([localServer.exited, Bun.sleep(5_000)]).catch(() => undefined);
    if (localServer.exitCode === null) {
      localServer.kill('SIGKILL');
      await localServer.exited.catch(() => undefined);
    }
  }
  await rm(runDir, { recursive: true, force: true });
}
