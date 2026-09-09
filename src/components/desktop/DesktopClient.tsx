'use client';

import dynamic from 'next/dynamic';

const DesktopOS = dynamic(() => import('@/components/desktop/DesktopApp'), {
  ssr: false,
  loading: () => (
    <div className="horizon-boot-surface h-screen w-screen" aria-label="Opening Nammu OS">
      <div className="horizon-boot-glow" aria-hidden="true" />
      <div className="horizon-boot-dock" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  ),
});

export default function DesktopClient() {
  return <DesktopOS />;
}
