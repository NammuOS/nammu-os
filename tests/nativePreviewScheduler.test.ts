import { describe, expect, test } from 'bun:test';
import { createNativePreviewScheduler } from '../src/components/files/nativePreviewScheduler';
import type { FilesystemService } from '../src/components/files/filesystemService';
import type { NativeFilePreviewRequest, NativeFilePreviewSnapshot } from '../src/platform';

function snapshot(
  id: string,
  request: NativeFilePreviewRequest,
  state: NativeFilePreviewSnapshot['state'],
): NativeFilePreviewSnapshot {
  return {
    id,
    request,
    state,
    durationMs: 1,
    result:
      state === 'completed'
        ? {
            kind: 'image',
            mimeType: 'image/png',
            width: 64,
            height: 64,
            sourceWidth: 100,
            sourceHeight: 100,
            pageCount: null,
            durationMs: null,
            byteLength: 4,
            text: null,
            truncated: false,
            cacheHit: false,
          }
        : null,
    error: null,
  };
}

function previewService() {
  let sequence = 0;
  let active = 0;
  let maximum = 0;
  const releases: string[] = [];
  const cancellations: string[] = [];
  const starts: string[] = [];
  const requests = new Map<string, NativeFilePreviewRequest>();
  const service = {
    async startPreview(request: NativeFilePreviewRequest) {
      starts.push(request.path);
      const id = (++sequence).toString(16).padStart(32, '0');
      requests.set(id, request);
      active += 1;
      maximum = Math.max(maximum, active);
      return { status: 'success' as const, value: snapshot(id, request, 'running') };
    },
    async getPreview(id: string) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      return { status: 'success' as const, value: snapshot(id, requests.get(id)!, 'completed') };
    },
    async takePreviewBytes() {
      return { status: 'success' as const, value: new Uint8Array([137, 80, 78, 71]) };
    },
    async cancelPreview(id: string) {
      cancellations.push(id);
      return { status: 'success' as const, value: snapshot(id, requests.get(id)!, 'cancelled') };
    },
    async releasePreview(id: string) {
      releases.push(id);
      active -= 1;
      return { status: 'success' as const, value: { released: true as const } };
    },
  } as unknown as FilesystemService;
  return {
    service,
    releases,
    cancellations,
    starts,
    get maximum() {
      return maximum;
    },
  };
}

describe('native preview scheduler', () => {
  test('bounds concurrency and releases every completed native job', async () => {
    const fixture = previewService();
    const scheduler = createNativePreviewScheduler(fixture.service, 3);
    const jobs = Array.from({ length: 12 }, (_, index) =>
      scheduler.schedule({
        path: `C:\\image-${index}.png`,
        mode: 'thumbnail',
        requestedWidth: 64,
        requestedHeight: 64,
      }),
    );
    const outcomes = await Promise.all(jobs.map((job) => job.promise));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes.every((outcome) => outcome.status === 'success')).toBe(true);
    expect(fixture.maximum).toBeLessThanOrEqual(3);
    expect(fixture.releases).toHaveLength(12);
    expect(scheduler.diagnostics()).toEqual({ active: 0, queued: 0 });
  });

  test('cancels stale work and does not retain queued requests on dispose', async () => {
    const fixture = previewService();
    const scheduler = createNativePreviewScheduler(fixture.service, 1);
    const first = scheduler.schedule({
      path: 'C:\\first.png',
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    const second = scheduler.schedule({
      path: 'C:\\second.png',
      mode: 'thumbnail',
      requestedWidth: 64,
      requestedHeight: 64,
    });
    second.cancel();
    const outcomes = await Promise.all([first.promise, second.promise]);
    expect(outcomes[0]?.status).toBe('success');
    expect(outcomes[1]).toEqual({
      status: 'error',
      error: { code: 'OPERATION_CANCELLED', message: 'The preview was cancelled.' },
    });
    scheduler.dispose();
    expect(scheduler.diagnostics()).toEqual({ active: 0, queued: 0 });
  });

  test('runs a selected-file preview before speculative queued thumbnails', async () => {
    const fixture = previewService();
    const scheduler = createNativePreviewScheduler(fixture.service, 1);
    const first = scheduler.schedule({
      path: 'C:\\visible.pdf',
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    });
    const speculative = scheduler.schedule({
      path: 'C:\\speculative.pdf',
      mode: 'thumbnail',
      requestedWidth: 96,
      requestedHeight: 96,
    });
    const selected = scheduler.schedule(
      {
        path: 'C:\\selected.pdf',
        mode: 'image-preview',
        requestedWidth: 512,
        requestedHeight: 512,
      },
      'high',
    );
    await Promise.all([first.promise, speculative.promise, selected.promise]);
    expect(fixture.starts).toEqual(['C:\\visible.pdf', 'C:\\selected.pdf', 'C:\\speculative.pdf']);
  });
});
