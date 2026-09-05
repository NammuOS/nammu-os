import type { PlatformCapabilities, PlatformRuntime } from './contracts';
import { getPlatformRuntime } from './runtime';
import { tauriPlatformCapabilities } from './tauri';
import { webPlatformCapabilities } from './web';

const capabilitiesByRuntime: Readonly<Record<PlatformRuntime, PlatformCapabilities>> =
  Object.freeze({
    web: webPlatformCapabilities,
    tauri: tauriPlatformCapabilities,
  });

export function getPlatformCapabilities(
  runtime: PlatformRuntime = getPlatformRuntime(),
): PlatformCapabilities {
  return capabilitiesByRuntime[runtime];
}

export { detectPlatformRuntime, getPlatformRuntime } from './runtime';
export type {
  CapabilityResult,
  FilesystemError,
  FilesystemErrorCode,
  FilesystemResult,
  NativeDirectoryListing,
  NativeDeletionCancellationMode,
  NativeDeletionFailure,
  NativeDeletionOperationSnapshot,
  NativeDeletionOperationType,
  NativeDeletionSuccess,
  NativeFileBreadcrumb,
  NativeFileKind,
  NativeFileConflictStrategy,
  NativeFileMetadata,
  NativeFileMutation,
  NativeFileOperationFailure,
  NativeFileOperationSnapshot,
  NativeFileOperationState,
  NativeFileOperationSuccess,
  NativeFileOperationType,
  NativeFileRoot,
  NativeFileRootKind,
  NativeFileRoots,
  PickedFiles,
  PickedPlatformFile,
  PickFilesOptions,
  PlatformCapabilities,
  PlatformFileFilter,
  PlatformFilesystem,
  PlatformNotification,
  PlatformNotificationPermission,
  PlatformRuntime,
  PlatformServiceInfo,
  PlatformServices,
  PlatformWebSurfaces,
  SavedFile,
  SaveFileOptions,
  WebSurfaceBounds,
  WebSurfaceControl,
  WebSurfaceOwner,
  WebSurfaceOpenRequest,
  WebSurfaceSnapshot,
} from './contracts';
