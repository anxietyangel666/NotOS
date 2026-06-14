import { useEffect, useRef, useState } from 'react';
import type { Language, StorageItem } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';
import { PlayPauseIcon, VolumeIcon } from './PlayerIcons';

type VideoViewerWindowProps = {
  language: Language;
  item: StorageItem;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onPin?: () => void;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Convert a base64 data URL to a Blob object URL so the <video> streams from
// memory instead of holding/parsing a huge inline string (which lags the app).
function dataUrlToObjectUrl(dataUrl: string): string | null {
  try {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) return null;
    const header = dataUrl.slice(5, commaIndex);
    const isBase64 = header.endsWith(';base64');
    const mime = header.replace(';base64', '') || 'video/mp4';
    if (!isBase64) return dataUrl;
    const binary = atob(dataUrl.slice(commaIndex + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return dataUrl;
  }
}

export function VideoViewerWindow({ language, item, minimized, maximized, zIndex, onFocus, onClose, onMinimize, onToggleMaximize, onPin }: VideoViewerWindowProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  // Remember the last audible level so the mute button can restore it.
  const lastVolumeRef = useRef(0.8);

  useEffect(() => {
    const resolved = dataUrlToObjectUrl(item.content ?? '');
    setObjectUrl(resolved);
    return () => {
      if (resolved && resolved.startsWith('blob:')) URL.revokeObjectURL(resolved);
    };
  }, [item.content]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume, objectUrl]);

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

  function changeVolume(value: number) {
    if (value > 0) lastVolumeRef.current = value;
    setVolume(value);
  }

  function toggleMute() {
    if (volume > 0) {
      lastVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(lastVolumeRef.current || 0.8);
    }
  }

  return (
    <WindowFrame
      language={language}
      title={item.name}
      eyebrow={t(language, 'videoViewer')}
      className="image-viewer-window video-viewer-window"
      minimized={minimized}
      maximized={maximized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 380), y: 78 }}
      minSize={{ width: 560, height: 420 }}
      storageKey="video-viewer"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="image-viewer-canvas video-viewer-canvas">
        {item.content ? (
          <div className="image-viewer-img-wrap video-viewer-wrap">
            {onPin ? (
              <button className="image-pin-btn" type="button" title={t(language, 'pinToDesktop')} onClick={onPin}>
                📌
              </button>
            ) : null}
            <video
              ref={videoRef}
              src={objectUrl ?? undefined}
              preload="metadata"
              className="video-viewer-element"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
              onEnded={() => setPlaying(false)}
            />
            <div className="video-viewer-controls">
              <button className="player-button main" type="button" aria-label={t(language, 'playPause')} onClick={togglePlay}>
                <PlayPauseIcon playing={playing} />
              </button>
              <span className="video-viewer-time">{formatTime(time)}</span>
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(time, duration || 0)}
                onChange={(event) => seek(Number(event.target.value))}
                disabled={!duration}
              />
              <span className="video-viewer-time">{formatTime(duration)}</span>
              <button className="player-button" type="button" aria-label={t(language, 'volume')} onClick={toggleMute}>
                <VolumeIcon muted={volume === 0} />
              </button>
              <input
                className="video-viewer-volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                aria-label={t(language, 'volume')}
                onChange={(event) => changeVolume(Number(event.target.value))}
              />
            </div>
          </div>
        ) : (
          <div className="explorer-empty">{t(language, 'videoReadFailed')}</div>
        )}
      </div>
    </WindowFrame>
  );
}
