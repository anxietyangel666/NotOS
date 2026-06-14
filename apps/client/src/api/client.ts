import type {
  AiChat,
  AiChatMessage,
  AiQuota,
  AiSettings,
  AiChatSummary,
  ConversationPreview,
  DesktopIconPositions,
  DesktopIconSize,
  DesktopSort,
  DesktopWallMessage,
  FriendRequests,
  Group,
  GroupChannel,
  GroupFolder,
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
  PublicUser,
  RecoverResponse,
  RegisterResponse,
  StoragePayload,
  Theme
} from './types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token?: string | null;
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new Error(data?.message ?? 'API request failed');
  }

  return data as T;
}

export const api = {
  register(input: { nickname: string; avatarData: string; language?: Language; theme?: Theme }) {
    return request<RegisterResponse>('/api/auth/register', {
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
      pinnedImageData?: string;
      pinnedCards?: PinnedCard[];
      nameStyle?: NameStyle;
      profilePrimaryColor?: string;
      profileAccentColor?: string;
      nameplate?: NamePlate | null;
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
  getMessages(token: string, userId: string) {
    return request<{ messages: MessengerMessage[] }>(`/api/messenger/messages/${encodeURIComponent(userId)}`, { token });
  },
  getConversations(token: string) {
    return request<{ conversations: ConversationPreview[] }>('/api/messenger/conversations', { token });
  },
  sendMessage(token: string, recipientId: string, body: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }) {
    return request<{ message: MessengerMessage }>('/api/messenger/messages', {
      method: 'POST',
      token,
      body: { recipientId, body, image }
    });
  },
  editMessage(token: string, messageId: string, body: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      token,
      body: { body }
    });
  },
  deleteMessage(token: string, messageId: string) {
    return request<{ message: MessengerMessage }>(`/api/messenger/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      token
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
  getDesktopWall(token: string, ownerId: string) {
    return request<{ messages: DesktopWallMessage[] }>(`/api/desktop-wall/${encodeURIComponent(ownerId)}`, { token });
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
  updateGroup(token: string, groupId: string, input: { name?: string; avatarData?: string; nameplate?: NamePlate | null }) {
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
  updateGroupMemberRole(token: string, groupId: string, userId: string, roleId: string | null) {
    return request<{ members: GroupMember[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH', token, body: { roleId }
    });
  },
  regenerateInvite(token: string, groupId: string) {
    return request<{ inviteCode: string }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/invite`, {
      method: 'POST', token
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
  getGroupMessages(token: string, groupId: string, channelId?: string) {
    const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return request<{ messages: GroupMessage[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages${query}`, { token });
  },
  sendGroupMessage(token: string, groupId: string, body: string, channelId?: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST', token, body: { body, channelId, image }
    });
  },
  getGroupChannels(token: string, groupId: string) {
    return request<{ channels: GroupChannel[] }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels`, { token });
  },
  createGroupChannel(token: string, groupId: string, name: string, type: 'text' | 'voice' = 'text') {
    return request<{ channel: GroupChannel }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels`, {
      method: 'POST', token, body: { name, type }
    });
  },
  deleteGroupChannel(token: string, groupId: string, channelId: string) {
    return request<{ success: boolean }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'DELETE', token
    });
  },
  updateGroupChannel(token: string, groupId: string, channelId: string, data: { name?: string; position?: number; folderId?: string | null; userLimit?: number | null }) {
    return request<{ channel: GroupChannel }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH', token, body: data
    });
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
  updateGroupRole(token: string, groupId: string, roleId: string, data: { name?: string; color?: string; permissions?: string[]; hoist?: boolean }) {
    return request<{ role: GroupRole }>(`/api/messenger/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`, {
      method: 'PATCH', token, body: data
    });
  },
  editGroupMessage(token: string, messageId: string, body: string) {
    return request<{ message: GroupMessage }>(`/api/messenger/groups/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH', token, body: { body }
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
    }
  ) {
    return request<{ chat: AiChat; userMessage: AiChatMessage; assistantMessage: AiChatMessage; quota: AiQuota }>(
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
  getAiQuota(token: string) {
    return request<{ quota: AiQuota }>('/api/ai/quota', { token });
  }
};
