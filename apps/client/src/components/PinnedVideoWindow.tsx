import { useEffect, useRef, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { PlayPauseIcon, VolumeIcon } from './PlayerIcons';

// The pinned video card mirrors the pinned image card: position is stored as a
// fraction of the viewport so it stays in the same relative spot on resize.
// Each card keeps its own localStorage entry keyed by its unique card id.
function posKey(cardId: string) {
  return `notoc.pinned-video-pos.${cardId}`;
}

function sizeKey(cardId: string) {
  return `notoc.pinned-video-size.${cardId}`;
}

// HH:MM style elapsed/total label for the pinned video timeline.
function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function loadRelativePosition(cardId: string): { x: number; y: number } {
  try {
    const saved = localStorage.getItem(posKey(cardId));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.relX === 'number' && typeof parsed.relY === 'number') {
        return { x: parsed.relX * window.innerWidth, y: parsed.relY * window.innerHeight };
      }
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {}
  return { x: 24, y: 72 };
}

function saveRelativePosition(cardId: string, pos: { x: number; y: number }) {
  localStorage.setItem(
    posKey(cardId),
    JSON.stringify({ relX: pos.x / Math.max(1, window.innerWidth), relY: pos.y / Math.max(1, window.innerHeight) })
  );
}

export type PinnedVideoPlacement = { x: number; y: number; width: number; height: number };

type PinnedVideoCardProps = {
  cardId: string;
  language: Language;
  videoUrl: string;
  videoName: string;
  onClose?: (cardId: string) => void;
  readOnly?: boolean;
  initialPlacement?: PinnedVideoPlacement | null;
  onMove?: (cardId: string, placement: PinnedVideoPlacement) => void;
  onMoveEnd?: (cardId: string, placement: PinnedVideoPlacement) => void;
};

// A base64 data URL forces the browser to keep/parse a huge string for the
// <video> element, which lags the whole app. Convert it once to a Blob object
// URL so the video streams from memory instead of an inline data URL.
function dataUrlToObjectUrl(dataUrl: string): string | null {
  try {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) return null;
    const header = dataUrl.slice(5, commaIndex);
    const isBase64 = header.endsWith(';base64');
    const mime = header.replace(';base64', '') || 'video/mp4';
    const dataPart = dataUrl.slice(commaIndex + 1);
    if (!isBase64) return dataUrl;
    const binary = atob(dataPart);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return dataUrl;
  }
}

export function PinnedVideoCard({ cardId, language, videoUrl, videoName, onClose, readOnly = false, initialPlacement = null, onMove, onMoveEnd }: PinnedVideoCardProps) {
  const [minimized, setMinimized] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [showVolume, setShowVolume] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Resolve the playable source once (Blob URL for data URLs) and revoke it on
  // unmount / when the source changes to free memory.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    const resolved = dataUrlToObjectUrl(videoUrl);
    setObjectUrl(resolved);
    return () => {
      if (resolved && resolved.startsWith('blob:')) URL.revokeObjectURL(resolved);
    };
  }, [videoUrl]);

  // Keep the <video> element's volume/mute in sync with the controls.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, objectUrl]);
  const [position, setPosition] = useState(() => {
    const loaded = initialPlacement
      ? { x: initialPlacement.x * window.innerWidth, y: initialPlacement.y * window.innerHeight }
      : loadRelativePosition(cardId);
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - 240;
    return {
      x: Math.min(Math.max(0, loaded.x), maxX),
      y: Math.min(Math.max(0, loaded.y), maxY)
    };
  });
  const [size, setSize] = useState(() => {
    if (initialPlacement) return { width: initialPlacement.width, height: initialPlacement.height };
    try {
      const saved = localStorage.getItem(sizeKey(cardId));
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed;
      }
    } catch {}
    return { width: 240, height: 160 };
  });
  const posRef = useRef(position);
  const sizeRef = useRef(size);
  const onMoveRef = useRef(onMove);
  const onMoveEndRef = useRef(onMoveEnd);

  posRef.current = position;
  sizeRef.current = size;
  onMoveRef.current = onMove;
  onMoveEndRef.current = onMoveEnd;

  const clampedPosition = {
    x: Math.min(Math.max(0, position.x), window.innerWidth - 220),
    y: Math.min(Math.max(0, position.y), window.innerHeight - 240)
  };

  function toPlacement(pos: { x: number; y: number }, dims: { width: number; height: number }): PinnedVideoPlacement {
    return {
      x: pos.x / Math.max(1, window.innerWidth),
      y: pos.y / Math.max(1, window.innerHeight),
      width: dims.width,
      height: dims.height
    };
  }

  function startDrag(event: React.MouseEvent) {
    if (readOnly) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    const base = posRef.current;
    function move(event: MouseEvent) {
      const next = { x: Math.max(0, base.x + event.clientX - startX), y: Math.max(0, base.y + event.clientY - startY) };
      setPosition(next);
      onMoveRef.current?.(cardId, toPlacement(next, sizeRef.current));
    }
    function up() {
      saveRelativePosition(cardId, posRef.current);
      onMoveEndRef.current?.(cardId, toPlacement(posRef.current, sizeRef.current));
      window.removeEventListener('mousemove', move);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
  }

  useEffect(() => {
    if (readOnly) return;
    function handleResize() {
      const loaded = loadRelativePosition(cardId);
      const next = {
        x: Math.min(Math.max(0, loaded.x), window.innerWidth - 220),
        y: Math.min(Math.max(0, loaded.y), window.innerHeight - 240)
      };
      setPosition(next);
      onMoveRef.current?.(cardId, toPlacement(next, sizeRef.current));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [cardId, readOnly]);

  function startResize(event: React.MouseEvent) {
    if (readOnly) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const base = sizeRef.current;
    function move(event: MouseEvent) {
      const next = { width: Math.max(140, base.width + event.clientX - startX), height: Math.max(90, base.height + event.clientY - startY) };
      setSize(next);
      onMoveRef.current?.(cardId, toPlacement(posRef.current, next));
    }
    function up() {
      localStorage.setItem(sizeKey(cardId), JSON.stringify(sizeRef.current));
      onMoveEndRef.current?.(cardId, toPlacement(posRef.current, sizeRef.current));
      window.removeEventListener('mousemove', move);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else {
      video.pause();
      setPlaying(false);
    }
  }

  function seek(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setTime(value);
  }

  return (
    <div className={readOnly ? 'pinned-image-card pinned-image-card--remote' : 'pinned-image-card'} style={{ left: clampedPosition.x, top: clampedPosition.y, width: size.width }} onContextMenu={(event) => event.stopPropagation()}>
      <div className="pinned-image-bar" onMouseDown={readOnly ? undefined : startDrag} style={readOnly ? { cursor: 'default' } : undefined}>
        <div
          className="pinned-video-volume-wrap"
          onMouseDown={(event) => event.stopPropagation()}
          onMouseEnter={() => setShowVolume(true)}
          onMouseLeave={() => setShowVolume(false)}
        >
          <button
            className="pinned-image-toggle"
            type="button"
            aria-label={t(language, 'volume')}
            onClick={() => setMuted((v) => !v)}
          >
            <VolumeIcon muted={muted || volume === 0} size={16} />
          </button>
          {showVolume ? (
            <input
              className="pinned-video-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                setMuted(next === 0);
              }}
            />
          ) : null}
        </div>
        <button className="pinned-image-toggle" type="button" onClick={() => setMinimized((v) => !v)}>
          {minimized ? '\u25A1' : '_'}
        </button>
        {onClose ? <button className="pinned-image-card-close" type="button" aria-label={t(language, 'close')} onClick={() => onClose(cardId)}>x</button> : null}
      </div>
      {!minimized ? (
        <div className="pinned-image-card-img pinned-video-card-body" style={{ height: size.height }}>
          {objectUrl ? (
            <video ref={videoRef} src={objectUrl} title={videoName} playsInline preload="metadata" onClick={togglePlay} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)} onEnded={() => setPlaying(false)} />
          ) : null}
          <button className="pinned-video-play" type="button" aria-label={t(language, 'playPause')} onClick={togglePlay}>
            <PlayPauseIcon playing={playing} />
          </button>
          <div className="pinned-video-timeline" onMouseDown={(event) => event.stopPropagation()}>
            <span className="pinned-video-time">{formatTime(time)}</span>
            <input
              className="pinned-video-seek"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(time, duration || 0)}
              disabled={!duration}
              aria-label={t(language, 'playPause')}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="pinned-video-time">{formatTime(duration)}</span>
          </div>
        </div>
      ) : null}
      {!readOnly ? <span className="pinned-image-resize" onMouseDown={startResize} /> : null}
    </div>
  );
}
