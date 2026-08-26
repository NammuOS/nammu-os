import { describe, expect, test } from 'bun:test';
import { getEffectiveMediaVolume, normalizeMasterVolume } from '../src/lib/osVolume';

describe('OS master volume', () => {
  test('normalizes master volume to a percentage', () => {
    expect(normalizeMasterVolume(56.6)).toBe(57);
    expect(normalizeMasterVolume(-20)).toBe(0);
    expect(normalizeMasterVolume(140)).toBe(100);
  });

  test('combines master and local media gain without replacing either value', () => {
    expect(getEffectiveMediaVolume(0.8, 50)).toBeCloseTo(0.4);
    expect(getEffectiveMediaVolume(0.25, 100)).toBeCloseTo(0.25);
    expect(getEffectiveMediaVolume(0.9, 0)).toBe(0);
  });
});
