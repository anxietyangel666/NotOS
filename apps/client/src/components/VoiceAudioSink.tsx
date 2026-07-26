import { useEffect, useRef } from 'react';
import { loadCallSettings } from '../utils/call-settings';

// Renders a hidden <audio> element per remote participant so their voice is
// heard. Output volume follows the saved call settings and updates live.
function PeerAudio({ stream, deafened }: { stream: MediaStream; deafened: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    const applyVolume = () => {
      el.volume = Math.min(1, Math.max(0, loadCallSettings().outputVolume / 100));
      el.muted = deafened;
    };
    applyVolume();
    void el.play().catch(() => undefined);
    window.addEventListener('notoc:callSettingsChanged', applyVolume);
    return () => window.removeEventListener('notoc:callSettingsChanged', applyVolume);
  }, [stream, deafened]);
  return <audio ref={ref} autoPlay />;
}

export function VoiceAudioSink({ streams, deafened = false }: { streams: Map<string, MediaStream>; deafened?: boolean }) {
  return (
    <>
      {[...streams.entries()].map(([userId, stream]) => (
        <PeerAudio key={userId} stream={stream} deafened={deafened} />
      ))}
    </>
  );
}
