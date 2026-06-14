import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Language, StorageItem } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';
import { PlayPauseIcon, PrevTrackIcon, NextTrackIcon } from './PlayerIcons';

type MusicPlayerWindowProps = {
  language: Language;
  tracks: StorageItem[];
  initialTrackId: string | null;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onPlayStart: () => void;
  onRefresh: () => Promise<void>;
};

const VISUALIZER_BARS = Array.from({ length: 40 }, (_, index) => index);

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function MusicPlayerWindow({
  language,
  tracks,
  initialTrackId,
  minimized,
  maximized,
  zIndex,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onPlayStart,
  onRefresh
}: MusicPlayerWindowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animationRef = useRef<number | null>(null);
  const visualPeakRef = useRef(0.34);
  const barElementsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const visualizerRef = useRef<HTMLElement | null>(null);
  const onPlayStartRef = useRef(onPlayStart);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(initialTrackId ?? tracks[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.62);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const currentTrack = useMemo(() => tracks.find((track) => track.id === currentTrackId) ?? null, [currentTrackId, tracks]);
  const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === currentTrackId));

  useEffect(() => {
    onPlayStartRef.current = onPlayStart;
  }, [onPlayStart]);

  useEffect(() => {
    if (initialTrackId) {
      setCurrentTrackId(initialTrackId);
      setPlaying(true);
    }
  }, [initialTrackId]);

  useEffect(() => {
    if (!tracks.length) {
      setCurrentTrackId(null);
      setPlaying(false);
      return;
    }

    if (!currentTrackId || !tracks.some((track) => track.id === currentTrackId)) {
      setCurrentTrackId(tracks[0].id);
    }
  }, [currentTrackId, tracks]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.content) return;
    if (audio.getAttribute('src') === currentTrack.content) return;
    audio.src = currentTrack.content;
    setTime(0);
    setDuration(0);
  }, [currentTrack?.content]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing && currentTrack?.content) {
      onPlayStartRef.current();
      ensureAnalyser();
      void audio.play().catch(() => setPlaying(false));
      return;
    }
    audio.pause();
  }, [currentTrack?.content, playing]);

  useEffect(() => {
    if (!playing) {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      return;
    }

    const analyser = ensureAnalyser();
    const frequencyData = frequencyDataRef.current;
    if (!analyser || !frequencyData) return;
    const activeAnalyser = analyser;
    const activeFrequencyData = frequencyData;
    const bars = barElementsRef.current;
    const vis = visualizerRef.current;

    const BIN_COUNT = activeFrequencyData.length;
    const MIN_BIN = 0;
    const MAX_BIN = BIN_COUNT - 1;
    const LOG_BASE = Math.log(MAX_BIN - MIN_BIN + 1) / VISUALIZER_BARS.length;

    function getBinRange(index: number): [number, number] {
      const low = Math.round(Math.exp(LOG_BASE * index) - 1 + MIN_BIN);
      const high = Math.round(Math.exp(LOG_BASE * (index + 1)) - 1 + MIN_BIN);
      return [low, Math.min(high, MAX_BIN)];
    }

    function updateLevels() {
      activeAnalyser.getByteFrequencyData(activeFrequencyData);
      const rawLevels: number[] = [];
      for (let index = 0; index < VISUALIZER_BARS.length; index++) {
        const [start, end] = getBinRange(index);
        let sum = 0;
        for (let cursor = start; cursor <= end; cursor += 1) sum += activeFrequencyData[cursor] ?? 0;
        rawLevels.push(sum / Math.max(1, end - start + 1) / 255);
      }
      const framePeak = Math.max(...rawLevels, 0);
      const frameAverage = rawLevels.reduce((s, v) => s + v, 0) / rawLevels.length;
      const isSilent = framePeak < 0.015 && Boolean(audioRef.current && !audioRef.current.paused);

      let nextLevels: number[];
      if (isSilent) {
        const now = performance.now() / 260;
        nextLevels = VISUALIZER_BARS.map((_, index) => {
          const wave = Math.sin(now + index * 0.62) * 0.5 + 0.5;
          const pulse = Math.sin(now * 0.72 + index * 0.18) * 0.5 + 0.5;
          return 0.12 + wave * 0.34 + pulse * 0.12;
        });
        const fallbackE = nextLevels.reduce((s, v) => s + v, 0) / nextLevels.length;
        if (vis) vis.style.setProperty('--energy', String(Math.min(0.7, fallbackE)));
      } else {
        const targetPeak = Math.max(0.24, framePeak, frameAverage * 2.2);
        const peakSpeed = targetPeak > visualPeakRef.current ? 0.32 : 0.045;
        visualPeakRef.current += (targetPeak - visualPeakRef.current) * peakSpeed;
        const ceiling = Math.max(0.24, framePeak * 1.14, visualPeakRef.current * 1.28);
        nextLevels = rawLevels.map((raw) => {
          const normalized = Math.min(1, raw / ceiling);
          return Math.max(0.08, Math.min(0.92, Math.pow(normalized, 0.72) * 0.9));
        });
        if (vis) vis.style.setProperty('--energy', String(Math.max(0.16, Math.min(0.82, frameAverage))));
      }

      for (let i = 0; i < VISUALIZER_BARS.length; i++) {
        const el = bars[i];
        if (el) el.style.height = `${22 + nextLevels[i] * 260}px`;
      }

      animationRef.current = window.requestAnimationFrame(updateLevels);
    }

    updateLevels();
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [playing, currentTrackId]);

  function previousTrack() {
    if (!tracks.length) return;
    const index = currentIndex < 0 ? 0 : currentIndex;
    setCurrentTrackId(tracks[(index - 1 + tracks.length) % tracks.length].id);
    setPlaying(true);
  }

  function nextTrack() {
    if (!tracks.length) return;
    const index = currentIndex < 0 ? 0 : currentIndex;
    setCurrentTrackId(tracks[(index + 1) % tracks.length].id);
    setPlaying(true);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setTime(value);
  }

  function ensureAnalyser() {
    const audio = audioRef.current;
    if (!audio) return null;

    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    if (!audioContextRef.current) audioContextRef.current = new AudioContextCtor();
    if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume();

    if (!analyserRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.64;
      frequencyDataRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
    }

    if (!sourceRef.current) {
      try {
        sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      } catch {
        // already connected, ignore
      }
    }

    return analyserRef.current;
  }

  async function refreshTracks() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <WindowFrame
      language={language}
      title={t(language, 'musicPlayer')}
      eyebrow={t(language, 'music')}
      className="music-player-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 460), y: 76 }}
      minSize={{ width: 700, height: 560 }}
      storageKey="music-player"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="music-player-shell">
        <aside className="music-library-panel">
          <header>
            <div>
              <p className="eyebrow">{t(language, 'playlist')}</p>
              <strong>{tracks.length}</strong>
            </div>
            <button className="secondary-action compact-action" type="button" disabled={refreshing} onClick={() => void refreshTracks()}>
              {t(language, 'openStorage')}
            </button>
          </header>
          <div className="music-track-list">
            {tracks.length === 0 ? <div className="explorer-empty">{t(language, 'noAudioFiles')}</div> : null}
            {tracks.map((track) => (
              <button className={track.id === currentTrackId ? 'music-track-row active' : 'music-track-row'} key={track.id} type="button" onClick={() => {
                setCurrentTrackId(track.id);
                setPlaying(true);
              }}>
                <span>MP</span>
                <strong>{track.name}</strong>
                <small>{Math.ceil((track.size ?? 0) / 1024)} KB</small>
              </button>
            ))}
          </div>
        </aside>

        <section ref={visualizerRef as React.Ref<HTMLElement>} className={playing ? 'music-visualizer playing' : 'music-visualizer'} style={{ '--energy': 0.24 } as CSSProperties}>
          <div className="visualizer-orbit one" />
          <div className="visualizer-orbit two" />
          <div className="visualizer-core">
            {VISUALIZER_BARS.map((bar) => (
              <span key={bar} ref={(el) => { barElementsRef.current[bar] = el; }} style={{ '--bar-index': bar, height: '27px' } as CSSProperties} />
            ))}
          </div>
          <div className="visualizer-title">
            <p>{currentTrack?.name ?? t(language, 'music')}</p>
            <small>{playing ? t(language, 'nowPlaying') : t(language, 'playPause')}</small>
          </div>
        </section>

        <footer className="music-control-deck">
          <audio
            ref={audioRef}
            onEnded={nextTrack}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          />
          <button className="player-button" type="button" aria-label={t(language, 'previousTrack')} disabled={!tracks.length} onClick={previousTrack}>
            <PrevTrackIcon />
          </button>
          <button className="player-button main" type="button" aria-label={t(language, 'playPause')} disabled={!tracks.length} onClick={() => setPlaying((value) => !value)}>
            <PlayPauseIcon playing={playing} />
          </button>
          <button className="player-button" type="button" aria-label={t(language, 'nextTrack')} disabled={!tracks.length} onClick={nextTrack}>
            <NextTrackIcon />
          </button>
          <div className="music-player-progress">
            <span>{formatPlaybackTime(time)}</span>
            <input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(time, duration || 0)} disabled={!tracks.length || !duration} onChange={(event) => seek(Number(event.target.value))} />
            <span>{formatPlaybackTime(duration)}</span>
          </div>
          <input className="music-player-volume" type="range" min="0" max="1" step="0.01" value={volume} aria-label={t(language, 'volume')} onChange={(event) => setVolume(Number(event.target.value))} />
        </footer>
      </div>
    </WindowFrame>
  );
}
