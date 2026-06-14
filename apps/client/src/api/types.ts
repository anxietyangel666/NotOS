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
  pinnedImageData: string;
  pinnedCards: PinnedCard[];
  createdAt: string;
  updatedAt: string;
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
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  pinnedAt: string | null;
};

export type ConversationPreview = {
  user: PublicUser;
  message: MessengerMessage;
  unreadCount: number;
};

export type DesktopWallMessage = {
  id: string;
  ownerId: string;
  author: PublicUser;
  body: string;
  createdAt: string;
};

export type FriendRequests = {
  incoming: PublicUser[];
  outgoing: PublicUser[];
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
  createdAt: string;
};

export type GroupMember = {
  user: PublicUser;
  role: string;
  roleId: string | null;
  // Every role the member holds (primary + extra customization roles).
  roleIds: string[];
  joinedAt: string;
};

export type GroupMessage = {
  id: string;
  groupId: string;
  channelId: string | null;
  senderId: string;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  createdAt: string;
};

export type GroupConversationPreview = {
  group: Group;
  message: GroupMessage;
  unreadCount: number;
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

export type GroupChannel = {
  id: string;
  groupId: string;
  name: string;
  position: number;
  folderId: string | null;
  type: 'text' | 'voice';
  userLimit: number | null;
  requiredRoleIds: string[];
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
  screen: boolean;
  talking: boolean;
  joinedAt: number;
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

export type Language = 'en' | 'ru' | 'uk';

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
