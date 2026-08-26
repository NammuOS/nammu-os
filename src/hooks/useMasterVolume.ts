import { useCallback, useEffect, useState } from 'react';
import {
  MASTER_VOLUME_CHANGE_EVENT,
  MASTER_VOLUME_STORAGE_KEY,
  getStoredMasterVolume,
  normalizeMasterVolume,
  readMasterVolumeEvent,
  setStoredMasterVolume,
} from '../lib/osVolume';

export function useMasterVolume() {
  const [volume, setVolumeState] = useState(getStoredMasterVolume);

  useEffect(() => {
    const handleVolumeChange = (event: Event) => {
      const nextVolume = readMasterVolumeEvent(event);
      if (nextVolume !== null) setVolumeState(nextVolume);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MASTER_VOLUME_STORAGE_KEY) return;
      setVolumeState(
        event.newValue === null
          ? getStoredMasterVolume()
          : normalizeMasterVolume(Number(event.newValue)),
      );
    };

    window.addEventListener(MASTER_VOLUME_CHANGE_EVENT, handleVolumeChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(MASTER_VOLUME_CHANGE_EVENT, handleVolumeChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const normalized = setStoredMasterVolume(nextVolume);
    setVolumeState(normalized);
  }, []);

  return { volume, setVolume } as const;
}
