/**
 * @nammu/sdk - Application Developer Kit for NammuOS
 *
 * Provides the official client-side contract for sandboxed applications running
 * inside NammuOS. All APIs mediate through structured, asynchronous IPC messages
 * over a dedicated MessagePort bound by an instance bootstrap handshake.
 */

export interface WindowApi {
  setTitle(title: string): Promise<{ success: boolean; title: string }>;
  close(): Promise<{ success: boolean }>;
  focus(): Promise<{ success: boolean }>;
}

export interface SettingsApi {
  get<T = any>(key: string, defaultValue?: T): Promise<T>;
  set(key: string, value: any): Promise<{ success: boolean }>;
  getAll(): Promise<Record<string, any>>;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
}

export interface NotificationsApi {
  send(notification: NotificationPayload): Promise<{ delivered: boolean }>;
}

export interface PermissionsApi {
  check(permission: string): Promise<boolean>;
  request(permission: string): Promise<boolean>;
  list(): Promise<string[]>;
}

export interface FilesApi {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<{ written: boolean }>;
  delete(path: string): Promise<{ deleted: boolean }>;
  list(path?: string): Promise<string[]>;
  saveText(
    suggestedName: string,
    content: string,
    mimeType?: string,
  ): Promise<{ saved: boolean; fileName?: string }>;
  pickBinary(options?: {
    multiple?: boolean;
    filters?: Array<{ name: string; extensions?: string[]; mimeTypes?: string[] }>;
  }): Promise<{ cancelled: boolean; files: Array<BinaryFile> }>;
  saveBinary(
    suggestedName: string,
    bytes: Uint8Array,
    mimeType?: string,
  ): Promise<{ saved: boolean; fileName?: string }>;
}

export interface BinaryFile {
  name: string;
  mimeType: string | null;
  size: number;
  bytes: Uint8Array;
}

export interface PackageAssetApi {
  read(path: string): Promise<Uint8Array>;
}

export interface ServiceApi {
  request<T = unknown>(service: string, operation: string, payload?: unknown): Promise<T>;
}

export interface WebSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebSurfaceSnapshot {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isAudioPlaying: boolean;
  isMuted: boolean;
  visible: boolean;
}

export type WebSurfaceControl = 'reload' | 'stop' | 'go-back' | 'go-forward' | 'mute' | 'unmute';

export interface WebSurfaceProxyEndpoint {
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
}

export interface WebSurfaceHandle {
  readonly id: string;
  navigate(url: string): Promise<void>;
  control(control: WebSurfaceControl): Promise<void>;
  setBounds(bounds: WebSurfaceBounds): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  setProxyRoute(
    scope: 'profile' | 'surface',
    endpoints: readonly WebSurfaceProxyEndpoint[],
  ): Promise<void>;
  attach(bounds: WebSurfaceBounds): Promise<void>;
  detach(): Promise<void>;
  focus(): Promise<void>;
  getState(): Promise<WebSurfaceSnapshot>;
  destroy(): Promise<void>;
  onState(listener: (state: WebSurfaceSnapshot) => void): () => void;
  onOpenRequest(listener: (url: string) => void): () => void;
}

export interface WebSurfacesApi {
  create(options: {
    capability: string;
    profileKey?: string;
    privateSession?: boolean;
    url: string;
    bounds: WebSurfaceBounds;
    visible?: boolean;
  }): Promise<WebSurfaceHandle>;
}

export interface LifecycleState {
  phase: 'active' | 'background' | 'minimized' | 'suspended';
  visible: boolean;
  focused: boolean;
  active: boolean;
  suspended: boolean;
}

export interface LifecycleApi {
  getState(): Promise<LifecycleState>;
  onChange(listener: (state: LifecycleState) => void): () => void;
}

export interface ClipboardApi {
  readText(): Promise<string>;
  writeText(text: string): Promise<{ written: boolean }>;
}

export interface MigrationApi {
  readLegacyStorage(key: string): Promise<string | null>;
  completeLegacyStorage(key: string): Promise<{ completed: boolean }>;
}

export interface EventsApi {
  on(eventName: string, listener: (payload: any) => void): () => void;
  emit(eventName: string, payload: any): Promise<{ emitted: boolean; eventName?: string }>;
}

export interface NammuApp {
  readonly appId: string;
  readonly instanceId?: string;
  readonly window: WindowApi;
  readonly settings: SettingsApi;
  readonly notifications: NotificationsApi;
  readonly permissions: PermissionsApi;
  readonly files: FilesApi;
  readonly clipboard: ClipboardApi;
  readonly migration: MigrationApi;
  readonly events: EventsApi;
  readonly assets: PackageAssetApi;
  readonly services: ServiceApi;
  readonly webSurfaces: WebSurfacesApi;
  readonly lifecycle: LifecycleApi;
  ready(): Promise<{ ready: boolean }>;
}

export interface IPCTransport {
  send(req: any): void;
  onMessage(listener: (data: any) => void): () => void;
}

export interface SDKInitOptions {
  appId?: string;
  instanceId?: string;
  transport?: IPCTransport;
  timeoutMs?: number;
}

export class NammuSDKClient implements NammuApp {
  readonly appId: string;
  readonly instanceId?: string;
  private transport: IPCTransport;
  private timeoutMs: number;
  private pendingRequests = new Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private eventListeners = new Map<string, Set<(payload: any) => void>>();
  private cleanupTransport: () => void;

  readonly window: WindowApi;
  readonly settings: SettingsApi;
  readonly notifications: NotificationsApi;
  readonly permissions: PermissionsApi;
  readonly files: FilesApi;
  readonly clipboard: ClipboardApi;
  readonly migration: MigrationApi;
  readonly events: EventsApi;
  readonly assets: PackageAssetApi;
  readonly services: ServiceApi;
  readonly webSurfaces: WebSurfacesApi;
  readonly lifecycle: LifecycleApi;

  constructor(options: SDKInitOptions = {}) {
    this.appId =
      options.appId ||
      (typeof window !== 'undefined' ? (window as any).__NAMMU_APP_ID__ : undefined) ||
      'unknown.app';
    this.instanceId =
      options.instanceId ||
      (typeof window !== 'undefined' ? (window as any).__NAMMU_INSTANCE_ID__ : undefined);
    this.timeoutMs = options.timeoutMs || 10000;
    this.transport = options.transport || this.createDefaultTransport();

    this.cleanupTransport = this.transport.onMessage((msg) => this.handleIncoming(msg));

    // Initialize sub-APIs
    this.window = {
      setTitle: (title) => this.call('window.setTitle', { title }),
      close: () => this.call('window.close', {}),
      focus: () => this.call('window.focus', {}),
    };

    this.settings = {
      get: (key, defaultValue) => this.call('settings.get', { key, defaultValue }),
      set: (key, value) => this.call('settings.set', { key, value }),
      getAll: () => this.call('settings.getAll', {}),
    };

    this.notifications = {
      send: (notification) => this.call('notifications.send', notification),
    };

    this.permissions = {
      check: async (permission) => {
        const res = await this.call('permissions.check', { permission });
        return Boolean(res?.granted);
      },
      request: async (permission) => {
        const res = await this.call('permissions.request', { permission });
        return Boolean(res?.granted);
      },
      list: async () => {
        const res = await this.call('permissions.list', {});
        return res?.permissions || [];
      },
    };

    this.files = {
      readText: async (path) => {
        const res = await this.call('files.readText', { path });
        return res?.content ?? '';
      },
      writeText: (path, content) => this.call('files.writeText', { path, content }),
      delete: (path) => this.call('files.delete', { path }),
      list: async (path) => {
        const res = await this.call('files.list', { path });
        return res?.files || [];
      },
      saveText: (suggestedName, content, mimeType = 'text/plain') =>
        this.call('files.saveText', { suggestedName, content, mimeType }),
      pickBinary: (options = {}) => this.call('files.pickBinary', options),
      saveBinary: (suggestedName, bytes, mimeType) =>
        this.call('files.saveBinary', { suggestedName, bytes, mimeType }),
    };

    this.clipboard = {
      readText: async () => {
        const result = await this.call('clipboard.readText', {});
        return result?.text ?? '';
      },
      writeText: (text) => this.call('clipboard.writeText', { text }),
    };

    this.migration = {
      readLegacyStorage: async (key) => {
        const result = await this.call('migration.readLegacyStorage', { key });
        return result?.value ?? null;
      },
      completeLegacyStorage: (key) => this.call('migration.completeLegacyStorage', { key }),
    };

    this.events = {
      on: (eventName, listener) => {
        const normalizedEventName =
          eventName.startsWith('app.') || eventName.startsWith('system.')
            ? eventName
            : `app.${this.appId}.${eventName}`;
        let listeners = this.eventListeners.get(normalizedEventName);
        if (!listeners) {
          listeners = new Set();
          this.eventListeners.set(normalizedEventName, listeners);
          this.call('events.subscribe', { eventName: normalizedEventName }).catch(() => {});
        }
        listeners.add(listener);

        return () => {
          listeners!.delete(listener);
        };
      },
      emit: (eventName, payload) => this.call('events.emit', { eventName, payload }),
    };

    this.assets = {
      read: async (path) => {
        const result = await this.call('assets.read', { path });
        return result.bytes as Uint8Array;
      },
    };

    this.services = {
      request: async (service, operation, payload) => {
        const result = await this.call('services.request', { service, operation, payload });
        return result.data;
      },
    };

    this.lifecycle = {
      getState: () => this.call('lifecycle.getState', {}),
      onChange: (listener) => this.subscribeHostEvent('system.lifecycle', listener),
    };

    this.webSurfaces = {
      create: async (options) => {
        const initial = (await this.call('webSurfaces.create', options)) as WebSurfaceSnapshot;
        const id = initial.id;
        const capability = options.capability;
        let destroyed = false;
        const ensureOpen = () => {
          if (destroyed) throw new Error('The web surface has already been destroyed.');
        };
        return {
          id,
          navigate: async (url) => {
            ensureOpen();
            await this.call('webSurfaces.navigate', { id, capability, url });
          },
          control: async (control) => {
            ensureOpen();
            await this.call('webSurfaces.control', { id, control });
          },
          setBounds: async (bounds) => {
            ensureOpen();
            await this.call('webSurfaces.setBounds', { id, bounds });
          },
          setVisible: async (visible) => {
            ensureOpen();
            await this.call('webSurfaces.setVisible', { id, visible });
          },
          setZoom: async (zoom) => {
            ensureOpen();
            await this.call('webSurfaces.setZoom', { id, zoom });
          },
          setProxyRoute: async (scope, endpoints) => {
            ensureOpen();
            await this.call('webSurfaces.setProxyRoute', { id, scope, endpoints });
          },
          attach: async (bounds) => {
            ensureOpen();
            await this.call('webSurfaces.attach', { id, bounds });
          },
          detach: async () => {
            ensureOpen();
            await this.call('webSurfaces.detach', { id });
          },
          focus: async () => {
            ensureOpen();
            await this.call('webSurfaces.focus', { id });
          },
          getState: async () => {
            ensureOpen();
            return this.call('webSurfaces.getState', { id });
          },
          destroy: async () => {
            if (destroyed) return;
            await this.call('webSurfaces.destroy', { id });
            destroyed = true;
          },
          onState: (listener) => this.subscribeHostEvent(`system.web-surface.${id}`, listener),
          onOpenRequest: (listener) =>
            this.subscribeHostEvent(`system.web-surface-open.${id}`, (payload) => {
              if (typeof payload?.url === 'string') listener(payload.url);
            }),
        };
      },
    };
  }

  /**
   * Signals that application has completed startup and is ready
   */
  async ready(): Promise<{ ready: boolean }> {
    return this.call('app.ready', {});
  }

  /**
   * Execute an asynchronous RPC method over the configured IPC transport
   */
  async call<T = any>(method: string, params: any = {}): Promise<T> {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `[Nammu SDK] Request ${id} for method '${method}' timed out after ${this.timeoutMs}ms`,
          ),
        );
      }, this.timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.transport.send({ id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  private handleIncoming(msg: any): void {
    if (!msg || typeof msg !== 'object') return;

    // Handle responses to requests
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        const err = new Error(msg.error.message || 'IPC Error');
        (err as any).code = msg.error.code;
        (err as any).details = msg.error.details;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Handle broadcast events
    if (msg.type === 'event' && typeof msg.eventName === 'string') {
      const listeners = this.eventListeners.get(msg.eventName);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(msg.payload);
          } catch (e) {
            console.error('[Nammu SDK] Unhandled error in event listener:', e);
          }
        }
      }
    }
  }

  private subscribeHostEvent(eventName: string, listener: (payload: any) => void): () => void {
    let listeners = this.eventListeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(eventName, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.eventListeners.delete(eventName);
    };
  }

  private createDefaultTransport(): IPCTransport {
    let port: MessagePort | null = null;
    let queuedSends: any[] = [];
    let messageListener: ((data: any) => void) | null = null;

    if (typeof window !== 'undefined') {
      if ((window as any).__NAMMU_IPC_TRANSPORT__) {
        return (window as any).__NAMMU_IPC_TRANSPORT__;
      }

      // 1. Listen for one-time bootstrap handshake from parent
      const bootstrapHandler = (event: MessageEvent) => {
        const expectedNonce = (window as any).__NAMMU_INSTANCE_NONCE__;
        const expectedInstanceId = (window as any).__NAMMU_INSTANCE_ID__;
        if (
          event.source === window.parent &&
          !port &&
          event.data?.type === 'nammu:bootstrap' &&
          event.data.instanceNonce === expectedNonce &&
          event.data.instanceId === expectedInstanceId &&
          event.ports?.[0]
        ) {
          port = event.ports[0];
          window.removeEventListener('message', bootstrapHandler);

          port.onmessage = (pe: MessageEvent) => {
            if (messageListener && pe.data) {
              messageListener(pe.data);
            }
          };

          // Flush queued sends over private port
          for (const req of queuedSends) {
            port.postMessage(req);
          }
          queuedSends = [];
        }
      };

      window.addEventListener('message', bootstrapHandler);
    }

    return {
      send(req) {
        if (port) {
          port.postMessage(req);
        } else if (typeof window !== 'undefined') {
          // Bootstrap requests wait and execute exactly once on the private port.
          queuedSends.push(req);
        }
      },
      onMessage(listener) {
        messageListener = listener;

        if (typeof window === 'undefined') return () => {};

        return () => {
          messageListener = null;
          if (port) port.onmessage = null;
        };
      },
    };
  }

  dispose(): void {
    for (const [_, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('[Nammu SDK] Client disposed'));
    }
    this.pendingRequests.clear();
    this.eventListeners.clear();
    this.cleanupTransport();
  }
}

let globalSDKInstance: NammuApp | null = null;

export function getNammuSDK(options?: SDKInitOptions): NammuApp {
  if (!globalSDKInstance) {
    globalSDKInstance = new NammuSDKClient(options);
  }
  return globalSDKInstance;
}

export function defineApp(factory: (app: NammuApp) => void | Promise<void>): void {
  const app = getNammuSDK();
  try {
    const res = factory(app);
    if (res && typeof (res as any).then === 'function') {
      (res as Promise<void>).catch((err) => {
        console.error('[Nammu App] Error executing app main:', err);
      });
    }
  } catch (err) {
    console.error('[Nammu App] Synchronous error in defineApp:', err);
  }
}
