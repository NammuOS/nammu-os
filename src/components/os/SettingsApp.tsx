import React, { useState, useEffect } from 'react';
import {
  Palette,
  Volume2,
  Monitor,
  Database,
  Info,
  Check,
  Trash2,
  Download,
  Upload,
  Moon,
  Sun,
  VolumeX,
  Image as ImageIcon,
} from 'lucide-react';
import {
  WALLPAPERS,
  getMatrixWallpaperVariant,
  getSavedMatrixEffectSettings,
  getSavedWallpaper,
  getSavedWallpaperMask,
  getWallpaperName,
  saveMatrixEffectSettings,
  saveWallpaper,
  saveWallpaperMask,
  type MatrixEffectSettings,
  type MatrixEffectSettingsMap,
  type MatrixWallpaperVariant,
} from '../../lib/wallpapers';
import { useMasterVolume } from '../../hooks/useMasterVolume';

export interface SystemSettings {
  accentColor: string;
  themeStyle: 'cyber' | 'obsidian' | 'midnight' | 'macos';
  appearance: 'light' | 'dark';
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
  appearance: 'dark',
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
    id: 'macos',
    name: 'MacOS',
    desc: 'Liquid glass materials, SF system typography, traffic-light windows, and a floating dock',
    bg: '#e9e9eb',
    accent: '#0088ff',
    border: '#b8b8bd',
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
  { name: 'System Yellow', hex: '#ffd60a' },
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
      if (!saved) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(saved);
      const savedTheme = ['cyber', 'obsidian', 'midnight', 'macos'].includes(parsed.themeStyle)
        ? parsed.themeStyle
        : DEFAULT_SETTINGS.themeStyle;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        themeStyle: savedTheme,
        appearance: parsed.appearance === 'light' ? 'light' : 'dark',
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [activeTab, setActiveTab] = useState<
    'appearance' | 'wallpaper' | 'audio' | 'taskbar' | 'storage' | 'about'
  >('appearance');
  const { volume, setVolume: handleVolumeChange } = useMasterVolume();

  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [importStatus, setImportStatus] = useState<string>('');
  const [wallpaperSrc, setWallpaperSrc] = useState<string | null>(() => getSavedWallpaper());
  const [wallpaperMask, setWallpaperMask] = useState<boolean>(() => getSavedWallpaperMask());
  const [matrixEffectSettings, setMatrixEffectSettings] = useState<MatrixEffectSettingsMap>(() =>
    getSavedMatrixEffectSettings(),
  );
  const activeMatrixEffect = getMatrixWallpaperVariant(wallpaperSrc);

  const selectWallpaper = (src: string | null) => {
    setWallpaperSrc(src);
    saveWallpaper(src);
  };

  const toggleWallpaperMask = () => {
    const next = !wallpaperMask;
    setWallpaperMask(next);
    saveWallpaperMask(next);
  };

  const updateMatrixEffectSetting = <Key extends keyof MatrixEffectSettings>(
    variant: MatrixWallpaperVariant,
    key: Key,
    value: MatrixEffectSettings[Key],
  ) => {
    const next = { ...matrixEffectSettings[variant], [key]: value };
    setMatrixEffectSettings((current) => ({ ...current, [variant]: next }));
    saveMatrixEffectSettings(variant, next);
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
    document.documentElement.style.setProperty('--color-os-accent', settings.accentColor);
    document.documentElement.style.setProperty('--os-accent-rgb', hexToRgb(settings.accentColor));

    // Apply theme attribute across the operating system
    document.documentElement.setAttribute('data-theme', settings.themeStyle);
    document.documentElement.setAttribute('data-appearance', settings.appearance);
    document.documentElement.style.colorScheme = settings.appearance;
    window.dispatchEvent(
      new CustomEvent('nammu-theme-change', {
        detail: { theme: settings.themeStyle, appearance: settings.appearance },
      }),
    );
  }, [settings]);

  const updateSetting = <K extends keyof SystemSettings>(key: K, val: SystemSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  // Calculate local storage size
  const storageStats = (() => {
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
  })();

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
      } catch {
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
    <div className="settings-app flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Left Settings Navigation */}
      <aside className="w-44 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
        <div className="space-y-1">
          <div className="mb-2 px-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
            System Control
          </div>

          {[
            { id: 'appearance', label: 'Appearance', icon: Palette },
            { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon },
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

            <div className="settings-card bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-[10px] font-medium text-[#c5d4e2] block">
                    Appearance Mode
                  </label>
                  <p className="text-[9.5px] text-[#71889d]">
                    Light and dark mode apply across every Nammu OS theme.
                  </p>
                </div>
                <div className="appearance-segment flex shrink-0 rounded-lg border border-white/[0.08] bg-black/25 p-0.5">
                  {(['light', 'dark'] as const).map((mode) => {
                    const Icon = mode === 'light' ? Sun : Moon;
                    const active = settings.appearance === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={active}
                        onClick={() => updateSetting('appearance', mode)}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium capitalize transition-all ${
                          active
                            ? 'bg-white/[0.12] text-white shadow-sm'
                            : 'text-[#71889d] hover:text-[#c5d4e2]'
                        }`}
                      >
                        <Icon size={12} />
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* System UI Theme Architecture Selector */}
            <div className="settings-card bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-[#c5d4e2] block">System Theme</label>
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
                        if (thm.id === 'macos') {
                          updateSetting('accentColor', '#0088ff');
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
                        {isSelected && <Check size={12} className="text-[#2ee6a6]" />}
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

        {/* WALLPAPER */}
        {activeTab === 'wallpaper' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Desktop Wallpaper</h2>
              <p className="text-[10px] text-[#71889d]">
                Choose a still image or a native real-time Nammu OS effect.
              </p>
            </div>

            <div className="settings-card space-y-3 rounded border border-white/[0.05] bg-[#05070b] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-medium text-[#c5d4e2]">Wallpaper Library</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Dynamic effects are rendered locally with the Nammu canvas engine.
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-[#64748b]">
                  Active: {getWallpaperName(wallpaperSrc)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => selectWallpaper(null)}
                  aria-pressed={wallpaperSrc === null}
                  className={`group relative flex flex-col overflow-hidden rounded border text-left transition-all ${
                    wallpaperSrc === null
                      ? 'border-white bg-white/[0.08] ring-1 ring-white/20 shadow-md'
                      : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.2]'
                  }`}
                >
                  <span
                    className="block h-20 w-full"
                    style={{
                      background: 'radial-gradient(ellipse at 50% 30%, #0a0e1a 0%, #050505 100%)',
                    }}
                  />
                  <span className="flex min-w-0 items-center justify-between gap-1 bg-white/[0.02] px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] text-[#c5d4e2]">Default</span>
                      <span className="block truncate text-[8.5px] text-[#61788c]">Nammu base</span>
                    </span>
                    {wallpaperSrc === null && (
                      <Check size={11} className="shrink-0 text-[#2ee6a6]" />
                    )}
                  </span>
                </button>

                {WALLPAPERS.map((wallpaper) => {
                  const isSelected = wallpaperSrc === wallpaper.src;
                  const previewStyle =
                    wallpaper.kind === 'image'
                      ? { backgroundImage: `url("${encodeURI(wallpaper.src)}")` }
                      : { background: wallpaper.preview };

                  return (
                    <button
                      key={wallpaper.id}
                      type="button"
                      onClick={() => selectWallpaper(wallpaper.src)}
                      aria-pressed={isSelected}
                      className={`group relative flex flex-col overflow-hidden rounded border text-left transition-all ${
                        isSelected
                          ? 'border-white bg-white/[0.08] ring-1 ring-white/20 shadow-md'
                          : 'border-white/[0.06] bg-white/[0.015] hover:border-white/[0.2]'
                      }`}
                    >
                      <span
                        className="relative block h-20 w-full overflow-hidden bg-cover bg-center"
                        style={previewStyle}
                      >
                        {wallpaper.kind === 'effect' && (
                          <>
                            <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)] opacity-60" />
                            <span className="absolute bottom-1.5 left-2 rounded-sm border border-white/15 bg-black/45 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.14em] text-white/75 backdrop-blur-sm">
                              Dynamic
                            </span>
                          </>
                        )}
                      </span>
                      <span className="flex min-w-0 items-center justify-between gap-1 bg-white/[0.02] px-2 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] text-[#c5d4e2]">
                            {wallpaper.name}
                          </span>
                          <span className="block truncate text-[8.5px] text-[#61788c]">
                            {wallpaper.description}
                          </span>
                        </span>
                        {isSelected && <Check size={11} className="shrink-0 text-[#2ee6a6]" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeMatrixEffect && (
                <div className="space-y-3 border-t border-white/[0.04] pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-medium text-[#d5e0ea]">
                        {activeMatrixEffect === 'synth-rain' ? 'Synth Rain' : 'Chaos Flow'} Controls
                      </div>
                      <div className="text-[9.5px] text-[#61788c]">
                        Changes are applied to the desktop in real time.
                      </div>
                    </div>
                    <span className="rounded-sm border border-os-accent/30 bg-os-accent/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-os-accent">
                      Live
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <label className="flex min-w-0 flex-col gap-2 rounded border border-white/[0.06] bg-white/[0.018] p-2.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-[#c5d4e2]">Color</span>
                        <span className="font-mono text-[8.5px] uppercase text-[#71889d]">
                          {matrixEffectSettings[activeMatrixEffect].color}
                        </span>
                      </span>
                      <span className="flex h-7 items-center gap-2 rounded-sm border border-white/[0.08] bg-black/25 p-1">
                        <input
                          type="color"
                          value={matrixEffectSettings[activeMatrixEffect].color}
                          onChange={(event) =>
                            updateMatrixEffectSetting(
                              activeMatrixEffect,
                              'color',
                              event.target.value,
                            )
                          }
                          className="h-5 w-full cursor-pointer border-0 bg-transparent p-0"
                          aria-label={`${activeMatrixEffect} color`}
                        />
                      </span>
                    </label>

                    <label className="flex min-w-0 flex-col gap-2 rounded border border-white/[0.06] bg-white/[0.018] p-2.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-[#c5d4e2]">Speed</span>
                        <span className="font-mono text-[8.5px] text-[#71889d]">
                          {matrixEffectSettings[activeMatrixEffect].speed}%
                        </span>
                      </span>
                      <input
                        type="range"
                        min="25"
                        max="200"
                        step="5"
                        value={matrixEffectSettings[activeMatrixEffect].speed}
                        onChange={(event) =>
                          updateMatrixEffectSetting(
                            activeMatrixEffect,
                            'speed',
                            Number(event.target.value),
                          )
                        }
                        className="os-range"
                        style={{
                          background: `linear-gradient(90deg, var(--color-os-accent) ${((matrixEffectSettings[activeMatrixEffect].speed - 25) / 175) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                        }}
                        aria-label={`${activeMatrixEffect} speed`}
                      />
                    </label>

                    <label className="flex min-w-0 flex-col gap-2 rounded border border-white/[0.06] bg-white/[0.018] p-2.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium text-[#c5d4e2]">Size</span>
                        <span className="font-mono text-[8.5px] text-[#71889d]">
                          {matrixEffectSettings[activeMatrixEffect].size}px
                        </span>
                      </span>
                      <input
                        type="range"
                        min="10"
                        max="28"
                        step="1"
                        value={matrixEffectSettings[activeMatrixEffect].size}
                        onChange={(event) =>
                          updateMatrixEffectSetting(
                            activeMatrixEffect,
                            'size',
                            Number(event.target.value),
                          )
                        }
                        className="os-range"
                        style={{
                          background: `linear-gradient(90deg, var(--color-os-accent) ${((matrixEffectSettings[activeMatrixEffect].size - 10) / 18) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                        }}
                        aria-label={`${activeMatrixEffect} character size`}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-white/[0.04] pt-3">
                <div>
                  <div className="text-[11px] font-medium text-[#d5e0ea]">Readability Mask</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Add subtle edge shading behind desktop controls
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleWallpaperMask}
                  aria-pressed={wallpaperMask}
                  className={`rounded px-2.5 py-1 font-mono text-[9.5px] font-semibold transition-colors ${
                    wallpaperMask
                      ? 'border border-os-accent bg-os-accent/20 text-os-accent'
                      : 'border border-white/[0.08] bg-white/[0.04] text-[#71889d]'
                  }`}
                >
                  {wallpaperMask ? 'ENABLED' : 'OFF'}
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
                    className="os-range"
                    style={{
                      background: `linear-gradient(90deg, var(--color-os-accent) ${volume}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
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
