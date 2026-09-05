import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  categorizeNativeFile,
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
    };
    const service = createFilesystemService(filesystem);
    await service.listRoots();
    await service.listDirectory('C:\\');
    await service.stat('C:\\document.txt');
    expect(calls).toEqual(['roots', 'list:C:\\', 'stat:C:\\document.txt']);
    expect(Object.keys(service).sort()).toEqual([
      'cancelDeletionOperation',
      'cancelOperation',
      'copy',
      'createDirectory',
      'createFile',
      'duplicate',
      'getDeletionOperation',
      'getOperation',
      'getWatchDiagnostics',
      'listDirectory',
      'listRoots',
      'move',
      'permanentlyDelete',
      'rename',
      'restore',
      'stat',
      'supported',
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
    for (const source of [readSource, writeSource, deleteSource, watchSource]) {
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
  });
});
