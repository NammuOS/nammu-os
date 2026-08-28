'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  ChevronDown,
  Download,
  Home,
  Library,
  ListMusic,
  Loader2,
  Maximize2,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import {
  DEFAULT_NAMMU_MUSIC_PREFERENCES,
  MUSIC_PLUGIN_CATALOG,
  getStoredNammuMusicPreferences,
  saveNammuMusicPreferences,
  type MusicPluginCategory,
  type NammuMusicPluginId,
  type NammuMusicPreferences,
} from './services/musicStore';
import { useMasterVolume } from '../../hooks/useMasterVolume';

const MUSIC_URL = 'https://music.youtube.com/';
const FIREFOX_RUNTIME_URL = '/firefox-wasm/index.html';
const CONTENT_RESPONSE_CHANNEL = 'nammu-youtube-music-content-response';

type EngineState = 'starting' | 'ready' | 'error';
type DrawerView = 'extensions' | 'audio' | 'lyrics';

type GeckoRuntimeWindow = Window & {
  geckoEvalChrome?: (script: string) => Promise<unknown>;
};

interface MediaState {
  artist: string;
  currentTime: number;
  duration: number;
  muted: boolean;
  paused: boolean;
  thumbnail: string;
  title: string;
  videoId: string;
  volume: number;
}

interface AudioOutput {
  deviceId: string;
  label: string;
}

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsResult {
  instrumental?: boolean;
  lines: LyricLine[];
  plain: string;
  source: string;
}

const EMPTY_MEDIA: MediaState = {
  artist: '',
  currentTime: 0,
  duration: 0,
  muted: false,
  paused: true,
  thumbnail: '',
  title: 'YouTube Music',
  videoId: '',
  volume: 0.8,
};

function runtimeUrl(attempt: number): string {
  const params = new URLSearchParams({
    app: '1',
    autostart: '1',
    url: 'about:blank',
    session: `nammu-music-${attempt}`,
  });
  return `${FIREFOX_RUNTIME_URL}?${params.toString()}`;
}

function safeMusicUrl(candidate: string): string {
  try {
    const url = new URL(candidate, MUSIC_URL);
    if (url.protocol === 'https:' && url.hostname === 'music.youtube.com') return url.toString();
  } catch {}
  return MUSIC_URL;
}

function initializeMusicScript(): string {
  return `(()=>{
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const previousTabs = Array.from(gBrowser.tabs);
    const tab = gBrowser.addTab('about:blank', { triggeringPrincipal: principal });
    globalThis.__nammuMusicTab = tab;
    gBrowser.selectedTab = tab;
    for (const previousTab of previousTabs) {
      if (previousTab !== tab) gBrowser.removeTab(previousTab, { animate: false });
    }
    Services.prefs.setIntPref('browser.link.open_newwindow', 1);
    Services.prefs.setIntPref('browser.link.open_newwindow.restriction', 0);
    Services.prefs.setBoolPref('privacy.trackingprotection.enabled', true);
    Services.prefs.setBoolPref('privacy.trackingprotection.socialtracking.enabled', true);
    openTrustedLinkIn(${JSON.stringify(MUSIC_URL)}, 'current');
    return 'music-session-ready';
  })()`;
}

function onMusicTab(command: string): string {
  return `(()=>{
    const tab = globalThis.__nammuMusicTab;
    if (!tab || tab.closing) return 'music-tab-unavailable';
    gBrowser.selectedTab = tab;
    ${command}
  })()`;
}

function contentCommand(command: string): string {
  const frameSource = `data:application/javascript;charset=utf-8,${encodeURIComponent(`
    (async () => {
      try {
        const value = await (async () => { ${command} })();
        sendAsyncMessage(${JSON.stringify(CONTENT_RESPONSE_CHANNEL)}, {
          ok: true,
          value: JSON.stringify(value === undefined ? null : value)
        });
      } catch (error) {
        sendAsyncMessage(${JSON.stringify(CONTENT_RESPONSE_CHANNEL)}, {
          ok: false,
          error: String(error && (error.stack || error.message) || error)
        });
      }
    })();
  `)}`;

  return `(async()=>{
    const tab = globalThis.__nammuMusicTab;
    if (!tab || tab.closing) return JSON.stringify({ ok: false, error: 'Music tab unavailable' });
    const manager = tab.linkedBrowser && tab.linkedBrowser.messageManager;
    if (!manager || typeof manager.loadFrameScript !== 'function') {
      return JSON.stringify({ ok: false, error: 'Content bridge unavailable' });
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        manager.removeMessageListener(${JSON.stringify(CONTENT_RESPONSE_CHANNEL)}, listener);
        resolve(JSON.stringify(value));
      };
      const listener = (message) => finish(message.data || { ok: false, error: 'Empty response' });
      manager.addMessageListener(${JSON.stringify(CONTENT_RESPONSE_CHANNEL)}, listener);
      try {
        manager.loadFrameScript(${JSON.stringify(frameSource)}, false, false);
      } catch (error) {
        finish({ ok: false, error: String(error) });
        return;
      }
      setTimeout(() => finish({ ok: false, error: 'Content command timed out' }), 5000);
    });
  })()`;
}

function mediaStateCommand(): string {
  return `
    const doc = content.document;
    const video = doc.querySelector('video');
    const read = (...selectors) => {
      for (const selector of selectors) {
        const value = doc.querySelector(selector)?.textContent?.trim();
        if (value) return value;
      }
      return '';
    };
    const image = doc.querySelector('ytmusic-player-bar img.image, ytmusic-player-bar img');
    const url = new URL(content.location.href);
    return {
      title: read('ytmusic-player-bar .title', 'ytmusic-player-bar yt-formatted-string.title') || doc.title.replace(/ - YouTube Music$/, ''),
      artist: read('ytmusic-player-bar .byline', 'ytmusic-player-bar .subtitle'),
      thumbnail: image?.currentSrc || image?.src || '',
      paused: video ? video.paused : true,
      muted: video ? video.muted : false,
      volume: video ? video.volume : 0,
      currentTime: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      videoId: url.searchParams.get('v') || ''
    };
  `;
}

function applyPreferencesCommand(
  preferences: NammuMusicPreferences,
  masterVolumePercent: number,
): string {
  const settings = JSON.stringify({
    ...preferences,
    masterVolume: Math.min(1, Math.max(0, masterVolumePercent / 100)),
  });
  const plugins = preferences.plugins;
  const runtimeStyles = `
    html { --nammu-music-blue: #4aa3ff; --nammu-music-mint: #2ee6a6; }
    body, ytmusic-app { background: #05080d !important; }
    ytmusic-nav-bar {
      border-bottom: 1px solid rgba(255,255,255,.06) !important;
      background: ${plugins['blur-nav-bar'] ? 'rgba(5,8,13,.72)' : '#070b12'} !important;
      backdrop-filter: ${plugins['blur-nav-bar'] ? 'blur(18px)' : 'none'} !important;
    }
    ytmusic-player-bar {
      background: rgba(7,11,18,.97) !important;
      border-top: 1px solid rgba(255,255,255,.07) !important;
    }
    ytmusic-guide-renderer {
      background: #070b12 !important;
      border-right: 1px solid rgba(255,255,255,.05) !important;
      ${plugins['compact-sidebar'] ? 'width: 72px !important;' : ''}
    }
    ${plugins['transparent-player'] ? 'ytmusic-app-layout > [slot="player-page"] { opacity: .92 !important; }' : ''}
    ${plugins['unobtrusive-player'] ? 'ytmusic-player-page { max-width: 1180px !important; margin: 0 auto !important; }' : ''}
    ${plugins['video-toggle'] ? '#song-video, #player, ytmusic-player { visibility: hidden !important; }' : ''}
    ${plugins['ambient-mode'] ? 'body::before { content: ""; position: fixed; inset: -8%; background: var(--nammu-music-artwork) center/cover no-repeat; filter: blur(70px) saturate(1.25); opacity: .16; pointer-events: none; z-index: 0; } ytmusic-app { background: rgba(5,8,13,.78) !important; }' : ''}
    ${plugins['album-color-theme'] ? 'ytmusic-player-page { background-image: linear-gradient(180deg, rgba(5,8,13,.55), #05080d 72%), var(--nammu-music-artwork) !important; background-position: center !important; background-size: cover !important; }' : ''}
    ${plugins['performance-improvement'] ? 'ytmusic-app:not(:focus-within) #background, ytmusic-app:not(:focus-within) .animated-thumbnail { animation-play-state: paused !important; }' : ''}
    * { scrollbar-color: rgba(74,163,255,.45) rgba(255,255,255,.025) !important; }
    ::selection { background: rgba(74,163,255,.3) !important; }
  `;
  return `
    const settings = ${settings};
    const doc = content.document;
    const video = doc.querySelector('video');
    const styleId = 'nammu-music-runtime-theme';
    let style = doc.getElementById(styleId);
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      (doc.head || doc.documentElement).appendChild(style);
    }
    const p = settings.plugins;
    style.textContent = ${JSON.stringify(runtimeStyles)};
    const runtime = globalThis.__nammuMusicAudioRuntime || (globalThis.__nammuMusicAudioRuntime = {});
    runtime.settings = settings;
    runtime.document = doc;
    runtime.video = video;

    const artwork = doc.querySelector('ytmusic-player-bar img.image, ytmusic-player-bar img');
    const artworkUrl = artwork?.currentSrc || artwork?.src || '';
    if (artworkUrl && (p['album-color-theme'] || p['ambient-mode'])) {
      doc.documentElement.style.setProperty('--nammu-music-artwork', 'url("' + artworkUrl.replace(/["\\]/g, '\\$&') + '")');
    } else {
      doc.documentElement.style.removeProperty('--nammu-music-artwork');
    }

    if (video && (p.equalizer || p.visualizer || p['skip-silences'])) {
      try {
        if (!runtime.context || runtime.audioVideo !== video) {
          const AudioContext = content.AudioContext || content.webkitAudioContext;
          runtime.context = new AudioContext();
          runtime.source = runtime.context.createMediaElementSource(video);
          runtime.bass = runtime.context.createBiquadFilter();
          runtime.mid = runtime.context.createBiquadFilter();
          runtime.treble = runtime.context.createBiquadFilter();
          runtime.compressor = runtime.context.createDynamicsCompressor();
          runtime.analyser = runtime.context.createAnalyser();
          runtime.bass.type = 'lowshelf'; runtime.bass.frequency.value = 180;
          runtime.mid.type = 'peaking'; runtime.mid.frequency.value = 1000; runtime.mid.Q.value = .8;
          runtime.treble.type = 'highshelf'; runtime.treble.frequency.value = 5000;
          runtime.source.connect(runtime.bass).connect(runtime.mid).connect(runtime.treble).connect(runtime.compressor).connect(runtime.analyser).connect(runtime.context.destination);
          runtime.analyser.fftSize = 128;
          runtime.audioVideo = video;
        }
        runtime.bass.gain.value = p.equalizer ? settings.bass : 0;
        runtime.mid.gain.value = p.equalizer ? settings.mid : 0;
        runtime.treble.gain.value = p.equalizer ? settings.treble : 0;
        runtime.compressor.ratio.value = p.equalizer ? 4 : 1;
        if (runtime.context.state === 'suspended' && !video.paused) runtime.context.resume().catch(() => {});
      } catch {}
    }

    if (!runtime.monitorTimer) {
      runtime.monitorTimer = content.setInterval(() => {
        const currentSettings = runtime.settings;
        const currentDoc = runtime.document;
        const currentVideo = currentDoc?.querySelector('video');
        if (!currentSettings || !currentVideo) return;
        const currentPlugins = currentSettings.plugins;
        const linearVolume = Math.min(1, Math.max(0, Number(currentSettings.volume) || 0));
        const masterVolume = Math.min(1, Math.max(0, Number(currentSettings.masterVolume) || 0));
        const localVolume = currentPlugins['exponential-volume'] ? linearVolume * linearVolume : linearVolume;
        const baseVolume = localVolume * masterVolume;
        let volumeFactor = 1;
        const trackKey = currentVideo.currentSrc || content.location.href;
        if (runtime.trackKey !== trackKey) {
          runtime.trackKey = trackKey;
          runtime.trackStartedAt = content.performance.now();
          runtime.quietSince = 0;
          runtime.skippedDislike = '';
        }
        if (currentPlugins.crossfade && currentSettings.crossfadeSeconds > 0) {
          const fadeMs = currentSettings.crossfadeSeconds * 1000;
          const sinceStart = content.performance.now() - (runtime.trackStartedAt || 0);
          volumeFactor = Math.min(volumeFactor, Math.max(0, Math.min(1, sinceStart / fadeMs)));
          if (currentVideo.duration) {
            const remaining = currentVideo.duration - currentVideo.currentTime;
            if (remaining >= 0 && remaining < currentSettings.crossfadeSeconds) {
              volumeFactor = Math.min(volumeFactor, remaining / currentSettings.crossfadeSeconds);
            }
          }
        }
        currentVideo.volume = Math.min(1, Math.max(0, baseVolume * volumeFactor));
        currentVideo.preservesPitch = true;

        let targetRate = Number(currentSettings.playbackRate) || 1;
        if (currentPlugins['skip-silences'] && runtime.analyser && !currentVideo.paused) {
          const samples = runtime.silenceSamples && runtime.silenceSamples.length === runtime.analyser.fftSize
            ? runtime.silenceSamples
            : (runtime.silenceSamples = new Uint8Array(runtime.analyser.fftSize));
          runtime.analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (let index = 0; index < samples.length; index += 1) {
            const sample = (samples[index] - 128) / 128;
            energy += sample * sample;
          }
          const quiet = Math.sqrt(energy / samples.length) < .008;
          if (quiet) runtime.quietSince ||= content.performance.now();
          else runtime.quietSince = 0;
          if (runtime.quietSince && content.performance.now() - runtime.quietSince > 900) {
            targetRate = Math.min(2, Math.max(1.75, targetRate * 1.65));
          }
        } else {
          runtime.quietSince = 0;
        }
        if (Math.abs(currentVideo.playbackRate - targetRate) > .01) currentVideo.playbackRate = targetRate;

        if (currentPlugins['disable-autoplay'] && currentVideo.duration && currentVideo.duration - currentVideo.currentTime < .18) {
          currentVideo.pause();
        }
        if (currentPlugins['skip-disliked-songs']) {
          const disliked = currentDoc.querySelector('ytmusic-like-button-renderer #button-shape-dislike[aria-pressed="true"], ytmusic-like-button-renderer [aria-label*="Undo dislike"]');
          if (disliked && runtime.skippedDislike !== trackKey) {
            runtime.skippedDislike = trackKey;
            currentDoc.querySelector('ytmusic-player-bar .next-button, #next-button')?.click();
          }
        }
        if (currentPlugins.adblocker) {
          const adSurface = currentDoc.querySelector('.ad-showing, ytmusic-player-page[is-advertisement]');
          if (adSurface) {
            currentDoc.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button, [id*="skip-button"] button')?.click();
            if (Number.isFinite(currentVideo.duration) && currentVideo.duration > 0) {
              currentVideo.currentTime = currentVideo.duration;
            }
          }
        }
      }, 150);
    }

    if (!runtime.visualizerLoop) {
      const drawVisualizer = () => {
        runtime.visualizerLoop = content.requestAnimationFrame(drawVisualizer);
        const currentSettings = runtime.settings;
        const currentDoc = runtime.document;
        if (!currentSettings || !currentDoc) return;
        let canvas = currentDoc.getElementById('nammu-music-visualizer');
        if (!currentSettings.plugins.visualizer || !runtime.analyser) {
          canvas?.remove();
          return;
        }
        if (!canvas) {
          canvas = currentDoc.createElement('canvas');
          canvas.id = 'nammu-music-visualizer';
          Object.assign(canvas.style, { position: 'fixed', left: '0', right: '0', bottom: '72px', width: '100%', height: '90px', zIndex: '2147483000', pointerEvents: 'none', opacity: '.55' });
          currentDoc.documentElement.appendChild(canvas);
        }
        const pixelRatio = content.devicePixelRatio || 1;
        const targetWidth = Math.max(1, content.innerWidth * pixelRatio);
        const targetHeight = 90 * pixelRatio;
        if (canvas.width !== targetWidth) canvas.width = targetWidth;
        if (canvas.height !== targetHeight) canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) return;
        const values = runtime.visualizerValues && runtime.visualizerValues.length === runtime.analyser.frequencyBinCount
          ? runtime.visualizerValues
          : (runtime.visualizerValues = new Uint8Array(runtime.analyser.frequencyBinCount));
        runtime.analyser.getByteFrequencyData(values);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const width = canvas.width / values.length;
        for (let index = 0; index < values.length; index += 1) {
          const height = values[index] / 255 * canvas.height;
          context.fillStyle = index % 3 === 0 ? '#2ee6a6' : '#4aa3ff';
          context.fillRect(index * width, canvas.height - height, Math.max(1, width - 2), height);
        }
      }
      runtime.visualizerLoop = content.requestAnimationFrame(drawVisualizer);
    }
    return true;
  `;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function parseLyrics(value: string): LyricLine[] {
  return value
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\](.*)$/.exec(line.trim());
      if (!match) return [];
      return [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }];
    })
    .filter((line) => line.text)
    .sort((a, b) => a.time - b.time);
}

export default function YouTubeMusicApp() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const engineReadyRef = useRef(false);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mediaRef = useRef(EMPTY_MEDIA);
  const lastNotifiedTitleRef = useRef('');
  const { volume: masterVolume } = useMasterVolume();
  const [engineState, setEngineState] = useState<EngineState>('starting');
  const [engineError, setEngineError] = useState('');
  const [engineAttempt, setEngineAttempt] = useState(1);
  const [preferences, setPreferences] = useState(DEFAULT_NAMMU_MUSIC_PREFERENCES);
  const [media, setMedia] = useState<MediaState>(EMPTY_MEDIA);
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<DrawerView | null>(null);
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginCategory, setPluginCategory] = useState<MusicPluginCategory | 'All'>('All');
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutput[]>([]);
  const [selectedOutput, setSelectedOutput] = useState('');
  const [bridgeAvailable, setBridgeAvailable] = useState(true);

  useEffect(() => setPreferences(getStoredNammuMusicPreferences()), []);

  useEffect(() => {
    saveNammuMusicPreferences(preferences);
  }, [preferences]);

  const evaluateInRuntime = useCallback((script: string): Promise<unknown> => {
    const execute = async () => {
      const runtimeWindow = iframeRef.current?.contentWindow as GeckoRuntimeWindow | null;
      if (!runtimeWindow?.geckoEvalChrome) return null;
      let timer = 0;
      try {
        return await Promise.race([
          runtimeWindow.geckoEvalChrome(script),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error('Music command timed out.')), 15_000);
          }),
        ]);
      } finally {
        window.clearTimeout(timer);
      }
    };
    const result = commandQueueRef.current.then(execute, execute);
    commandQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const runContent = useCallback(
    async <T,>(command: string): Promise<T | null> => {
      if (!engineReadyRef.current) return null;
      try {
        const raw = await evaluateInRuntime(contentCommand(command));
        if (typeof raw !== 'string') return null;
        const envelope = JSON.parse(raw) as { ok?: boolean; value?: string; error?: string };
        if (!envelope.ok) {
          setBridgeAvailable(false);
          return null;
        }
        setBridgeAvailable(true);
        return JSON.parse(envelope.value || 'null') as T;
      } catch {
        setBridgeAvailable(false);
        return null;
      }
    },
    [evaluateInRuntime],
  );

  const runChrome = useCallback(
    (command: string) => {
      if (!engineReadyRef.current) return Promise.resolve(null);
      return evaluateInRuntime(onMusicTab(command));
    },
    [evaluateInRuntime],
  );

  const applyPreferences = useCallback(() => {
    void runContent<boolean>(applyPreferencesCommand(preferences, masterVolume));
    void evaluateInRuntime(`(()=>{
      Services.prefs.setBoolPref('privacy.trackingprotection.enabled', ${preferences.plugins.adblocker});
      Services.prefs.setBoolPref('privacy.trackingprotection.socialtracking.enabled', ${preferences.plugins.adblocker});
      return 'preferences-applied';
    })()`);
  }, [evaluateInRuntime, masterVolume, preferences, runContent]);

  useEffect(() => {
    const onRuntimeMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        iframeRef.current?.contentWindow !== event.source
      )
        return;
      if (event.data?.type === 'NAMMU_GECKO_ERROR') {
        engineReadyRef.current = false;
        setEngineState('error');
        setEngineError(String(event.data?.message || 'The music engine could not start.'));
        return;
      }
      if (event.data?.type !== 'NAMMU_GECKO_READY') return;
      const initialize = async () => {
        try {
          await evaluateInRuntime(initializeMusicScript());
          engineReadyRef.current = true;
          setEngineState('ready');
          setEngineError('');
        } catch (error) {
          engineReadyRef.current = false;
          setEngineState('error');
          setEngineError(
            error instanceof Error ? error.message : 'The music engine could not start.',
          );
        }
      };
      void initialize();
    };
    window.addEventListener('message', onRuntimeMessage);
    return () => window.removeEventListener('message', onRuntimeMessage);
  }, [evaluateInRuntime]);

  useEffect(() => {
    if (engineState !== 'starting') return;
    const timer = window.setTimeout(() => {
      if (!engineReadyRef.current) {
        setEngineState('error');
        setEngineError('YouTube Music did not finish opening within two minutes.');
      }
    }, 120_000);
    return () => window.clearTimeout(timer);
  }, [engineAttempt, engineState]);

  useEffect(() => {
    if (engineState !== 'ready') return;
    applyPreferences();
    const applyTimer = window.setInterval(applyPreferences, 4000);
    return () => window.clearInterval(applyTimer);
  }, [applyPreferences, engineState]);

  useEffect(() => {
    if (engineState !== 'ready') return;
    let disposed = false;
    const refresh = async () => {
      const next = await runContent<MediaState>(mediaStateCommand());
      if (!next || disposed) return;
      mediaRef.current = next;
      setMedia(next);
      if (
        preferences.plugins.notifications &&
        !next.paused &&
        next.title &&
        next.title !== 'YouTube Music' &&
        next.title !== lastNotifiedTitleRef.current
      ) {
        lastNotifiedTitleRef.current = next.title;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(next.title, {
            body: next.artist || 'YouTube Music',
            icon: next.thumbnail,
          });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [engineState, preferences.plugins.notifications, runContent]);

  useEffect(() => {
    if (!preferences.plugins['synced-lyrics'] || !media.title || media.title === 'YouTube Music') {
      setLyrics(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLyricsLoading(true);
      try {
        const params = new URLSearchParams({
          track: media.title,
          artist: media.artist,
          duration: String(Math.round(media.duration || 0)),
        });
        const response = await fetch(`/api/music/lyrics?${params}`, { signal: controller.signal });
        const payload = (await response.json()) as {
          data?: { plain?: string; synced?: string; instrumental?: boolean; source?: string };
        };
        const plain = payload.data?.plain || '';
        const synced = payload.data?.synced || '';
        setLyrics({
          plain,
          lines: parseLyrics(synced),
          instrumental: payload.data?.instrumental,
          source: payload.data?.source || 'LRCLIB',
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setLyrics(null);
      } finally {
        if (!controller.signal.aborted) setLyricsLoading(false);
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [media.artist, media.duration, media.title, preferences.plugins]);

  useEffect(() => {
    if (!preferences.plugins.sponsorblock || !media.videoId || engineState !== 'ready') return;
    const controller = new AbortController();
    let timer = 0;
    fetch(`/api/music/sponsorblock?videoId=${encodeURIComponent(media.videoId)}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((payload: { data?: Array<{ segment: [number, number] }> }) => {
        const segments = payload.data || [];
        timer = window.setInterval(() => {
          const current = mediaRef.current.currentTime;
          const segment = segments.find(
            ({ segment: [start, end] }) => current >= start && current < end,
          );
          if (segment)
            void runContent(
              `const video = content.document.querySelector('video'); if (video) video.currentTime = ${segment.segment[1]}; return true;`,
            );
        }, 500);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [engineState, media.videoId, preferences.plugins.sponsorblock, runContent]);

  const navigate = (url: string) => {
    void runChrome(
      `openTrustedLinkIn(${JSON.stringify(safeMusicUrl(url))}, 'current'); return 'ok';`,
    );
  };

  const playPause = useCallback(() => {
    void runContent(
      `const video = content.document.querySelector('video'); if (!video) return false; if (video.paused) await video.play(); else video.pause(); return !video.paused;`,
    );
  }, [runContent]);

  const skip = useCallback(
    (direction: 'next' | 'previous') => {
      const selector =
        direction === 'next' ? '.next-button, #next-button' : '.previous-button, #previous-button';
      void runContent(
        `const button = content.document.querySelector('ytmusic-player-bar ${selector}'); button?.click(); return Boolean(button);`,
      );
    },
    [runContent],
  );

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if ('MediaMetadata' in window && media.title && media.title !== 'YouTube Music') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: media.title,
        artist: media.artist,
        artwork: media.thumbnail ? [{ src: media.thumbnail }] : undefined,
      });
    }
    navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', () => playPause()],
      ['pause', () => playPause()],
      ['previoustrack', () => skip('previous')],
      ['nexttrack', () => skip('next')],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime !== 'number') return;
          void runContent(
            `const video = content.document.querySelector('video'); if (video) video.currentTime = ${details.seekTime}; return true;`,
          );
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [media.artist, media.paused, media.thumbnail, media.title, playPause, runContent, skip]);

  const updatePreference = <Key extends keyof NammuMusicPreferences>(
    key: Key,
    value: NammuMusicPreferences[Key],
  ) => setPreferences((current) => ({ ...current, [key]: value }));

  const togglePlugin = (id: NammuMusicPluginId) => {
    const plugin = MUSIC_PLUGIN_CATALOG.find((item) => item.id === id);
    if (!plugin || plugin.support !== 'native') return;
    setPreferences((current) => ({
      ...current,
      plugins: { ...current.plugins, [id]: !current.plugins[id] },
    }));
  };

  const requestNotifications = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const loadAudioOutputs = useCallback(async () => {
    const outputs = await runContent<AudioOutput[]>(`
      if (!content.navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await content.navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === 'audiooutput').map((device, index) => ({ deviceId: device.deviceId, label: device.label || 'Output ' + (index + 1) }));
    `);
    setAudioOutputs(outputs || []);
  }, [runContent]);

  useEffect(() => {
    if (drawer === 'audio' && engineState === 'ready') void loadAudioOutputs();
  }, [drawer, engineState, loadAudioOutputs]);

  const filteredPlugins = useMemo(() => {
    const normalized = pluginQuery.trim().toLowerCase();
    return MUSIC_PLUGIN_CATALOG.filter(
      (plugin) =>
        (pluginCategory === 'All' || plugin.category === pluginCategory) &&
        (!normalized || `${plugin.name} ${plugin.description}`.toLowerCase().includes(normalized)),
    );
  }, [pluginCategory, pluginQuery]);

  const activeLyric = useMemo(() => {
    if (!lyrics?.lines.length) return -1;
    let index = -1;
    for (let cursor = 0; cursor < lyrics.lines.length; cursor += 1) {
      if (lyrics.lines[cursor].time <= media.currentTime + 0.15) index = cursor;
      else break;
    }
    return index;
  }, [lyrics, media.currentTime]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#05080d] text-[#c7d6e2]">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#070b12]/95 px-2">
        <button
          onClick={() => void runChrome("tab.linkedBrowser.goBack(); return 'ok';")}
          disabled={engineState !== 'ready'}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white disabled:opacity-35"
          title="Back"
        >
          <ArrowLeft size={12} />
        </button>
        <button
          onClick={() => void runChrome("tab.linkedBrowser.goForward(); return 'ok';")}
          disabled={engineState !== 'ready'}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white disabled:opacity-35"
          title="Forward"
        >
          <ArrowRight size={12} />
        </button>
        <button
          onClick={() => navigate(MUSIC_URL)}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white"
          title="Home"
        >
          <Home size={12} />
        </button>
        <div className="mx-1 h-4 w-px bg-white/[0.06]" />
        <button
          onClick={() => navigate(`${MUSIC_URL}explore`)}
          className="flex h-6 items-center gap-1 px-2 font-mono text-[8px] uppercase tracking-wider text-[#71889d] hover:bg-white/[0.05] hover:text-white"
        >
          <Sparkles size={11} /> Explore
        </button>
        <button
          onClick={() => navigate(`${MUSIC_URL}library`)}
          className="flex h-6 items-center gap-1 px-2 font-mono text-[8px] uppercase tracking-wider text-[#71889d] hover:bg-white/[0.05] hover:text-white"
        >
          <Library size={11} /> Library
        </button>
        <form
          className="mx-auto flex h-6 min-w-36 max-w-md flex-1 items-center border border-white/[0.07] bg-black/25 px-2 focus-within:border-[#4aa3ff]/45"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) navigate(`${MUSIC_URL}search?q=${encodeURIComponent(query.trim())}`);
          }}
        >
          <Search size={11} className="shrink-0 text-[#4aa3ff]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search music, artists, albums"
            className="min-w-0 flex-1 bg-transparent px-2 text-[10px] text-[#dce7f0] outline-none placeholder:text-[#40586c]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[#526a7e] hover:text-white"
            >
              <X size={10} />
            </button>
          )}
        </form>
        <button
          onClick={() => void runChrome("tab.linkedBrowser.reload(); return 'ok';")}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white"
          title="Reload"
        >
          <RefreshCw size={11} />
        </button>
        <button
          onClick={() => {
            void runContent(
              `
                const doc = content.document;
                const video = doc.querySelector('video');
                if (!video) return false;
                if (video.requestPictureInPicture) {
                  try { await video.requestPictureInPicture(); return true; } catch {}
                }
                const player = doc.querySelector('#player, ytmusic-player');
                if (!player) return false;
                const active = player.dataset.nammuPip === 'true';
                player.dataset.nammuPip = active ? 'false' : 'true';
                Object.assign(player.style, active
                  ? { position: '', right: '', bottom: '', width: '', height: '', zIndex: '', boxShadow: '' }
                  : { position: 'fixed', right: '18px', bottom: '92px', width: '360px', height: '203px', zIndex: '2147483200', boxShadow: '0 18px 60px rgba(0,0,0,.65)' });
                return !active;
              `,
            );
          }}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white"
          title="Picture in Picture"
        >
          <Maximize2 size={11} />
        </button>
        <button
          onClick={() => navigate(`${MUSIC_URL}library/downloads`)}
          className="grid h-6 w-6 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white"
          title="Official offline downloads"
        >
          <Download size={11} />
        </button>
        <button
          onClick={() => setDrawer((current) => (current === 'extensions' ? null : 'extensions'))}
          className={`flex h-6 items-center gap-1 border px-2 font-mono text-[8px] uppercase tracking-wider ${drawer ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/12 text-[#acd5ff]' : 'border-white/[0.06] text-[#71889d] hover:bg-white/[0.05] hover:text-white'}`}
        >
          <Settings2 size={11} /> Extensions
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-[#05080d]">
        {engineState !== 'ready' && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-[#05080d] p-6">
            <div className="w-full max-w-md border border-white/[0.07] bg-[#080d15] p-5 shadow-2xl">
              {engineState === 'starting' ? (
                <div className="flex items-center gap-3">
                  <Loader2 size={20} className="animate-spin text-[#4aa3ff]" />
                  <div>
                    <div className="text-[12px] text-[#dce7f0]">Starting Nammu Music</div>
                    <div className="mt-1 font-mono text-[8px] text-[#526b80]">
                      One isolated Gecko session · plugins load once
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 text-[12px] text-red-300">
                    <Music2 size={16} /> Music could not start
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-[#71889d]">
                    {engineError}
                  </div>
                  <button
                    onClick={() => {
                      engineReadyRef.current = false;
                      commandQueueRef.current = Promise.resolve();
                      setEngineState('starting');
                      setEngineError('');
                      setEngineAttempt((value) => value + 1);
                    }}
                    className="mt-4 border border-[#4aa3ff]/35 bg-[#4aa3ff]/12 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#a8d3ff] hover:bg-[#4aa3ff]/20"
                  >
                    Retry engine
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <iframe
          key={engineAttempt}
          ref={iframeRef}
          src={runtimeUrl(engineAttempt)}
          title="Nammu YouTube Music runtime"
          className="h-full w-full border-0 bg-[#05080d]"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-orientation-lock"
          allow="cross-origin-isolated; autoplay; clipboard-read; clipboard-write; fullscreen; picture-in-picture; encrypted-media"
        />

        {drawer && (
          <aside className="absolute bottom-0 right-0 top-0 z-20 flex w-[330px] flex-col border-l border-white/[0.07] bg-[#070b12]/98 shadow-[-20px_0_60px_rgba(0,0,0,.5)] backdrop-blur-xl">
            <div className="flex h-9 shrink-0 items-center border-b border-white/[0.06] px-2">
              {(['extensions', 'audio', 'lyrics'] as DrawerView[]).map((view) => (
                <button
                  key={view}
                  onClick={() => setDrawer(view)}
                  className={`h-9 border-b px-2 font-mono text-[8px] uppercase tracking-wider ${drawer === view ? 'border-[#4aa3ff] text-[#b9dcff]' : 'border-transparent text-[#526b80] hover:text-[#a8bdcf]'}`}
                >
                  {view}
                </button>
              ))}
              <button
                onClick={() => setDrawer(null)}
                className="ml-auto grid h-6 w-6 place-items-center text-[#60778b] hover:bg-white/[0.05] hover:text-white"
              >
                <X size={12} />
              </button>
            </div>

            {drawer === 'extensions' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="space-y-2 border-b border-white/[0.05] p-2">
                  <div className="flex h-7 items-center border border-white/[0.06] bg-black/25 px-2">
                    <Search size={10} className="text-[#4aa3ff]" />
                    <input
                      value={pluginQuery}
                      onChange={(event) => setPluginQuery(event.target.value)}
                      placeholder={`Filter ${MUSIC_PLUGIN_CATALOG.length} extensions`}
                      className="min-w-0 flex-1 bg-transparent px-2 text-[9px] outline-none placeholder:text-[#40576a]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['All', 'Audio', 'Playback', 'Interface', 'Services', 'System'] as const).map(
                      (category) => (
                        <button
                          key={category}
                          onClick={() => setPluginCategory(category)}
                          className={`border px-1.5 py-0.5 font-mono text-[7px] uppercase ${pluginCategory === category ? 'border-[#4aa3ff]/35 bg-[#4aa3ff]/12 text-[#9dcbf7]' : 'border-white/[0.05] text-[#526b80]'}`}
                        >
                          {category}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-2 os-scrollbar">
                  <div className="space-y-1.5">
                    {filteredPlugins.map((plugin) => {
                      const enabled = preferences.plugins[plugin.id];
                      return (
                        <button
                          key={plugin.id}
                          onClick={() => togglePlugin(plugin.id)}
                          disabled={plugin.support !== 'native'}
                          className={`flex w-full items-start gap-2 border p-2 text-left transition-colors ${plugin.support === 'native' ? 'border-white/[0.06] hover:bg-white/[0.025]' : 'cursor-default border-white/[0.035] opacity-70'} ${enabled && plugin.support === 'native' ? 'bg-[#4aa3ff]/[0.045]' : ''}`}
                        >
                          <span
                            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${plugin.support === 'host-only' ? 'bg-amber-400' : enabled ? 'bg-[#2ee6a6] shadow-[0_0_7px_rgba(46,230,166,.7)]' : 'bg-[#344b5e]'}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[9.5px] text-[#cbd9e4]">{plugin.name}</span>
                              <span
                                className={`shrink-0 font-mono text-[6.5px] uppercase tracking-wider ${plugin.support === 'host-only' ? 'text-amber-300' : plugin.support === 'youtube' ? 'text-[#8e79df]' : enabled ? 'text-[#2ee6a6]' : 'text-[#4b6377]'}`}
                              >
                                {plugin.support === 'host-only'
                                  ? 'Desktop host'
                                  : plugin.support === 'youtube'
                                    ? 'Built in'
                                    : enabled
                                      ? 'On'
                                      : 'Off'}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[8px] leading-relaxed text-[#526b80]">
                              {plugin.description}
                            </span>
                          </span>
                          {plugin.support === 'native' && (
                            <span
                              className={`mt-0.5 h-3.5 w-6 shrink-0 border p-px ${enabled ? 'border-[#2ee6a6]/40 bg-[#2ee6a6]/15' : 'border-white/[0.08] bg-black/20'}`}
                            >
                              <span
                                className={`block h-2.5 w-2.5 transition-transform ${enabled ? 'translate-x-2 bg-[#2ee6a6]' : 'bg-[#40586c]'}`}
                              />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="border-t border-white/[0.05] px-2 py-1.5 font-mono text-[7px] text-[#40586c]">
                  Native modules run inside the isolated Gecko session. Electron hardware bridges
                  are shown separately and never presented as working toggles.
                </div>
              </div>
            )}

            {drawer === 'audio' && (
              <div className="min-h-0 flex-1 overflow-auto p-3 os-scrollbar">
                <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#526b80]">
                  Audio engine
                </div>
                <div className="mt-3 space-y-4">
                  <label className="block">
                    <span className="flex justify-between text-[9px] text-[#91a8bb]">
                      <span>Music volume</span>
                      <span className="font-mono text-[#4aa3ff]">
                        {Math.round(preferences.volume * 100)}%
                      </span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={preferences.volume}
                      onChange={(event) => updatePreference('volume', Number(event.target.value))}
                      className="os-range mt-2 w-full"
                    />
                  </label>
                  <label className="block">
                    <span className="flex justify-between text-[9px] text-[#91a8bb]">
                      <span>Playback speed</span>
                      <span className="font-mono text-[#4aa3ff]">
                        {preferences.playbackRate.toFixed(2)}×
                      </span>
                    </span>
                    <input
                      type="range"
                      min="0.25"
                      max="2"
                      step="0.05"
                      value={preferences.playbackRate}
                      onChange={(event) =>
                        updatePreference('playbackRate', Number(event.target.value))
                      }
                      className="os-range mt-2 w-full"
                    />
                  </label>
                  <div className="border-t border-white/[0.05] pt-3">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[9px] text-[#91a8bb]">Three-band equalizer</span>
                      <button
                        onClick={() => togglePlugin('equalizer')}
                        className={`font-mono text-[8px] ${preferences.plugins.equalizer ? 'text-[#2ee6a6]' : 'text-[#526b80]'}`}
                      >
                        {preferences.plugins.equalizer ? 'ENABLED' : 'DISABLED'}
                      </button>
                    </div>
                    {(
                      [
                        ['bass', 'Bass'],
                        ['mid', 'Mid'],
                        ['treble', 'Treble'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="mb-3 block">
                        <span className="flex justify-between font-mono text-[8px] text-[#60798d]">
                          <span>{label}</span>
                          <span>
                            {preferences[key] > 0 ? '+' : ''}
                            {preferences[key]} dB
                          </span>
                        </span>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={preferences[key]}
                          onChange={(event) => updatePreference(key, Number(event.target.value))}
                          className="os-range mt-1.5 w-full"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block border-t border-white/[0.05] pt-3">
                    <span className="flex justify-between text-[9px] text-[#91a8bb]">
                      <span>Crossfade</span>
                      <span className="font-mono text-[#4aa3ff]">
                        {preferences.crossfadeSeconds}s
                      </span>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="12"
                      step="1"
                      value={preferences.crossfadeSeconds}
                      onChange={(event) => {
                        updatePreference('crossfadeSeconds', Number(event.target.value));
                        if (!preferences.plugins.crossfade) togglePlugin('crossfade');
                      }}
                      className="os-range mt-2 w-full"
                    />
                  </label>
                  <label className="block border-t border-white/[0.05] pt-3">
                    <span className="mb-2 block text-[9px] text-[#91a8bb]">Output device</span>
                    <div className="relative">
                      <select
                        value={selectedOutput}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSelectedOutput(value);
                          void runContent(
                            `const video = content.document.querySelector('video'); if (!video?.setSinkId) return false; await video.setSinkId(${JSON.stringify(value)}); return true;`,
                          );
                        }}
                        className="h-7 w-full appearance-none border border-white/[0.07] bg-[#080d15] px-2 pr-7 text-[9px] text-[#adc0d0] outline-none"
                      >
                        <option value="">System default</option>
                        {audioOutputs.map((output) => (
                          <option key={output.deviceId} value={output.deviceId}>
                            {output.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={10}
                        className="pointer-events-none absolute right-2 top-2 text-[#526b80]"
                      />
                    </div>
                  </label>
                  <button
                    onClick={() => {
                      togglePlugin('notifications');
                      void requestNotifications();
                    }}
                    className="flex w-full items-center justify-between border-t border-white/[0.05] pt-3 text-left"
                  >
                    <span>
                      <span className="block text-[9px] text-[#91a8bb]">Track notifications</span>
                      <span className="mt-0.5 block text-[8px] text-[#526b80]">
                        Notify when the playing track changes
                      </span>
                    </span>
                    <span
                      className={`font-mono text-[8px] ${preferences.plugins.notifications ? 'text-[#2ee6a6]' : 'text-[#526b80]'}`}
                    >
                      {preferences.plugins.notifications ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {drawer === 'lyrics' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-white/[0.05] p-3">
                  <div className="truncate text-[11px] text-[#d9e5ee]">{media.title}</div>
                  <div className="mt-0.5 truncate text-[8px] text-[#60798d]">
                    {media.artist || 'Waiting for track metadata'}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-4 os-scrollbar">
                  {lyricsLoading ? (
                    <div className="flex items-center gap-2 font-mono text-[8px] text-[#60798d]">
                      <Loader2 size={12} className="animate-spin text-[#4aa3ff]" /> Finding
                      synchronized lyrics…
                    </div>
                  ) : lyrics?.instrumental ? (
                    <div className="grid h-40 place-items-center text-center">
                      <div>
                        <AudioLines size={24} className="mx-auto text-[#4aa3ff]" />
                        <div className="mt-2 text-[10px] text-[#91a8bb]">Instrumental track</div>
                      </div>
                    </div>
                  ) : lyrics?.lines.length ? (
                    <div className="space-y-3">
                      {lyrics.lines.map((line, index) => (
                        <button
                          key={`${line.time}-${index}`}
                          onClick={() =>
                            void runContent(
                              `const video = content.document.querySelector('video'); if (video) video.currentTime = ${line.time}; return true;`,
                            )
                          }
                          className={`block w-full text-left text-[11px] leading-relaxed transition-all ${index === activeLyric ? 'translate-x-1 text-[#dff7ff]' : index < activeLyric ? 'text-[#40596d]' : 'text-[#829aae]'}`}
                        >
                          {line.text}
                        </button>
                      ))}
                    </div>
                  ) : lyrics?.plain ? (
                    <div className="whitespace-pre-wrap text-[10px] leading-6 text-[#91a8bb]">
                      {lyrics.plain}
                    </div>
                  ) : (
                    <div className="grid h-40 place-items-center text-center text-[9px] leading-relaxed text-[#526b80]">
                      No lyrics were found for this track.
                    </div>
                  )}
                </div>
                {lyrics && (
                  <div className="border-t border-white/[0.05] px-3 py-2 font-mono text-[7px] uppercase tracking-wider text-[#40586c]">
                    Lyrics · {lyrics.source}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="flex h-[58px] shrink-0 items-center gap-3 border-t border-white/[0.07] bg-[#070b12] px-3">
        <div className="flex min-w-0 w-48 items-center gap-2">
          {media.thumbnail ? (
            <img src={media.thumbnail} alt="" className="h-10 w-10 shrink-0 object-cover" />
          ) : (
            <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/[0.06] bg-white/[0.02]">
              <Music2 size={16} className="text-[#4aa3ff]" />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[10px] text-[#d9e5ee]">{media.title}</div>
            <div className="mt-0.5 truncate text-[8px] text-[#60798d]">
              {media.artist || (engineState === 'ready' ? 'Ready' : 'Starting engine')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => skip('previous')}
            className="grid h-7 w-7 place-items-center text-[#7a92a6] hover:text-white"
            title="Previous"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={playPause}
            className="grid h-8 w-8 place-items-center border border-[#4aa3ff]/40 bg-[#4aa3ff]/12 text-[#b9dcff] hover:bg-[#4aa3ff]/20"
            title={media.paused ? 'Play' : 'Pause'}
          >
            {media.paused ? (
              <Play size={14} fill="currentColor" />
            ) : (
              <Pause size={14} fill="currentColor" />
            )}
          </button>
          <button
            onClick={() => skip('next')}
            className="grid h-7 w-7 place-items-center text-[#7a92a6] hover:text-white"
            title="Next"
          >
            <SkipForward size={14} />
          </button>
        </div>
        <span className="w-9 text-right font-mono text-[7px] text-[#526b80]">
          {formatTime(media.currentTime)}
        </span>
        <input
          type="range"
          min="0"
          max={Math.max(1, media.duration)}
          step="0.1"
          value={Math.min(media.currentTime, Math.max(1, media.duration))}
          onChange={(event) => {
            const value = Number(event.target.value);
            setMedia((current) => ({ ...current, currentTime: value }));
            void runContent(
              `const video = content.document.querySelector('video'); if (video) video.currentTime = ${value}; return true;`,
            );
          }}
          className="os-range min-w-20 flex-1"
          aria-label="Seek"
        />
        <span className="w-9 font-mono text-[7px] text-[#526b80]">
          {formatTime(media.duration)}
        </span>
        <button
          onClick={() =>
            void runContent(
              `const video = content.document.querySelector('video'); if (!video) return false; video.muted = !video.muted; return video.muted;`,
            )
          }
          className="grid h-7 w-7 place-items-center text-[#71889d] hover:text-white"
          title={media.muted ? 'Unmute' : 'Mute'}
        >
          {media.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={preferences.volume}
          onChange={(event) => updatePreference('volume', Number(event.target.value))}
          className="os-range w-20"
          aria-label="Music volume"
        />
        <button
          onClick={() => setDrawer((current) => (current === 'audio' ? null : 'audio'))}
          className="grid h-7 w-7 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white"
          title="Audio settings"
        >
          <SlidersHorizontal size={12} />
        </button>
        <button
          onClick={() => setDrawer((current) => (current === 'lyrics' ? null : 'lyrics'))}
          disabled={!preferences.plugins['synced-lyrics']}
          className="grid h-7 w-7 place-items-center text-[#71889d] hover:bg-white/[0.05] hover:text-white disabled:opacity-30"
          title="Lyrics"
        >
          <ListMusic size={12} />
        </button>
        <span
          className={`h-1.5 w-1.5 rounded-full ${engineState === 'ready' && bridgeAvailable ? 'bg-[#2ee6a6]' : engineState === 'error' ? 'bg-red-400' : 'bg-amber-300'}`}
          title={
            bridgeAvailable
              ? 'Media bridge ready'
              : 'Official site is available; native controls are reconnecting'
          }
        />
      </footer>
    </div>
  );
}
