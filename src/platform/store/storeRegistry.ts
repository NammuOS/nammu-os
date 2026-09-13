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
