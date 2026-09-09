export interface Wallpaper {
  id: string;
  name: string;
  src: string;
  kind: 'image' | 'effect';
  description: string;
  preview?: string;
  accent?: string;
}

export type MatrixWallpaperVariant = 'synth-rain' | 'chaos-flow';

export const DEFAULT_HORIZON_WALLPAPER_SRC = '/wallpapers/horizon/21.avif';
export const DEFAULT_HORIZON_WALLPAPER_ACCENT = '#f25c0d';

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
  ...[
    ['01', '#6f30ff'],
    ['02', '#bd6257'],
    ['03', '#c4610c'],
    ['04', '#0076a3'],
    ['05', '#007aa8'],
    ['06', '#008a5c'],
    ['07', '#587f00'],
    ['08', '#008991'],
    ['09', '#d86668'],
    ['10', '#df7441'],
    ['11', '#008991'],
    ['12', '#dd136f'],
    ['13', '#1384b4'],
    ['14', '#ea106f'],
    ['15', '#b86100'],
    ['16', '#5a00d6'],
    ['17', '#008087'],
    ['18', '#6f30ff'],
    ['19', '#158cd1'],
    ['20', '#6f30ff'],
    ['21', DEFAULT_HORIZON_WALLPAPER_ACCENT],
    ['22', '#62a032'],
    ['23', '#f25c0d'],
    ['24', '#107bd0'],
    ['25', '#20b49f'],
  ].map(([number, accent]) => ({
    id: `horizon-${number}`,
    name: `Horizon ${number}`,
    src: `/wallpapers/horizon/${Number(number)}.avif`,
    kind: 'image' as const,
    description: 'Atmospheric landscape',
    accent,
  })),
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
];

export const WALLPAPER_STORAGE_KEY = 'nammu-wallpaper';
const WALLPAPER_NONE_VALUE = 'none';
const WALLPAPER_DEFAULT_VERSION_KEY = 'nammu-wallpaper-default-version';
const WALLPAPER_DEFAULT_VERSION = 'horizon-21-v1';
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

export function normalizeMatrixEffectSettings(
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
    const stored = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    const saved = stored === WALLPAPER_NONE_VALUE ? null : stored;
    const defaultVersion = localStorage.getItem(WALLPAPER_DEFAULT_VERSION_KEY);
    if (defaultVersion !== WALLPAPER_DEFAULT_VERSION) {
      localStorage.setItem(WALLPAPER_DEFAULT_VERSION_KEY, WALLPAPER_DEFAULT_VERSION);
      if (stored !== WALLPAPER_NONE_VALUE && (!saved || saved === '/wallpapers/horizon/23.avif')) {
        localStorage.setItem(WALLPAPER_STORAGE_KEY, DEFAULT_HORIZON_WALLPAPER_SRC);
        return DEFAULT_HORIZON_WALLPAPER_SRC;
      }
    }
    return stored === WALLPAPER_NONE_VALUE ? null : saved || DEFAULT_HORIZON_WALLPAPER_SRC;
  } catch {
    return DEFAULT_HORIZON_WALLPAPER_SRC;
  }
}

export function saveWallpaper(src: string | null) {
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, src || WALLPAPER_NONE_VALUE);
  } catch {}

  window.dispatchEvent(
    new CustomEvent(WALLPAPER_CHANGE_EVENT, {
      detail: { src },
    }),
  );
}

export function getWallpaperName(src: string | null): string {
  if (!src) return 'Horizon 21';
  return WALLPAPERS.find((wp) => wp.src === src)?.name || 'Custom';
}

export function getWallpaperAccent(src: string | null): string | undefined {
  return WALLPAPERS.find((wallpaper) => wallpaper.src === src)?.accent;
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
