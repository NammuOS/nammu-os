import type {
  CapabilityResult,
  FilesystemResult,
  NativeDirectoryListing,
  NativeDeletionOperationSnapshot,
  NativeFileMetadata,
  NativeFileMutation,
  NativeFileOperationSnapshot,
  NativeFileRoots,
  PickFilesOptions,
  PickedFiles,
  PlatformCapabilities,
  PlatformNotification,
  PlatformNotificationPermission,
  PlatformServices,
  PlatformWebSurfaces,
  SaveFileOptions,
  SavedFile,
} from './contracts';
import {
  acceptFromFilters,
  denied,
  errorMessage,
  invalidInput,
  isPermissionError,
  normalizeExternalUrl,
  normalizeSuggestedFileName,
  operationError,
  success,
  unsupported,
} from './shared';

export interface WebPlatformEnvironment {
  getWindow(): Window | undefined;
  getDocument(): Document | undefined;
  getNavigator(): Navigator | undefined;
  getNotification(): typeof Notification | undefined;
  getUrl(): typeof URL | undefined;
  getFetch?(): PlatformFetch | undefined;
  getLocationOrigin?(): string | undefined;
}

type PlatformFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const browserEnvironment: WebPlatformEnvironment = {
  getWindow: () => (typeof window === 'undefined' ? undefined : window),
  getDocument: () => (typeof document === 'undefined' ? undefined : document),
  getNavigator: () => (typeof navigator === 'undefined' ? undefined : navigator),
  getNotification: () => (typeof Notification === 'undefined' ? undefined : Notification),
  getUrl: () => (typeof URL === 'undefined' ? undefined : URL),
  getFetch: () =>
    typeof globalThis.fetch === 'undefined' ? undefined : globalThis.fetch.bind(globalThis),
  getLocationOrigin: () =>
    typeof globalThis.location === 'undefined' ? undefined : globalThis.location.origin,
};

function normalizeServicePath(pathAndQuery: string): string {
  if (
    typeof pathAndQuery !== 'string' ||
    pathAndQuery.length > 2_048 ||
    !pathAndQuery.startsWith('/api/') ||
    pathAndQuery.startsWith('//') ||
    pathAndQuery.includes('\\') ||
    pathAndQuery.includes('#')
  ) {
    throw new TypeError('Platform service requests require a relative /api/ path.');
  }
  return pathAndQuery;
}

function createWebPlatformServices(environment: WebPlatformEnvironment): PlatformServices {
  return Object.freeze({
    async ready() {
      return {
        runtime: 'web' as const,
        origin: environment.getLocationOrigin?.() ?? null,
        instanceId: null,
      };
    },
    async request(pathAndQuery: string, init: RequestInit = {}) {
      const fetchImplementation = environment.getFetch?.();
      if (!fetchImplementation) throw new Error('The web service transport is unavailable.');
      const target = normalizeServicePath(pathAndQuery);
      return fetchImplementation(target, {
        ...init,
        credentials: init.credentials ?? 'same-origin',
      });
    },
    async wispUrl() {
      const origin = environment.getLocationOrigin?.();
      if (!origin) throw new Error('The web Wisp origin is unavailable.');
      const url = new URL('/firefox-wisp/', origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return url.toString();
    },
  });
}

function webFailure<T>(error: unknown, fallback: string): CapabilityResult<T> {
  return isPermissionError(error)
    ? denied('The browser denied permission for this operation.')
    : operationError(errorMessage(error, fallback));
}

const webSurfacesUnsupportedReason =
  'Native child web surfaces are unavailable in the web runtime.';
const nativeFilesystemUnsupportedReason =
  'This PC is available only in the Nammu desktop application.';

function unsupportedFilesystem<T>(): FilesystemResult<T> {
  return { status: 'unsupported', reason: nativeFilesystemUnsupportedReason };
}

const webPlatformWebSurfaceImplementation: PlatformWebSurfaces = {
  supported: false,
  async create() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async destroy() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async navigate() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async control() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async setBounds() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async setVisible() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async focus() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async setZoom() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async getState() {
    return unsupported(webSurfacesUnsupportedReason);
  },
  async subscribe() {
    return () => {};
  },
  async subscribeOpenRequests() {
    return () => {};
  },
};
const webPlatformWebSurfaces = Object.freeze(webPlatformWebSurfaceImplementation);

export function createWebPlatformCapabilities(
  environment: WebPlatformEnvironment = browserEnvironment,
): PlatformCapabilities {
  return Object.freeze({
    runtime: 'web' as const,
    services: createWebPlatformServices(environment),
    webSurfaces: webPlatformWebSurfaces,
    filesystem: Object.freeze({
      supported: false,
      async listRoots(): Promise<FilesystemResult<NativeFileRoots>> {
        return unsupportedFilesystem();
      },
      async listDirectory(): Promise<FilesystemResult<NativeDirectoryListing>> {
        return unsupportedFilesystem();
      },
      async stat(): Promise<FilesystemResult<NativeFileMetadata>> {
        return unsupportedFilesystem();
      },
      async createDirectory(): Promise<FilesystemResult<NativeFileMutation>> {
        return unsupportedFilesystem<NativeFileMutation>();
      },
      async createFile(): Promise<FilesystemResult<NativeFileMutation>> {
        return unsupportedFilesystem<NativeFileMutation>();
      },
      async rename(): Promise<FilesystemResult<NativeFileMutation>> {
        return unsupportedFilesystem<NativeFileMutation>();
      },
      async copy(): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        return unsupportedFilesystem<NativeFileOperationSnapshot>();
      },
      async move(): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        return unsupportedFilesystem<NativeFileOperationSnapshot>();
      },
      async duplicate(): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        return unsupportedFilesystem<NativeFileOperationSnapshot>();
      },
      async getOperation(): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        return unsupportedFilesystem<NativeFileOperationSnapshot>();
      },
      async cancelOperation(): Promise<FilesystemResult<NativeFileOperationSnapshot>> {
        return unsupportedFilesystem<NativeFileOperationSnapshot>();
      },
      async trash(): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        return unsupportedFilesystem<NativeDeletionOperationSnapshot>();
      },
      async permanentlyDelete(): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        return unsupportedFilesystem<NativeDeletionOperationSnapshot>();
      },
      async restore(): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        return unsupportedFilesystem<NativeDeletionOperationSnapshot>();
      },
      async getDeletionOperation(): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        return unsupportedFilesystem<NativeDeletionOperationSnapshot>();
      },
      async cancelDeletionOperation(): Promise<FilesystemResult<NativeDeletionOperationSnapshot>> {
        return unsupportedFilesystem<NativeDeletionOperationSnapshot>();
      },
    }),
    files: Object.freeze({
      async pick(options: PickFilesOptions = {}): Promise<CapabilityResult<PickedFiles>> {
        const documentObject = environment.getDocument();
        if (!documentObject?.createElement) {
          return unsupported('File selection requires a browser document.');
        }

        return new Promise((resolve) => {
          const input = documentObject.createElement('input');
          input.type = 'file';
          input.multiple = Boolean(options.multiple);
          input.accept = acceptFromFilters(options.filters);
          input.hidden = true;

          let settled = false;
          const finish = (result: CapabilityResult<PickedFiles>) => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(result);
          };

          input.addEventListener(
            'change',
            () => {
              const files = [...(input.files ?? [])];
              if (files.length === 0) {
                finish({ status: 'cancelled' });
                return;
              }

              void Promise.all(
                files.map(async (file) => ({
                  name: file.name,
                  mimeType: file.type || null,
                  size: file.size,
                  bytes: new Uint8Array(await file.arrayBuffer()),
                })),
              )
                .then((pickedFiles) => finish(success({ files: pickedFiles })))
                .catch((error) =>
                  finish(webFailure(error, 'The selected file could not be read.')),
                );
            },
            { once: true },
          );
          input.addEventListener('cancel', () => finish({ status: 'cancelled' }), { once: true });

          (documentObject.body ?? documentObject.documentElement)?.append(input);
          input.click();
        });
      },

      async save(options: SaveFileOptions): Promise<CapabilityResult<SavedFile>> {
        const fileName = normalizeSuggestedFileName(options.suggestedName);
        if (!fileName) return invalidInput('A safe file name is required.');

        const documentObject = environment.getDocument();
        const windowObject = environment.getWindow();
        const UrlApi = environment.getUrl();
        if (
          !documentObject?.createElement ||
          !windowObject ||
          !UrlApi ||
          typeof Blob === 'undefined'
        ) {
          return unsupported('Saving files requires browser download APIs.');
        }

        try {
          const blob = new Blob([options.contents as BlobPart], {
            type: options.mimeType || 'application/octet-stream',
          });
          const objectUrl = UrlApi.createObjectURL(blob);
          const anchor = documentObject.createElement('a');
          anchor.href = objectUrl;
          anchor.download = fileName;
          anchor.rel = 'noopener';
          anchor.hidden = true;
          (documentObject.body ?? documentObject.documentElement)?.append(anchor);
          anchor.click();
          anchor.remove();
          windowObject.setTimeout(() => UrlApi.revokeObjectURL(objectUrl), 0);
          return success({ fileName });
        } catch (error) {
          return webFailure(error, 'The file could not be saved.');
        }
      },
    }),
    external: Object.freeze({
      async openUrl(input: string): Promise<CapabilityResult<void>> {
        const url = normalizeExternalUrl(input);
        if (!url)
          return invalidInput(
            'Only credential-free HTTP, HTTPS, mailto, and tel URLs are allowed.',
          );

        const documentObject = environment.getDocument();
        if (!documentObject?.createElement)
          return unsupported('Opening external URLs requires a browser document.');

        try {
          const anchor = documentObject.createElement('a');
          anchor.href = url;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer external';
          anchor.hidden = true;
          (documentObject.body ?? documentObject.documentElement)?.append(anchor);
          anchor.click();
          anchor.remove();
          return success(undefined);
        } catch (error) {
          return webFailure(error, 'The URL could not be opened.');
        }
      },
    }),
    clipboard: Object.freeze({
      async readText(): Promise<CapabilityResult<string>> {
        const clipboard = environment.getNavigator()?.clipboard;
        if (!clipboard?.readText) return unsupported('Clipboard reading is not available.');

        try {
          return success(await clipboard.readText());
        } catch (error) {
          return webFailure(error, 'The clipboard could not be read.');
        }
      },
      async writeText(text: string): Promise<CapabilityResult<void>> {
        if (typeof text !== 'string') return invalidInput('Clipboard text must be a string.');
        const clipboard = environment.getNavigator()?.clipboard;
        if (!clipboard?.writeText) return unsupported('Clipboard writing is not available.');

        try {
          await clipboard.writeText(text);
          return success(undefined);
        } catch (error) {
          return webFailure(error, 'The clipboard could not be written.');
        }
      },
    }),
    notifications: Object.freeze({
      async requestPermission(): Promise<CapabilityResult<PlatformNotificationPermission>> {
        const NotificationApi = environment.getNotification();
        if (!NotificationApi?.requestPermission) {
          return unsupported('Notifications are not available.');
        }

        try {
          return success(await NotificationApi.requestPermission());
        } catch (error) {
          return webFailure(error, 'Notification permission could not be requested.');
        }
      },
      async show(notification: PlatformNotification): Promise<CapabilityResult<void>> {
        if (!notification.title.trim()) return invalidInput('A notification title is required.');
        const NotificationApi = environment.getNotification();
        if (!NotificationApi) return unsupported('Notifications are not available.');
        if (NotificationApi.permission !== 'granted') {
          return denied('Notification permission has not been granted.');
        }

        try {
          new NotificationApi(notification.title, {
            body: notification.body,
            icon: notification.iconUrl,
          });
          return success(undefined);
        } catch (error) {
          return webFailure(error, 'The notification could not be shown.');
        }
      },
    }),
    window: Object.freeze({
      async minimize(): Promise<CapabilityResult<void>> {
        return unsupported('Browsers cannot minimize their containing window.');
      },
      async toggleMaximize(): Promise<CapabilityResult<void>> {
        return unsupported('Browsers cannot maximize their containing window.');
      },
      async close(): Promise<CapabilityResult<void>> {
        return unsupported('Browsers cannot reliably close a user-created window.');
      },
    }),
  });
}

export const webPlatformCapabilities = createWebPlatformCapabilities();
