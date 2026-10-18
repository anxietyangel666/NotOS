export type CallSettings = {
  inputDeviceId: string;
  outputDeviceId: string;
  micVolume: number; // 0..200 (gain percentage)
  outputVolume: number; // 0..100
  pushToTalk: boolean;
  pushToTalkKey: string; // KeyboardEvent.code
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
};

const CALL_SETTINGS_KEY = 'notoc.callSettings';

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  micVolume: 100,
  outputVolume: 100,
  pushToTalk: false,
  pushToTalkKey: 'Space',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};

export function loadCallSettings(): CallSettings {
  try {
    const raw = localStorage.getItem(CALL_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CALL_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CallSettings>;
    return { ...DEFAULT_CALL_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_CALL_SETTINGS };
  }
}

export function saveCallSettings(settings: CallSettings): void {
  try {
    localStorage.setItem(CALL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function describeKey(code: string, fallback: string): string {
  if (!code) return fallback;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code === 'ControlLeft') return 'Left Ctrl';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (code === 'ShiftLeft') return 'Left Shift';
  if (code === 'ShiftRight') return 'Right Shift';
  if (code === 'AltLeft') return 'Left Alt';
  if (code === 'AltRight') return 'Right Alt';
  if (code === 'Mouse3') return 'Mouse 3 (Wheel)';
  if (code === 'Mouse4') return 'Mouse 4 (Back)';
  if (code === 'Mouse5') return 'Mouse 5 (Forward)';
  return code;
}

export function audioConstraintsFromCallSettings(settings: CallSettings): MediaTrackConstraints {
  return {
    deviceId: settings.inputDeviceId && settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl
  };
}

export async function applyCallAudioConstraints(track: MediaStreamTrack | null, settings: CallSettings): Promise<void> {
  if (!track || track.readyState === 'ended') return;
  try {
    await track.applyConstraints(audioConstraintsFromCallSettings(settings));
  } catch {
    // Some devices/drivers do not support every processing flag. Keep the live
    // call running and let the next getUserMedia call use the saved settings.
  }
}
