/** Core-only namespace helpers. Package code never receives these values. */
export async function integrationProfileNamespace(appId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(appId));
  const namespace = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `pkg-${namespace}`;
}

export async function isolatedIntegrationProfileKey(
  appId: string,
  profileKey: string,
): Promise<string> {
  return `${await integrationProfileNamespace(appId)}-${profileKey}`.slice(0, 80);
}
