import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, normalize, parse, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const executableInput = process.env.NAMMU_F5D_EXECUTABLE;
const helperInput = process.env.NAMMU_F5D_HELPER;
if (!executableInput) throw new Error('Set NAMMU_F5D_EXECUTABLE to the release executable.');
if (!helperInput) throw new Error('Set NAMMU_F5D_HELPER to the release protocol helper.');
const executable = resolve(executableInput);
const helperExecutable = resolve(helperInput);
await Promise.all([access(executable), access(helperExecutable)]);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const execFile = promisify(execFileCallback);
const workspaceRoot = resolve(process.cwd());
const fixtureRoot = join(workspaceRoot, `NammuFilesF5DTest-${randomUUID()}`);
const profileRoot = join(tmpdir(), `${basename(fixtureRoot)}-WebView2`);
const stage = (name) => console.info(`[f5d] ${name}`);
let outboundGesture = null;
const activeHelpers = new Set();

async function allocateDebugPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return rejectPort(new Error('No CDP port.'));
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
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
    close: () => socket.close(),
  };
}

async function waitForTarget(port) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const target = (await response.json()).find(
          (candidate) =>
            candidate.type === 'page' && /tauri\.localhost|tauri:\/\//.test(candidate.url),
        );
        if (target) return target;
      }
    } catch {}
    await delay(200);
  }
  throw new Error('Timed out waiting for packaged Nammu OS.');
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed.');
  return result.result?.value;
}

async function waitForValue(client, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(client, expression).catch(() => false);
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for packaged condition: ${expression}`);
}

const invoke = (client, command, args = {}) =>
  evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`,
  );

function value(response, operation) {
  if (response?.status !== 'success')
    throw new Error(
      `${operation}: ${response?.error?.code || 'INVALID_RESPONSE'} ${response?.error?.message || ''}`,
    );
  return response.value;
}

function helperProcess(request, expectReady = false) {
  const child = spawn(helperExecutable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  activeHelpers.add(child);
  const lines = createInterface({ input: child.stdout });
  const queue = [];
  const waiters = [];
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk.toString()));
  lines.on('line', (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      response = { ok: false, error: `Invalid helper output: ${error}` };
    }
    const waiter = waiters.shift();
    if (waiter) waiter(response);
    else queue.push(response);
  });
  const next = (timeoutMs = 20_000) =>
    Promise.race([
      new Promise((resolveResponse) => {
        if (queue.length > 0) resolveResponse(queue.shift());
        else waiters.push(resolveResponse);
      }),
      delay(timeoutMs).then(() => {
        throw new Error(
          `F5D helper timed out.${errors.length ? ` ${errors.join('').slice(-1_000)}` : ''}`,
        );
      }),
    ]);
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      activeHelpers.delete(child);
      resolveExit({ code, signal });
    });
  });
  child.stdin.end(JSON.stringify(request));
  return {
    child,
    async ready() {
      const response = await next();
      expect(
        expectReady && response.phase === 'ready' && response.ok,
        response.error || 'Helper was not ready.',
      );
      return response;
    },
    async result() {
      const response = await next();
      const exit = await exited;
      expect(exit.code === 0, `F5D helper exited with code ${exit.code}. ${errors.join('')}`);
      return { ...response, protocolDiagnostics: errors.join('').trim() };
    },
  };
}

async function runHelper(request) {
  const helper = helperProcess(request);
  return helper.result();
}

async function clipboardSequence() {
  const result = await runHelper({ mode: 'clipboard-sequence' });
  expect(
    result.ok && Number.isInteger(result.clipboardSequence),
    'Clipboard sequence unavailable.',
  );
  return result.clipboardSequence;
}

async function outbound(client, operation, paths, trigger) {
  const target = helperProcess({ mode: 'target', operation, ...outboundGesture }, true);
  await target.ready();
  const nativeResult = await trigger();
  const received = await target.result();
  expect(
    received.ok,
    `${received.error || 'Independent target rejected Nammu drag.'} Native result: ${JSON.stringify(nativeResult)}`,
  );
  expect(
    received.operation === operation,
    `Expected ${operation} effect, got ${received.operation}.`,
  );
  expect(
    JSON.stringify(received.paths) === JSON.stringify(paths),
    'Outbound CF_HDROP paths changed.',
  );
  return { nativeResult, received };
}

async function processSample(pid) {
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(($p.WorkingSet64.ToString())+','+($p.CPU.ToString([System.Globalization.CultureInfo]::InvariantCulture)+','+$p.HandleCount.ToString()+','+$p.Threads.Count.ToString()))`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const [workingSetBytes, cpuSeconds, handleCount, threadCount] = stdout
    .trim()
    .split(',')
    .map(Number);
  return { workingSetBytes, cpuSeconds, handleCount, threadCount };
}

async function createFixtures() {
  const inbound = join(fixtureRoot, 'Inbound Sources');
  await Promise.all([mkdir(fixtureRoot, { recursive: true }), mkdir(inbound, { recursive: true })]);
  const single = join(fixtureRoot, 'single file.txt');
  const unicode = join(fixtureRoot, 'नमस्ते 東京 🚀.txt');
  const folder = join(fixtureRoot, 'Folder with spaces');
  const archive = join(fixtureRoot, 'whole archive.zip');
  await mkdir(folder);
  await Promise.all([
    writeFile(single, 'single drag fixture'),
    writeFile(unicode, 'unicode drag fixture'),
    writeFile(join(folder, 'nested.txt'), 'folder drag fixture'),
    writeFile(archive, 'native archive fixture'),
  ]);
  let longDirectory = join(fixtureRoot, 'Long path');
  for (let index = 0; index < 7; index += 1) {
    longDirectory = join(longDirectory, `segment-${index}-external-drag-drop-validation`);
    await mkdir(longDirectory, { recursive: true });
  }
  const longFile = join(longDirectory, 'long drag file.txt');
  await writeFile(longFile, 'long path fixture');
  expect(longFile.length > 260, 'Long-path fixture did not exceed 260 characters.');
  const copySource = join(inbound, 'Explorer copy.txt');
  const moveSource = join(inbound, 'Explorer move.txt');
  const inboundUnicode = join(inbound, '\u5916\u90e8 r\u00e9sum\u00e9.txt');
  const inboundFolder = join(inbound, 'Explorer folder with spaces');
  await mkdir(inboundFolder);
  await Promise.all([
    writeFile(copySource, 'copy inbound'),
    writeFile(moveSource, 'move inbound'),
    writeFile(inboundUnicode, 'unicode inbound'),
    writeFile(join(inboundFolder, 'nested inbound.txt'), 'folder inbound'),
  ]);
  const thousandRoot = join(fixtureRoot, 'Thousand');
  await mkdir(thousandRoot);
  const thousand = Array.from({ length: 1_000 }, (_, index) =>
    join(thousandRoot, `item-${String(index).padStart(4, '0')}.txt`),
  );
  for (let offset = 0; offset < thousand.length; offset += 100) {
    await Promise.all(thousand.slice(offset, offset + 100).map((path) => writeFile(path, 'x')));
  }
  return {
    single,
    unicode,
    folder,
    archive,
    longFile,
    copySource,
    moveSource,
    inboundUnicode,
    inboundFolder,
    thousand,
  };
}

async function openFilesAt(client, path) {
  await waitForValue(
    client,
    `(() => { const button=document.querySelector('button[title^="Files"]'); button?.click(); return Boolean(button); })()`,
  );
  await waitForValue(
    client,
    `(() => { const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.includes('This PC')); button?.click(); return Boolean(button); })()`,
  );
  const root = parse(path).root;
  await waitForValue(
    client,
    `(() => { const root=${JSON.stringify(root)}; const card=[...document.querySelectorAll('button')].find((item)=>{const text=item.textContent||''; return text.includes(root)&&/local|fixed/i.test(text);}); card?.click(); return Boolean(card); })()`,
  );
  await waitForValue(
    client,
    `document.querySelector('main[data-native-file-drop-root]')?.dataset.nativeFileDropRoot===${JSON.stringify(root)}`,
  );
  let current = root;
  const parts = path
    .slice(root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    await waitForValue(
      client,
      `(() => { const path=${JSON.stringify(current)}; const item=[...document.querySelectorAll('button[data-native-file-drag-source]')].find((node)=>node.dataset.nativeFileDragSource===path); if(!item)return false; item.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return true; })()`,
    );
    await waitForValue(
      client,
      `document.querySelector('main[data-native-file-drop-root]')?.dataset.nativeFileDropRoot===${JSON.stringify(current)}`,
    );
  }
}

async function blankDropPoint(client) {
  return waitForValue(
    client,
    `(() => { const root=document.querySelector('main[data-native-file-drop-root]'); if(!root)return null; const rect=root.getBoundingClientRect(); const candidates=[[rect.left+rect.width/2,rect.top+rect.height/2],[rect.left+rect.width/2,rect.bottom-96],[rect.right-96,rect.top+rect.height/2]]; for(const [x,y] of candidates){ const node=document.elementFromPoint(x,y); if(node?.closest('[data-native-file-drop-root]')===root&&!node.closest('[data-native-file-drop-target]')) return {x:Math.round(x),y:Math.round(y),scale:window.devicePixelRatio||1}; } for(let y=rect.bottom-72;y>rect.top+40;y-=24){ for(let x=rect.right-72;x>rect.left+40;x-=24){ const node=document.elementFromPoint(x,y); if(node?.closest('[data-native-file-drop-root]')===root&&!node.closest('[data-native-file-drop-target]')) return {x:Math.round(x),y:Math.round(y),scale:window.devicePixelRatio||1}; }} return null; })()`,
  );
}

async function sourceDragPoint(client, path) {
  return waitForValue(
    client,
    `(() => { const path=${JSON.stringify(path)}; const item=[...document.querySelectorAll('[data-native-file-drag-source]')].find((node)=>node.dataset.nativeFileDragSource===path); if(!item)return null; const rect=item.getBoundingClientRect(); return {client_x:Math.round(rect.left+Math.min(20,rect.width/2)),client_y:Math.round(rect.top+Math.min(20,rect.height/2)),scale:window.devicePixelRatio||1}; })()`,
  );
}

async function inbound(client, processId, point, operation, paths) {
  const started = performance.now();
  const response = await runHelper({
    mode: 'source',
    process_id: processId,
    client_x: point.x,
    client_y: point.y,
    scale: point.scale,
    operation,
    paths,
  });
  if (!response.ok) {
    const domEvents = await evaluate(client, 'window.__nammuF5dDomDrops || []').catch(() => []);
    const diagnostics = value(
      await invoke(client, 'get_native_file_drag_drop_diagnostics'),
      'failed inbound diagnostics',
    );
    throw new Error(
      `${response.error || `Inbound ${operation} was rejected.`} Helper: ${response.protocolDiagnostics || 'none'} DOM: ${JSON.stringify(domEvents)} Diagnostics: ${JSON.stringify(diagnostics)} Runtime: ${runtimeOutput.join('').slice(-20_000)}`,
    );
  }
  return {
    durationMs: performance.now() - started,
    reportedEffect: response.operation,
  };
}

async function waitForFile(path, shouldExist = true, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exists = await access(path).then(
      () => true,
      () => false,
    );
    if (exists === shouldExist) return;
    await delay(100);
  }
  throw new Error(`${path} did not reach expected existence=${shouldExist}.`);
}

async function lingeringProcesses(parentId) {
  const exe = executable.replaceAll("'", "''");
  const helper = helperExecutable.replaceAll("'", "''");
  const command = `$parent=${Number(parentId)};$exe='${exe}';$helper='${helper}';@(Get-CimInstance Win32_Process|Where-Object{$_.ProcessId-ne $PID-and($_.ParentProcessId-eq $parent-or$_.ExecutablePath-eq$helper-or$_.ExecutablePath-eq$exe)}|Select-Object ProcessId,ParentProcessId,Name,ExecutablePath)|ConvertTo-Json -Compress`;
  const { stdout } = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
  ]);
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

async function stopAcceptanceProcessTree(parentId) {
  if (!Number.isInteger(parentId) || parentId <= 0) return;
  const command = `$root=${parentId};$all=@(Get-CimInstance Win32_Process);$ids=New-Object System.Collections.Generic.HashSet[int];[void]$ids.Add($root);do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and-not $ids.Contains([int]$p.ProcessId)){[void]$ids.Add([int]$p.ProcessId);$added=$true}}}while($added);$ordered=@($all|Where-Object{$ids.Contains([int]$_.ProcessId)}|Sort-Object ProcessId -Descending);foreach($p in $ordered){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue}`;
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
}

await mkdir(profileRoot, { recursive: true });
const fixture = await createFixtures();
const beforeClipboard = await clipboardSequence();
const debugPort = await allocateDebugPort();
let child;
let client;
let report;
const runtimeOutput = [];
try {
  stage('launch packaged runtime');
  child = spawn(executable, [], {
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
  let target;
  try {
    target = await waitForTarget(debugPort);
  } catch (error) {
    throw new Error(`${error.message} Runtime: ${runtimeOutput.join('').slice(-2_000)}`);
  }
  client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  await waitForValue(client, "typeof window.__TAURI_INTERNALS__?.invoke === 'function'");
  await openFilesAt(client, fixtureRoot);
  stage('Files opened at disposable fixture');
  outboundGesture = {
    process_id: child.pid,
    ...(await sourceDragPoint(client, fixture.single)),
  };
  const baseline = await processSample(child.pid);
  value(
    await invoke(client, 'get_native_file_drag_drop_diagnostics'),
    'drag diagnostics',
  );
  stage('Tauri/WebView2 inbound drop target active');

  stage('outbound one-path COPY');
  const onePath = await outbound(client, 'copy', [fixture.single], async () =>
    value(
      await invoke(client, 'start_native_file_drag', {
        operation: 'copy',
        paths: [fixture.single],
      }),
      'one-path outbound drag',
    ),
  );
  expect(
    onePath.nativeResult.dropped,
    `One-path native OLE drag did not complete: ${JSON.stringify(onePath)}.`,
  );

  stage('outbound mixed COPY');
  const mixedPaths = [fixture.folder, fixture.unicode, fixture.longFile, fixture.archive];
  const mixed = await outbound(client, 'copy', mixedPaths, async () =>
    value(
      await invoke(client, 'start_native_file_drag', { operation: 'copy', paths: mixedPaths }),
      'mixed outbound drag',
    ),
  );
  expect(
    mixed.nativeResult.dropped && mixed.nativeResult.itemCount === 4,
    'Mixed native drag failed.',
  );
  stage('outbound MOVE intent');
  const moveIntent = await outbound(client, 'move', [fixture.single], async () =>
    value(
      await invoke(client, 'start_native_file_drag', {
        operation: 'move',
        paths: [fixture.single],
      }),
      'move outbound drag',
    ),
  );
  expect(moveIntent.nativeResult.operation === 'move', 'Nammu did not publish MOVE intent.');
  expect(
    (await stat(fixture.single)).isFile(),
    'Outbound MOVE mutated its source before recipient paste.',
  );

  stage('outbound 1,000 paths');
  const thousand = await outbound(client, 'copy', fixture.thousand, async () =>
    value(
      await invoke(client, 'start_native_file_drag', {
        operation: 'copy',
        paths: fixture.thousand,
      }),
      '1000-path outbound drag',
    ),
  );
  expect(thousand.nativeResult.itemCount === 1_000, '1,000-path drag was truncated.');

  stage('inbound COPY to F2A');
  const copyDropPoint = await blankDropPoint(client);
  const copyInbound = await inbound(
    client,
    child.pid,
    copyDropPoint,
    'copy',
    [fixture.copySource],
  );
  const copiedPath = join(fixtureRoot, basename(fixture.copySource));
  await waitForFile(copiedPath);
  expect((await readFile(copiedPath, 'utf8')) === 'copy inbound', 'Inbound copy content mismatch.');
  expect((await stat(fixture.copySource)).isFile(), 'COPY removed its source.');

  stage('inbound mixed folder/Unicode/long-path COPY');
  await inbound(client, child.pid, await blankDropPoint(client), 'copy', [
    fixture.inboundFolder,
    fixture.inboundUnicode,
    fixture.longFile,
  ]);
  await Promise.all([
    waitForFile(join(fixtureRoot, basename(fixture.inboundFolder), 'nested inbound.txt')),
    waitForFile(join(fixtureRoot, basename(fixture.inboundUnicode))),
    waitForFile(join(fixtureRoot, basename(fixture.longFile))),
  ]);
  expect((await stat(fixture.inboundFolder)).isDirectory(), 'Mixed COPY removed its folder.');
  expect((await stat(fixture.inboundUnicode)).isFile(), 'Mixed COPY removed its Unicode file.');
  expect((await stat(fixture.longFile)).isFile(), 'Mixed COPY removed its long-path file.');

  stage('inbound MOVE to F2A');
  const moveInbound = await inbound(
    client,
    child.pid,
    await blankDropPoint(client),
    'move',
    [fixture.moveSource],
  );
  const movedPath = join(fixtureRoot, basename(fixture.moveSource));
  await waitForFile(movedPath);
  await waitForFile(fixture.moveSource, false);
  expect((await readFile(movedPath, 'utf8')) === 'move inbound', 'Inbound move content mismatch.');

  stage('30-cycle OLE lifecycle');
  const lifecycleBefore = value(
    await invoke(client, 'get_native_file_drag_drop_diagnostics'),
    'lifecycle baseline',
  );
  for (let index = 0; index < 30; index += 1) {
    await outbound(client, index % 2 === 0 ? 'copy' : 'move', [fixture.single], async () =>
      value(
        await invoke(client, 'start_native_file_drag', {
          operation: index % 2 === 0 ? 'copy' : 'move',
          paths: [fixture.single],
        }),
        `lifecycle drag ${index}`,
      ),
    );
  }
  await delay(1_000);
  const diagnostics = value(
    await invoke(client, 'get_native_file_drag_drop_diagnostics'),
    'final drag diagnostics',
  );
  expect(diagnostics.activeInboundSessions === 0, 'Inbound OLE session leaked.');
  expect(diagnostics.activeOutboundSessions === 0, 'Outbound OLE session leaked.');
  expect(
    diagnostics.outboundDropped - lifecycleBefore.outboundDropped === 30,
    'Lifecycle drags did not all complete.',
  );
  const afterWork = await processSample(child.pid);
  await delay(2_000);
  const afterIdle = await processSample(child.pid);
  const afterClipboard = await clipboardSequence();
  expect(
    afterClipboard === beforeClipboard,
    'F5D changed the Windows clipboard; acceptance failed closed.',
  );
  stage('acceptance assertions complete');

  report = {
    protocol: {
      outboundCfHdrop: true,
      inboundCfHdrop: true,
      copyEffect: copyInbound.reportedEffect === 'copy',
      moveEffect: moveInbound.reportedEffect === 'move',
      moveIntentExecuted: true,
      unicode: true,
      spaces: true,
      folders: true,
      longPathOver260: true,
      nativeZip: true,
      thousandPaths: true,
      archiveVirtualEntriesExported: false,
    },
    integration: {
      filesUiSelectionToNativeTarget: 'focused-contract-test',
      independentTargetConsumedNammu: true,
      independentSourceDroppedIntoNammu: true,
      inboundUsesExistingF2A: true,
      internalClipboardMutated: false,
      realExplorerUi: 'manual-smoke-required',
    },
    timingMs: {
      prepareOne: Number((moveIntent.nativeResult.prepareDurationMs || 0).toFixed(3)),
      prepareThousand: Number((thousand.nativeResult.prepareDurationMs || 0).toFixed(3)),
      inboundCopyDropToCompletion: Number(copyInbound.durationMs.toFixed(3)),
      inboundMoveDropToCompletion: Number(moveInbound.durationMs.toFixed(3)),
    },
    process: {
      baseline,
      afterWork,
      afterIdle,
      workingSetDeltaBytes: afterIdle.workingSetBytes - baseline.workingSetBytes,
      handleDelta: afterIdle.handleCount - baseline.handleCount,
      threadDelta: afterIdle.threadCount - baseline.threadCount,
      idleCpuSeconds: Number((afterIdle.cpuSeconds - afterWork.cpuSeconds).toFixed(4)),
    },
    diagnostics,
    lifecycleCycles: 30,
    clipboardSequence: { before: beforeClipboard, after: afterClipboard, unchanged: true },
    userFilesRead: false,
  };
} finally {
  for (const helper of activeHelpers) {
    if (helper.exitCode === null) helper.kill('SIGTERM');
  }
  if (client) {
    await client
      .send('Runtime.evaluate', {
        expression: `void window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'})`,
        awaitPromise: false,
      })
      .catch(() => {});
    client.close();
  }
  if (child?.exitCode === null) {
    const exited = await Promise.race([
      new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
      delay(10_000).then(() => false),
    ]);
    if (!exited && child.exitCode === null) await stopAcceptanceProcessTree(child.pid);
  }
  const root = normalize(resolve(fixtureRoot));
  const profile = normalize(resolve(profileRoot));
  const approvedBase = `${normalize(workspaceRoot)}\\`;
  const approvedProfileBase = `${normalize(resolve(tmpdir()))}\\`;
  expect(
    root.startsWith(approvedBase) && basename(root).startsWith('NammuFilesF5DTest-'),
    'Refusing fixture cleanup outside F5D temp root.',
  );
  expect(
    profile.startsWith(approvedProfileBase) && basename(profile).endsWith('-WebView2'),
    'Refusing profile cleanup outside F5D temp root.',
  );
  await rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  await rm(profile, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  await delay(300);
  if (child?.pid) {
    const lingering = await lingeringProcesses(child.pid);
    expect(lingering.length === 0, `F5D left orphan processes: ${JSON.stringify(lingering)}`);
  }
}

console.info(JSON.stringify({ ...report, remainingFixtures: 0, remainingProcesses: 0 }, null, 2));
