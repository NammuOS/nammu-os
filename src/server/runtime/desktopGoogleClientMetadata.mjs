export const GOOGLE_DESKTOP_CLIENT_ID_PATTERN =
  /^[A-Za-z0-9._-]{8,220}\.apps\.googleusercontent\.com$/;
export const GOOGLE_DESKTOP_CLIENT_SECRET_PATTERN = /^[A-Za-z0-9._-]{8,512}$/;

function configuredValue(value) {
  return typeof value === 'function' ? value() : value;
}

export function resolveGoogleDesktopClientMetadata(clientId, clientSecret) {
  const resolvedClientId = configuredValue(clientId);
  const resolvedClientSecret = configuredValue(clientSecret);
  if (
    typeof resolvedClientId !== 'string' ||
    !GOOGLE_DESKTOP_CLIENT_ID_PATTERN.test(resolvedClientId) ||
    typeof resolvedClientSecret !== 'string' ||
    !GOOGLE_DESKTOP_CLIENT_SECRET_PATTERN.test(resolvedClientSecret)
  ) {
    return null;
  }

  return Object.freeze({
    clientId: resolvedClientId,
    clientSecret: resolvedClientSecret,
  });
}
