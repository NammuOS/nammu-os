export interface Wallpaper {
  id: string;
  name: string;
  src: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'whale', name: 'Whale', src: '/wallpapers/whale.webp' },
  { id: 'high-tech-city', name: 'High-Tech City', src: '/wallpapers/high-tech city.webp' },
];

export const WALLPAPER_STORAGE_KEY = 'nammu-wallpaper';
export const WALLPAPER_CHANGE_EVENT = 'nammu-wallpaper-change';
export const WALLPAPER_MASK_STORAGE_KEY = 'nammu-wallpaper-mask';
export const WALLPAPER_MASK_CHANGE_EVENT = 'nammu-wallpaper-mask-change';

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
