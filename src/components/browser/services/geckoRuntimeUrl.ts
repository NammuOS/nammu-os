const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';
const RUNTIME_HOME_URL = 'about:blank';

function validateWispEndpoint(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('The browser service returned an invalid Wisp endpoint.');
  }
  return url.toString();
}

export function getBrowserRuntimeUrl(attempt: number, wispEndpoint: string): string {
  return getGeckoRuntimeUrl(String(attempt), wispEndpoint);
}

export function getGeckoRuntimeUrl(session: string, wispEndpoint: string): string {
  const params = new URLSearchParams({
    app: '1',
    autostart: '1',
    url: RUNTIME_HOME_URL,
    session,
  });
  const fragment = new URLSearchParams({
    'nammu-wisp': validateWispEndpoint(wispEndpoint),
  });
  return `${FIREFOX_RUNTIME_URL}?${params.toString()}#${fragment.toString()}`;
}
