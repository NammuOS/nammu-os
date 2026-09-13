import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppStoreApp } from '../../../src/components/app-store/AppStoreApp';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { getNammuVFS } from '../../../src/platform/vfs/nammuVFS';

interface RemoteStoreAcceptanceState {
  notesVisible: boolean;
  notesTitle: string;
  packageRequests: number;
  record: Awaited<ReturnType<ReturnType<typeof getNMUDatabase>['getApp']>>;
  notes: unknown;
}

declare global {
  interface Window {
    __remoteStoreAcceptance?: Partial<RemoteStoreAcceptanceState>;
    __closeAcceptedNotes?: () => void;
  }
}

const PACKAGE_ROUTE = '/api/app-store/packages/os.nammu.notes/1.0.0';
const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(raw, window.location.href).pathname;
  if (path === PACKAGE_ROUTE) {
    const state = (window.__remoteStoreAcceptance ??= {});
    state.packageRequests = (state.packageRequests ?? 0) + 1;
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

function Harness() {
  const [notesVisible, setNotesVisible] = useState(false);
  const [notesTitle, setNotesTitle] = useState('Notes');

  useEffect(() => {
    const openInstalledApp = (event: Event) => {
      const appId = (event as CustomEvent<{ appId?: string }>).detail?.appId;
      if (appId === 'os.nammu.notes') setNotesVisible(true);
    };
    window.addEventListener('nammu-open-app', openInstalledApp);
    return () => window.removeEventListener('nammu-open-app', openInstalledApp);
  }, []);

  useEffect(() => {
    window.__closeAcceptedNotes = () => setNotesVisible(false);
    Object.assign((window.__remoteStoreAcceptance ??= {}), { notesVisible, notesTitle });
  }, [notesTitle, notesVisible]);

  return (
    <main style={{ width: '100%', height: '100%', position: 'relative' }}>
      <AppStoreApp initialAppId="os.nammu.notes" />
      {notesVisible && (
        <section
          data-acceptance-notes
          style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#080808' }}
        >
          <AppSandboxHost
            appId="os.nammu.notes"
            windowId="remote-store-acceptance"
            title={notesTitle}
            onTitleChange={setNotesTitle}
            onClose={() => setNotesVisible(false)}
          />
        </section>
      )}
    </main>
  );
}

async function observeState() {
  const database = getNMUDatabase();
  const notesStorage = getNammuVFS().createScopedVFS('os.nammu.notes');
  let observing = false;
  window.setInterval(async () => {
    if (observing) return;
    observing = true;
    try {
      const record = await database.getApp('os.nammu.notes');
      let notes: unknown = null;
      try {
        notes = JSON.parse(await notesStorage.readUserDataText('notes.json'));
      } catch {}
      Object.assign((window.__remoteStoreAcceptance ??= {}), { record, notes });
    } finally {
      observing = false;
    }
  }, 40);
}

createRoot(document.querySelector('#root')!).render(<Harness />);
void observeState();
