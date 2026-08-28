import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_NAMMU_MUSIC_PREFERENCES,
  MUSIC_PLUGIN_CATALOG,
  normalizeNammuMusicPreferences,
} from '../src/components/youtube-music/services/musicStore';
import { ADBLOCK_BOOTSTRAP_SOURCE } from '../src/components/youtube-music/YouTubeMusicApp';

describe('Nammu YouTube Music integration', () => {
  test('registers each upstream feature once with an explicit support boundary', () => {
    const ids = MUSIC_PLUGIN_CATALOG.map((plugin) => plugin.id);

    expect(ids).toHaveLength(42);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MUSIC_PLUGIN_CATALOG.every((plugin) => Boolean(plugin.support))).toBe(true);
    expect(MUSIC_PLUGIN_CATALOG.find((plugin) => plugin.id === 'adblocker')?.support).toBe(
      'native',
    );
  });

  test('normalizes persisted audio controls and preserves known plugin state', () => {
    const preferences = normalizeNammuMusicPreferences({
      volume: 8,
      playbackRate: 0,
      bass: -99,
      mid: 99,
      treble: 4,
      crossfadeSeconds: 50,
      plugins: { ...DEFAULT_NAMMU_MUSIC_PREFERENCES.plugins, visualizer: true },
    });

    expect(preferences.volume).toBe(1);
    expect(preferences.playbackRate).toBe(0.25);
    expect(preferences.bass).toBe(-12);
    expect(preferences.mid).toBe(12);
    expect(preferences.treble).toBe(4);
    expect(preferences.crossfadeSeconds).toBe(12);
    expect(preferences.plugins.visualizer).toBe(true);
    expect(preferences.plugins.navigation).toBe(true);
  });

  test('installs a document-start player-response ad pruner', () => {
    const encodedScript = ADBLOCK_BOOTSTRAP_SOURCE.split(',')[1];
    const script = decodeURIComponent(encodedScript);

    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('playerAds');
    expect(script).toContain('adPlacements');
    expect(script).toContain('adSlots');
    expect(script).toContain('DOMWindowCreated');
  });
});
