import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { io } from 'socket.io-client';
import { API_URL, api } from '../api/client';
import type { Language, PublicAudioTrack, PublicUser, Theme } from '../api/types';
import { LOCALES, t } from '../i18n';
import { useClock } from '../hooks/use-clock';
import { DesktopWall } from './DesktopWall';
import { PinnedImageCard } from './PinnedImageWindow';
import { PinnedVideoCard } from './PinnedVideoWindow';
import { WindowFrame } from './WindowFrame';
import { PlayPauseIcon, PrevTrackIcon, NextTrackIcon } from './PlayerIcons';

type RemoteDesktopWindowProps = {
  token: string;
  language: Language;
  owner: PublicUser;
  currentUser: PublicUser;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
};

const LIGHT_WALLPAPER = 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
const DARK_WALLPAPER = 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)';

function wallpaperToBackground(value: string, theme: PublicUser['theme']) {
  const isDark = theme === 'dark' || theme === 'system-black';
  if (!value) return isDark ? DARK_WALLPAPER : LIGHT_WALLPAPER;
  if (value.startsWith('data:image/')) return `url("${value}")`;
  return value;
}

function formatUserSince(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value));
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Full per-theme palettes mirroring the global `:root[data-theme=...]` blocks in
// styles.css. The remote window renders inside its own subtree, so the global
// `:root[data-theme]` rules never apply here; we replay the matching palette as
// inline CSS variables so the taskbar and themed elements look exactly like the
// owner's real desktop instead of a light/dark approximation.
const THEME_PALETTES: Record<Theme, Record<string, string>> = {
  light: {
    '--bg': '#edf3f8',
    '--bg-soft': '#f7fafc',
    '--panel': '#ffffff',
    '--panel-strong': '#ffffff',
    '--text': '#17212b',
    '--muted': '#6b7a8a',
    '--line': '#d9e2eb',
    '--line-strong': '#c9d6e2',
    '--desktop-overlay': 'rgba(0, 0, 0, 0.05)'
  },
  dark: {
    '--bg': '#0f1722',
    '--bg-soft': '#151f2c',
    '--panel': '#172231',
    '--panel-strong': '#1d2a3a',
    '--text': '#edf5fc',
    '--muted': '#91a3b5',
    '--line': '#2a3a4d',
    '--line-strong': '#3a4d62',
    '--desktop-overlay': 'rgba(5, 9, 14, 0.2)'
  },
  'system-black': {
    '--bg': '#000000',
    '--bg-soft': '#0a0a0a',
    '--panel': '#0d0d0d',
    '--panel-strong': '#121212',
    '--text': '#ffffff',
    '--muted': '#888888',
    '--line': '#222222',
    '--line-strong': '#333333',
    '--desktop-overlay': 'rgba(0, 0, 0, 0.3)'
  },
  mint: {
    '--bg': '#eafaf1',
    '--bg-soft': '#f0fdf6',
    '--panel': '#f5fdf9',
    '--panel-strong': '#ffffff',
    '--text': '#1a3b2f',
    '--muted': '#5a8a76',
    '--line': '#b8dac8',
    '--line-strong': '#8cbda4',
    '--desktop-overlay': 'rgba(0, 0, 0, 0.05)'
  },
  ocean: {
    '--bg': '#eef5fb',
    '--bg-soft': '#f4f9fe',
    '--panel': '#f8fbfe',
    '--panel-strong': '#ffffff',
    '--text': '#1a2b4a',
    '--muted': '#5a7a9a',
    '--line': '#b8cfe0',
    '--line-strong': '#8aadc8',
    '--desktop-overlay': 'rgba(0, 0, 0, 0.05)'
  }
};

function remoteThemeStyle(owner: PublicUser): CSSProperties {
  const palette = THEME_PALETTES[owner.theme] ?? THEME_PALETTES.light;
  return {
    ...palette,
    // The owner's accent color still overrides the theme's default blue.
    '--blue': owner.accentColor,
    '--blue-dark': owner.accentColor
  } as CSSProperties;
}

export function RemoteDesktopWindow({ token, language, owner: initialOwner, currentUser, minimized, maximized, zIndex, onFocus, onClose, onMinimize, onToggleMaximize }: RemoteDesktopWindowProps) {
  const [owner, setOwner] = useState(initialOwner);
  const clock = useClock(language, '24h');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<PublicAudioTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.55);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const currentTrack = tracks[currentTrackIndex];
  // Live positions/sizes for each remote pinned card, keyed by card id. Falls
  // back to each card's persisted placement until a live update arrives.
  const [remoteCardPlacements, setRemoteCardPlacements] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { nickname: string; x: number; y: number }>>({});
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const remoteSocketRef = useRef<ReturnType<typeof io> | null>(null);
  const cursorEmitRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [ownerScreen, setOwnerScreen] = useState<{ width: number; height: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => { setOwner(initialOwner); }, [initialOwner]);

  useEffect(() => {
    let alive = true;
    function loadTracks() {
      return api.getPublicAudio(token, initialOwner.id).then((payload) => {
      if (!alive) return;
      setTracks(payload.tracks);
      setCurrentTrackIndex(0);
      setPlaying(false);
    });
    }

    void loadTracks();
    const socket = io(API_URL, { auth: { token } });
    remoteSocketRef.current = socket;

    socket.on('system:ready', () => {
      socket.emit('desktop:watch', { ownerId: initialOwner.id });
    });

    socket.on('desktop:screen', (payload: { ownerId: string; width: number; height: number }) => {
      if (payload.ownerId !== initialOwner.id) return;
      setOwnerScreen({ width: payload.width, height: payload.height });
    });

    socket.on('desktop:pinnedCards', (payload: { ownerId: string; cards: { id: string; x: number; y: number; width: number; height: number }[] }) => {
      if (payload.ownerId !== initialOwner.id || !Array.isArray(payload.cards)) return;
      const placements: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const card of payload.cards) {
        placements[card.id] = { x: card.x, y: card.y, width: card.width, height: card.height };
      }
      setRemoteCardPlacements(placements);
    });

    socket.on('desktop:cursor', (payload: { ownerId: string; userId: string; nickname: string; x: number; y: number }) => {
      if (payload.ownerId !== initialOwner.id || payload.userId === currentUser.id) return;
      setRemoteCursors((current) => ({ ...current, [payload.userId]: { nickname: payload.nickname, x: payload.x, y: payload.y } }));
    });

    socket.on('desktop:cursorLeave', (payload: { ownerId: string; userId: string }) => {
      if (payload.ownerId !== initialOwner.id) return;
      setRemoteCursors((current) => {
        if (!(payload.userId in current)) return current;
        const next = { ...current };
        delete next[payload.userId];
        return next;
      });
    });

    socket.on('storage:publicChanged', (payload: { userId: string }) => {
      if (payload.userId === initialOwner.id) void loadTracks();
    });

    socket.on('desktop:userChanged', (payload: { user: PublicUser }) => {
      if (payload.user.id === initialOwner.id) {
        // Sync the owner's pinned cards so add/remove is reflected live.
        setOwner((current) => ({ ...current, pinnedCards: Array.isArray(payload.user.pinnedCards) ? payload.user.pinnedCards : [] }));
      }
    });

    return () => {
      alive = false;
      socket.emit('desktop:unwatch', { ownerId: initialOwner.id });
      remoteSocketRef.current = null;
      socket.disconnect();
    };
  }, [initialOwner.id, token]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.src = currentTrack.dataUrl;
    setTime(0);
    setDuration(0);
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing && currentTrack) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [currentTrack, playing]);

  useEffect(() => {
    if (!minimized) return;
    audioRef.current?.pause();
    setPlaying(false);
  }, [minimized]);

  function previousTrack() {
    setCurrentTrackIndex((index) => (tracks.length ? (index - 1 + tracks.length) % tracks.length : 0));
    setPlaying(true);
  }

  function nextTrack() {
    setCurrentTrackIndex((index) => (tracks.length ? (index + 1) % tracks.length : 0));
    setPlaying(true);
  }

  function togglePlaying() {
    if (!tracks.length) return;
    setPlaying((value) => !value);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setTime(value);
  }

  function handleCanvasMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const now = Date.now();
    if (now - cursorEmitRef.current < 40) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    cursorEmitRef.current = now;
    remoteSocketRef.current?.emit('desktop:cursor', { ownerId: initialOwner.id, x, y });
  }

  const stageBase = ownerScreen ?? { width: 1280, height: 800 };
  const stageScale = canvasSize.width > 0 && canvasSize.height > 0 ? Math.min(canvasSize.width / stageBase.width, canvasSize.height / stageBase.height) : 1;
  const stageLeft = Math.max(0, (canvasSize.width - stageBase.width * stageScale) / 2);
  const stageTop = Math.max(0, (canvasSize.height - stageBase.height * stageScale) / 2);

  return (
    <WindowFrame
      language={language}
      title={t(language, 'remoteDesktopOf', { name: owner.nickname })}
      eyebrow={t(language, 'desktopSnapshot')}
      className="remote-desktop-window"
      style={remoteThemeStyle(owner)}
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(30, window.innerWidth / 2 - 430), y: 84 }}
      minSize={{ width: 720, height: 500 }}
      storageKey="remote-desktop"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="remote-desktop-canvas" ref={canvasRef} data-owner-theme={owner.theme}>
        <div className="remote-desktop-stage" ref={stageRef} onMouseMove={handleCanvasMouseMove} style={{ width: stageBase.width, height: stageBase.height, left: stageLeft, top: stageTop, transform: `scale(${stageScale})`, backgroundImage: wallpaperToBackground(owner.wallpaper, owner.theme) }}>
        {owner.role === 'dev' ? <div className="developer-account-badge remote">{t(language, 'officialDeveloperAccount')}</div> : null}

        {(owner.pinnedCards ?? []).map((card) => {
          const live = remoteCardPlacements[card.id];
          const placement = live ?? { x: card.x, y: card.y, width: card.width, height: card.height };
          if (card.kind === 'video') {
            return (
              <PinnedVideoCard
                key={card.id}
                cardId={card.id}
                language={language}
                videoUrl={card.imageData}
                videoName={card.name}
                readOnly
                initialPlacement={placement}
              />
            );
          }
          return (
            <PinnedImageCard
              key={card.id}
              cardId={card.id}
              language={language}
              imageUrl={card.imageData}
              imageName={card.name}
              readOnly
              overridePosition={{ x: placement.x, y: placement.y }}
              overrideSize={{ width: placement.width, height: placement.height }}
            />
          );
        })}

        {Object.entries(remoteCursors).map(([cursorUserId, cursor]) => (
          <div key={cursorUserId} className="remote-cursor remote-cursor--in-canvas" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
            <span className="remote-cursor-name">{cursor.nickname}</span>
            <span className="remote-cursor-pointer" />
          </div>
        ))}

        <DesktopWall
          token={token}
          language={language}
          owner={owner}
          currentUser={currentUser}
          onOpenProfile={(author) => window.dispatchEvent(new CustomEvent('open-profile', { detail: author }))}
        />

        <aside className="remote-desktop-profile-info">
          <strong>{t(language, 'appDesktop', { name: owner.nickname })}</strong>
          <span>{t(language, 'accountSince', { date: formatUserSince(owner.createdAt, language) })}</span>
          <div className="desktop-player remote-player">
            <audio
              ref={audioRef}
              onEnded={nextTrack}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            />
            <button className="player-button" type="button" aria-label={t(language, 'previousTrack')} disabled={!tracks.length} onClick={previousTrack}>
              <PrevTrackIcon />
            </button>
            <button className="player-button main" type="button" aria-label={t(language, 'playPause')} disabled={!tracks.length} onClick={togglePlaying}>
              <PlayPauseIcon playing={playing} />
            </button>
            <button className="player-button" type="button" aria-label={t(language, 'nextTrack')} disabled={!tracks.length} onClick={nextTrack}>
              <NextTrackIcon />
            </button>
            <span className="player-title" title={currentTrack?.name ?? t(language, 'music')}>
              {currentTrack?.name ?? t(language, 'music')}
            </span>
            <input className="remote-volume" type="range" min="0" max="1" step="0.01" value={volume} aria-label={t(language, 'volume')} onChange={(event) => setVolume(Number(event.target.value))} />
            <div className="player-progress-row">
              <span>{formatPlaybackTime(time)}</span>
              <input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(time, duration || 0)} disabled={!tracks.length || !duration} onChange={(event) => seek(Number(event.target.value))} />
              <span>{formatPlaybackTime(duration)}</span>
            </div>
          </div>
        </aside>

        <footer className="taskbar remote-taskbar">
          <button className="profile-start remote-profile-start" type="button">
            <img src={owner.avatarData} alt="" />
            <span>{owner.nickname}</span>
          </button>
          <div className="taskbar-spacer" />
          <div className="taskbar-clock" aria-label="Time">
            <span>{clock.time}</span>
              <span>{clock.date}</span>
            </div>
        </footer>
        </div>
      </div>
    </WindowFrame>
  );
}
