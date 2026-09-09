import type { Metadata, Viewport } from 'next';
import './localFonts';
import './globals.css';
import './horizon.css';

import { TRPCReactProvider } from '../trpc/react';

export const metadata: Metadata = {
  title: 'Nammu OS - Next-Gen Web Operating System',
  description:
    'Unicorn-grade web operating system featuring multi-cloud virtualization, rich tool suite, developer workspace, and desktop environment.',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#15100e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="dark h-full overflow-hidden select-none"
      data-theme="horizon"
      data-appearance="dark"
      data-crt-scanlines="off"
      data-reduced-motion="off"
    >
      <body className="h-full w-full overflow-hidden bg-[#15100e] text-[#f8f6f3] antialiased">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
