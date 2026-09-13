'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Puzzle, RefreshCw, Search, X } from 'lucide-react';

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
import { getPlatformCapabilities } from '../../platform';
import { getGeckoRuntimeUrl } from '../../web-surfaces/geckoRuntimeUrl';
import { useWindowRuntime } from '../os/WindowRuntimeContext';
import NativeWebSurface, {
  type NativeWebSurfaceHandle,
} from '../web-surfaces/NativeWebSurface';

const MUSIC_URL = 'https://music.youtube.com/';
const CONTENT_RESPONSE_CHANNEL = 'nammu-youtube-music-content-response';

export const ADBLOCK_BOOTSTRAP_SOURCE = `data:application/javascript;charset=utf-8,${encodeURIComponent(`
  (() => {
    const prunePlayerResponse = (value, page) => {
      if (page.__nammuAdblockEnabled === false || !value || typeof value !== 'object') return value;
      try {
        const object = Cu.waiveXrays(value);
        delete object.playerAds;
        delete object.adPlacements;
        delete object.adSlots;
        for (const key of ['playerResponse', 'ytInitialPlayerResponse']) {
          const nested = object[key];
          if (!nested || typeof nested !== 'object') continue;
          const response = Cu.waiveXrays(nested);
          delete response.playerAds;
          delete response.adPlacements;
          delete response.adSlots;
        }
      } catch {}
      return value;
    };

    const install = (windowObject) => {
      if (!windowObject) return;
      const page = Cu.waiveXrays(windowObject);
      if (page.__nammuAdblockPrunerInstalled) return;
      page.__nammuAdblockPrunerInstalled = true;
      if (typeof page.__nammuAdblockEnabled !== 'boolean') page.__nammuAdblockEnabled = true;

      try {
        const json = Cu.waiveXrays(page.JSON);
        const originalParse = json.parse;
        json.parse = Cu.exportFunction(function () {
          return prunePlayerResponse(Reflect.apply(originalParse, json, arguments), page);
        }, page);
      } catch {}

      try {
        const responsePrototype = Cu.waiveXrays(page.Response.prototype);
        const originalJson = responsePrototype.json;
        const pruneResolved = Cu.exportFunction(
          (value) => prunePlayerResponse(value, page),
          page,
        );
        responsePrototype.json = Cu.exportFunction(function () {
          return Reflect.apply(originalJson, this, arguments).then(pruneResolved);
        }, page);
      } catch {}

      for (const key of ['ytInitialPlayerResponse', 'playerResponse']) {
        try {
          let stored = page[key];
          Object.defineProperty(page, key, {
            configurable: true,
            enumerable: true,
            get: Cu.exportFunction(() => stored, page),
            set: Cu.exportFunction((value) => {
              stored = prunePlayerResponse(value, page);
            }, page),
          });
        } catch {}
      }
    };

    addEventListener('DOMWindowCreated', (event) => {
      try { install(event.target?.defaultView); } catch {}
    }, true);
    try { install(content); } catch {}
  })();
`)}`;

type EngineState = 'starting' | 'ready' | 'error';
type DrawerView = 'extensions';

type GeckoRuntimeWindow = Window & {
  geckoDispose?: () => void;
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
    Services.prefs.setBoolPref('dom.disable_beforeunload', true);
    Services.prefs.setBoolPref('privacy.trackingprotection.enabled', true);
    Services.prefs.setBoolPref('privacy.trackingprotection.pbmode.enabled', true);
    Services.prefs.setBoolPref('privacy.trackingprotection.socialtracking.enabled', true);
    tab.linkedBrowser.messageManager.loadFrameScript(${JSON.stringify(ADBLOCK_BOOTSTRAP_SOURCE)}, true, false);
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
  foregroundVisuals: boolean,
): string {
  const settings = JSON.stringify({
    ...preferences,
    masterVolume: Math.min(1, Math.max(0, masterVolumePercent / 100)),
    foregroundVisuals,
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
    ${foregroundVisuals ? '' : '#background, .animated-thumbnail { animation-play-state: paused !important; }'}
    ${plugins.adblocker ? '.ytp-ad-module, .ytp-ad-overlay-container, ytmusic-mealbar-promo-renderer, ytmusic-statement-banner-renderer, ytd-ad-slot-renderer, #masthead-ad { display: none !important; visibility: hidden !important; }' : ''}
    * { scrollbar-color: rgba(255,255,255,.26) transparent !important; scrollbar-width: thin !important; }
    *::-webkit-scrollbar { width: 5px !important; height: 5px !important; }
    *::-webkit-scrollbar-track { background: transparent !important; }
    *::-webkit-scrollbar-thumb { background: rgba(255,255,255,.26) !important; border: 1px solid transparent !important; border-radius: 999px !important; background-clip: padding-box !important; }
    *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.42) !important; }
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
    try { content.wrappedJSObject.__nammuAdblockEnabled = Boolean(p.adblocker); } catch {}
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

    if (video) {
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
          runtime.masterGain = runtime.context.createGain();
          runtime.bass.type = 'lowshelf'; runtime.bass.frequency.value = 180;
          runtime.mid.type = 'peaking'; runtime.mid.frequency.value = 1000; runtime.mid.Q.value = .8;
          runtime.treble.type = 'highshelf'; runtime.treble.frequency.value = 5000;
          runtime.source.connect(runtime.bass).connect(runtime.mid).connect(runtime.treble).connect(runtime.compressor).connect(runtime.analyser).connect(runtime.masterGain).connect(runtime.context.destination);
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
        const masterVolume = Math.min(1, Math.max(0, Number(currentSettings.masterVolume) || 0));
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
        const volumeCurve = currentPlugins['exponential-volume'] ? currentVideo.volume : 1;
        if (runtime.masterGain) {
          runtime.masterGain.gain.value = Math.min(1, Math.max(0, masterVolume * volumeCurve * volumeFactor));
        }
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
          const player = currentDoc.querySelector('#movie_player');
          const adShowing = Boolean(
            player?.classList.contains('ad-showing') ||
            player?.classList.contains('ad-interrupting') ||
            currentDoc.querySelector('ytmusic-player-page[is-advertisement]')
          );
          if (adShowing) {
            if (!runtime.adWasShowing) {
              runtime.adWasShowing = true;
              runtime.preAdMuted = currentVideo.muted;
              runtime.preAdRate = currentVideo.playbackRate;
            }
            currentVideo.muted = true;
            currentVideo.playbackRate = 16;
            currentDoc.querySelector('button.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, [id*="skip-button"] button')?.click();
            try {
              if (currentVideo.seekable?.length) {
                const end = currentVideo.seekable.end(currentVideo.seekable.length - 1);
                if (Number.isFinite(end) && end > currentVideo.currentTime) currentVideo.currentTime = Math.max(currentVideo.currentTime, end - .05);
              }
            } catch {}
          } else if (runtime.adWasShowing) {
            runtime.adWasShowing = false;
            currentVideo.muted = Boolean(runtime.preAdMuted);
            currentVideo.playbackRate = Number(currentSettings.playbackRate) || runtime.preAdRate || 1;
          }
        } else if (runtime.adWasShowing) {
          runtime.adWasShowing = false;
          currentVideo.muted = Boolean(runtime.preAdMuted);
        }
      }, 250);
    }

    if (!settings.foregroundVisuals || !p.visualizer) {
      if (runtime.visualizerLoop) content.cancelAnimationFrame(runtime.visualizerLoop);
      runtime.visualizerLoop = 0;
      doc.getElementById('nammu-music-visualizer')?.remove();
    } else if (!runtime.visualizerLoop) {
      const drawVisualizer = () => {
        const currentSettings = runtime.settings;
        const currentDoc = runtime.document;
        if (!currentSettings?.foregroundVisuals || !currentSettings.plugins.visualizer || !currentDoc) {
          runtime.visualizerLoop = 0;
          currentDoc?.getElementById('nammu-music-visualizer')?.remove();
          return;
        }
        runtime.visualizerLoop = content.requestAnimationFrame(drawVisualizer);
        let canvas = currentDoc.getElementById('nammu-music-visualizer');
        if (!runtime.analyser) {
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

export default function YouTubeMusicApp() {
  const platform = getPlatformCapabilities();
  const nativeSurfaceEnabled = platform.runtime === 'tauri';
  const windowRuntime = useWindowRuntime();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const geckoRuntimeRef = useRef<GeckoRuntimeWindow | null>(null);
  const nativeSurfaceRef = useRef<NativeWebSurfaceHandle | null>(null);
  const engineReadyRef = useRef(false);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mediaRef = useRef(EMPTY_MEDIA);
  const lastNotifiedTitleRef = useRef('');
  const { volume: masterVolume } = useMasterVolume();
  const [engineState, setEngineState] = useState<EngineState>('starting');
  const [engineError, setEngineError] = useState('');
  const [engineAttempt, setEngineAttempt] = useState(1);
  const [runtimeWispUrl, setRuntimeWispUrl] = useState('');
  const [preferences, setPreferences] = useState(DEFAULT_NAMMU_MUSIC_PREFERENCES);
  const [media, setMedia] = useState<MediaState>(EMPTY_MEDIA);

  const [drawer, setDrawer] = useState<DrawerView | null>(null);
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginCategory, setPluginCategory] = useState<MusicPluginCategory | 'All'>('All');
  const [requestingNotificationPermission, setRequestingNotificationPermission] = useState(false);

  useEffect(() => setPreferences(getStoredNammuMusicPreferences()), []);

  useEffect(() => {
    if (nativeSurfaceEnabled) {
      setRuntimeWispUrl('');
      return;
    }
    let cancelled = false;
    setRuntimeWispUrl('');
    void getPlatformCapabilities()
      .services.wispUrl()
      .then((url) => {
        if (!cancelled) setRuntimeWispUrl(url);
      })
      .catch((error) => {
        if (cancelled) return;
        engineReadyRef.current = false;
        setEngineState('error');
        setEngineError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [engineAttempt, nativeSurfaceEnabled]);

  useEffect(() => {
    saveNammuMusicPreferences(preferences);
  }, [preferences]);

  const evaluateInRuntime = useCallback((script: string): Promise<unknown> => {
    if (nativeSurfaceEnabled) return Promise.resolve(null);
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
  }, [nativeSurfaceEnabled]);

  const runContent = useCallback(
    async <T,>(command: string): Promise<T | null> => {
      if (!engineReadyRef.current) return null;
      try {
        const raw = await evaluateInRuntime(contentCommand(command));
        if (typeof raw !== 'string') return null;
        const envelope = JSON.parse(raw) as { ok?: boolean; value?: string; error?: string };
        if (!envelope.ok) {
          return null;
        }
        return JSON.parse(envelope.value || 'null') as T;
      } catch {
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
    void runContent<boolean>(
      applyPreferencesCommand(preferences, masterVolume, windowRuntime.isActive),
    );
    void evaluateInRuntime(`(()=>{
      const enabled = ${preferences.plugins.adblocker};
      Services.prefs.setBoolPref('dom.disable_beforeunload', true);
      Services.prefs.setBoolPref('privacy.trackingprotection.enabled', enabled);
      Services.prefs.setBoolPref('privacy.trackingprotection.pbmode.enabled', enabled);
      Services.prefs.setBoolPref('privacy.trackingprotection.socialtracking.enabled', enabled);
      Services.prefs.setStringPref('browser.contentblocking.category', enabled ? 'strict' : 'standard');
      if (enabled && !globalThis.__nammuMusicAdObserver) {
        const blockedFragments = [
          'doubleclick.net',
          'googlesyndication.com',
          'googleadservices.com',
          '/api/stats/ads',
          '/pagead/',
          '/get_midroll_info',
          '/ptracking'
        ];
        const observer = {
          observe(subject) {
            try {
              const channel = subject.QueryInterface(Ci.nsIHttpChannel);
              const address = String(channel.URI?.spec || '').toLowerCase();
              if (blockedFragments.some((fragment) => address.includes(fragment))) {
                channel.cancel(Cr.NS_BINDING_ABORTED);
              }
            } catch {}
          }
        };
        Services.obs.addObserver(observer, 'http-on-modify-request');
        globalThis.__nammuMusicAdObserver = observer;
      } else if (!enabled && globalThis.__nammuMusicAdObserver) {
        try { Services.obs.removeObserver(globalThis.__nammuMusicAdObserver, 'http-on-modify-request'); } catch {}
        delete globalThis.__nammuMusicAdObserver;
      }
      return 'preferences-applied';
    })()`);
  }, [evaluateInRuntime, masterVolume, preferences, runContent, windowRuntime.isActive]);

  useEffect(() => {
    if (nativeSurfaceEnabled) return;
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
      geckoRuntimeRef.current = event.source as GeckoRuntimeWindow;
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
  }, [evaluateInRuntime, nativeSurfaceEnabled]);

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
    if (nativeSurfaceEnabled || engineState !== 'ready') return;
    applyPreferences();
    const applyTimer = window.setInterval(
      applyPreferences,
      windowRuntime.isActive ? 30_000 : 60_000,
    );
    return () => window.clearInterval(applyTimer);
  }, [applyPreferences, engineState, nativeSurfaceEnabled, windowRuntime.isActive]);

  useEffect(() => {
    if (nativeSurfaceEnabled || engineState !== 'ready') return;
    let disposed = false;
    const refresh = async () => {
      const next = await runContent<MediaState>(mediaStateCommand());
      if (!next || disposed) return;
      mediaRef.current = next;
      setMedia((current) =>
        current.artist === next.artist &&
        current.muted === next.muted &&
        current.paused === next.paused &&
        current.thumbnail === next.thumbnail &&
        current.title === next.title &&
        current.videoId === next.videoId
          ? current
          : next,
      );
      if (
        preferences.plugins.notifications &&
        !next.paused &&
        next.title &&
        next.title !== 'YouTube Music' &&
        next.title !== lastNotifiedTitleRef.current
      ) {
        lastNotifiedTitleRef.current = next.title;
        void getPlatformCapabilities().notifications.show({
          title: next.title,
          body: next.artist || 'YouTube Music',
          iconUrl: next.thumbnail,
        });
      }
    };
    void refresh();
    const refreshInterval = windowRuntime.isMinimized
      ? 5_000
      : windowRuntime.isActive
        ? 1_000
        : 2_000;
    const timer = window.setInterval(refresh, refreshInterval);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    engineState,
    nativeSurfaceEnabled,
    preferences.plugins.notifications,
    runContent,
    windowRuntime.isActive,
    windowRuntime.isMinimized,
  ]);

  useEffect(() => {
    if (
      nativeSurfaceEnabled ||
      !preferences.plugins.sponsorblock ||
      !media.videoId ||
      engineState !== 'ready'
    )
      return;
    const controller = new AbortController();
    let timer = 0;
    getPlatformCapabilities()
      .services.request(`/api/music/sponsorblock?videoId=${encodeURIComponent(media.videoId)}`, {
        signal: controller.signal,
      })
      .then((response) => response.json())
      .then((payload: { data?: Array<{ segment: [number, number] }> }) => {
        const segments = payload.data || [];
        timer = window.setInterval(
          () => {
            const current = mediaRef.current.currentTime;
            const segment = segments.find(
              ({ segment: [start, end] }) => current >= start && current < end,
            );
            if (segment)
              void runContent(
                `const video = content.document.querySelector('video'); if (video) video.currentTime = ${segment.segment[1]}; return true;`,
              );
          },
          windowRuntime.isActive ? 750 : 1_500,
        );
      })
      .catch(() => {});
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    engineState,
    media.videoId,
    nativeSurfaceEnabled,
    preferences.plugins.sponsorblock,
    runContent,
    windowRuntime.isActive,
  ]);

  useEffect(
    () => () => {
      nativeSurfaceRef.current = null;
      if (nativeSurfaceEnabled) return;
      engineReadyRef.current = false;
      const frame = iframeRef.current;
      const runtimeWindow = geckoRuntimeRef.current;
      try {
        const cleanup = runtimeWindow?.geckoEvalChrome?.(`(()=>{
          const runtime = globalThis.__nammuMusicAudioRuntime;
          const runtimeWindow = runtime?.document?.defaultView;
          if (runtime?.monitorTimer) runtimeWindow?.clearInterval(runtime.monitorTimer);
          if (runtime?.visualizerLoop) runtimeWindow?.cancelAnimationFrame(runtime.visualizerLoop);
          try { globalThis.__nammuMusicAdObserver && Services.obs.removeObserver(globalThis.__nammuMusicAdObserver, 'http-on-modify-request'); } catch {}
          return 'music-runtime-disposed';
        })()`);
        void cleanup?.catch(() => undefined);
      } catch {}
      try {
        runtimeWindow?.geckoDispose?.();
      } catch {}
      geckoRuntimeRef.current = null;
      try {
        frame?.setAttribute('src', 'about:blank');
      } catch {}
    },
    [nativeSurfaceEnabled],
  );

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
    if (nativeSurfaceEnabled) return;
    if (!preferences.plugins['taskbar-mediacontrol'] || !('mediaSession' in navigator)) return;
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
  }, [
    media.artist,
    media.paused,
    media.thumbnail,
    media.title,
    nativeSurfaceEnabled,
    playPause,
    preferences.plugins,
    runContent,
    skip,
  ]);

  const togglePlugin = async (id: NammuMusicPluginId) => {
    const plugin = MUSIC_PLUGIN_CATALOG.find((item) => item.id === id);
    if (!plugin || plugin.support !== 'native') return;
    const enabling = !preferences.plugins[id];
    if (id === 'notifications' && enabling) {
      if (requestingNotificationPermission) return;
      setRequestingNotificationPermission(true);
      try {
        const permission = await getPlatformCapabilities().notifications.requestPermission();
        if (permission.status !== 'success' || permission.value !== 'granted') return;
      } finally {
        setRequestingNotificationPermission(false);
      }
    }
    setPreferences((current) => ({
      ...current,
      ...(id === 'equalizer' && enabling && !current.bass && !current.mid && !current.treble
        ? { bass: 4, mid: 1, treble: 3 }
        : {}),
      plugins: { ...current.plugins, [id]: !current.plugins[id] },
    }));
  };

  const filteredPlugins = useMemo(() => {
    const normalized = pluginQuery.trim().toLowerCase();
    return MUSIC_PLUGIN_CATALOG.filter(
      (plugin) =>
        (pluginCategory === 'All' || plugin.category === pluginCategory) &&
        (!normalized || `${plugin.name} ${plugin.description}`.toLowerCase().includes(normalized)),
    );
  }, [pluginCategory, pluginQuery]);

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#05080d] text-[#c7d6e2]">
      <header className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-white/[0.06] bg-[#070b12]/95 px-2">
        <button
          onClick={() => setDrawer((current) => (current === 'extensions' ? null : 'extensions'))}
          className={`flex h-6 items-center gap-1 border px-2 font-mono text-[8px] uppercase tracking-wider ${drawer === 'extensions' ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/12 text-[#acd5ff]' : 'border-white/[0.06] text-[#71889d] hover:bg-white/[0.05] hover:text-white'}`}
          aria-expanded={drawer === 'extensions'}
        >
          <Puzzle size={11} /> Extensions
        </button>
        <button
          onClick={() => {
            if (nativeSurfaceEnabled) void nativeSurfaceRef.current?.reload();
            else void runChrome("tab.linkedBrowser.reload(); return 'ok';");
          }}
          disabled={engineState !== 'ready'}
          className="flex h-6 items-center gap-1 border border-white/[0.06] px-2 font-mono text-[8px] uppercase tracking-wider text-[#71889d] hover:bg-white/[0.05] hover:text-white disabled:opacity-35"
          title="Reload YouTube Music"
        >
          <RefreshCw size={11} /> Reload
        </button>
      </header>
      <div className="relative min-h-0 flex-1 bg-[#05080d]">
        {engineState === 'error' && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-[#05080d] p-6">
            <div className="w-full max-w-md border border-white/[0.07] bg-[#080d15] p-5 shadow-2xl">
              <div>
                <div className="flex items-center gap-2 text-[12px] text-red-300">
                  <Music2 size={16} /> Music could not start
                </div>
                <div className="mt-2 text-[10px] leading-relaxed text-[#71889d]">
                  {engineError}
                </div>
                <button
                  onClick={() => {
                    if (nativeSurfaceEnabled) {
                      nativeSurfaceRef.current = null;
                      engineReadyRef.current = false;
                      setEngineState('starting');
                      setEngineError('');
                      setEngineAttempt((value) => value + 1);
                      return;
                    }
                    try {
                      geckoRuntimeRef.current?.geckoDispose?.();
                    } catch {}
                    geckoRuntimeRef.current = null;
                    engineReadyRef.current = false;
                    commandQueueRef.current = Promise.resolve();
                    setEngineState('starting');
                    setEngineError('');
                    setRuntimeWispUrl('');
                    setEngineAttempt((value) => value + 1);
                  }}
                  className="mt-4 border border-[#4aa3ff]/35 bg-[#4aa3ff]/12 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#a8d3ff] hover:bg-[#4aa3ff]/20"
                >
                  Retry engine
                </button>
              </div>
            </div>
          </div>
        )}
        {nativeSurfaceEnabled ? (
          <NativeWebSurface
            key={engineAttempt}
            ref={nativeSurfaceRef}
            enabled
            active
            owner="youtube-music"
            profileKey="default"
            privateSession={false}
            url={MUSIC_URL}
            zoom={100}
            muted={media.muted}
            browserOverlayActive={false}
            overlayActive={drawer !== null}
            surfaceLabel="YouTube Music"
            onState={(snapshot) => {
              setMedia((current) => ({
                ...current,
                title: snapshot.title || current.title,
                muted: snapshot.isMuted,
                paused: !snapshot.isAudioPlaying,
              }));
            }}
            onReady={() => {
              engineReadyRef.current = true;
              setEngineState('ready');
              setEngineError('');
            }}
            onFailure={(message) => {
              engineReadyRef.current = false;
              setEngineState('error');
              setEngineError(message || 'YouTube Music could not open in the native web runtime.');
            }}
            onDiagnostic={() => {}}
          />
        ) : runtimeWispUrl ? (
          <iframe
            key={engineAttempt}
            ref={iframeRef}
            src={getGeckoRuntimeUrl(`nammu-music-${engineAttempt}`, runtimeWispUrl)}
            title="Nammu YouTube Music runtime"
            className="h-full w-full border-0 bg-[#05080d]"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-pointer-lock allow-orientation-lock"
            allow="cross-origin-isolated; autoplay; clipboard-read; clipboard-write; fullscreen; picture-in-picture; encrypted-media"
          />
        ) : null}

        {drawer === 'extensions' && (
          <aside className="absolute bottom-0 right-0 top-0 z-20 flex w-[330px] flex-col border-l border-white/[0.07] bg-[#070b12]/98 shadow-[-20px_0_60px_rgba(0,0,0,.5)] backdrop-blur-xl">
            <div className="flex h-9 shrink-0 items-center border-b border-white/[0.06] px-3">
              <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#7fa2bd]">
                Extensions
              </span>
              <button
                onClick={() => setDrawer(null)}
                className="ml-auto grid h-6 w-6 place-items-center text-[#60778b] hover:bg-white/[0.05] hover:text-white"
                aria-label="Close extensions"
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
                      const enabled =
                        plugin.support === 'youtube' ||
                        (plugin.support === 'native' && preferences.plugins[plugin.id]);
                      return (
                        <button
                          key={plugin.id}
                          onClick={() => void togglePlugin(plugin.id)}
                          disabled={
                            plugin.support !== 'native' ||
                            (plugin.id === 'notifications' && requestingNotificationPermission)
                          }
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
          </aside>
        )}
      </div>
    </div>
  );
}
