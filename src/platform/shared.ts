import type { CapabilityResult, PlatformFileFilter } from './contracts';

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function success<T>(value: T): CapabilityResult<T> {
  return { status: 'success', value };
}

export function unsupported<T>(reason: string): CapabilityResult<T> {
  return { status: 'unsupported', reason };
}

export function denied<T>(reason: string): CapabilityResult<T> {
  return { status: 'denied', reason };
}

export function operationError<T>(message: string): CapabilityResult<T> {
  return { status: 'error', code: 'operation-failed', message };
}

export function invalidInput<T>(message: string): CapabilityResult<T> {
  return { status: 'error', code: 'invalid-input', message };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  return error.name === 'NotAllowedError' || error.name === 'SecurityError';
}

export function normalizeExternalUrl(input: string): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;

  try {
    const url = new URL(input.trim());
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeSuggestedFileName(input: string): string | null {
  const name = input.trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) return null;
  return name;
}

export function fileNameFromPath(path: string, fallback: string): string {
  const name = path.split(/[\\/]/).at(-1)?.trim();
  return name || fallback;
}

export function extensionsFromFilters(filters?: readonly PlatformFileFilter[]) {
  return (filters ?? [])
    .map((filter) => ({
      name: filter.name.trim() || 'Files',
      extensions: (filter.extensions ?? [])
        .map((extension) => extension.trim().replace(/^\./, ''))
        .filter(Boolean),
    }))
    .filter((filter) => filter.extensions.length > 0);
}

export function acceptFromFilters(filters?: readonly PlatformFileFilter[]): string {
  const values = new Set<string>();
  for (const filter of filters ?? []) {
    for (const mimeType of filter.mimeTypes ?? []) {
      const normalized = mimeType.trim();
      if (normalized) values.add(normalized);
    }
    for (const extension of filter.extensions ?? []) {
      const normalized = extension.trim().replace(/^\./, '');
      if (normalized) values.add(`.${normalized}`);
    }
  }
  return [...values].join(',');
}
