import React, { useState, useEffect } from 'react';
import {
  Palette,
  Volume2,
  Monitor,
  Database,
  Info,
  Check,
  Bell,
  Folder,
  Grid3X3,
  Trash2,
  Download,
  Upload,
  Moon,
  Sun,
  VolumeX,
  Image as ImageIcon,
  Music2,
  Shield,
  ExternalLink,
  GripVertical,
  Eye,
  EyeOff,
  LockKeyhole,
  UserRound,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  LayoutGrid,
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
import {
  DEFAULT_ICON_SETTINGS,
  applyIconSettings,
  normalizeIconSettings,
  type IconSettings,
} from '../../lib/iconSettings';
import {
  DEFAULT_MUSIC_SETTINGS,
  MUSIC_SETTINGS_CHANGE_EVENT,
  MUSIC_VOLUME_CHANGE_EVENT,
  getSavedMusicSettings,
  getSavedMusicVolume,
  saveMusicSettings,
  saveMusicVolume,
  type MusicPlayerSettings,
} from '../../lib/musicSettings';
import {
  DEFAULT_START_MENU_ORDER,
  START_MENU_ORDER_CHANGE_EVENT,
  getStartMenuPreferences,
  reorderIds,
  saveStartMenuPreferences,
  type StartMenuPreferences,
} from '../../lib/appOrder';
import { SYSTEM_APPS, type SystemAppId } from './systemAppRegistry';
import {
  createLockProfile,
  getStoredLockProfile,
  normalizeLockUsername,
  saveLockState,
  saveLockProfile,
  type OsLockProfile,
} from '../../lib/osLock';

export interface SystemSettings extends IconSettings {
  accentColor: string;
  themeStyle: 'cyber' | 'obsidian' | 'midnight' | 'macos';
  appearance: 'light' | 'dark';
  enableScanlines: boolean;
  showSeconds: boolean;
  showWeekday: boolean;
  uiSounds: boolean;
  reduceMotion: boolean;
  autoLockMinutes: number;
  lockShowDate: boolean;
  lockShowProfile: boolean;
}

const DEFAULT_SETTINGS: SystemSettings = {
  accentColor: '#4aa3ff',
  themeStyle: 'cyber',
  appearance: 'dark',
  enableScanlines: true,
  showSeconds: false,
  showWeekday: true,
  uiSounds: true,
  reduceMotion: false,
  autoLockMinutes: 0,
  lockShowDate: true,
  lockShowProfile: true,
  ...DEFAULT_ICON_SETTINGS,
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

const CREDITS = [
  {
    product: 'Browser engine',
    project: 'HeyPuter/firefox-wasm',
    url: 'https://github.com/HeyPuter/firefox-wasm',
  },
  {
    product: 'Cloud foundation',
    project: 'dimartarmizi/OmniCloud',
    url: 'https://github.com/dimartarmizi/OmniCloud',
  },
  {
    product: 'Synth Rain wallpaper',
    project: 'Saganaki22/SynthRain',
    url: 'https://github.com/Saganaki22/SynthRain',
  },
  {
    product: 'Chaos Flow wallpaper',
    project: 'Yufok1/Matrix-Rain-HTML-Background',
    url: 'https://github.com/Yufok1/Matrix-Rain-HTML-Background',
  },
  { product: 'Map rendering', project: 'Leaflet', url: 'https://leafletjs.com/' },
  {
    product: 'Map data',
    project: 'OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
  },
  { product: 'Map tile styles', project: 'CARTO', url: 'https://carto.com/attributions' },
  {
    product: 'Browser transport',
    project: 'Mercury Workshop Wisp',
    url: 'https://github.com/MercuryWorkshop/wisp-js',
  },
  { product: 'Interface icons', project: 'Lucide', url: 'https://lucide.dev/' },
  { product: 'Application framework', project: 'Next.js + React', url: 'https://nextjs.org/' },
  { product: 'PDF processing', project: 'pdf-lib + jsPDF', url: 'https://pdf-lib.js.org/' },
  {
    product: 'QR generation',
    project: 'node-qrcode',
    url: 'https://github.com/soldair/node-qrcode',
  },
  { product: 'CSV processing', project: 'Papa Parse', url: 'https://www.papaparse.com/' },
  { product: 'Markdown rendering', project: 'Marked', url: 'https://marked.js.org/' },
  { product: 'Motion primitives', project: 'Motion', url: 'https://motion.dev/' },
  {
    product: 'Database and authentication SDK',
    project: 'Supabase JavaScript',
    url: 'https://github.com/supabase/supabase-js',
  },
  {
    product: 'Cloud integrations',
    project: 'Dropbox SDK + AWS SDK',
    url: 'https://github.com/dropbox/dropbox-sdk-js',
  },
  { product: 'MEGA integration', project: 'megajs', url: 'https://mega.js.org/' },
  {
    product: 'Local database',
    project: 'better-sqlite3 + Drizzle ORM',
    url: 'https://github.com/WiseLibs/better-sqlite3',
  },
] as const;

export function SettingsApp() {
  const [settings, setSettings] = useState<SystemSettings>(() => {
    try {
      const saved = localStorage.getItem('nammu-settings');
      if (!saved) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(saved);
      delete parsed.blurIntensity;
      delete parsed.clockFormat;
      const savedTheme = ['cyber', 'obsidian', 'midnight', 'macos'].includes(parsed.themeStyle)
        ? parsed.themeStyle
        : DEFAULT_SETTINGS.themeStyle;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        ...normalizeIconSettings(parsed),
        themeStyle: savedTheme,
        appearance: parsed.appearance === 'light' ? 'light' : 'dark',
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [activeTab, setActiveTab] = useState<
    | 'appearance'
    | 'wallpaper'
    | 'icons'
    | 'audio'
    | 'taskbar'
    | 'start-menu'
    | 'security'
    | 'storage'
    | 'credits'
    | 'about'
  >('appearance');
  const { volume, setVolume: handleVolumeChange } = useMasterVolume();
  const [musicSettings, setMusicSettings] = useState<MusicPlayerSettings>(getSavedMusicSettings);
  const [musicVolume, setMusicVolume] = useState(getSavedMusicVolume);
  const [startMenuPreferences, setStartMenuPreferences] = useState<StartMenuPreferences>(() => ({
    order: DEFAULT_START_MENU_ORDER,
    hidden: [],
  }));
  const [draggedStartApp, setDraggedStartApp] = useState<SystemAppId | null>(null);
  const [lockProfile, setLockProfile] = useState<OsLockProfile | null>(getStoredLockProfile);
  const [lockUsername, setLockUsername] = useState(() => lockProfile?.username || 'nammu');
  const [lockDisplayName, setLockDisplayName] = useState(
    () => lockProfile?.displayName || 'Nammu User',
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [securityStatus, setSecurityStatus] = useState('');

  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [importStatus, setImportStatus] = useState<string>('');
  const [wallpaperSrc, setWallpaperSrc] = useState<string | null>(() => getSavedWallpaper());
  const [wallpaperMask, setWallpaperMask] = useState<boolean>(() => getSavedWallpaperMask());
  const [matrixEffectSettings, setMatrixEffectSettings] = useState<MatrixEffectSettingsMap>(() =>
    getSavedMatrixEffectSettings(),
  );
  const activeMatrixEffect = getMatrixWallpaperVariant(wallpaperSrc);

  useEffect(() => {
    const syncStartMenu = () => setStartMenuPreferences(getStartMenuPreferences());
    const syncMusic = () => {
      setMusicSettings(getSavedMusicSettings());
      setMusicVolume(getSavedMusicVolume());
    };
    syncStartMenu();
    window.addEventListener(START_MENU_ORDER_CHANGE_EVENT, syncStartMenu);
    window.addEventListener(MUSIC_SETTINGS_CHANGE_EVENT, syncMusic);
    window.addEventListener(MUSIC_VOLUME_CHANGE_EVENT, syncMusic);
    return () => {
      window.removeEventListener(START_MENU_ORDER_CHANGE_EVENT, syncStartMenu);
      window.removeEventListener(MUSIC_SETTINGS_CHANGE_EVENT, syncMusic);
      window.removeEventListener(MUSIC_VOLUME_CHANGE_EVENT, syncMusic);
    };
  }, []);

  const updateMusicSetting = <Key extends keyof MusicPlayerSettings>(
    key: Key,
    value: MusicPlayerSettings[Key],
  ) => {
    const next = saveMusicSettings({ ...musicSettings, [key]: value });
    setMusicSettings(next);
  };

  const updateMusicVolume = (value: number) => {
    const next = saveMusicVolume(value);
    setMusicVolume(next);
  };

  const updateStartMenuPreferences = (next: StartMenuPreferences) => {
    setStartMenuPreferences(saveStartMenuPreferences(next));
  };

  const moveStartMenuApp = (sourceId: SystemAppId, targetId: SystemAppId) => {
    updateStartMenuPreferences({
      ...startMenuPreferences,
      order: reorderIds(startMenuPreferences.order, sourceId, targetId),
    });
  };

  const saveSecurityProfile = async () => {
    setSecurityStatus('');
    const username = normalizeLockUsername(lockUsername);
    if (username.length < 2) {
      setSecurityStatus('Username must contain at least 2 valid characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityStatus('New passwords do not match.');
      return;
    }
    try {
      const nextProfile = newPassword
        ? await createLockProfile(username, newPassword)
        : lockProfile
          ? { ...lockProfile, username }
          : null;
      if (!nextProfile) {
        setSecurityStatus('Create a password to enable the lock profile.');
        return;
      }
      nextProfile.displayName = lockDisplayName.trim().slice(0, 48) || 'Nammu User';
      saveLockProfile(nextProfile);
      setLockProfile(nextProfile);
      setNewPassword('');
      setConfirmPassword('');
      setSecurityStatus('Lock profile saved.');
    } catch (error) {
      setSecurityStatus(error instanceof Error ? error.message : 'Unable to save lock profile.');
    }
  };

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
    applyIconSettings(document.documentElement, settings);
    document.documentElement.setAttribute(
      'data-crt-scanlines',
      settings.enableScanlines ? 'on' : 'off',
    );

    // Apply theme attribute across the operating system
    document.documentElement.setAttribute('data-theme', settings.themeStyle);
    document.documentElement.setAttribute('data-appearance', settings.appearance);
    document.documentElement.style.colorScheme = settings.appearance;
    window.dispatchEvent(
      new CustomEvent('nammu-theme-change', {
        detail: {
          theme: settings.themeStyle,
          appearance: settings.appearance,
          enableScanlines: settings.enableScanlines,
        },
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
      'nammu-calendar-events',
      'nammu-calc-history',
      'nammu-settings',
      'nammu-pinned-tools',
      'nammu-volume',
    ];

    if (typeof localStorage === 'undefined') {
      return {
        totalBytes,
        items: keys.map((key) => ({ key, bytes: 0, count: '—' })),
      };
    }

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
        'Are you sure you want to reset all Nammu OS settings, notes, and calendar events to factory defaults?',
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
          {[
            { id: 'appearance', label: 'Appearance', icon: Palette },
            { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon },
            { id: 'icons', label: 'Icons & Layout', icon: Grid3X3 },
            { id: 'audio', label: 'Sound & Audio', icon: Volume2 },
            { id: 'taskbar', label: 'Taskbar', icon: Monitor },
            { id: 'start-menu', label: 'Start Menu', icon: LayoutGrid },
            { id: 'security', label: 'Lock Screen', icon: Shield },
            { id: 'storage', label: 'Storage & Backup', icon: Database },
            { id: 'credits', label: 'Credits', icon: ExternalLink },
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
      <main className="os-scrollbar min-w-0 flex-1 overflow-y-auto p-5">
        {/* APPEARANCE */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Appearance & Visuals</h2>
              <p className="text-[10px] text-[#71889d]">
                Customize system themes, accent colors, motion, and UI rendering.
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
            <div className="space-y-3 rounded border border-white/[0.05] bg-[#05070b] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-[#d5e0ea]">CRT Scanline Shader</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Subtle phosphor scanlines across the desktop
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('enableScanlines', !settings.enableScanlines)}
                  className={`rounded px-2.5 py-1 font-mono text-[9.5px] font-semibold transition-colors ${
                    settings.enableScanlines
                      ? 'border border-os-accent bg-os-accent/20 text-os-accent'
                      : 'border border-white/[0.08] bg-white/[0.04] text-[#71889d]'
                  }`}
                >
                  {settings.enableScanlines ? 'ENABLED' : 'OFF'}
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
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

        {/* ICONS & LAYOUT */}
        {activeTab === 'icons' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Icons &amp; Layout</h2>
              <p className="text-[10px] text-[#71889d]">
                Tune icon scale, line weight, and interaction feedback across Nammu OS.
              </p>
            </div>

            <div className="settings-card space-y-4 border border-white/[0.05] bg-[#05070b] p-3">
              <label className="block space-y-2">
                <span className="flex items-center justify-between text-[10px] text-[#c5d4e2]">
                  <span>Global icon size</span>
                  <span className="font-mono text-[9px] text-os-accent">{settings.iconScale}%</span>
                </span>
                <input
                  type="range"
                  min="75"
                  max="135"
                  step="5"
                  value={settings.iconScale}
                  onChange={(event) => updateSetting('iconScale', Number(event.target.value))}
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${((settings.iconScale - 75) / 60) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                />
              </label>

              <label className="block space-y-2 border-t border-white/[0.05] pt-3">
                <span className="flex items-center justify-between text-[10px] text-[#c5d4e2]">
                  <span>Stroke weight</span>
                  <span className="font-mono text-[9px] text-os-accent">
                    {settings.iconStrokeWidth.toFixed(1)}px
                  </span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={settings.iconStrokeWidth}
                  onChange={(event) => updateSetting('iconStrokeWidth', Number(event.target.value))}
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${((settings.iconStrokeWidth - 1) / 2) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                />
              </label>

              <label className="block space-y-2 border-t border-white/[0.05] pt-3">
                <span className="flex items-center justify-between text-[10px] text-[#c5d4e2]">
                  <span>Hover enlargement</span>
                  <span className="font-mono text-[9px] text-os-accent">
                    {settings.iconHoverScale}%
                  </span>
                </span>
                <input
                  type="range"
                  min="100"
                  max="125"
                  step="1"
                  value={settings.iconHoverScale}
                  onChange={(event) => updateSetting('iconHoverScale', Number(event.target.value))}
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${(settings.iconHoverScale - 100) * 4}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                />
              </label>

              <div className="flex items-center justify-between border-t border-white/[0.05] pt-3">
                <div>
                  <div className="text-[10px] font-medium text-[#c5d4e2]">Icon motion</div>
                  <div className="text-[9px] text-[#61788c]">Animate icons during hover</div>
                </div>
                <button
                  onClick={() => updateSetting('iconMotion', !settings.iconMotion)}
                  className={`border px-2.5 py-1 font-mono text-[8px] font-semibold ${settings.iconMotion ? 'border-os-accent/40 bg-os-accent/10 text-os-accent' : 'border-white/[0.08] text-[#71889d]'}`}
                >
                  {settings.iconMotion ? 'ENABLED' : 'OFF'}
                </button>
              </div>

              <button
                onClick={() => setSettings((current) => ({ ...current, ...DEFAULT_ICON_SETTINGS }))}
                className="border border-white/[0.08] px-3 py-1.5 font-mono text-[8px] uppercase tracking-wider text-[#71889d] hover:border-os-accent/30 hover:text-os-accent"
              >
                Reset icon controls
              </button>
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

            <div className="settings-card border border-white/[0.05] bg-[#05070b]">
              <div className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Music2 size={13} className="text-os-accent" />
                  <div>
                    <div className="text-[10.5px] font-medium text-[#d5e0ea]">Music player</div>
                    <div className="text-[9px] text-[#61788c]">
                      Local playback controls, independent from master volume
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setMusicSettings(saveMusicSettings(DEFAULT_MUSIC_SETTINGS));
                    updateMusicVolume(0.72);
                  }}
                  className="flex items-center gap-1 border border-white/[0.08] px-2 py-1 font-mono text-[8px] text-os-text-muted hover:border-os-accent/30 hover:text-os-accent"
                >
                  <RotateCcw size={9} /> Reset
                </button>
              </div>

              <div className="space-y-4 p-3">
                <label className="block space-y-2">
                  <span className="flex justify-between text-[9.5px] text-os-text-muted">
                    <span>Music volume</span>
                    <span className="font-mono text-os-accent">
                      {Math.round(musicVolume * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(musicVolume * 100)}
                    onChange={(event) => updateMusicVolume(Number(event.target.value) / 100)}
                    className="os-range"
                    style={{
                      background: `linear-gradient(90deg, var(--color-os-accent) ${musicVolume * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                    }}
                  />
                </label>

                <label className="block space-y-2 border-t border-white/[0.05] pt-3">
                  <span className="flex justify-between text-[9.5px] text-os-text-muted">
                    <span>Playback speed</span>
                    <span className="font-mono text-os-accent">
                      {musicSettings.playbackRate.toFixed(2)}×
                    </span>
                  </span>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="5"
                    value={musicSettings.playbackRate * 100}
                    onChange={(event) =>
                      updateMusicSetting('playbackRate', Number(event.target.value) / 100)
                    }
                    className="os-range"
                    style={{
                      background: `linear-gradient(90deg, var(--color-os-accent) ${((musicSettings.playbackRate - 0.5) / 1.5) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                    }}
                  />
                </label>

                <div className="grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-3">
                  {(['off', 'all', 'one'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateMusicSetting('repeat', mode)}
                      className={`h-7 border font-mono text-[8px] uppercase ${musicSettings.repeat === mode ? 'border-os-accent/35 bg-os-accent/10 text-os-accent' : 'border-white/[0.07] text-os-text-dim'}`}
                    >
                      Repeat {mode}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['shuffle', 'Shuffle queue'],
                    ['autoAdvance', 'Auto-advance'],
                    ['atmosphere', 'Artwork atmosphere'],
                    ['motion', 'Player motion'],
                  ].map(([key, label]) => {
                    const settingKey = key as 'shuffle' | 'autoAdvance' | 'atmosphere' | 'motion';
                    const enabled = musicSettings[settingKey];
                    return (
                      <button
                        key={key}
                        onClick={() => updateMusicSetting(settingKey, !enabled)}
                        className="flex h-8 items-center justify-between border border-white/[0.07] px-2.5 text-[9px] text-os-text-muted hover:border-os-accent/25"
                      >
                        <span>{label}</span>
                        <span className={enabled ? 'text-os-accent' : 'text-os-text-dim'}>
                          {enabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3">
                  <label className="block space-y-2">
                    <span className="flex justify-between text-[9px] text-os-text-muted">
                      <span>Transparency</span>
                      <span className="font-mono text-os-accent">
                        {musicSettings.transparency}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="70"
                      value={musicSettings.transparency}
                      onChange={(event) =>
                        updateMusicSetting('transparency', Number(event.target.value))
                      }
                      className="os-range"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="flex justify-between text-[9px] text-os-text-muted">
                      <span>Backdrop blur</span>
                      <span className="font-mono text-os-accent">{musicSettings.blur}px</span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="36"
                      value={musicSettings.blur}
                      onChange={(event) => updateMusicSetting('blur', Number(event.target.value))}
                      className="os-range"
                    />
                  </label>
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

        {/* TASKBAR */}
        {activeTab === 'taskbar' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Taskbar</h2>
              <p className="text-[10px] text-[#71889d]">
                Configure the tray clock and taskbar behavior.
              </p>
            </div>

            <div className="bg-[#05070b] border border-white/[0.05] p-3 rounded space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Show seconds</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Add live seconds to the taskbar and clock popup
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('showSeconds', !settings.showSeconds)}
                  className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-semibold transition-colors ${
                    settings.showSeconds
                      ? 'bg-os-accent/20 border border-os-accent text-os-accent'
                      : 'bg-white/[0.04] border border-white/[0.08] text-[#71889d]'
                  }`}
                >
                  {settings.showSeconds ? 'SHOW' : 'HIDE'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <div>
                  <div className="text-[11px] text-[#d5e0ea] font-medium">Show date line</div>
                  <div className="text-[9.5px] text-[#61788c]">
                    Display weekday, day, and month below the time
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

        {/* START MENU */}
        {activeTab === 'start-menu' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Start Menu</h2>
              <p className="text-[10px] text-[#71889d]">
                Arrange, show, or hide registered apps. Newly registered apps are added
                automatically.
              </p>
            </div>

            <div className="settings-card border border-white/[0.05] bg-[#05070b]">
              <div className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2">
                <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-os-text-dim">
                  App order
                </span>
                <button
                  onClick={() =>
                    updateStartMenuPreferences({ order: DEFAULT_START_MENU_ORDER, hidden: [] })
                  }
                  className="flex items-center gap-1 font-mono text-[8px] text-os-text-muted hover:text-os-accent"
                >
                  <RotateCcw size={9} /> Restore default
                </button>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {startMenuPreferences.order.map((appId, index) => {
                  const app = SYSTEM_APPS.find((candidate) => candidate.id === appId);
                  if (!app) return null;
                  const Icon = app.icon;
                  const hidden = startMenuPreferences.hidden.includes(appId);
                  return (
                    <div
                      key={appId}
                      draggable
                      onDragStart={(event) => {
                        setDraggedStartApp(appId);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', appId);
                      }}
                      onDragOver={(event) => {
                        if (!draggedStartApp || draggedStartApp === appId) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = (draggedStartApp ||
                          event.dataTransfer.getData('text/plain')) as SystemAppId;
                        if (sourceId) moveStartMenuApp(sourceId, appId);
                        setDraggedStartApp(null);
                      }}
                      onDragEnd={() => setDraggedStartApp(null)}
                      className={`flex items-center gap-2 px-3 py-2 ${draggedStartApp === appId ? 'opacity-40' : ''}`}
                    >
                      <GripVertical size={11} className="cursor-grab text-os-text-dim" />
                      <Icon size={13} className="text-os-accent" />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-os-text-muted">
                        {app.title}
                      </span>
                      <span className="w-5 text-right font-mono text-[8px] text-os-text-dim">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <button
                        onClick={() =>
                          index > 0 &&
                          moveStartMenuApp(appId, startMenuPreferences.order[index - 1])
                        }
                        disabled={index === 0}
                        className="grid h-6 w-6 place-items-center text-os-text-dim hover:text-os-accent disabled:opacity-20"
                        aria-label={`Move ${app.title} up`}
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        onClick={() =>
                          index < startMenuPreferences.order.length - 1 &&
                          moveStartMenuApp(appId, startMenuPreferences.order[index + 1])
                        }
                        disabled={index === startMenuPreferences.order.length - 1}
                        className="grid h-6 w-6 place-items-center text-os-text-dim hover:text-os-accent disabled:opacity-20"
                        aria-label={`Move ${app.title} down`}
                      >
                        <ArrowDown size={10} />
                      </button>
                      <button
                        onClick={() =>
                          updateStartMenuPreferences({
                            ...startMenuPreferences,
                            hidden: hidden
                              ? startMenuPreferences.hidden.filter((id) => id !== appId)
                              : [...startMenuPreferences.hidden, appId],
                          })
                        }
                        className={`grid h-6 w-6 place-items-center ${hidden ? 'text-os-text-dim' : 'text-os-accent'}`}
                        aria-label={`${hidden ? 'Show' : 'Hide'} ${app.title}`}
                      >
                        {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* LOCK SCREEN */}
        {activeTab === 'security' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Lock Screen &amp; Identity</h2>
              <p className="text-[10px] text-[#71889d]">
                Manage the local workstation identity, password, visibility, and automatic locking.
              </p>
            </div>

            <div className="settings-card space-y-3 border border-white/[0.05] bg-[#05070b] p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                    User ID
                  </span>
                  <div className="flex h-8 items-center gap-2 border border-white/[0.08] px-2.5">
                    <UserRound size={11} className="text-os-text-dim" />
                    <input
                      value={lockUsername}
                      onChange={(event) => setLockUsername(event.target.value)}
                      maxLength={32}
                      className="min-w-0 flex-1 bg-transparent text-[10px] text-os-text outline-none"
                    />
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                    Display name
                  </span>
                  <input
                    value={lockDisplayName}
                    onChange={(event) => setLockDisplayName(event.target.value)}
                    maxLength={48}
                    className="h-8 w-full border border-white/[0.08] bg-transparent px-2.5 text-[10px] text-os-text outline-none focus:border-os-accent/35"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3">
                <label className="space-y-1.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                    New password
                  </span>
                  <div className="flex h-8 items-center gap-2 border border-white/[0.08] px-2.5">
                    <LockKeyhole size={11} className="text-os-text-dim" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder={
                        lockProfile ? 'Leave blank to keep current' : 'At least 6 characters'
                      }
                      className="min-w-0 flex-1 bg-transparent text-[10px] text-os-text outline-none"
                    />
                    <button
                      onClick={() => setShowNewPassword((current) => !current)}
                      className="text-os-text-dim hover:text-os-accent"
                      aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    >
                      {showNewPassword ? <EyeOff size={11} /> : <Eye size={11} />}
                    </button>
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                    Confirm password
                  </span>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-8 w-full border border-white/[0.08] bg-transparent px-2.5 text-[10px] text-os-text outline-none focus:border-os-accent/35"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
                <div>
                  <div className="text-[10px] text-os-text-muted">Automatic lock</div>
                  <div className="text-[9px] text-os-text-dim">Lock after inactivity</div>
                </div>
                <select
                  value={settings.autoLockMinutes}
                  onChange={(event) => updateSetting('autoLockMinutes', Number(event.target.value))}
                  className="h-8 border border-white/[0.08] bg-[#070b12] px-2 text-[9px] text-os-text outline-none"
                >
                  <option value="0">Never</option>
                  <option value="1">1 minute</option>
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['lockShowProfile', 'Show profile identity'],
                  ['lockShowDate', 'Show date and time'],
                ].map(([key, label]) => {
                  const settingKey = key as 'lockShowProfile' | 'lockShowDate';
                  return (
                    <button
                      key={key}
                      onClick={() => updateSetting(settingKey, !settings[settingKey])}
                      className="flex h-8 items-center justify-between border border-white/[0.07] px-2.5 text-[9px] text-os-text-muted"
                    >
                      <span>{label}</span>
                      <span
                        className={settings[settingKey] ? 'text-os-accent' : 'text-os-text-dim'}
                      >
                        {settings[settingKey] ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {securityStatus && (
                <div className="border-l-2 border-os-accent/40 bg-os-accent/[0.04] px-2.5 py-2 font-mono text-[8px] text-os-text-muted">
                  {securityStatus}
                </div>
              )}

              <div className="flex gap-2 border-t border-white/[0.05] pt-3">
                <button
                  onClick={() => void saveSecurityProfile()}
                  className="h-8 flex-1 border border-os-accent/30 bg-os-accent/10 font-mono text-[8px] uppercase tracking-wider text-os-accent hover:bg-os-accent/15"
                >
                  Save lock profile
                </button>
                <button
                  onClick={() => {
                    saveLockState(true);
                    window.dispatchEvent(new Event('nammu-lock-now'));
                  }}
                  className="h-8 flex-1 border border-white/[0.08] font-mono text-[8px] uppercase tracking-wider text-os-text-muted hover:border-os-accent/25 hover:text-os-accent"
                >
                  Lock now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CREDITS */}
        {activeTab === 'credits' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-[#e8eef4]">Credits &amp; Open Source</h2>
              <p className="text-[10px] text-[#71889d]">
                Nammu OS is built with and inspired by these third-party projects.
              </p>
            </div>
            <div className="settings-card divide-y divide-white/[0.05] border border-white/[0.05] bg-[#05070b]">
              {CREDITS.map((credit) => (
                <a
                  key={`${credit.product}-${credit.project}`}
                  href={credit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.025]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-os-text">{credit.product}</div>
                    <div className="mt-0.5 truncate font-mono text-[8px] text-os-text-dim">
                      {credit.project}
                    </div>
                  </div>
                  <ExternalLink size={11} className="shrink-0 text-os-accent" />
                </a>
              ))}
            </div>
            <p className="text-[8.5px] leading-relaxed text-os-text-dim">
              Each project remains subject to its own license and attribution requirements. This
              list can be extended as Nammu OS adopts additional third-party components.
            </p>
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
                Erase all customized notes, calendar entries, and settings.
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

      <aside className="settings-inspector os-scrollbar w-56 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-white/[0.012] p-3">
        {activeTab === 'appearance' && (
          <div className="space-y-3">
            <div className="settings-inspector-section">
              <div className="settings-inspector-label">Active interface</div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="h-8 w-8 border border-white/[0.1]"
                  style={{ background: settings.accentColor }}
                />
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-medium text-os-text">
                    {THEME_OPTIONS.find((theme) => theme.id === settings.themeStyle)?.name}
                  </div>
                  <div className="font-mono text-[8px] uppercase text-os-text-dim">
                    {settings.appearance} · {settings.accentColor}
                  </div>
                </div>
              </div>
            </div>
            <div className="settings-inspector-note">
              Theme and appearance changes are applied to every open application immediately.
            </div>
          </div>
        )}

        {activeTab === 'wallpaper' && (
          <div className="space-y-3">
            <div className="settings-inspector-section overflow-hidden p-0">
              <div
                className="h-28 bg-cover bg-center"
                style={
                  wallpaperSrc === null
                    ? {
                        background:
                          'radial-gradient(ellipse at 50% 30%, var(--color-os-panel), var(--color-os-bg))',
                      }
                    : getMatrixWallpaperVariant(wallpaperSrc)
                      ? {
                          background: WALLPAPERS.find((wallpaper) => wallpaper.src === wallpaperSrc)
                            ?.preview,
                        }
                      : { backgroundImage: `url("${encodeURI(wallpaperSrc)}")` }
                }
              />
              <div className="border-t border-white/[0.06] p-2.5">
                <div className="text-[10px] font-medium text-os-text">
                  {getWallpaperName(wallpaperSrc)}
                </div>
                <div className="mt-0.5 font-mono text-[7.5px] uppercase tracking-wider text-os-text-dim">
                  Active wallpaper
                </div>
              </div>
            </div>

            {activeMatrixEffect && (
              <div className="settings-inspector-section space-y-3">
                <div className="settings-inspector-label">
                  {activeMatrixEffect === 'synth-rain' ? 'Synth Rain' : 'Chaos Flow'} controls
                </div>
                <label className="block space-y-1.5">
                  <span className="flex justify-between text-[9px] text-os-text-muted">
                    <span>Color</span>
                    <span className="font-mono text-[7.5px]">
                      {matrixEffectSettings[activeMatrixEffect].color}
                    </span>
                  </span>
                  <input
                    type="color"
                    value={matrixEffectSettings[activeMatrixEffect].color}
                    onChange={(event) =>
                      updateMatrixEffectSetting(activeMatrixEffect, 'color', event.target.value)
                    }
                    className="h-7 w-full cursor-pointer border border-white/[0.08] bg-transparent p-0.5"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="flex justify-between text-[9px] text-os-text-muted">
                    <span>Speed</span>
                    <span className="font-mono text-[8px] text-os-accent">
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
                  />
                </label>
                <label className="block space-y-2">
                  <span className="flex justify-between text-[9px] text-os-text-muted">
                    <span>Size</span>
                    <span className="font-mono text-[8px] text-os-accent">
                      {matrixEffectSettings[activeMatrixEffect].size}px
                    </span>
                  </span>
                  <input
                    type="range"
                    min="10"
                    max="28"
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
                  />
                </label>
              </div>
            )}

            <button
              type="button"
              onClick={toggleWallpaperMask}
              className="settings-inspector-option"
              aria-pressed={wallpaperMask}
            >
              <span>Readability mask</span>
              <span className={wallpaperMask ? 'text-os-accent' : 'text-os-text-dim'}>
                {wallpaperMask ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        )}

        {activeTab === 'icons' && (
          <div className="space-y-3">
            <div className="settings-inspector-section">
              <div className="settings-inspector-label">Live icon preview</div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-os-text-muted">
                {[Folder, Bell, Palette, Grid3X3].map((Icon, index) => (
                  <button
                    key={index}
                    className="grid h-12 place-items-center border border-white/[0.06] hover:border-os-accent/25 hover:text-os-accent"
                  >
                    <Icon size={18} />
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-inspector-note">
              Icon controls affect Lucide interface icons in apps, tools, menus, windows, and the
              taskbar.
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="space-y-3">
            <div className="settings-inspector-section text-center">
              <div className="font-mono text-[28px] leading-none text-os-accent">{volume}%</div>
              <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                Master output
              </div>
            </div>
            <div className="settings-inspector-note">
              Music retains its own local gain while master output controls all OS media.
            </div>
            <div className="settings-inspector-section text-center">
              <div className="font-mono text-[22px] leading-none text-os-text">
                {Math.round(musicVolume * 100)}%
              </div>
              <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                Music output
              </div>
            </div>
          </div>
        )}

        {activeTab === 'taskbar' && (
          <div className="space-y-3">
            <div className="settings-inspector-section">
              <div className="settings-inspector-label">Taskbar interaction</div>
              <ul className="mt-2 space-y-2 text-[9px] leading-relaxed text-os-text-muted">
                <li>Drag pinned icons to rearrange them.</li>
                <li>Middle-click a running app to close it.</li>
                <li>Scroll over running apps to switch focus.</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'start-menu' && (
          <div className="space-y-3">
            <div className="settings-inspector-section text-center">
              <div className="font-mono text-[24px] leading-none text-os-accent">
                {startMenuPreferences.order.length - startMenuPreferences.hidden.length}
              </div>
              <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                Visible apps
              </div>
            </div>
            <div className="settings-inspector-note">
              Drag rows here or app icons directly inside the Start Menu. The registry automatically
              appends future apps.
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-3">
            <div className="settings-inspector-section">
              <div className="settings-inspector-label">Local identity</div>
              <div className="mt-3 flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center border border-os-accent/25 bg-os-accent/[0.06] font-display text-[12px] text-os-accent">
                  {(lockDisplayName || 'NU')
                    .split(/\s+/)
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[10px] text-os-text">{lockDisplayName}</div>
                  <div className="truncate font-mono text-[8px] text-os-text-dim">
                    @{normalizeLockUsername(lockUsername)}
                  </div>
                </div>
              </div>
            </div>
            <div className="settings-inspector-note">
              Password hashes are salted with PBKDF2 and remain in this browser profile.
            </div>
          </div>
        )}

        {activeTab === 'credits' && (
          <div className="space-y-3">
            <div className="settings-inspector-section text-center">
              <div className="font-mono text-[24px] leading-none text-os-accent">
                {CREDITS.length}
              </div>
              <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
                Credited projects
              </div>
            </div>
            <div className="settings-inspector-note">
              Attribution is kept in Settings so it remains accessible without covering application
              content.
            </div>
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="settings-inspector-section text-center">
            <div className="font-mono text-[22px] leading-none text-os-accent">
              {(storageStats.totalBytes / 1024).toFixed(2)} KB
            </div>
            <div className="mt-2 font-mono text-[8px] uppercase tracking-wider text-os-text-dim">
              Local OS data
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-3">
            <div className="settings-inspector-section">
              <div className="settings-inspector-label">Runtime</div>
              <div className="mt-2 space-y-1.5 font-mono text-[8px] text-os-text-muted">
                <div className="flex justify-between">
                  <span>VERSION</span>
                  <span className="text-os-text">4.1.0</span>
                </div>
                <div className="flex justify-between">
                  <span>UPTIME</span>
                  <span className="text-os-accent">{formatUptime(uptimeSeconds)}</span>
                </div>
                <div className="flex justify-between">
                  <span>MODE</span>
                  <span className="text-os-text">LOCAL</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>
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
