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
  return code;
}
