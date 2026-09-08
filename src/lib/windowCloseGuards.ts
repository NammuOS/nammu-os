export type WindowCloseGuard = () => boolean | Promise<boolean>;

const guards = new Map<string, WindowCloseGuard>();
const pending = new Set<string>();

export function registerWindowCloseGuard(windowId: string, guard: WindowCloseGuard): () => void {
  guards.set(windowId, guard);
  return () => {
    if (guards.get(windowId) === guard) guards.delete(windowId);
  };
}

export async function requestManagedWindowClose(
  windowId: string,
  close: () => void,
): Promise<boolean> {
  if (pending.has(windowId)) return false;
  const guard = guards.get(windowId);
  if (!guard) {
    close();
    return true;
  }

  pending.add(windowId);
  try {
    if (!(await guard())) return false;
    close();
    return true;
  } finally {
    pending.delete(windowId);
  }
}

export function hasWindowCloseGuard(windowId: string): boolean {
  return guards.has(windowId);
}
