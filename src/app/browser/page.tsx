import type { Metadata } from 'next';
import { AppSandboxHost } from '@/components/os/sandbox/AppSandboxHost';

export const metadata: Metadata = {
  title: 'Browser — Nammu OS',
  description: 'The full Nammu OS browser interface in a standalone tab.',
};

export default function BrowserPage() {
  return (
    <main className="h-dvh w-screen overflow-hidden bg-[#05070b]">
      <AppSandboxHost appId="os.nammu.browser" windowId="standalone:browser" title="Browser" />
    </main>
  );
}
