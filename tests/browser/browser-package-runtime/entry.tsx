import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { getNMUEngine } from '../../../src/platform/nmu/nmuEngine';
import { getNammuVFS } from '../../../src/platform/vfs/nammuVFS';

declare const __BROWSER_NAPP_BASE64__: string;

declare global {
  interface Window {
    __browserAcceptance?: Record<string, unknown>;
    __toggleBrowser?: () => void;
  }
}

function decodePackage(encoded: string): Uint8Array {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function Harness() {
  const [visible, setVisible] = useState(true);
  window.__toggleBrowser = () => setVisible((current) => !current);
  return visible ? (
    <main style={{ width: '100vw', height: '100vh' }}>
      <AppSandboxHost appId="os.nammu.browser" windowId="browser-package-acceptance" />
    </main>
  ) : null;
}

async function start() {
  localStorage.setItem(
    'nammu_browser_bookmarks',
    JSON.stringify([{ id: 'legacy', title: 'Legacy bookmark', url: 'https://example.com/' }]),
  );
  localStorage.setItem(
    'nammu_browser_preferences',
    JSON.stringify({ searchEngine: 'duckduckgo', showBookmarksBar: true, defaultZoom: 110 }),
  );
  localStorage.setItem('nammu_browser_history', '[]');
  localStorage.setItem('nammu_browser_new_tab_workspace_v1', '');

  await getNMUEngine().install(decodePackage(__BROWSER_NAPP_BASE64__), {
    sourceRegistry: 'official',
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
  createRoot(document.querySelector('#root')!).render(<Harness />);

  const data = getNammuVFS().createScopedVFS('os.nammu.browser');
  window.setInterval(async () => {
    try {
      const record = await getNMUDatabase().getApp('os.nammu.browser');
      let settings: unknown = null;
      try {
        settings = JSON.parse(await data.readUserDataText('settings.json'));
      } catch {}
      window.__browserAcceptance = {
        ready: record?.state === 'Installed',
        signatureVerified: record?.signatureVerified,
        legacyRemoved: [
          'nammu_browser_bookmarks',
          'nammu_browser_preferences',
          'nammu_browser_history',
          'nammu_browser_new_tab_workspace_v1',
        ].every((key) => localStorage.getItem(key) === null),
        settings,
      };
    } catch {}
  }, 25);
}

void start();
