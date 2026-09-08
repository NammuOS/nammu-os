import { describe, expect, test } from 'bun:test';
import { getStandaloneWindowUrl } from '../src/lib/standaloneWindow';

describe('standalone window URLs', () => {
  test('keeps Browser on its dedicated full interface', () => {
    expect(getStandaloneWindowUrl('system:browser')).toBe('/browser');
  });

  test('opens system apps through the app route', () => {
    expect(getStandaloneWindowUrl('system:whatsapp')).toBe('/apps/whatsapp');
    expect(getStandaloneWindowUrl('system:telegram')).toBe('/apps/telegram');
    expect(getStandaloneWindowUrl('system:pdf')).toBe('/apps/pdf');
  });

  test('opens tools through the tool route', () => {
    expect(getStandaloneWindowUrl('subdomain-discovery')).toBe('/tools/subdomain-discovery');
  });

  test('does not produce a route for an empty identifier', () => {
    expect(getStandaloneWindowUrl('')).toBeNull();
  });
});
