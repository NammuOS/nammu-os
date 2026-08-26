import type { Metadata } from 'next';
import StandaloneBrowser from '@/components/browser/StandaloneBrowser';

export const metadata: Metadata = {
  title: 'Browser — Nammu OS',
  description: 'The full Nammu OS browser interface in a standalone tab.',
};

export default function BrowserPage() {
  return <StandaloneBrowser />;
}
