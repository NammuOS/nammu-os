import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings,
  Palette,
  Volume2,
  Monitor,
  Database,
  Info,
  Check,
  RefreshCw,
  Trash2,
  Download,
  Upload,
  Shield,
  Sliders,
  Sparkles,
  Moon,
  Sun,
  Bell,
  HardDrive,
  Wifi,
  Cpu,
  VolumeX,
  Eye,
} from 'lucide-react';
import {
  WALLPAPERS,
  getSavedWallpaper,
  getSavedWallpaperMask,
  getWallpaperName,
  saveWallpaper,
  saveWallpaperMask,
} from '../../lib/wallpapers';

export interface SystemSettings {
  accentColor: string;
  themeStyle: 'cyber' | 'obsidian' | 'midnight' | 'mosaic';
  enableScanlines: boolean;
  blurIntensity: number; // 0 to 20 px
  clockFormat: '24h' | '12h';
  showSeconds: boolean;
  showWeekday: boolean;
  uiSounds: boolean;
  reduceMotion: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  accentColor: '#4aa3ff',
  themeStyle: 'cyber',
  enableScanlines: false,
  blurIntensity: 12,
  clockFormat: '24h',
  showSeconds: false,
  showWeekday: true,
  uiSounds: true,
  reduceMotion: false,
};

const THEME_OPTIONS = [
  {
    id: 'cyber',
    name: 'Cyber Glow',
    desc: 'Neon cybernetic glassmorphism with dynamic glowing highlights',
    bg: '#05070b',
    accent: '#4aa3ff',
    border: '#1e3a8a',
  },
  {
    id: 'mosaic',
    name: 'Mosaic (Blueprint)',
    desc: 'Architectural Swiss design system with Inter, Space Grotesk, and bold accents',
    bg: '#f8f9fa',
    accent: '#fde047',
    border: '#e2e8f0',
    badge: 'NEW',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Dark',
    desc: 'Deep stealth carbon minimalism with high contrast typography',
    bg: '#09090b',
    accent: '#a1a1aa',
    border: '#27272a',
  },
  {
    id: 'midnight',
    name: 'Midnight Navy',
    desc: 'Deep marine ocean atmosphere with calm subdued accents',
    bg: '#070d18',
    accent: '#38bdf8',
    border: '#0c2340',
  },
];

const ACCENT_COLORS = [
  { name: 'Electric Blue', hex: '#4aa3ff' },
  { name: 'Mosaic Yellow', hex: '#fde047' },
  { name: 'Emerald Green', hex: '#2ee6a6' },
  { name: 'Cyan Glow', hex: '#6ec8d4' },
  { name: 'Amber Gold', hex: '#f59e0b' },
  { name: 'Neon Violet', hex: '#a855f7' },
  { name: 'Crimson Rose', hex: '#f43f5e' },
];

export function SettingsApp() {
  const [settings, setSettings] = useState<SystemSettings>(() => {
    try {
      const saved = localStorage.getItem('nammu-settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [activeTab, setActiveTab] = useState<
    'appearance' | 'audio' | 'taskbar' | 'storage' | 'about'
  >('appearance');
  const [volume, setVolume] = useState<number>(() => {
    try {
      const v = localStorage.getItem('nammu-volume');
      return v !== null ? Number(v) : 75;
    } catch {
      return 75;
    }
  });

  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [importStatus, setImportStatus] = useState<string>('');
  const [wallpaperSrc, setWallpaperSrc] = useState<string | null>(() => getSavedWallpaper());
  const [wallpaperMask, setWallpaperMask] = useState<boolean>(() => getSavedWallpaperMask());

  const selectWallpaper = (src: string | null) => {
    setWallpaperSrc(src);
    saveWallpaper(src);
  };

  const toggleWallpaperMask = () => {
    const next = !wallpaperMask;
    setWallpaperMask(next);
    saveWallpaperMask(next);
  };

  // Uptime counter
  useEffect(() => {
    const timer = setInterval(() => setUptimeSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Persist settings and apply accent & theme dynamically
  useEffect(() => {
    try {
      localStorage.setItem('nammu-settings', JSON.stringify(settings));
    } catch {}

    // Apply accent CSS variables
    document.documentElement.style.setProperty('--os-accent', settings.accentColor);
    document.documentElement.style.setProperty('--os-accent-rgb', hexToRgb(settings.accentColor));

    // Apply theme attribute across the operating system
    document.documentElement.setAttribute('data-theme', settings.themeStyle);
    window.dispatchEvent(
      new CustomEvent('nammu-theme-change', {
        detail: { theme: settings.themeStyle },
      }),
    );
  }, [settings]);

  // Sync volume with whole OS
  const handleVolumeChange = (val: number) => {
    setVolume(val);
    try {
      localStorage.setItem('nammu-volume', String(val));
    } catch {}

    document.querySelectorAll('audio, video').forEach((el) => {
      try {
        (el as HTMLMediaElement).volume = val / 100;
      } catch {}
    });

    window.dispatchEvent(
      new CustomEvent('nammu-volume-change', {
        detail: { volume: val / 100 },
      }),
    );
  };

  const updateSetting = <K extends keyof SystemSettings>(key: K, val: SystemSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  // Calculate local storage size
  const storageStats = useMemo(() => {
    let totalBytes = 0;
    const items: { key: string; bytes: number; count: string }[] = [];

    const keys = [
      'nammu-notes',
      'nammu-projects',
      'nammu-calendar-events',
      'nammu-calc-history',
      'nammu-settings',
      'nammu-pinned-tools',
      'nammu-volume',
    ];

    keys.forEach((k) => {
      const val = localStorage.getItem(k) || '';
      const b = new Blob([val]).size;
      totalBytes += b;
      let count = '—';
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) count = `${parsed.length} entries`;
      } catch {}
      items.push({ key: k, bytes: b, count });
    });

    return { totalBytes, items };
  }, [settings]);

  // Export full OS Data as JSON
  const exportAllData = () => {
    const dump: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nammu-')) {
        try {
          dump[k] = JSON.parse(localStorage.getItem(k) || 'null');
        } catch {
          dump[k] = localStorage.getItem(k);
        }
      }
    }

    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nammu-os-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON Backup
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target?.result as string);
        Object.keys(data).forEach((k) => {
          if (k.startsWith('nammu-')) {
            const val = typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]);
            localStorage.setItem(k, val);
          }
        });
        setImportStatus('Backup restored successfully! Refreshing...');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        setImportStatus('Failed to parse backup file');
      }
    };
    reader.readAsText(file);
  };

  // Factory Reset
  const handleFactoryReset = () => {
    if (
      window.confirm(
        'Are you sure you want to reset all Nammu OS settings, notes, calendar events, and projects to factory defaults?',
      )
    ) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nammu-')) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      window.location.reload();
    }
  };

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;
  };

  return (
    <div className="flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Left Settings Navigation */}
      <aside className="w-44 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
        <div className="space-y-1">
          <div className="mb-2 px-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
            System Control
          </div>

          {[
            { id: 'appearance', label: 'Appearance', icon: Palette },
            { id: 'audio', label: 'Sound & Audio', icon: Volume2 },
            { id: 'taskbar', label: 'Taskbar & Clock', icon: Monitor },
            { id: 'storage', label: 'Storage & Backup', icon: Database },
            { id: 'about', label: 'System Info', icon: Info },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-[10.5px] transition-colors ${
                  isActive
                    ? 'bg-[#4aa3ff]/10 text-[#cfe6ff] font-medium border-l-2 border-[#4aa3ff]'
                    : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'
                }`}
              >
                <Icon size={12} className={isActive ? 'text-[#4aa3ff]' : 'text-[#61788c]'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="pt-2 border-t border-white/[0.05] font-mono text-[8px] text-[#476077] px-1">
          NammuOS 4.1.0 · Local
        </div>
      </aside>

      {/* Main Settings Body */}
      <main className="flex-1 overflow-y-auto os-scrollbar p-5 max-w-xl">
        {/* APPEARANCE */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Appearance & Visuals</h2>
              <p className="text-[10px] text-[#71889d]">
                Customize system theme architectures, accent colors, shaders, and UI rendering.
              </p>
            </div>

            {/* System UI Theme Architecture Selector */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-[#c5d4e2] block">
                  System Theme
                </label>
                <span className="font-mono text-[9px] uppercase tracking-wider text-[#64748b]">
                  Active: {settings.themeStyle}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map((thm) => {
                  const isSelected = settings.themeStyle === thm.id;
                  return (
                    <button
                      key={thm.id}
                      onClick={() => {
                        updateSetting('themeStyle', thm.id as any);
                        if (thm.id === 'mosaic') {
                          updateSetting('accentColor', '#fde047');
                        }
                      }}
                      className={`flex flex-col items-start p-2.5 rounded border transition-all text-left relative ${
                        isSelected
                          ? 'border-white bg-white/[0.08] shadow-md ring-1 ring-white/20'
                          : 'border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3 h-3 rounded-full border border-black/30 shrink-0"
                            style={{ backgroundColor: thm.accent }}
                          />
                          <span className="text-[11px] font-semibold text-white truncate">
                            {thm.name}
                          </span>
                        </div>
                        {thm.badge && (
                          <span className="px-1.5 py-0.2 rounded text-[8px] font-mono font-bold bg-[#fde047] text-black border border-black/80">
                            {thm.badge}
                          </span>
                        )}
                        {isSelected && !thm.badge && (
                          <Check size={12} className="text-[#2ee6a6]" />
                        )}
                      </div>
                      <p className="text-[9.5px] text-[#71889d] line-clamp-2 leading-relaxed">
                        {thm.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accent Colors */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <label className="text-[10px] font-medium text-[#c5d4e2] block">
                System Accent Color
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ACCENT_COLORS.map((col) => {
                  const isSelected = settings.accentColor === col.hex;
                  return (
                    <button
                      key={col.hex}
                      onClick={() => updateSetting('accentColor', col.hex)}
                      className={`flex items-center gap-2 p-1.5 rounded border transition-all ${
                        isSelected
                          ? 'border-white bg-white/[0.06] shadow-sm'
                          : 'border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.04]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{
                          background: col.hex,
                          boxShadow: isSelected ? `0 0 8px ${col.hex}` : 'none',
                        }}
                      />
                      <span className="text-[10px] text-[#c5d4e2] truncate">{col.name}</span>
                      {isSelected && <Check size={11} className="text-white ml-auto" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Desktop Wallpaper */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-[#c5d4e2] block">
                  Desktop Wallpaper
                </label>
                <span className="font-mono text-[9px] uppercase tracking-wider text-[#64748b]">
                  Active: {getWallpaperName(wallpaperSrc)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => selectWallpaper(null)}
                  className={`group relative flex flex-col rounded overflow-hidden border transition-all ${
                    wallpaperSrc === null
                      ? 'border-white bg-white/[0.08] ring-1 ring-white/20 shadow-md'
                      : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.2]'
                  }`}
                >
                  <span
                    className="block h-14 w-full"
                    style={{
                      background:
                        'radial-gradient(ellipse at 50% 30%, #0a0e1a 0%, #050505 100%)',
                    }}
                  />
                  <span className="flex items-center justify-between gap-1 px-2 py-1.5 bg-white/[0.02]">
                    <span className="text-[10px] text-[#c5d4e2] truncate">Default</span>
                    {wallpaperSrc === null && (
                      <Check size={11} className="text-[#2ee6a6] shrink-0" />
                    )}
                  </span>
                </button>

                {WALLPAPERS.map((wp) => {
                  const isSelected = wallpaperSrc === wp.src;
                  return (
                    <button
                      key={wp.id}
                      onClick={() => selectWallpaper(wp.src)}
                      className={`group relative flex flex-col rounded overflow-hidden border transition-all ${
                        isSelected
                          ? 'border-white bg-white/[0.08] ring-1 ring-white/20 shadow-md'
                          : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.2]'
                      }`}
                    >
                      <span
                        className="block h-14 w-full bg-cover bg-center"
                        style={{ backgroundImage: `url("${encodeURI(wp.src)}")` }}
                      />
                      <span className="flex items-center justify-between gap-1 px-2 py-1.5 bg-white/[0.02]">
                        <span className="text-[10px] text-[#c5d4e2] truncate">{wp.name}</span>
                        {isSelected && <Check size={11} className="text-[#2ee6a6] shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Dark Edge Mask</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Vignette shading on wallpaper edges for text readability
                  </div>
                </div>
                <button
                  onClick={toggleWallpaperMask}
                  className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                    wallpaperMask
                      ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                      : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                  }`}
                >
                  {wallpaperMask ? 'ENABLED' : 'OFF'}
                </button>
              </div>
            </div>

            {/* Visual Effects */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">CRT Scanline Shader</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Retro phosphor scanlines across the desktop
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('enableScanlines', !settings.enableScanlines)}
                  className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                    settings.enableScanlines
                      ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                      : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                  }`}
                >
                  {settings.enableScanlines ? 'ENABLED' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Reduce Motion</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Disable window zoom animations and transitions
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('reduceMotion', !settings.reduceMotion)}
                  className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                    settings.reduceMotion
                      ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                      : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                  }`}
                >
                  {settings.reduceMotion ? 'RESTRAINED' : 'SMOOTH'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AUDIO */}
        {activeTab === 'audio' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Sound & Audio System</h2>
              <p className="text-[10px] text-[#71889d]">
                Control master system volume and audio feedback.
              </p>
            </div>

            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#c5d4e2] font-medium">Master System Volume</span>
                <span className="font-mono text-xs text-os-accent font-semibold">{volume}%</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleVolumeChange(volume === 0 ? 75 : 0)}
                  className="p-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#8aa0b2] hover:text-os-accent"
                >
                  {volume === 0 ? (
                    <VolumeX size={14} className="text-[#f43f5e]" />
                  ) : (
                    <Volume2 size={14} />
                  )}
                </button>
                <div className="relative flex-1 flex items-center">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#172033] border border-white/20 rounded-full cursor-pointer appearance-none accent-[#4aa3ff]"
                    style={{
                      background: `linear-gradient(90deg, #4aa3ff 0%, #4aa3ff ${volume}%, rgba(255,255,255,0.12) ${volume}%, rgba(255,255,255,0.12) 100%)`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded flex items-center justify-between">
              <div>
                <div className="text-[11px] text-[#d5e0ea] font-medium">UI Sound Effects</div>
                <div className="text-[9.5px] text-[#61788c]">
                  Click, toggle, and window snap audio cues
                </div>
              </div>
              <button
                onClick={() => updateSetting('uiSounds', !settings.uiSounds)}
                className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                  settings.uiSounds
                    ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                    : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                }`}
              >
                {settings.uiSounds ? 'ENABLED' : 'MUTED'}
              </button>
            </div>
          </div>
        )}

        {/* TASKBAR & CLOCK */}
        {activeTab === 'taskbar' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Taskbar & Clock</h2>
              <p className="text-[10px] text-[#71889d]">
                Configure taskbar tray clock formatting and layout.
              </p>
            </div>

            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Time Display Format</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    24-hour military clock vs 12-hour AM/PM
                  </div>
                </div>
                <button
                  onClick={() =>
                    updateSetting('clockFormat', settings.clockFormat === '24h' ? '12h' : '24h')
                  }
                  className="px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold bg-white/[0.05] border border-white/[0.08] text-os-accent"
                >
                  {settings.clockFormat.toUpperCase()}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Show Day & Month</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Display formatted calendar badge (e.g. Fri, 21 Aug)
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('showWeekday', !settings.showWeekday)}
                  className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                    settings.showWeekday
                      ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                      : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                  }`}
                >
                  {settings.showWeekday ? 'SHOW' : 'HIDE'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STORAGE & DATA */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Storage & Backup</h2>
              <p className="text-[10px] text-[#71889d]">
                Inspect browser storage footprint, export full backup, or reset OS.
              </p>
            </div>

            {/* Storage breakdown */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="flex justify-between items-center pb-2 border-b border-white/[0.05]">
                <span className="text-[10px] text-[#c5d4e2] font-medium">Active Storage Usage</span>
                <span className="font-mono text-xs text-os-accent font-semibold">
                  {(storageStats.totalBytes / 1024).toFixed(2)} KB
                </span>
              </div>
              <div className="space-y-1">
                {storageStats.items.map((it) => (
                  <div
                    key={it.key}
                    className="flex justify-between items-center text-[9.5px] font-mono text-[#71889d]"
                  >
                    <span>{it.key}</span>
                    <span className="text-[#a6b8c7]">
                      {it.count !== '—' ? `${it.count} · ` : ''}
                      {(it.bytes / 1024).toFixed(2)} KB
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="text-[10.5px] text-[#d5e0ea] font-medium">Backup & Restore</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={exportAllData}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-os-accent/15 border border-os-accent/30 text-os-accent hover:bg-os-accent/25 text-[10px] font-medium transition-colors"
                >
                  <Download size={11} /> Export Full OS Backup (JSON)
                </button>

                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] text-[#c5d4e2] hover:bg-white/[0.08] text-[10px] font-medium transition-colors cursor-pointer">
                  <Upload size={11} /> Restore Backup
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                </label>
              </div>

              {importStatus && (
                <div className="font-mono text-[9px] text-[#2ee6a6] mt-1">{importStatus}</div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="bg-[#05070b] border border-[#f43f5e]/20 p-3 rounded space-y-2">
              <div className="text-[10.5px] text-[#fda4af] font-medium">Factory Reset</div>
              <p className="text-[9.5px] text-[#8aa0b2]">
                Erase all customized notes, calendar entries, active project workflows, and
                settings.
              </p>
              <button
                onClick={handleFactoryReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#f43f5e]/15 border border-[#f43f5e]/30 text-[#fda4af] hover:bg-[#f43f5e]/25 text-[10px] font-medium transition-colors"
              >
                <Trash2 size={11} /> Reset OS to Factory Defaults
              </button>
            </div>
          </div>
        )}

        {/* ABOUT */}
        {activeTab === 'about' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">System Specification</h2>
              <p className="text-[10px] text-[#71889d]">Nammu OS kernel runtime telemetry.</p>
            </div>

            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2 font-mono text-[10px]">
              <div className="flex justify-between py-1 border-b border-white/[0.04]">
                <span className="text-[#61788c]">OS Kernel</span>
                <span className="text-[#d5e0ea]">Nammu OS 4.1.0-release</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/[0.04]">
                <span className="text-[#61788c]">Active Space</span>
                <span className="text-os-accent font-medium">Deep Work</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/[0.04]">
                <span className="text-[#61788c]">Session Uptime</span>
                <span className="text-[#2ee6a6]">{formatUptime(uptimeSeconds)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/[0.04]">
                <span className="text-[#61788c]">Screen Density</span>
                <span className="text-[#d5e0ea]">
                  {window.innerWidth} × {window.innerHeight} @ {window.devicePixelRatio}x
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#61788c]">Network Mode</span>
                <span className="text-[#2ee6a6]">ONLINE · Low Latency</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function hexToRgb(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 74;
  const g = parseInt(clean.substring(2, 4), 16) || 163;
  const b = parseInt(clean.substring(4, 6), 16) || 255;
  return `${r}, ${g}, ${b}`;
}
