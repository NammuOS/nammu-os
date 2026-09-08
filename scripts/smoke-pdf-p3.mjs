import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* global Bun */

const baseUrl = process.argv[2] || 'http://localhost:3000';
const edgePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const runDir = join(tmpdir(), `nammu-pdf-p3-smoke-${process.pid}`);
const profileDir = join(runDir, 'edge-profile');
const fixturePath = join(runDir, 'annotation-smoke.pdf');
const debugPort = 9300 + (process.pid % 300);

await mkdir(runDir, { recursive: true });
const fixture = await PDFDocument.create();
const page = fixture.addPage([612, 792]);
const font = await fixture.embedFont(StandardFonts.Helvetica);
page.drawText('Nammu PDF annotation acceptance document', {
  x: 72,
  y: 710,
  size: 16,
  font,
  color: rgb(0.08, 0.12, 0.18),
});
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
  const waitFor = async (expression, label, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await Bun.sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Page.navigate', { url: `${baseUrl}/apps/pdf` });
  await waitFor(
    `Boolean(document.querySelector('[data-testid="nammu-pdf-workspace"]'))`,
    'the Nammu PDF workspace',
    30_000,
  );

  const chooserPromise = new Promise((resolve) => {
    fileChooserResolve = resolve;
  });
  const openPoint = await evaluate(`(() => {
    const rect = document.querySelector('button[title="Open PDF"]')?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (!openPoint) throw new Error('The Open PDF command is unavailable.');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: openPoint.x,
    y: openPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: openPoint.x,
    y: openPoint.y,
    button: 'left',
    clickCount: 1,
  });
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
  await waitFor(
    `Boolean(document.querySelector('[data-pdf-page="1"] canvas'))`,
    'the rendered PDF page',
  );
  await evaluate(`document.querySelector('button[title="Comment and annotate"]')?.click()`);
  await waitFor(
    `Boolean(document.querySelector('button[title="Sticky note"]'))`,
    'the Comment toolbar',
  );
  await evaluate(`document.querySelector('button[title="Sticky note"]')?.click()`);
  const point = await evaluate(`(() => {
    const element = document.querySelector('[data-pdf-annotation-gesture="1"]');
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + Math.min(120, rect.width / 3), y: rect.top + Math.min(120, rect.height / 3) } : null;
  })()`);
  if (!point) throw new Error('The annotation gesture layer is unavailable.');
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
  await waitFor(
    `Boolean(document.querySelector('textarea[placeholder="Write a comment…"]'))`,
    'the note editor',
  );
  await evaluate(`(() => {
    const field = document.querySelector('textarea[placeholder="Write a comment…"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, 'P3 rendered browser smoke');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(
    `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Add annotation')?.click()`,
  );
  await waitFor(
    `document.body.innerText.includes('1 annotation') && document.body.innerText.includes('Modified')`,
    'the committed annotation',
  );
  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(' | ')}`);
  console.info(
    JSON.stringify({
      status: 'passed',
      workspace: 'Comment',
      document: 'rendered',
      annotation: 'real sticky note committed',
      browserExceptions: 0,
    }),
  );
} finally {
  socket?.close();
  edge.kill();
  await edge.exited.catch(() => undefined);
  await rm(runDir, { recursive: true, force: true });
}
