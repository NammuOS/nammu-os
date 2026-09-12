export const NAMMU_APP_STORE_REPO = 'https://apps.umbrel.com/api/v3/umbrelos/app-store';

export interface NammuAppManifest {
  manifestVersion: string;
  id: string;
  name: string;
  tagline: string;
  icon: string;
  category: string;
  version: string;
  description: string;
  website: string;
  developer?: string | number;
  submitter?: string | number;
  submission?: string;
  repo?: string;
  support: string;
  gallery: string[];
  releaseNotes?: string;
  dependencies?: string[];
  permissions?: string[];
  path?: string;
  defaultUsername?: string;
  defaultPassword?: string;
  deterministicPassword?: boolean;
  optimizedForNammuHome?: boolean;
  requiresHttps?: boolean;
  installSize?: number;
  widgets?: unknown[];
  defaultShell?: string;
  implements?: string[];
  backupIgnore?: string[];
  storage?: { dataRoot: 'data' };
  folderAccess?: NammuAppFolderAccess[];
  environment?: NammuAppEnvironmentVariable[];
  appStoreId?: string;
}

export interface NammuAppFolderAccess {
  id: string;
  name: string;
  note?: string;
  mounts: Array<{
    service?: string;
    targetPath: string;
    readOnly?: boolean;
  }>;
}

export interface NammuAppEnvironmentVariable {
  name: string;
  services: string[];
  default?: string;
  options?: string[];
  note?: string;
}

export interface NammuAppRegistry {
  meta: {
    id: string;
    name: string;
  };
  apps: NammuAppManifest[];
}

export interface NammuAppStoreStatus {
  available: 'available';
  installed: 'installed';
  updateAvailable: 'update-available';
  inProgress: 'in-progress';
  incompatible: 'incompatible';
}

export type AppStoreStatus = NammuAppStoreStatus[keyof NammuAppStoreStatus];

export type NammuAppStateOrLoading = 'loading' | 'not-installed' | 'ready' | 'installing' | 'updating' | 'starting' | 'stopping' | 'restarting' | 'uninstalling';

export interface NammuInstalledApp {
  appId: string;
  name: string;
  version: string;
  runtime: 'web' | 'wasm' | 'system-extension' | 'runtime' | 'integration';
  entry: string;
  sourceRegistry: 'official' | 'community' | 'developer' | 'local';
  sourceUrl?: string;
  channel: 'stable' | 'beta' | 'nightly';
  installedAt: number;
  lastUpdatedAt: number;
  packageHash: string;
  publisher?: string;
  publisherKeyId?: string;
  dataSchemaVersion: number;
  requestedPermissions: string[];
  grantedPermissions: string[];
  state: string;
  activeVersion: string;
  activeVersionDir: string;
  lastKnownGoodVersion?: string;
  downloadSize?: number;
  installedSize?: number;
  signatureVerified?: boolean;
  isOfficial?: boolean;
}

export interface NammuAppDates {
  createdAt?: number;
  updatedAt?: number;
}

export interface NammuStorefrontSection {
  id: string;
  type: 'app-list' | 'spotlight' | 'category-feature';
  title?: string;
  subtitle?: string;
  layout?: 'grid' | 'rail';
  appIds?: string[];
  banners?: Array<{ appId: string; artwork: { dark: string } }>;
  categoryId?: string;
  description?: string;
  artwork?: { dark: string };
  textSide?: 'left' | 'right';
}

export interface NammuStorefront {
  sections: NammuStorefrontSection[];
  categories: Array<{ id: string; featuredAppIds: string[] }>;
  apps: Array<{ id: string; version: string; createdAt?: string | null; updatedAt?: string | null }>;
}

export interface NammuResolvedStorefront {
  sections: NammuResolvedStorefrontSection[];
  featuredByCategory: Map<string, NammuAppManifest[]>;
  dates: Map<string, NammuAppDates>;
}

export type NammuResolvedStorefrontSection =
  | { type: 'app-list'; id: string; layout: 'grid' | 'rail'; title: string; subtitle?: string; apps: NammuAppManifest[] }
  | { type: 'spotlight'; id: string; banners: Array<{ app: NammuAppManifest; artwork: { dark: string } }> }
  | { type: 'category-feature'; id: string; categoryId: string; title: string; description: string; apps: NammuAppManifest[]; artwork: { dark: string }; textSide: 'left' | 'right' };

export const NAMMU_APP_CATEGORIES = [
  'files',
  'ai',
  'bitcoin',
  'media',
  'finance',
  'networking',
  'automation',
  'social',
  'developer',
  'crypto',
  'productivity',
  'utilities',
  'gaming',
  'education',
] as const;

export type NammuAppCategory = (typeof NAMMU_APP_CATEGORIES)[number];

export const NAMMU_CATEGORY_NAV_ORDER: readonly NammuAppCategory[] = [
  'files',
  'ai',
  'media',
  'productivity',
  'finance',
  'networking',
  'automation',
  'social',
  'developer',
  'crypto',
  'gaming',
  'education',
  'utilities',
];

export interface NammuCategoryLabels {
  discover: () => string;
  all: () => string;
  [key: string]: () => string;
}

export function getNammuCategoryLabel(categoryId: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    discover: 'Discover',
    all: 'All Apps',
    files: 'Files',
    ai: 'AI',
    bitcoin: 'Bitcoin',
    media: 'Media',
    finance: 'Finance',
    networking: 'Networking',
    automation: 'Automation',
    social: 'Social',
    developer: 'Developer',
    crypto: 'Crypto',
    productivity: 'Productivity',
    utilities: 'Utilities',
    gaming: 'Gaming',
    education: 'Education',
  };

  if (labels[categoryId]) return t(labels[categoryId]);

  return categoryId
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getNammuNavCategories(appsGroupedByCategory: Record<string, readonly NammuAppManifest[]>): string[] {
  const hasApps = (categoryId: string) => (appsGroupedByCategory[categoryId]?.length ?? 0) > 0;
  const dynamicCategories = Object.keys(appsGroupedByCategory)
    .filter((categoryId) => !NAMMU_APP_CATEGORIES.includes(categoryId as NammuAppCategory))
    .sort();

  return ['discover', 'all', ...NAMMU_CATEGORY_NAV_ORDER.filter(hasApps), ...dynamicCategories.filter(hasApps)];
}

export type AppSortId = 'name' | 'newest' | 'recently-updated';

export function getAvailableSorts(dates: Map<string, NammuAppDates> | undefined): AppSortId[] {
  const sorts: AppSortId[] = ['name'];
  if (!dates || dates.size === 0) return sorts;

  let hasCreatedAt = false;
  let hasUpdatedAt = false;
  for (const entry of dates.values()) {
    hasCreatedAt ||= entry.createdAt !== undefined;
    hasUpdatedAt ||= entry.updatedAt !== undefined;
    if (hasCreatedAt && hasUpdatedAt) break;
  }

  if (hasCreatedAt) sorts.push('newest');
  if (hasUpdatedAt) sorts.push('recently-updated');
  return sorts;
}

function createNameCollator(locale?: string) {
  return new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
}

export function sortApps(
  apps: readonly NammuAppManifest[],
  sort: AppSortId,
  dates: Map<string, NammuAppDates> | undefined,
  collator: Intl.Collator = createNameCollator(),
): NammuAppManifest[] {
  const byName = (a: NammuAppManifest, b: NammuAppManifest) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);

  if (sort === 'name' || !dates) return [...apps].sort(byName);

  const key = sort === 'newest' ? 'createdAt' : 'updatedAt';
  return [...apps].sort((a, b) => {
    const aDate = dates.get(a.id)?.[key];
    const bDate = dates.get(b.id)?.[key];
    if (aDate === undefined && bDate === undefined) return byName(a, b);
    if (aDate === undefined) return 1;
    if (bDate === undefined) return -1;
    return bDate - aDate || byName(a, b);
  });
}

function stableRank(seed: string, appId: string): number {
  const value = `${seed}:${appId}`;
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

export function getRelatedApps(apps: readonly NammuAppManifest[], appId: string, count = 5): NammuAppManifest[] {
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app) return [];

  return apps
    .filter((candidate) => candidate.category === app.category && candidate.id !== appId)
    .sort((a, b) => stableRank(appId, a.id) - stableRank(appId, b.id) || a.id.localeCompare(b.id))
    .slice(0, count);
}

export function deriveAppStatus({
  compatible,
  installedState,
  updateAvailable,
}: {
  compatible: boolean;
  installedState?: string;
  updateAvailable: boolean;
}): AppStoreStatus {
  const inProgressStates = ['installing', 'uninstalling', 'updating', 'starting', 'restarting', 'stopping'] as const;

  if (installedState === undefined) return compatible ? 'available' : 'incompatible';
  if (inProgressStates.includes(installedState as typeof inProgressStates[number])) return 'in-progress';
  if (updateAvailable) return 'update-available';
  return 'installed';
}

export function buildAppStatusMap(
  apps: readonly NammuAppManifest[],
  userAppsKeyed: Record<string, NammuInstalledApp> | undefined,
): Map<string, AppStoreStatus> {
  const statuses = new Map<string, AppStoreStatus>();
  for (const app of apps) {
    const userApp = userAppsKeyed?.[app.id];
    statuses.set(
      app.id,
      deriveAppStatus({
        compatible: true,
        installedState: userApp?.state,
        updateAvailable: Boolean(userApp && app.version !== userApp.version),
      }),
    );
  }
  return statuses;
}

export function getAppStoreAction(status: AppStoreStatus, transitioning: boolean): 'install' | 'open' | 'update' | undefined {
  if (transitioning || status === 'in-progress') return undefined;

  switch (status) {
    case 'available':
    case 'incompatible':
      return 'install';
    case 'installed':
      return 'open';
    case 'update-available':
      return 'update';
  }
}

export function buildAppDates(
  remoteApps: readonly { id: string; version: string; createdAt?: string | null; updatedAt?: string | null }[],
  localAppsKeyed: Record<string, Pick<NammuAppManifest, 'version'>>,
): Map<string, NammuAppDates> {
  const dates = new Map<string, NammuAppDates>();

  function parseDate(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  for (const remoteApp of remoteApps) {
    const localApp = localAppsKeyed[remoteApp.id];
    if (!localApp) continue;

    const entry: NammuAppDates = {};
    const createdAt = parseDate(remoteApp.createdAt);
    if (createdAt !== undefined) entry.createdAt = createdAt;

    if (remoteApp.version === localApp.version) {
      const updatedAt = parseDate(remoteApp.updatedAt);
      if (updatedAt !== undefined) entry.updatedAt = updatedAt;
    }

    if (entry.createdAt !== undefined || entry.updatedAt !== undefined) dates.set(remoteApp.id, entry);
  }
  return dates;
}

export const NAMMU_APP_STORE_PATH = '/app-store';
export const NAMMU_DISCOVER_PATH = '/app-store';

export function nammuAppPath(appId: string): string {
  return `/app-store/${appId}`;
}

export function nammuCategoryPath(categoryId: string): string {
  return `/app-store/category/${categoryId}`;
}

// Visual constants (matching Umbrel's design but adapted for Nammu OS)
export const storeRevealClass = 'animate-in fade-in-2 duration-300';
export const storeRevealDelay = (ms: number) => ({ '--store-reveal-delay': `${ms}ms` } as React.CSSProperties);
export const appGridClass = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

// Re-export getNammuCategoryLabel as getCategoryLabel for compatibility
export const getCategoryLabel = getNammuCategoryLabel;
export const NAMMU_APP_STORE_ID = 'nammu';