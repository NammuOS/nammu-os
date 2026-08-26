(() => {
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
