import type { PresenceStatus } from './user-status';

export type PresenceSnapshotPayload = {
  onlineUserIds?: string[];
  statuses?: Record<string, PresenceStatus>;
};

export type PresenceChangedPayload = {
  userId: string;
  online: boolean;
  status?: PresenceStatus;
};

function isVisiblePresenceStatus(value: unknown): value is Exclude<PresenceStatus, 'invisible'> {
  return value === 'online' || value === 'idle' || value === 'dnd';
}

export function normalizePresenceSnapshot(payload: PresenceSnapshotPayload): Record<string, PresenceStatus> {
  const onlineUserIds = Array.isArray(payload.onlineUserIds) ? payload.onlineUserIds : [];
  const statuses = payload.statuses ?? {};
  const next: Record<string, PresenceStatus> = {};

  for (const userId of onlineUserIds) {
    const status = statuses[userId];
    next[userId] = isVisiblePresenceStatus(status) ? status : 'online';
  }

  return next;
}

export function applyPresenceChange(
  current: Record<string, PresenceStatus>,
  payload: PresenceChangedPayload
): Record<string, PresenceStatus> {
  const next = { ...current };
  if (!payload.online || payload.status === 'invisible') {
    delete next[payload.userId];
    return next;
  }
  next[payload.userId] = isVisiblePresenceStatus(payload.status) ? payload.status : 'online';
  return next;
}

export function onlineIdsFromPresence(statuses: Record<string, PresenceStatus>): string[] {
  return Object.keys(statuses);
}
