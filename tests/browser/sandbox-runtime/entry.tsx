import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { packNapp } from '../../../src/platform/nmu/nappArchive';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { getNMUEngine } from '../../../src/platform/nmu/nmuEngine';
import { getNammuVFS } from '../../../src/platform/vfs/nammuVFS';
import type { NammuAppManifest } from '../../../src/platform/nmu/nappSpec';

declare global {
  interface Window {
    __sandboxAcceptance?: Record<string, unknown>;
    __removeFirstSandbox?: () => void;
  }
}

const manifest: NammuAppManifest = {
  manifestVersion: 1,
  id: 'dev.nammu.browser-acceptance',
  name: 'Browser Acceptance',
  version: '1.0.0',
  runtime: 'web',
  entry: 'app/index.html',
  minNammuVersion: '0.8.0',
  dataSchemaVersion: 1,
  permissions: ['filesystem.appdata.read', 'filesystem.appdata.write', 'notifications.send'],
};

const main = `
(async function () {
  const transport = window.__NAMMU_IPC_TRANSPORT__;
  let id = 0;
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      const requestId = 'browser_' + (++id);
      const remove = transport.onMessage(function (message) {
        if (message && message.id === requestId) {
          remove();
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
      });
      transport.send({ id: requestId, method: method, params: params || {} });
    });
  }
  console.log('sandbox: title');
  await call('window.setTitle', { title: 'Sandbox Ready' });
  console.log('sandbox: settings');
  await call('settings.set', { key: 'browserAcceptance', value: true });
  console.log('sandbox: file');
  await call('files.writeText', { path: 'acceptance.txt', content: 'persisted' });
  console.log('sandbox: notification');
  await call('notifications.send', { title: 'Sandbox', body: 'Delivered' });
  console.log('sandbox: ready');
  await call('app.ready', {});
  document.body.dataset.ready = 'true';
})();`;

const encoder = new TextEncoder();
const packageBytes = packNapp([
  { path: 'nammu.app.json', data: encoder.encode(JSON.stringify(manifest)) },
  {
    path: 'app/index.html',
    data: encoder.encode('<!doctype html><body><script src="main.js"></script></body>'),
  },
  { path: 'app/main.js', data: encoder.encode(main) },
]);

function Harness() {
  const [showFirst, setShowFirst] = useState(true);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState(0);
  window.__removeFirstSandbox = () => setShowFirst(false);
  window.__sandboxAcceptance = { titles, notifications, showFirst };
  const host = (windowId: string) => (
    <AppSandboxHost
      key={windowId}
      appId={manifest.id}
      windowId={windowId}
      onTitleChange={(title) => setTitles((current) => ({ ...current, [windowId]: title }))}
      onNotification={() => setNotifications((count) => count + 1)}
    />
  );
  return (
    <main>
      {showFirst && host('window-one')}
      {host('window-two')}
    </main>
  );
}

async function start() {
  const engine = getNMUEngine();
  await engine.ready();
  if (!(await getNMUDatabase().getApp(manifest.id))) {
    await engine.install(packageBytes, { approvedPermissions: ['notifications.send'] });
  }
  createRoot(document.getElementById('root')!).render(<Harness />);
  const interval = window.setInterval(async () => {
    const state = window.__sandboxAcceptance ?? {};
    try {
      const scoped = getNammuVFS().createScopedVFS(manifest.id);
      const settings = JSON.parse(await scoped.readUserDataText('settings.json'));
      const file = await scoped.readUserDataText('acceptance.txt');
      const app = await getNMUDatabase().getApp(manifest.id);
      Object.assign(state, { settings, file, appState: app?.state });
      if (Object.keys((state.titles as object) ?? {}).length === 2 && state.notifications === 2) {
        Object.assign(state, { ready: true });
        window.clearInterval(interval);
      }
    } catch {}
  }, 20);
}

void start();
