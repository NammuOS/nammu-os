(() => {
  const removeLegacyPersistedWispCapability = () => {
    try {
      const preferenceKey = 'chrome-demo-opts';
      const saved = JSON.parse(window.localStorage.getItem(preferenceKey) || '{}');
      if (!saved || typeof saved !== 'object' || !Object.hasOwn(saved, 'wisp')) return;

      delete saved.wisp;
      window.localStorage.setItem(preferenceKey, JSON.stringify(saved));
    } catch {
      // Storage may be disabled or contain unrelated malformed legacy data.
    }
  };

  const installWispEndpointBridge = () => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const configuredEndpoint = fragment.get('nammu-wisp');
    if (!configuredEndpoint) return;

    let endpoint;
    try {
      endpoint = new URL(configuredEndpoint);
      if (
        (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      ) {
        throw new Error('invalid Wisp endpoint');
      }
    } catch {
      return;
    }

    const endpointValue = endpoint.toString();
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const requestUrl = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        window.location.href,
      );
      const method = String(
        init?.method || (input instanceof Request ? input.method : 'GET'),
      ).toUpperCase();
      if (
        method === 'GET' &&
        requestUrl.origin === window.location.origin &&
        requestUrl.pathname === '/api/browser/wisp-endpoint' &&
        !requestUrl.search &&
        !requestUrl.hash
      ) {
        return Promise.resolve(
          new Response(`${endpointValue}\n`, {
            status: 200,
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain; charset=utf-8',
            },
          }),
        );
      }
      return originalFetch(input, init);
    };

    // The capability remains in the bridge closure, but not in the iframe URL
    // or browser history after initial bootstrap.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  removeLegacyPersistedWispCapability();
  installWispEndpointBridge();

  const notifyParent = (message) => {
    if (window.parent === window || typeof window.geckoEvalChrome === 'function') return;
    window.parent.postMessage(
      {
        type: 'NAMMU_GECKO_ERROR',
        message: String(message || 'The Gecko engine could not finish starting.'),
      },
      window.location.origin,
    );
  };

  window.addEventListener('error', (event) => {
    notifyParent(event.error?.message || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    notifyParent(event.reason?.message || event.reason);
  });

  window.addEventListener('DOMContentLoaded', () => {
    const supportsJspi =
      typeof WebAssembly.Suspending === 'function' && typeof WebAssembly.promising === 'function';
    if (!supportsJspi) {
      window.setTimeout(
        () =>
          notifyParent(
            'This browser does not support the WebAssembly JS Promise Integration required by Gecko.',
          ),
        500,
      );
    }

    const startButton = document.getElementById('start-btn');
    if (!startButton) return;

    const observer = new MutationObserver(() => {
      if (startButton.textContent?.trim() === 'Retry') {
        notifyParent(
          'Firefox reported a startup failure. You can retry without reopening Browser.',
        );
      }
    });
    observer.observe(startButton, { childList: true, characterData: true, subtree: true });
  });
})();
