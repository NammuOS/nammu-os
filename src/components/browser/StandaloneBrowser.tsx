'use client';

import BrowserApp from './BrowserApp';

export default function StandaloneBrowser() {
  return (
    <main className="h-dvh w-screen overflow-hidden bg-[#05070b]">
      <BrowserApp />
    </main>
  );
}
