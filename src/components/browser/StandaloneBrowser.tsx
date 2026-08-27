'use client';

import { useEffect } from 'react';
import { applyIconSettings } from '../../lib/iconSettings';
import BrowserApp from './BrowserApp';

export default function StandaloneBrowser() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nammu-settings');
      applyIconSettings(document.documentElement, saved ? JSON.parse(saved) : null);
    } catch {
      applyIconSettings(document.documentElement, null);
    }
  }, []);

  return (
    <main className="h-dvh w-screen overflow-hidden bg-[#05070b]">
      <BrowserApp />
    </main>
  );
}
