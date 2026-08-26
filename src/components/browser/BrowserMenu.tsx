import {
  Bookmark,
  BookOpen,
  Download,
  FileDown,
  FileSearch,
  Fullscreen,
  History,
  KeyRound,
  ListRestart,
  Minus,
  Plus,
  Printer,
  Puzzle,
  Settings,
  ShieldCheck,
  Terminal,
  UserRoundPlus,
  X,
} from 'lucide-react';

interface BrowserMenuProps {
  zoomLevel: number;
  canReopenClosedTab: boolean;
  onClose: () => void;
  onNewTab: () => void;
  onNewPrivateTab: () => void;
  onReopenClosedTab: () => void;
  onFind: () => void;
  onPrint: () => void;
  onSavePage: () => void;
  onToggleFullscreen: () => void;
  onShowHistory: () => void;
  onShowBookmarks: () => void;
  onShowDownloads: () => void;
  onShowPasswords: () => void;
  onShowExtensions: () => void;
  onShowProtections: () => void;
  onShowSettings: () => void;
  onShowFirefoxSettings: () => void;
  onShowDevTools: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
}

const menuButtonClass =
  'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[10px] text-[#bdcddd] transition-colors hover:bg-white/[0.055] hover:text-white disabled:pointer-events-none disabled:opacity-35';

export default function BrowserMenu({
  zoomLevel,
  canReopenClosedTab,
  onClose,
  onNewTab,
  onNewPrivateTab,
  onReopenClosedTab,
  onFind,
  onPrint,
  onSavePage,
  onToggleFullscreen,
  onShowHistory,
  onShowBookmarks,
  onShowDownloads,
  onShowPasswords,
  onShowExtensions,
  onShowProtections,
  onShowSettings,
  onShowFirefoxSettings,
  onShowDevTools,
  onZoomOut,
  onResetZoom,
  onZoomIn,
}: BrowserMenuProps) {
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div className="browser-main-menu absolute right-2 top-[69px] z-[70] w-64 rounded-lg border border-white/[0.1] bg-[#080d15]/98 p-1.5 font-mono shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-2 pb-1.5 pt-0.5">
        <span className="text-[8px] uppercase tracking-[0.18em] text-[#557087]">Browser Menu</span>
        <button
          type="button"
          onClick={onClose}
          className="grid h-5 w-5 place-items-center rounded text-[#69849b] hover:bg-white/[0.05] hover:text-white"
          aria-label="Close browser menu"
        >
          <X size={11} />
        </button>
      </div>

      <div className="py-1">
        <button type="button" onClick={run(onNewTab)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Plus size={11} className="text-[#4aa3ff]" />
            New Tab
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+T</span>
        </button>
        <button type="button" onClick={run(onNewPrivateTab)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <UserRoundPlus size={11} className="text-[#b589ff]" />
            New Private Tab
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+Shift+P</span>
        </button>
        <button
          type="button"
          onClick={run(onReopenClosedTab)}
          disabled={!canReopenClosedTab}
          className={menuButtonClass}
        >
          <span className="flex items-center gap-2">
            <ListRestart size={11} className="text-[#79baff]" />
            Reopen Closed Tab
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+Shift+T</span>
        </button>
      </div>

      <div className="border-y border-white/[0.06] py-1">
        <div className="flex items-center justify-between px-2.5 py-1">
          <span className="text-[10px] text-[#bdcddd]">Zoom</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onZoomOut}
              className="grid h-5 w-5 place-items-center rounded border border-white/[0.07] hover:bg-white/[0.05]"
              aria-label="Zoom out"
            >
              <Minus size={10} />
            </button>
            <button
              type="button"
              onClick={onResetZoom}
              className="min-w-10 rounded border border-white/[0.07] px-1 py-0.5 text-[8px] hover:bg-white/[0.05]"
            >
              {zoomLevel}%
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              className="grid h-5 w-5 place-items-center rounded border border-white/[0.07] hover:bg-white/[0.05]"
              aria-label="Zoom in"
            >
              <Plus size={10} />
            </button>
          </div>
        </div>
        <button type="button" onClick={run(onFind)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <FileSearch size={11} className="text-[#4aa3ff]" />
            Find in Page
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+F</span>
        </button>
        <button type="button" onClick={run(onPrint)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Printer size={11} className="text-[#4aa3ff]" />
            Print
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+P</span>
        </button>
        <button type="button" onClick={run(onSavePage)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <FileDown size={11} className="text-[#4aa3ff]" />
            Save Page
          </span>
          <span className="text-[8px] text-[#557087]">Ctrl+S</span>
        </button>
        <button type="button" onClick={run(onToggleFullscreen)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Fullscreen size={11} className="text-[#4aa3ff]" />
            Fullscreen
          </span>
          <span className="text-[8px] text-[#557087]">F11</span>
        </button>
      </div>

      <div className="py-1">
        <button type="button" onClick={run(onShowBookmarks)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Bookmark size={11} className="text-[#f5b942]" />
            Bookmarks
          </span>
        </button>
        <button type="button" onClick={run(onShowHistory)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <History size={11} className="text-[#79baff]" />
            History
          </span>
        </button>
        <button type="button" onClick={run(onShowDownloads)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Download size={11} className="text-[#2ee6a6]" />
            Downloads
          </span>
        </button>
        <button type="button" onClick={run(onShowPasswords)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <KeyRound size={11} className="text-[#f6c85f]" />
            Passwords
          </span>
        </button>
        <button type="button" onClick={run(onShowExtensions)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Puzzle size={11} className="text-[#b589ff]" />
            Extensions & Themes
          </span>
        </button>
      </div>

      <div className="border-t border-white/[0.06] pt-1">
        <button type="button" onClick={run(onShowProtections)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <ShieldCheck size={11} className="text-[#2ee6a6]" />
            Privacy Protections
          </span>
        </button>
        <button type="button" onClick={run(onShowDevTools)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Terminal size={11} className="text-[#4aa3ff]" />
            Developer Tools
          </span>
        </button>
        <button type="button" onClick={run(onShowSettings)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <Settings size={11} className="text-[#9cb6cc]" />
            Browser Settings
          </span>
        </button>
        <button type="button" onClick={run(onShowFirefoxSettings)} className={menuButtonClass}>
          <span className="flex items-center gap-2">
            <BookOpen size={11} className="text-[#ff8b5f]" />
            Advanced Gecko Settings
          </span>
        </button>
      </div>
    </div>
  );
}
