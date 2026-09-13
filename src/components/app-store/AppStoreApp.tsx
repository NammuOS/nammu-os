'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { getPlatformCapabilities } from '@/platform';
import { compareSemver } from '@/platform/nmu/manifestValidator';
import type { InstalledAppRecord, PermissionIdentifier } from '@/platform/nmu/nappSpec';
import { formatStoreBytes, type PreparedStorePackage } from '@/platform/store/storeDistribution';
import { OFFICIAL_NAMMU_REGISTRY, type NammuStoreApp } from '@/platform/store/storeRegistry';
import { getNammuStoreService } from '@/platform/store/storeService';
import './app-store.css';

type PendingAction = 'install' | 'update' | 'repair';
type Confirmation =
  | { type: 'package'; action: PendingAction; prepared: PreparedStorePackage }
  | { type: 'uninstall'; app: NammuStoreApp }
  | { type: 'rollback'; app: NammuStoreApp }
  | null;

const PERMISSION_LABELS: Record<PermissionIdentifier, { label: string; detail: string }> = {
  'clipboard.read': { label: 'Read clipboard text', detail: 'Read text you copied.' },
  'clipboard.write': { label: 'Copy text', detail: 'Write text to your clipboard.' },
  'notifications.send': { label: 'Send notifications', detail: 'Show system notifications.' },
  'filesystem.appdata.read': {
    label: 'Read private app data',
    detail: 'Open only this app’s isolated data.',
  },
  'filesystem.appdata.write': {
    label: 'Save private app data',
    detail: 'Write only inside this app’s isolated storage.',
  },
  'filesystem.user-selected.read': {
    label: 'Open selected files',
    detail: 'Read files you explicitly choose.',
  },
  'filesystem.user-selected.write': {
    label: 'Save selected files',
    detail: 'Write files through a save dialog.',
  },
  'migration.legacy-storage': {
    label: 'Migrate legacy data',
    detail: 'Import the exact previous built-in app storage key once.',
  },
  'network.internet': { label: 'Internet access', detail: 'Connect to public network services.' },
  'integration.web-surfaces': {
    label: 'Embedded web content',
    detail: 'Create isolated browser surfaces within the app window.',
  },
  'integration.services': {
    label: 'Nammu services',
    detail: 'Use only the named Nammu services declared by this package.',
  },
  'window.manage': {
    label: 'Manage its window',
    detail: 'Update the app title and request window actions.',
  },
  'events.system.subscribe': {
    label: 'System events',
    detail: 'Listen to approved Nammu system events.',
  },
  'events.cross-app.subscribe': {
    label: 'Cross-app events',
    detail: 'Listen to approved events from other apps.',
  },
  'camera.capture': { label: 'Camera access', detail: 'Use a camera after system approval.' },
  'microphone.capture': {
    label: 'Microphone access',
    detail: 'Use a microphone after system approval.',
  },
};

function dispatchOpen(appId: string) {
  window.dispatchEvent(new CustomEvent('nammu-open-app', { detail: { appId } }));
}

export function AppStoreApp({ initialAppId }: { initialAppId?: string } = {}) {
  const [selectedId, setSelectedId] = useState(initialAppId ?? '');
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState<Record<string, InstalledAppRecord>>({});
  const [busy, setBusy] = useState<PendingAction | 'uninstall' | 'rollback' | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [error, setError] = useState('');
  const store = useMemo(() => getNammuStoreService(), []);

  const refreshInstalled = useCallback(async () => {
    const records = await store.listInstalled();
    setInstalled(Object.fromEntries(records.map((record) => [record.appId, record])));
  }, [store]);

  useEffect(() => {
    void refreshInstalled().catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Installed applications are unavailable.');
    });
  }, [refreshInstalled]);

  const apps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return OFFICIAL_NAMMU_REGISTRY.apps;
    return OFFICIAL_NAMMU_REGISTRY.apps.filter((app) =>
      [app.name, app.tagline, app.description, app.category, app.developer].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [query]);
  const selected = OFFICIAL_NAMMU_REGISTRY.apps.find((app) => app.id === selectedId);

  const stagePackage = async (app: NammuStoreApp, action: PendingAction) => {
    setBusy(action);
    setError('');
    try {
      const prepared = await store.prepare(app);
      setConfirmation({ type: 'package', action, prepared });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The package could not be prepared safely.',
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmPackage = async (value: Extract<Confirmation, { type: 'package' }>) => {
    const { action, prepared } = value;
    setConfirmation(null);
    setBusy(action);
    setError('');
    try {
      await store.commit(action, prepared);
      await refreshInstalled();
      if (action === 'update') dispatchOpen(prepared.app.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} this application.`);
    } finally {
      setBusy(null);
    }
  };

  const confirmLifecycle = async (value: Exclude<Confirmation, { type: 'package' } | null>) => {
    setConfirmation(null);
    setBusy(value.type);
    setError('');
    try {
      if (value.type === 'uninstall') {
        await store.uninstallKeepingData(value.app.id);
      } else {
        await store.rollback(value.app.id);
      }
      await refreshInstalled();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `Unable to ${value.type} this application.`,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="nammu-store relative" data-nammu-app="app-store">
      <header className="nammu-store__header">
        <div>
          <span className="nammu-store__eyebrow">NAMMU OFFICIAL REGISTRY</span>
          <h1>Nammu Store</h1>
        </div>
        <div className="nammu-store__trust">
          <ShieldCheck size={16} /> Signed packages only
        </div>
      </header>

      {error && (
        <div className="nammu-store__error">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}

      {selected ? (
        <StoreDetails
          app={selected}
          installed={installed[selected.id]}
          busy={busy}
          onBack={() => setSelectedId('')}
          onOpen={() => dispatchOpen(selected.id)}
          onStage={(action) => void stagePackage(selected, action)}
          onUninstall={() => setConfirmation({ type: 'uninstall', app: selected })}
          onRollback={() => setConfirmation({ type: 'rollback', app: selected })}
        />
      ) : (
        <main className="nammu-store__catalog">
          <div className="nammu-store__search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search applications"
              aria-label="Search applications"
            />
          </div>
          <div className="nammu-store__section-heading">
            <div>
              <span>CURATED FOR NAMMU OS</span>
              <h2>Applications</h2>
            </div>
            <span>{apps.length} available</span>
          </div>
          <div className="nammu-store__grid">
            {apps.map((app) => {
              const record = installed[app.id];
              const update = record && compareSemver(app.release.version, record.version) > 0;
              return (
                <button
                  key={app.id}
                  className="nammu-store-card"
                  onClick={() => setSelectedId(app.id)}
                >
                  <StoreIcon />
                  <span className="nammu-store-card__copy">
                    <strong>{app.name}</strong>
                    <small>{app.tagline}</small>
                    <em>{update ? 'Update available' : record ? 'Installed' : 'Get'}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </main>
      )}

      {confirmation?.type === 'package' && (
        <PermissionReview
          value={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void confirmPackage(confirmation)}
        />
      )}
      {(confirmation?.type === 'uninstall' || confirmation?.type === 'rollback') && (
        <LifecycleConfirmation
          value={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void confirmLifecycle(confirmation)}
        />
      )}
    </div>
  );
}

function StoreDetails({
  app,
  installed,
  busy,
  onBack,
  onOpen,
  onStage,
  onUninstall,
  onRollback,
}: {
  app: NammuStoreApp;
  installed?: InstalledAppRecord;
  busy: PendingAction | 'uninstall' | 'rollback' | null;
  onBack: () => void;
  onOpen: () => void;
  onStage: (action: PendingAction) => void;
  onUninstall: () => void;
  onRollback: () => void;
}) {
  const update = installed && compareSemver(app.release.version, installed.version) > 0;
  const primaryAction: PendingAction | 'open' = update ? 'update' : installed ? 'open' : 'install';
  const openExternal = (url: string) => void getPlatformCapabilities().external.openUrl(url);
  return (
    <main className="nammu-store-details">
      <button className="nammu-store__back" onClick={onBack}>
        <ArrowLeft size={16} /> All applications
      </button>
      <section className="nammu-store-details__hero">
        <StoreIcon large />
        <div>
          <span className="nammu-store__eyebrow">{app.category}</span>
          <h2>{app.name}</h2>
          <p>{app.tagline}</p>
          <small>
            by {app.developer} · Version {app.release.version} ·{' '}
            {formatStoreBytes(app.release.size)}
          </small>
        </div>
        <button
          className="nammu-store__primary"
          disabled={Boolean(busy)}
          onClick={() => (primaryAction === 'open' ? onOpen() : onStage(primaryAction))}
        >
          {busy === primaryAction ? (
            <RefreshCw className="spin" size={16} />
          ) : primaryAction === 'open' ? (
            <ExternalLink size={16} />
          ) : (
            <Download size={16} />
          )}
          {busy === primaryAction
            ? 'Preparing…'
            : primaryAction === 'open'
              ? 'Open'
              : primaryAction === 'update'
                ? 'Update'
                : 'Install'}
        </button>
      </section>
      <div className="nammu-store-details__columns">
        <div className="nammu-store-details__main">
          <section>
            <h3>About</h3>
            <p>{app.description}</p>
          </section>
          <section>
            <h3>What’s new</h3>
            <div className="nammu-store-release">
              <span>Version {app.release.version}</span>
              <time>{app.release.publishedAt}</time>
              <p>{app.release.releaseNotes}</p>
            </div>
          </section>
          <section>
            <h3>Screenshots</h3>
            <div className="nammu-store-screenshots">
              {app.screenshots.map((screenshot, index) => (
                <img
                  key={screenshot}
                  src={screenshot}
                  alt={`${app.name} workspace screenshot ${index + 1}`}
                />
              ))}
            </div>
          </section>
        </div>
        <aside className="nammu-store-details__aside">
          <section>
            <h3>Privacy & permissions</h3>
            <p>
              {app.permissions.length} declared capabilities. The signed package is checked again
              before installation.
            </p>
            {app.permissions.map((permission) => (
              <div className="nammu-store-permission" key={permission}>
                <Check size={14} />
                <span>
                  <strong>{PERMISSION_LABELS[permission].label}</strong>
                  <small>{PERMISSION_LABELS[permission].detail}</small>
                </span>
              </div>
            ))}
          </section>
          <section>
            <h3>Information</h3>
            <Info label="Developer" value={app.developer} />
            <Info label="License" value={app.license} />
            <Info label="Package" value={formatStoreBytes(app.release.size)} />
            <button className="nammu-store__link" onClick={() => openExternal(app.repository)}>
              Repository <ExternalLink size={13} />
            </button>
          </section>
          {installed && (
            <section>
              <h3>Manage</h3>
              <button
                className="nammu-store__manage"
                disabled={Boolean(busy)}
                onClick={() => onStage('repair')}
              >
                <Wrench size={14} /> Repair installation
              </button>
              <button
                className="nammu-store__manage"
                disabled={Boolean(busy) || !installed.lastKnownGoodVersion}
                onClick={onRollback}
              >
                <History size={14} /> Roll back
                {installed.lastKnownGoodVersion ? ` to ${installed.lastKnownGoodVersion}` : ''}
              </button>
              <button
                className="nammu-store__manage danger"
                disabled={Boolean(busy)}
                onClick={onUninstall}
              >
                <Trash2 size={14} /> Uninstall
              </button>
              <small className="nammu-store__retention">
                Notes data is retained unless you explicitly erase it.
              </small>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function StoreIcon({ large = false }: { large?: boolean }) {
  return (
    <span className={`nammu-store-icon${large ? ' nammu-store-icon--large' : ''}`}>
      <StickyNote size={large ? 42 : 28} strokeWidth={1.7} />
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="nammu-store-info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PermissionReview({
  value,
  onCancel,
  onConfirm,
}: {
  value: Extract<Confirmation, { type: 'package' }>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="nammu-store-modal-layer" role="presentation">
      <div
        className="nammu-store-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
      >
        <div className="nammu-store-modal__icon">
          <ShieldCheck size={24} />
        </div>
        <h2 id="permission-title">Review permissions</h2>
        <p>
          {value.prepared.app.name} requests these capabilities. They come from the downloaded,
          integrity-checked package—not display metadata.
        </p>
        <div className="nammu-store-modal__permissions">
          {value.prepared.manifest.permissions.map((permission) => (
            <div className="nammu-store-permission" key={permission}>
              <Check size={14} />
              <span>
                <strong>{PERMISSION_LABELS[permission].label}</strong>
                <small>{PERMISSION_LABELS[permission].detail}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="nammu-store-modal__proof">
          <FileText size={14} /> SHA-256 verified · official signature verified by nmu during{' '}
          {value.action}
        </div>
        <div className="nammu-store-modal__actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={onConfirm}>
            {value.action === 'install'
              ? 'Install'
              : value.action === 'update'
                ? 'Update'
                : 'Repair'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LifecycleConfirmation({
  value,
  onCancel,
  onConfirm,
}: {
  value: Exclude<Confirmation, { type: 'package' } | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const uninstall = value.type === 'uninstall';
  return (
    <div className="nammu-store-modal-layer" role="presentation">
      <div
        className="nammu-store-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lifecycle-title"
      >
        <h2 id="lifecycle-title">
          {uninstall ? `Uninstall ${value.app.name}?` : `Roll back ${value.app.name}?`}
        </h2>
        <p>
          {uninstall
            ? 'The application will be removed, but its private notes remain available for a future reinstall.'
            : 'Nammu will activate the retained previous version. Your current application data is preserved.'}
        </p>
        <div className="nammu-store-modal__actions">
          <button onClick={onCancel}>Cancel</button>
          <button className={uninstall ? 'danger' : 'primary'} onClick={onConfirm}>
            {uninstall ? 'Uninstall' : 'Roll back'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppStoreApp;
