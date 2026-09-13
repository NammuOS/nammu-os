import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Firefox runtime bridge supplies Wisp without network discovery and clears its fragment', async () => {
  const endpoint = `ws://127.0.0.1:43127/firefox-wisp/${'a'.repeat(64)}`;
  const networkRequests: string[] = [];
  const historyTargets: string[] = [];
  const storage = new Map([
    ['chrome-demo-opts', JSON.stringify({ gpu: false, jit: true, wisp: endpoint })],
  ]);
  const mockWindow: any = {
    location: {
      href: `http://tauri.localhost/firefox-wasm/index.html?app=1#${new URLSearchParams({
        'nammu-wisp': endpoint,
      })}`,
      origin: 'http://tauri.localhost',
      pathname: '/firefox-wasm/index.html',
      search: '?app=1',
      hash: `#${new URLSearchParams({ 'nammu-wisp': endpoint })}`,
    },
    history: {
      replaceState(_state: unknown, _title: string, target: string) {
        historyTargets.push(target);
      },
    },
    fetch: async (input: RequestInfo | URL) => {
      networkRequests.push(String(input));
      return new Response('network');
    },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    },
    addEventListener() {},
  };
  mockWindow.parent = mockWindow;

  const source = readFileSync(
    join(process.cwd(), 'public', 'firefox-wasm', 'nammu-runtime-bridge.js'),
    'utf8',
  );
  Function('window', source)(mockWindow);

  const discovery = await mockWindow.fetch('/api/browser/wisp-endpoint');
  expect(await discovery.text()).toBe(`${endpoint}\n`);
  expect(networkRequests).toEqual([]);
  expect(historyTargets).toEqual(['/firefox-wasm/index.html?app=1']);
  expect(JSON.parse(storage.get('chrome-demo-opts') || '{}')).toEqual({
    gpu: false,
    jit: true,
  });

  expect(await (await mockWindow.fetch('/api/health')).text()).toBe('network');
  expect(networkRequests).toEqual(['/api/health']);
});

test('Firefox release patch prevents branded mode from persisting the Wisp capability', () => {
  const source = readFileSync(
    join(process.cwd(), 'public', 'firefox-wasm', 'assets', 'index-D39giZCc.js'),
    'utf8',
  );

  expect(source).toContain('localStorage.setItem(Qe,JSON.stringify(F?{gpu:r.gpu,jit:r.jit}:r))');
  expect(source).not.toContain('localStorage.setItem(Qe,JSON.stringify(r)),r}');
});

test('Firefox release exposes an explicit worker teardown hook for closed app runtimes', () => {
  const source = readFileSync(
    join(process.cwd(), 'public', 'firefox-wasm', 'assets', 'index-D39giZCc.js'),
    'utf8',
  );

  expect(source).toContain('window.geckoDispose=()=>{try{PThread.terminateRuntime()}catch{}}');
});

test('remaining built-in Gecko application wrappers retain the runtime handle until cleanup', () => {
  for (const sourcePath of [
    ['src', 'components', 'whatsapp', 'WhatsAppApp.tsx'],
    ['src', 'components', 'youtube-music', 'YouTubeMusicApp.tsx'],
  ]) {
    const source = readFileSync(join(process.cwd(), ...sourcePath), 'utf8');
    expect(source).toContain('const geckoRuntimeRef = useRef<GeckoRuntimeWindow | null>(null)');
    expect(source).toContain('geckoRuntimeRef.current = event.source as GeckoRuntimeWindow');
    expect(source).toContain('geckoRuntimeRef.current?.geckoDispose?.()');
    expect(source).toContain('geckoRuntimeRef.current = null');
  }
});
