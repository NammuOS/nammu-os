export interface Wallpaper {
  id: string;
  name: string;
  src: string;
  kind: 'image' | 'effect';
  description: string;
  preview?: string;
}

export type MatrixWallpaperVariant = 'synth-rain' | 'chaos-flow';

export interface MatrixEffectSettings {
  color: string;
  speed: number;
  size: number;
}

export type MatrixEffectSettingsMap = Record<MatrixWallpaperVariant, MatrixEffectSettings>;

export const DEFAULT_MATRIX_EFFECT_SETTINGS: MatrixEffectSettingsMap = {
  'synth-rain': { color: '#20ff72', speed: 100, size: 16 },
  'chaos-flow': { color: '#c43cff', speed: 100, size: 14 },
};

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'synth-rain',
    name: 'Synth Rain',
    src: 'effect:synth-rain',
    kind: 'effect',
    description: 'Classic green matrix rain',
    preview:
      'repeating-linear-gradient(90deg, transparent 0 11px, rgba(32,255,114,.2) 12px 13px), linear-gradient(150deg, #071b0d, #010403 72%)',
  },
  {
    id: 'chaos-flow',
    name: 'Chaos Flow',
    src: 'effect:chaos-flow',
    kind: 'effect',
    description: 'Chromatic turbulent matrix flow',
    preview:
      'radial-gradient(circle at 20% 20%, rgba(255,0,153,.7), transparent 28%), radial-gradient(circle at 78% 35%, rgba(0,220,255,.65), transparent 32%), radial-gradient(circle at 48% 90%, rgba(91,255,68,.5), transparent 35%), #070611',
  },
  {
    id: 'whale',
    name: 'Whale',
    src: '/wallpapers/whale.webp',
    kind: 'image',
    description: 'Deep ocean scene',
  },
  {
    id: 'high-tech-city',
    name: 'High-Tech City',
    src: '/wallpapers/high-tech city.webp',
    kind: 'image',
    description: 'Futuristic cityscape',
  },
];

export const WALLPAPER_STORAGE_KEY = 'nammu-wallpaper';
export const WALLPAPER_CHANGE_EVENT = 'nammu-wallpaper-change';
export const WALLPAPER_MASK_STORAGE_KEY = 'nammu-wallpaper-mask';
export const WALLPAPER_MASK_CHANGE_EVENT = 'nammu-wallpaper-mask-change';
export const MATRIX_EFFECT_SETTINGS_STORAGE_KEY = 'nammu-matrix-effect-settings';
export const MATRIX_EFFECT_SETTINGS_CHANGE_EVENT = 'nammu-matrix-effect-settings-change';

export function isWallpaperEffect(src: string | null): src is `effect:${string}` {
  return Boolean(src?.startsWith('effect:'));
}

export function getMatrixWallpaperVariant(src: string | null): MatrixWallpaperVariant | null {
  if (src === 'effect:synth-rain') return 'synth-rain';
  if (src === 'effect:chaos-flow') return 'chaos-flow';
  return null;
}

function normalizeMatrixEffectSettings(
  variant: MatrixWallpaperVariant,
  value?: Partial<MatrixEffectSettings>,
): MatrixEffectSettings {
  const defaults = DEFAULT_MATRIX_EFFECT_SETTINGS[variant];
  const color = /^#[0-9a-f]{6}$/i.test(value?.color || '') ? value!.color! : defaults.color;
  const speed = Math.min(200, Math.max(25, Number(value?.speed) || defaults.speed));
  const size = Math.min(28, Math.max(10, Number(value?.size) || defaults.size));
  return { color, speed, size };
}

export function getSavedMatrixEffectSettings(): MatrixEffectSettingsMap {
  try {
    const saved = JSON.parse(localStorage.getItem(MATRIX_EFFECT_SETTINGS_STORAGE_KEY) || '{}') as
      Partial<Record<MatrixWallpaperVariant, Partial<MatrixEffectSettings>>> | undefined;

    return {
      'synth-rain': normalizeMatrixEffectSettings('synth-rain', saved?.['synth-rain']),
      'chaos-flow': normalizeMatrixEffectSettings('chaos-flow', saved?.['chaos-flow']),
    };
  } catch {
    return {
      'synth-rain': { ...DEFAULT_MATRIX_EFFECT_SETTINGS['synth-rain'] },
      'chaos-flow': { ...DEFAULT_MATRIX_EFFECT_SETTINGS['chaos-flow'] },
    };
  }
}

export function saveMatrixEffectSettings(
  variant: MatrixWallpaperVariant,
  settings: MatrixEffectSettings,
) {
  const nextSettings = {
    ...getSavedMatrixEffectSettings(),
    [variant]: normalizeMatrixEffectSettings(variant, settings),
  };

  try {
    localStorage.setItem(MATRIX_EFFECT_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch {}

  window.dispatchEvent(
    new CustomEvent(MATRIX_EFFECT_SETTINGS_CHANGE_EVENT, {
      detail: { variant, settings: nextSettings[variant] },
    }),
  );
}

export function getSavedWallpaper(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveWallpaper(src: string | null) {
  try {
    if (src) localStorage.setItem(WALLPAPER_STORAGE_KEY, src);
    else localStorage.removeItem(WALLPAPER_STORAGE_KEY);
  } catch {}

  window.dispatchEvent(
    new CustomEvent(WALLPAPER_CHANGE_EVENT, {
      detail: { src },
    }),
  );
}

export function getWallpaperName(src: string | null): string {
  if (!src) return 'Default';
  return WALLPAPERS.find((wp) => wp.src === src)?.name || 'Custom';
}

export function getSavedWallpaperMask(): boolean {
  try {
    return localStorage.getItem(WALLPAPER_MASK_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveWallpaperMask(enabled: boolean) {
  try {
    localStorage.setItem(WALLPAPER_MASK_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {}

  window.dispatchEvent(
    new CustomEvent(WALLPAPER_MASK_CHANGE_EVENT, {
      detail: { enabled },
    }),
  );
}
