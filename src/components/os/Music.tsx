import { useEffect, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import {
  Download,
  Heart,
  Link2,
  ListMusic,
  Mic2,
  MonitorSpeaker,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useContextMenu } from '../context-menu/useContextMenu';
import type { ContextMenuEntry } from '../context-menu/contextMenuTypes';
import { useMasterVolume } from '../../hooks/useMasterVolume';
import { getEffectiveMediaVolume } from '../../lib/osVolume';
import {
  DEFAULT_MUSIC_SETTINGS,
  MUSIC_SETTINGS_CHANGE_EVENT,
  MUSIC_VOLUME_CHANGE_EVENT,
  getSavedMusicSettings,
  getSavedMusicVolume,
  areMusicSettingsEqual,
  saveMusicSettings,
  saveMusicVolume,
  type MusicPane as Pane,
  type MusicPlayerSettings,
  type MusicRepeatMode as RepeatMode,
} from '../../lib/musicSettings';

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  url: string;
  cover: string;
  year: string;
  quality: string;
}

const TRACKS: Track[] = [
  {
    id: 't1',
    title: 'Bride of Light',
    artist: 'Muhammad Al Muqit',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/5e29dace-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-1.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't2',
    title: 'Btmanna Ansak',
    artist: 'Sherine',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/577f06cc-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-2.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't3',
    title: 'Faslon ko Takalluf Slowed + Reverb',
    artist: 'Zaid Writex',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/5c743ccd-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-3.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't4',
    title: 'Kalam Eineh',
    artist: 'Sherine (slowed reverb)',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/5e076ae3-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-4.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't5',
    title: 'Kun Anta',
    artist: 'Zory Maher Cover',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/53856a95-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-5.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't6',
    title: 'TOUS CES MOTS',
    artist: 'Faouzia',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/53d59904-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-6.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't7',
    title: 'TUTU',
    artist: 'Alma Zarza',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/5caea495-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-1.png',
    year: '2026',
    quality: 'Stream',
  },
  {
    id: 't8',
    title: 'Where You Are (Muffled)',
    artist: 'Halal Beats',
    album: 'Nammu Collection',
    url: 'https://audio.jukehost.co.uk/58caae2a-40b0-11f1-a012-fa163edb0845',
    cover: '/images/album-2.png',
    year: '2026',
    quality: 'Stream',
  },
];

const SHUFFLE_ORDER = [2, 5, 1, 7, 3, 0, 6, 4];
const fmtTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

interface MusicProps {
  isOpen: boolean;
  onMinimize: () => void;
}

export function Music({ isOpen, onMinimize }: MusicProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeTimerRef = useRef<number | null>(null);
  const initialSettingsRef = useRef<MusicPlayerSettings | null>(null);
  if (!initialSettingsRef.current) initialSettingsRef.current = getSavedMusicSettings();
  const initialSettings = initialSettingsRef.current;
  const { volume: masterVolume } = useMasterVolume();
  const masterVolumeRef = useRef(masterVolume);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({ t1: true, t6: true });
  const [volume, setVolume] = useState(getSavedMusicVolume);
  const volumeRef = useRef(volume);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>({});
  const [showVolumeOverlay, setShowVolumeOverlay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playerSettings, setPlayerSettings] = useState(initialSettings);
  const shuffle = playerSettings.shuffle;
  const repeat = playerSettings.repeat;
  const pane = playerSettings.pane;
  const setShuffle = (value: boolean | ((current: boolean) => boolean)) => {
    setPlayerSettings((current) => ({
      ...current,
      shuffle: typeof value === 'function' ? value(current.shuffle) : value,
    }));
  };
  const setRepeat = (value: RepeatMode | ((current: RepeatMode) => RepeatMode)) => {
    setPlayerSettings((current) => ({
      ...current,
      repeat: typeof value === 'function' ? value(current.repeat) : value,
    }));
  };
  const setPane = (value: Pane | ((current: Pane) => Pane)) => {
    setPlayerSettings((current) => ({
      ...current,
      pane: typeof value === 'function' ? value(current.pane) : value,
    }));
  };
  const contextMenu = useContextMenu();
  const track = TRACKS[trackIndex];
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.src = TRACKS[0].url;
      audio.volume = getEffectiveMediaVolume(volumeRef.current, masterVolumeRef.current);
      audio.load();
    }
    return () => {
      if (volumeTimerRef.current) window.clearTimeout(volumeTimerRef.current);
      audio?.pause();
    };
  }, []);

  useEffect(() => {
    masterVolumeRef.current = masterVolume;
    if (audioRef.current) {
      audioRef.current.volume = getEffectiveMediaVolume(volumeRef.current, masterVolume);
    }
  }, [masterVolume]);

  useEffect(() => {
    saveMusicSettings(playerSettings);
  }, [playerSettings]);

  useEffect(() => {
    const handleExternalSettings = (event: Event) => {
      const next = (event as CustomEvent<MusicPlayerSettings>).detail;
      if (!next) return;
      setPlayerSettings((current) => (areMusicSettingsEqual(current, next) ? current : next));
    };
    const handleExternalVolume = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (!Number.isFinite(next)) return;
      volumeRef.current = next;
      setVolume(next);
      if (audioRef.current) {
        audioRef.current.volume = getEffectiveMediaVolume(next, masterVolumeRef.current);
      }
    };
    window.addEventListener(MUSIC_SETTINGS_CHANGE_EVENT, handleExternalSettings);
    window.addEventListener(MUSIC_VOLUME_CHANGE_EVENT, handleExternalVolume);
    return () => {
      window.removeEventListener(MUSIC_SETTINGS_CHANGE_EVENT, handleExternalSettings);
      window.removeEventListener(MUSIC_VOLUME_CHANGE_EVENT, handleExternalVolume);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playerSettings.playbackRate;
  }, [playerSettings.playbackRate]);

  useEffect(() => {
    if (!showSettings) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSettings]);

  const updatePlayerSetting = <Key extends keyof MusicPlayerSettings>(
    key: Key,
    value: MusicPlayerSettings[Key],
  ) => {
    setPlayerSettings((current) => ({ ...current, [key]: value }));
  };

  const resetPlayerSettings = () => {
    setPlayerSettings({ ...DEFAULT_MUSIC_SETTINGS });
    changeVolume(0.72);
  };

  const showVolumeInteraction = () => {
    setShowVolumeOverlay(true);
    if (volumeTimerRef.current) window.clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = window.setTimeout(() => setShowVolumeOverlay(false), 800);
  };

  const selectTrack = (index: number, autoplay: boolean) => {
    const audio = audioRef.current;
    const selectedTrack = TRACKS[index];
    setTrackIndex(index);
    setProgress(0);
    setDuration(trackDurations[selectedTrack.id] ?? 0);
    if (!audio) return;
    audio.pause();
    audio.src = selectedTrack.url;
    audio.load();
    audio.volume = getEffectiveMediaVolume(volumeRef.current, masterVolumeRef.current);
    audio.playbackRate = playerSettings.playbackRate;
    audio.muted = muted;
    if (autoplay) {
      void audio.play().catch(() => setPlaying(false));
    }
  };

  const nextTrack = (autoplay = playing) => {
    let next = (trackIndex + 1) % TRACKS.length;
    if (shuffle) {
      const shufflePosition = SHUFFLE_ORDER.indexOf(trackIndex);
      next = SHUFFLE_ORDER[(shufflePosition + 1) % SHUFFLE_ORDER.length];
    }
    selectTrack(next, autoplay);
  };

  const prevTrack = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    selectTrack((trackIndex - 1 + TRACKS.length) % TRACKS.length, playing);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const playAt = (index: number) => {
    selectTrack(index, true);
  };

  const downloadTrack = () => {
    const anchor = document.createElement('a');
    anchor.href = track.url;
    anchor.download = track.title;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
  };

  const copyTrackLink = () => {
    void navigator.clipboard.writeText(track.url);
  };

  const seek = (nextProgress: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = nextProgress;
    setProgress(nextProgress);
  };

  const changeVolume = (nextVolume: number, showOverlay = false) => {
    const clampedVolume = Math.max(0, Math.min(1, nextVolume));
    volumeRef.current = clampedVolume;
    setVolume(clampedVolume);
    setMuted(false);
    saveMusicVolume(clampedVolume);
    const audio = audioRef.current;
    if (audio) {
      audio.volume = getEffectiveMediaVolume(clampedVolume, masterVolumeRef.current);
      audio.muted = false;
    }
    if (showOverlay) showVolumeInteraction();
  };

  const changeVolumeWithWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 0.05 : -0.05;
    changeVolume(volumeRef.current + step, true);
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (audioRef.current) audioRef.current.muted = nextMuted;
  };
  const musicMenu: ContextMenuEntry[] = [
    { id: 'music-header', type: 'header', label: `${track.title} · ${track.artist}` },
    {
      id: 'music-play',
      label: playing ? 'Pause' : 'Play',
      icon: playing ? Pause : Play,
      shortcut: 'SPACE',
      action: togglePlayback,
    },
    { id: 'music-previous', label: 'Previous track', icon: SkipBack, action: prevTrack },
    { id: 'music-next', label: 'Next track', icon: SkipForward, action: () => nextTrack() },
    {
      id: 'music-mute',
      label: muted ? 'Unmute' : 'Mute',
      icon: muted ? Volume2 : VolumeX,
      checked: muted,
      action: toggleMute,
    },
    {
      id: 'music-repeat',
      label: 'Repeat',
      icon: repeat === 'one' ? Repeat1 : Repeat,
      items: [
        {
          id: 'music-repeat-off',
          label: 'Off',
          checked: repeat === 'off',
          action: () => setRepeat('off'),
        },
        {
          id: 'music-repeat-all',
          label: 'All tracks',
          checked: repeat === 'all',
          action: () => setRepeat('all'),
        },
        {
          id: 'music-repeat-one',
          label: 'Current track',
          checked: repeat === 'one',
          action: () => setRepeat('one'),
        },
      ],
    },
    { id: 'music-sep-1', type: 'separator' },
    { id: 'music-copy-link', label: 'Copy track link', icon: Link2, action: copyTrackLink },
    { id: 'music-download', label: 'Download track', icon: Download, action: downloadTrack },
    { id: 'music-sep-2', type: 'separator' },
    { id: 'music-hide', label: 'Hide music sidebar', icon: X, action: onMinimize },
  ];

  return (
    <aside
      className={`music-sidebar fixed bottom-[32px] right-0 top-0 z-[9996] flex w-[292px] shrink-0 flex-col overflow-hidden border-l border-white/[0.05] transition-transform duration-200 ${playerSettings.motion ? '' : 'music-motion-reduced'} ${isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
      style={
        {
          '--music-panel-opacity': `${100 - playerSettings.transparency}%`,
          '--music-panel-blur': `${playerSettings.blur}px`,
        } as CSSProperties
      }
      aria-hidden={!isOpen}
      onContextMenu={(event) =>
        contextMenu.openAtEvent(event, musicMenu, {
          safeArea: { left: 36, right: 0, bottom: 32 },
          ariaLabel: 'Music player menu',
        })
      }
      onPointerDown={(event) =>
        contextMenu.startLongPress(event, musicMenu, {
          safeArea: { left: 36, right: 0, bottom: 32 },
          ariaLabel: 'Music player menu',
        })
      }
      onPointerUp={contextMenu.cancelLongPress}
      onPointerCancel={contextMenu.cancelLongPress}
      onPointerMove={contextMenu.cancelLongPress}
    >
      <audio
        ref={audioRef}
        data-nammu-volume-managed="local"
        preload="metadata"
        loop={repeat === 'one'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const loadedDuration = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : 0;
          setDuration(loadedDuration);
          setTrackDurations((current) => ({ ...current, [track.id]: loadedDuration }));
        }}
        onEnded={() => {
          const audio = audioRef.current;
          if (repeat === 'one' && audio) {
            audio.currentTime = 0;
            void audio.play();
          } else if (repeat === 'all' || playerSettings.autoAdvance) {
            nextTrack(true);
          } else {
            setProgress(duration);
            setPlaying(false);
          }
        }}
      />

      {playerSettings.atmosphere && (
        <div className="music-atmosphere pointer-events-none absolute inset-0 opacity-40">
          <img src={track.cover} alt="" className="h-full w-full scale-125 object-cover blur-3xl" />
          <div className="music-atmosphere-mask absolute inset-0" />
        </div>
      )}

      <div className="relative flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span className="status-dot bg-[#2ee6a6]" style={{ color: '#2ee6a6' }} />
          <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-[#7d90a2]">
            Listen
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSettings((current) => !current)}
            className={`grid h-5 w-5 place-items-center transition-colors ${showSettings ? 'bg-os-accent/10 text-os-accent' : 'text-[#4a5c6c] hover:text-[#bcd0df]'}`}
            aria-label="Music player settings"
            aria-expanded={showSettings}
            aria-controls="music-player-settings"
            title="Music player settings"
          >
            <Settings2 size={11} />
          </button>
          <button
            onClick={() => {
              setShowSettings(false);
              onMinimize();
            }}
            className="grid h-5 w-5 place-items-center text-[#4a5c6c] transition-colors hover:text-[#bcd0df]"
            aria-label="Minimize music player"
            title="Minimize music player"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {showSettings && (
        <section
          id="music-player-settings"
          className="music-settings-panel absolute inset-x-0 bottom-0 top-9 z-40 flex flex-col"
        >
          <div className="music-settings-header flex h-9 shrink-0 items-center justify-between px-3">
            <span className="flex items-center gap-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.16em] text-os-text-muted">
              <Settings2 size={11} className="text-os-accent" /> Player settings
            </span>
            <button
              onClick={resetPlayerSettings}
              className="flex h-6 items-center gap-1 border border-os-border/25 px-1.5 font-mono text-[7.5px] uppercase tracking-wider text-os-text-muted transition-colors hover:border-os-accent/35 hover:text-os-accent"
            >
              <RotateCcw size={9} /> Reset
            </button>
          </div>

          <div className="os-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="music-settings-section">
              <div className="music-settings-section-title">Output</div>
              <label className="music-settings-range-row">
                <span className="flex items-center justify-between">
                  <span>Music volume</span>
                  <span className="font-mono text-[8px] text-os-accent">
                    {muted ? 'MUTED' : `${Math.round(volume * 100)}%`}
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(volume * 100)}
                  onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${volume * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                  aria-label="Music player volume"
                />
              </label>

              <button onClick={toggleMute} className="music-settings-option" aria-pressed={muted}>
                <span>Mute music output</span>
                <span className={`music-settings-switch ${muted ? 'is-on' : ''}`}>
                  {muted ? 'ON' : 'OFF'}
                </span>
              </button>

              <label className="music-settings-range-row">
                <span className="flex items-center justify-between">
                  <span>Playback speed</span>
                  <span className="font-mono text-[8px] text-os-accent">
                    {playerSettings.playbackRate.toFixed(2)}×
                  </span>
                </span>
                <input
                  type="range"
                  min="50"
                  max="200"
                  step="5"
                  value={playerSettings.playbackRate * 100}
                  onChange={(event) =>
                    updatePlayerSetting('playbackRate', Number(event.target.value) / 100)
                  }
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${((playerSettings.playbackRate - 0.5) / 1.5) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                  aria-label="Playback speed"
                />
              </label>
            </div>

            <div className="music-settings-section">
              <div className="music-settings-section-title">Playback</div>
              <button
                onClick={() => setShuffle((current) => !current)}
                className="music-settings-option"
                aria-pressed={shuffle}
              >
                <span>Shuffle queue</span>
                <span className={`music-settings-switch ${shuffle ? 'is-on' : ''}`}>
                  {shuffle ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                onClick={() => updatePlayerSetting('autoAdvance', !playerSettings.autoAdvance)}
                className="music-settings-option"
                aria-pressed={playerSettings.autoAdvance}
              >
                <span>Auto-advance queue</span>
                <span
                  className={`music-settings-switch ${playerSettings.autoAdvance ? 'is-on' : ''}`}
                >
                  {playerSettings.autoAdvance ? 'ON' : 'OFF'}
                </span>
              </button>
              <div className="p-2.5">
                <div className="mb-2 text-[9px] text-os-text-muted">Repeat mode</div>
                <div className="grid grid-cols-3 border border-os-border/20">
                  {(['off', 'all', 'one'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setRepeat(mode)}
                      className={`h-7 border-r border-os-border/20 font-mono text-[7.5px] uppercase tracking-wider last:border-r-0 ${repeat === mode ? 'bg-os-accent/10 text-os-accent' : 'text-os-text-dim hover:bg-os-surface/25 hover:text-os-text-muted'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="music-settings-section">
              <div className="music-settings-section-title">Appearance</div>
              <label className="music-settings-range-row">
                <span className="flex items-center justify-between">
                  <span>Panel transparency</span>
                  <span className="font-mono text-[8px] text-os-accent">
                    {playerSettings.transparency}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="70"
                  value={playerSettings.transparency}
                  onChange={(event) =>
                    updatePlayerSetting('transparency', Number(event.target.value))
                  }
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${(playerSettings.transparency / 70) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                  aria-label="Music player transparency"
                />
              </label>
              <label className="music-settings-range-row">
                <span className="flex items-center justify-between">
                  <span>Backdrop blur</span>
                  <span className="font-mono text-[8px] text-os-accent">
                    {playerSettings.blur}px
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="36"
                  value={playerSettings.blur}
                  onChange={(event) => updatePlayerSetting('blur', Number(event.target.value))}
                  className="os-range"
                  style={{
                    background: `linear-gradient(90deg, var(--color-os-accent) ${(playerSettings.blur / 36) * 100}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
                  }}
                  aria-label="Music player backdrop blur"
                />
              </label>
              <button
                onClick={() => updatePlayerSetting('atmosphere', !playerSettings.atmosphere)}
                className="music-settings-option"
                aria-pressed={playerSettings.atmosphere}
              >
                <span>Artwork atmosphere</span>
                <span
                  className={`music-settings-switch ${playerSettings.atmosphere ? 'is-on' : ''}`}
                >
                  {playerSettings.atmosphere ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                onClick={() => updatePlayerSetting('motion', !playerSettings.motion)}
                className="music-settings-option"
                aria-pressed={playerSettings.motion}
              >
                <span>Player motion</span>
                <span className={`music-settings-switch ${playerSettings.motion ? 'is-on' : ''}`}>
                  {playerSettings.motion ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>

            <div className="music-settings-section">
              <div className="music-settings-section-title">Default workspace</div>
              <div className="grid grid-cols-3">
                {(['now', 'queue', 'lyrics'] as const).map((nextPane) => (
                  <button
                    key={nextPane}
                    onClick={() => setPane(nextPane)}
                    className={`h-8 border-r border-os-border/20 font-mono text-[7.5px] uppercase tracking-wider last:border-r-0 ${pane === nextPane ? 'bg-os-accent/10 text-os-accent' : 'text-os-text-dim hover:bg-os-surface/25 hover:text-os-text-muted'}`}
                  >
                    {nextPane}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="relative px-3">
        <div
          className={`music-artwork relative cursor-pointer overflow-hidden border border-white/[0.08] shadow-[0_18px_40px_rgba(0,0,0,0.55)] ${playing ? 'is-playing' : 'is-paused'}`}
          onClick={togglePlayback}
          onWheel={changeVolumeWithWheel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              togglePlayback();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}. Scroll to adjust volume.`}
          title="Click to play or pause · Scroll to adjust volume"
        >
          <img
            src={track.cover}
            alt={`${track.album} cover`}
            className="aspect-square w-full object-cover transition-[filter,transform] duration-300"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent" />
          <div
            className={`absolute bottom-2 right-2 flex h-5 items-end gap-[2px] ${playing ? 'eq-playing' : 'eq-paused'}`}
          >
            {[0.2, 0.45, 0.15, 0.6, 0.3, 0.5, 0.22].map((delay, index) => (
              <span
                key={index}
                className="vis-bar w-[2px] bg-[#6ec8d4]"
                style={{
                  height: 12,
                  animationDelay: `${delay}s`,
                  animationDuration: `${0.8 + delay}s`,
                }}
              />
            ))}
          </div>

          <div className="music-artwork-controls pointer-events-none absolute inset-0 z-10">
            <div className="music-artwork-hover-playback absolute inset-0 flex items-center justify-center gap-3">
              <div
                className="music-artwork-control-strip pointer-events-auto flex items-center gap-0.5 rounded-full p-1"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="music-artwork-control"
                  onClick={prevTrack}
                  aria-label="Previous track"
                >
                  <SkipBack size={13} fill="currentColor" />
                </button>
                <button
                  className="music-artwork-control primary"
                  onClick={togglePlayback}
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  {playing ? (
                    <Pause size={14} fill="currentColor" />
                  ) : (
                    <Play size={14} fill="currentColor" className="ml-0.5" />
                  )}
                </button>
                <button
                  className="music-artwork-control"
                  onClick={() => nextTrack()}
                  aria-label="Next track"
                >
                  <SkipForward size={13} fill="currentColor" />
                </button>
              </div>
            </div>

            <div className="music-artwork-link-actions pointer-events-auto absolute left-2 top-2 flex items-center gap-1">
              <button
                className="music-artwork-tiny-action"
                onClick={(event) => {
                  event.stopPropagation();
                  downloadTrack();
                }}
                aria-label="Download track"
                title="Download"
              >
                <Download size={10} />
              </button>
              <button
                className="music-artwork-tiny-action"
                onClick={(event) => {
                  event.stopPropagation();
                  copyTrackLink();
                }}
                aria-label="Copy track link"
                title="Copy link"
              >
                <Link2 size={10} />
              </button>
            </div>

            <button
              className={`music-artwork-volume pointer-events-auto absolute right-2 top-2 flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[8px] font-medium tracking-[0.08em] ${showVolumeOverlay ? 'is-adjusting' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleMute();
              }}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? <VolumeX size={11} /> : <Volume2 size={11} />}
              <span>{muted ? 'Muted' : `${Math.round(volume * 100)}%`}</span>
            </button>

            <div className="music-artwork-studio pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[#8ecbd5]">
              <MonitorSpeaker size={11} />
              <span>Studio</span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative px-3 pt-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium tracking-wide text-[#e8eef4]">
              {track.title}
            </div>
            <div className="truncate text-[11px] text-[#8aa0b2]">{track.artist}</div>
          </div>
          <button
            onClick={() => setLiked((current) => ({ ...current, [track.id]: !current[track.id] }))}
            className={`mt-0.5 ${liked[track.id] ? 'text-[#4aa3ff]' : 'text-[#4a5c6c] hover:text-[#c5d2de]'}`}
            aria-label="Like track"
          >
            <Heart size={13} fill={liked[track.id] ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[8px] text-[#5a6d7c]">
          <span>{track.year}</span>
          <label className="flex items-center gap-1.5 text-[7.5px] uppercase tracking-[0.1em] text-os-text-dim">
            <span>Playback</span>
            <select
              value={playerSettings.playbackRate}
              onChange={(event) => updatePlayerSetting('playbackRate', Number(event.target.value))}
              className="h-5 border border-white/[0.07] bg-black/20 px-1 font-mono text-[8px] text-os-accent outline-none hover:border-os-accent/25"
              aria-label="Playback speed"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate.toFixed(2)}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="relative px-3 pt-2.5">
        <input
          type="range"
          min={0}
          max={duration || 1}
          value={Math.min(progress, duration || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          className="seek"
          style={{
            background: `linear-gradient(90deg, var(--color-os-accent) ${pct}%, color-mix(in srgb, var(--color-os-text) 8%, transparent) 0%)`,
          }}
          aria-label="Track position"
        />
        <div className="mt-1 flex justify-between font-mono text-[8px] text-[#5a6d7c]">
          <span>{fmtTime(progress)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="relative flex items-center justify-center gap-4 px-3 pt-1.5">
        <button
          onClick={() => setShuffle((current) => !current)}
          className={shuffle ? 'text-[#4aa3ff]' : 'text-[#4a5c6c] hover:text-[#c5d2de]'}
          aria-label="Shuffle"
        >
          <Shuffle size={13} />
        </button>
        <button
          onClick={prevTrack}
          className="text-[#b7c8d6] hover:text-white"
          aria-label="Previous track"
        >
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button
          onClick={togglePlayback}
          className="music-play-btn"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" className="ml-0.5" />
          )}
        </button>
        <button
          onClick={() => nextTrack()}
          className="text-[#b7c8d6] hover:text-white"
          aria-label="Next track"
        >
          <SkipForward size={16} fill="currentColor" />
        </button>
        <button
          onClick={() =>
            setRepeat((current) => (current === 'off' ? 'all' : current === 'all' ? 'one' : 'off'))
          }
          className={repeat === 'off' ? 'text-[#4a5c6c] hover:text-[#c5d2de]' : 'text-[#4aa3ff]'}
          aria-label={`Repeat ${repeat}`}
        >
          {repeat === 'one' ? <Repeat1 size={13} /> : <Repeat size={13} />}
        </button>
      </div>

      <div className="relative mx-3 mt-2 flex border-y border-white/[0.06] bg-white/[0.015]">
        {(
          [
            ['now', 'Now'],
            ['queue', 'Queue'],
            ['lyrics', 'Lyrics'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPane(id)}
            className={`relative flex-1 py-1.5 font-mono text-[8px] uppercase tracking-[0.18em] transition-colors ${pane === id ? 'text-[#d5e4f0]' : 'text-[#4a5c6c] hover:text-[#8aa0b2]'}`}
          >
            {label}
            {pane === id && (
              <span className="absolute inset-x-3 bottom-0 h-px bg-[#4aa3ff] shadow-[0_0_8px_rgba(74,163,255,0.5)]" />
            )}
          </button>
        ))}
      </div>

      <div className="relative mx-3 mt-2.5 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="os-scrollbar relative min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1.5">
        {pane === 'now' && (
          <div>
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5a6d7c]">
                Up next
              </span>
              <span className="font-mono text-[8px] text-[#3d4c5a]">private collection</span>
            </div>
            {TRACKS.map((item, index) => (
              <button
                key={item.id}
                onClick={() => playAt(index)}
                className={`row-hover mb-px flex w-full items-center gap-2 px-1 py-1.5 text-left ${index === trackIndex ? 'bg-white/[0.04]' : ''}`}
              >
                <img src={item.cover} alt="" className="h-8 w-8 object-cover" />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[11px] ${index === trackIndex ? 'text-[#e8eef4]' : 'text-[#c5d2de]'}`}
                  >
                    {item.title}
                  </span>
                  <span className="block truncate font-mono text-[8px] text-[#5a6d7c]">
                    {item.artist}
                  </span>
                </span>
                <span className="font-mono text-[8px] text-[#4a5c6c]">
                  {trackDurations[item.id] ? fmtTime(trackDurations[item.id]) : '—:——'}
                </span>
              </button>
            ))}
          </div>
        )}
        {pane === 'queue' && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 px-1">
              <ListMusic size={10} className="text-[#6d8294]" />
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5a6d7c]">
                Queue · Nammu collection
              </span>
            </div>
            {TRACKS.map((item, index) => (
              <button
                key={item.id}
                onClick={() => playAt(index)}
                className="row-hover flex w-full items-center gap-2 px-1 py-1.5 text-left"
              >
                <span className="w-3 font-mono text-[8px] text-[#3d4c5a]">{index + 1}</span>
                <img src={item.cover} alt="" className="h-7 w-7 object-cover" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#c5d2de]">
                  {item.title}
                </span>
                {index === trackIndex && (
                  <span className="status-dot bg-[#4aa3ff]" style={{ color: '#4aa3ff' }} />
                )}
              </button>
            ))}
          </div>
        )}
        {pane === 'lyrics' && (
          <div className="px-1">
            <div className="mb-2 flex items-center gap-1.5">
              <Mic2 size={10} className="text-[#6d8294]" />
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5a6d7c]">
                Lyrics
              </span>
            </div>
            <p className="text-[12px] leading-snug text-[#6d8294]">
              Lyrics are not available for this stream.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
