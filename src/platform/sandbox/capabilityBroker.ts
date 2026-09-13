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

import {
  KNOWN_PERMISSIONS,
  type CapabilityDeclaration,
  type PermissionIdentifier,
  type WebSurfaceCapability,
} from '../nmu/nappSpec';
import type { ScopedVFS } from '../vfs/vfsContracts';
import {
  PACKAGE_ASSET_LIMIT_BYTES,
  PACKAGE_BINARY_LIMIT_BYTES,
  PACKAGE_SERVICE_REQUEST_LIMIT_BYTES,
  PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES,
  type PackageBinaryFile,
  type PackageLifecycleState,
  type PackageServiceRequest,
  type PackageServiceResponse,
  type PackageSurfaceBounds,
  type PackageSurfaceControl,
  type PackageSurfaceCreateRequest,
  type PackageSurfaceSnapshot,
  isSafePackagePath,
  isSafeSurfaceBounds,
} from './integrationContracts';

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
  capabilities?: readonly CapabilityDeclaration[];
  lifecycleState?: PackageLifecycleState;
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
  onPickBinaryFiles?: (options: {
    multiple: boolean;
    filters: Array<{ name: string; extensions?: string[]; mimeTypes?: string[] }>;
  }) => Promise<{ cancelled: boolean; files: PackageBinaryFile[] }>;
  onSaveBinaryFile?: (options: {
    suggestedName: string;
    mimeType?: string;
    bytes: Uint8Array;
  }) => Promise<{ saved: boolean; fileName?: string }>;
  onServiceRequest?: (
    instanceId: string,
    appId: string,
    request: PackageServiceRequest,
  ) => Promise<PackageServiceResponse>;
  onWebSurfaceCreate?: (
    instanceId: string,
    appId: string,
    declaration: WebSurfaceCapability,
    request: PackageSurfaceCreateRequest,
  ) => Promise<PackageSurfaceSnapshot>;
  onWebSurfaceDestroy?: (instanceId: string, surfaceId: string) => Promise<void>;
  onWebSurfaceNavigate?: (instanceId: string, surfaceId: string, url: string) => Promise<void>;
  onWebSurfaceControl?: (
    instanceId: string,
    surfaceId: string,
    control: PackageSurfaceControl,
  ) => Promise<void>;
  onWebSurfaceSetBounds?: (
    instanceId: string,
    surfaceId: string,
    bounds: PackageSurfaceBounds,
  ) => Promise<void>;
  onWebSurfaceSetVisible?: (
    instanceId: string,
    surfaceId: string,
    visible: boolean,
  ) => Promise<void>;
  onWebSurfaceFocus?: (instanceId: string, surfaceId: string) => Promise<void>;
  onWebSurfaceGetState?: (instanceId: string, surfaceId: string) => Promise<PackageSurfaceSnapshot>;
}

export class CapabilityBroker {
  private contexts = new Map<string, SandboxContext>(); // instanceId -> SandboxContext
  private eventSubscriptions = new Map<string, Set<string>>(); // eventName -> Set<instanceId>
  private hostServices: HostServices;
  private surfaceOwners = new Map<string, { instanceId: string; capability: string }>();

  constructor(hostServices: HostServices = {}) {
    this.hostServices = hostServices;
  }

  registerContext(context: SandboxContext): void {
    this.contexts.set(context.instanceId, context);
  }

  async unregisterContext(instanceId: string): Promise<void> {
    this.contexts.delete(instanceId);
    for (const [_, subscribers] of this.eventSubscriptions.entries()) {
      subscribers.delete(instanceId);
    }
    const owned = [...this.surfaceOwners.entries()]
      .filter(([, owner]) => owner.instanceId === instanceId)
      .map(([id]) => id);
    await Promise.allSettled(
      owned.map(async (id) => {
        this.surfaceOwners.delete(id);
        await this.hostServices.onWebSurfaceDestroy?.(instanceId, id);
      }),
    );
  }

  updateLifecycle(instanceId: string, state: PackageLifecycleState): void {
    const context = this.contexts.get(instanceId);
    if (!context) return;
    context.lifecycleState = { ...state };
    context.postMessage?.({ type: 'event', eventName: 'system.lifecycle', payload: state });
  }

  publishSurfaceState(instanceId: string, snapshot: PackageSurfaceSnapshot): void {
    if (this.surfaceOwners.get(snapshot.id)?.instanceId !== instanceId) return;
    this.contexts.get(instanceId)?.postMessage?.({
      type: 'event',
      eventName: `system.web-surface.${snapshot.id}`,
      payload: snapshot,
    });
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
      case 'assets':
        return this.handleAssets(context, action, params);
      case 'services':
        return this.handleServices(context, action, params);
      case 'webSurfaces':
        return this.handleWebSurfaces(context, action, params);
      case 'lifecycle':
        return this.handleLifecycle(context, action);
      default:
        throw {
          code: 'INVALID_METHOD',
          message: `Unknown subsystem or method: ${method}`,
        };
    }
  }

  private capability<T extends CapabilityDeclaration['type']>(
    context: SandboxContext,
    type: T,
    name: string,
  ): Extract<CapabilityDeclaration, { type: T }> {
    const declaration = context.capabilities?.find(
      (candidate) => candidate.type === type && 'name' in candidate && candidate.name === name,
    );
    if (!declaration) {
      throw {
        code: 'UNDECLARED_CAPABILITY',
        message: `Application '${context.appId}' did not declare ${type} capability '${name}'.`,
      };
    }
    return declaration as Extract<CapabilityDeclaration, { type: T }>;
  }

  private async handleAssets(context: SandboxContext, action: string, params: any) {
    if (action !== 'read') {
      throw { code: 'INVALID_METHOD', message: `Unknown assets action: ${action}` };
    }
    const path = String(params.path ?? '');
    if (!isSafePackagePath(path)) {
      throw { code: 'INVALID_INPUT', message: 'A safe package-relative asset path is required.' };
    }
    const bytes = await context.scopedVfs.readAppFile(path);
    if (bytes.byteLength > PACKAGE_ASSET_LIMIT_BYTES) {
      throw { code: 'PAYLOAD_TOO_LARGE', message: 'Package asset exceeds the 64 MiB limit.' };
    }
    return { bytes, size: bytes.byteLength };
  }

  private async handleLifecycle(context: SandboxContext, action: string) {
    if (action !== 'getState') {
      throw { code: 'INVALID_METHOD', message: `Unknown lifecycle action: ${action}` };
    }
    return (
      context.lifecycleState ?? {
        phase: 'active',
        visible: true,
        focused: true,
        active: true,
        suspended: false,
      }
    );
  }

  private async handleServices(context: SandboxContext, action: string, params: any) {
    if (action !== 'request') {
      throw { code: 'INVALID_METHOD', message: `Unknown services action: ${action}` };
    }
    this.assertPermission(context, 'integration.services');
    const service = String(params.service ?? '');
    this.capability(context, 'service', service);
    const operation = String(params.operation ?? '');
    if (!/^[a-z][a-z0-9.-]{0,79}$/.test(operation)) {
      throw { code: 'INVALID_INPUT', message: 'A safe service operation is required.' };
    }
    this.assertStructuredPayloadSize(
      params.payload,
      PACKAGE_SERVICE_REQUEST_LIMIT_BYTES,
      'Service request',
    );
    if (!this.hostServices.onServiceRequest) {
      throw { code: 'UNAVAILABLE', message: 'Packaged application services are unavailable.' };
    }
    const response = await this.hostServices.onServiceRequest(context.instanceId, context.appId, {
      service,
      operation,
      payload: params.payload,
    });
    this.assertStructuredPayloadSize(
      response,
      PACKAGE_SERVICE_RESPONSE_LIMIT_BYTES,
      'Service response',
    );
    return response;
  }

  private assertStructuredPayloadSize(value: unknown, maximum: number, label: string): void {
    let encoded: Uint8Array;
    try {
      encoded = new TextEncoder().encode(JSON.stringify(value ?? null));
    } catch {
      throw { code: 'INVALID_INPUT', message: `${label} must be serializable.` };
    }
    if (encoded.byteLength > maximum) {
      throw { code: 'LIMIT_REACHED', message: `${label} exceeds the supported size.` };
    }
  }

  private requireOwnedSurface(context: SandboxContext, rawId: unknown): string {
    const id = String(rawId ?? '');
    if (!id || this.surfaceOwners.get(id)?.instanceId !== context.instanceId) {
      throw {
        code: 'SURFACE_NOT_OWNED',
        message: 'The web surface does not belong to this application instance.',
      };
    }
    return id;
  }

  private async handleWebSurfaces(context: SandboxContext, action: string, params: any) {
    this.assertPermission(context, 'integration.web-surfaces');
    if (action === 'create') {
      const capabilityName = String(params.capability ?? '');
      const declaration = this.capability(context, 'web-surface', capabilityName);
      const count = [...this.surfaceOwners.values()].filter(
        (owner) => owner.instanceId === context.instanceId && owner.capability === capabilityName,
      ).length;
      if (count >= (declaration.maxSurfaces ?? 1)) {
        throw { code: 'LIMIT_REACHED', message: 'The declared web-surface limit was reached.' };
      }
      const request: PackageSurfaceCreateRequest = {
        capability: capabilityName,
        profileKey: String(params.profileKey ?? 'default'),
        privateSession: params.privateSession === true,
        url: String(params.url ?? ''),
        bounds: params.bounds as PackageSurfaceBounds,
        visible: params.visible !== false,
      };
      if (!/^[a-z0-9-]{1,80}$/.test(request.profileKey) || !isSafeSurfaceBounds(request.bounds)) {
        throw { code: 'INVALID_INPUT', message: 'The web-surface request is invalid.' };
      }
      this.assertSurfaceUrl(declaration, request.url);
      if (!this.hostServices.onWebSurfaceCreate) {
        throw { code: 'UNAVAILABLE', message: 'Host-managed web surfaces are unavailable.' };
      }
      const snapshot = await this.hostServices.onWebSurfaceCreate(
        context.instanceId,
        context.appId,
        declaration,
        request,
      );
      if (!snapshot?.id || this.surfaceOwners.has(snapshot.id)) {
        throw { code: 'INVALID_HOST_RESPONSE', message: 'The host returned an invalid surface.' };
      }
      this.surfaceOwners.set(snapshot.id, {
        instanceId: context.instanceId,
        capability: capabilityName,
      });
      return snapshot;
    }

    const id = this.requireOwnedSurface(context, params.id);
    switch (action) {
      case 'destroy':
        await this.hostServices.onWebSurfaceDestroy?.(context.instanceId, id);
        this.surfaceOwners.delete(id);
        return { destroyed: true };
      case 'navigate': {
        const url = String(params.url ?? '');
        const capabilityName = String(params.capability ?? '');
        if (this.surfaceOwners.get(id)?.capability !== capabilityName) {
          throw {
            code: 'CAPABILITY_MISMATCH',
            message: 'The surface capability cannot be changed.',
          };
        }
        this.assertSurfaceUrl(this.capability(context, 'web-surface', capabilityName), url);
        if (!this.hostServices.onWebSurfaceNavigate)
          throw { code: 'UNAVAILABLE', message: 'Web-surface navigation is unavailable.' };
        await this.hostServices.onWebSurfaceNavigate(context.instanceId, id, url);
        return { navigated: true };
      }
      case 'control': {
        const control = String(params.control ?? '') as PackageSurfaceControl;
        if (!['reload', 'stop', 'go-back', 'go-forward', 'mute', 'unmute'].includes(control)) {
          throw { code: 'INVALID_INPUT', message: 'Unknown web-surface control.' };
        }
        if (!this.hostServices.onWebSurfaceControl)
          throw { code: 'UNAVAILABLE', message: 'Web-surface controls are unavailable.' };
        await this.hostServices.onWebSurfaceControl(context.instanceId, id, control);
        return { controlled: true };
      }
      case 'setBounds':
        if (!isSafeSurfaceBounds(params.bounds))
          throw { code: 'INVALID_INPUT', message: 'The web-surface bounds are invalid.' };
        if (!this.hostServices.onWebSurfaceSetBounds)
          throw { code: 'UNAVAILABLE', message: 'Web-surface layout is unavailable.' };
        await this.hostServices.onWebSurfaceSetBounds(context.instanceId, id, params.bounds);
        return { updated: true };
      case 'setVisible':
        if (!this.hostServices.onWebSurfaceSetVisible)
          throw { code: 'UNAVAILABLE', message: 'Web-surface visibility is unavailable.' };
        await this.hostServices.onWebSurfaceSetVisible(
          context.instanceId,
          id,
          params.visible === true,
        );
        return { updated: true };
      case 'detach':
        if (!this.hostServices.onWebSurfaceSetVisible)
          throw { code: 'UNAVAILABLE', message: 'Web-surface detachment is unavailable.' };
        await this.hostServices.onWebSurfaceSetVisible(context.instanceId, id, false);
        return { detached: true };
      case 'attach':
        if (!isSafeSurfaceBounds(params.bounds))
          throw { code: 'INVALID_INPUT', message: 'The web-surface bounds are invalid.' };
        if (!this.hostServices.onWebSurfaceSetBounds || !this.hostServices.onWebSurfaceSetVisible) {
          throw { code: 'UNAVAILABLE', message: 'Web-surface attachment is unavailable.' };
        }
        await this.hostServices.onWebSurfaceSetBounds(context.instanceId, id, params.bounds);
        await this.hostServices.onWebSurfaceSetVisible(context.instanceId, id, true);
        return { attached: true };
      case 'focus':
        if (!this.hostServices.onWebSurfaceFocus)
          throw { code: 'UNAVAILABLE', message: 'Web-surface focus is unavailable.' };
        await this.hostServices.onWebSurfaceFocus(context.instanceId, id);
        return { focused: true };
      case 'getState':
        if (!this.hostServices.onWebSurfaceGetState)
          throw { code: 'UNAVAILABLE', message: 'Web-surface state is unavailable.' };
        return this.hostServices.onWebSurfaceGetState(context.instanceId, id);
      default:
        throw { code: 'INVALID_METHOD', message: `Unknown webSurfaces action: ${action}` };
    }
  }

  private assertSurfaceUrl(declaration: WebSurfaceCapability, raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw { code: 'INVALID_INPUT', message: 'A valid HTTP or HTTPS URL is required.' };
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      raw.length > 8_192
    ) {
      throw {
        code: 'INVALID_INPUT',
        message: 'Only credential-free HTTP and HTTPS URLs are allowed.',
      };
    }
    if (
      declaration.navigation.mode === 'approved-origins' &&
      !declaration.navigation.origins.includes(url.origin)
    ) {
      throw { code: 'NAVIGATION_DENIED', message: 'The URL is outside the declared origins.' };
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
      case 'pickBinary': {
        this.assertPermission(context, 'filesystem.user-selected.read');
        if (!this.hostServices.onPickBinaryFiles) {
          throw { code: 'UNAVAILABLE', message: 'Selecting binary files is unavailable.' };
        }
        const multiple = params.multiple === true;
        const filters = Array.isArray(params.filters)
          ? params.filters.slice(0, 16).map((raw: any) => {
              const name = String(raw?.name ?? 'Files').slice(0, 80);
              const extensions = Array.isArray(raw?.extensions)
                ? raw.extensions
                    .map(String)
                    .filter((value: string) => /^[a-z0-9]{1,16}$/i.test(value))
                    .slice(0, 32)
                : undefined;
              const mimeTypes = Array.isArray(raw?.mimeTypes)
                ? raw.mimeTypes
                    .map(String)
                    .filter((value: string) => /^[a-z0-9.+-]+\/[a-z0-9.+*-]+$/i.test(value))
                    .slice(0, 32)
                : undefined;
              return { name, extensions, mimeTypes };
            })
          : [];
        const result = await this.hostServices.onPickBinaryFiles({ multiple, filters });
        if (result.files.length > (multiple ? 32 : 1)) {
          throw { code: 'PAYLOAD_TOO_LARGE', message: 'Too many files were selected.' };
        }
        let total = 0;
        for (const file of result.files) {
          if (!(file.bytes instanceof Uint8Array) || file.size !== file.bytes.byteLength) {
            throw {
              code: 'INVALID_HOST_RESPONSE',
              message: 'The selected file payload is invalid.',
            };
          }
          total += file.size;
        }
        if (total > PACKAGE_BINARY_LIMIT_BYTES) {
          throw {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Selected files exceed the 32 MiB transfer limit.',
          };
        }
        return result;
      }
      case 'saveBinary': {
        this.assertPermission(context, 'filesystem.user-selected.write');
        const suggestedName = String(params.suggestedName ?? 'download.bin');
        const bytes = params.bytes;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > PACKAGE_BINARY_LIMIT_BYTES) {
          throw {
            code: 'INVALID_INPUT',
            message: 'Binary export exceeds the 32 MiB transfer limit.',
          };
        }
        if (
          !suggestedName ||
          suggestedName.length > 160 ||
          [...suggestedName].some(
            (character) => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character),
          )
        ) {
          throw { code: 'INVALID_INPUT', message: 'A safe suggested file name is required.' };
        }
        if (!this.hostServices.onSaveBinaryFile) {
          throw { code: 'UNAVAILABLE', message: 'Saving binary files is unavailable.' };
        }
        return this.hostServices.onSaveBinaryFile({
          suggestedName,
          mimeType: typeof params.mimeType === 'string' ? params.mimeType : undefined,
          bytes,
        });
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
