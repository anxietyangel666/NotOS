import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';

const MAX_RECORDING_SECONDS = 180;
const VIDEO_CIRCLE_MAX_RECORDING_SECONDS = 60;

function recordingMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function videoRecordingMimeType(): string {
  const video = document.createElement('video');
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4'
  ];
  return candidates.find((type) => {
    if (!MediaRecorder.isTypeSupported(type)) return false;
    const container = mediaContainerMimeType(type);
    return !container.startsWith('video/') || video.canPlayType(container) !== '';
  }) ?? '';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read voice recording'));
    reader.readAsDataURL(blob);
  });
}

function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function voiceFileExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

function videoFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

function mediaContainerMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0] || mimeType;
}

function playableVideoSrc(src: string): string {
  return src.replace(/^data:(video\/[^;,]+);codecs=[^;]+;base64,/i, 'data:$1;base64,');
}

async function createCanvasVideoRecordingStream(sourceStream: MediaStream): Promise<{ stream: MediaStream; stop: () => void }> {
  const sourceVideo = document.createElement('video');
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  sourceVideo.srcObject = sourceStream;
  await new Promise<void>((resolve) => {
    let done = false;
    let timeoutId: number | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resolve();
    };
    sourceVideo.addEventListener('loadeddata', finish, { once: true });
    sourceVideo.addEventListener('canplay', finish, { once: true });
    const frameVideo = sourceVideo as HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number };
    if (typeof frameVideo.requestVideoFrameCallback === 'function') {
      frameVideo.requestVideoFrameCallback(finish);
    }
    timeoutId = window.setTimeout(finish, 1200);
    void sourceVideo.play().catch(finish);
  });

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') {
    sourceVideo.pause();
    sourceVideo.srcObject = null;
    return {
      stream: sourceStream,
      stop: () => sourceStream.getTracks().forEach((track) => track.stop())
    };
  }

  let stopped = false;
  let frameId = 0;
  const draw = () => {
    if (stopped) return;
    const width = sourceVideo.videoWidth;
    const height = sourceVideo.videoHeight;
    if (width > 0 && height > 0) {
      const side = Math.min(width, height);
      const sx = Math.max(0, (width - side) / 2);
      const sy = Math.max(0, (height - side) / 2);
      context.drawImage(sourceVideo, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    }
    frameId = window.requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(24);
  const mixedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...sourceStream.getAudioTracks()
  ]);

  return {
    stream: mixedStream,
    stop: () => {
      stopped = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      sourceVideo.pause();
      sourceVideo.srcObject = null;
      canvasStream.getTracks().forEach((track) => track.stop());
      sourceStream.getTracks().forEach((track) => track.stop());
    }
  };
}

export function isVoiceAttachment(dataUrl: string | null | undefined, name?: string | null): boolean {
  return Boolean(dataUrl?.startsWith('data:audio/') || name?.startsWith('voice-message-'));
}

export function isVideoCircleAttachment(dataUrl: string | null | undefined, name?: string | null): boolean {
  return Boolean(dataUrl?.startsWith('data:video/') || name?.startsWith('video-circle-'));
}

const VOICE_PLAYBACK_EVENT = 'notoc:voice-playback';
const VIDEO_CIRCLE_PLAYBACK_EVENT = 'notoc:video-circle-playback';

type VoicePlaybackDetail = {
  audio: HTMLAudioElement;
  src: string;
  senderName: string;
  createdAt: string;
};

let activeVoiceAudio: HTMLAudioElement | null = null;
let activeVoiceDetail: VoicePlaybackDetail | null = null;

type VideoCirclePlaybackDetail = {
  video: HTMLVideoElement;
  src: string;
  senderName: string;
  createdAt: string;
};

let activeVideoCircle: HTMLVideoElement | null = null;
let activeVideoCircleDetail: VideoCirclePlaybackDetail | null = null;

function announceVoicePlayback(detail: Omit<VoicePlaybackDetail, 'audio'>): VoicePlaybackDetail {
  if (!activeVoiceAudio || activeVoiceDetail?.src !== detail.src) {
    activeVoiceAudio?.pause();
    activeVoiceAudio = new Audio(detail.src);
    activeVoiceAudio.preload = 'metadata';
    activeVoiceAudio.addEventListener('loadedmetadata', () => {
      const audio = activeVoiceAudio;
      if (!audio || (Number.isFinite(audio.duration) && audio.duration > 0)) return;
      const restore = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
        audio.currentTime = 0;
        audio.removeEventListener('durationchange', restore);
        audio.removeEventListener('timeupdate', restore);
      };
      audio.addEventListener('durationchange', restore);
      audio.addEventListener('timeupdate', restore);
      try {
        audio.currentTime = Number.MAX_SAFE_INTEGER;
      } catch {
        audio.removeEventListener('durationchange', restore);
        audio.removeEventListener('timeupdate', restore);
      }
    });
  }
  activeVoiceDetail = { ...detail, audio: activeVoiceAudio };
  const announced = activeVoiceDetail;
  ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'ended'].forEach((eventName) => {
    // These listeners are attached once per persistent Audio instance.
    if ((activeVoiceAudio as HTMLAudioElement & { __notocSyncAttached?: boolean }).__notocSyncAttached) return;
    activeVoiceAudio?.addEventListener(eventName, () => {
      if (activeVoiceDetail) window.dispatchEvent(new CustomEvent<VoicePlaybackDetail>(VOICE_PLAYBACK_EVENT, { detail: activeVoiceDetail }));
    });
  });
  (activeVoiceAudio as HTMLAudioElement & { __notocSyncAttached?: boolean }).__notocSyncAttached = true;
  window.dispatchEvent(new CustomEvent<VoicePlaybackDetail>(VOICE_PLAYBACK_EVENT, { detail: announced }));
  return announced;
}

function announceVideoCirclePlayback(detail: Omit<VideoCirclePlaybackDetail, 'video'>, videoElement: HTMLVideoElement): VideoCirclePlaybackDetail {
  if (activeVideoCircle && activeVideoCircle !== videoElement) activeVideoCircle.pause();
  activeVideoCircle = videoElement;
  if (activeVideoCircle.src !== detail.src) activeVideoCircle.src = detail.src;
  activeVideoCircle.preload = 'metadata';
  activeVideoCircle.playsInline = true;
  activeVideoCircleDetail = { ...detail, video: activeVideoCircle };
  const announced = activeVideoCircleDetail;
  ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange', 'ended'].forEach((eventName) => {
    if ((activeVideoCircle as HTMLVideoElement & { __notocSyncAttached?: boolean }).__notocSyncAttached) return;
    activeVideoCircle?.addEventListener(eventName, () => {
      if (activeVideoCircleDetail) window.dispatchEvent(new CustomEvent<VideoCirclePlaybackDetail>(VIDEO_CIRCLE_PLAYBACK_EVENT, { detail: activeVideoCircleDetail }));
    });
  });
  (activeVideoCircle as HTMLVideoElement & { __notocSyncAttached?: boolean }).__notocSyncAttached = true;
  window.dispatchEvent(new CustomEvent<VideoCirclePlaybackDetail>(VIDEO_CIRCLE_PLAYBACK_EVENT, { detail: announced }));
  return announced;
}

function voiceDateLabel(createdAt: string, language: Language): string {
  const value = new Date(createdAt);
  if (Number.isNaN(value.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDifference = Math.round((startToday - startValue) / 86_400_000);
  const time = value.toLocaleTimeString(language === 'ru' ? 'ru-RU' : language === 'uk' ? 'uk-UA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
  if (dayDifference === 0) return `${language === 'ru' ? 'Сегодня' : language === 'uk' ? 'Сьогодні' : 'Today'}, ${time}`;
  if (dayDifference === 1) return `${language === 'ru' ? 'Вчера' : language === 'uk' ? 'Учора' : 'Yesterday'}, ${time}`;
  return `${value.toLocaleDateString(language === 'ru' ? 'ru-RU' : language === 'uk' ? 'uk-UA' : 'en-US')}, ${time}`;
}

export function VoiceMessagePlayer({
  src,
  senderName = '',
  createdAt = '',
  transcribe
}: {
  src: string;
  senderName?: string;
  createdAt?: string;
  // When provided, renders an "Aa" button that fetches (and then shows) the
  // Whisper transcript of this voice message.
  transcribe?: () => Promise<string>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState<{ state: 'idle' | 'loading' | 'done' | 'error'; text: string }>({ state: 'idle', text: '' });

  useEffect(() => {
    const syncPlayback = (event?: Event) => {
      const detail = event
        ? (event as CustomEvent<VoicePlaybackDetail>).detail
        : activeVoiceDetail;
      if (!detail || detail.src !== src) {
        setPlaying(false);
        return;
      }
      setPlaying(!detail.audio.paused);
      setCurrentTime(detail.audio.currentTime || 0);
      if (Number.isFinite(detail.audio.duration) && detail.audio.duration > 0) setDuration(detail.audio.duration);
    };
    syncPlayback();
    window.addEventListener(VOICE_PLAYBACK_EVENT, syncPlayback);
    return () => window.removeEventListener(VOICE_PLAYBACK_EVENT, syncPlayback);
  }, [src]);

  function resolveWebmDuration() {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
      return;
    }
    const restorePosition = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      setDuration(audio.duration);
      audio.currentTime = 0;
      audio.removeEventListener('durationchange', restorePosition);
      audio.removeEventListener('timeupdate', restorePosition);
    };
    audio.addEventListener('durationchange', restorePosition);
    audio.addEventListener('timeupdate', restorePosition);
    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      audio.removeEventListener('durationchange', restorePosition);
      audio.removeEventListener('timeupdate', restorePosition);
    }
  }

  function togglePlayback() {
    const { audio } = announceVoicePlayback({ src, senderName, createdAt });
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  return (
    <div className="voice-message-player">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={resolveWebmDuration}
        onDurationChange={() => {
          const next = audioRef.current?.duration ?? 0;
          if (Number.isFinite(next) && next > 0) setDuration(next);
        }}
      />
      <button className="voice-message-play" type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlayback}>
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      <div className="voice-message-track">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(currentTime, duration || 0)}
          style={{ '--voice-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
          aria-label="Voice message position"
          onChange={(event) => {
            const next = Number(event.target.value);
            const { audio } = announceVoicePlayback({ src, senderName, createdAt });
            audio.currentTime = next;
            setCurrentTime(next);
          }}
        />
        <span>{formatRecordingTime(Math.floor(currentTime))} / {formatRecordingTime(Math.floor(duration))}</span>
      </div>
      {transcribe ? (
        <button
          className="voice-message-transcribe"
          type="button"
          title="Show as text"
          aria-label="Show as text"
          disabled={transcript.state === 'loading'}
          onClick={() => {
            if (transcript.state === 'done') {
              setTranscript({ state: 'idle', text: '' });
              return;
            }
            setTranscript({ state: 'loading', text: '' });
            transcribe()
              .then((text) => setTranscript({ state: 'done', text }))
              .catch(() => setTranscript({ state: 'error', text: '' }));
          }}
        >
          Aa
        </button>
      ) : null}
      {transcript.state === 'done' ? <p className="voice-message-transcript">{transcript.text}</p> : null}
      {transcript.state === 'loading' ? <p className="voice-message-transcript pending">…</p> : null}
      {transcript.state === 'error' ? <p className="voice-message-transcript error">✕</p> : null}
    </div>
  );
}

export function VideoCircleMessagePlayer({
  src,
  senderName = '',
  createdAt = ''
}: {
  src: string;
  senderName?: string;
  createdAt?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressFrameRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [poster, setPoster] = useState('');
  const playbackSrc = playableVideoSrc(src);

  useEffect(() => {
    const syncPlayback = (event?: Event) => {
      const detail = event
        ? (event as CustomEvent<VideoCirclePlaybackDetail>).detail
        : activeVideoCircleDetail;
      const video = videoRef.current;
      if (!detail || detail.src !== playbackSrc || detail.video !== video) {
        setPlaying(false);
        if (video) video.pause();
        return;
      }
      setPlaying(!detail.video.paused);
      setCurrentTime(detail.video.currentTime || 0);
      if (Number.isFinite(detail.video.duration) && detail.video.duration > 0) setDuration(detail.video.duration);
    };
    syncPlayback();
    window.addEventListener(VIDEO_CIRCLE_PLAYBACK_EVENT, syncPlayback);
    return () => window.removeEventListener(VIDEO_CIRCLE_PLAYBACK_EVENT, syncPlayback);
  }, [playbackSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stopProgressFrame = () => {
      if (progressFrameRef.current !== null) {
        window.cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
    };
    const syncLocalTime = () => {
      setCurrentTime(video.currentTime || 0);
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const tickProgress = () => {
      syncLocalTime();
      if (!video.paused && !video.ended) {
        progressFrameRef.current = window.requestAnimationFrame(tickProgress);
      } else {
        progressFrameRef.current = null;
      }
    };
    const startProgressFrame = () => {
      if (progressFrameRef.current === null) {
        progressFrameRef.current = window.requestAnimationFrame(tickProgress);
      }
    };
    const handleEnded = () => {
      syncLocalTime();
    };
    video.addEventListener('loadedmetadata', syncLocalTime);
    video.addEventListener('durationchange', syncLocalTime);
    video.addEventListener('timeupdate', syncLocalTime);
    video.addEventListener('play', startProgressFrame);
    video.addEventListener('pause', stopProgressFrame);
    video.addEventListener('ended', handleEnded);
    return () => {
      stopProgressFrame();
      video.removeEventListener('loadedmetadata', syncLocalTime);
      video.removeEventListener('durationchange', syncLocalTime);
      video.removeEventListener('timeupdate', syncLocalTime);
      video.removeEventListener('play', startProgressFrame);
      video.removeEventListener('pause', stopProgressFrame);
      video.removeEventListener('ended', handleEnded);
    };
  }, [playbackSrc]);

  useEffect(() => {
    let cancelled = false;
    setPoster('');
    const probe = document.createElement('video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return () => {
      cancelled = true;
      probe.src = '';
    };
    canvas.width = 180;
    canvas.height = 180;
    probe.src = playbackSrc;
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'auto';

    const frameScore = () => {
      context.drawImage(probe, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let score = 0;
      let samples = 0;
      for (let i = 0; i < pixels.length; i += 4 * 16) {
        score += pixels[i] + pixels[i + 1] + pixels[i + 2];
        samples += 1;
      }
      return samples ? score / samples : 0;
    };

    const capture = () => {
      if (cancelled) return true;
      try {
        const score = frameScore();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        if (score > 24 || !poster) {
          setPoster(dataUrl);
          return score > 24;
        }
      } catch {
        return true;
      }
      return false;
    };

    const seekCandidates = () => {
      const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 1.2;
      return Array.from(new Set([0.08, 0.2, 0.45, Math.min(0.8, duration * 0.5), Math.min(1.2, duration * 0.75)].filter((value) => value < duration)));
    };

    probe.addEventListener('loadeddata', () => {
      if (capture()) return;
      const candidates = seekCandidates();
      let index = 0;
      const seekNext = () => {
        if (cancelled || index >= candidates.length) return;
        try {
          probe.currentTime = candidates[index++];
        } catch {
          // Decoders that cannot seek still keep the captured fallback frame.
        }
      };
      probe.addEventListener('seeked', () => {
        if (!capture()) seekNext();
      });
      seekNext();
    }, { once: true });
    probe.load();

    return () => {
      cancelled = true;
      probe.pause();
      probe.src = '';
    };
  }, [playbackSrc]);

  function togglePlayback() {
    const element = videoRef.current;
    if (!element) return;
    const { video } = announceVideoCirclePlayback({ src: playbackSrc, senderName, createdAt }, element);
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  return (
    <button
      className={[
        'video-circle-message',
        playing ? 'playing' : '',
        playing ? 'expanded' : ''
      ].filter(Boolean).join(' ')}
      type="button"
      style={{ '--video-circle-progress': `${duration > 0 ? Math.min(360, Math.max(0, (currentTime / duration) * 360)) : 0}deg` } as CSSProperties}
      onClick={togglePlayback}
    >
      <video ref={videoRef} src={playbackSrc} poster={poster || undefined} playsInline preload="auto" />
      <span className="video-circle-play" aria-hidden="true">
        {playing ? (
          <svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        )}
      </span>
    </button>
  );
}

export function VideoCirclePlaybackBar({ language }: { language: Language }) {
  const [active, setActive] = useState<VideoCirclePlaybackDetail | null>(() => activeVideoCircleDetail);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const activate = (event: Event) => setActive((event as CustomEvent<VideoCirclePlaybackDetail>).detail);
    window.addEventListener(VIDEO_CIRCLE_PLAYBACK_EVENT, activate);
    return () => window.removeEventListener(VIDEO_CIRCLE_PLAYBACK_EVENT, activate);
  }, []);

  useEffect(() => {
    const video = active?.video;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused);
      setCurrentTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    sync();
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('timeupdate', sync);
    video.addEventListener('durationchange', sync);
    video.addEventListener('ended', sync);
    return () => {
      video.removeEventListener('play', sync);
      video.removeEventListener('pause', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('durationchange', sync);
      video.removeEventListener('ended', sync);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="voice-playback-bar video-circle-playback-bar">
      <button className="voice-playback-main" type="button" onClick={() => {
        if (active.video.paused) void active.video.play().catch(() => undefined);
        else active.video.pause();
      }}>
        {playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <div className="voice-playback-details">
        <strong>{active.senderName || (language === 'ru' ? 'Видео кружок' : 'Video message')}</strong>
        <span>{voiceDateLabel(active.createdAt, language)}</span>
      </div>
      <time>{formatRecordingTime(Math.floor(currentTime))} / {formatRecordingTime(Math.floor(duration))}</time>
      <button className="voice-playback-close" type="button" aria-label="Close" onClick={() => {
        active.video.pause();
        active.video.currentTime = 0;
        if (activeVideoCircle === active.video) {
          activeVideoCircle = null;
          activeVideoCircleDetail = null;
        }
        setActive(null);
      }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>
      </button>
    </div>
  );
}

export function VoicePlaybackBar({ language }: { language: Language }) {
  const [active, setActive] = useState<VoicePlaybackDetail | null>(() => activeVoiceDetail);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);

  useEffect(() => {
    const activate = (event: Event) => setActive((event as CustomEvent<VoicePlaybackDetail>).detail);
    window.addEventListener(VOICE_PLAYBACK_EVENT, activate);
    return () => window.removeEventListener(VOICE_PLAYBACK_EVENT, activate);
  }, []);

  useEffect(() => {
    const audio = active?.audio;
    if (!audio) return;
    const sync = () => {
      setPlaying(!audio.paused);
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setVolume(audio.muted ? 0 : audio.volume);
    };
    sync();
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('durationchange', sync);
    audio.addEventListener('volumechange', sync);
    return () => {
      audio.removeEventListener('play', sync);
      audio.removeEventListener('pause', sync);
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('durationchange', sync);
      audio.removeEventListener('volumechange', sync);
    };
  }, [active]);

  if (!active) return null;

  const updateVolume = (nextValue: number) => {
    const next = Math.max(0, Math.min(1, nextValue));
    active.audio.volume = next;
    active.audio.muted = next === 0;
    setVolume(next);
  };

  return (
    <div className="voice-playback-bar">
      <button className="voice-playback-main" type="button" onClick={() => {
        if (active.audio.paused) void active.audio.play();
        else active.audio.pause();
      }}>
        {playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>}
      </button>
      <div className="voice-playback-details">
        <strong>{active.senderName || (language === 'ru' ? 'Голосовое сообщение' : 'Voice message')}</strong>
        <span>{voiceDateLabel(active.createdAt, language)}</span>
      </div>
      <time>{formatRecordingTime(Math.floor(currentTime))} / {formatRecordingTime(Math.floor(duration))}</time>
      <div className="voice-playback-volume-wrap">
        <button className="voice-playback-volume-button" type="button" onClick={() => setVolumeOpen((current) => !current)}>
          <span aria-hidden="true" />
        </button>
        {volumeOpen ? (
          <div className="voice-playback-volume-menu">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              aria-label="Voice message volume"
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
          </div>
        ) : null}
      </div>
      <button className="voice-playback-close" type="button" aria-label="Close" onClick={() => {
        active.audio.pause();
        active.audio.currentTime = 0;
        if (activeVoiceAudio === active.audio) {
          activeVoiceAudio = null;
          activeVoiceDetail = null;
        }
        setActive(null);
      }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>
      </button>
    </div>
  );
}

type VoiceRecorderControlProps = {
  disabled?: boolean;
  voiceDisabled?: boolean;
  videoDisabled?: boolean;
  language: Language;
  onSend: (recording: { dataUrl: string; name: string }) => void | Promise<void>;
};

type RecordingKind = 'voice' | 'video';

export function VoiceRecorderControl({ disabled = false, voiceDisabled = false, videoDisabled = false, language, onSend }: VoiceRecorderControlProps) {
  const [mode, setMode] = useState<'idle' | 'holding' | 'locked'>('idle');
  const [recordingKind, setRecordingKind] = useState<RecordingKind>('voice');
  const [elapsed, setElapsed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState('');
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const modeRef = useRef(mode);
  const recordingKindRef = useRef<RecordingKind>(recordingKind);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const pressStartTimerRef = useRef<number | null>(null);
  const sendDecisionsRef = useRef(new WeakMap<MediaRecorder, boolean>());
  const pendingFinishRef = useRef<boolean | null>(null);
  const initializingRef = useRef(false);
  const completedBlobRef = useRef<Blob | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lockRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const activePointerHandlersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  function updateMode(next: 'idle' | 'holding' | 'locked') {
    modeRef.current = next;
    setMode(next);
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopPressStartTimer() {
    if (pressStartTimerRef.current !== null) {
      window.clearTimeout(pressStartTimerRef.current);
      pressStartTimerRef.current = null;
    }
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPreviewStream(null);
  }

  function removePointerListeners() {
    const handlers = activePointerHandlersRef.current;
    if (!handlers) return;
    window.removeEventListener('pointermove', handlers.move);
    window.removeEventListener('pointerup', handlers.up);
    window.removeEventListener('pointercancel', handlers.cancel);
    activePointerHandlersRef.current = null;
  }

  async function sendRecordingBlob(blob: Blob, kind: RecordingKind) {
    if (blob.size === 0) {
      if (mountedRef.current) setError(language === 'ru' ? 'Запись получилась пустой' : 'The recording is empty');
      return;
    }
    try {
      const dataUrl = await blobToDataUrl(blob);
      const name = kind === 'video'
        ? `video-circle-${Date.now()}.${videoFileExtension(blob.type)}`
        : `voice-message-${Date.now()}.${voiceFileExtension(blob.type)}`;
      await onSend({ dataUrl, name });
    } catch {
      if (mountedRef.current) setError(language === 'ru' ? 'Не удалось отправить запись' : 'Could not send recording');
    }
  }

  function finishRecording(send: boolean) {
    removePointerListeners();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      pendingFinishRef.current = null;
      stopTimer();
      updateMode('idle');
      setElapsed(0);
      setElapsedMs(0);
      sendDecisionsRef.current.set(recorder, send);
      try {
        recorder.requestData();
      } catch {
        // Some MediaRecorder implementations flush automatically on stop.
      }
      window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 60);
    } else if (send && completedBlobRef.current) {
      const completed = completedBlobRef.current;
      completedBlobRef.current = null;
      pendingFinishRef.current = null;
      stopTimer();
      updateMode('idle');
      setElapsed(0);
      setElapsedMs(0);
      void sendRecordingBlob(completed, recordingKindRef.current);
    } else if (send && initializingRef.current) {
      pendingFinishRef.current = true;
    } else {
      pendingFinishRef.current = null;
      stopTimer();
      updateMode('idle');
      setElapsed(0);
      setElapsedMs(0);
      releaseStream();
      if (send) setError(language === 'ru' ? 'Нет данных голосовой записи' : 'No voice recording data');
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (modeRef.current !== 'holding') return;
    const bounds = lockRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const padding = 14;
    if (
      event.clientX >= bounds.left - padding &&
      event.clientX <= bounds.right + padding &&
      event.clientY >= bounds.top - padding &&
      event.clientY <= bounds.bottom + padding
    ) {
      updateMode('locked');
    }
  }

  function handlePointerUp(event: PointerEvent) {
    removePointerListeners();
    if (modeRef.current !== 'holding') return;
    const cancelBounds = cancelRef.current?.getBoundingClientRect();
    const releasedOnCancel = Boolean(cancelBounds
      && event.clientX >= cancelBounds.left
      && event.clientX <= cancelBounds.right
      && event.clientY >= cancelBounds.top
      && event.clientY <= cancelBounds.bottom);
    finishRecording(!releasedOnCancel);
  }

  function handlePointerCancel() {
    if (modeRef.current === 'holding') finishRecording(false);
  }

  async function beginRecording(button: HTMLButtonElement) {
    if (disabled || (recordingKindRef.current === 'video' ? videoDisabled : voiceDisabled) || modeRef.current !== 'idle') return;
    const kind = recordingKindRef.current;
    setPortalHost(button.closest<HTMLElement>('.emoji-input-shell'));
    setError('');
    pendingFinishRef.current = null;
    completedBlobRef.current = null;
    initializingRef.current = true;
    updateMode('holding');
    startedAtRef.current = Date.now();
    setElapsed(0);
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      const milliseconds = Date.now() - startedAtRef.current;
      const seconds = Math.floor(milliseconds / 1000);
      setElapsed(seconds);
      setElapsedMs(milliseconds);
      const maxSeconds = recordingKindRef.current === 'video' ? VIDEO_CIRCLE_MAX_RECORDING_SECONDS : MAX_RECORDING_SECONDS;
      if (milliseconds >= maxSeconds * 1000) finishRecording(true);
    }, 100);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'video'
          ? { audio: true, video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 }, frameRate: { ideal: 24, max: 30 } } }
          : { audio: true }
      );
      if (!mountedRef.current || modeRef.current === 'idle') {
        initializingRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (kind === 'video') setPreviewStream(stream);
      let recordingStream = stream;
      let stopRecordingStream = () => recordingStream.getTracks().forEach((track) => track.stop());
      if (kind === 'video') {
        const canvasRecording = await createCanvasVideoRecordingStream(stream);
        if (!mountedRef.current || modeRef.current === 'idle') {
          initializingRef.current = false;
          canvasRecording.stop();
          if (streamRef.current === stream) streamRef.current = null;
          setPreviewStream(null);
          return;
        }
        recordingStream = canvasRecording.stream;
        stopRecordingStream = canvasRecording.stop;
      }
      const mimeType = kind === 'video' ? videoRecordingMimeType() : recordingMimeType();
      const recorder = new MediaRecorder(
        recordingStream,
        mimeType
          ? kind === 'video'
            ? { mimeType, audioBitsPerSecond: 48_000, videoBitsPerSecond: 280_000 }
            : { mimeType, audioBitsPerSecond: 64_000 }
          : undefined
      );
      const recordingChunks: Blob[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (chunk) => {
        if (chunk.data.size > 0) recordingChunks.push(chunk.data);
      };
      recorder.onstop = async () => {
        const sendDecision = sendDecisionsRef.current.get(recorder);
        if (recorderRef.current === recorder) recorderRef.current = null;
        stopRecordingStream();
        if (streamRef.current === stream) streamRef.current = null;
        if (kind === 'video') setPreviewStream(null);
        const recordedType = recorder.mimeType || mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(recordingChunks, { type: mediaContainerMimeType(recordedType) });
        if (sendDecision === false) return;
        if (recordingChunks.length === 0 || blob.size === 0) {
          if (sendDecision === undefined) {
            stopTimer();
            updateMode('idle');
          }
          if (mountedRef.current) setError(language === 'ru' ? 'Запись получилась пустой' : 'The recording is empty');
          return;
        }
        if (sendDecision === true) {
          await sendRecordingBlob(blob, kind);
        } else {
          completedBlobRef.current = blob;
          stopTimer();
          updateMode('locked');
        }
      };
      recorder.onerror = () => {
        if (mountedRef.current) setError(language === 'ru' ? (kind === 'video' ? 'Ошибка записи камеры' : 'Ошибка записи микрофона') : (kind === 'video' ? 'Camera recording error' : 'Microphone recording error'));
      };
      recorder.start(250);
      initializingRef.current = false;
      if (pendingFinishRef.current !== null) {
        const sendAfterPermission = pendingFinishRef.current;
        pendingFinishRef.current = null;
        window.setTimeout(() => {
          if (recorderRef.current !== recorder || recorder.state === 'inactive') return;
          finishRecording(sendAfterPermission);
        }, sendAfterPermission ? 350 : 0);
      }
    } catch {
      initializingRef.current = false;
      stopTimer();
      setElapsed(0);
      setElapsedMs(0);
      removePointerListeners();
      releaseStream();
      updateMode('idle');
      setError(language === 'ru' ? (kind === 'video' ? 'Нет доступа к камере' : 'Нет доступа к микрофону') : (kind === 'video' ? 'Camera access denied' : 'Microphone access denied'));
    }
  }

  function startRecording(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || (recordingKindRef.current === 'video' ? videoDisabled : voiceDisabled) || event.button !== 0 || modeRef.current !== 'idle') return;
    event.preventDefault();
    const button = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;

    const startNow = () => {
      if (started) return;
      started = true;
      stopPressStartTimer();
      void beginRecording(button);
    };

    const pointerHandlers = {
      move: (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!started && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) startNow();
        if (started) handlePointerMove(moveEvent);
      },
      up: (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (!started) {
          stopPressStartTimer();
          removePointerListeners();
          setRecordingKind((current) => {
            if (current === 'voice') return videoDisabled ? 'voice' : 'video';
            return voiceDisabled ? 'video' : 'voice';
          });
          return;
        }
        handlePointerUp(upEvent);
      },
      cancel: () => {
        if (!started) {
          stopPressStartTimer();
          removePointerListeners();
          return;
        }
        handlePointerCancel();
      }
    };
    activePointerHandlersRef.current = pointerHandlers;
    window.addEventListener('pointermove', pointerHandlers.move);
    window.addEventListener('pointerup', pointerHandlers.up);
    window.addEventListener('pointercancel', pointerHandlers.cancel);
    stopPressStartTimer();
    pressStartTimerRef.current = window.setTimeout(startNow, 220);
  }

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    recordingKindRef.current = recordingKind;
  }, [recordingKind]);

  useEffect(() => {
    if (mode !== 'idle') return;
    if (recordingKind === 'voice' && voiceDisabled && !videoDisabled) setRecordingKind('video');
    if (recordingKind === 'video' && videoDisabled && !voiceDisabled) setRecordingKind('voice');
  }, [mode, recordingKind, voiceDisabled, videoDisabled]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    video.srcObject = previewStream;
    if (previewStream) void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === previewStream) video.srcObject = null;
    };
  }, [previewStream]);

  useEffect(() => {
    if (mode === 'idle') return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finishRecording(false);
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => window.removeEventListener('keydown', cancelOnEscape, true);
  }, [mode]);

  useEffect(() => {
    // React StrictMode performs a development-only setup → cleanup → setup
    // cycle. Restore this flag on every setup or getUserMedia will treat the
    // still-mounted recorder as unmounted and discard its stream.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      removePointerListeners();
      stopPressStartTimer();
      stopTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        sendDecisionsRef.current.set(recorder, false);
        recorder.stop();
      }
      completedBlobRef.current = null;
      releaseStream();
    };
  }, []);

  const cancelLabel = language === 'ru' ? 'Отмена' : 'Cancel';
  const sendLabel = language === 'ru' ? 'Отправить' : 'Send';
  const recordLabel = recordingKind === 'video'
    ? (language === 'ru' ? 'Записать видео кружок' : 'Record video message')
    : (language === 'ru' ? 'Записать голосовое сообщение' : 'Record voice message');
  const currentKindDisabled = recordingKind === 'video' ? videoDisabled : voiceDisabled;
  const recordDisabled = disabled || currentKindDisabled || (voiceDisabled && videoDisabled);

  return (
    <>
      <button
        className={`emoji-toggle inline voice-record-button ${recordingKind}`}
        type="button"
        aria-label={recordLabel}
        title={recordLabel}
        disabled={recordDisabled}
        onPointerDown={(event) => void startRecording(event)}
        onClick={(event) => event.preventDefault()}
      >
        <span className="voice-record-button-icon" aria-hidden="true" />
      </button>
      {portalHost && (error || mode !== 'idle') ? createPortal(
        <>
          {error ? <span className="voice-record-error">{error}</span> : null}
          {mode !== 'idle' ? (
            <div className={`voice-recording-bar ${mode}`}>
              {previewStream ? (
                <div
                  className="video-circle-record-preview"
                  style={{ '--video-record-progress': `${Math.min(360, Math.max(0, (elapsedMs / (VIDEO_CIRCLE_MAX_RECORDING_SECONDS * 1000)) * 360))}deg` } as CSSProperties}
                >
                  <video ref={previewVideoRef} muted playsInline autoPlay />
                </div>
              ) : null}
              {mode === 'holding' ? (
                <div ref={lockRef} className="voice-record-lock">
                  <span className="voice-record-lock-icon" aria-hidden="true" />
                  <span>↑</span>
                </div>
              ) : null}
              <span className="voice-record-status">
                <i aria-hidden="true" />
                <time>{formatRecordingTime(elapsed)}</time>
              </span>
              <button ref={cancelRef} className="voice-record-cancel" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => finishRecording(false)}>
                {cancelLabel}
              </button>
              {mode === 'locked' ? (
                <button
                  className="voice-record-send"
                  type="button"
                  aria-label={sendLabel}
                  title={sendLabel}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    finishRecording(true);
                  }}
                  onClick={(event) => event.preventDefault()}
                >
                  <span className="voice-record-send-icon" aria-hidden="true" />
                </button>
              ) : (
                <span className="voice-record-hint">{language === 'ru' ? 'Вверх для фиксации' : 'Slide up to lock'}</span>
              )}
            </div>
          ) : null}
        </>,
        portalHost
      ) : null}
    </>
  );
}
