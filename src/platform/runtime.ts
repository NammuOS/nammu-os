import type { PlatformRuntime } from './contracts';

interface TauriRuntimeHost {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
}

export function detectPlatformRuntime(host: unknown): PlatformRuntime {
  if (!host || typeof host !== 'object') return 'web';

  const internals = (host as TauriRuntimeHost).__TAURI_INTERNALS__;
  return internals && typeof internals.invoke === 'function' ? 'tauri' : 'web';
}

export function getPlatformRuntime(): PlatformRuntime {
  return detectPlatformRuntime(typeof window === 'undefined' ? undefined : window);
}
