import { describe, expect, test } from 'bun:test';
import {
  parseDesktopBootstrapLine,
  serializeDesktopReadyMessage,
} from '../src/server/runtime/desktopBootstrap.mjs';

const validBootstrap = {
  protocolVersion: 1 as const,
  instanceId: 'a'.repeat(32),
  apiCapability: 'b'.repeat(64),
  vaultKey: 'd'.repeat(64),
  frontendOrigin: 'http://127.0.0.1:1420',
  dataDirectory: 'C:\\Users\\test\\AppData\\Local\\Nammu OS',
};

describe('desktop local bootstrap protocol', () => {
  test('accepts independent fixed-size capabilities and an absolute data directory', () => {
    const parsed = parseDesktopBootstrapLine(JSON.stringify(validBootstrap));
    expect(parsed).toEqual({
      ...validBootstrap,
      vaultKey: Buffer.from(validBootstrap.vaultKey, 'hex'),
    });
  });

  test('rejects malformed, shared, and relative secrets or paths', () => {
    expect(() => parseDesktopBootstrapLine('not json')).toThrow();
    expect(() =>
      parseDesktopBootstrapLine(
        JSON.stringify({
          ...validBootstrap,
          vaultKey: validBootstrap.apiCapability,
        }),
      ),
    ).toThrow('must be different');
    expect(() =>
      parseDesktopBootstrapLine(
        JSON.stringify({
          ...validBootstrap,
          dataDirectory: './relative',
        }),
      ),
    ).toThrow('absolute path');
    expect(() =>
      parseDesktopBootstrapLine(
        JSON.stringify({
          ...validBootstrap,
          frontendOrigin: 'http://127.0.0.1:1420/path',
        }),
      ),
    ).toThrow('exact trusted origin');
    expect(
      parseDesktopBootstrapLine(
        JSON.stringify({ ...validBootstrap, frontendOrigin: 'tauri://localhost' }),
      ).frontendOrigin,
    ).toBe('tauri://localhost');
  });

  test('readiness contains only the public instance identity and loopback origin', () => {
    const message = serializeDesktopReadyMessage({
      instanceId: validBootstrap.instanceId,
      port: 43127,
    });
    expect(message).toContain('http://127.0.0.1:43127');
    expect(message).toContain(validBootstrap.instanceId);
    expect(message).not.toContain(validBootstrap.apiCapability);
    expect(message).not.toContain(validBootstrap.vaultKey);
  });
});
