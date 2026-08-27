import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { SettingsApp } from '../src/components/os/SettingsApp';

describe('Settings standalone server render', () => {
  test('does not read browser-only storage during prerender', () => {
    expect(() => renderToString(<SettingsApp />)).not.toThrow();
  });
});
