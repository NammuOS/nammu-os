'use client';

import dynamic from 'next/dynamic';

const DesktopOS = dynamic(() => import('@/components/desktop/DesktopApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#05070b] text-[#6b8296] font-mono text-xs">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <span className="tracking-widest uppercase text-[10px] text-cyan-400 font-semibold">
          Nammu OS Kernel Booting...
        </span>
      </div>
    </div>
  ),
});

export default function DesktopClient() {
  return <DesktopOS />;
}
