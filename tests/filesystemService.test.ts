import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  categorizeNativeFile,
  buildNativeSearchQuery,
  canStartNativeSearch,
  createDirectoryRefreshCoordinator,
  createFilesNavigationState,
  createFilesClipboard,
  createFilesystemService,
  createLatestRequestGate,
  currentFilesLocation,
  moveFilesHistory,
  pushFilesLocation,
  visibleNativeEntries,
  updateNativeSelection,
} from '../src/components/files/filesystemService';
import type { NativeFileMetadata, PlatformFilesystem } from '../src/platform';

function entry(overrides: Partial<NativeFileMetadata> = {}): NativeFileMetadata {
  return {
    name: 'document.txt',
    path: 'C:\\document.txt',
    kind: 'file',
    sizeBytes: 12,
    createdAtMs: null,
    modifiedAtMs: null,
    extension: 'txt',
    hidden: false,
    system: false,
    readOnly: false,
    readable: true,
    navigable: false,
    ...overrides,
  };
}

describe('Files native filesystem service', () => {
  test('builds literal structured search queries without shell or regex interpretation', () => {
    expect(buildNativeSearchQuery('C:\\Work', 'Invoice', 'current-tree', 'all')).toEqual({
      rootPath: 'C:\\Work',
      text: 'Invoice',
      scope: 'current-tree',
      kind: 'all',
      extensions: [],
    });
    expect(buildNativeSearchQuery('C:\\Work', '*.PDF', 'current-folder', 'all')).toEqual({
      rootPath: 'C:\\Work',
      text: '',
      scope: 'current-folder',
      kind: 'files',
      extensions: ['pdf'],
    });
    expect(
      buildNativeSearchQuery('C:\\Work', 'folder: Projects', 'selected-drive', 'files'),
    ).toEqual({
      rootPath: 'C:\\Work',
      text: 'Projects',
      scope: 'selected-drive',
      kind: 'folders',
      extensions: [],
    });
    expect(
      canStartNativeSearch(buildNativeSearchQuery('C:\\Work', ' ', 'current-tree', 'all')),
    ).toBe(false);
  });

  test('keeps navigation history deterministic and discards forward branches', () => {
    let state = createFilesNavigationState();
    state = pushFilesLocation(state, { kind: 'directory', path: 'C:\\' });
    state = pushFilesLocation(state, { kind: 'directory', path: 'C:\\Users' });
    state = moveFilesHistory(state, -1);
    expect(currentFilesLocation(state)).toEqual({ kind: 'directory', path: 'C:\\' });
    state = pushFilesLocation(state, { kind: 'directory', path: 'D:\\' });
    expect(state.entries).toEqual([
      { kind: 'roots' },
      { kind: 'directory', path: 'C:\\' },
      { kind: 'directory', path: 'D:\\' },
    ]);
    expect(moveFilesHistory(state, 1)).toBe(state);
  });

  test('ignores stale asynchronous filesystem responses', () => {
    const gate = createLatestRequestGate();
    const slow = gate.begin();
    const latest = gate.begin();
    expect(gate.isCurrent(slow)).toBe(false);
    expect(gate.isCurrent(latest)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(latest)).toBe(false);
  });

  test('coalesces watcher bursts and rejects stale directory generations', () => {
    const scheduled = new Map<number, () => void>();
    const cancelled: number[] = [];
    const refreshed: string[] = [];
    let timerId = 0;
    const coordinator = createDirectoryRefreshCoordinator(
      (path) => refreshed.push(path),
      (callback) => {
        timerId += 1;
        const currentTimer = timerId;
        scheduled.set(currentTimer, () => {
          scheduled.delete(currentTimer);
          callback();
        });
        return timerId;
      },
      (handle) => {
        cancelled.push(handle as number);
        scheduled.delete(handle as number);
      },
    );
    const first = coordinator.activate('C:\\A');
    for (let index = 0; index < 1_000; index += 1) coordinator.notify('C:\\A', first);
    expect(scheduled.size).toBe(1);
    expect(cancelled).toHaveLength(999);
    const second = coordinator.activate('C:\\B');
    coordinator.notify('C:\\A', first);
    expect(scheduled.size).toBe(0);
    coordinator.notify('C:\\B', second);
    [...scheduled.values()][0]?.();
    expect(refreshed).toEqual(['C:\\B']);
    coordinator.deactivate(second);
    coordinator.notify('C:\\B', second);
    expect(scheduled.size).toBe(0);
  });

  test('categorizes metadata without inspecting file contents', () => {
    expect(categorizeNativeFile(entry({ extension: 'PNG' }))).toBe('image');
    expect(categorizeNativeFile(entry({ extension: 'mkv' }))).toBe('video');
    expect(categorizeNativeFile(entry({ kind: 'directory', extension: null }))).toBe('folder');
    expect(categorizeNativeFile(entry({ extension: 'unrecognized' }))).toBe('unknown');
  });

  test('hides protected entries and caps the initial render batch', () => {
    const entries = Array.from({ length: 900 }, (_, index) =>
      entry({ name: `item-${index}.txt`, path: `C:\\item-${index}.txt` }),
    );
    entries[10] = entry({ name: 'hidden.txt', path: 'C:\\hidden.txt', hidden: true });
    entries[20] = entry({ name: 'system.txt', path: 'C:\\system.txt', system: true });
    const visible = visibleNativeEntries(entries, 400);
    expect(visible).toHaveLength(400);
    expect(visible.some((item) => item.hidden || item.system)).toBe(false);
  });

  test('delegates through the narrow typed filesystem contract', async () => {
    const calls: string[] = [];
    const filesystem: PlatformFilesystem = {
      supported: true,
      async listRoots() {
        calls.push('roots');
        return { status: 'success', value: { roots: [], durationMs: 1 } };
      },
      async listDirectory(path) {
        calls.push(`list:${path}`);
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async stat(path) {
        calls.push(`stat:${path}`);
        return { status: 'success', value: entry({ path }) };
      },
      async createDirectory() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async createFile() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async rename() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async copy() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async move() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async duplicate() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async getOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async trash() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async permanentlyDelete() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async restore() {
        return { status: 'error', error: { code: 'UNDO_UNAVAILABLE', message: 'Missing.' } };
      },
      async getDeletionOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelDeletionOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async watchDirectory() {
        return { status: 'error', error: { code: 'WATCH_UNSUPPORTED', message: 'Unavailable.' } };
      },
      async getWatchDiagnostics() {
        return {
          status: 'success',
          value: { activeWatchers: 0, rawEvents: 0, emittedInvalidations: 0, droppedSignals: 0 },
        };
      },
      async startSearch() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Unavailable.' } };
      },
      async getSearch() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelSearch() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async releaseSearch() {
        return { status: 'success', value: { released: true as const } };
      },
      async getSearchDiagnostics() {
        return {
          status: 'success',
          value: { activeSearches: 0, retainedSearches: 0, retainedResults: 0 },
        };
      },
      async startPreview() {
        return { status: 'error', error: { code: 'PREVIEW_UNSUPPORTED', message: 'Unavailable.' } };
      },
      async getPreview() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async takePreviewBytes() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelPreview() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async releasePreview() {
        return { status: 'success', value: { released: true as const } };
      },
      async getPreviewDiagnostics() {
        return {
          status: 'success',
          value: {
            activeJobs: 0,
            retainedJobs: 0,
            retainedResultBytes: 0,
            cacheEntries: 0,
            cacheBytes: 0,
            maxActiveJobs: 4,
            cacheMaxEntries: 256,
            cacheMaxBytes: 33554432,
          },
        };
      },
      async getProperties() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async startDirectoryMeasurement() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async getDirectoryMeasurement() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelDirectoryMeasurement() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async releaseDirectoryMeasurement() {
        return { status: 'success', value: { released: true as const } };
      },
      async getDirectoryMeasurementDiagnostics() {
        return {
          status: 'success',
          value: { activeJobs: 0, retainedJobs: 0, maxActiveJobs: 2 },
        };
      },
      async openArchive() {
        return { status: 'error', error: { code: 'ARCHIVE_INVALID', message: 'Invalid.' } };
      },
      async listArchiveEntries() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async releaseArchive() {
        return { status: 'success', value: { released: false } };
      },
      async extractArchive() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async createZip() {
        return { status: 'error', error: { code: 'ACCESS_DENIED', message: 'Denied.' } };
      },
      async getArchiveOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async cancelArchiveOperation() {
        return { status: 'error', error: { code: 'NOT_FOUND', message: 'Missing.' } };
      },
      async releaseArchiveOperation() {
        return { status: 'success', value: { released: false } };
      },
      async getArchiveDiagnostics() {
        return {
          status: 'success',
          value: {
            openArchives: 0,
            activeJobs: 0,
            retainedJobs: 0,
            maxActiveJobs: 2,
            maxArchiveEntries: 100000,
            maxTotalUncompressedBytes: 274877906944,
          },
        };
      },
      async pickArchiveDestination() {
        return { status: 'success', value: null };
      },
      async pickZipDestination() {
        return { status: 'success', value: null };
      },
    };
    const service = createFilesystemService(filesystem);
    await service.listRoots();
    await service.listDirectory('C:\\');
    await service.stat('C:\\document.txt');
    expect(calls).toEqual(['roots', 'list:C:\\', 'stat:C:\\document.txt']);
    expect(Object.keys(service).sort()).toEqual([
      'cancelArchiveOperation',
      'cancelDeletionOperation',
      'cancelDirectoryMeasurement',
      'cancelOperation',
      'cancelPreview',
      'cancelSearch',
      'copy',
      'createDirectory',
      'createFile',
      'createZip',
      'duplicate',
      'extractArchive',
      'getArchiveDiagnostics',
      'getArchiveOperation',
      'getDeletionOperation',
      'getDirectoryMeasurement',
      'getDirectoryMeasurementDiagnostics',
      'getOperation',
      'getPreview',
      'getPreviewDiagnostics',
      'getProperties',
      'getSearch',
      'getSearchDiagnostics',
      'getWatchDiagnostics',
      'listArchiveEntries',
      'listDirectory',
      'listRoots',
      'move',
      'openArchive',
      'permanentlyDelete',
      'pickArchiveDestination',
      'pickZipDestination',
      'releaseArchive',
      'releaseArchiveOperation',
      'releaseDirectoryMeasurement',
      'releasePreview',
      'releaseSearch',
      'rename',
      'restore',
      'startDirectoryMeasurement',
      'startPreview',
      'startSearch',
      'stat',
      'supported',
      'takePreviewBytes',
      'trash',
      'watchDirectory',
    ]);
  });

  test('keeps the Files clipboard internal, deduplicated, and navigation-independent', () => {
    const clipboard = createFilesClipboard(
      'copy',
      ['C:\\one.txt', 'C:\\one.txt', 'C:\\two.txt'],
      42,
    );
    expect(clipboard).toEqual({
      operation: 'copy',
      sources: ['C:\\one.txt', 'C:\\two.txt'],
      timestamp: 42,
    });
    let navigation = createFilesNavigationState({ kind: 'directory', path: 'C:\\source' });
    navigation = pushFilesLocation(navigation, { kind: 'directory', path: 'D:\\destination' });
    expect(clipboard?.sources).toEqual(['C:\\one.txt', 'C:\\two.txt']);
    expect(currentFilesLocation(navigation)).toEqual({
      kind: 'directory',
      path: 'D:\\destination',
    });
  });

  test('supports toggle and anchored range multi-selection', () => {
    const paths = ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d'];
    const first = updateNativeSelection(paths, new Set(), paths[1], {
      toggle: false,
      range: false,
      anchorPath: null,
    });
    const range = updateNativeSelection(paths, first.selected, paths[3], {
      toggle: false,
      range: true,
      anchorPath: first.anchorPath,
    });
    expect([...range.selected]).toEqual(['C:\\b', 'C:\\c', 'C:\\d']);
    const toggled = updateNativeSelection(paths, range.selected, paths[2], {
      toggle: true,
      range: false,
      anchorPath: range.anchorPath,
    });
    expect([...toggled.selected]).toEqual(['C:\\b', 'C:\\d']);
  });

  test('grants native filesystem commands only to the local main shell capability', () => {
    const capability = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8'));
    expect(capability.local).toBe(true);
    expect(capability.webviews).toEqual(['main']);
    expect(capability.remote).toBeUndefined();
    expect(capability.permissions).toContain('allow-list-native-file-roots');
    expect(capability.permissions).toContain('allow-list-native-directory');
    expect(capability.permissions).toContain('allow-stat-native-file');
    expect(capability.permissions).toContain('allow-create-native-directory');
    expect(capability.permissions).toContain('allow-create-native-file');
    expect(capability.permissions).toContain('allow-rename-native-file');
    expect(capability.permissions).toContain('allow-start-native-copy');
    expect(capability.permissions).toContain('allow-start-native-move');
    expect(capability.permissions).toContain('allow-start-native-duplicate');
    expect(capability.permissions).toContain('allow-start-native-trash');
    expect(capability.permissions).toContain('allow-start-native-permanent-delete');
    expect(capability.permissions).toContain('allow-start-native-restore');
    expect(capability.permissions).toContain('allow-get-native-deletion-operation');
    expect(capability.permissions).toContain('allow-cancel-native-deletion-operation');
    expect(capability.permissions).toContain('allow-start-native-directory-watch');
    expect(capability.permissions).toContain('allow-stop-native-directory-watch');
    expect(capability.permissions).toContain('allow-get-native-directory-watch-diagnostics');
    expect(capability.permissions).toContain('allow-start-native-file-preview');
    expect(capability.permissions).toContain('allow-take-native-file-preview-bytes');
    expect(capability.permissions).toContain('allow-get-native-file-properties');
    expect(capability.permissions).toContain('allow-start-native-directory-measurement');
    expect(capability.permissions).toContain('allow-cancel-native-directory-measurement');
  });

  test('routes normal Delete to the Recycle Bin and Shift+Delete through confirmation', () => {
    const source = readFileSync('src/components/files/FilesApp.tsx', 'utf8');
    expect(source).toContain('if (event.shiftKey) requestPermanentDelete();');
    expect(source).toContain('else void startTrash();');
    expect(source).toContain('filesystem.trash(sources)');
    expect(source).toContain('filesystem.permanentlyDelete(sources, true)');
    expect(source).toContain('Delete (Recycle Bin)');
    expect(source).toContain('Delete Permanently');
    expect(source).toContain('will not be moved to Recycle Bin and cannot be restored');
  });

  test('binds one live watcher to the current directory and disposes it on lifecycle changes', () => {
    const source = readFileSync('src/components/files/FilesApp.tsx', 'utf8');
    expect(source).toContain('.watchDirectory(watchPath');
    expect(source).toContain('void result.value.dispose()');
    expect(source).toContain('if (subscription) void subscription.dispose()');
    expect(source).toContain('{ background: true }');
    expect(source).toContain('refreshCoordinator.deactivate(generation)');
    expect(source).not.toContain('setInterval(');
  });

  test('keeps search generation-scoped, cancellable, progressively bounded, and separate from watchers', () => {
    const source = readFileSync('src/components/files/FilesApp.tsx', 'utf8');
    expect(source).toContain('const searchGate = useRef(createLatestRequestGate())');
    expect(source).toContain('await filesystem.getSearch(searchId, offset)');
    expect(source).toContain('await filesystem.releaseSearch(id)');
    expect(source).toContain('}, 320)');
    expect(source).toContain("currentLocation.kind === 'directory' && !searchMode");
    expect(source).toContain('nativeVisible.length < nativeEntriesTotal');
    expect(source).toContain('Open file location');
    expect(source).not.toContain('setInterval(');
  });

  test('keeps the Rust Files boundary typed, trusted-main-only, and shell-free', () => {
    const readSource = readFileSync('src-tauri/src/native_filesystem.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const writeSource = readFileSync('src-tauri/src/native_file_operations.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const deleteSource = readFileSync('src-tauri/src/native_recycle_bin.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const watchSource = readFileSync('src-tauri/src/native_directory_watcher.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const searchSource = readFileSync('src-tauri/src/native_file_search.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const previewSource = readFileSync('src-tauri/src/native_file_preview.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const videoPreviewSource = readFileSync('src-tauri/src/native_video_preview.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const propertiesSource = readFileSync('src-tauri/src/native_file_properties.rs', 'utf8').split(
      '#[cfg(test)]',
    )[0];
    const archiveSource = `${readFileSync('src-tauri/src/native_archive/mod.rs', 'utf8').split('#[cfg(test)]')[0]}\n${readFileSync('src-tauri/src/native_archive/safety.rs', 'utf8').split('#[cfg(test)]')[0]}`;
    const readCommands = [
      ...readSource.matchAll(/#\[tauri::command\][\s\S]*?pub async fn (\w+)/g),
    ].map((match) => match[1]);
    const writeCommands = [
      ...writeSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const deleteCommands = [
      ...deleteSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const watchCommands = [
      ...watchSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const searchCommands = [
      ...searchSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const previewCommands = [
      ...previewSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const propertiesCommands = [
      ...propertiesSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    const archiveCommands = [
      ...archiveSource.matchAll(/#\[tauri::command\][\s\S]*?pub (?:async )?fn (\w+)/g),
    ].map((match) => match[1]);
    expect(readCommands).toEqual([
      'list_native_file_roots',
      'list_native_directory',
      'stat_native_file',
    ]);
    expect(writeCommands).toEqual([
      'create_native_directory',
      'create_native_file',
      'rename_native_file',
      'start_native_copy',
      'start_native_move',
      'start_native_duplicate',
      'get_native_file_operation',
      'cancel_native_file_operation',
    ]);
    expect(deleteCommands).toEqual([
      'start_native_trash',
      'start_native_permanent_delete',
      'start_native_restore',
      'get_native_deletion_operation',
      'cancel_native_deletion_operation',
    ]);
    expect(watchCommands).toEqual([
      'start_native_directory_watch',
      'stop_native_directory_watch',
      'get_native_directory_watch_diagnostics',
    ]);
    expect(searchCommands).toEqual([
      'start_native_file_search',
      'get_native_file_search',
      'cancel_native_file_search',
      'release_native_file_search',
      'get_native_file_search_diagnostics',
    ]);
    expect(previewCommands).toEqual([
      'start_native_file_preview',
      'get_native_file_preview',
      'take_native_file_preview_bytes',
      'cancel_native_file_preview',
      'release_native_file_preview',
      'get_native_file_preview_diagnostics',
    ]);
    expect(propertiesCommands).toEqual([
      'get_native_file_properties',
      'start_native_directory_measurement',
      'get_native_directory_measurement',
      'cancel_native_directory_measurement',
      'release_native_directory_measurement',
      'get_native_directory_measurement_diagnostics',
    ]);
    expect(archiveCommands).toEqual([
      'open_native_archive',
      'get_native_archive_entries',
      'release_native_archive',
      'start_native_archive_extract',
      'start_native_zip_create',
      'get_native_archive_operation',
      'cancel_native_archive_operation',
      'release_native_archive_operation',
      'get_native_archive_diagnostics',
    ]);
    for (const source of [
      readSource,
      writeSource,
      deleteSource,
      watchSource,
      searchSource,
      previewSource,
      propertiesSource,
      archiveSource,
    ]) {
      expect(source).not.toContain('std::process::Command');
      expect(source).not.toContain('Command::new');
      expect(source).not.toContain('powershell.exe');
      expect(source).not.toContain('cmd.exe');
      expect(source).not.toContain('runas');
      expect(source).toContain('require_trusted_caller');
    }
    expect(deleteCommands).not.toContain('delete_any_path');
    expect(watchSource).toContain('RecursiveMode::NonRecursive');
    expect(watchSource).toContain('emit_to(TRUSTED_WEBVIEW_LABEL');
    expect(watchSource).not.toContain('PollWatcher');
    expect(searchSource).toContain('tauri::async_runtime::spawn_blocking');
    expect(searchSource).toContain('MAX_ACTIVE_SEARCHES: usize = 2');
    expect(searchSource).toContain('RESULT_LIMIT: usize = 5_000');
    expect(searchSource).toContain('RESULT_BATCH_LIMIT: usize = 200');
    expect(searchSource).toContain('metadata.kind == NativeFileKind::Directory');
    expect(searchSource).not.toContain('WalkDir');
    expect(searchSource).not.toContain('emit_to(');
    expect(searchCommands).not.toContain('walk_any_path');
    expect(previewSource).toContain('MAX_ACTIVE_JOBS: usize = 4');
    expect(previewSource).toContain('MAX_IMAGE_DIMENSION: u32 = 20_000');
    expect(previewSource).toContain('TEXT_PREVIEW_BYTES: usize = 512 * 1024');
    expect(previewSource).not.toContain('file://');
    expect(previewSource).not.toContain('PreviewHandler');
    expect(previewSource).toContain('native_video_preview::render_poster');
    expect(videoPreviewSource).toContain('MFCreateSourceReaderFromByteStream');
    expect(videoPreviewSource).toContain('MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING');
    expect(videoPreviewSource).not.toContain('std::process::Command');
    expect(videoPreviewSource).not.toContain('ffmpeg');
    expect(videoPreviewSource).not.toContain('PreviewHandler');
    expect(videoPreviewSource).not.toContain('http://');
    expect(videoPreviewSource).not.toContain('https://');
    expect(propertiesSource).toContain('FileStandardInfo');
    expect(propertiesSource).toContain('FILE_STANDARD_INFO');
    expect(propertiesSource).not.toContain('GetCompressedFileSizeW');
    expect(propertiesSource).toContain('MAX_ACTIVE_MEASUREMENTS: usize = 2');
    expect(propertiesSource).toContain('fs::symlink_metadata');
    expect(propertiesSource).not.toContain('WalkDir');
    expect(propertiesSource).not.toContain('std::process::Command');
    expect(propertiesSource).not.toContain('powershell');
    expect(propertiesSource).not.toContain('icacls');
    expect(propertiesSource).not.toContain('takeown');
    expect(archiveSource).toContain('require_trusted_caller');
    expect(archiveSource).toContain('MAX_ARCHIVE_ENTRIES: usize = 100_000');
    expect(archiveSource).toContain('MAX_COMPRESSION_RATIO: u64 = 1_000');
    expect(archiveSource).toContain('nammu-partial-');
    expect(archiveSource).not.toContain('std::process::Command');
    expect(archiveSource).not.toContain('powershell');
    expect(archiveSource).not.toContain('Expand-Archive');
    expect(archiveSource).not.toContain('7z.exe');

    const uiSource = readFileSync('src/components/files/FilesApp.tsx', 'utf8');
    expect(uiSource).toContain('new IntersectionObserver');
    expect(uiSource).toContain("rootMargin: '240px'");
    expect(uiSource).toContain('URL.createObjectURL');
    expect(uiSource).toContain('URL.revokeObjectURL');
    expect(uiSource.match(/<NativeThumbnail/g)).toHaveLength(2);
    expect(uiSource).not.toContain('dangerouslySetInnerHTML');
    expect(uiSource).not.toContain('file://');
    expect(uiSource).not.toContain('<video');
    expect(uiSource).toContain("shortcut: 'Alt+Enter'");
    const propertiesUiSource = readFileSync(
      'src/components/files/FilePropertiesDialog.tsx',
      'utf8',
    );
    expect(propertiesUiSource).toContain('Read only');
    expect(propertiesUiSource).toContain('startDirectoryMeasurement(paths)');
    expect(propertiesUiSource).toContain('cancelDirectoryMeasurement(id)');
    expect(propertiesUiSource).toContain('previewScheduler.schedule');
    expect(propertiesUiSource).not.toContain('type="checkbox"');

    const capability = JSON.parse(readFileSync('src-tauri/capabilities/main.json', 'utf8')) as {
      permissions: string[];
    };
    for (const command of searchCommands) {
      expect(capability.permissions).toContain(`allow-${command.replaceAll('_', '-')}`);
    }
    for (const command of previewCommands) {
      expect(capability.permissions).toContain(`allow-${command.replaceAll('_', '-')}`);
    }
    for (const command of propertiesCommands) {
      expect(capability.permissions).toContain(`allow-${command.replaceAll('_', '-')}`);
    }
    for (const command of archiveCommands) {
      expect(capability.permissions).toContain(`allow-${command.replaceAll('_', '-')}`);
    }
  });
});
