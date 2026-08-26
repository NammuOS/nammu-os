export const MASTER_VOLUME_STORAGE_KEY = 'nammu-volume';
export const MASTER_VOLUME_CHANGE_EVENT = 'nammu-volume-change';
export const DEFAULT_MASTER_VOLUME = 72;

export interface MasterVolumeChangeDetail {
  percent: number;
  volume: number;
}

export function normalizeMasterVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MASTER_VOLUME;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getStoredMasterVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_MASTER_VOLUME;
  try {
    const stored = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    return stored === null ? DEFAULT_MASTER_VOLUME : normalizeMasterVolume(Number(stored));
  } catch {
    return DEFAULT_MASTER_VOLUME;
  }
}

export function setStoredMasterVolume(value: number): number {
  const percent = normalizeMasterVolume(value);
  if (typeof window === 'undefined') return percent;

  try {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, String(percent));
  } catch {}

  window.dispatchEvent(
    new CustomEvent<MasterVolumeChangeDetail>(MASTER_VOLUME_CHANGE_EVENT, {
      detail: { percent, volume: percent / 100 },
    }),
  );
  return percent;
}

export function readMasterVolumeEvent(event: Event): number | null {
  const detail = (event as CustomEvent<Partial<MasterVolumeChangeDetail>>).detail;
  if (typeof detail?.percent === 'number') return normalizeMasterVolume(detail.percent);
  if (typeof detail?.volume === 'number') return normalizeMasterVolume(detail.volume * 100);
  return null;
}

export function getEffectiveMediaVolume(localVolume: number, masterPercent: number): number {
  const local = Math.max(0, Math.min(1, Number.isFinite(localVolume) ? localVolume : 1));
  return local * (normalizeMasterVolume(masterPercent) / 100);
}

export function applyMasterVolumeToMedia(masterPercent: number, root: ParentNode = document): void {
  const masterVolume = normalizeMasterVolume(masterPercent) / 100;
  root.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => {
    if (media.dataset.nammuVolumeManaged === 'local') return;
    try {
      media.volume = masterVolume;
    } catch {}
  });
}
