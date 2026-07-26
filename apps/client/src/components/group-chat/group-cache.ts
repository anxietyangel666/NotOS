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
