const KEEP_ALIVE_WINDOW_IDS = new Set([
  'browser',
  'whatsapp',
  'telegram',
  'youtube-music',
  'pdf',
]);

/**
 * Stateful engines must survive a visual minimize. Closing the window still
 * unmounts the application and releases its runtime intentionally.
 */
export function shouldKeepWindowRuntimeAlive(toolId: string): boolean {
  const applicationId = toolId.startsWith('system:') ? toolId.slice('system:'.length) : toolId;
  return KEEP_ALIVE_WINDOW_IDS.has(applicationId);
}
