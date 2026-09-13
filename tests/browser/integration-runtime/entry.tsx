import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { getNMUEngine } from '../../../src/platform/nmu/nmuEngine';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { createSignedHelloNammuPackage } from '../../fixtures/helloNammuFixture';

declare global {
  interface Window {
    __integrationAcceptance?: Record<string, unknown>;
    __closeIntegrationFixture?: () => void;
  }
}

const appId = 'dev.nammu.integration-acceptance';
const main = `
(async function () {
  var transport = window.__NAMMU_IPC_TRANSPORT__;
  var pending = new Map();
  var counter = 0;
  transport.onMessage(function (message) {
    if (!message || !message.id || !pending.has(message.id)) return;
    var request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = 'b0_' + (++counter);
      pending.set(id, { resolve: resolve, reject: reject });
      transport.send({ id: id, method: method, params: params || {} });
    });
  }
  try {
    var lifecycle = await call('lifecycle.getState');
    var service = await call('services.request', {
      service: 'core.runtime', operation: 'describe'
    });
    var asset = await call('assets.read', { path: 'runtime/worker.js' });
    var wasm = await call('assets.read', { path: 'runtime/module.wasm' });
    await WebAssembly.compile(wasm.bytes);
    var workerUrl = URL.createObjectURL(new Blob([asset.bytes], { type: 'text/javascript' }));
    var workerResult = await new Promise(function (resolve, reject) {
      var worker = new Worker(workerUrl);
      worker.onmessage = function (event) { worker.terminate(); resolve(event.data); };
      worker.onerror = function (event) { worker.terminate(); reject(new Error(event.message)); };
    });
    URL.revokeObjectURL(workerUrl);
    var surface = await call('webSurfaces.create', {
      capability: 'primary', profileKey: 'acceptance',
      url: 'https://example.com/',
      bounds: { x: 10, y: 10, width: 320, height: 180 }, visible: true
    });
    await call('webSurfaces.navigate', {
      id: surface.id, capability: 'primary', url: 'https://example.com/accepted'
    });
    var surfaceState = await call('webSurfaces.getState', { id: surface.id });
    var secondSurface = await call('webSurfaces.create', {
      capability: 'primary', profileKey: 'acceptance',
      url: 'https://example.com/second',
      bounds: { x: 10, y: 10, width: 320, height: 180 }, visible: false
    });
    await call('webSurfaces.setVisible', { id: surface.id, visible: false });
    await call('webSurfaces.setVisible', { id: secondSurface.id, visible: true });
    window.parent.postMessage({
      type: 'b0:accepted',
      payload: {
        lifecycle: lifecycle,
        service: service.data,
        assetSize: asset.size,
        wasmSize: wasm.size,
        workerReady: workerResult.ready === true,
        navigationReported: surfaceState.url === 'https://example.com/accepted',
        surfaceIdIsOpaque: /^surface_[a-f0-9]{32}$/.test(surface.id)
          && /^surface_[a-f0-9]{32}$/.test(secondSurface.id)
          && surface.id !== secondSurface.id
      }
    }, '*');
    await call('app.ready');
  } catch (error) {
    window.parent.postMessage({ type: 'b0:error', message: String(error && error.message || error) }, '*');
  }
})();`;

async function buildPackage() {
  return createSignedHelloNammuPackage({
    appId,
    runtime: 'integration',
    entry: 'app/integration.html',
    permissions: ['integration.web-surfaces', 'integration.services'],
    capabilities: [
      { type: 'service', name: 'core.runtime' },
      {
        type: 'web-surface',
        name: 'primary',
        navigation: { mode: 'approved-origins', origins: ['https://example.com'] },
        maxSurfaces: 2,
      },
    ],
    customFiles: {
      'app/integration.html': '<!doctype html><body><script src="integration.js"></script></body>',
      'app/integration.js': main,
      'runtime/worker.js': 'postMessage({ ready: true })',
      'runtime/module.wasm': '\0asm\u0001\0\0\0',
    },
  });
}

function Harness() {
  const [open, setOpen] = useState(true);
  window.__closeIntegrationFixture = () => setOpen(false);
  return open ? <AppSandboxHost appId={appId} windowId="b0-fixture" /> : <div>closed</div>;
}

async function start() {
  const engine = getNMUEngine();
  if (await getNMUDatabase().getApp(appId)) {
    await engine.uninstall(appId, { purgeUserData: true, purgeCache: true });
  }
  await engine.install(await buildPackage(), {
    approvedPermissions: ['integration.web-surfaces', 'integration.services'],
  });
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'b0:accepted') {
      window.__integrationAcceptance = { ready: true, ...event.data.payload };
    } else if (event.data?.type === 'b0:error') {
      window.__integrationAcceptance = { error: event.data.message };
    }
  });
  createRoot(document.getElementById('root')!).render(<Harness />);
}

void start();
