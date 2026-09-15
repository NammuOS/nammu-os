import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppStoreApp } from '../../../src/components/app-store/AppStoreApp';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { getNMUEngine } from '../../../src/platform/nmu/nmuEngine';
import { getNammuVFS } from '../../../src/platform/vfs/nammuVFS';

interface BrowserRemoteAcceptanceState {
  browserVisible: boolean;
  packageRequests: number;
  record: Awaited<ReturnType<ReturnType<typeof getNMUDatabase>['getApp']>>;
  settings: Record<string, unknown> | null;
}

declare global {
  interface Window {
    __browserRemoteAcceptance?: Partial<BrowserRemoteAcceptanceState>;
    __closeAcceptedBrowser?: () => void;
  }
}

const PACKAGE_ROUTE = '/api/app-store/packages/os.nammu.browser/1.0.1';
const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(raw, window.location.href).pathname === PACKAGE_ROUTE) {
    const state = (window.__browserRemoteAcceptance ??= {});
    state.packageRequests = (state.packageRequests ?? 0) + 1;
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

if (!(await getNMUDatabase().getApp('os.nammu.browser'))) {
  const previousResponse = await nativeFetch('/fixture-browser-v100');
  if (!previousResponse.ok) throw new Error('Unable to seed immutable Browser v1.0.0.');
  await getNMUEngine().install(new Uint8Array(await previousResponse.arrayBuffer()), {
    sourceRegistry: 'official',
    sourceUrl:
      'https://github.com/NammuOS/nammu-browser/releases/download/v1.0.0/os.nammu.browser-1.0.0-signed.napp',
    approvedPermissions: [
      'filesystem.user-selected.read',
      'filesystem.user-selected.write',
      'clipboard.read',
      'clipboard.write',
      'migration.legacy-storage',
      'integration.web-surfaces',
      'integration.services',
      'window.manage',
    ],
  });
}

function Harness() {
  const [browserVisible, setBrowserVisible] = useState(false);

  useEffect(() => {
    const openInstalledApp = (event: Event) => {
      if ((event as CustomEvent<{ appId?: string }>).detail?.appId === 'os.nammu.browser') {
        setBrowserVisible(true);
      }
    };
    window.addEventListener('nammu-open-app', openInstalledApp);
    return () => window.removeEventListener('nammu-open-app', openInstalledApp);
  }, []);

  useEffect(() => {
    window.__closeAcceptedBrowser = () => setBrowserVisible(false);
    Object.assign((window.__browserRemoteAcceptance ??= {}), { browserVisible });
  }, [browserVisible]);

  return (
    <main style={{ width: '100%', height: '100%', position: 'relative' }}>
      <AppStoreApp initialAppId="os.nammu.browser" />
      {browserVisible && (
        <section
          data-acceptance-browser
          style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#080808' }}
        >
          <AppSandboxHost
            appId="os.nammu.browser"
            windowId="browser-remote-store-acceptance"
            title="Browser"
            onClose={() => setBrowserVisible(false)}
          />
        </section>
      )}
    </main>
  );
}

async function observeState() {
  const database = getNMUDatabase();
  const storage = getNammuVFS().createScopedVFS('os.nammu.browser');
  let observing = false;
  window.setInterval(async () => {
    if (observing) return;
    observing = true;
    try {
      const record = await database.getApp('os.nammu.browser');
      let settings: Record<string, unknown> | null = null;
      try {
        settings = JSON.parse(await storage.readUserDataText('settings.json'));
      } catch {}
      Object.assign((window.__browserRemoteAcceptance ??= {}), { record, settings });
    } finally {
      observing = false;
    }
  }, 40);
}

createRoot(document.querySelector('#root')!).render(<Harness />);
void observeState();
