import type { PermissionIdentifier } from '../nmu/nappSpec';

export interface NammuStoreRelease {
  version: string;
  packageUrl: string;
  sha256: string;
  size: number;
  publishedAt: string;
  releaseNotes: string;
}

export interface NammuStoreApp {
  id: string;
  name: string;
  tagline: string;
  description: string;
  developer: string;
  category: string;
  repository: string;
  license: string;
  icon: string;
  screenshots: string[];
  permissions: PermissionIdentifier[];
  release: NammuStoreRelease;
}

export interface NammuStoreRegistry {
  schemaVersion: 1;
  id: 'nammu-official';
  name: 'Nammu Store';
  apps: NammuStoreApp[];
}

const NOTES_RELEASE_URL =
  'https://github.com/NammuOS/nammu-notes/releases/download/v1.0.0/os.nammu.notes-1.0.0-signed.napp';
const BROWSER_RELEASE_URL =
  'https://github.com/NammuOS/nammu-browser/releases/download/v1.0.1/os.nammu.browser-1.0.1-signed.napp';

/**
 * The bootstrap catalog contains public discovery metadata only. Package bytes remain in the
 * independent app release and are always hash checked and signature verified before install.
 */
export const OFFICIAL_NAMMU_REGISTRY: NammuStoreRegistry = {
  schemaVersion: 1,
  id: 'nammu-official',
  name: 'Nammu Store',
  apps: [
    {
      id: 'os.nammu.browser',
      name: 'Browser',
      tagline: 'Private, capable browsing across Web and Desktop NammuOS.',
      description:
        'Browse with tabs, private sessions, bookmarks, history, productive new-tab workspaces, and optional public-proxy routing. NammuOS keeps the engine outside the app package: pooled Gecko/WASM on the Web and isolated WebView2 surfaces on Desktop.',
      developer: 'Nammu',
      category: 'Internet',
      repository: 'https://github.com/NammuOS/nammu-browser',
      license: 'Proprietary — Nammu official application',
      icon: 'browser',
      screenshots: ['/store/os.nammu.browser/browser-workspace.png'],
      permissions: [
        'filesystem.user-selected.read',
        'filesystem.user-selected.write',
        'clipboard.read',
        'clipboard.write',
        'migration.legacy-storage',
        'integration.web-surfaces',
        'integration.services',
        'window.manage',
      ],
      release: {
        version: '1.0.1',
        packageUrl: BROWSER_RELEASE_URL,
        sha256: '81f3b2de0648507d6364d68aaa26edb0fad6af284f5746b4a35b898f48f10074',
        size: 638_594,
        publishedAt: '2026-09-13',
        releaseNotes:
          'Restores Find in Page, Print, Save Page, fullscreen, richer tab and bookmark commands, and Gecko protection preferences while preserving the Core-owned Gecko/WebView2 runtime split.',
      },
    },
    {
      id: 'os.nammu.notes',
      name: 'Notes',
      tagline: 'A focused, private writing workspace for Nammu OS.',
      description:
        'Capture ideas, organize writing into folders and tags, pin important notes, preview Markdown, and export clean documents. Notes stores its data in isolated Nammu app storage and keeps it across ordinary uninstall and reinstall.',
      developer: 'Nammu',
      category: 'Productivity',
      repository: 'https://github.com/NammuOS/nammu-notes',
      license: 'Proprietary — Nammu official application',
      icon: 'notes',
      screenshots: ['/store/os.nammu.notes/notes-workspace.png'],
      permissions: [
        'filesystem.appdata.read',
        'filesystem.appdata.write',
        'filesystem.user-selected.write',
        'clipboard.write',
        'migration.legacy-storage',
        'window.manage',
      ],
      release: {
        version: '1.0.0',
        packageUrl: NOTES_RELEASE_URL,
        sha256: 'e535510bbde478a0d76d6656c2d0f48d7f743fc8bc513e51870d8e3043674927',
        size: 21_214,
        publishedAt: '2026-09-12',
        releaseNotes:
          'First independent release. Adds isolated persistence, legacy Notes migration, Markdown export, and the complete signed Nammu application lifecycle.',
      },
    },
  ],
};

export function getStoreApp(appId: string): NammuStoreApp | undefined {
  return OFFICIAL_NAMMU_REGISTRY.apps.find((app) => app.id === appId);
}
