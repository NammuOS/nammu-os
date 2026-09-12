/**
 * Capability Broker
 *
 * Implements permission mediation and host-side IPC message routing for
 * sandboxed Nammu applications. The sandbox never accesses privileged host APIs
 * directly; every operation passes through structured capability checks.
 *
 * Contexts are keyed by unique instanceId (supporting multiple simultaneous
 * windows/processes of the same application).
 */

import { KNOWN_PERMISSIONS, type PermissionIdentifier } from '../nmu/nappSpec';
import type { ScopedVFS } from '../vfs/vfsContracts';

export interface IPCRequest {
  id: string;
  method: string;
  params?: any;
}

export interface IPCResponse {
  id: string;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface IPCEventNotification {
  type: 'event';
  eventName: string;
  payload: any;
}

export interface SandboxContext {
  instanceId: string;
  appId: string;
  windowId?: string;
  instanceNonce?: string;
  grantedPermissions: Set<PermissionIdentifier>;
  requestedPermissions: Set<PermissionIdentifier>;
  legacyStorageKeys?: Set<string>;
  scopedVfs: ScopedVFS;
  postMessage?: (msg: IPCResponse | IPCEventNotification) => void;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
}

export interface HostServices {
  onWindowTitleChange?: (instanceId: string, appId: string, title: string) => void;
  onWindowClose?: (instanceId: string, appId: string) => void;
  onWindowFocus?: (instanceId: string, appId: string) => void;
  onNotification?: (appId: string, notification: NotificationPayload) => void;
  onRequestPermission?: (appId: string, permission: PermissionIdentifier) => Promise<boolean>;
  onPermissionGranted?: (appId: string, permission: PermissionIdentifier) => void | Promise<void>;
  onAppReady?: (instanceId: string, appId: string) => void | Promise<void>;
  onEmitEvent?: (eventName: string, payload: any) => void;
  onClipboardReadText?: () => Promise<string>;
  onClipboardWriteText?: (text: string) => Promise<void>;
  onSaveTextFile?: (
    suggestedName: string,
    content: string,
    mimeType: string,
  ) => Promise<{ saved: boolean; fileName?: string }>;
  onLegacyStorageRead?: (key: string) => Promise<string | null>;
  onLegacyStorageComplete?: (key: string) => Promise<void>;
}

export class CapabilityBroker {
  private contexts = new Map<string, SandboxContext>(); // instanceId -> SandboxContext
  private eventSubscriptions = new Map<string, Set<string>>(); // eventName -> Set<instanceId>
  private hostServices: HostServices;

  constructor(hostServices: HostServices = {}) {
    this.hostServices = hostServices;
  }

  registerContext(context: SandboxContext): void {
    this.contexts.set(context.instanceId, context);
  }

  unregisterContext(instanceId: string): void {
    this.contexts.delete(instanceId);
    for (const [_, subscribers] of this.eventSubscriptions.entries()) {
      subscribers.delete(instanceId);
    }
  }

  getContext(instanceId: string): SandboxContext | undefined {
    return this.contexts.get(instanceId);
  }

  getInstancesForApp(appId: string): SandboxContext[] {
    const list: SandboxContext[] = [];
    for (const ctx of this.contexts.values()) {
      if (ctx.appId === appId) list.push(ctx);
    }
    return list;
  }

  /**
   * Handle an incoming IPC request from a sandboxed application instance
   */
  async handleRequest(context: SandboxContext, req: IPCRequest): Promise<IPCResponse> {
    if (!req || typeof req !== 'object' || !req.id || typeof req.method !== 'string') {
      return {
        id: req?.id ?? 'unknown',
        error: {
          code: 'INVALID_REQUEST',
          message: 'Malformed IPC request structure',
        },
      };
    }

    try {
      const result = await this.dispatch(context, req.method, req.params || {});
      return {
        id: req.id,
        result,
      };
    } catch (err: any) {
      return {
        id: req.id,
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Unknown broker error',
          details: err.details,
        },
      };
    }
  }

  /**
   * Dispatches an IPC call to the respective subsystem
   */
  private async dispatch(context: SandboxContext, method: string, params: any): Promise<any> {
    const [subsystem, action] = method.split('.');

    switch (subsystem) {
      case 'app':
        return this.handleApp(context, action, params);
      case 'window':
        return this.handleWindow(context, action, params);
      case 'settings':
        return this.handleSettings(context, action, params);
      case 'notifications':
        return this.handleNotifications(context, action, params);
      case 'permissions':
        return this.handlePermissions(context, action, params);
      case 'files':
        return this.handleFiles(context, action, params);
      case 'events':
        return this.handleEvents(context, action, params);
      case 'clipboard':
        return this.handleClipboard(context, action, params);
      case 'migration':
        return this.handleMigration(context, action, params);
      default:
        throw {
          code: 'INVALID_METHOD',
          message: `Unknown subsystem or method: ${method}`,
        };
    }
  }

  private async handleMigration(context: SandboxContext, action: string, params: any) {
    this.assertPermission(context, 'migration.legacy-storage');
    const key = String(params.key ?? '');
    if (!key || !context.legacyStorageKeys?.has(key)) {
      throw { code: 'INVALID_INPUT', message: 'Legacy storage key is not declared by this app.' };
    }
    if (action === 'readLegacyStorage') {
      if (!this.hostServices.onLegacyStorageRead) {
        throw { code: 'UNAVAILABLE', message: 'Legacy storage migration is unavailable.' };
      }
      return { value: await this.hostServices.onLegacyStorageRead(key) };
    }
    if (action === 'completeLegacyStorage') {
      if (!this.hostServices.onLegacyStorageComplete) {
        throw { code: 'UNAVAILABLE', message: 'Legacy storage migration is unavailable.' };
      }
      await this.hostServices.onLegacyStorageComplete(key);
      return { completed: true };
    }
    throw { code: 'INVALID_METHOD', message: `Unknown migration action: ${action}` };
  }

  private async handleClipboard(
    context: SandboxContext,
    action: string,
    params: any,
  ): Promise<any> {
    switch (action) {
      case 'readText': {
        this.assertPermission(context, 'clipboard.read');
        if (!this.hostServices.onClipboardReadText) {
          throw { code: 'UNAVAILABLE', message: 'Text clipboard reading is unavailable.' };
        }
        return { text: await this.hostServices.onClipboardReadText() };
      }
      case 'writeText': {
        this.assertPermission(context, 'clipboard.write');
        const text = String(params.text ?? '');
        if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
          throw { code: 'INVALID_INPUT', message: 'Clipboard text exceeds the 1 MiB limit.' };
        }
        if (!this.hostServices.onClipboardWriteText) {
          throw { code: 'UNAVAILABLE', message: 'Text clipboard writing is unavailable.' };
        }
        await this.hostServices.onClipboardWriteText(text);
        return { written: true };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown clipboard action: ${action}` };
    }
  }

  private async handleApp(context: SandboxContext, action: string, _params: any): Promise<any> {
    switch (action) {
      case 'ready': {
        await this.hostServices.onAppReady?.(context.instanceId, context.appId);
        return { ready: true };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown app action: ${action}` };
    }
  }

  private async handleWindow(context: SandboxContext, action: string, params: any): Promise<any> {
    switch (action) {
      case 'setTitle': {
        const title = String(params.title ?? '');
        this.hostServices.onWindowTitleChange?.(context.instanceId, context.appId, title);
        return { success: true, title };
      }
      case 'close': {
        this.hostServices.onWindowClose?.(context.instanceId, context.appId);
        return { success: true };
      }
      case 'focus': {
        this.hostServices.onWindowFocus?.(context.instanceId, context.appId);
        return { success: true };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown window action: ${action}` };
    }
  }

  private async handleSettings(context: SandboxContext, action: string, params: any): Promise<any> {
    const settingsPath = 'settings.json';

    const readSettingsRecord = async (): Promise<Record<string, any>> => {
      try {
        const text = await context.scopedVfs.readUserDataText(settingsPath);
        return JSON.parse(text);
      } catch {
        return {};
      }
    };

    switch (action) {
      case 'get': {
        const key = String(params.key ?? '');
        const record = await readSettingsRecord();
        return record[key] !== undefined ? record[key] : (params.defaultValue ?? null);
      }
      case 'set': {
        const key = String(params.key ?? '');
        const record = await readSettingsRecord();
        record[key] = params.value;
        await context.scopedVfs.writeUserData(settingsPath, JSON.stringify(record, null, 2));
        return { success: true };
      }
      case 'getAll': {
        return readSettingsRecord();
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown settings action: ${action}` };
    }
  }

  private async handleNotifications(
    context: SandboxContext,
    action: string,
    params: any,
  ): Promise<any> {
    switch (action) {
      case 'send': {
        this.assertPermission(context, 'notifications.send');

        const title = String(params.title || '');
        const body = String(params.body || '');
        const icon = params.icon ? String(params.icon) : undefined;

        this.hostServices.onNotification?.(context.appId, { title, body, icon });
        return { delivered: true };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown notifications action: ${action}` };
    }
  }

  private async handlePermissions(
    context: SandboxContext,
    action: string,
    params: any,
  ): Promise<any> {
    switch (action) {
      case 'check': {
        const perm = this.validateRequestedPermission(context, params.permission);
        return { granted: context.grantedPermissions.has(perm) };
      }
      case 'request': {
        const perm = this.validateRequestedPermission(context, params.permission);
        if (context.grantedPermissions.has(perm)) {
          return { granted: true };
        }

        if (this.hostServices.onRequestPermission) {
          const granted = await this.hostServices.onRequestPermission(context.appId, perm);
          if (granted) {
            context.grantedPermissions.add(perm);
            await this.hostServices.onPermissionGranted?.(context.appId, perm);
          }
          return { granted };
        }

        return { granted: false };
      }
      case 'list': {
        return { permissions: Array.from(context.grantedPermissions) };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown permissions action: ${action}` };
    }
  }

  private async handleFiles(context: SandboxContext, action: string, params: any): Promise<any> {
    const path = String(params.path || '');

    switch (action) {
      case 'readText': {
        this.assertPermission(context, 'filesystem.appdata.read');
        const content = await context.scopedVfs.readUserDataText(path);
        return { content };
      }
      case 'writeText': {
        this.assertPermission(context, 'filesystem.appdata.write');
        await context.scopedVfs.writeUserData(path, String(params.content ?? ''));
        return { written: true };
      }
      case 'delete': {
        this.assertPermission(context, 'filesystem.appdata.write');
        await context.scopedVfs.deleteUserData(path);
        return { deleted: true };
      }
      case 'list': {
        this.assertPermission(context, 'filesystem.appdata.read');
        const files = await context.scopedVfs.listUserData(path);
        return { files };
      }
      case 'saveText': {
        this.assertPermission(context, 'filesystem.user-selected.write');
        const suggestedName = String(params.suggestedName ?? 'document.txt');
        const content = String(params.content ?? '');
        const mimeType = String(params.mimeType ?? 'text/plain');
        const hasUnsafeCharacter = Array.from(suggestedName).some((character) => {
          const code = character.charCodeAt(0);
          return code <= 0x1f || '\\/:*?"<>|'.includes(character);
        });
        if (!suggestedName || suggestedName.length > 160 || hasUnsafeCharacter) {
          throw { code: 'INVALID_INPUT', message: 'A safe suggested file name is required.' };
        }
        if (new TextEncoder().encode(content).byteLength > 10 * 1024 * 1024) {
          throw { code: 'INVALID_INPUT', message: 'Text export exceeds the 10 MiB limit.' };
        }
        if (!this.hostServices.onSaveTextFile) {
          throw { code: 'UNAVAILABLE', message: 'Saving a user-selected file is unavailable.' };
        }
        return this.hostServices.onSaveTextFile(suggestedName, content, mimeType);
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown files action: ${action}` };
    }
  }

  private async handleEvents(context: SandboxContext, action: string, params: any): Promise<any> {
    switch (action) {
      case 'subscribe': {
        const requestedName = String(params.eventName || '');
        const eventName =
          requestedName.startsWith('app.') || requestedName.startsWith('system.')
            ? requestedName
            : `app.${context.appId}.${requestedName}`;
        if (!eventName || eventName.endsWith('.')) {
          throw { code: 'INVALID_EVENT', message: 'A valid event name is required' };
        }
        if (eventName === 'system' || eventName.startsWith('system.')) {
          this.assertPermission(context, 'events.system.subscribe');
        } else if (eventName.startsWith('app.') && !eventName.startsWith(`app.${context.appId}.`)) {
          this.assertPermission(context, 'events.cross-app.subscribe');
        }
        let subscribers = this.eventSubscriptions.get(eventName);
        if (!subscribers) {
          subscribers = new Set<string>();
          this.eventSubscriptions.set(eventName, subscribers);
        }
        subscribers.add(context.instanceId);
        return { subscribed: true, eventName };
      }
      case 'emit': {
        const eventName = String(params.eventName || '');

        // Security check: Apps cannot emit into the reserved system.* namespace
        if (eventName.startsWith('system.') || eventName === 'system') {
          throw {
            code: 'RESERVED_EVENT_NAMESPACE',
            message: `Application "${context.appId}" is prohibited from emitting into the reserved "system.*" namespace`,
          };
        }

        const namespacedName = eventName.startsWith(`app.${context.appId}.`)
          ? eventName
          : `app.${context.appId}.${eventName}`;

        this.hostServices.onEmitEvent?.(namespacedName, params.payload);
        this.broadcastEvent(namespacedName, params.payload);
        return { emitted: true, eventName: namespacedName };
      }
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown events action: ${action}` };
    }
  }

  /**
   * Broadcast an event to all sandboxed application instances subscribed to it
   */
  broadcastEvent(eventName: string, payload: any): void {
    const subscribers = this.eventSubscriptions.get(eventName);
    if (!subscribers) return;

    const notification: IPCEventNotification = {
      type: 'event',
      eventName,
      payload,
    };

    for (const instId of subscribers) {
      const ctx = this.contexts.get(instId);
      if (ctx?.postMessage) {
        ctx.postMessage(notification);
      }
    }
  }

  /**
   * Core broadcast utility strictly for Core system events
   */
  broadcastSystemEvent(eventName: string, payload: any): void {
    const fullName = eventName.startsWith('system.') ? eventName : `system.${eventName}`;
    this.hostServices.onEmitEvent?.(fullName, payload);
    this.broadcastEvent(fullName, payload);
  }

  private assertPermission(context: SandboxContext, permission: PermissionIdentifier): void {
    if (!context.grantedPermissions.has(permission)) {
      throw {
        code: 'PERMISSION_DENIED',
        message: `Application '${context.appId}' lacks required permission '${permission}'`,
        details: { requiredPermission: permission },
      };
    }
  }

  private validateRequestedPermission(
    context: SandboxContext,
    rawPermission: unknown,
  ): PermissionIdentifier {
    const permission = String(rawPermission ?? '') as PermissionIdentifier;
    if (!KNOWN_PERMISSIONS.has(permission)) {
      throw { code: 'UNKNOWN_PERMISSION', message: `Unknown permission '${permission}'` };
    }
    if (!context.requestedPermissions.has(permission)) {
      throw {
        code: 'UNDECLARED_PERMISSION',
        message: `Application '${context.appId}' did not declare permission '${permission}'`,
      };
    }
    return permission;
  }
}
