export type NammuMusicPluginId =
  | 'adblocker'
  | 'album-actions'
  | 'album-color-theme'
  | 'ambient-mode'
  | 'amuse'
  | 'api-server'
  | 'auth-proxy-adapter'
  | 'blur-nav-bar'
  | 'bypass-age-restrictions'
  | 'captions-selector'
  | 'compact-sidebar'
  | 'crossfade'
  | 'custom-output-device'
  | 'disable-autoplay'
  | 'discord'
  | 'downloader'
  | 'equalizer'
  | 'exponential-volume'
  | 'in-app-menu'
  | 'lumiastream'
  | 'music-together'
  | 'navigation'
  | 'no-google-login'
  | 'notifications'
  | 'performance-improvement'
  | 'picture-in-picture'
  | 'playback-speed'
  | 'precise-volume'
  | 'quality-changer'
  | 'scrobbler'
  | 'shortcuts'
  | 'skip-disliked-songs'
  | 'skip-silences'
  | 'sponsorblock'
  | 'synced-lyrics'
  | 'taskbar-mediacontrol'
  | 'touchbar'
  | 'transparent-player'
  | 'tuna-obs'
  | 'unobtrusive-player'
  | 'video-toggle'
  | 'visualizer';

export type MusicPluginCategory = 'Audio' | 'Playback' | 'Interface' | 'Services' | 'System';
export type MusicPluginSupport = 'native' | 'youtube' | 'host-only';

export interface MusicPluginDescriptor {
  id: NammuMusicPluginId;
  name: string;
  description: string;
  category: MusicPluginCategory;
  support: MusicPluginSupport;
}

export const MUSIC_PLUGIN_CATALOG: MusicPluginDescriptor[] = [
  {
    id: 'adblocker',
    name: 'Ad blocker',
    description: 'Gecko tracking and request protection.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'album-actions',
    name: 'Album actions',
    description: 'Like and dislike controls supplied by YouTube Music.',
    category: 'Playback',
    support: 'youtube',
  },
  {
    id: 'album-color-theme',
    name: 'Album color theme',
    description: 'Tint the player shell from the current artwork.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'ambient-mode',
    name: 'Ambient mode',
    description: 'Artwork-driven background atmosphere.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'amuse',
    name: 'Amuse integration',
    description: 'Desktop-only Amuse bridge from the Electron host.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'api-server',
    name: 'Control API',
    description: 'Requires the Electron localhost API and native socket host.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'auth-proxy-adapter',
    name: 'Authentication session',
    description: 'Isolated Gecko cookies and Google sign-in.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'blur-nav-bar',
    name: 'Blur navigation bar',
    description: 'Nammu glass treatment for the service navigation.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'bypass-age-restrictions',
    name: 'Age-restricted playback',
    description: 'Uses the signed-in YouTube account and its normal permissions.',
    category: 'Playback',
    support: 'youtube',
  },
  {
    id: 'captions-selector',
    name: 'Captions selector',
    description: 'YouTube Music caption and subtitle controls.',
    category: 'Playback',
    support: 'youtube',
  },
  {
    id: 'compact-sidebar',
    name: 'Compact sidebar',
    description: 'Reduce navigation width for smaller windows.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'crossfade',
    name: 'Crossfade',
    description: 'Fade smoothly at track boundaries.',
    category: 'Audio',
    support: 'native',
  },
  {
    id: 'custom-output-device',
    name: 'Output device',
    description: 'Route playback to a selected browser audio device.',
    category: 'Audio',
    support: 'native',
  },
  {
    id: 'disable-autoplay',
    name: 'Disable autoplay',
    description: 'Stop playback when a track ends.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'discord',
    name: 'Discord Rich Presence',
    description: 'Requires the native Discord RPC desktop bridge.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'downloader',
    name: 'Offline downloads',
    description: 'Uses YouTube Music Premium offline controls where available.',
    category: 'Services',
    support: 'youtube',
  },
  {
    id: 'equalizer',
    name: 'Equalizer',
    description: 'Three-band Web Audio equalizer and compressor.',
    category: 'Audio',
    support: 'native',
  },
  {
    id: 'exponential-volume',
    name: 'Natural volume curve',
    description: 'Use a perceptual volume response.',
    category: 'Audio',
    support: 'native',
  },
  {
    id: 'in-app-menu',
    name: 'In-app menu',
    description: 'Nammu-native toolbar and extension manager.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'lumiastream',
    name: 'Lumia Stream',
    description: 'Requires the Lumia Stream desktop companion.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'music-together',
    name: 'Music Together',
    description: 'Collaborative rooms remain an Electron peer-service feature.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'navigation',
    name: 'Navigation',
    description: 'Back, forward, Home, Explore and Library controls.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'no-google-login',
    name: 'Guest mode',
    description: 'YouTube Music works without requiring sign-in.',
    category: 'System',
    support: 'youtube',
  },
  {
    id: 'notifications',
    name: 'Notifications',
    description: 'Now-playing notifications through the browser permission system.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'performance-improvement',
    name: 'Performance mode',
    description: 'Suspend hidden work and reduce background animation.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'picture-in-picture',
    name: 'Picture in Picture',
    description: 'Open the current music video in a floating player.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'playback-speed',
    name: 'Playback speed',
    description: 'Control playback from 0.25× to 2×.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'precise-volume',
    name: 'Precise volume',
    description: 'Set exact music volume independently from master volume.',
    category: 'Audio',
    support: 'native',
  },
  {
    id: 'quality-changer',
    name: 'Quality selector',
    description: 'YouTube Music stream quality controls.',
    category: 'Playback',
    support: 'youtube',
  },
  {
    id: 'scrobbler',
    name: 'Last.fm / ListenBrainz',
    description: 'Requires account tokens and a server-side service connection.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'shortcuts',
    name: 'Media shortcuts',
    description: 'Space, arrows, J/L and media-key controls.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'skip-disliked-songs',
    name: 'Skip disliked songs',
    description: 'Automatically advance past disliked tracks.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'skip-silences',
    name: 'Skip silences',
    description: 'Reduce long quiet sections during playback.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'sponsorblock',
    name: 'SponsorBlock',
    description: 'Skip community-marked non-music sections.',
    category: 'Playback',
    support: 'native',
  },
  {
    id: 'synced-lyrics',
    name: 'Synced lyrics',
    description: 'Fetch synchronized lyrics from LRCLIB.',
    category: 'Services',
    support: 'native',
  },
  {
    id: 'taskbar-mediacontrol',
    name: 'Taskbar media controls',
    description: 'Expose current playback through Nammu controls.',
    category: 'System',
    support: 'native',
  },
  {
    id: 'touchbar',
    name: 'Touch Bar',
    description: 'Requires Apple Touch Bar hardware and an Electron host.',
    category: 'System',
    support: 'host-only',
  },
  {
    id: 'transparent-player',
    name: 'Transparent player',
    description: 'Blend the service surface into Nammu materials.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'tuna-obs',
    name: 'Tuna OBS',
    description: 'Requires the native Tuna OBS companion bridge.',
    category: 'Services',
    support: 'host-only',
  },
  {
    id: 'unobtrusive-player',
    name: 'Unobtrusive player',
    description: 'Use a compact, distraction-free player layout.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'video-toggle',
    name: 'Audio-only view',
    description: 'Hide or reveal the music video surface.',
    category: 'Interface',
    support: 'native',
  },
  {
    id: 'visualizer',
    name: 'Visualizer',
    description: 'Audio-reactive spectrum overlay.',
    category: 'Audio',
    support: 'native',
  },
];

export interface NammuMusicPreferences {
  plugins: Record<NammuMusicPluginId, boolean>;
  volume: number;
  playbackRate: number;
  bass: number;
  mid: number;
  treble: number;
  crossfadeSeconds: number;
  compactDensity: boolean;
}

const DEFAULT_PLUGIN_STATE = Object.fromEntries(
  MUSIC_PLUGIN_CATALOG.map((plugin) => [
    plugin.id,
    plugin.support === 'youtube' ||
      [
        'adblocker',
        'auth-proxy-adapter',
        'in-app-menu',
        'navigation',
        'performance-improvement',
        'precise-volume',
        'shortcuts',
        'taskbar-mediacontrol',
      ].includes(plugin.id),
  ]),
) as Record<NammuMusicPluginId, boolean>;

export const DEFAULT_NAMMU_MUSIC_PREFERENCES: NammuMusicPreferences = {
  plugins: DEFAULT_PLUGIN_STATE,
  volume: 0.8,
  playbackRate: 1,
  bass: 0,
  mid: 0,
  treble: 0,
  crossfadeSeconds: 3,
  compactDensity: false,
};

const STORAGE_KEY = 'nammu-youtube-music-preferences-v1';
export const NAMMU_MUSIC_PREFERENCES_EVENT = 'nammu-youtube-music-preferences-change';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

export function normalizeNammuMusicPreferences(
  value?: Partial<NammuMusicPreferences> | null,
): NammuMusicPreferences {
  return {
    plugins: {
      ...DEFAULT_PLUGIN_STATE,
      ...(value?.plugins || {}),
    },
    volume: clamp(value?.volume, 0, 1, DEFAULT_NAMMU_MUSIC_PREFERENCES.volume),
    playbackRate: clamp(value?.playbackRate, 0.25, 2, 1),
    bass: clamp(value?.bass, -12, 12, 0),
    mid: clamp(value?.mid, -12, 12, 0),
    treble: clamp(value?.treble, -12, 12, 0),
    crossfadeSeconds: clamp(value?.crossfadeSeconds, 0, 12, 3),
    compactDensity: value?.compactDensity === true,
  };
}

export function getStoredNammuMusicPreferences(): NammuMusicPreferences {
  if (typeof window === 'undefined') return DEFAULT_NAMMU_MUSIC_PREFERENCES;
  try {
    return normalizeNammuMusicPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return DEFAULT_NAMMU_MUSIC_PREFERENCES;
  }
}

export function saveNammuMusicPreferences(value: NammuMusicPreferences): NammuMusicPreferences {
  const normalized = normalizeNammuMusicPreferences(value);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(
      new CustomEvent<NammuMusicPreferences>(NAMMU_MUSIC_PREFERENCES_EVENT, {
        detail: normalized,
      }),
    );
  }
  return normalized;
}
