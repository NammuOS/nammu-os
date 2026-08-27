export const MUSIC_VOLUME_STORAGE_KEY = 'nammu-music-volume';
export const MUSIC_SETTINGS_STORAGE_KEY = 'nammu-music-settings';
export const MUSIC_SETTINGS_CHANGE_EVENT = 'nammu-music-settings-change';
export const MUSIC_VOLUME_CHANGE_EVENT = 'nammu-music-volume-change';

export type MusicPane = 'now' | 'queue' | 'lyrics';
export type MusicRepeatMode = 'off' | 'all' | 'one';

export interface MusicPlayerSettings {
  transparency: number;
  blur: number;
  playbackRate: number;
  atmosphere: boolean;
  motion: boolean;
  autoAdvance: boolean;
  shuffle: boolean;
  repeat: MusicRepeatMode;
  pane: MusicPane;
}

export const DEFAULT_MUSIC_SETTINGS: MusicPlayerSettings = {
  transparency: 10,
  blur: 24,
  playbackRate: 1,
  atmosphere: true,
  motion: true,
  autoAdvance: true,
  shuffle: false,
  repeat: 'all',
  pane: 'now',
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeMusicSettings(
  value: Partial<MusicPlayerSettings> | null | undefined,
): MusicPlayerSettings {
  return {
    transparency: clamp(value?.transparency, DEFAULT_MUSIC_SETTINGS.transparency, 0, 70),
    blur: clamp(value?.blur, DEFAULT_MUSIC_SETTINGS.blur, 0, 36),
    playbackRate: clamp(value?.playbackRate, DEFAULT_MUSIC_SETTINGS.playbackRate, 0.5, 2),
    atmosphere:
      typeof value?.atmosphere === 'boolean' ? value.atmosphere : DEFAULT_MUSIC_SETTINGS.atmosphere,
    motion: typeof value?.motion === 'boolean' ? value.motion : DEFAULT_MUSIC_SETTINGS.motion,
    autoAdvance:
      typeof value?.autoAdvance === 'boolean'
        ? value.autoAdvance
        : DEFAULT_MUSIC_SETTINGS.autoAdvance,
    shuffle: typeof value?.shuffle === 'boolean' ? value.shuffle : DEFAULT_MUSIC_SETTINGS.shuffle,
    repeat: ['off', 'all', 'one'].includes(value?.repeat || '')
      ? (value?.repeat as MusicRepeatMode)
      : DEFAULT_MUSIC_SETTINGS.repeat,
    pane: ['now', 'queue', 'lyrics'].includes(value?.pane || '')
      ? (value?.pane as MusicPane)
      : DEFAULT_MUSIC_SETTINGS.pane,
  };
}

export function areMusicSettingsEqual(
  first: MusicPlayerSettings,
  second: MusicPlayerSettings,
): boolean {
  return (Object.keys(DEFAULT_MUSIC_SETTINGS) as Array<keyof MusicPlayerSettings>).every(
    (key) => first[key] === second[key],
  );
}

export function getSavedMusicSettings(): MusicPlayerSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_MUSIC_SETTINGS };
  try {
    return normalizeMusicSettings(
      JSON.parse(localStorage.getItem(MUSIC_SETTINGS_STORAGE_KEY) || '{}'),
    );
  } catch {
    return { ...DEFAULT_MUSIC_SETTINGS };
  }
}

export function saveMusicSettings(value: Partial<MusicPlayerSettings>): MusicPlayerSettings {
  const settings = normalizeMusicSettings(value);
  if (typeof window !== 'undefined') {
    localStorage.setItem(MUSIC_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(
      new CustomEvent<MusicPlayerSettings>(MUSIC_SETTINGS_CHANGE_EVENT, { detail: settings }),
    );
  }
  return settings;
}

export function getSavedMusicVolume(): number {
  if (typeof window === 'undefined') return 0.72;
  try {
    const stored = localStorage.getItem(MUSIC_VOLUME_STORAGE_KEY);
    return stored === null ? 0.72 : clamp(stored, 0.72, 0, 1);
  } catch {
    return 0.72;
  }
}

export function saveMusicVolume(value: number): number {
  const volume = clamp(value, 0.72, 0, 1);
  if (typeof window !== 'undefined') {
    localStorage.setItem(MUSIC_VOLUME_STORAGE_KEY, String(volume));
    window.dispatchEvent(new CustomEvent<number>(MUSIC_VOLUME_CHANGE_EVENT, { detail: volume }));
  }
  return volume;
}
