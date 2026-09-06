import type {
  FilesystemError,
  NativeFilePreviewDescriptor,
  NativeFilePreviewRequest,
} from '../../platform';
import type { FilesystemService } from './filesystemService';

export type NativePreviewContent = {
  descriptor: NativeFilePreviewDescriptor;
  bytes: Uint8Array | null;
};

export type NativePreviewOutcome =
  { status: 'success'; value: NativePreviewContent } | { status: 'error'; error: FilesystemError };

export interface ScheduledNativePreview {
  readonly promise: Promise<NativePreviewOutcome>;
  cancel(): void;
}

type QueueEntry = {
  request: NativeFilePreviewRequest;
  cancelled: boolean;
  nativeId: string | null;
  resolve: (outcome: NativePreviewOutcome) => void;
};

const cancelledError: FilesystemError = {
  code: 'OPERATION_CANCELLED',
  message: 'The preview was cancelled.',
};

const wait = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 24));

export function createNativePreviewScheduler(filesystem: FilesystemService, maxConcurrency = 3) {
  const queue: QueueEntry[] = [];
  const live = new Set<QueueEntry>();
  let active = 0;
  let disposed = false;

  const finish = (entry: QueueEntry, outcome: NativePreviewOutcome) => {
    live.delete(entry);
    entry.resolve(outcome);
  };

  const run = async (entry: QueueEntry) => {
    if (entry.cancelled || disposed) {
      finish(entry, { status: 'error', error: cancelledError });
      return;
    }
    const started = await filesystem.startPreview(entry.request);
    if (started.status !== 'success') {
      finish(entry, {
        status: 'error',
        error:
          started.status === 'error'
            ? started.error
            : { code: 'PREVIEW_UNSUPPORTED', message: started.reason },
      });
      return;
    }
    entry.nativeId = started.value.id;
    let snapshot = started.value;
    try {
      while (snapshot.state === 'queued' || snapshot.state === 'running') {
        if (entry.cancelled || disposed) {
          await filesystem.cancelPreview(snapshot.id);
          finish(entry, { status: 'error', error: cancelledError });
          return;
        }
        await wait();
        const polled = await filesystem.getPreview(snapshot.id);
        if (polled.status !== 'success') {
          finish(entry, {
            status: 'error',
            error:
              polled.status === 'error'
                ? polled.error
                : { code: 'IO_ERROR', message: polled.reason },
          });
          return;
        }
        snapshot = polled.value;
      }
      if (snapshot.state !== 'completed' || !snapshot.result) {
        finish(entry, {
          status: 'error',
          error:
            snapshot.error ??
            (snapshot.state === 'cancelled'
              ? cancelledError
              : { code: 'IO_ERROR', message: 'The preview could not be prepared.' }),
        });
        return;
      }
      let bytes: Uint8Array | null = null;
      if (snapshot.result.kind === 'image') {
        const taken = await filesystem.takePreviewBytes(snapshot.id);
        if (taken.status !== 'success') {
          finish(entry, {
            status: 'error',
            error:
              taken.status === 'error' ? taken.error : { code: 'IO_ERROR', message: taken.reason },
          });
          return;
        }
        bytes = taken.value;
      }
      finish(entry, { status: 'success', value: { descriptor: snapshot.result, bytes } });
    } finally {
      await filesystem.releasePreview(snapshot.id);
    }
  };

  const pump = () => {
    while (!disposed && active < maxConcurrency && queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.cancelled) {
        finish(entry, { status: 'error', error: cancelledError });
        continue;
      }
      active += 1;
      void run(entry).finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  return Object.freeze({
    schedule(
      request: NativeFilePreviewRequest,
      priority: 'normal' | 'high' = 'normal',
    ): ScheduledNativePreview {
      let resolve!: (outcome: NativePreviewOutcome) => void;
      const promise = new Promise<NativePreviewOutcome>((settle) => {
        resolve = settle;
      });
      const entry: QueueEntry = { request, cancelled: false, nativeId: null, resolve };
      live.add(entry);
      if (priority === 'high') queue.unshift(entry);
      else if (queue.length < 128) queue.push(entry);
      else {
        finish(entry, {
          status: 'error',
          error: { code: 'OPERATION_CANCELLED', message: 'The preview queue is full.' },
        });
        return { promise, cancel() {} };
      }
      pump();
      return {
        promise,
        cancel() {
          if (entry.cancelled) return;
          entry.cancelled = true;
          if (entry.nativeId) void filesystem.cancelPreview(entry.nativeId);
        },
      };
    },
    dispose() {
      disposed = true;
      for (const entry of live) {
        entry.cancelled = true;
        if (entry.nativeId) void filesystem.cancelPreview(entry.nativeId);
      }
      pump();
    },
    diagnostics() {
      return { active, queued: queue.filter((entry) => !entry.cancelled).length };
    },
  });
}

export type NativePreviewScheduler = ReturnType<typeof createNativePreviewScheduler>;
