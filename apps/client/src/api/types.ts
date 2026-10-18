export type NameStyle = {
  font: string;
  effect: string;
  color: string;
} | null;

export type NamePlateType = 'none' | 'color' | 'gradient' | 'image';

export type NamePlate = {
  type: NamePlateType;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  image: string;
} | null;

export const DEFAULT_NAMEPLATE: NonNullable<NamePlate> = {
  type: 'none',
  color: '#1f2733',
  gradientFrom: '#2aabee',
  gradientTo: '#5865f2',
  image: ''
};

// Returns a CSS background value for a nameplate, or null when not customized.
export function nameplateToCss(plate: NamePlate): string | null {
  if (!plate) return null;
  switch (plate.type) {
    case 'color':
      return plate.color;
    case 'gradient':
      return `linear-gradient(90deg, ${plate.gradientFrom} 0%, ${plate.gradientTo} 100%)`;
    case 'image':
      return plate.image ? `url("${plate.image}")` : null;
    default:
      return null;
  }
}

// A single image card pinned to the desktop. Position (x/y) is stored as a
// fraction of the viewport (0..1); width/height are in pixels.
export type PinnedCard = {
  id: string;
  // Media payload (data URL). Kept as `imageData` for backward compatibility
  // with existing saved cards; videos also use this field.
  imageData: string;
  name: string;
  // Defaults to 'image' when absent so old saved cards keep working.
  kind?: 'image' | 'video';
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PublicUser = {
  id: string;
  nickname: string;
  role: 'user' | 'dev';
  nameStyle: NameStyle;
  profilePrimaryColor: string;
  profileAccentColor: string;
  nameplate: NamePlate;
  avatarData: string;
  wallpaper: string;
  language: Language;
  theme: Theme;
  accentColor: string;
  transparencyEnabled: boolean;
  desktopIcons: DesktopIconPositions;
  desktopIconSize: DesktopIconSize;
  hideDesktopIcons: boolean;
  desktopSort: DesktopSort;
  status: string;
  voiceBio?: string | null;
  pinnedImageData: string;
  pinnedCards: PinnedCard[];
  allowGroupIdentityMessages: boolean;
  xp: number;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionProvider = 'spotify' | 'riot';

export type UserConnection = {
  provider: ConnectionProvider;
  connected: boolean;
  displayName: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type UserActivity =
  | {
      provider: 'spotify';
      type: 'listening';
      title: string;
      subtitle: string;
      album: string;
      imageUrl: string;
      url: string;
      progressMs: number;
      durationMs: number;
      fetchedAt?: number;
    }
  | {
      provider: 'riot';
      type: 'playing';
      title: string;
      subtitle: string;
      riotId: string;
      region: string;
      gameStartTime: number | null;
      fetchedAt?: number;
    };

export type DesktopIconSize = 'small' | 'medium' | 'large';

export type DesktopSort = 'custom' | 'name' | 'type' | 'size' | 'date';

export type DesktopIconPosition = {
  x: number;
  y: number;
  kind?: 'app' | 'storage-item' | 'remote-desktop';
  storageItemId?: string;
  remoteUserId?: string;
  label?: string;
  itemType?: 'folder' | 'text' | 'file';
  size?: number;
  updatedAt?: string;
};

export type DesktopIconPositions = Record<string, DesktopIconPosition>;

export type StorageItem = {
  id: string;
  type: 'folder' | 'text' | 'file';
  name: string;
  parentId: string | null;
  content?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  updatedAt: string;
};

export type StoragePayload = {
  items: StorageItem[];
};

export type MessengerMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  mediaItems?: ChatMediaItem[];
  editedAt: string | null;
  deletedAt: string | null;
  readAt: string | null;
  createdAt: string;
  pinnedAt: string | null;
  reactions: GroupMessageReaction[];
  replyTo: MessageReplySnippet | null;
  linkPreview?: LinkPreview | null;
  // Disappearing message: when the server will delete it.
  expiresAt?: string | null;
  // Set while the message is waiting for its scheduled delivery time.
  scheduledAt?: string | null;
  // Parked until the recipient comes online.
  awaitingOnline?: boolean;
  // Attachment that self-destructs once the recipient opens it.
  viewOnce?: boolean;
  viewOnceSeenAt?: string | null;
  aiGenerated?: boolean;
  aiName?: string | null;
  aiAvatarData?: string | null;
  // Client-only: a stable React key kept across the optimistic→server swap so
  // the bubble reconciles in place instead of remounting (no flash/jump). Also
  // marks a message as still-sending for a subtle pending style.
  clientKey?: string;
  pending?: boolean;
};

// A poll linked from a [poll:<id>] marker message.
export type PublicPoll = {
  id: string;
  creatorId: string;
  question: string;
  multi: boolean;
  options: Array<{ text: string; voterIds: string[] }>;
  totalVoters: number;
  createdAt: string;
};

// OpenGraph preview of the first URL in a message body, attached by the server
// shortly after the message is sent.
export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
};

export type MessageReplySnippet = {
  id: string;
  senderId: string;
  senderGroup?: { id: string; name: string; avatarData: string } | null;
  aiGenerated?: boolean;
  aiName?: string | null;
  aiAvatarData?: string | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  mediaItems?: ChatMediaItem[];
  deletedAt?: string | null;
  feedPost?: boolean;
  feedSourceId?: string | null;
  feedMirror?: boolean;
  viewCount?: number;
  reactions?: GroupMessageReaction[];
  createdAt?: string;
};

export type ChatMediaItem = {
  dataUrl: string;
  name: string | null;
  spoiler: boolean;
};

export type ConversationPreview = {
  user: PublicUser;
  message: MessengerMessage;
  unreadCount: number;
};

export type ConversationSettings = {
  backgroundData: string;
  messageTtlSeconds: number;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type DesktopWallMessage = {
  id: string;
  ownerId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
  // Client-only: see MessengerMessage.clientKey/pending.
  clientKey?: string;
  pending?: boolean;
};

export type FriendRequestUser = PublicUser & {
  requestCreatedAt?: string;
};

export type FriendRequests = {
  incoming: FriendRequestUser[];
  outgoing: FriendRequestUser[];
};

export type Group = {
  id: string;
  name: string;
  avatarData: string;
  ownerId: string;
  inviteCode: string;
  nameplate: NamePlate | null;
  description: string;
  defaultRoleId: string | null;
  everyonePermissions: string[];
  automodWords: string[];
  createdAt: string;
};

export type GroupMember = {
  user: PublicUser;
  role: string;
  roleId: string | null;
  // Every role the member holds (primary + extra customization roles).
  roleIds: string[];
  nickname?: string;
  timeoutUntil?: string | null;
  joinedAt: string;
};

export type GroupInvite = {
  id: string;
  groupId: string;
  channelId: string | null;
  code: string;
  creator: PublicUser | null;
  usesCount: number;
  maxUses?: number | null;
  expiresAt?: string | null;
  createdAt: string;
};

export type GroupBan = {
  userId: string;
  user: PublicUser | null;
  reason: string;
  bannedBy: string | null;
  createdAt: string;
};

export type ChannelPermissionOverride = {
  channelId: string;
  roleId: string;
  permission: string;
  value: 'allow' | 'deny';
};

export type GroupMessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type GroupMessage = {
  id: string;
  groupId: string;
  channelId: string | null;
  senderId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  mediaItems?: ChatMediaItem[];
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  feedSourceId: string | null;
  feedMirror: boolean;
  viewCount: number;
  reactions: GroupMessageReaction[];
  replyTo: MessageReplySnippet | null;
  linkPreview?: LinkPreview | null;
  threadRootId?: string | null;
  threadCount?: number;
  commentCount?: number;
  scheduledAt?: string | null;
  aiGenerated?: boolean;
  aiName?: string | null;
  aiAvatarData?: string | null;
  createdAt: string;
  // Client-only: see MessengerMessage.clientKey/pending.
  clientKey?: string;
  pending?: boolean;
};

export type GroupConversationPreview = {
  group: Group;
  message: GroupMessage;
  unreadCount: number;
};

export type MentionNotification = {
  id: string;
  kind: 'dm' | 'group';
  messageId: string;
  createdAt: string;
  sender: PublicUser;
  body: string;
  imageData: string | null;
  imageName: string | null;
  group?: Group;
  channelId?: string | null;
};

export type GroupRole = {
  id: string;
  groupId: string;
  name: string;
  color: string;
  position: number;
  isOwner: boolean;
  permissions: string[];
  hoist: boolean;
};

export type ChannelDefaultNotifications = 'all' | 'mentions' | 'nothing';
export type ChannelVideoQuality = 'auto' | '720' | '1080';
export type ChannelVoiceMode = 'voice_activity' | 'ptt';

export type ChannelExtraSettings = {
  privateChannel: boolean;
  locked: boolean;
  announcement: boolean;
  defaultNotifications: ChannelDefaultNotifications;
  videoQuality: ChannelVideoQuality;
  rtcRegion: string;
  defaultAutoArchiveMinutes: number;
  newMemberSlowmodeSeconds: number;
  disableReactions: boolean;
  voiceMode: ChannelVoiceMode;
  videoEnabled: boolean;
  streamEnabled: boolean;
  hideInactive: boolean;
  defaultThreadSlowmodeSeconds: number;
};

export const DEFAULT_CHANNEL_EXTRA_SETTINGS: ChannelExtraSettings = {
  privateChannel: false,
  locked: false,
  announcement: false,
  defaultNotifications: 'all',
  videoQuality: 'auto',
  rtcRegion: 'automatic',
  defaultAutoArchiveMinutes: 1440,
  newMemberSlowmodeSeconds: 0,
  disableReactions: false,
  voiceMode: 'voice_activity',
  videoEnabled: true,
  streamEnabled: true,
  hideInactive: false,
  defaultThreadSlowmodeSeconds: 0
};

export function normalizeChannelExtraSettings(raw: unknown): ChannelExtraSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const notifications = value.defaultNotifications;
  const videoQuality = value.videoQuality;
  const voiceMode = value.voiceMode;
  return {
    privateChannel: Boolean(value.privateChannel),
    locked: Boolean(value.locked),
    announcement: Boolean(value.announcement),
    defaultNotifications: notifications === 'mentions' || notifications === 'nothing' ? notifications : 'all',
    videoQuality: videoQuality === '720' || videoQuality === '1080' ? videoQuality : 'auto',
    rtcRegion: typeof value.rtcRegion === 'string' && value.rtcRegion.trim() ? value.rtcRegion.trim().slice(0, 40) : 'automatic',
    defaultAutoArchiveMinutes: [60, 1440, 4320, 10080].includes(Number(value.defaultAutoArchiveMinutes))
      ? Number(value.defaultAutoArchiveMinutes)
      : 1440,
    newMemberSlowmodeSeconds: Math.max(0, Math.min(604800, Number(value.newMemberSlowmodeSeconds) || 0)),
    disableReactions: Boolean(value.disableReactions),
    voiceMode: voiceMode === 'ptt' ? 'ptt' : 'voice_activity',
    videoEnabled: value.videoEnabled !== false,
    streamEnabled: value.streamEnabled !== false,
    hideInactive: Boolean(value.hideInactive),
    defaultThreadSlowmodeSeconds: Math.max(0, Math.min(21600, Number(value.defaultThreadSlowmodeSeconds) || 0))
  };
}

export type GroupChannel = {
  id: string;
  groupId: string;
  name: string;
  position: number;
  folderId: string | null;
  type: 'text' | 'voice' | 'feed';
  userLimit: number | null;
  topic: string;
  slowmodeSeconds: number;
  nsfw: boolean;
  bitrate: number;
  feedChatChannelId: string | null;
  signPosts?: boolean;
  feedParentChannelId: string | null;
  requiredRoleIds: string[];
  settings: ChannelExtraSettings;
};

export type CustomOption = {
  id: string;
  categoryId: string;
  label: string;
  emoji: string;
  color: string;
  roleId: string | null;
  folderId: string | null;
  position: number;
};

export type CustomCategory = {
  id: string;
  groupId: string;
  name: string;
  selectionType: 'multi' | 'single';
  hideChannels: boolean;
  required: boolean;
  position: number;
  options: CustomOption[];
};

export type VoiceParticipant = {
  userId: string;
  user: PublicUser;
  muted: boolean;
  deafened?: boolean;
  screen: boolean;
  camera?: boolean;
  cameraStreamId?: string;
  screenStreamId?: string;
  talking: boolean;
  joinedAt: number;
};

export type WatchQueueItem = {
  id: string;
  source: {
    kind: 'youtube' | 'url' | 'embed';
    value: string;
    title: string;
    addedBy: string;
  };
  addedByUserId: string;
  addedByNickname: string;
  addedByNameStyle?: NameStyle;
  thumbnailUrl?: string;
  createdAt: number;
};

export type VoiceChatMessage = {
  id: string;
  channelId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  body: string;
  createdAt: string;
};

export type GroupFolder = {
  id: string;
  groupId: string;
  name: string;
  position: number;
  requiredRoleId: string | null;
};

export type PublicAudioTrack = {
  id: string;
  name: string;
  dataUrl: string;
  mimeType?: string;
  size?: number;
  updatedAt?: string;
};

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageData?: string | null;
  imageName?: string | null;
  imageSpoiler?: boolean;
  mediaItems?: ChatMediaItem[];
  createdAt: string;
};

export type AiChat = {
  id: string;
  title: string;
  messages: AiChatMessage[];
  updatedAt: string;
};

export type AiChatSummary = {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AiPersonaGender = 'male' | 'female' | 'neutral';
export type AiPersona = 'friendly' | 'professional' | 'playful' | 'mentor' | 'concise' | 'enthusiastic';
export type AiTone = 'formal' | 'balanced' | 'casual';
export type AiResponseLength = 'short' | 'balanced' | 'detailed';
export type AiEmojiUsage = 'none' | 'some' | 'many';

export type AiSettings = {
  assistantName: string;
  assistantAvatarData: string;
  gender: AiPersonaGender;
  persona: AiPersona;
  tone: AiTone;
  responseLength: AiResponseLength;
  emojiUsage: AiEmojiUsage;
  addressName: string;
  customInstructions: string;
  onboarded: boolean;
};

export type AiQuota = {
  limit: number | null;
  used: number;
  remaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
};

export type Language = 'en' | 'ru' | 'uk' | 'zh' | 'zh-TW';

export type Theme = 'light' | 'dark' | 'system-black' | 'mint' | 'ocean';

export type AuthFileBundle = {
  filename: string;
  mimeType: string;
  content: string;
};

export type RegisterResponse = {
  token: string;
  user: PublicUser;
  recoveryKey: string;
  authFile: AuthFileBundle;
};

export type LoginResponse = {
  token: string;
  user: PublicUser;
};

export type RecoverResponse = {
  token: string;
  user: PublicUser;
  authFile: AuthFileBundle;
};

export type AuthenticatedResponse = RegisterResponse | LoginResponse | RecoverResponse;

export type ReactionRoleBinding = { emoji: string; roleId: string };

export type GroupAuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  target: string;
  details: Record<string, unknown>;
  createdAt: string;
};
