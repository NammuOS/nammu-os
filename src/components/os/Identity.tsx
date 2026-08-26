import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Command,
  FilePlus2,
  FolderPlus,
  NotebookPen,
  Wrench,
} from 'lucide-react';
import { searchTools } from '../../lib/toolRegistry';
import { searchSystemApps, type SystemAppId } from './systemAppRegistry';

interface IdentityProps {
  onOpenTool: (toolId: string) => void;
  onOpenSystemApp: (appId: SystemAppId) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchActive: boolean;
  onSearchActiveChange: (active: boolean) => void;
}

export default function Identity({
  onOpenTool,
  onOpenSystemApp,
  query,
  onQueryChange,
  searchActive,
  onSearchActiveChange,
}: IdentityProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const now = new Date();

  useEffect(() => {
    if (searchActive) inputRef.current?.focus();
    else inputRef.current?.blur();
  }, [searchActive]);

  useEffect(() => {
    if (!searchActive) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && (formRef.current?.contains(target) || target.closest('.search-launcher-panel')))
        return;
      onSearchActiveChange(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onSearchActiveChange, searchActive]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onSearchActiveChange(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onSearchActiveChange]);

  const openTool = (toolId: string) => {
    onOpenTool(toolId);
    onQueryChange('');
    onSearchActiveChange(false);
  };

  return (
    <header className="nammu-identity absolute left-24 right-73 top-0 z-20 overflow-visible">
      <div className="pointer-events-none absolute left-[12%] top-6 font-mono text-[8px] tracking-[0.28em] text-cyan/35">
        18.42° · RING LOCK
      </div>
      <div className="pointer-events-none absolute right-[10%] top-10 font-mono text-[8px] tracking-[0.22em] text-white/20">
        SYS.CORE 4.1.0
      </div>

      <div className="relative z-10 flex flex-col items-center pb-1 pt-10">
        <div className="mb-1.5 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.42em] text-[#7d90a2]">
          <span className="status-dot bg-emerald" style={{ color: '#2ee6a6' }} />
          private workstation<span className="text-white/15">·</span>
          {now.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
        </div>

        <h1
          className="select-none font-display text-[44px] font-extrabold leading-none text-[#e8eef4]"
          style={{ letterSpacing: '0.22em' }}
        >
          NAMMU<span className="wordmark-os">OS</span>
        </h1>

        <div className="mt-1.5 flex items-center gap-2 font-mono text-[8px] tracking-[0.32em] text-[#5c7082]">
          <span>N·47.61</span>
          <span className="h-px w-8 bg-white/10" />
          <span>CORE ONLINE</span>
          <span className="h-px w-8 bg-white/10" />
          <span>W·122.33</span>
        </div>

        <div className="relative mt-4 w-full max-w-130">
          <form
            ref={formRef}
            className={`flex items-center gap-2 border bg-[#070b12]/80 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(200,220,255,0.04)] backdrop-blur-md transition-colors ${searchActive ? 'border-electric/35' : 'border-white/8'}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (!query.trim()) return;

              const matchedApps = searchSystemApps(query);
              if (matchedApps.length > 0) {
                onOpenSystemApp(matchedApps[0].id);
                onQueryChange('');
                onSearchActiveChange(false);
                return;
              }

              const firstResult = searchTools(query)[0];
              if (firstResult) {
                openTool(firstResult.id);
              }
            }}
          >
            <Command size={11} className="shrink-0 text-electric/80" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onFocus={() => onSearchActiveChange(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onQueryChange('');
                  onSearchActiveChange(false);
                }
              }}
              placeholder="What do you want to work on?"
              className="cmd-input min-w-0 flex-1 bg-transparent text-[12px] tracking-wide text-[#d5e0ea] outline-none"
              aria-label="Search tools"
              aria-expanded={searchActive}
            />
            <kbd className="hidden font-mono text-[8px] tracking-widest text-[#4a5c6c] sm:block">
              Win Space
            </kbd>
            <button
              type="submit"
              className="flex h-5 w-5 items-center justify-center text-[#6a7e90] hover:text-[#cfe4ff]"
              aria-label="Open first matching tool"
            >
              <ArrowRight size={11} />
            </button>
          </form>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <button
            onClick={() => onOpenSystemApp('projects')}
            className="group flex h-5 items-center gap-1.5 rounded-xs border border-white/[0.07] bg-[#080e18]/55 px-2 font-mono text-[9px] tracking-[0.035em] text-[#8298ab] transition-all hover:border-electric/30 hover:bg-electric/8 hover:text-[#d6e6f4]"
          >
            <FolderPlus
              size={10}
              className="text-electric/80 transition-colors group-hover:text-[#72b5ff]"
            />{' '}
            Open a project
          </button>
          <button
            onClick={() => {
              onQueryChange('');
              onSearchActiveChange(true);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="group flex h-5 items-center gap-1.5 rounded-xs border border-white/[0.07] bg-[#080e18]/55 px-2 font-mono text-[9px] tracking-[0.035em] text-[#8298ab] transition-all hover:border-electric/30 hover:bg-electric/8 hover:text-[#d6e6f4]"
          >
            <Wrench
              size={10}
              className="text-electric/80 transition-colors group-hover:text-[#72b5ff]"
            />{' '}
            Launch a tool
          </button>
          <button
            onClick={() => openTool('img-to-webp')}
            className="group flex h-5 items-center gap-1.5 rounded-xs border border-white/[0.07] bg-[#080e18]/55 px-2 font-mono text-[9px] tracking-[0.035em] text-[#8298ab] transition-all hover:border-electric/30 hover:bg-electric/8 hover:text-[#d6e6f4]"
          >
            <ArrowUpRight
              size={10}
              className="text-electric/80 transition-colors group-hover:text-[#72b5ff]"
            />{' '}
            Convert a file
          </button>
          <button
            onClick={() => onOpenSystemApp('notes')}
            className="group flex h-5 items-center gap-1.5 rounded-xs border border-white/[0.07] bg-[#080e18]/55 px-2 font-mono text-[9px] tracking-[0.035em] text-[#8298ab] transition-all hover:border-electric/30 hover:bg-electric/8 hover:text-[#d6e6f4]"
          >
            <NotebookPen
              size={10}
              className="text-electric/80 transition-colors group-hover:text-[#72b5ff]"
            />{' '}
            Open notes
          </button>
          <button
            onClick={() => onOpenSystemApp('editor')}
            className="group flex h-5 items-center gap-1.5 rounded-xs border border-white/[0.07] bg-[#080e18]/55 px-2 font-mono text-[9px] tracking-[0.035em] text-[#8298ab] transition-all hover:border-electric/30 hover:bg-electric/8 hover:text-[#d6e6f4]"
          >
            <FilePlus2
              size={10}
              className="text-electric/80 transition-colors group-hover:text-[#72b5ff]"
            />{' '}
            Create something new
          </button>
        </div>
      </div>
    </header>
  );
}
