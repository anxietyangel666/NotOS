import type {
  AiChat,
  AiChatMessage,
  AiQuota,
  AiSettings,
  AiChatSummary,
  ConversationPreview,
  ChatMediaItem,
  ConversationSettings,
  CustomCategory,
  DesktopIconPositions,
  DesktopIconSize,
  DesktopSort,
  DesktopWallMessage,
  UserConnection,
  UserActivity,
  FriendRequests,
  Group,
  GroupChannel,
  ChannelPermissionOverride,
  GroupFolder,
  GroupBan,
  GroupInvite,
  GroupConversationPreview,
  GroupMember,
  GroupMessage,
  GroupRole,
  Language,
  LoginResponse,
  MessengerMessage,
  NameStyle,
  NamePlate,
  PinnedCard,
  PublicAudioTrack,
  PublicPoll,
  PublicUser,
  RecoverResponse,
  RegisterResponse,
  StoragePayload,
  Theme,
  ReactionRoleBinding,
  GroupAuditEntry
} from './types';

export const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://163.5.16.156:4000';
export const API_URL_STORAGE_KEY = 'notoc.api-url';
export const API_URL_CHANGED_EVENT = 'notoc:api-url-changed';

export function normalizeApiUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_API_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  try {
    const stored = localStorage.getItem(API_URL_STORAGE_KEY);
    return stored ? normalizeApiUrl(stored) : normalizeApiUrl(DEFAULT_API_URL);
  } catch {
    return normalizeApiUrl(DEFAULT_API_URL);
  }
}

export function setApiBaseUrl(value: string) {
  const normalized = normalizeApiUrl(value);
  try {
    localStorage.setItem(API_URL_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(API_URL_CHANGED_EVENT, { detail: normalized }));
    void window.notoc?.setServerUrl?.(normalized);
  } catch {
    /* ignore storage errors */
  }
  return normalized;
}

export function resolveAudioUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:') || /^https?:\/\//i.test(url)) {
    return url;
  }
  const base = getApiBaseUrl();
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token?: string | null;
  body?: unknown;
  label?: string;
  slowRequestMs?: number;
};

const inflightGetRequests = new Map<string, Promise<unknown>>();
const SLOW_REQUEST_MS = 750;

function requestCallerLabel() {
  if (!import.meta.env.DEV) return 'api';
  const stack = new Error().stack?.split('\n').slice(2) ?? [];
  const caller = stack.find((line) => !line.includes('/api/client.ts') && !line.includes('\\api\\client.ts'));
  return caller?.trim().replace(/^at\s+/, '') ?? 'api';
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {};

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const method = options.method ?? 'GET';
  const baseUrl = getApiBaseUrl();
  const dedupeKey = method === 'GET' && options.body === undefined
    ? `${baseUrl}${path}|${options.token ?? ''}`
    : null;
  if (dedupeKey) {
    const existing = inflightGetRequests.get(dedupeKey);
    if (existing) return existing as Promise<T>;
  }

  const startedAt = performance.now();
  const caller = options.label ?? requestCallerLabel();
  const promise = (async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;

    if (!response.ok) {
      throw Object.assign(new Error(data?.message ?? 'API request failed'), {
        status: response.status,
        code: data?.code,
        retryAfterMs: data?.retryAfterMs,
        retryAfterSeconds: data?.retryAfterSeconds
      });
    }

    return data as T;
  })();

  if (dedupeKey) inflightGetRequests.set(dedupeKey, promise);
  try {
    return await promise;
  } finally {
    if (dedupeKey) inflightGetRequests.delete(dedupeKey);
    if (import.meta.env.DEV) {
      const duration = performance.now() - startedAt;
      if (duration >= (options.slowRequestMs ?? SLOW_REQUEST_MS)) {
        console.warn(`[api] slow ${method} ${path} ${Math.round(duration)}ms`, { caller });
      }
    }
  }
}

export const api = {
  health() {
    return request<{ status: string }>('/health');
  },
  register(input: { nickname: string; avatarData: string; language?: Language; theme?: Theme }) {
    return request<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: input
    });
  },
  registerPassword(input: { login: string; email: string; password: string; avatarData: string; language?: Language; theme?: Theme }) {
    return request<RegisterResponse>('/api/auth/register-password', {
      method: 'POST',
      body: input
    });
  },
  login(authFileContent: string) {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { authFileContent }
    });
  },
  loginPassword(input: { login: string; password: string }) {
    return request<LoginResponse>('/api/auth/login-password', {
      method: 'POST',
      body: input
    });
  },
  recover(input: { nickname: string; recoveryKey: string }) {
    return request<RecoverResponse>('/api/auth/recover', {
      method: 'POST',
      body: input
    });
  },
  me(token: string) {
    return request<{ user: PublicUser }>('/api/users/me', { token });
  },
  updateMe(
    token: string,
    input: {
      nickname?: string;
      avatarData?: string;
      wallpaper?: string;
      language?: Language;
      theme?: Theme;
      accentColor?: string;
      transparencyEnabled?: boolean;
      desktopIcons?: DesktopIconPositions;
      desktopIconSize?: DesktopIconSize;
      hideDesktopIcons?: boolean;
      desktopSort?: DesktopSort;
      status?: string;
      voiceBio?: string | null;
      pinnedImageData?: string;
      pinnedCards?: PinnedCard[];
      nameStyle?: NameStyle;
      profilePrimaryColor?: string;
      profileAccentColor?: string;
      nameplate?: NamePlate | null;
      allowGroupIdentityMessages?: boolean;
    }
  ) {
    return request<{ user: PublicUser }>('/api/users/me', {
      method: 'PATCH',
      token,
      body: input
    });
  },
  getStorage(token: string) {
    return request<StoragePayload>('/api/storage', { token });
  },
  updateStorage(token: string, input: StoragePayload) {
    return request<StoragePayload>('/api/storage', {
      method: 'PUT',
      token,
      body: input
    });
  },
  searchUsers(token: string, nickname: string) {
    return request<{ users: PublicUser[] }>(`/api/users/search?nickname=${encodeURIComponent(nickname)}`, { token });
  },
  getPublicUser(token: string, userId: string) {
    return request<{ user: PublicUser }>(`/api/users/${encodeURIComponent(userId)}/public`, { token });
  },
  getConnections(token: string) {
    return request<{ spotifyConfigured: boolean; riotConfigured: boolean; connections: UserConnection[] }>('/api/connections', { token });
  },
  startSpotifyConnection(token: string) {
    return request<{ url: string }>('/api/connections/spotify/start', { token });
  },
  connectRiot(token: string, input: { gameName: string; tagLine: string; region: string }) {
    return request<{ connection: UserConnection }>('/api/connections/riot', {
      method: 'POST',
      token,
      body: input
    });
  },
  disconnectConnection(token: string, provider: 'spotify' | 'riot') {
    return request<{ success: boolean }>(`/api/connections/${encodeURIComponent(provider)}`, {
      method: 'DELETE',
      token
    });
  },
  updateConnectionVisibility(token: string, provider: 'spotify' | 'riot', input: { showProfile?: boolean; showActivity?: boolean }) {
    return request<{ connection: UserConnection | null }>(`/api/connections/${encodeURIComponent(provider)}/visibility`, {
      method: 'PATCH',
      token,
      body: input
    });
  },
  getUserConnections(token: string, userId: string) {
    return request<{ connections: UserConnection[] }>(`/api/connections/users/${encodeURIComponent(userId)}`, { token });
  },
  getUserActivity(token: string, userId: string, provider?: 'spotify' | 'riot') {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return request<{ activities: UserActivity[] }>(`/api/connections/users/${encodeURIComponent(userId)}/activity${query}`, { token });
  },
  getFriends(token: string) {
    return request<{ friends: PublicUser[] }>('/api/messenger/friends', { token });
  },
  getFriendshipDate(token: string, friendId: string) {
    return request<{ createdAt: string | null }>(`/api/messenger/friendship/${encodeURIComponent(friendId)}`, { token });
  },
  getMutualFriends(token: string, userId: string) {
    return request<{ friends: PublicUser[] }>(`/api/messenger/mutual-friends/${encodeURIComponent(userId)}`, { token });
  },
  getMutualGroups(token: string, userId: string) {
    return request<{ groups: Group[] }>(`/api/messenger/mutual-groups/${encodeURIComponent(userId)}`, { token });
  },
  addFriend(token: string, userId: string) {
    return request<{ status: 'pending' | 'accepted' | 'friends'; friend: PublicUser; friends: PublicUser[]; requests: FriendRequests }>('/api/messenger/friends', {
      method: 'POST',
      token,
      body: { userId }
    });
  },
  removeFriend(token: string, userId: string) {
    return request<{ friends: PublicUser[]; requests: FriendRequests }>(`/api/messenger/friends/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      token
    });
  },
  getFriendRequests(token: string) {
    return request<{ requests: FriendRequests }>('/api/messenger/requests', { token });
  },
  acceptFriendRequest(token: string, userId: string) {
    return request<{ friend: PublicUser; friends: PublicUser[]; requests: FriendRequests }>(`/api/messenger/friends/requests/${encodeURIComponent(userId)}/accept`, {
      method: 'POST',
      token
    });
  },
  deleteFriendRequest(token: string, userId: string) {
    return request<{ friends: PublicUser[]; requests: FriendRequests }>(`/api/messenger/friends/requests/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      token
    });
  },
  // Load one page of a conversation. Pass `before` (a message id) to fetch the
  // page of older messages for scroll-up pagination. `hasMore` indicates that
  // an even older page still exists.
  getMessages(token: string, userId: string, options?: { before?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return request<{ messages: MessengerMessage[]; hasMore: boolean }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}${qs ? `?${qs}` : ''}`,
      { token }
    );
  },
  searchMessages(token: string, userId: string, query: string) {
    return request<{ messages: MessengerMessage[] }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/search?q=${encodeURIComponent(query)}`,
      { token }
    );
  },
  getMessagesAround(token: string, userId: string, messageId: string) {
    return request<{ messages: MessengerMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/around/${encodeURIComponent(messageId)}`,
      { token }
    );
  },
  markMessagesRead(token: string, userId: string) {
    return request<{ messageIds: string[]; readAt: string | null }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/read`,
      { token, method: 'POST' }
    );
  },
  getConversationImages(token: string, userId: string) {
    return request<{ images: MessengerMessage[] }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/images`,
      { token }
    );
  },
  getConversationPinnedMessages(token: string, userId: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return request<{ messages: MessengerMessage[] }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/pinned${qs ? `?${qs}` : ''}`,
      { token }
    );
  },
  getConversationLinks(token: string, userId: string) {
    return request<{ links: MessengerMessage[] }>(
      `/api/messenger/messages/${encodeURIComponent(userId)}/links`,
      { token }
    );
  },
  getBlockState(token: string, userId: string) {
    return request<{ blocked: boolean; blockedMe: boolean }>(
      `/api/messenger/block/${encodeURIComponent(userId)}`,
      { token }
    );
  },
  blockUser(token: string, userId: string) {
    return request<{ blocked: boolean; blockedMe: boolean }>(
      `/api/messenger/block/${encodeURIComponent(userId)}`,
      { token, method: 'POST' }
    );
  },
  unblockUser(token: string, userId: string) {
    return request<{ blocked: boolean; blockedMe: boolean }>(
      `/api/messenger/block/${encodeURIComponent(userId)}`,
      { token, method: 'DELETE' }
    );
  },
  getConversations(token: string) {
    return request<{ conversations: ConversationPreview[] }>('/api/messenger/conversations', { token });
  },
  getMessengerBootstrap(token: string) {
    return request<{
      friends: PublicUser[];
      requests: FriendRequests;
      conversations: ConversationPreview[];
      groups: Group[];
      groupConversations: GroupConversationPreview[];
    }>('/api/messenger/bootstrap', { token, label: 'messenger.bootstrap' });
  },
  getGroupIdentities(token: string) {
    return request<{ groups: Array<{ group: Group; memberCount: number }> }>('/api/messenger/group-identities', { token });
  },
  uploadMessengerMedia(token: string, media: { dataUrl: string; name?: string | null; spoiler?: boolean }) {
    return request<{ media: { dataUrl: string; name: string | null; spoiler: boolean; mimeType?: string; size?: number } }>('/api/messenger/media', {
      method: 'POST',
      token,
      body: { dataUrl: media.dataUrl, name: media.name ?? undefined },
      label: 'messenger.uploadMedia',
      slowRequestMs: 1500
    });
  },
  sendMessage(token: string, recipientId: string, body: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }, replyTo?: string, senderGroupId?: string | null, mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>, options?: { scheduledAt?: string; viewOnce?: boolean; sendWhenOnline?: boolean }) {
    const mediaUpload = Boolean(image?.dataUrl.startsWith('data:audio/') || image?.dataUrl.startsWith('data:video/'));
    return request<{ message: MessengerMessage }>('/api/messenger/messages', {
      method: 'POST',
      token,
      body: {
        recipientId, body, image, mediaItems, replyTo,
        senderGroupId: senderGroupId || undefined,
        scheduledAt: options?.scheduledAt,
        viewOnce: options?.viewOnce || undefined,
        sendWhenOnline: options?.sendWhenOnline || undefined
      },
      label: mediaUpload ? 'messenger.sendMedia' : undefined,
      slowRequestMs: mediaUpload ? 3000 : undefined
    });
  },
  replyWithAiDm(token: string, messageId: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}/ai-reply`, {
      method: 'POST',
      token,
      label: 'messenger.replyWithAiDm',
      slowRequestMs: 4000
    });
  },
  toggleMessageReaction(token: string, messageId: string, emoji: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}/reactions/toggle`, {
      method: 'POST', token, body: { emoji }
    });
  },
  editMessage(token: string, messageId: string, body: string, mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      token,
      body: { body, mediaItems }
    });
  },
  deleteMessage(token: string, messageId: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      token
    });
  },
  clearConversation(token: string, userId: string, forEveryone: boolean) {
    return request<{ success: boolean }>(`/api/messenger/conversations/${encodeURIComponent(userId)}/clear`, {
      method: 'POST',
      token,
      body: { forEveryone }
    });
  },
  getConversationSettings(token: string, userId: string) {
    return request<{ settings: ConversationSettings }>(`/api/messenger/conversations/${encodeURIComponent(userId)}/settings`, { token });
  },
  setConversationTtl(token: string, userId: string, ttlSeconds: number) {
    return request<{ settings: ConversationSettings; message: MessengerMessage }>(`/api/messenger/conversations/${encodeURIComponent(userId)}/ttl`, {
      method: 'PATCH',
      token,
      body: { ttlSeconds }
    });
  },
  setConversationBackground(token: string, userId: string, backgroundData: string) {
    return request<{ settings: ConversationSettings; message: MessengerMessage }>(`/api/messenger/conversations/${encodeURIComponent(userId)}/background`, {
      method: 'PATCH',
      token,
      body: { backgroundData }
    });
  },
  pinMessage(token: string, messageId: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}/pin`, {
      method: 'PATCH',
      token
    });
  },
  getPublicAudio(token: string, userId: string) {
    return request<{ tracks: PublicAudioTrack[] }>(`/api/storage/public-audio/${encodeURIComponent(userId)}`, { token });
  },
  uploadAudioTrack(token: string, track: { name: string; dataUrl: string }) {
    return request<{ track: PublicAudioTrack }>('/api/storage/audio', {
      method: 'POST',
      token,
      body: track
    });
  },
  deleteAudioTrack(token: string, trackId: string) {
    return request<{ ok: boolean }>(`/api/storage/audio/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
      token
    });
  },
  reorderAudioTracks(token: string, trackIds: string[]) {
    return request<{ ok: boolean }>('/api/storage/audio/order', {
      method: 'PUT',
      token,
      body: { trackIds }
    });
  },
  detectPlayer(token: string, url: string) {
    return request<{ result: { detected: boolean; kind: 'youtube' | 'url' | 'embed'; value: string; title: string; originalUrl: string } }>('/api/messenger/watch-together/detect-player', {
      method: 'POST',
      token,
      body: { url }
    });
  },
  // Load one page of a user's wall. Pass `before` (a message id) to fetch the
  // page of older messages for lazy scroll loading. `hasMore` indicates that an
  // even older page still exists.
  getDesktopWall(token: string, ownerId: string, options?: { before?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return request<{ messages: DesktopWallMessage[]; hasMore: boolean }>(
      `/api/desktop-wall/${encodeURIComponent(ownerId)}${qs ? `?${qs}` : ''}`,
      { token }
    );
  },
  createDesktopWallMessage(token: string, ownerId: string, body: string) {
    return request<{ message: DesktopWallMessage }>(`/api/desktop-wall/${encodeURIComponent(ownerId)}`, {
      method: 'POST',
      token,
      body: { body }
    });
  },
  deleteDesktopWallMessage(token: string, messageId: string) {
    return request<{ messageId: string; ownerId: string }>(`/api/desktop-wall/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      token
    });
  },

  getGroups(token: string) {
    return request<{ groups: Group[] }>('/api/messenger/groups', { token });
  },
  getGroupConversations(token: string) {
    return request<{ conversations: GroupConversationPreview[] }>('/api/messenger/groups/conversations', { token });
  },
  createGroup(token: string, name: string, avatarData?: string) {
    return request<{ group: Group }>('/api/messenger/groups', {
      method: 'POST', token, body: { name, avatarData }
    });
  },
  getGroup(token: string, groupId: string) {
    return request<{ group: Group }>(`/api/messenger/groups/${encodeURIComponent(groupId)}`, { token });
  },
  getGroupPublicProfile(token: string, groupId: string) {
    return request<{ group: Group; memberCount: number; isMember: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/public-profile`, { token });
  },
  updateGroup(token: string, groupId: string, input: { name?: string; avatarData?: string; nameplate?: NamePlate | null; description?: string; automodWords?: string[] }) {
    return request<{ group: Group }>(`/api/messenger/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH', token, body: input
    });
  },
  deleteGroup(token: string, groupId: string) {
    return request<{ groupId: string }>(`/api/messenger/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE', token
    });
  },
  getGroupMembers(token: string, groupId: string) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members`, { token });
  },
  addGroupMember(token: string, groupId: string, userId: string) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members`, {
      method: 'POST', token, body: { userId }
    });
  },
  removeGroupMember(token: string, groupId: string, userId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE', token
    });
  },
  updateGroupMemberRole(token: string, groupId: string, userId: string, roleId: string | null | { roleId?: string | null; addRoleId?: string; removeRoleId?: string }) {
    const body = typeof roleId === 'object' ? roleId : { roleId };
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH', token, body
    });
  },
  updateGroupMembersRole(token: string, groupId: string, input: { userIds: string[]; addRoleId?: string; removeRoleId?: string }) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/roles`, {
      method: 'PATCH', token, body: input
    });
  },
  regenerateInvite(token: string, groupId: string, channelId?: string | null, options?: { maxUses?: number | null; expiresInHours?: number | null }) {
    return request<{ inviteCode: string; invite?: GroupInvite }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/invite`, {
      method: 'POST', token, body: { channelId: channelId ?? null, maxUses: options?.maxUses ?? null, expiresInHours: options?.expiresInHours ?? null }
    });
  },
  getGroupInvites(token: string, groupId: string, channelId?: string | null) {
    const qs = channelId === undefined ? '' : `?channelId=${channelId ? encodeURIComponent(channelId) : ''}`;
    return request<{ invites: GroupInvite[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/invites${qs}`, { token });
  },
  deleteGroupInvite(token: string, groupId: string, inviteId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE', token
    });
  },
  getGroupPreviewByInvite(token: string, inviteCode: string) {
    return request<{ group: Group; memberCount: number }>(`/api/messenger/groups/invite/${encodeURIComponent(inviteCode)}`, { token });
  },
  joinGroupByInvite(token: string, inviteCode: string) {
    return request<{ group: Group }>(`/api/messenger/groups/join/${encodeURIComponent(inviteCode)}`, {
      method: 'POST', token
    });
  },
  joinGroupById(token: string, groupId: string) {
    return request<{ group: Group; memberCount: number; isMember: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/join`, {
      method: 'POST', token
    });
  },
  // Load one page of a channel. Pass `before` (a message id) to fetch the page
  // of older messages for scroll-up pagination. `hasMore` indicates that an
  // even older page still exists.
  createPoll(token: string, recipientId: string, poll: { question: string; options: string[]; multi: boolean }) {
    return request<{ message: MessengerMessage; poll: PublicPoll }>('/api/messenger/polls', {
      token, method: 'POST', body: { recipientId, ...poll }
    });
  },
  createGroupPoll(token: string, groupId: string, channelId: string, poll: { question: string; options: string[]; multi: boolean }) {
    return request<{ message: GroupMessage; poll: PublicPoll }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/polls`,
      { token, method: 'POST', body: poll }
    );
  },
  getPoll(token: string, pollId: string) {
    return request<{ poll: PublicPoll }>(`/api/messenger/polls/${encodeURIComponent(pollId)}`, { token });
  },
  votePoll(token: string, pollId: string, optionIndexes: number[]) {
    return request<{ poll: PublicPoll }>(`/api/messenger/polls/${encodeURIComponent(pollId)}/vote`, {
      token, method: 'POST', body: { optionIndexes }
    });
  },
  getBookmarks(token: string) {
    return request<{ bookmarks: Array<{ message: MessengerMessage; user: PublicUser | null; bookmarkedAt: string }> }>(
      '/api/messenger/bookmarks', { token }
    );
  },
  toggleBookmark(token: string, messageId: string) {
    return request<{ bookmarked: boolean }>(`/api/messenger/messages/${encodeURIComponent(messageId)}/bookmark`, {
      token, method: 'POST', body: {}
    });
  },
  searchAllMessages(token: string, query: string, kind: 'all' | 'media' | 'links' = 'all') {
    const params = new URLSearchParams({ q: query });
    if (kind !== 'all') params.set('kind', kind);
    return request<{ results: Array<{ user: PublicUser; message: MessengerMessage }> }>(
      `/api/messenger/search?${params.toString()}`,
      { token }
    );
  },
  getScheduledMessages(token: string) {
    return request<{ messages: MessengerMessage[] }>('/api/messenger/scheduled', { token });
  },
  cancelScheduledMessage(token: string, messageId: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/scheduled/${encodeURIComponent(messageId)}`, { token, method: 'DELETE' });
  },
  remindAboutMessage(token: string, messageId: string, inSeconds: number) {
    return request<{ reminder: { id: string; remindAt: string } }>(
      `/api/messenger/messages/${encodeURIComponent(messageId)}/remind`,
      { token, method: 'POST', body: { inSeconds } }
    );
  },
  openViewOnceMedia(token: string, messageId: string) {
    return request<{ mediaItems: ChatMediaItem[]; message: MessengerMessage }>(
      `/api/messenger/messages/${encodeURIComponent(messageId)}/view-once`,
      { token, method: 'POST', body: {} }
    );
  },
  transcribeMessage(token: string, messageId: string) {
    return request<{ transcript: string }>(`/api/messenger/messages/${encodeURIComponent(messageId)}/transcribe`, { token, method: 'POST', body: {} });
  },
  transcribeGroupMessage(token: string, groupId: string, messageId: string) {
    return request<{ transcript: string }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/transcribe`,
      { token, method: 'POST', body: {} }
    );
  },
  getGroupScheduledPosts(token: string, groupId: string) {
    return request<{ messages: GroupMessage[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/scheduled`, { token });
  },
  cancelGroupScheduledPost(token: string, groupId: string, messageId: string) {
    return request<{ message: GroupMessage }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/scheduled/${encodeURIComponent(messageId)}`,
      { token, method: 'DELETE' }
    );
  },
  getFeedChannelStats(token: string, groupId: string, channelId: string) {
    return request<{ totals: { posts: number; views: number; reactions: number; comments: number }; top: Array<{ message: GroupMessage; views: number }> }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/stats`,
      { token }
    );
  },
  getGroupReactionRoles(token: string, groupId: string, messageId: string) {
    return request<{ bindings: ReactionRoleBinding[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/reaction-roles`,
      { token }
    );
  },
  setGroupReactionRoles(token: string, groupId: string, messageId: string, bindings: ReactionRoleBinding[]) {
    return request<{ bindings: ReactionRoleBinding[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/reaction-roles`,
      { token, method: 'PUT', body: { bindings } }
    );
  },
  getGroupAudit(token: string, groupId: string) {
    return request<{ entries: GroupAuditEntry[]; users: Record<string, PublicUser> }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/audit`,
      { token }
    );
  },
  getGroupMessageViewers(token: string, groupId: string, messageId: string) {
    return request<{ viewers: PublicUser[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/viewers`,
      { token }
    );
  },
  getGroupThread(token: string, groupId: string, messageId: string) {
    return request<{ root: GroupMessage; messages: GroupMessage[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/thread`,
      { token }
    );
  },
  sendGroupThreadMessage(token: string, groupId: string, messageId: string, body: string) {
    return request<{ message: GroupMessage }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/thread`,
      { token, method: 'POST', body: { body } }
    );
  },
  summarizeGroupChannel(token: string, groupId: string, channelId: string, count?: number) {
    return request<{ summary: string; messageCount: number }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/summarize`,
      { token, method: 'POST', body: count ? { count } : {} }
    );
  },
  getGroupMessages(token: string, groupId: string, channelId?: string, options?: { before?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (channelId) params.set('channelId', channelId);
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return request<{ messages: GroupMessage[]; hasMore: boolean }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages${qs ? `?${qs}` : ''}`,
      { token }
    );
  },
  getGroupPinnedMessages(token: string, groupId: string, channelId: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    params.set('channelId', channelId);
    if (options?.limit) params.set('limit', String(options.limit));
    return request<{ messages: GroupMessage[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/pinned?${params.toString()}`,
      { token }
    );
  },
  getGroupMediaMessages(token: string, groupId: string, channelId: string, options?: { limit?: number }) {
    const params = new URLSearchParams();
    params.set('channelId', channelId);
    if (options?.limit) params.set('limit', String(options.limit));
    return request<{ messages: GroupMessage[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/messages/media?${params.toString()}`,
      { token }
    );
  },
  getGroupBootstrap(token: string, groupId: string) {
    return request<{
      channels: GroupChannel[];
      roles: GroupRole[];
      members: GroupMember[];
      folders: GroupFolder[];
      customization: { categories: CustomCategory[]; selectedOptionIds: string[]; onboardingRequired: boolean };
    }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/bootstrap`, { token });
  },
  sendGroupMessage(token: string, groupId: string, body: string, channelId?: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }, replyTo?: string, senderGroupId?: string | null, mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>, options?: { scheduledAt?: string }) {
    const mediaUpload = Boolean(image?.dataUrl.startsWith('data:audio/') || image?.dataUrl.startsWith('data:video/'));
    return request<{ message: GroupMessage }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      token,
      body: { body, channelId, image, mediaItems, replyTo, senderGroupId: senderGroupId || undefined, scheduledAt: options?.scheduledAt },
      label: mediaUpload ? 'messenger.sendGroupMedia' : undefined,
      slowRequestMs: mediaUpload ? 3000 : undefined
    });
  },
  replyWithAiGroup(token: string, groupId: string, messageId: string) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/ai-reply`, {
      method: 'POST',
      token,
      label: 'messenger.replyWithAiGroup',
      slowRequestMs: 4000
    });
  },
  getGroupChannels(token: string, groupId: string) {
    return request<{ channels: GroupChannel[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels`, { token });
  },
  createGroupChannel(token: string, groupId: string, name: string, type: 'text' | 'voice' | 'feed' = 'text') {
    return request<{ channel: GroupChannel; channels?: GroupChannel[]; folder?: GroupFolder }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels`, {
      method: 'POST', token, body: { name, type }
    });
  },
  deleteGroupChannel(token: string, groupId: string, channelId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE', token
    });
  },
  updateGroupChannel(token: string, groupId: string, channelId: string, data: { name?: string; position?: number; folderId?: string | null; userLimit?: number | null; topic?: string; slowmodeSeconds?: number; nsfw?: boolean; bitrate?: number; signPosts?: boolean; settings?: Partial<import('./types').ChannelExtraSettings> }) {
    return request<{ channel: GroupChannel }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH', token, body: data
    });
  },
  getMyChannelPermissions(token: string, groupId: string, channelId: string) {
    return request<{ permissions: string[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/permissions/me`, { token });
  },
  cloneGroupChannel(token: string, groupId: string, channelId: string) {
    return request<{ channel: GroupChannel }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/clone`, {
      method: 'POST', token
    });
  },
  resetChannelPermissions(token: string, groupId: string, channelId: string) {
    return request<{ overrides: Array<{ roleId: string; permission: string; value: 'allow' | 'deny' }> }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/permissions/reset`,
      { method: 'POST', token }
    );
  },
  reorderGroupChannels(token: string, groupId: string, items: { id: string; position: number; folderId: string | null }[]) {
    return request<{ channels: GroupChannel[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/reorder`, {
      method: 'POST', token, body: { items }
    });
  },
  getGroupFolders(token: string, groupId: string) {
    return request<{ folders: GroupFolder[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/folders`, { token });
  },
  createGroupFolder(token: string, groupId: string, name: string) {
    return request<{ folder: GroupFolder }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/folders`, {
      method: 'POST', token, body: { name }
    });
  },
  updateGroupFolder(token: string, groupId: string, folderId: string, data: { name?: string; position?: number }) {
    return request<{ folder: GroupFolder }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH', token, body: data
    });
  },
  deleteGroupFolder(token: string, groupId: string, folderId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE', token
    });
  },
  getGroupRoles(token: string, groupId: string) {
    return request<{ roles: GroupRole[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles`, { token });
  },
  createGroupRole(token: string, groupId: string, name: string, color?: string, permissions?: string[]) {
    return request<{ role: GroupRole }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles`, {
      method: 'POST', token, body: { name, color, permissions }
    });
  },
  deleteGroupRole(token: string, groupId: string, roleId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`, {
      method: 'DELETE', token
    });
  },
  updateGroupRole(token: string, groupId: string, roleId: string, data: { name?: string; color?: string; permissions?: string[]; hoist?: boolean; position?: number }) {
    return request<{ role: GroupRole }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`, {
      method: 'PATCH', token, body: data
    });
  },
  reorderGroupRoles(token: string, groupId: string, roleIds: string[]) {
    return request<{ roles: GroupRole[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/reorder`, {
      method: 'POST', token, body: { roleIds }
    });
  },
  duplicateGroupRole(token: string, groupId: string, roleId: string) {
    return request<{ role: GroupRole }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}/duplicate`, {
      method: 'POST', token
    });
  },
  getGroupBans(token: string, groupId: string) {
    return request<{ bans: GroupBan[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/bans`, { token });
  },
  banGroupMember(token: string, groupId: string, userId: string, reason?: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/ban`, {
      method: 'POST', token, body: { reason }
    });
  },
  unbanGroupMember(token: string, groupId: string, userId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/ban`, {
      method: 'DELETE', token
    });
  },
  timeoutGroupMember(token: string, groupId: string, userId: string, minutes: number) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/timeout`, {
      method: 'PATCH', token, body: { minutes }
    });
  },
  setGroupMemberNickname(token: string, groupId: string, userId: string, nickname: string) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/nickname`, {
      method: 'PATCH', token, body: { nickname }
    });
  },
  updateGroupEveryonePermissions(token: string, groupId: string, permissions: string[]) {
    return request<{ group: Group }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/everyone`, {
      method: 'PATCH', token, body: { permissions }
    });
  },
  setGroupDefaultRole(token: string, groupId: string, roleId: string | null) {
    return request<{ group: Group }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/default-role`, {
      method: 'PATCH', token, body: { roleId }
    });
  },

  // ── Server profile customization ──
  getGroupCustomization(token: string, groupId: string) {
    return request<{ categories: CustomCategory[]; selectedOptionIds: string[]; onboardingRequired: boolean }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization`,
      { token }
    );
  },
  createCustomCategory(
    token: string,
    groupId: string,
    data: { name: string; selectionType?: 'multi' | 'single'; hideChannels?: boolean; required?: boolean }
  ) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/categories`,
      { method: 'POST', token, body: data }
    );
  },
  updateCustomCategory(
    token: string,
    groupId: string,
    categoryId: string,
    data: { name?: string; selectionType?: 'multi' | 'single'; hideChannels?: boolean; required?: boolean; position?: number }
  ) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/categories/${encodeURIComponent(categoryId)}`,
      { method: 'PATCH', token, body: data }
    );
  },
  deleteCustomCategory(token: string, groupId: string, categoryId: string) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/categories/${encodeURIComponent(categoryId)}`,
      { method: 'DELETE', token }
    );
  },
  createCustomOption(
    token: string,
    groupId: string,
    categoryId: string,
    data: { label: string; emoji?: string; color?: string }
  ) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/categories/${encodeURIComponent(categoryId)}/options`,
      { method: 'POST', token, body: data }
    );
  },
  updateCustomOption(
    token: string,
    groupId: string,
    optionId: string,
    data: { label?: string; emoji?: string; color?: string }
  ) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/options/${encodeURIComponent(optionId)}`,
      { method: 'PATCH', token, body: data }
    );
  },
  deleteCustomOption(token: string, groupId: string, optionId: string) {
    return request<{ categories: CustomCategory[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/options/${encodeURIComponent(optionId)}`,
      { method: 'DELETE', token }
    );
  },
  toggleCustomOption(token: string, groupId: string, optionId: string) {
    return request<{ selectedOptionIds: string[]; channels: GroupChannel[]; folders: GroupFolder[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/options/${encodeURIComponent(optionId)}/toggle`,
      { method: 'POST', token }
    );
  },
  completeCustomization(token: string, groupId: string) {
    return request<{ success: boolean }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/customization/complete`,
      { method: 'POST', token }
    );
  },
  setChannelRoles(token: string, groupId: string, channelId: string, roleIds: string[]) {
    return request<{ success: boolean }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/roles`,
      { method: 'PUT', token, body: { roleIds } }
    );
  },
  getChannelPermissions(token: string, groupId: string, channelId: string) {
    return request<{ overrides: ChannelPermissionOverride[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/permissions`,
      { token }
    );
  },
  setChannelPermissions(token: string, groupId: string, channelId: string, overrides: Array<{ roleId: string; permission: string; value: 'allow' | 'deny' }>) {
    return request<{ overrides: ChannelPermissionOverride[] }>(
      `/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/permissions`,
      { method: 'PUT', token, body: { overrides } }
    );
  },
  editGroupMessage(token: string, messageId: string, body: string, mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH', token, body: { body, mediaItems }
    });
  },
  deleteGroupMessage(token: string, messageId: string) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE', token
    });
  },
  pinGroupMessage(token: string, messageId: string) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/messages/${encodeURIComponent(messageId)}/pin`, {
      method: 'POST', token
    });
  },
  toggleGroupMessageReaction(token: string, messageId: string, emoji: string) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/messages/${encodeURIComponent(messageId)}/reactions/toggle`, {
      method: 'POST', token, body: { emoji }
    });
  },

  getAiChats(token: string) {
    return request<{ chats: AiChatSummary[]; configured: boolean }>('/api/ai/chats', { token });
  },
  getAiChat(token: string, chatId: string) {
    return request<{ chat: AiChat }>(`/api/ai/chats/${encodeURIComponent(chatId)}`, { token });
  },
  createAiChat(token: string) {
    return request<{ chat: AiChat }>('/api/ai/chats', { method: 'POST', token });
  },
  deleteAiChat(token: string, chatId: string) {
    return request<{ id: string }>(`/api/ai/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE', token });
  },
  sendAiMessage(
    token: string,
    chatId: string,
    content: string,
    context?: {
      localDateTime?: string;
      timeFormat?: '12h' | '24h';
      musicTracks?: { name: string }[];
      image?: { dataUrl: string; name?: string; spoiler?: boolean };
      mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>;
    }
  ) {
    return request<{ chat: AiChat; userMessage: AiChatMessage; assistantMessage: AiChatMessage; quota: AiQuota; user?: PublicUser; settings?: AiSettings }>(
      `/api/ai/chats/${encodeURIComponent(chatId)}/messages`,
      { method: 'POST', token, body: { content, ...context } }
    );
  },
  getAiSettings(token: string) {
    return request<{ settings: AiSettings }>('/api/ai/settings', { token });
  },
  updateAiSettings(token: string, input: Partial<AiSettings>) {
    return request<{ settings: AiSettings }>('/api/ai/settings', { method: 'PATCH', token, body: input });
  },
  generateAiPersonaInstructions(token: string, input: { seed?: string; language?: Language }) {
    return request<{ text: string }>('/api/ai/persona/generate', { method: 'POST', token, body: input });
  },
  translateText(token: string, text: string, target: string) {
    return request<{ text: string }>('/api/ai/translate', { method: 'POST', token, body: { text, target } });
  },
  getAiQuota(token: string) {
    return request<{ quota: AiQuota }>('/api/ai/quota', { token });
  }
};
