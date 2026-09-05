import { describe, expect, test } from 'bun:test';
import { CloudApiClient } from '../src/components/cloud/services/cloudClient';
import type { PlatformServices } from '../src/platform/contracts';

function servicesWith(request: PlatformServices['request']): PlatformServices {
  return {
    ready: async () => ({ runtime: 'web', origin: null, instanceId: null }),
    request,
    wispUrl: async () => 'ws://localhost/firefox-wisp/',
  };
}

describe('cloud client platform transport', () => {
  test('uses PlatformServices for JSON APIs and never constructs a service origin', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = new CloudApiClient(() =>
      servicesWith(async (path, init) => {
        calls.push({ path, init });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    expect(await client.listAccounts()).toEqual([]);
    expect(await client.listSharedFiles('4d4aa644-f596-4f54-87a6-f55c91e4456e')).toEqual([]);
    expect(calls[0]?.path).toBe('/api/accounts');
    expect(calls[1]?.path).toBe('/api/files?shared_parent=4d4aa644-f596-4f54-87a6-f55c91e4456e');
    expect(new Headers(calls[0]?.init?.headers).has('x-nammu-request')).toBe(false);
  });

  test('uploads through authenticated HTTP only and reports completion honestly', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const progress: number[] = [];
    const client = new CloudApiClient(() =>
      servicesWith(async (path, init) => {
        calls.push({ path, init });
        if (path === '/api/uploads/initiate') {
          return new Response(JSON.stringify({ uploadId: 'upload-1', accountId: 'account-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: { id: 'file-1', file_name: 'hello.txt' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const uploaded = await client.initiateAndUpload(file, '/', (value) => progress.push(value));
    expect(uploaded.id).toBe('file-1');
    expect(calls.map((call) => call.path)).toEqual([
      '/api/uploads/initiate',
      '/api/uploads/upload-1/stream',
    ]);
    expect(calls[1]?.init?.body).toBeInstanceOf(FormData);
    expect(new Headers(calls[1]?.init?.headers).has('Content-Type')).toBe(false);
    expect(progress).toEqual([0, 100]);
  });
});
