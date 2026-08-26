export function getStandaloneWindowUrl(toolId: string): string | null {
  if (!toolId) return null;

  if (toolId === 'system:browser' || toolId === 'browser') {
    return '/browser';
  }

  if (toolId.startsWith('system:')) {
    const appId = toolId.slice('system:'.length);
    return appId ? `/apps/${encodeURIComponent(appId)}` : null;
  }

  return `/tools/${encodeURIComponent(toolId)}`;
}
