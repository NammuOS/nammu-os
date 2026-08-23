import { useEffect, useRef, useState } from 'react';
import { RotateCw, Maximize2, Minimize2, ExternalLink, Flame } from 'lucide-react';

const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';

export default function FirefoxApp() {
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRuntimeIsolated, setIsRuntimeIsolated] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsRuntimeIsolated(window.crossOriginIsolated);
  }, []);

  const handleReload = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      iframeRef.current.src = FIREFOX_RUNTIME_URL;
    }
  };

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full min-h-0 flex-col bg-[#0f0e17] text-[#c9d7e2] select-none font-sans overflow-hidden relative"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/6 bg-[#14121f] px-3">
        <div className="flex items-center gap-2.5">
          <Flame size={18} className="text-[#ff7139]" />
          <span className="text-[12px] font-semibold text-white">Firefox</span>
          <span className="rounded border border-[#a855f7]/30 bg-[#a855f7]/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#c084fc]">
            WASM Gecko Engine
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2 font-mono text-[9px] text-[#8e85a3]">
          <span className="shrink-0 text-[#a855f7]">Local Build</span>
          <span className="max-w-90 truncate">{FIREFOX_RUNTIME_URL}</span>
        </div>

        <div className="flex items-center gap-1 text-[#b7bdc9]">
          <button
            onClick={handleReload}
            className="grid h-7 w-7 place-items-center rounded hover:bg-white/10 hover:text-white transition-colors"
            title="Reload Firefox"
          >
            <RotateCw size={13} className={isLoading ? 'animate-spin text-[#ff7139]' : ''} />
          </button>
          <button
            onClick={handleToggleFullscreen}
            className="grid h-7 w-7 place-items-center rounded hover:bg-white/10 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <a
            href={FIREFOX_RUNTIME_URL}
            target="_blank"
            rel="noreferrer"
            className="grid h-7 w-7 place-items-center rounded hover:bg-white/10 hover:text-white transition-colors"
            title="Open Firefox WASM in a native tab"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </header>

      {/* Embedded Firefox WebAssembly Stage */}
      <div className="flex min-h-0 flex-1 overflow-hidden relative bg-black">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0f0e17]/95 backdrop-blur-sm gap-3">
            <div className="flex items-center gap-2 text-[#ff7139]">
              <Flame size={28} className="animate-pulse" />
              <RotateCw size={16} className="animate-spin text-[#a855f7]" />
            </div>
            <div className="text-center space-y-1">
              <div className="font-medium text-[12px] text-white">
                Initializing Firefox in WebAssembly...
              </div>
              <div className="font-mono text-[10px] text-[#8e85a3]">
                Loading Gecko WASM Core via Nammu Cloud
              </div>
            </div>
          </div>
        )}

        {isRuntimeIsolated === false && !isLoading && (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 rounded border border-amber-400/30 bg-[#17101f]/95 px-3 py-2 font-mono text-[10px] text-amber-200 shadow-xl">
            Firefox WASM needs a cross-origin-isolated top-level page. Restart the Nammu server
            after changing its response headers, then reload this window.
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={FIREFOX_RUNTIME_URL}
          className="h-full w-full border-0 bg-black"
          title="Firefox WebAssembly Browser"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
          allow="cross-origin-isolated; camera; microphone; clipboard-read; clipboard-write; autoplay; display-capture; fullscreen"
          onLoad={() => setIsLoading(false)}
        />
      </div>

      {/* Bottom Status Bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/6 bg-[#14121f] px-3 font-mono text-[9px] text-[#7f7596]">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isRuntimeIsolated ? 'bg-[#22c55e]' : 'bg-amber-400'
            }`}
          />
          <span>{isLoading ? 'Loading Firefox launcher' : 'Firefox launcher loaded'}</span>
          <span>·</span>
          <span>
            {isRuntimeIsolated === null
              ? 'Checking worker isolation'
              : isRuntimeIsolated
                ? 'Gecko worker isolation enabled'
                : 'Gecko worker isolation unavailable'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[#a855f7]">Powered by Nammu</span>
        </div>
      </footer>
    </div>
  );
}
