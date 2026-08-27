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
      <div className="relative z-10 flex flex-col items-center pb-1 pt-10">
        <div className="mb-1.5 grid w-full max-w-160 grid-cols-[1fr_auto_1fr] items-center gap-8 font-mono text-[8px] uppercase leading-none">
          <span className="pointer-events-none text-right tracking-[0.22em] text-cyan/35">
            18.42° · RING LOCK
          </span>
          <span className="flex items-center gap-2 tracking-[0.32em] text-[#7d90a2]">
            <span className="status-dot bg-emerald" style={{ color: '#2ee6a6' }} />
            private workstation<span className="text-white/15">·</span>
            {now.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
          </span>
          <span className="pointer-events-none text-left tracking-[0.22em] text-white/20">
            SYS.CORE 4.1.0
          </span>
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
            className={`desktop-search-field flex items-center gap-2 rounded-lg border px-3 py-2 backdrop-blur-xl transition-colors ${searchActive ? 'border-[#4aa3ff]/45' : 'border-white/[0.08] hover:border-white/[0.14]'}`}
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
            <Command size={12} className="shrink-0 text-[#4aa3ff]" />
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
              className="cmd-input min-w-0 flex-1 bg-transparent text-[11px] tracking-wide text-[#dce7f2] outline-none"
              aria-label="Search tools"
              aria-expanded={searchActive}
            />
            <kbd className="hidden rounded border border-white/[0.07] bg-black/25 px-1.5 py-0.5 font-mono text-[8px] tracking-widest text-[#556f84] sm:block">
              Win Space
            </kbd>
            <button
              type="submit"
              className="flex h-5 w-5 items-center justify-center rounded text-[#71889d] transition-colors hover:bg-[#4aa3ff]/10 hover:text-[#9ecaff]"
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
