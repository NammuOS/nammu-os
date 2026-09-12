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
  readonly events: EventsApi;
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
  readonly events: EventsApi;

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
