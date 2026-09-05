import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSystemApp } from '../src/components/os/systemAppRegistry';
import {
  MAX_TELEGRAM_ACCOUNTS,
  getStoredTelegramTabs,
} from '../src/components/telegram/services/telegramStore';

const root = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Telegram application integration', () => {
  test('registers Telegram as a launchable system application', () => {
    expect(findSystemApp('telegram')).toMatchObject({
      id: 'telegram',
      windowId: 'system:telegram',
      title: 'Telegram',
    });
  });

  test('provides an SSR-safe default account and a bounded account model', () => {
    expect(getStoredTelegramTabs()).toEqual([
      expect.objectContaining({
        id: 'telegram-account-1',
        name: 'Personal Account',
        url: 'https://web.telegram.org/a/',
      }),
    ]);
    expect(MAX_TELEGRAM_ACCOUNTS).toBe(8);
  });

  test('uses isolated persistent WebView2 profiles on Desktop and Gecko/Wisp on Web', () => {
    const telegram = source('src/components/telegram/TelegramApp.tsx');
    expect(telegram).toContain('owner="telegram"');
    expect(telegram).toContain('profileKey={tab.id}');
    expect(telegram).toContain('getGeckoRuntimeUrl');
    expect(telegram).toContain('platform.services');
    expect(telegram).not.toContain('Starting Nammu Telegram');
  });
});
