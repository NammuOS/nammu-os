import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppSandboxHost } from '../../../src/components/os/sandbox/AppSandboxHost';
import { getNMUDatabase } from '../../../src/platform/nmu/nmuDatabase';
import { getNMUEngine } from '../../../src/platform/nmu/nmuEngine';
import { getNammuVFS } from '../../../src/platform/vfs/nammuVFS';

declare const __NOTES_NAPP_BASE64__: string;

declare global {
  interface Window {
    __notesAcceptance?: Record<string, unknown>;
    __toggleNotes?: () => void;
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
  const [title, setTitle] = useState('');
  window.__toggleNotes = () => setVisible((current) => !current);
  window.__notesAcceptance = { ...(window.__notesAcceptance ?? {}), visible, title };
  return visible ? (
    <main style={{ width: '100vw', height: '100vh' }}>
      <AppSandboxHost appId="os.nammu.notes" windowId="notes-acceptance" onTitleChange={setTitle} />
    </main>
  ) : null;
}

async function start() {
  localStorage.setItem(
    'nammu-notes',
    JSON.stringify([
      {
        id: 'legacy-note',
        title: 'Legacy Core note',
        content: 'Migrate this note exactly once.',
        folder: 'personal',
        tags: ['Legacy'],
        pinned: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ]),
  );
  const engine = getNMUEngine();
  await engine.install(decodePackage(__NOTES_NAPP_BASE64__), {
    sourceRegistry: 'official',
    approvedPermissions: ['clipboard.write', 'filesystem.user-selected.write'],
  });
  createRoot(document.querySelector('#root')!).render(<Harness />);

  const data = getNammuVFS().createScopedVFS('os.nammu.notes');
  window.setInterval(async () => {
    try {
      const record = await getNMUDatabase().getApp('os.nammu.notes');
      const notes = JSON.parse(await data.readUserDataText('notes.json'));
      Object.assign((window.__notesAcceptance ??= {}), {
        ready: record?.state === 'Installed',
        signatureVerified: record?.signatureVerified,
        legacyRemoved: localStorage.getItem('nammu-notes') === null,
        notes,
      });
    } catch {}
  }, 25);
}

void start();
