let pttOnAudio: HTMLAudioElement | null = null;
let pttOffAudio: HTMLAudioElement | null = null;

function getAudio(type: 'on' | 'off'): HTMLAudioElement {
  if (type === 'on') {
    if (!pttOnAudio) {
      pttOnAudio = new Audio(`${import.meta.env.BASE_URL}Audio/push_on.mp3`);
      pttOnAudio.volume = 0.5;
    }
    return pttOnAudio;
  }
  if (!pttOffAudio) {
    pttOffAudio = new Audio(`${import.meta.env.BASE_URL}Audio/push_off.mp3`);
    pttOffAudio.volume = 0.5;
  }
  return pttOffAudio;
}

export function playPttSound(active: boolean) {
  try {
    const audio = getAudio(active ? 'on' : 'off');
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}
