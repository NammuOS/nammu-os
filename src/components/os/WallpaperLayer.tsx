'use client';

import { useEffect, useState } from 'react';
import {
  WALLPAPER_CHANGE_EVENT,
  WALLPAPER_MASK_CHANGE_EVENT,
  getSavedWallpaper,
  getSavedWallpaperMask,
} from '../../lib/wallpapers';

export default function WallpaperLayer() {
  const [src, setSrc] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [maskEnabled, setMaskEnabled] = useState(true);

  useEffect(() => {
    const saved = getSavedWallpaper();
    if (saved) setSrc(saved);
    setMaskEnabled(getSavedWallpaperMask());

    const handleChange = (e: Event) => {
      const next = (e as CustomEvent<{ src: string | null }>).detail?.src ?? null;
      setReady(false);
      setSrc(next);
    };
    const handleMaskChange = (e: Event) => {
      const enabled = (e as CustomEvent<{ enabled: boolean }>).detail?.enabled;
      setMaskEnabled(enabled !== false);
    };
    window.addEventListener(WALLPAPER_CHANGE_EVENT, handleChange);
    window.addEventListener(WALLPAPER_MASK_CHANGE_EVENT, handleMaskChange);
    return () => {
      window.removeEventListener(WALLPAPER_CHANGE_EVENT, handleChange);
      window.removeEventListener(WALLPAPER_MASK_CHANGE_EVENT, handleMaskChange);
    };
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setReady(true);
    img.onerror = () => setReady(true);
    img.src = encodeURI(src);
  }, [src]);

  if (!src) return null;

  return (
    <div
      aria-hidden
      className={`wallpaper-layer absolute inset-0 pointer-events-none transition-opacity duration-700 ${
        ready ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="w-full h-full bg-cover bg-center"
        style={{ backgroundImage: `url("${encodeURI(src)}")` }}
      />
      {maskEnabled && (
        <div
          className="wallpaper-mask absolute inset-0"
          style={{
            background: [
              'linear-gradient(180deg, rgba(5,8,13,0.35) 0%, rgba(5,8,13,0.15) 40%, rgba(5,8,13,0.6) 100%)',
              'linear-gradient(90deg, rgba(5,8,13,0.55) 0%, rgba(5,8,13,0) 20%, rgba(5,8,13,0) 80%, rgba(5,8,13,0.55) 100%)',
            ].join(', '),
          }}
        />
      )}
    </div>
  );
}
