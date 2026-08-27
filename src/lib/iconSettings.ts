export interface IconSettings {
  iconScale: number;
  iconStrokeWidth: number;
  iconHoverScale: number;
  iconMotion: boolean;
}

export const DEFAULT_ICON_SETTINGS: IconSettings = {
  iconScale: 100,
  iconStrokeWidth: 1.8,
  iconHoverScale: 108,
  iconMotion: true,
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeIconSettings(
  value: Partial<IconSettings> | null | undefined,
): IconSettings {
  return {
    iconScale: clamp(value?.iconScale, DEFAULT_ICON_SETTINGS.iconScale, 75, 135),
    iconStrokeWidth: clamp(value?.iconStrokeWidth, DEFAULT_ICON_SETTINGS.iconStrokeWidth, 1, 3),
    iconHoverScale: clamp(value?.iconHoverScale, DEFAULT_ICON_SETTINGS.iconHoverScale, 100, 125),
    iconMotion:
      typeof value?.iconMotion === 'boolean' ? value.iconMotion : DEFAULT_ICON_SETTINGS.iconMotion,
  };
}

export function applyIconSettings(
  root: HTMLElement,
  value: Partial<IconSettings> | null | undefined,
): IconSettings {
  const settings = normalizeIconSettings(value);
  root.style.setProperty('--os-icon-scale', String(settings.iconScale / 100));
  root.style.setProperty('--os-icon-stroke', String(settings.iconStrokeWidth));
  root.style.setProperty('--os-icon-hover-scale', String(settings.iconHoverScale / 100));
  root.setAttribute('data-icon-motion', settings.iconMotion ? 'on' : 'off');
  return settings;
}
