import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

/* global Bun */

const baseUrl = process.argv[2] || 'http://localhost:3000';
const browserCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
].filter(Boolean);
let edgePath;
for (const candidate of browserCandidates) {
  try { await access(candidate); edgePath = candidate; break; } catch {}
}
if (!edgePath) throw new Error('A Chromium browser is required for the rendered OCR smoke test.');
const runDir = join(tmpdir(), `nammu-pdf-ocr-smoke-${process.pid}`);
const profileDir = join(runDir, 'edge-profile');
const downloadDir = join(runDir, 'downloads');
const fixturePath = join(runDir, 'scanned-ocr-fixture.pdf');
const debugPort = 9700 + (process.pid % 200);

const reachable = async () => { try { return (await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; } };
let localServer;
if (!(await reachable())) {
  localServer = Bun.spawn(['node', 'server.mjs', '--dev'], { cwd: process.cwd(), stdout: 'ignore', stderr: 'ignore' });
  for (let attempt = 0; attempt < 120 && !(await reachable()); attempt += 1) await Bun.sleep(250);
  if (!(await reachable())) throw new Error('Nammu development server did not become ready.');
}

await mkdir(downloadDir, { recursive: true });
const scan = await sharp(Buffer.from(`<svg width="1224" height="1584" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="120" y="360" font-family="Arial" font-size="74" fill="black">NAMMU OCR VERIFIED 4827</text><text x="120" y="480" font-family="Arial" font-size="48" fill="black">Persistent searchable document</text></svg>`)).png().toBuffer();
const fixture = await PDFDocument.create();
const image = await fixture.embedPng(scan);
for (let page = 0; page < 10; page += 1)
  fixture.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
await writeFile(fixturePath, await fixture.save());

const edge = Bun.spawn([edgePath, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${debugPort}`, 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
let socket;
const exceptions = [];
const consoleMessages = [];
try {
  let targets;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); if (targets.some((target) => target.type === 'page')) break; } catch {}
    await Bun.sleep(100);
  }
  const target = targets?.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Edge DevTools target did not become ready.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let messageId = 0;
  let chooserResolve;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled') consoleMessages.push(message.params.args.map((argument) => argument.value ?? argument.description).join(' '));
    if (message.method === 'Log.entryAdded') consoleMessages.push(message.params.entry.text);
    if (message.method === 'Page.fileChooserOpened') chooserResolve?.(message.params);
  };
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('DevTools connection timed out.')), 5_000); socket.onopen = () => { clearTimeout(timeout); resolve(); }; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++messageId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 90_000);
    pending.set(id, (message) => { clearTimeout(timeout); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 120_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await Bun.sleep(150); }
    const body = await evaluate('document.body.innerText.slice(-1200)');
    throw new Error(`Timed out waiting for ${label}: ${body}; console=${consoleMessages.slice(-20).join(' | ')}`);
  };
  const clickTitle = async (title) => {
    const point = await evaluate(`(() => { const rect = document.querySelector('button[title="${title}"]')?.getBoundingClientRect(); return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null; })()`);
    if (!point) throw new Error(`${title} is unavailable.`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Log.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Page.navigate', { url: `${baseUrl}/apps/pdf` });
  await waitFor(`Boolean(document.querySelector('[data-testid="nammu-pdf-workspace"]'))`, 'Nammu PDF');
  console.info('OCR smoke: shell ready');
  const chooser = new Promise((resolve) => { chooserResolve = resolve; });
  await clickTitle('Open PDF');
  const selected = await Promise.race([chooser, Bun.sleep(5_000).then(() => { throw new Error('PDF picker did not open.'); })]);
  await send('DOM.setFileInputFiles', { files: [fixturePath], backendNodeId: selected.backendNodeId });
  await waitFor(`Boolean(document.querySelector('[data-pdf-page="1"] canvas'))`, 'scanned page');
  console.info('OCR smoke: fixture rendered');
  await clickTitle('Recognize scanned pages');
  await waitFor(`Boolean(document.querySelector('[data-pdf-ocr-inspector]'))`, 'OCR workspace');
  await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'View').click()`);
  await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes('Actual Size'))`, 'View menu');
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Actual Size')).click()`);
  await waitFor(`document.body.innerText.includes('100%')`, 'source actual-size render');
  await evaluate(`(() => { const canvas = document.querySelector('[data-pdf-page="1"] canvas'); const context = canvas.getContext('2d'); window.__nammuOcrOriginal = { width: canvas.width, height: canvas.height, pixels: new Uint8ClampedArray(context.getImageData(0, 0, canvas.width, canvas.height).data) }; })()`);
  console.info('OCR smoke: workspace ready');
  await clickTitle('Recognize scanned pages');
  const recognitionStartedAt = performance.now();
  await waitFor(`document.querySelector('[data-pdf-ocr-inspector]')?.getAttribute('data-ocr-status') === 'completed'`, 'real OCR completion', 120_000);
  const recognitionMs = Math.round(performance.now() - recognitionStartedAt);
  console.info('OCR smoke: recognition completed');
  const ocrResourcesAreLocal = await evaluate(`performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/ocr/')).every((entry) => new URL(entry.name).origin === location.origin)`);
  if (!ocrResourcesAreLocal) throw new Error('OCR loaded a runtime asset from outside the current Nammu origin.');
  const recognized = await evaluate(`document.querySelector('[data-pdf-ocr-inspector]')?.innerText.includes('NAMMU OCR VERIFIED 4827')`);
  if (!recognized) throw new Error('Known scanned text was not recognized.');
  await waitFor(`!document.querySelector('button[title="Create a searchable PDF copy"]')?.disabled`, 'searchable-copy command readiness');
  const searchableStartedAt = performance.now();
  await evaluate(`document.querySelector('button[title="Create a searchable PDF copy"]').click()`);
  await waitFor(`document.body.innerText.includes('scanned-ocr-fixture-searchable.pdf') || Boolean(document.querySelector('[data-testid="nammu-pdf-error"]'))`, 'searchable document result', 30_000);
  const searchableError = await evaluate(`document.querySelector('[data-testid="nammu-pdf-error"]')?.innerText`);
  if (searchableError) throw new Error(`Searchable-copy creation failed: ${searchableError}`);
  const searchableConstructionMs = Math.round(performance.now() - searchableStartedAt);
  await waitFor(`document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.includes('scanned-ocr-fixture-searchable.pdf')`, 'searchable document activation');
  await waitFor(`Boolean(document.querySelector('[data-pdf-page="1"] canvas'))`, 'searchable page render');
  await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'View').click()`);
  await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes('Actual Size'))`, 'View menu for searchable copy');
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Actual Size')).click()`);
  await waitFor(`document.body.innerText.includes('100%')`, 'searchable actual-size render');
  await waitFor(`(() => { const canvas = document.querySelector('[data-pdf-page="1"] canvas'); return canvas.width === window.__nammuOcrOriginal.width && canvas.height === window.__nammuOcrOriginal.height; })()`, 'matching searchable render dimensions');
  await Bun.sleep(250);
  const visualDifference = await evaluate(`(() => { const canvas = document.querySelector('[data-pdf-page="1"] canvas'); const current = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; const original = window.__nammuOcrOriginal.pixels; let changed = 0; let totalDifference = 0; for (let index = 0; index < current.length; index += 4) { const difference = Math.abs(current[index] - original[index]) + Math.abs(current[index + 1] - original[index + 1]) + Math.abs(current[index + 2] - original[index + 2]); totalDifference += difference; if (difference > 6) changed += 1; } return { changedFraction: changed / (current.length / 4), meanChannelDifference: totalDifference / (current.length / 4) / 3 }; })()`);
  if (visualDifference.changedFraction > 0.005 || visualDifference.meanChannelDifference > 0.5)
    throw new Error(`Invisible OCR layer changed the rendered page appearance: ${JSON.stringify(visualDifference)}`);
  await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Edit').click()`);
  await waitFor(`[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes('Find in Document'))`, 'Edit menu');
  await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('Find in Document')).click()`);
  await waitFor(`Boolean(document.querySelector('input[placeholder="Find in document"]'))`, 'Find field');
  await evaluate(`(() => { const input = document.querySelector('input[placeholder="Find in document"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'VERIFIED'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`document.body.innerText.toUpperCase().includes('1 MATCH')`, 'searchable text match');
  await clickTitle('Save As');
  await waitFor(`true`, 'download'); await Bun.sleep(1_000);
  const outputName = (await readdir(downloadDir)).find((name) => name.endsWith('-searchable.pdf'));
  if (!outputName) throw new Error('Searchable PDF was not saved.');
  const output = await readFile(join(downloadDir, outputName));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reopened = await pdfjs.getDocument({ data: new Uint8Array(output), isEvalSupported: false }).promise;
  if (reopened.numPages !== 10) throw new Error(`Searchable output changed the page count to ${reopened.numPages}.`);
  const content = await (await reopened.getPage(1)).getTextContent();
  await reopened.destroy();
  const independentText = content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ');
  if (!independentText.includes('VERIFIED')) throw new Error(`Independent PDF.js extraction failed: ${independentText}`);
  if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join(' | ')}`);
  console.info(JSON.stringify({ status: 'passed', engine: 'Tesseract.js 7 local assets', pages: 10, recognized: 'NAMMU OCR VERIFIED 4827', recognitionMs, searchableConstructionMs, searchablePdf: true, independentExtraction: true, visualFidelity: visualDifference, browserExceptions: 0 }));
} finally {
  socket?.close(); edge.kill(); await Promise.race([edge.exited, Bun.sleep(5_000)]).catch(() => undefined);
  if (localServer) { localServer.kill('SIGTERM'); await Promise.race([localServer.exited, Bun.sleep(5_000)]).catch(() => undefined); if (localServer.exitCode === null) localServer.kill('SIGKILL'); }
  await rm(runDir, { recursive: true, force: true }).catch((error) => { console.error('OCR smoke cleanup failed:', error); process.exitCode = 1; });
}

process.exit(process.exitCode ?? 0);
