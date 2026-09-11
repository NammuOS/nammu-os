import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const downloadDir = join(runDir, 'downloads');
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

await mkdir(downloadDir, { recursive: true });
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
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
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
  await clickTitle('Edit page content');
  await waitFor(
    `Boolean(document.querySelector('button[title="Click the page to add real PDF text"]'))`,
    'Edit toolbar',
  );
  await clickTitle('Click the page to add real PDF text');
  const editPoint = await evaluate(
    `(() => { const r = document.querySelector('[data-pdf-edit-layer="1"]')?.getBoundingClientRect(); return r ? {x:r.left+110,y:r.top+150}:null; })()`,
  );
  if (!editPoint) throw new Error('Content editing layer is unavailable.');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: editPoint.x,
    y: editPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: editPoint.x,
    y: editPoint.y,
    button: 'left',
    clickCount: 1,
  });
  await waitFor(
    `Boolean(document.querySelector('[data-pdf-content-object]'))`,
    'real authored text',
  );
  await clickTitle('Return to Read workspace');
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
  await clickTitle('Protect and redact');
  await waitFor(`Boolean(document.querySelector('button[title="Mark a region for redaction"]'))`, 'Protect toolbar');
  await clickTitle('Mark a region for redaction');
  const protectPoint = await evaluate(
    `(() => { const r = document.querySelector('[data-pdf-protect-layer="1"]')?.getBoundingClientRect(); return r ? {x:r.left+70,y:r.top+70}:null; })()`,
  );
  if (!protectPoint) throw new Error('Protect redaction layer is unavailable.');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: protectPoint.x, y: protectPoint.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: protectPoint.x + 190, y: protectPoint.y + 55, button: 'left', buttons: 1 });
  await Bun.sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: protectPoint.x + 190, y: protectPoint.y + 55, button: 'left', clickCount: 1 });
  await Bun.sleep(250);
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === 'Continue'); if (button) { button.click(); return true; } return false; })()`);
  await Bun.sleep(1_000);
  const protectDiagnostic = await evaluate(`(() => ({
    workspace: document.querySelector('[data-testid="nammu-pdf-workspace"]')?.getAttribute('data-workspace-mode'),
    layer: document.querySelector('[data-pdf-protect-layer="1"]')?.className,
    marks: document.querySelectorAll('[aria-label="Pending redaction"]').length,
    body: document.body.innerText.slice(-900)
  }))()`);
  if (!protectDiagnostic?.marks) throw new Error(`Protect gesture did not commit: ${JSON.stringify(protectDiagnostic)}; exceptions=${exceptions.join(' | ')}`);
  await waitFor(`Boolean(document.querySelector('[aria-label="Pending redaction"]'))`, 'real /Redact mark');
  await evaluate(`window.confirm = () => true`);
  await clickTitle('Apply secure raster redactions');
  try {
    await waitFor(`!document.querySelector('[aria-label="Pending redaction"]') && document.body.innerText.includes('Ready')`, 'applied raster redaction', 45_000);
  } catch (error) {
    const diagnostic = await evaluate(`({ body: document.body.innerText.slice(-1200), marks: document.querySelectorAll('[aria-label="Pending redaction"]').length })`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}; exceptions=${exceptions.join(' | ')}`);
  }
  await clickTitle('Return to Read workspace');
  await clickTitle('Convert and export');
  await waitFor(`Boolean(document.querySelector('[data-pdf-convert-inspector]'))`, 'Convert workspace');
  await clickTitle('Run configured export');
  await waitFor(`document.querySelector('[data-pdf-convert-inspector]')?.getAttribute('data-conversion-status') === 'completed'`, 'PNG export', 45_000);
  for (const label of ['JPEG', 'WebP']) {
    const selected = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-pdf-convert-inspector] button')].find((entry) => entry.querySelector('strong')?.textContent === '${label}'); b?.click(); return Boolean(b); })()`);
    if (!selected) throw new Error(`${label} converter is unavailable.`);
    await clickTitle('Run configured export');
    await Bun.sleep(150);
    await waitFor(`document.querySelector('[data-pdf-convert-inspector]')?.getAttribute('data-conversion-status') === 'completed'`, `${label} export`, 45_000);
  }
  await waitFor(`true`, 'download flush');
  await Bun.sleep(500);
  const downloads = await readdir(downloadDir);
  const pngOutput = downloads.find((name) => name.endsWith('.png'));
  const jpegOutput = downloads.find((name) => name.endsWith('.jpg'));
  const webpOutput = downloads.find((name) => name.endsWith('.webp'));
  if (!pngOutput || !jpegOutput || !webpOutput) throw new Error(`Missing rendered exports: ${downloads.join(', ')}`);
  const [pngBytes, jpegBytes, webpBytes] = await Promise.all([readFile(join(downloadDir, pngOutput)), readFile(join(downloadDir, jpegOutput)), readFile(join(downloadDir, webpOutput))]);
  if (pngBytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('PNG export did not decode as a PNG artifact.');
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) throw new Error('JPEG export did not decode as a JPEG artifact.');
  if (webpBytes.toString('ascii', 0, 4) !== 'RIFF' || webpBytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('WebP export did not decode as a WebP artifact.');
  const imageChooserPromise = new Promise((resolve) => { fileChooserResolve = resolve; });
  await clickTitle('Create a new PDF from images');
  const imageChooser = await Promise.race([imageChooserPromise, Bun.sleep(5_000).then(() => { throw new Error('The image picker did not open.'); })]);
  await send('DOM.setFileInputFiles', { files: [join(downloadDir, pngOutput), join(downloadDir, jpegOutput), join(downloadDir, webpOutput)], backendNodeId: imageChooser.backendNodeId });
  await waitFor(`Boolean(document.querySelector('[data-pdf-image-import]'))`, 'image import review');
  await evaluate(`(() => { const button = [...document.querySelectorAll('[data-pdf-image-import] button')].find((entry) => entry.textContent?.includes('Create 3-page PDF')); button?.click(); return Boolean(button); })()`);
  try {
    await waitFor(`document.body.innerText.includes('Images.pdf') && document.body.innerText.includes('· 3')`, 'ordered image PDF session', 45_000);
  } catch (error) {
    const diagnostic = await evaluate(`({ body: document.body.innerText.slice(-1200), tabs: [...document.querySelectorAll('[role="tab"]')].map((entry) => entry.textContent) })`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}; exceptions=${exceptions.join(' | ')}`);
  }
  await clickTitle('Save As');
  await Bun.sleep(600);
  const imagePdfName = (await readdir(downloadDir)).find((name) => name === 'Images.pdf');
  if (!imagePdfName) throw new Error('Images-to-PDF output was not saved.');
  const imagePdf = await PDFDocument.load(await readFile(join(downloadDir, imagePdfName)));
  if (imagePdf.getPageCount() !== 3) throw new Error(`Images-to-PDF produced ${imagePdf.getPageCount()} pages instead of 3.`);
  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(' | ')}`);
  console.info(
    JSON.stringify({
      status: 'passed',
      workspace: 'Forms',
      document: 'rendered',
      field: 'real AcroForm text field committed',
      contentEdit: 'real page text committed',
      protect: 'real /Redact mark applied through affected-page raster replacement',
      convert: 'active document exported to independently identified PNG, JPEG, and WebP artifacts',
      imageImport: 'ordered PNG, JPEG, and WebP inputs independently reopened as a three-page PDF',
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
  let cleanupError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(runDir, { recursive: true, force: true });
      cleanupError = undefined;
      break;
    } catch (error) {
      cleanupError = error;
      await Bun.sleep(200);
    }
  }
  if (cleanupError) {
    console.error('PDF smoke fixture cleanup failed:', cleanupError);
    process.exitCode = 1;
  }
}
