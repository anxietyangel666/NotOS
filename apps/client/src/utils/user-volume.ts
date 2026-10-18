const STORAGE_KEY = 'notos_user_volumes';
export const USER_VOLUME_CHANGED_EVENT = 'notoc:userVolumeChanged';

export function getAllUserVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, number>;
    }
  } catch {
    // Ignore storage parse errors
  }
  return {};
}

export function getUserVolume(userId: string): number {
  if (!userId) return 100;
  const map = getAllUserVolumes();
  const val = map[userId];
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.max(0, Math.min(200, Math.round(val)));
  }
  return 100;
}

export function setUserVolume(userId: string, volume: number): void {
  if (!userId) return;
  const clamped = Math.max(0, Math.min(200, Math.round(volume)));
  const map = getAllUserVolumes();
  map[userId] = clamped;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
  window.dispatchEvent(
    new CustomEvent(USER_VOLUME_CHANGED_EVENT, {
      detail: { userId, volume: clamped }
    })
  );
}

export function resetUserVolume(userId: string): void {
  if (!userId) return;
  const map = getAllUserVolumes();
  delete map[userId];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
  window.dispatchEvent(
    new CustomEvent(USER_VOLUME_CHANGED_EVENT, {
      detail: { userId, volume: 100 }
    })
  );
}
