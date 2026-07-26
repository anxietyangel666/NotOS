// Module-level cache of per-group data so reopening a group renders its
// channels/roles/members/folders and last-viewed messages instantly while the
// network revalidates in the background (stale-while-revalidate). Lives for the
// app session; socket events and fetches keep it fresh.
// (Extracted from GroupChatView.tsx.)
import type { CustomCategory, GroupChannel, GroupFolder, GroupMember, GroupMessage, GroupRole } from '../../api/types';

export type GroupDataCacheEntry = {
  channels: GroupChannel[];
  roles: GroupRole[];
  members: GroupMember[];
  folders: GroupFolder[];
  customCategories: CustomCategory[];
  selectedOptionIds: string[];
  onboardingRequired: boolean;
  activeChannel: string | null;
  messages: Map<string, GroupMessage[]>; // channelId -> messages
  messageHasMore: Map<string, boolean>;
  messageLoadedAt: Map<string, number>;
  slowmodeUntilByChannel: Record<string, number>;
  acceptedNsfwChannels: Set<string>;
  bootstrapLoadedAt: number;
};

export const GROUP_BOOTSTRAP_CACHE_TTL_MS = 2 * 60_000;
export const GROUP_MESSAGES_CACHE_TTL_MS = 5 * 60_000;
export const groupDataCache = new Map<string, GroupDataCacheEntry>();

export function getGroupCache(groupId: string): GroupDataCacheEntry {
  let entry = groupDataCache.get(groupId);
  if (!entry) {
    entry = {
      channels: [],
      roles: [],
      members: [],
      folders: [],
      customCategories: [],
      selectedOptionIds: [],
      onboardingRequired: false,
      activeChannel: null,
      messages: new Map(),
      messageHasMore: new Map(),
      messageLoadedAt: new Map(),
      slowmodeUntilByChannel: {},
      acceptedNsfwChannels: new Set(),
      bootstrapLoadedAt: 0
    };
    groupDataCache.set(groupId, entry);
  }
  return entry;
}

// ── Disk persistence ─────────────────────────────────────────────────────────
// The Map above only survives within one app session, so the first group open
// after a restart flashed empty while two sequential requests ran. Persist the
// light parts (channels, folders, last messages of the active channel) so a
// cold open paints instantly and revalidates in the background, matching the
// DM experience. Members/roles are NOT persisted — their base64 avatars are
// too heavy for localStorage.
const GROUP_CACHE_STORAGE_PREFIX = 'notoc.groupCache.';
const GROUP_CACHE_MAX_BYTES = 400_000;
const GROUP_CACHE_MAX_MESSAGES = 30;

type PersistedGroupCache = {
  channels: GroupChannel[];
  folders: GroupFolder[];
  activeChannel: string | null;
  messages: Record<string, GroupMessage[]>;
  savedAt: number;
};

function groupCacheStorageKey(userId: string, groupId: string) {
  return `${GROUP_CACHE_STORAGE_PREFIX}${userId}.${groupId}`;
}

// Inline data: URLs (voice notes, old base64 images) would blow the quota; a
// message carrying them is simply left out of the snapshot.
function hasInlineDataMedia(message: GroupMessage) {
  if (message.imageData?.startsWith('data:')) return true;
  return (message.mediaItems ?? []).some((item) => item.dataUrl.startsWith('data:'));
}

// Fills the session cache entry from disk when it is still empty. Leaves
// bootstrapLoadedAt at 0 so the network revalidates immediately.
export function hydrateGroupCache(userId: string, groupId: string): GroupDataCacheEntry {
  const entry = getGroupCache(groupId);
  if (entry.channels.length > 0) return entry;
  try {
    const raw = localStorage.getItem(groupCacheStorageKey(userId, groupId));
    if (!raw) return entry;
    const data = JSON.parse(raw) as PersistedGroupCache;
    entry.channels = Array.isArray(data.channels) ? data.channels : [];
    entry.folders = Array.isArray(data.folders) ? data.folders : [];
    entry.activeChannel = data.activeChannel ?? null;
    for (const [channelId, messages] of Object.entries(data.messages ?? {})) {
      if (Array.isArray(messages) && messages.length > 0) entry.messages.set(channelId, messages);
    }
  } catch { /* corrupt snapshot — cold start as before */ }
  return entry;
}

export function persistGroupCache(userId: string, groupId: string) {
  const entry = groupDataCache.get(groupId);
  if (!entry || entry.channels.length === 0) return;
  try {
    const messages: Record<string, GroupMessage[]> = {};
    if (entry.activeChannel) {
      const list = (entry.messages.get(entry.activeChannel) ?? [])
        .slice(-GROUP_CACHE_MAX_MESSAGES)
        .filter((message) => !message.pending && !hasInlineDataMedia(message));
      if (list.length > 0) messages[entry.activeChannel] = list;
    }
    const payload = JSON.stringify({
      channels: entry.channels,
      folders: entry.folders,
      activeChannel: entry.activeChannel,
      messages,
      savedAt: Date.now()
    } satisfies PersistedGroupCache);
    if (payload.length <= GROUP_CACHE_MAX_BYTES) {
      localStorage.setItem(groupCacheStorageKey(userId, groupId), payload);
    }
  } catch { /* quota exceeded — skip silently */ }
}

function panelWidthKey(panel: 'channel' | 'member') {
  return `notoc.groupChat.${panel}PanelWidth`;
}

// Persist the channel/member panel widths so they survive reopening the messenger.
export function loadPanelWidth(panel: 'channel' | 'member', fallback: number) {
  try {
    const raw = localStorage.getItem(panelWidthKey(panel));
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function savePanelWidth(panel: 'channel' | 'member', width: number) {
  try {
    localStorage.setItem(panelWidthKey(panel), String(Math.round(width)));
  } catch { }
}
