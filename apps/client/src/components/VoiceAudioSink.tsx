import { useEffect, useRef } from 'react';
import { loadCallSettings } from '../utils/call-settings';
import { getUserVolume, USER_VOLUME_CHANGED_EVENT } from '../utils/user-volume';

// Renders audio per remote participant so their voice is heard.
// Allows per-user volume control up to 200% via Web Audio GainNode with graceful fallback to <audio>.
function PeerAudio({ userId, stream, deafened }: { userId: string; stream: MediaStream; deafened: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let gain: GainNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
        source = ctx.createMediaStreamSource(stream);
        gain = ctx.createGain();
        source.connect(gain);
        gain.connect(ctx.destination);
        ctxRef.current = ctx;
        gainRef.current = gain;

        if (ctx.state === 'suspended') {
          const resume = () => { void ctx?.resume(); };
          window.addEventListener('click', resume, { once: true });
        }
      }
    } catch {
      // If Web Audio fails, we fallback to standard HTMLAudioElement volume
    }

    const applyVolume = () => {
      const masterOut = loadCallSettings().outputVolume / 100;
      const userVol = getUserVolume(userId) / 100;
      const totalGain = deafened ? 0 : masterOut * userVol;

      if (gainRef.current && ctxRef.current) {
        gainRef.current.gain.value = totalGain;
        if (audioRef.current) {
          audioRef.current.volume = 0;
          audioRef.current.muted = true;
        }
      } else if (audioRef.current) {
        audioRef.current.volume = Math.min(1, Math.max(0, totalGain));
        audioRef.current.muted = deafened;
      }
    };

    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      void audioRef.current.play().catch(() => undefined);
    }

    applyVolume();

    const onUserVolumeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; volume: number }>).detail;
      if (!detail || detail.userId === userId) {
        applyVolume();
      }
    };

    window.addEventListener('notoc:callSettingsChanged', applyVolume);
    window.addEventListener(USER_VOLUME_CHANGED_EVENT, onUserVolumeChanged as EventListener);

    return () => {
      window.removeEventListener('notoc:callSettingsChanged', applyVolume);
      window.removeEventListener(USER_VOLUME_CHANGED_EVENT, onUserVolumeChanged as EventListener);
      try {
        source?.disconnect();
        gain?.disconnect();
        void ctx?.close();
      } catch {
        // Ignore
      }
      ctxRef.current = null;
      gainRef.current = null;
    };
  }, [stream, userId, deafened]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

export function VoiceAudioSink({ streams, deafened = false }: { streams: Map<string, MediaStream>; deafened?: boolean }) {
  return (
    <>
      {[...streams.entries()].map(([userId, stream]) => (
        <PeerAudio key={userId} userId={userId} stream={stream} deafened={deafened} />
      ))}
    </>
  );
}
