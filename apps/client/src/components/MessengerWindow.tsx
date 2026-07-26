import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { api } from '../api/client';
import { cacheUser, getOrFetchUser } from '../api/user-cache';
import { useSocket } from '../hooks/use-socket';
import type { ChatMediaItem, ConversationPreview, FriendRequests, Group, GroupConversationPreview, GroupMessage, GroupRole, Language, MessengerMessage, PublicUser, StorageItem, AiSettings } from '../api/types';
import { nameplateToCss } from '../api/types';
import { readImageAsDataUrl } from '../auth/auth-file';
import { LOCALES, t, getSavedTimeFormat, getSavedTranslateTargetName, getSavedComposerTranslateTargetName } from '../i18n';
import { EmojiPicker, GifStar } from './EmojiPicker';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { gifFromUrl, isFavoriteGifUrl, subscribeFavoriteGifs, toggleFavoriteGif, type TenorGif } from '../utils/tenor';
import { GroupChatView } from './GroupChatView';
import { GroupCreateModal } from './GroupCreateModal';
import { RailFolders, type RailItem } from './RailFolders';
import { InviteEmbed } from './InviteEmbed';
import { UserEmbed } from './UserEmbed';
import { LinkPreviewCard } from './LinkPreviewCard';
import { applySlashCommand, SLASH_COMMANDS } from '../utils/slash-commands';
import { UserName } from './UserName';
import { extractProfileUserId } from '../utils/profile-link';
import { extractGroupInviteChannelId, extractGroupInviteCode } from '../utils/group-invite-link';
import { extractWatchInvite } from '../utils/watch-invite-link';
import { openExternalUrl } from '../utils/external-url';
import { ProfileModal } from './ProfileModal';
import { MessageText, MessagePreviewText, Twemoji } from './Twemoji';
import { expandCustomEmojiShortcodes, extractSharedPack, stripPackLinks, hasPackLink, splitCustomEmoji } from '../utils/custom-emoji';
import { recordRecentEmoji } from '../utils/recent-emoji';
import { QUICK_REACTIONS, ReactionEmoji, ReplyQuote, ReplyComposerBar, ForwardModal, ForwardedCard, type ForwardTarget, MenuReplyIcon, MenuForwardIcon, MenuPinIcon, MenuDeleteIcon, MenuEditIcon, MenuTranslateIcon, MenuCopyIcon, MenuCutIcon, MenuPasteIcon } from './MessageActions';
import { encodeForward, parseForward } from '../utils/forward';
import type { MessageReplySnippet } from '../api/types';
import { CustomEmojiPackEmbed } from './CustomEmojiPackEmbed';
import { WatchInviteEmbed } from './WatchInviteEmbed';
import { SpotifyActivityLine } from './UserActivityStatus';
import { EmojiToggleIcon, AttachIcon, GifIcon } from './ChatComposeIcons';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';
import { WindowFrame } from './WindowFrame';
import { AiDmThread } from './AiDmThread';
import { isVideoCircleAttachment, isVoiceAttachment, VideoCircleMessagePlayer, VideoCirclePlaybackBar, VoiceMessagePlayer, VoicePlaybackBar, VoiceRecorderControl } from './VoiceMessage';
import { copyImageToClipboard, MediaLightbox, type MediaLightboxItem } from './MediaLightbox';
import { CallAudioSink, CallInviteModal, CallStagePanel, ScreenSourcePicker } from './CallOverlay';
import { useVoiceCall, type CallEndedEvent } from '../hooks/use-voice-call';
import { useVoiceRoom } from '../hooks/use-voice-room';
import { useAnchoredMenu } from '../hooks/use-anchored-menu';
import { Tooltip } from './Tooltip';
import { VoiceAudioSink } from './VoiceAudioSink';
import { callMessageLabel, parseCallMarker } from '../utils/call-messages';
import { useUserStatus, type PresenceStatus } from '../utils/user-status';
import { applyPresenceChange, normalizePresenceSnapshot, onlineIdsFromPresence, type PresenceChangedPayload, type PresenceSnapshotPayload } from '../utils/presence';
import { assetUrl } from '../utils/assets';

export type OngoingCallInfo = {
  phase: 'connecting' | 'active';
  peer: PublicUser | null;
  elapsed: number;
  videoStream: MediaStream | null;
  hangup: () => void;
};

type MessengerWindowProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  initialChatUserId?: string | null;
  initialChatRequestId?: number;
  initialGroupRequest?: { groupId: string; group: Group; channelId: string | null; requestId: number } | null;
  maximized: boolean;
  minimized?: boolean;
  zIndex: number;
  pendingCallAccept?: { callId: string; callerId: string } | null;
  onPendingCallHandled?: () => void;
  onCallStateChange?: (info: OngoingCallInfo | null) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onViewDesktop: (user: PublicUser) => void;
  onActiveChatChange: (userId: string | null) => void;
  onActiveGroupChange?: (groupId: string | null) => void;
  groupMentionCounts?: Record<string, number>;
  onGroupMentionsRead?: (groupId: string) => void;
  onUserChange?: (user: PublicUser) => void;
  onEditProfile?: () => void;
  onOpenWatchTogether?: (inviteCode?: string) => void;
  onOpenInbox?: () => void;
  inboxUnreadCount?: number;
};

type SenderGroupSnapshot = NonNullable<MessengerMessage['senderGroup']>;

type GroupIdentityProfileState = {
  group: Group;
  memberCount: number;
  isMember: boolean;
  loading: boolean;
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  error?: string;
};

type FriendsTab = 'online' | 'all' | 'requests' | 'sendRequest';
type RightPanelSection = 'images' | 'gifs' | 'links' | 'groups' | 'friends';

type MessengerNavLocation = {
  activeView: 'friends' | 'directMessages';
  friendsTab: FriendsTab;
  selectedUserId: string | null;
  selectedGroupId: string | null;
  searchMode: boolean;
  rightPanelOpen: boolean;
};

function sameMessengerNavLocation(a: MessengerNavLocation, b: MessengerNavLocation) {
  return a.activeView === b.activeView
    && a.friendsTab === b.friendsTab
    && a.selectedUserId === b.selectedUserId
    && a.selectedGroupId === b.selectedGroupId
    && a.searchMode === b.searchMode
    && a.rightPanelOpen === b.rightPanelOpen;
}

type PendingChatImage = {
  dataUrl: string;
  name: string;
  spoiler: boolean;
};

type SharedMediaPanelItem = {
  key: string;
  messageId: string | null;
  src: string;
  name: string;
  createdAt: string;
  senderName?: string;
  senderUser?: PublicUser;
  kind: 'image' | 'gif';
};

type FriendsChangedPayload = {
  friends: PublicUser[];
  requests: FriendRequests;
};

type MessengerBootstrapPayload = {
  friends: PublicUser[];
  requests: FriendRequests;
  conversations: ConversationPreview[];
  groups: Group[];
  groupConversations: GroupConversationPreview[];
};

const EMPTY_REQUESTS: FriendRequests = { incoming: [], outgoing: [] };
const MESSENGER_HOME_ICON = assetUrl('Emoji/home.png');
const MESSENGER_PIN_ICON = assetUrl('Emoji/pin.png');
const MESSENGER_READ_ICON = assetUrl('Emoji/read.png');
const MESSENGER_UNREAD_ICON = assetUrl('Emoji/unread.png');
const MESSAGE_EDIT_WINDOW_MS = 10 * 60 * 1000;
const MESSAGE_EDIT_RECENT_LIMIT = 5;
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_CHAT_MEDIA_BATCH = 10;
const PINNED_KEY = 'notoc.messenger.pinned';
const MESSAGE_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const CHAT_BACKGROUND_SET_MARKER = '[chat-background:set]';
const CHAT_BACKGROUND_CLEAR_MARKER = '[chat-background:clear]';
const MESSENGER_BOOTSTRAP_TTL_MS = 2 * 60_000;
const DM_THREAD_CACHE_TTL_MS = 5 * 60_000;
const BLOCK_STATE_CACHE_TTL_MS = 5 * 60_000;
const AI_ASSISTANT_USER_ID = '00000000-0000-4000-8000-0000000000a1';
const AI_ASSISTANT_AVATAR = assetUrl('Icons/ai.png');
let messengerBootstrapCache: { token: string; payload: MessengerBootstrapPayload; loadedAt: number } | null = null;
const dmThreadCache = new Map<string, MessengerMessage[]>();
const dmThreadCacheLoadedAt = new Map<string, number>();
const dmBlockStateCache = new Map<string, { state: { blocked: boolean; blockedMe: boolean }; loadedAt: number }>();
const CHAT_SKELETON_ROWS = [
  { width: 68, extra: 42 },
  { width: 82, media: true },
  { width: 56, mine: true },
  { width: 74, extra: 34 },
  { width: 60, media: true, mine: true },
  { width: 88, extra: 50 },
  { width: 64 },
  { width: 78, media: true },
  { width: 52, mine: true },
  { width: 84, extra: 38 },
  { width: 70, media: true, mine: true },
  { width: 58, extra: 32 }
] satisfies Array<{ width: number; extra?: number; media?: boolean; mine?: boolean }>;

function isAiAssistantUserId(userId: string) {
  return userId === AI_ASSISTANT_USER_ID;
}

function buildAiAssistantUser(currentUser: PublicUser, assistantName: string, assistantAvatarData: string): PublicUser {
  return {
    id: AI_ASSISTANT_USER_ID,
    nickname: assistantName || 'NotAI',
    role: 'user',
    avatarData: assistantAvatarData || AI_ASSISTANT_AVATAR,
    wallpaper: '',
    language: currentUser.language,
    theme: currentUser.theme,
    accentColor: currentUser.accentColor,
    transparencyEnabled: currentUser.transparencyEnabled,
    desktopIcons: {},
    desktopIconSize: currentUser.desktopIconSize,
    hideDesktopIcons: false,
    desktopSort: 'custom',
    status: '',
    pinnedImageData: '',
    pinnedCards: [],
    nameStyle: null,
    profilePrimaryColor: currentUser.profilePrimaryColor,
    profileAccentColor: currentUser.profileAccentColor,
    nameplate: null,
    allowGroupIdentityMessages: false,
    createdAt: currentUser.createdAt,
    updatedAt: currentUser.updatedAt
  };
}

function dmCacheKey(currentUserId: string, peerId: string) {
  return `${currentUserId}:${peerId}`;
}

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function savePinned(pinned: Set<string>) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned])); } catch { }
}

// Archived conversations are hidden from the list until they get a new message
// or the user opens the Archive filter. Stored locally like pinned chats.
const ARCHIVED_KEY = 'notoc.messenger.archived';

function loadArchived(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveArchived(archived: Set<string>) {
  try { localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...archived])); } catch { }
}

// Per-conversation "translate incoming messages automatically" toggle.
const AUTO_TRANSLATE_KEY = 'notoc.messenger.autoTranslate';

function loadAutoTranslate(): Set<string> {
  try {
    const raw = localStorage.getItem(AUTO_TRANSLATE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveAutoTranslate(ids: Set<string>) {
  try { localStorage.setItem(AUTO_TRANSLATE_KEY, JSON.stringify([...ids])); } catch { }
}

type DmListFilter = 'all' | 'unread' | 'archived';

function dmBackgroundsKey(currentUserId: string) {
  return `notoc.messenger.backgrounds.${currentUserId}`;
}

function loadDmBackgrounds(currentUserId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(dmBackgroundsKey(currentUserId));
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveDmBackgrounds(currentUserId: string, backgrounds: Record<string, string>) {
  try { localStorage.setItem(dmBackgroundsKey(currentUserId), JSON.stringify(backgrounds)); } catch { }
}

function formatMessageTime(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(new Date(value));
}

function formatConversationDate(value: string, language: Language) {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfMessageDay) / 86_400_000);

  if (dayDifference === 0) return formatMessageTime(value, language);
  if (dayDifference === 1) return t(language, 'yesterday');

  return new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date);
}

function formatReadReceiptTime(value: string, language: Language) {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000);
  const time = formatMessageTime(value, language);

  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `${t(language, 'yesterday')}, ${time}`;

  return new Intl.DateTimeFormat(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(date);
}

function readReceiptLabel(user: PublicUser, readAt: string, language: Language) {
  const at = formatReadReceiptTime(readAt, language);
  if (language === 'ru') return `Прочитано ${user.nickname}: ${at}`;
  if (language === 'uk') return `Прочитано ${user.nickname}: ${at}`;
  return `Read by ${user.nickname}: ${at}`;
}

function formatCallLogDuration(seconds: number, language: Language) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (language === 'en') {
    const parts: string[] = [];
    if (hours === 1 && minutes === 0) return 'an hour';
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (parts.length === 0) return secs <= 1 ? 'a second' : `${secs} seconds`;
    return parts.join(' ');
  }

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${language === 'uk' ? 'год' : 'ч'}`);
  if (minutes > 0) parts.push(`${minutes} ${language === 'uk' ? 'хв' : 'мин'}`);
  if (parts.length === 0) parts.push(`${Math.max(1, secs)} ${language === 'uk' ? 'с' : 'с'}`);
  return parts.join(' ');
}

function callLogSystemText(message: MessengerMessage, currentUserId: string, language: Language) {
  const marker = parseCallMarker(message.body);
  if (!marker) return null;
  const callerIsMe = message.senderId === currentUserId;

  if (language === 'ru') {
    if (marker.kind === 'ended') return `начал звонок, который длился ${formatCallLogDuration(marker.duration, language)}.`;
    if (marker.kind === 'missed') return callerIsMe ? 'начал звонок, но ответа не было.' : 'начал пропущенный звонок.';
    if (marker.kind === 'declined') return 'начал звонок, который был отклонён.';
    return 'начал звонок, который был отменён.';
  }

  if (language === 'uk') {
    if (marker.kind === 'ended') return `почав дзвінок, який тривав ${formatCallLogDuration(marker.duration, language)}.`;
    if (marker.kind === 'missed') return callerIsMe ? 'почав дзвінок без відповіді.' : 'почав пропущений дзвінок.';
    if (marker.kind === 'declined') return 'почав дзвінок, який було відхилено.';
    return 'почав дзвінок, який було скасовано.';
  }

  if (marker.kind === 'ended') return `started a call that lasted ${formatCallLogDuration(marker.duration, language)}.`;
  if (marker.kind === 'missed') return callerIsMe ? 'started a call that was not answered.' : 'started a missed call.';
  if (marker.kind === 'declined') return 'started a call that was declined.';
  return 'started a call that was cancelled.';
}

function parseChatBackgroundMarker(body: string) {
  if (body === CHAT_BACKGROUND_SET_MARKER) return 'set';
  if (body === CHAT_BACKGROUND_CLEAR_MARKER) return 'clear';
  return null;
}

// `[chat-ttl:N]` system marker: the disappearing-message timer was changed.
function parseChatTtlMarker(body: string): number | null {
  const match = /^\[chat-ttl:(\d+)\]$/.exec(body);
  return match ? Number(match[1]) : null;
}

function chatTtlLabel(seconds: number, language: Language) {
  if (seconds >= 604800) return language === 'ru' ? '7 дней' : '7 days';
  if (seconds >= 86400) return language === 'ru' ? '24 часа' : '24 hours';
  if (seconds >= 3600) return language === 'ru' ? '1 час' : '1 hour';
  return '';
}

function chatTtlEventText(seconds: number, actorName: string, language: Language) {
  if (seconds > 0) {
    return language === 'ru'
      ? `${actorName} включил(а) исчезающие сообщения: ${chatTtlLabel(seconds, language)}`
      : `${actorName} enabled disappearing messages: ${chatTtlLabel(seconds, language)}`;
  }
  return language === 'ru'
    ? `${actorName} отключил(а) исчезающие сообщения`
    : `${actorName} turned off disappearing messages`;
}

function chatBackgroundEventText(action: 'set' | 'clear', actorName: string, language: Language) {
  if (language === 'ru') {
    return action === 'set'
      ? `${actorName} \u0438\u0437\u043c\u0435\u043d\u0438\u043b(\u0430) \u0444\u043e\u043d \u0447\u0430\u0442\u0430`
      : `${actorName} \u0443\u0431\u0440\u0430\u043b(\u0430) \u0444\u043e\u043d \u0447\u0430\u0442\u0430`;
  }
  return action === 'set'
    ? `${actorName} changed the chat background`
    : `${actorName} removed the chat background`;
}

function uniqueById(users: PublicUser[]) {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function unreadLabel(count: number) {
  return count > 9 ? '9+' : String(count);
}

function mentionToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function messageMentionTokens(body: string) {
  return new Set(Array.from(body.matchAll(/(?:^|[\s([{<])@([\p{L}\p{N}_.-]{1,50})/gu), (match) => mentionToken(match[1])));
}

function messageRunIdentity(message: MessengerMessage) {
  return message.senderGroup ? `group:${message.senderGroup.id}:user:${message.senderId}` : `user:${message.senderId}`;
}

// Builds the inline background style for a user's nameplate, applied behind
// that user's own card in friend / conversation lists.
function nameplateStyle(user: PublicUser): React.CSSProperties | undefined {
  const css = nameplateToCss(user.nameplate);
  return css ? { '--nameplate-bg': css } as React.CSSProperties : undefined;
}

// Build the same CSS `background` value the desktop uses for a user's wallpaper:
// data-URL images become url(...), gradients/CSS pass through, and an empty
// wallpaper falls back to a theme-appropriate gradient.
function wallpaperBackground(value: string, theme: string): string {
  const isDark = theme === 'dark' || theme === 'system-black';
  if (!value) {
    return isDark
      ? 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)'
      : 'linear-gradient(135deg, #2AABEE 0%, #1c7fb8 100%)';
  }
  if (value.startsWith('data:image/')) return `url("${value}") center / cover`;
  return value;
}

function isImageStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('image/') || item.content?.startsWith('data:image/'));
}

function extractMessageUrls(text: string) {
  MESSAGE_URL_RE.lastIndex = 0;
  return splitCustomEmoji(text)
    .filter((part) => part.type === 'text')
    .flatMap((part) => {
      MESSAGE_URL_RE.lastIndex = 0;
      return Array.from(part.value.matchAll(MESSAGE_URL_RE), (match) => match[0].replace(/[),.;!?]+$/g, ''));
    });
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isGifSource(src: string) {
  if (src.startsWith('data:image/gif')) return true;
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const parsed = new URL(src);
    const host = parsed.hostname.replace(/^www\./, '');
    if (parsed.pathname.startsWith('/uploads/chat/')) return /\.gif(?:[?#]|$)/i.test(parsed.pathname);
    return /\.gif(?:[?#]|$)/i.test(parsed.pathname)
      || host === 'media.tenor.com'
      || host.endsWith('.tenor.com')
      || host === 'media.giphy.com'
      || host.endsWith('.giphy.com');
  } catch {
    return /\.gif(?:[?#]|$)/i.test(src);
  }
}

function isImageSource(src: string) {
  if (src.startsWith('data:image/')) return !isGifSource(src);
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    const parsed = new URL(src);
    if (parsed.pathname.startsWith('/uploads/chat/')) return /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(parsed.pathname) && !isGifSource(src);
    return /\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isGifAttachment(message: MessengerMessage) {
  return isGifSource(message.imageData ?? '');
}

function isImageAttachment(message: MessengerMessage) {
  return isImageSource(message.imageData ?? '');
}

function getMessageMediaItems(message: Pick<MessengerMessage, 'mediaItems' | 'imageData' | 'imageName' | 'imageSpoiler'>): ChatMediaItem[] {
  if (Array.isArray(message.mediaItems) && message.mediaItems.length > 0) return message.mediaItems;
  return message.imageData ? [{ dataUrl: message.imageData, name: message.imageName, spoiler: message.imageSpoiler }] : [];
}

function isAlbumImageMessage(message: MessengerMessage) {
  return !message.deletedAt
    && Boolean(message.imageData)
    && isImageAttachment(message)
    && !isVoiceAttachment(message.imageData, message.imageName)
    && !isVideoCircleAttachment(message.imageData, message.imageName)
    && !parseForward(message.body);
}

function canAppendToImageAlbum(previous: MessengerMessage, message: MessengerMessage) {
  return isAlbumImageMessage(previous)
    && isAlbumImageMessage(message)
    && !message.body
    && !message.replyTo
    && !shouldShowDateDivider(message.createdAt, previous.createdAt)
    && messageRunIdentity(previous) === messageRunIdentity(message)
    && Math.abs(new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) <= 120000;
}

function clipboardImageFiles(data: DataTransfer) {
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

async function readClipboardImageFiles(limit = MAX_CHAT_MEDIA_BATCH) {
  if (limit <= 0) return [];
  if (!navigator.clipboard?.read) return [];
  const files: File[] = [];
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const extension = imageType.split('/')[1]?.split('+')[0] || 'png';
      files.push(new File([blob], `clipboard-image-${files.length + 1}.${extension}`, { type: imageType }));
      if (files.length >= limit) break;
    }
  } catch {
    return [];
  }
  return files;
}

function ChatGifAttachment({
  src,
  name,
  language,
  onOpen,
  onLoad
}: {
  src: string;
  name: string;
  language: Language;
  onOpen: () => void;
  onLoad?: () => void;
}) {
  const [favorite, setFavorite] = useState(() => isFavoriteGifUrl(src));

  useEffect(() => subscribeFavoriteGifs(() => setFavorite(isFavoriteGifUrl(src))), [src]);

  return (
    <span className="chat-inline-gif message-gif-attachment">
      <button type="button" className="chat-inline-gif-pick" onClick={onOpen}>
        <img src={src} alt={name} loading="lazy" decoding="async" draggable={false} onLoad={onLoad} />
      </button>
      <GifStar
        active={favorite}
        language={language}
        onToggle={() => {
          toggleFavoriteGif(gifFromUrl(src, name));
          setFavorite(isFavoriteGifUrl(src));
        }}
      />
    </span>
  );
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function groupAvatarSrc(group: Group) {
  if (group.avatarData) return group.avatarData;
  const letter = escapeSvgText((group.name[0] || '?').toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#2f3645"/><text x="50" y="59" text-anchor="middle" fill="#fff" font-size="34" font-family="Arial, sans-serif" font-weight="700">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function groupFromSenderSnapshot(senderGroup: SenderGroupSnapshot): Group {
  return {
    id: senderGroup.id,
    name: senderGroup.name,
    avatarData: senderGroup.avatarData,
    ownerId: '',
    inviteCode: '',
    nameplate: null,
    description: '',
    defaultRoleId: null,
    everyonePermissions: [],
    createdAt: new Date().toISOString()
  };
}

function groupNameplateBackground(group: Group) {
  return nameplateToCss(group.nameplate) ?? 'linear-gradient(135deg, #2f3645 0%, #1f2733 52%, #141922 100%)';
}

function anchoredGroupProfileStyle(anchorRect?: { left: number; top: number; right: number; bottom: number } | null): CSSProperties {
  if (!anchorRect || typeof window === 'undefined' || window.innerWidth <= 800) return {};
  const gap = 12;
  const margin = 12;
  const width = Math.min(440, window.innerWidth * 0.92);
  const side: 'right' | 'left' = window.innerWidth - anchorRect.right - gap - margin >= width ? 'right' : 'left';
  const top = Math.min(Math.max(anchorRect.top, margin), Math.max(margin, window.innerHeight - 620));
  return side === 'right'
    ? { position: 'fixed', top, left: Math.max(margin, anchorRect.right + gap), width, transformOrigin: 'left top' }
    : { position: 'fixed', top, right: Math.max(margin, window.innerWidth - anchorRect.left + gap), width, transformOrigin: 'right top' };
}

export function MessengerWindow({
  token,
  language,
  currentUser,
  initialChatUserId,
  initialChatRequestId = 0,
  initialGroupRequest = null,
  maximized,
  minimized = false,
  zIndex,
  pendingCallAccept = null,
  onPendingCallHandled,
  onCallStateChange,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onViewDesktop,
  onActiveChatChange,
  onActiveGroupChange,
  groupMentionCounts = {},
  onGroupMentionsRead,
  onUserChange,
  onEditProfile,
  onOpenWatchTogether,
  onOpenInbox,
  inboxUnreadCount = 0
}: MessengerWindowProps) {
  const sharedSocket = useSocket();
  const socketRef = useRef<Socket | null>(null);
  socketRef.current = sharedSocket;
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [callChatCollapsed, setCallChatCollapsed] = useState(false);
  const messageInputRef = useRef<EmojiInlineInputHandle | null>(null);
  // Right-click menu for the message composer. Always offers Paste / Copy / Cut;
  // when text is selected it additionally offers Translate. `hasSelection` drives
  // which clipboard actions are enabled and whether Translate is shown.
  const [composerMenu, setComposerMenu] = useState<{ x: number; y: number; start: number; end: number; hasSelection: boolean } | null>(null);
  const [imageCaptionMenu, setImageCaptionMenu] = useState<{ x: number; y: number } | null>(null);
  const [composerTranslating, setComposerTranslating] = useState(false);
  const imageCaptionInputRef = useRef<EmojiInlineInputHandle | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const selectedUserRef = useRef<PublicUser | null>(null);
  const selectedGroupRef = useRef<Group | null>(null);
  const activeViewRef = useRef<'friends' | 'directMessages'>('directMessages');
  const consumedInitialChatRef = useRef<string | null>(null);
  const consumedInitialGroupRef = useRef<string | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingRecipientRef = useRef<string | null>(null);
  const typingLastEmittedRef = useRef(0);
  const typingExpiryRef = useRef<Map<string, number>>(new Map());
  const peopleRef = useRef<PublicUser[]>([]);
  const conversationsRef = useRef<ConversationPreview[]>([]);
  const groupsRef = useRef<Group[]>([]);
  // Cache loaded conversation threads per user so reopening a chat renders
  // instantly while a fresh copy is fetched in the background.
  const messageCacheRef = useRef<Map<string, MessengerMessage[]>>(dmThreadCache);
  const messageCacheLoadedAtRef = useRef<Map<string, number>>(dmThreadCacheLoadedAt);
  const blockStateCacheRef = useRef<Map<string, { state: { blocked: boolean; blockedMe: boolean }; loadedAt: number }>>(dmBlockStateCache);
  const dragDepthRef = useRef(0);
  const [activeView, setActiveView] = useState<'friends' | 'directMessages'>('directMessages');
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('online');
  const [query, setQuery] = useState('');
  const [friendFilter, setFriendFilter] = useState('');
  const [directMessageFilter, setDirectMessageFilter] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<FriendRequests>(EMPTY_REQUESTS);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [presenceStatuses, setPresenceStatuses] = useState<Record<string, PresenceStatus>>({});
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedUser, setSelectedUser] = useState<PublicUser | null>(null);
  const [aiAssistantName, setAiAssistantName] = useState('NotAI');
  const [aiAssistantAvatarData, setAiAssistantAvatarData] = useState('');
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  // Pagination: whether an older page of the open conversation exists, and a
  // guard so scroll-up only triggers one "load older" request at a time.
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const userNearThreadBottomRef = useRef(true);
  const threadAutoScrollStateRef = useRef<{ key: string; lastId: string | null; length: number }>({ key: '', lastId: null, length: 0 });
  const olderScrollAnchorRef = useRef<{ previousTop: number; previousHeight: number; until: number } | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const messageDraftRef = useRef('');
  const lastPasteRef = useRef<{ signature: string; at: number } | null>(null);
  const [messageDraftSyncKey, setMessageDraftSyncKey] = useState(0);
  // Mirrors the leading "/command" being typed so the hint list can render
  // without putting the whole draft into state on every keystroke.
  const [composerSlashPrefix, setComposerSlashPrefix] = useState('');
  const [imageCaptionDraft, setImageCaptionDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [editingMediaItems, setEditingMediaItems] = useState<PendingChatImage[]>([]);
  const [groupIdentityOptions, setGroupIdentityOptions] = useState<Array<{ group: Group; memberCount: number }>>([]);
  const [selectedGroupIdentity, setSelectedGroupIdentity] = useState<Group | null>(null);
  const [groupIdentityModalOpen, setGroupIdentityModalOpen] = useState(false);
  const [groupIdentityLoading, setGroupIdentityLoading] = useState(false);
  const [groupIdentityProfile, setGroupIdentityProfile] = useState<GroupIdentityProfileState | null>(null);
  const [groupIdentityProfileBusy, setGroupIdentityProfileBusy] = useState(false);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const [mediaContextMenu, setMediaContextMenu] = useState<{ x: number; y: number; src: string } | null>(null);
  const [pinnedConversations, setPinnedConversations] = useState<Set<string>>(loadPinned);
  const [archivedConversations, setArchivedConversations] = useState<Set<string>>(loadArchived);
  const [dmListFilter, setDmListFilter] = useState<DmListFilter>('all');
  const [autoTranslateChats, setAutoTranslateChats] = useState<Set<string>>(loadAutoTranslate);
  // Scheduled messages awaiting delivery, plus the compose-time picker state.
  const [scheduledMessages, setScheduledMessages] = useState<MessengerMessage[]>([]);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  // "Set timer" dialog shown over the chat, and the scheduled-messages view
  // that replaces the thread when the notebook button is pressed.
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleChoice, setScheduleChoice] = useState<'1h' | '3h' | 'tomorrow' | 'custom'>('1h');
  const [scheduleCustom, setScheduleCustom] = useState('');
  const [scheduledViewOpen, setScheduledViewOpen] = useState(false);
  const [openedViewOnce, setOpenedViewOnce] = useState<Record<string, ChatMediaItem[]>>({});
  // Global cross-conversation search.
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchKind, setGlobalSearchKind] = useState<'all' | 'media' | 'links'>('all');
  const [globalSearchResults, setGlobalSearchResults] = useState<Array<{ user: PublicUser; message: MessengerMessage }>>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<string[]>([]);
  // Pin bar cursor: clicking the bar jumps to the current pin and advances.
  const [pinCursor, setPinCursor] = useState(0);
  const [conversationPinnedMessages, setConversationPinnedMessages] = useState<MessengerMessage[]>([]);
  const [pinConfirm, setPinConfirm] = useState<MessengerMessage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<MessengerMessage | null>(null);
  const [clearConversationConfirm, setClearConversationConfirm] = useState<PublicUser | null>(null);
  const [clearForEveryone, setClearForEveryone] = useState(false);
  const [editingMessage, setEditingMessage] = useState<MessengerMessage | null>(null);
  // The message being replied to (shows the reply bar above the composer).
  const [replyTarget, setReplyTarget] = useState<MessageReplySnippet | null>(null);
  // The emoji-picker anchor for adding a reaction to a specific DM message.
  const [reactionPicker, setReactionPicker] = useState<{ message: MessengerMessage; anchor: HTMLElement } | null>(null);
  const reactionAnchorRef = useRef<HTMLElement | null>(null);
  const reactionTogglePendingRef = useRef<Set<string>>(new Set());
  // Seed text + sender for the shared "Forward to" modal; null when closed.
  const [forwardSeed, setForwardSeed] = useState<{
    body: string;
    senderName: string;
    sourceId: string;
    imageData: string | null;
    imageName: string | null;
    imageSpoiler: boolean;
  } | null>(null);
  const [deletedForwardSourceIds, setDeletedForwardSourceIds] = useState<Set<string>>(() => new Set());
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: MessengerMessage; imageSrc?: string } | null>(null);
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number } | null>(null);
  // Ephemeral, per-message translations keyed by message id. Lives only in
  // component state, so it resets when the messenger is closed/reopened or when
  // switching to another conversation (see the effect that clears it below).
  const [messageTranslations, setMessageTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const messageMenuRef = useRef<HTMLDivElement | null>(null);
  // Clamp the message context menu so it stays fully inside the viewport even
  // when right-clicking a message near the bottom/right edge of a small window.
  const messageMenuPos = useAnchoredMenu(messageMenu ? { x: messageMenu.x, y: messageMenu.y } : null, messageMenuRef);
  // Keep the composer context menu inside the viewport so it never spills below
  // the bottom edge of the app window when right-clicking near the input.
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const composerMenuPos = useAnchoredMenu(composerMenu ? { x: composerMenu.x, y: composerMenu.y } : null, composerMenuRef);
  const chatMenuRef = useRef<HTMLDivElement | null>(null);
  const chatMenuPos = useAnchoredMenu(chatMenu ? { x: chatMenu.x, y: chatMenu.y } : null, chatMenuRef);
  const [userMenu, setUserMenu] = useState<{ x: number; y: number; user: PublicUser } | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuPos = useAnchoredMenu(userMenu ? { x: userMenu.x, y: userMenu.y } : null, userMenuRef);
  const imageCaptionMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCaptionMenuPos = useAnchoredMenu(imageCaptionMenu, imageCaptionMenuRef);
  const [profileUser, setProfileUser] = useState<PublicUser | null>(null);
  // Viewport rect of the avatar the profile was opened from, so the card pops
  // out anchored next to it (Discord-style). Null → centered fallback.
  const [profileAnchor, setProfileAnchor] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [profileGroup, setProfileGroup] = useState<Group | undefined>(undefined);
  // Preloaded roles passed from the group view so the profile shows them instantly.
  const [profilePreload, setProfilePreload] = useState<{ groupRoles: GroupRole[]; userRoles: GroupRole[] } | undefined>(undefined);
  // Capture a clicked element's rect (plain object) so the profile card can
  // anchor beside it. Pass the event from the avatar/row click handler.
  function rectFrom(event: { currentTarget: Element }): { left: number; top: number; right: number; bottom: number } {
    const r = event.currentTarget.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function restoreOlderScrollAnchor() {
    const anchor = olderScrollAnchorRef.current;
    const thread = threadRef.current;
    if (!anchor || !thread) return false;
    if (Date.now() > anchor.until) {
      olderScrollAnchorRef.current = null;
      return false;
    }
    thread.scrollTop = anchor.previousTop + (thread.scrollHeight - anchor.previousHeight);
    userNearThreadBottomRef.current = false;
    return true;
  }

  function scheduleOlderScrollRestore() {
    if (olderScrollAnchorRef.current) olderScrollAnchorRef.current.until = Date.now() + 3500;
    window.requestAnimationFrame(() => {
      restoreOlderScrollAnchor();
      window.requestAnimationFrame(() => {
        restoreOlderScrollAnchor();
        window.requestAnimationFrame(() => restoreOlderScrollAnchor());
      });
    });
    window.setTimeout(() => restoreOlderScrollAnchor(), 120);
    window.setTimeout(() => restoreOlderScrollAnchor(), 450);
    window.setTimeout(() => restoreOlderScrollAnchor(), 1200);
    window.setTimeout(() => {
      if (olderScrollAnchorRef.current && Date.now() > olderScrollAnchorRef.current.until) {
        olderScrollAnchorRef.current = null;
      }
    }, 9000);
  }

  function handleThreadMediaLoad() {
    if (restoreOlderScrollAnchor() || loadingOlderRef.current) return;
    const thread = threadRef.current;
    if (thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 200) {
      thread.scrollTop = thread.scrollHeight;
      userNearThreadBottomRef.current = true;
    }
  }

  function applyConversationPinnedMessage(message: MessengerMessage) {
    setConversationPinnedMessages((current) => {
      if (!message.pinnedAt || message.deletedAt) return current.filter((item) => item.id !== message.id);
      const next = [message, ...current.filter((item) => item.id !== message.id)];
      return next.sort((a, b) => new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime());
    });
  }

  const [splitWidth, setSplitWidth] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('notoc.messenger.splitWidth');
      return stored ? Number(stored) : null;
    } catch { return null; }
  });
  const [resizing, setResizing] = useState(false);
  // Search mode: when active the left panel becomes a search box + results.
  const [searchMode, setSearchMode] = useState(false);
  const [convSearchQuery, setConvSearchQuery] = useState('');
  const [convSearchResults, setConvSearchResults] = useState<MessengerMessage[]>([]);
  const [convSearchLoading, setConvSearchLoading] = useState(false);
  const searchPanelRef = useRef<HTMLElement | null>(null);
  // Right Telegram-style profile/shared-media panel.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Full profile (with wallpaper) of the open conversation, lazily fetched for
  // the right panel hero since list users are served without the heavy wallpaper.
  const [rightPanelUser, setRightPanelUser] = useState<PublicUser | null>(null);
  const [sharedImages, setSharedImages] = useState<MessengerMessage[] | null>(null);
  const [sharedLinks, setSharedLinks] = useState<MessengerMessage[] | null>(null);
  const [mutualGroups, setMutualGroups] = useState<Group[] | null>(null);
  const [mutualFriends, setMutualFriends] = useState<PublicUser[] | null>(null);
  // Which media section overlay is open in the right panel.
  const [panelSection, setPanelSection] = useState<RightPanelSection | null>(null);
  // Block state for the open conversation, kept in sync with the server.
  const [blockState, setBlockState] = useState<{ blocked: boolean; blockedMe: boolean }>({ blocked: false, blockedMe: false });
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Which tab the shared emoji/GIF picker opens on ('emoji' or 'gif').
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const [imageEmojiOpen, setImageEmojiOpen] = useState(false);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const [dmBackgrounds, setDmBackgrounds] = useState<Record<string, string>>({});
  // Per-conversation disappearing-message timer (seconds, 0 = off).
  const [dmTtls, setDmTtls] = useState<Record<string, number>>({});
  // What users are doing right now (in a voice channel / watch room).
  const [presenceActivities, setPresenceActivities] = useState<Record<string, 'voice' | 'watch'>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [localGroupRequest, setLocalGroupRequest] = useState<{ groupId: string; group: Group; channelId: string | null; requestId: number } | null>(null);
  const [groupConversations, setGroupConversations] = useState<GroupConversationPreview[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const navApplyingRef = useRef(false);
  const [navState, setNavState] = useState<{ entries: MessengerNavLocation[]; index: number }>(() => ({
    entries: [{
      activeView: 'directMessages',
      friendsTab: 'online',
      selectedUserId: null,
      selectedGroupId: null,
      searchMode: false,
      rightPanelOpen: false
    }],
    index: 0
  }));

  const hasSearchQuery = query.trim().length >= 2;
  const selectedIsFriend = useMemo(() => Boolean(selectedUser && friends.some((friend) => friend.id === selectedUser.id)), [friends, selectedUser]);
  const selectedTyping = Boolean(selectedUser && typingUserIds.includes(selectedUser.id));
  const selectedChatBackground = selectedUser ? dmBackgrounds[selectedUser.id] ?? '' : '';
  const aiAssistantUser = useMemo(() => buildAiAssistantUser(currentUser, aiAssistantName, aiAssistantAvatarData), [aiAssistantAvatarData, aiAssistantName, currentUser]);
  const isAiAssistantSelected = selectedUser?.id === AI_ASSISTANT_USER_ID;
  const selectedChatBackgroundStyle = selectedChatBackground
    ? {
        backgroundImage: `linear-gradient(color-mix(in srgb, var(--bg) 18%, transparent), color-mix(in srgb, var(--bg) 18%, transparent)), url("${selectedChatBackground}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      } as CSSProperties
    : undefined;
  const canChooseGroupIdentityInDm = selectedUser?.allowGroupIdentityMessages !== false;
  const memberGroupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);
  const imageDropEnabled = Boolean(selectedUser && activeView === 'directMessages' && !editingMessage && !isAiAssistantSelected);
  const sortedConversations = useMemo(() => {
    const pinned = pinnedConversations;
    // The self-conversation (Saved Messages) has its own pinned entry above
    // the list, so keep it out of the regular conversation rows.
    return conversations.filter((conversation) => conversation.user.id !== currentUser.id).sort((a, b) => {
      const aPinned = pinned.has(a.user.id) ? 1 : 0;
      const bPinned = pinned.has(b.user.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime();
    });
  }, [conversations, pinnedConversations, currentUser.id]);
  const visibleConversations = useMemo(() => {
    // Archive hides a chat until it has unread messages again, so an archived
    // conversation that pings you still surfaces in the default list.
    const byFilter = sortedConversations.filter((conversation) => {
      const archived = archivedConversations.has(conversation.user.id);
      if (dmListFilter === 'archived') return archived;
      if (dmListFilter === 'unread') return conversation.unreadCount > 0;
      return !archived || conversation.unreadCount > 0;
    });
    const filter = directMessageFilter.trim().toLocaleLowerCase();
    if (!filter) return byFilter;
    return byFilter.filter((conversation) =>
      conversation.user.nickname.toLocaleLowerCase().includes(filter)
    );
  }, [directMessageFilter, sortedConversations, archivedConversations, dmListFilter]);

  const scheduledForSelectedUser = useMemo(
    () => (selectedUser ? scheduledMessages.filter((message) => message.recipientId === selectedUser.id) : []),
    [scheduledMessages, selectedUser]
  );

  // Leaving the conversation closes the scheduled list, so the home button and
  // the existing back/forward navigation return to the thread on their own.
  useEffect(() => {
    setScheduledViewOpen(false);
    setScheduleModalOpen(false);
  }, [selectedUser?.id, selectedGroup?.id, activeView]);

  // Load the pending scheduled messages once per session.
  useEffect(() => {
    api.getScheduledMessages(token)
      .then((payload) => setScheduledMessages(payload.messages))
      .catch(() => undefined);
  }, [token]);

  // Auto-translate: whenever the open conversation has the toggle on, translate
  // any incoming message we have not translated yet. Results reuse the same
  // `messageTranslations` map the manual "Translate" action fills.
  useEffect(() => {
    if (!selectedUser || !autoTranslateChats.has(selectedUser.id)) return;
    const pending = messages.filter((message) =>
      message.senderId !== currentUser.id
      && !message.deletedAt
      && message.body.trim()
      && !messageTranslations[message.id]
      && !translatingIds.has(message.id)
    ).slice(-8);
    if (pending.length === 0) return;

    let alive = true;
    const target = getSavedTranslateTargetName();
    setTranslatingIds((prev) => {
      const next = new Set(prev);
      pending.forEach((message) => next.add(message.id));
      return next;
    });
    void Promise.all(pending.map(async (message) => {
      try {
        const { text } = await api.translateText(token, message.body.trim(), target);
        if (alive) setMessageTranslations((prev) => ({ ...prev, [message.id]: text }));
      } catch {
        // Leave the original text in place on failure.
      } finally {
        if (alive) {
          setTranslatingIds((prev) => {
            const next = new Set(prev);
            next.delete(message.id);
            return next;
          });
        }
      }
    }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selectedUser?.id, autoTranslateChats, token, currentUser.id]);

  // Debounced global search across every conversation.
  useEffect(() => {
    const query = globalSearchQuery.trim();
    if (!globalSearchOpen || query.length < 2) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      return;
    }
    let alive = true;
    setGlobalSearchLoading(true);
    const timer = window.setTimeout(() => {
      api.searchAllMessages(token, query, globalSearchKind)
        .then((payload) => { if (alive) setGlobalSearchResults(payload.results); })
        .catch(() => { if (alive) setGlobalSearchResults([]); })
        .finally(() => { if (alive) setGlobalSearchLoading(false); });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [globalSearchOpen, globalSearchQuery, globalSearchKind, token]);

  const currentNavLocation = useMemo<MessengerNavLocation>(() => ({
    activeView,
    friendsTab,
    selectedUserId: activeView === 'directMessages' && !selectedGroup ? selectedUser?.id ?? null : null,
    selectedGroupId: selectedGroup?.id ?? null,
    searchMode: Boolean(searchMode && selectedUser && !selectedGroup),
    rightPanelOpen: Boolean(rightPanelOpen && selectedUser && !selectedGroup)
  }), [activeView, friendsTab, rightPanelOpen, searchMode, selectedGroup, selectedUser]);

  const messageRunKeys = useMemo(() => {
    const keys = new Map<string, string>();
    let runKey = '';
    messages.forEach((message, index) => {
      const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
      const previous = index === 0 ? null : messages[index - 1];
      const isStartOfGroup = showDateDivider || !previous || messageRunIdentity(previous) !== messageRunIdentity(message) || (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 120000);
      if (isStartOfGroup) runKey = message.id;
      keys.set(message.id, runKey || message.id);
    });
    return keys;
  }, [messages]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
    selectedGroupRef.current = selectedGroup;
    activeViewRef.current = activeView;
    onActiveChatChange(activeView === 'directMessages' ? selectedUser?.id ?? null : null);
    onActiveGroupChange?.(selectedGroup?.id ?? null);
    return () => {
      onActiveChatChange(null);
      onActiveGroupChange?.(null);
    };
  }, [activeView, onActiveChatChange, onActiveGroupChange, selectedUser, selectedGroup]);

  useEffect(() => {
    if (selectedUser?.allowGroupIdentityMessages === false) {
      setSelectedGroupIdentity(null);
      setGroupIdentityModalOpen(false);
    }
  }, [selectedUser?.allowGroupIdentityMessages, selectedUser?.id]);

  useEffect(() => {
    if (navApplyingRef.current) return;
    setNavState((current) => {
      const activeEntry = current.entries[current.index];
      if (activeEntry && sameMessengerNavLocation(activeEntry, currentNavLocation)) return current;
      const entries = [...current.entries.slice(0, current.index + 1), currentNavLocation].slice(-80);
      return { entries, index: entries.length - 1 };
    });
  }, [currentNavLocation]);

  useEffect(() => {
    if (activeView !== 'directMessages' || !selectedUser) return;
    const thread = threadRef.current;
    const key = selectedUser.id;
    const lastMessage = messages[messages.length - 1] ?? null;
    const lastId = lastMessage?.id ?? null;
    const previous = threadAutoScrollStateRef.current;
    const threadChanged = previous.key !== key;
    const firstLoad = previous.lastId === null && lastId !== null;
    const appended = previous.key === key && previous.lastId !== lastId && messages.length > previous.length;
    const sentByMe = lastMessage?.senderId === currentUser.id;

    threadAutoScrollStateRef.current = { key, lastId, length: messages.length };

    if (!thread || restoreOlderScrollAnchor() || loadingOlderRef.current) return;
    const shouldScrollToBottom = threadChanged || firstLoad || sentByMe || (appended && userNearThreadBottomRef.current);
    if (!shouldScrollToBottom) return;

    window.requestAnimationFrame(() => {
      const currentThread = threadRef.current;
      if (currentThread) {
        currentThread.scrollTop = currentThread.scrollHeight;
        userNearThreadBottomRef.current = true;
        window.requestAnimationFrame(() => {
          const updatedThread = threadRef.current;
          if (updatedThread) {
            updatedThread.scrollTop = updatedThread.scrollHeight;
            userNearThreadBottomRef.current = true;
          }
        });
      }
    });
  }, [activeView, messages.length, selectedUser?.id, currentUser.id]);

  useEffect(() => {
    setRevealedSpoilers([]);
  }, [selectedUser?.id]);

  useEffect(() => {
    if (!selectedUser || isAiAssistantUserId(selectedUser.id)) return;
    let alive = true;
    const userId = selectedUser.id;
    api.getConversationSettings(token, userId)
      .then((payload) => {
        if (!alive) return;
        setDmBackgrounds((current) => ({ ...current, [userId]: payload.settings.backgroundData }));
        setDmTtls((current) => ({ ...current, [userId]: payload.settings.messageTtlSeconds ?? 0 }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selectedUser?.id, token]);

  useEffect(() => {
    if (selectedGroup) onGroupMentionsRead?.(selectedGroup.id);
  }, [onGroupMentionsRead, selectedGroup]);

  // Reset the pin cursor whenever the open conversation changes.
  useEffect(() => { setPinCursor(0); }, [selectedUser?.id]);

  useEffect(() => {
    setReplyTarget(null);
    setReactionPicker(null);
  }, [activeView, selectedUser?.id, selectedGroup?.id]);

  // Translations are intentionally ephemeral: clear them when switching to a
  // different conversation so messages always show their original text again.
  useEffect(() => {
    setMessageTranslations({});
    setTranslatingIds(new Set());
  }, [selectedUser?.id, selectedGroup?.id]);

  useEffect(() => {
    if (!messageMenu && !userMenu && !composerMenu && !chatMenu && !imageCaptionMenu) return;

    function closeMenu(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.('.context-menu')) return;
      setMessageMenu(null);
      setUserMenu(null);
      setComposerMenu(null);
      setChatMenu(null);
      setImageCaptionMenu(null);
    }

    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', closeMenu);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', closeMenu);
    };
  }, [messageMenu, userMenu, composerMenu, chatMenu, imageCaptionMenu]);

  useEffect(() => {
    if (!resizing) return;

    function move(event: globalThis.MouseEvent) {
      const shell = document.querySelector('.messenger-shell');
      if (!shell) return;
      const shellRect = shell.getBoundingClientRect();
      setSplitWidth(Math.max(200, Math.min(600, event.clientX - shellRect.left - 82 - 12)));
    }

    function up() {
      setResizing(false);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [resizing]);

  useEffect(() => {
    if (splitWidth === null) return;
    localStorage.setItem('notoc.messenger.splitWidth', String(splitWidth));
  }, [splitWidth]);

  useEffect(() => {
    peopleRef.current = uniqueById([
      aiAssistantUser,
      ...friends,
      ...requests.incoming,
      ...requests.outgoing,
      ...searchResults,
      ...conversations.map((conversation) => conversation.user),
      ...(selectedUser ? [selectedUser] : [])
    ]);
    conversationsRef.current = conversations;
    groupsRef.current = groups;
  }, [aiAssistantUser, conversations, friends, groups, requests.incoming, requests.outgoing, searchResults, selectedUser]);

  useEffect(() => {
    if (selectedUserRef.current?.id === AI_ASSISTANT_USER_ID) {
      setSelectedUser(aiAssistantUser);
    }
  }, [aiAssistantUser]);

  useEffect(() => {
    if (!initialChatUserId) return;
    const requestKey = `${initialChatRequestId ?? 'initial'}:${initialChatUserId}`;
    if (consumedInitialChatRef.current === requestKey) return;
    consumedInitialChatRef.current = requestKey;
    if (activeView === 'directMessages' && selectedUser?.id === initialChatUserId) return;
    const known = knownUser(initialChatUserId);

    if (known) {
      void chooseUser(known);
      return;
    }

    void api.getPublicUser(token, initialChatUserId).then((payload) => void chooseUser(payload.user));
  }, [initialChatRequestId, initialChatUserId, token]);

  useEffect(() => {
    const request = localGroupRequest ?? initialGroupRequest;
    if (!request) return;
    const requestKey = `${request.requestId}:${request.groupId}:${request.channelId ?? ''}`;
    if (consumedInitialGroupRef.current === requestKey) return;
    consumedInitialGroupRef.current = requestKey;
    const known = groupsRef.current.find((candidate) => candidate.id === request.groupId)
      ?? groupConversations.find((candidate) => candidate.group.id === request.groupId)?.group
      ?? request.group;
    setGroups((current) => current.some((group) => group.id === known.id) ? current : [known, ...current]);
    setSelectedGroup(known);
    setSelectedUser(null);
    setActiveView('directMessages');
    setMessages([]);
    onGroupMentionsRead?.(known.id);
  }, [groupConversations, initialGroupRequest, localGroupRequest, onGroupMentionsRead]);

  function pendingReactionEmojisForMessage(messageId: string, excludingEmoji?: string) {
    const prefix = `${messageId}:`;
    const emojis = new Set<string>();
    for (const key of reactionTogglePendingRef.current) {
      if (!key.startsWith(prefix)) continue;
      const emoji = key.slice(prefix.length);
      if (emoji && emoji !== excludingEmoji) emojis.add(emoji);
    }
    return emojis;
  }

  function mergePendingReactions(message: MessengerMessage, local: MessengerMessage | undefined, confirmedEmoji?: string) {
    if (!local || reactionTogglePendingRef.current.size === 0) return message;
    const pendingEmojis = pendingReactionEmojisForMessage(message.id, confirmedEmoji);
    if (pendingEmojis.size === 0) return message;

    const localByEmoji = new Map((local.reactions ?? []).map((reaction) => [reaction.emoji, reaction]));
    const next = (message.reactions ?? []).filter((reaction) => !pendingEmojis.has(reaction.emoji));
    for (const emoji of pendingEmojis) {
      const localReaction = localByEmoji.get(emoji);
      if (localReaction) next.push(localReaction);
    }
    return { ...message, reactions: next };
  }

  function replaceMessage(nextMessage: MessengerMessage, confirmedReactionEmoji?: string) {
    const otherId = nextMessage.senderId === currentUser.id ? nextMessage.recipientId : nextMessage.senderId;
    const cacheKey = dmCacheKey(currentUser.id, otherId);
    const cached = messageCacheRef.current.get(cacheKey);
    if (cached) {
      messageCacheRef.current.set(cacheKey, nextMessage.deletedAt
        ? cached.filter((message) => message.id !== nextMessage.id)
        : cached.map((message) => (
          message.id === nextMessage.id ? mergePendingReactions(nextMessage, message, confirmedReactionEmoji) : message
        ))
      );
    }
    let mergedForPanels = nextMessage;
    setMessages((current) => {
      if (nextMessage.deletedAt) return current.filter((message) => message.id !== nextMessage.id);
      return current.map((message) => {
      if (message.id !== nextMessage.id) return message;
      mergedForPanels = mergePendingReactions(nextMessage, message, confirmedReactionEmoji);
      return mergedForPanels;
      });
    });
    syncRightPanelMessage(mergedForPanels);
    if (nextMessage.deletedAt) {
      setConversations((current) => current.filter((conversation) => conversation.message.id !== nextMessage.id));
      void api.getConversations(token).then((payload) => setConversations(payload.conversations)).catch(() => undefined);
    } else {
      setConversations((current) =>
        current.map((conversation) => (conversation.message.id === nextMessage.id ? { ...conversation, message: mergedForPanels } : conversation))
      );
    }
    setEditingMessage((current) => (current?.id === nextMessage.id ? (mergedForPanels.deletedAt ? null : mergedForPanels) : current));
  }

  function markDeletedReplyInDm(message: MessengerMessage, deletedMessageId: string, deletedAt: string): MessengerMessage {
    if (message.replyTo?.id === deletedMessageId && !message.replyTo.deletedAt) {
      return {
        ...message,
        replyTo: {
          ...message.replyTo,
          body: '',
          imageData: null,
          imageName: null,
          mediaItems: [],
          deletedAt: deletedAt
        }
      };
    }
    return message;
  }

  function applyOptimisticReaction(message: MessengerMessage, emoji: string) {
    const update = (item: MessengerMessage): MessengerMessage => {
      if (item.id !== message.id) return item;
      const reactions = item.reactions ?? [];
      const existing = reactions.find((reaction) => reaction.emoji === emoji);
      const mine = existing?.userIds.includes(currentUser.id);
      if (!existing) {
        return { ...item, reactions: [...reactions, { emoji, count: 1, userIds: [currentUser.id] }] };
      }
      const next = reactions
        .map((reaction) => reaction.emoji !== emoji ? reaction : {
          ...reaction,
          count: mine ? reaction.count - 1 : reaction.count + 1,
          userIds: mine ? reaction.userIds.filter((id) => id !== currentUser.id) : [...reaction.userIds, currentUser.id]
        })
        .filter((reaction) => reaction.count > 0);
      return { ...item, reactions: next };
    };
    const otherId = message.senderId === currentUser.id ? message.recipientId : message.senderId;
    const cacheKey = dmCacheKey(currentUser.id, otherId);
    const cached = messageCacheRef.current.get(cacheKey);
    if (cached) messageCacheRef.current.set(cacheKey, cached.map(update));
    setMessages((current) => current.map(update));
  }

  function preservePendingReactions(incoming: MessengerMessage[], current: MessengerMessage[]) {
    if (reactionTogglePendingRef.current.size === 0) return incoming;
    const currentById = new Map(current.map((message) => [message.id, message]));
    let changed = false;
    const merged = incoming.map((message) => {
      const next = mergePendingReactions(message, currentById.get(message.id));
      if (next !== message) changed = true;
      return next;
    });
    return changed ? merged : incoming;
  }

  function syncRightPanelMessage(message: MessengerMessage) {
    const selected = selectedUserRef.current;
    if (!selected || (message.senderId !== selected.id && message.recipientId !== selected.id)) return;
    setSharedImages((current) => {
      if (current === null) return current;
      const without = current.filter((item) => item.id !== message.id);
      if (message.deletedAt || !message.imageData) return without;
      return [message, ...without].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    });
    setSharedLinks((current) => {
      if (current === null) return current;
      const without = current.filter((item) => item.id !== message.id);
      if (message.deletedAt || extractMessageUrls(message.body).length === 0) return without;
      return [message, ...without].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    });
  }

  function replaceKnownUser(nextUser: PublicUser) {
    const replace = (person: PublicUser) => (person.id === nextUser.id ? nextUser : person);
    setFriends((current) => current.map(replace));
    setSearchResults((current) => current.map(replace));
    setRequests((current) => ({
      incoming: current.incoming.map(replace),
      outgoing: current.outgoing.map(replace)
    }));
    setConversations((current) => current.map((conversation) => (conversation.user.id === nextUser.id ? { ...conversation, user: nextUser } : conversation)));
    setSelectedUser((current) => (current?.id === nextUser.id ? nextUser : current));
    setUserMenu((current) => (current?.user.id === nextUser.id ? { ...current, user: nextUser } : current));
  }

  function knownUser(userId: string) {
    return peopleRef.current.find((person) => person.id === userId) ?? null;
  }

  function upsertConversation(message: MessengerMessage) {
    const otherId = message.senderId === currentUser.id ? message.recipientId : message.senderId;
    const known = knownUser(otherId);
    const apply = (person: PublicUser) => {
      setConversations((current) => {
        const existing = current.find((conversation) => conversation.user.id === person.id);
        const activeChatOpen = activeViewRef.current === 'directMessages' && selectedUserRef.current?.id === person.id;
        const unreadCount = message.senderId === currentUser.id || activeChatOpen ? existing?.unreadCount ?? 0 : (existing?.unreadCount ?? 0) + 1;
        const next = [{ user: person, message, unreadCount }, ...current.filter((conversation) => conversation.user.id !== person.id)];
        return next.slice(0, 50);
      });
    };

    if (known) {
      apply(known);
      return;
    }

    void api.getPublicUser(token, otherId).then((payload) => apply(payload.user));
  }

  useEffect(() => {
    let alive = true;
    if (
      messengerBootstrapCache &&
      messengerBootstrapCache.token === token &&
      Date.now() - messengerBootstrapCache.loadedAt < MESSENGER_BOOTSTRAP_TTL_MS
    ) {
      const payload = messengerBootstrapCache.payload;
      setFriends(payload.friends);
      setRequests(payload.requests);
      setConversations(payload.conversations);
      setGroups(payload.groups);
      setGroupConversations(payload.groupConversations);
      return () => {
        alive = false;
      };
    }

    api.getMessengerBootstrap(token)
      .then((payload) => {
        if (!alive) return;
        messengerBootstrapCache = { token, payload, loadedAt: Date.now() };
        setFriends(payload.friends);
        setRequests(payload.requests);
        setConversations(payload.conversations);
        setGroups(payload.groups);
        setGroupConversations(payload.groupConversations);
      })
      .catch((loadError) => {
        if (alive) setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
      });

    return () => {
      alive = false;
    };
  }, [language, token]);

  useEffect(() => {
    let alive = true;
    api.getAiSettings(token)
      .then((payload) => {
        if (!alive) return;
        setAiAssistantName(payload.settings.assistantName?.trim() || 'NotAI');
        setAiAssistantAvatarData(payload.settings.assistantAvatarData || '');
      })
      .catch(() => {
        if (alive) {
          setAiAssistantName('NotAI');
          setAiAssistantAvatarData('');
        }
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    if (!hasSearchQuery) {
      setSearchResults([]);
      return;
    }

    let alive = true;
    const handle = window.setTimeout(() => {
      setLoading(true);
      api
        .searchUsers(token, query.trim())
        .then((payload) => {
          if (alive) setSearchResults(payload.users);
        })
        .catch((searchError) => {
          if (alive) setError(searchError instanceof Error ? searchError.message : t(language, 'unknownError'));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 220);

    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [hasSearchQuery, language, query, token]);

  useEffect(() => {
    let alive = true;
    setGroupIdentityLoading(true);
    api.getGroupIdentities(token)
      .then((payload) => {
        if (!alive) return;
        setGroupIdentityOptions(payload.groups);
        setSelectedGroupIdentity((current) => current && payload.groups.some((item) => item.group.id === current.id) ? current : null);
      })
      .catch(() => {
        if (alive) setGroupIdentityOptions([]);
      })
      .finally(() => {
        if (alive) setGroupIdentityLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  // Use the shared socket from SocketProvider — no longer creates its own connection.
  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;
    setSocketInstance(socket);

    function onMessage(payload: { message: MessengerMessage }) {
      const message = payload.message;
      upsertConversation(message);
      syncRightPanelMessage(message);
      const otherId = message.senderId === currentUser.id ? message.recipientId : message.senderId;
      const cacheKey = dmCacheKey(currentUser.id, otherId);
      const cached = messageCacheRef.current.get(cacheKey);
      if (cached && !cached.some((item) => item.id === message.id)) {
        messageCacheRef.current.set(cacheKey, [...cached, message]);
      }
      const selected = selectedUserRef.current;
      if (!selected || (message.senderId !== selected.id && message.recipientId !== selected.id)) return;
      if (message.senderId === selected.id && message.recipientId === currentUser.id) {
        void api.markMessagesRead(token, selected.id).catch(() => undefined);
      }
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        // Reconcile our own just-sent message: replace the pending optimistic
        // bubble in place (keep its clientKey) instead of appending a duplicate.
        const pendingIdx = current.findIndex(
          (item) =>
            item.pending &&
            item.senderId === message.senderId &&
            item.recipientId === message.recipientId &&
            item.body === message.body &&
            (item.imageName ?? null) === (message.imageName ?? null)
        );
        if (pendingIdx !== -1) {
          const next = current.slice();
          next[pendingIdx] = { ...message, clientKey: current[pendingIdx].clientKey };
          return next;
        }
        return [...current, message];
      });
    }

    function onMessageUpdated(payload: { message: MessengerMessage }) { replaceMessage(payload.message); }
    function onMessageDeleted(payload: { message: MessengerMessage }) {
      const deleted = payload.message;
      if (!deleted.deletedAt) return;
      setDeletedForwardSourceIds((current) => new Set(current).add(deleted.id));
      const otherId = deleted.senderId === currentUser.id ? deleted.recipientId : deleted.senderId;
      const cacheKey = dmCacheKey(currentUser.id, otherId);
      const cached = messageCacheRef.current.get(cacheKey);
      if (cached) {
        messageCacheRef.current.set(cacheKey, cached
          .filter((message) => message.id !== deleted.id)
          .map((message) => markDeletedReplyInDm(message, deleted.id, deleted.deletedAt!))
        );
      }
      setMessages((current) => current
        .filter((message) => message.id !== deleted.id)
        .map((message) => markDeletedReplyInDm(message, deleted.id, deleted.deletedAt!))
      );
      if (selectedUserRef.current?.id === otherId) {
        setConversationPinnedMessages((current) => current.filter((message) => message.id !== deleted.id));
      }
      setConversations((current) => current.filter((conversation) => conversation.message.id !== deleted.id));
      void api.getConversations(token).then((payload) => setConversations(payload.conversations)).catch(() => undefined);
      syncRightPanelMessage(deleted);
      setEditingMessage((current) => (current?.id === deleted.id ? null : current));
    }
    function onMessagePinned(payload: { message: MessengerMessage }) {
      const msg = payload.message;
      replaceMessage(msg);
      const otherId = msg.senderId === currentUser.id ? msg.recipientId : msg.senderId;
      if (selectedUserRef.current?.id === otherId) applyConversationPinnedMessage(msg);
    }
    function onConversationCleared(payload: { userId: string }) {
      const cacheKey = dmCacheKey(currentUser.id, payload.userId);
      messageCacheRef.current.set(cacheKey, []);
      messageCacheLoadedAtRef.current.set(cacheKey, Date.now());
      if (selectedUserRef.current?.id === payload.userId) {
        setMessages([]);
        setHasMoreMessages(false);
        setConversationPinnedMessages([]);
      }
      setConversations((current) => current.filter((conversation) => conversation.user.id !== payload.userId));
      void api.getConversations(token).then((next) => setConversations(next.conversations)).catch(() => undefined);
    }

    function onConversationBackgroundChanged(payload: { userId: string; backgroundData: string }) {
      setDmBackgrounds((current) => ({ ...current, [payload.userId]: payload.backgroundData }));
    }

    function onConversationTtlChanged(payload: { userId: string; ttlSeconds: number }) {
      setDmTtls((current) => ({ ...current, [payload.userId]: payload.ttlSeconds }));
    }

    function onScheduledCreated(payload: { message: MessengerMessage }) {
      setScheduledMessages((current) => current.some((m) => m.id === payload.message.id)
        ? current
        : [...current, payload.message].sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime()));
    }

    function onScheduledSent(payload: { message: MessengerMessage }) {
      setScheduledMessages((current) => current.filter((m) => m.id !== payload.message.id));
    }

    function onMessageReminder(payload: { message: MessengerMessage }) {
      // Surface the reminder as a desktop notification on the same event bus
      // mentions use, so it works even when the messenger window is closed.
      window.dispatchEvent(new CustomEvent('notoc:message-reminder', {
        detail: {
          message: payload.message,
          title: language === 'ru' ? 'Напоминание о сообщении' : 'Message reminder',
          body: payload.message.body
        }
      }));
    }

    function onFriendsChanged(payload: FriendsChangedPayload) {
      payload.friends.forEach(cacheUser);
      setFriends(uniqueById(payload.friends));
      setRequests(payload.requests);
    }

    function onUserChanged(payload: { user: PublicUser }) {
      cacheUser(payload.user);
      replaceKnownUser(payload.user);
    }

    function onPresenceActivities(payload: { activities?: Record<string, 'voice' | 'watch'> }) {
      setPresenceActivities(payload.activities ?? {});
    }

    function onPresenceSnapshot(payload: PresenceSnapshotPayload) {
      const next = normalizePresenceSnapshot(payload);
      setPresenceStatuses(next);
      setOnlineUserIds(onlineIdsFromPresence(next));
    }

    function onPresenceChanged(payload: PresenceChangedPayload) {
      setPresenceStatuses((current) => {
        const next = applyPresenceChange(current, payload);
        setOnlineUserIds(onlineIdsFromPresence(next));
        return next;
      });
    }

    function onTyping(payload: { userId: string; typing: boolean }) {
      const previousTimer = typingExpiryRef.current.get(payload.userId);
      if (previousTimer) window.clearTimeout(previousTimer);
      setTypingUserIds((current) => {
        if (payload.typing) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((userId) => userId !== payload.userId);
      });
      if (payload.typing) {
        const timer = window.setTimeout(() => {
          typingExpiryRef.current.delete(payload.userId);
          setTypingUserIds((current) => current.filter((userId) => userId !== payload.userId));
        }, 5200);
        typingExpiryRef.current.set(payload.userId, timer);
      } else {
        typingExpiryRef.current.delete(payload.userId);
      }
    }

    function onMessagesRead(payload: { readerId: string; messageIds: string[]; readAt: string }) {
      const readIds = new Set(payload.messageIds);
      const applyReadAt = (message: MessengerMessage): MessengerMessage => (
        readIds.has(message.id) ? { ...message, readAt: message.readAt ?? payload.readAt } : message
      );
      const cacheKey = dmCacheKey(currentUser.id, payload.readerId);
      const cached = messageCacheRef.current.get(cacheKey);
      if (cached) messageCacheRef.current.set(cacheKey, cached.map(applyReadAt));
      if (selectedUserRef.current?.id === payload.readerId) {
        setMessages((current) => current.map(applyReadAt));
      }
      setConversations((current) => current.map((conversation) => (
        conversation.user.id === payload.readerId && readIds.has(conversation.message.id)
          ? { ...conversation, message: applyReadAt(conversation.message) }
          : conversation
      )));
    }

    function onGroupCreated(payload: { group: Group }) {
      setGroups((current) => current.some((g) => g.id === payload.group.id) ? current : [payload.group, ...current]);
    }
    function onGroupUpdated(payload: { group: Group }) {
      setGroups((current) => current.map((g) => g.id === payload.group.id ? payload.group : g));
      setSelectedGroup((current) => current?.id === payload.group.id ? payload.group : current);
    }
    function onGroupDeleted(payload: { groupId: string }) {
      setGroups((current) => current.filter((g) => g.id !== payload.groupId));
      setGroupConversations((current) => current.filter((gc) => gc.group.id !== payload.groupId));
      setSelectedGroup((current) => current?.id === payload.groupId ? null : current);
    }
    function onGroupInvited(payload: { group: Group }) {
      setGroups((current) => current.some((g) => g.id === payload.group.id) ? current : [payload.group, ...current]);
    }
    function onGroupRemoved(payload: { groupId: string }) {
      setGroups((current) => current.filter((g) => g.id !== payload.groupId));
      setGroupConversations((current) => current.filter((gc) => gc.group.id !== payload.groupId));
      setSelectedGroup((current) => current?.id === payload.groupId ? null : current);
    }
    function onGroupMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      const inChat = selectedGroupRef.current?.id === msg.groupId;
      setGroupConversations((current) => {
        const known = groupsRef.current.find((g) => g.id === msg.groupId);
        if (!known) return current;
        const existing = current.find((gc) => gc.group.id === msg.groupId);
        const unreadCount = inChat ? (existing?.unreadCount ?? 0) : (existing?.unreadCount ?? 0) + 1;
        const next = [{ group: known, message: msg, unreadCount }, ...current.filter((gc) => gc.group.id !== msg.groupId)];
        return next.slice(0, 50);
      });
    }
    function onGroupMessageUpdated(payload: { message: GroupMessage }) {
      setGroupConversations((current) =>
        current.map((gc) => gc.message.id === payload.message.id ? { ...gc, message: payload.message } : gc)
      );
    }
    function onGroupMessageDeleted(payload: { message: GroupMessage }) {
      setGroupConversations((current) =>
        current.map((gc) => gc.message.id === payload.message.id ? { ...gc, message: payload.message } : gc)
      );
    }

    function onBlockChanged(payload: { userId: string }) {
      blockStateCacheRef.current.delete(dmCacheKey(currentUser.id, payload.userId));
      // Refresh block state if it concerns the open conversation; always refresh
      // the conversation list (a new block hides it).
      if (selectedUserRef.current?.id === payload.userId) {
        void api.getBlockState(token, payload.userId)
          .then((state) => { if (selectedUserRef.current?.id === payload.userId) setBlockState(state); })
          .catch(() => undefined);
      }
      void api.getConversations(token).then((p) => setConversations(p.conversations)).catch(() => undefined);
    }

    socket.on('messenger:message', onMessage);
    socket.on('messenger:blockChanged', onBlockChanged);
    socket.on('messenger:messageUpdated', onMessageUpdated);
    socket.on('messenger:messageDeleted', onMessageDeleted);
    socket.on('messenger:messagePinned', onMessagePinned);
    socket.on('messenger:conversationCleared', onConversationCleared);
    socket.on('messenger:conversationBackgroundChanged', onConversationBackgroundChanged);
    socket.on('messenger:conversationTtlChanged', onConversationTtlChanged);
    socket.on('messenger:scheduledCreated', onScheduledCreated);
    socket.on('messenger:scheduledSent', onScheduledSent);
    socket.on('messenger:messageReminder', onMessageReminder);
    socket.on('messenger:friendsChanged', onFriendsChanged);
    socket.on('desktop:userChanged', onUserChanged);
    socket.on('presence:snapshot', onPresenceSnapshot);
    socket.on('presence:changed', onPresenceChanged);
    socket.on('presence:activities', onPresenceActivities);
    socket.on('messenger:typing', onTyping);
    socket.on('messenger:messagesRead', onMessagesRead);
    socket.on('messenger:groupCreated', onGroupCreated);
    socket.on('messenger:groupUpdated', onGroupUpdated);
    socket.on('messenger:groupDeleted', onGroupDeleted);
    socket.on('messenger:groupInvited', onGroupInvited);
    socket.on('messenger:groupRemoved', onGroupRemoved);
    socket.on('messenger:groupMessage', onGroupMessage);
    socket.on('messenger:groupMessageUpdated', onGroupMessageUpdated);
    socket.on('messenger:groupMessageDeleted', onGroupMessageDeleted);
    socket.emit('presence:getSnapshot');

    return () => {
      setSocketInstance(null);
      socket.off('messenger:message', onMessage);
      socket.off('messenger:blockChanged', onBlockChanged);
      socket.off('messenger:messageUpdated', onMessageUpdated);
      socket.off('messenger:messageDeleted', onMessageDeleted);
      socket.off('messenger:messagePinned', onMessagePinned);
      socket.off('messenger:conversationCleared', onConversationCleared);
      socket.off('messenger:conversationBackgroundChanged', onConversationBackgroundChanged);
      socket.off('messenger:conversationTtlChanged', onConversationTtlChanged);
      socket.off('messenger:scheduledCreated', onScheduledCreated);
      socket.off('messenger:scheduledSent', onScheduledSent);
      socket.off('messenger:messageReminder', onMessageReminder);
      socket.off('messenger:friendsChanged', onFriendsChanged);
      socket.off('desktop:userChanged', onUserChanged);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('presence:changed', onPresenceChanged);
      socket.off('presence:activities', onPresenceActivities);
      socket.off('messenger:typing', onTyping);
      socket.off('messenger:messagesRead', onMessagesRead);
      typingExpiryRef.current.forEach((timer) => window.clearTimeout(timer));
      typingExpiryRef.current.clear();
      socket.off('messenger:groupCreated', onGroupCreated);
      socket.off('messenger:groupUpdated', onGroupUpdated);
      socket.off('messenger:groupDeleted', onGroupDeleted);
      socket.off('messenger:groupInvited', onGroupInvited);
      socket.off('messenger:groupRemoved', onGroupRemoved);
      socket.off('messenger:groupMessage', onGroupMessage);
      socket.off('messenger:groupMessageUpdated', onGroupMessageUpdated);
      socket.off('messenger:groupMessageDeleted', onGroupMessageDeleted);
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, [sharedSocket]);

  const resolveUserForCall = async (userId: string): Promise<PublicUser | null> => {
    const known = knownUser(userId);
    if (known) return known;
    try {
      const payload = await api.getPublicUser(token, userId);
      return payload.user;
    } catch {
      return null;
    }
  };

  const handleCallEnded = (event: CallEndedEvent) => {
    if (!event.peer) return;
    // Regular call outcomes (ended/missed/declined/cancelled) are persisted
    // server-side and arrive via 'messenger:message'. Only surface client-only
    // outcomes here as ephemeral notes.
    if (event.reason !== 'busy' && event.reason !== 'unavailable') return;
    const label = event.reason === 'busy' ? t(language, 'userBusy') : t(language, 'userOffline');

    const systemMessage: MessengerMessage = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: event.outgoing ? currentUser.id : event.peer.id,
      recipientId: event.outgoing ? event.peer.id : currentUser.id,
      senderGroup: null,
      body: `\u{1F4DE} ${label}`,
      imageData: null,
      imageName: null,
      imageSpoiler: false,
      editedAt: null,
      deletedAt: null,
      readAt: null,
      createdAt: new Date().toISOString(),
      pinnedAt: null,
      reactions: [],
      replyTo: null
    };

    setMessages((current) => {
      const peerId = event.peer!.id;
      const active = selectedUserRef.current?.id === peerId && activeViewRef.current === 'directMessages';
      return active ? [...current, systemMessage] : current;
    });
  };

  const voiceCall = useVoiceCall({
    socket: socketInstance,
    currentUser,
    resolveUser: resolveUserForCall,
    onCallEnded: handleCallEnded
  });

  // Multi-party group voice channels (mesh WebRTC). Lifted here so the
  // connection survives navigating between channels/chats.
  const voiceRoom = useVoiceRoom({ socket: socketInstance, currentUser });
  const selfStatus = useUserStatus();

  // Accept a call that was answered from the desktop toast while the messenger
  // window was closed or minimized (the hook never saw `call:incoming` then).
  useEffect(() => {
    if (!pendingCallAccept || !socketInstance) return;
    const { callId, callerId } = pendingCallAccept;
    onPendingCallHandled?.();
    void (async () => {
      const caller = await resolveUserForCall(callerId);
      if (caller) await voiceCall.acceptCallById(callId, caller);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCallAccept, socketInstance]);

  // Mutual exclusion between the two voice contexts: a 1:1 DM call and a group
  // voice channel. Joining/starting one must disconnect you from the other so you
  // are never live in two places at once.
  const prevCallActiveRef = useRef(false);
  const prevRoomChannelRef = useRef<string | null>(null);
  useEffect(() => {
    const callActive = voiceCall.phase !== 'idle' && voiceCall.phase !== 'incoming';
    const roomChannel = voiceRoom.activeChannelId;
    const callJustStarted = callActive && !prevCallActiveRef.current;
    const roomJustJoined = Boolean(roomChannel) && roomChannel !== prevRoomChannelRef.current;

    // Only the transition that *just happened* wins, so we never undo the action
    // the user just took (e.g. starting a DM call must not be cancelled by the
    // same pass also "seeing" the still-connected group channel).
    if (callJustStarted && roomChannel) {
      // The user started/answered a DM call -> leave any group voice channel.
      voiceRoom.leave();
    } else if (roomJustJoined && callActive) {
      // The user (re)joined a group voice channel -> hang up any DM call.
      voiceCall.hangup();
    }

    prevCallActiveRef.current = callActive;
    prevRoomChannelRef.current = roomChannel;
  }, [voiceCall.phase, voiceRoom.activeChannelId, voiceCall.hangup, voiceRoom.leave]);

  // Report the ongoing call upwards so the desktop can show the floating
  // call badge while the messenger is minimized or closed.
  useEffect(() => {
    if (!onCallStateChange) return;
    if ((voiceCall.phase === 'active' || voiceCall.phase === 'connecting') && voiceCall.peer) {
      onCallStateChange({
        phase: voiceCall.phase,
        peer: voiceCall.peer,
        elapsed: voiceCall.elapsed,
        videoStream: voiceCall.remoteVideoStream ?? voiceCall.localScreenStream,
        hangup: voiceCall.hangup
      });
    } else {
      onCallStateChange(null);
    }
  }, [onCallStateChange, voiceCall.phase, voiceCall.peer, voiceCall.elapsed, voiceCall.remoteVideoStream, voiceCall.localScreenStream, voiceCall.hangup]);

  useEffect(() => () => onCallStateChange?.(null), [onCallStateChange]);

  // The call is "in this chat" when its peer is the currently selected DM user.
  const callInThisChat = Boolean(
    voiceCall.peer && selectedUser && voiceCall.peer.id === selectedUser.id && activeView === 'directMessages' && !selectedGroup
  );
  // Whether we should show the Discord-style split panel above the chat.
  const callConnectedActive = voiceCall.phase === 'active' || voiceCall.phase === 'connecting';
  const showCallStage = callInThisChat && callConnectedActive;

  useEffect(() => {
    if (voiceCall.phase === 'idle') setCallChatCollapsed(false);
  }, [voiceCall.phase]);

  // Close the search panel when clicking outside it (but not on the search
  // toggle button in the header, which manages its own open/close).
  useEffect(() => {
    if (!searchMode) return;
    function onPointerDown(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement;
      if (searchPanelRef.current?.contains(target)) return;
      if (target.closest('.messenger-chat-header-actions')) return;
      setSearchMode(false);
      setConvSearchQuery('');
      setConvSearchResults([]);
    }
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [searchMode]);

  // Debounced conversation search: re-run shortly after the query settles.
  useEffect(() => {
    if (!searchMode) return;
    const q = convSearchQuery.trim();
    if (!q) { setConvSearchResults([]); return; }
    const timer = window.setTimeout(() => void runSearch(q), 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convSearchQuery, searchMode, selectedUser?.id]);

  async function chooseUser(person: PublicUser) {
    selectedUserRef.current = person;
    activeViewRef.current = 'directMessages';
    setSelectedUser(person);
    setSelectedGroup(null);
    setActiveView('directMessages');
    // Reset the search/right-panel UI for the newly opened conversation.
    setSearchMode(false);
    setConvSearchQuery('');
    setConvSearchResults([]);
    setRightPanelOpen(false);
    setRightPanelUser(null);
    setPanelSection(null);
    setSharedImages(null);
    setSharedLinks(null);
    setMutualGroups(null);
    setMutualFriends(null);
    if (isAiAssistantUserId(person.id)) {
      setBlockState({ blocked: false, blockedMe: false });
      setMessages([]);
      setThreadLoading(false);
      setHasMoreMessages(false);
      setLoadingOlder(false);
      loadingOlderRef.current = false;
      setPinCursor(0);
      setConversationPinnedMessages([]);
      setEditingMessage(null);
      return;
    }

    const cacheKey = dmCacheKey(currentUser.id, person.id);
    const cachedBlockState = blockStateCacheRef.current.get(cacheKey);
    if (cachedBlockState && Date.now() - cachedBlockState.loadedAt < BLOCK_STATE_CACHE_TTL_MS) {
      setBlockState(cachedBlockState.state);
    } else {
      setBlockState({ blocked: false, blockedMe: false });
      void api.getBlockState(token, person.id)
        .then((state) => {
          blockStateCacheRef.current.set(cacheKey, { state, loadedAt: Date.now() });
          if (selectedUserRef.current?.id === person.id) setBlockState(state);
        })
        .catch(() => undefined);
    }
    // Show the cached thread immediately (if any) to avoid a visible empty
    // state while the latest messages are fetched in the background.
    const cached = messageCacheRef.current.get(cacheKey);
    setMessages(cached ?? []);
    // Only show skeleton placeholders when there is no cached thread to display.
    setThreadLoading(!cached);
    setHasMoreMessages(false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    setPinCursor(0);
    setConversationPinnedMessages([]);
    setEditingMessage(null);
    setUserMenu(null);
    replaceMessageDraft('');
    setImageCaptionDraft('');
    setPendingImages([]);
    setEmojiOpen(false);
    setImageEmojiOpen(false);
    setError('');
    emitTyping(person.id, false);

    void api.getConversationPinnedMessages(token, person.id, { limit: 100 })
      .then((payload) => {
        if (selectedUserRef.current?.id === person.id) setConversationPinnedMessages(payload.messages);
      })
      .catch(() => {
        if (selectedUserRef.current?.id === person.id) setConversationPinnedMessages([]);
      });

    const cachedAt = messageCacheLoadedAtRef.current.get(cacheKey) ?? 0;
    if (cached && Date.now() - cachedAt < DM_THREAD_CACHE_TTL_MS) {
      setThreadLoading(false);
      setConversations((current) => current.map((conversation) => (
        conversation.user.id === person.id ? { ...conversation, unreadCount: 0 } : conversation
      )));
      void api.markMessagesRead(token, person.id)
        .then((receipt) => {
          if (!receipt.messageIds.length || !receipt.readAt) return;
          const readIds = new Set(receipt.messageIds);
          const applyReadAt = (message: MessengerMessage): MessengerMessage => (
            readIds.has(message.id) ? { ...message, readAt: message.readAt ?? receipt.readAt } : message
          );
          messageCacheRef.current.set(cacheKey, (messageCacheRef.current.get(cacheKey) ?? []).map(applyReadAt));
          if (selectedUserRef.current?.id === person.id) setMessages((current) => current.map(applyReadAt));
        })
        .catch(() => undefined);
      return;
    }

    try {
      const payload = await api.getMessages(token, person.id);
      // Only apply if the user is still viewing this chat (avoids clobbering a
      // freshly opened different conversation when responses arrive out of order).
      if (selectedUserRef.current?.id === person.id) {
        setMessages((current) => {
          const merged = preservePendingReactions(payload.messages, current);
          messageCacheRef.current.set(cacheKey, merged);
          messageCacheLoadedAtRef.current.set(cacheKey, Date.now());
          return merged;
        });
        setThreadLoading(false);
        setHasMoreMessages(payload.hasMore);
      } else {
        messageCacheRef.current.set(cacheKey, payload.messages);
        messageCacheLoadedAtRef.current.set(cacheKey, Date.now());
      }
      setConversations((current) => {
        const conv = current.find((c) => c.user.id === person.id);
        if (!conv) return current;
        const latestMsg = payload.messages.length > 0 ? payload.messages[payload.messages.length - 1] : conv.message;
        return [{ ...conv, unreadCount: 0, message: latestMsg }, ...current.filter((c) => c.user.id !== person.id)];
      });
    } catch (loadError) {
      if (selectedUserRef.current?.id === person.id) setThreadLoading(false);
      setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
    }
  }

  async function openSenderGroupProfile(senderGroup: SenderGroupSnapshot, anchorRect?: { left: number; top: number; right: number; bottom: number } | null) {
    const known = groupsRef.current.find((group) => group.id === senderGroup.id);
    const fallback = known ?? groupFromSenderSnapshot(senderGroup);
    setGroupIdentityProfile({
      group: fallback,
      memberCount: 0,
      isMember: Boolean(known),
      loading: true,
      anchorRect
    });
    setGroupIdentityProfileBusy(false);

    try {
      const payload = await api.getGroupPublicProfile(token, senderGroup.id);
      setGroupIdentityProfile({
        group: payload.group,
        memberCount: payload.memberCount,
        isMember: payload.isMember,
        loading: false,
        anchorRect
      });
      if (payload.isMember) {
        setGroups((current) => current.some((group) => group.id === payload.group.id)
          ? current.map((group) => group.id === payload.group.id ? payload.group : group)
          : [payload.group, ...current]);
      }
    } catch (profileError) {
      setGroupIdentityProfile((current) => current && current.group.id === senderGroup.id
        ? {
            ...current,
            loading: false,
            error: profileError instanceof Error ? profileError.message : t(language, 'unknownError')
          }
        : current);
    }
  }

  function openGroupFromIdentityProfile() {
    if (!groupIdentityProfile?.isMember) return;
    const group = groups.find((candidate) => candidate.id === groupIdentityProfile.group.id) ?? groupIdentityProfile.group;
    setGroups((current) => current.some((candidate) => candidate.id === group.id)
      ? current.map((candidate) => candidate.id === group.id ? group : candidate)
      : [group, ...current]);
    setPanelSection(null);
    setRightPanelOpen(false);
    setGroupIdentityProfile(null);
    setActiveView('directMessages');
    setSelectedGroup(group);
    setSelectedUser(null);
    setMessages([]);
    onGroupMentionsRead?.(group.id);
  }

  async function joinGroupFromIdentityProfile() {
    if (!groupIdentityProfile || groupIdentityProfileBusy) return;
    const groupId = groupIdentityProfile.group.id;
    setGroupIdentityProfileBusy(true);
    setGroupIdentityProfile((current) => current ? { ...current, error: undefined } : current);
    try {
      const payload = await api.joinGroupById(token, groupId);
      setGroups((current) => current.some((group) => group.id === payload.group.id)
        ? current.map((group) => group.id === payload.group.id ? payload.group : group)
        : [payload.group, ...current]);
      setGroupIdentityProfile({
        group: payload.group,
        memberCount: payload.memberCount,
        isMember: payload.isMember,
        loading: false,
        anchorRect: groupIdentityProfile.anchorRect
      });
    } catch (joinError) {
      setGroupIdentityProfile((current) => current ? {
        ...current,
        error: joinError instanceof Error ? joinError.message : t(language, 'unknownError')
      } : current);
    } finally {
      setGroupIdentityProfileBusy(false);
    }
  }

  async function leaveGroupFromIdentityProfile() {
    if (!groupIdentityProfile || groupIdentityProfileBusy) return;
    const groupId = groupIdentityProfile.group.id;
    setGroupIdentityProfileBusy(true);
    setGroupIdentityProfile((current) => current ? { ...current, error: undefined } : current);
    try {
      await api.removeGroupMember(token, groupId, currentUser.id);
      setGroups((current) => current.filter((group) => group.id !== groupId));
      setGroupConversations((current) => current.filter((conversation) => conversation.group.id !== groupId));
      setSelectedGroup((current) => current?.id === groupId ? null : current);
      setGroupIdentityProfile((current) => current ? {
        ...current,
        memberCount: Math.max(0, current.memberCount - 1),
        isMember: false,
        loading: false
      } : current);
    } catch (leaveError) {
      setGroupIdentityProfile((current) => current ? {
        ...current,
        error: leaveError instanceof Error ? leaveError.message : t(language, 'unknownError')
      } : current);
    } finally {
      setGroupIdentityProfileBusy(false);
    }
  }

  async function applyMessengerNavLocation(location: MessengerNavLocation) {
    navApplyingRef.current = true;
    setPanelSection(null);
    setFriendsTab(location.friendsTab);

    if (location.selectedGroupId) {
      const group = groupsRef.current.find((candidate) => candidate.id === location.selectedGroupId)
        ?? groupConversations.find((candidate) => candidate.group.id === location.selectedGroupId)?.group
        ?? null;
      setActiveView('directMessages');
      setSelectedUser(null);
      setSelectedGroup(group);
      setMessages([]);
      setSearchMode(false);
      setConvSearchQuery('');
      setConvSearchResults([]);
      setRightPanelOpen(false);
      window.setTimeout(() => { navApplyingRef.current = false; }, 0);
      return;
    }

    if (location.selectedUserId) {
      const user = knownUser(location.selectedUserId);
      if (user) {
        void chooseUser(user);
        setSearchMode(location.searchMode);
        if (location.searchMode) setRightPanelOpen(false);
        if (location.rightPanelOpen) openRightPanel(user);
      } else {
        setActiveView('directMessages');
        setSelectedUser(null);
        setSelectedGroup(null);
        setMessages([]);
        setSearchMode(false);
        setRightPanelOpen(false);
      }
      window.setTimeout(() => { navApplyingRef.current = false; }, 0);
      return;
    }

    setActiveView(location.activeView);
    setSelectedUser(null);
    setSelectedGroup(null);
    setMessages([]);
    setSearchMode(false);
    setConvSearchQuery('');
    setConvSearchResults([]);
    setRightPanelOpen(false);
    window.setTimeout(() => { navApplyingRef.current = false; }, 0);
  }

  function moveMessengerHistory(delta: -1 | 1) {
    const nextIndex = navState.index + delta;
    const nextLocation = navState.entries[nextIndex];
    if (!nextLocation) return;
    setNavState((current) => ({ ...current, index: nextIndex }));
    void applyMessengerNavLocation(nextLocation);
  }

  function openDirectMessagesHome() {
    selectedUserRef.current = null;
    activeViewRef.current = 'directMessages';
    setActiveView('directMessages');
    setSelectedGroup(null);
    setSelectedUser(null);
    setMessages([]);
    setSearchMode(false);
    setConvSearchQuery('');
    setConvSearchResults([]);
    setRightPanelOpen(false);
    setRightPanelUser(null);
    setPanelSection(null);
  }

  // Load the previous page of messages when the user scrolls to the top of the
  // thread. The oldest currently-loaded message id is the cursor. Scroll
  // position is preserved by measuring the height delta after prepending.
  async function loadOlderMessages() {
    const person = selectedUserRef.current;
    if (!person || loadingOlderRef.current || !hasMoreMessages) return;
    const oldest = messages[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const thread = threadRef.current;
    const previousHeight = thread?.scrollHeight ?? 0;
    const previousTop = thread?.scrollTop ?? 0;
    olderScrollAnchorRef.current = { previousTop, previousHeight, until: Date.now() + 8000 };
    try {
      const payload = await api.getMessages(token, person.id, { before: oldest.id });
      if (selectedUserRef.current?.id !== person.id) return;
      if (payload.messages.length > 0) {
        setMessages((current) => {
          const seen = new Set(current.map((m) => m.id));
          const older = payload.messages.filter((m) => !seen.has(m.id));
          const next = [...older, ...current];
          messageCacheRef.current.set(dmCacheKey(currentUser.id, person.id), next);
          return next;
        });
        scheduleOlderScrollRestore();
      } else {
        olderScrollAnchorRef.current = null;
      }
      setHasMoreMessages(payload.hasMore);
    } catch (loadError) {
      olderScrollAnchorRef.current = null;
      setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
    } finally {
      setLoadingOlder(false);
      window.setTimeout(() => { loadingOlderRef.current = false; }, 1200);
    }
  }

  // Scroll the thread to a message by id and flash it. Returns true if found.
  function scrollToLoadedMessage(messageId: string): boolean {
    const el = document.getElementById('msg-' + messageId);
    const node = threadRef.current;
    if (!el || !node) return false;
    const tRect = node.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    node.scrollBy({ top: elRect.top - tRect.top - 80, behavior: 'smooth' });
    el.classList.add('message-jump-highlight');
    window.setTimeout(() => el.classList.remove('message-jump-highlight'), 1200);
    return true;
  }

  // Jump to any message (even one outside the loaded page): if it's already
  // rendered, scroll to it; otherwise fetch a window of messages around it,
  // replace the thread, then scroll once it has rendered.
  async function jumpToMessage(messageId: string) {
    const person = selectedUserRef.current;
    if (!person) return;
    if (scrollToLoadedMessage(messageId)) return;
    try {
      const payload = await api.getMessagesAround(token, person.id, messageId);
      if (selectedUserRef.current?.id !== person.id) return;
      setMessages((current) => {
        const merged = preservePendingReactions(payload.messages, current);
        messageCacheRef.current.set(dmCacheKey(currentUser.id, person.id), merged);
        return merged;
      });
      setHasMoreMessages(payload.hasMoreBefore);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => scrollToLoadedMessage(messageId)));
    } catch (jumpError) {
      setError(jumpError instanceof Error ? jumpError.message : t(language, 'unknownError'));
    }
  }

  // Run a server-side search of the open conversation. Debounced by the caller.
  async function runSearch(query: string) {
    const person = selectedUserRef.current;
    const q = query.trim();
    if (!person || !q) { setConvSearchResults([]); return; }
    setConvSearchLoading(true);
    try {
      const payload = await api.searchMessages(token, person.id, q);
      if (selectedUserRef.current?.id === person.id) setConvSearchResults(payload.messages);
    } catch {
      setConvSearchResults([]);
    } finally {
      setConvSearchLoading(false);
    }
  }

  // Open the right panel and lazily load the conversation's shared images and
  // the full profile (for the wallpaper hero, which list users omit).
  function openRightPanel(personOverride?: PublicUser | null) {
    setRightPanelOpen(true);
    const person = personOverride ?? selectedUserRef.current;
    if (!person) return;
    if (isAiAssistantUserId(person.id)) {
      setRightPanelUser(person);
      setSharedImages([]);
      setSharedLinks([]);
      setMutualGroups([]);
      setMutualFriends([]);
      return;
    }
    // Refresh the full profile each open so the wallpaper is current.
    void api.getPublicUser(token, person.id)
      .then((payload) => { if (selectedUserRef.current?.id === person.id || personOverride?.id === person.id) setRightPanelUser(payload.user); })
      .catch(() => undefined);
    const sameUser = () => selectedUserRef.current?.id === person.id || personOverride?.id === person.id;
    if (sharedImages === null) {
      void api.getConversationImages(token, person.id)
        .then((p) => { if (sameUser()) setSharedImages(p.images); })
        .catch(() => { if (sameUser()) setSharedImages([]); });
    }
    if (sharedLinks === null) {
      void api.getConversationLinks(token, person.id)
        .then((p) => { if (sameUser()) setSharedLinks(p.links); })
        .catch(() => { if (sameUser()) setSharedLinks([]); });
    }
    if (mutualGroups === null) {
      void api.getMutualGroups(token, person.id)
        .then((p) => { if (sameUser()) setMutualGroups(p.groups); })
        .catch(() => { if (sameUser()) setMutualGroups([]); });
    }
    if (mutualFriends === null) {
      void api.getMutualFriends(token, person.id)
        .then((p) => { if (sameUser()) setMutualFriends(p.friends); })
        .catch(() => { if (sameUser()) setMutualFriends([]); });
    }
  }

  function mediaItemsFromMessages(sourceMessages: MessengerMessage[], options: { includeBackground: boolean }) {
    const items: SharedMediaPanelItem[] = [];
    const seen = new Set<string>();
    const pushItem = (item: SharedMediaPanelItem) => {
      if (!item.src || seen.has(item.key)) return;
      seen.add(item.key);
      items.push(item);
    };

    if (options.includeBackground && selectedUser && selectedChatBackground.startsWith('data:image/')) {
      pushItem({
        key: `background:${selectedUser.id}:${selectedChatBackground.slice(0, 96)}`,
        messageId: null,
        src: selectedChatBackground,
        name: 'chat-background',
        createdAt: new Date().toISOString(),
        senderName: selectedUser.nickname,
        senderUser: selectedUser,
        kind: isGifSource(selectedChatBackground) ? 'gif' : 'image'
      });
    }

    for (const message of sourceMessages) {
      if (message.deletedAt || parseChatBackgroundMarker(message.body) || parseChatTtlMarker(message.body) !== null) continue;
      const senderUser = message.senderGroup ? undefined : (message.senderId === currentUser.id ? currentUser : selectedUser ?? undefined);
      const senderName = message.senderGroup?.name || senderUser?.nickname || '';
      getMessageMediaItems(message).forEach((media, index) => {
        if (!media.dataUrl || isVoiceAttachment(media.dataUrl, media.name) || isVideoCircleAttachment(media.dataUrl, media.name)) return;
        const kind = isGifSource(media.dataUrl) ? 'gif' : isImageSource(media.dataUrl) ? 'image' : null;
        if (!kind) return;
        pushItem({
          key: `${message.id}:${index}:${media.dataUrl}`,
          messageId: message.id,
          src: media.dataUrl,
          name: media.name ?? (kind === 'gif' ? 'GIF' : t(language, 'imageMessage')),
          createdAt: message.createdAt,
          senderName,
          senderUser,
          kind
        });
      });
    }

    return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  const sharedMediaItems = mediaItemsFromMessages(sharedImages ?? messages, { includeBackground: true });
  const imageItems = sharedMediaItems.filter((item) => item.kind === 'image');
  const gifItems = sharedMediaItems.filter((item) => item.kind === 'gif');
  const linkItems = (sharedLinks ?? []).flatMap((message) =>
    extractMessageUrls(message.body).map((url, index) => ({ message, url, index }))
  );

  function openPanelSection(section: RightPanelSection) {
    openRightPanel();
    setPanelSection(section);
  }

  function panelSectionLabel(section: RightPanelSection) {
    if (section === 'images') return t(language, 'sharedImages');
    if (section === 'gifs') return t(language, 'gifs');
    if (section === 'links') {
      if (language === 'ru') return '\u0421\u0441\u044b\u043b\u043a\u0438';
      if (language === 'uk') return '\u041f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f';
      return 'Links';
    }
    if (section === 'groups') return t(language, 'mutualGroups');
    return t(language, 'mutualFriends');
  }

  function panelSectionCount(section: RightPanelSection) {
    if (section === 'images') return sharedImages === null ? null : imageItems.length;
    if (section === 'gifs') return sharedImages === null ? null : gifItems.length;
    if (section === 'links') return sharedLinks === null ? null : linkItems.length;
    if (section === 'groups') return mutualGroups === null ? null : mutualGroups.length;
    return mutualFriends === null ? null : mutualFriends.length;
  }

  function jumpFromPanel(messageId: string) {
    setPanelSection(null);
    void jumpToMessage(messageId);
  }

  function openImageViewer(src: string, name: string) {
    const allMedia = mediaItemsFromMessages([...(sharedImages ?? []), ...messages], { includeBackground: true });
    const items: MediaLightboxItem[] = allMedia.map((item) => ({
      src: item.src,
      name: item.name,
      senderName: item.senderName,
      senderUser: item.senderUser,
      createdAt: item.createdAt
    }));
    const index = items.findIndex((item) => item.src === src);
    setImageViewer(index >= 0 ? { items, index } : { items: [{ src, name }], index: 0 });
  }

  function openImageMessageMenu(event: MouseEvent<HTMLElement>, message: MessengerMessage, src: string) {
    event.preventDefault();
    event.stopPropagation();
    if (message.deletedAt) return;
    setMessageMenu({ x: event.clientX, y: event.clientY, message, imageSrc: src });
  }

  async function copyPanelLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be unavailable in some embedded contexts.
    }
  }

  async function toggleBlock() {
    const person = selectedUserRef.current;
    if (!person) return;
    try {
      const next = blockState.blocked
        ? await api.unblockUser(token, person.id)
        : await api.blockUser(token, person.id);
      setBlockState(next);
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : t(language, 'unknownError'));
    }
  }

  async function addPerson(person: PublicUser) {
    setError('');

    try {
      const payload = await api.addFriend(token, person.id);
      setFriends(uniqueById(payload.friends));
      setRequests(payload.requests);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : t(language, 'unknownError'));
    }
  }

  async function acceptRequest(person: PublicUser) {
    setError('');

    try {
      const payload = await api.acceptFriendRequest(token, person.id);
      setFriends(uniqueById(payload.friends));
      setRequests(payload.requests);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : t(language, 'unknownError'));
    }
  }

  async function deleteRequest(person: PublicUser) {
    setError('');

    try {
      const payload = await api.deleteFriendRequest(token, person.id);
      setFriends(uniqueById(payload.friends));
      setRequests(payload.requests);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t(language, 'unknownError'));
    }
  }

  function replaceMessageDraft(value: string) {
    messageDraftRef.current = value;
    setMessageDraft(value);
    setMessageDraftSyncKey((current) => current + 1);
  }

  function emitTyping(recipientId: string, typing: boolean) {
    if (typing) {
      const now = Date.now();
      if (typingActiveRef.current && typingRecipientRef.current === recipientId && now - typingLastEmittedRef.current < 1200) return;
      if (typingActiveRef.current && typingRecipientRef.current && typingRecipientRef.current !== recipientId) {
        socketRef.current?.emit('messenger:typing', { recipientId: typingRecipientRef.current, typing: false });
      }
      typingRecipientRef.current = recipientId;
      typingActiveRef.current = true;
      typingLastEmittedRef.current = now;
      socketRef.current?.emit('messenger:typing', { recipientId, typing: true });
      return;
    }

    const targetId = typingRecipientRef.current ?? recipientId;
    if (!typingActiveRef.current && typingRecipientRef.current === null) return;
    typingActiveRef.current = typing;
    typingRecipientRef.current = null;
    typingLastEmittedRef.current = 0;
    socketRef.current?.emit('messenger:typing', { recipientId: targetId, typing: false });
  }

  async function uploadPendingChatImages(items: PendingChatImage[]) {
    const uploaded: PendingChatImage[] = [];
    for (const item of items) {
      if (!item.dataUrl.startsWith('data:image/')) {
        uploaded.push(item);
        continue;
      }
      const result = await api.uploadMessengerMedia(token, item);
      uploaded.push({ dataUrl: result.media.dataUrl, name: result.media.name ?? item.name, spoiler: item.spoiler });
    }
    return uploaded;
  }

  async function sendMessage(attachmentOverride?: PendingChatImage, sendOptions?: { scheduledAt?: string; sendWhenOnline?: boolean }) {
    if (!selectedUser) return;
    const recordingOverride = Boolean(attachmentOverride && (isVoiceAttachment(attachmentOverride.dataUrl, attachmentOverride.name) || isVideoCircleAttachment(attachmentOverride.dataUrl, attachmentOverride.name)));
    const batchImages = attachmentOverride ? [attachmentOverride] : pendingImages;
    const image = batchImages[0] ?? null;
    const body = recordingOverride ? '' : applySlashCommand(expandCustomEmojiShortcodes((image ? imageCaptionDraft : messageDraftRef.current).trim()));
    if (!body && !image) return;
    const activeSenderGroup = selectedUser.allowGroupIdentityMessages === false ? null : selectedGroupIdentity;

    if (editingMessage) {
      const nextMediaItems = editingMediaItems.map((item) => ({ dataUrl: item.dataUrl, name: item.name, spoiler: item.spoiler }));
      if (!body && nextMediaItems.length === 0) return;
      try {
        const payload = await api.editMessage(token, editingMessage.id, body, nextMediaItems);
        replaceMessage(payload.message);
        setEditingMessage(null);
        setEditingMediaItems([]);
        replaceMessageDraft('');
      } catch (editError) {
        setError(editError instanceof Error ? editError.message : t(language, 'unknownError'));
      }
      return;
    }

    if (!recordingOverride) {
      if (image) setImageCaptionDraft('');
      else replaceMessageDraft('');
      setPendingImages([]);
    }
    setImageEmojiOpen(false);
    setError('');
    const activeReplyTarget = replyTarget && messages.some((message) => message.id === replyTarget.id)
      ? replyTarget
      : null;
    const replyTo = activeReplyTarget?.id;
    const previousReply = activeReplyTarget;
    setReplyTarget(null);
    emitTyping(selectedUser.id, false);

    // Optimistic render: show the message instantly with a stable clientKey.
    // When the server responds we reconcile IN PLACE (keep the same clientKey)
    // so React updates the existing bubble instead of remounting it — that
    // remount was what made the message flash and jump. Rolled back on failure.
    const clientKey = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: MessengerMessage = {
      id: clientKey,
      senderId: currentUser.id,
      recipientId: selectedUser.id,
      senderGroup: activeSenderGroup ? { id: activeSenderGroup.id, name: activeSenderGroup.name, avatarData: activeSenderGroup.avatarData } : null,
      body,
      imageData: image ? image.dataUrl : null,
      imageName: image ? image.name ?? null : null,
      imageSpoiler: image ? image.spoiler ?? false : false,
      mediaItems: !recordingOverride && batchImages.length > 1
        ? batchImages.map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: item.spoiler }))
        : image ? [{ dataUrl: image.dataUrl, name: image.name ?? null, spoiler: image.spoiler }] : [],
      editedAt: null,
      deletedAt: null,
      readAt: null,
      createdAt: new Date().toISOString(),
      pinnedAt: null,
      reactions: [],
      replyTo: previousReply
        ? { id: previousReply.id, senderId: previousReply.senderId, body: previousReply.body, imageData: previousReply.imageData, imageName: previousReply.imageName, mediaItems: previousReply.mediaItems }
        : null,
      clientKey,
      pending: true
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const uploadedBatchImages = recordingOverride ? batchImages : await uploadPendingChatImages(batchImages);
      const uploadedImage = uploadedBatchImages[0] ?? null;
      const mediaItems = !recordingOverride && uploadedBatchImages.length > 1
        ? uploadedBatchImages.map((item) => ({ dataUrl: item.dataUrl, name: item.name, spoiler: item.spoiler }))
        : undefined;
      const payload = await api.sendMessage(
        token, selectedUser.id, body,
        uploadedImage && !mediaItems ? { dataUrl: uploadedImage.dataUrl, name: uploadedImage.name, spoiler: uploadedImage.spoiler } : undefined,
        replyTo, activeSenderGroup?.id ?? null, mediaItems,
        {
          scheduledAt: sendOptions?.scheduledAt,
          viewOnce: viewOnceArmed && Boolean(uploadedImage),
          sendWhenOnline: sendOptions?.sendWhenOnline
        }
      );
      setViewOnceArmed(false);
      // A scheduled / parked message is not part of the visible thread yet:
      // drop the optimistic bubble and let the "Scheduled" bar track it.
      if (sendOptions?.scheduledAt || sendOptions?.sendWhenOnline) {
        setMessages((current) => current.filter((message) => message.clientKey !== clientKey));
        setScheduledMessages((current) => [...current, payload.message]
          .sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime()));
        return;
      }
      setMessages((current) => {
        // If the socket broadcast already delivered the real message, drop our
        // placeholder. Otherwise replace it in place, preserving clientKey.
        const realAlreadyHere = current.some((message) => message.id === payload.message.id && message.clientKey !== clientKey);
        if (realAlreadyHere) return current.filter((message) => message.clientKey !== clientKey);
        return current.map((message) => (message.clientKey === clientKey ? { ...payload.message, clientKey } : message));
      });
      upsertConversation(payload.message);
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.clientKey !== clientKey));
      if (!recordingOverride) {
        if (image) setImageCaptionDraft(body);
        else replaceMessageDraft(body);
        setPendingImages(batchImages);
      }
      if (previousReply) setReplyTarget(previousReply);
      setError(sendError instanceof Error ? sendError.message : t(language, 'unknownError'));
      if (recordingOverride) throw sendError;
    }
  }

  // Translate the message body into the user's chosen target language and store
  // the result in ephemeral state. "Show original" simply drops it from state.
  async function translateMessage(message: MessengerMessage) {
    setMessageMenu(null);
    if (messageTranslations[message.id]) {
      // Toggle back to the original.
      setMessageTranslations((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
      return;
    }
    const source = message.body?.trim();
    if (!source) return;
    setTranslatingIds((prev) => new Set(prev).add(message.id));
    try {
      const target = getSavedTranslateTargetName();
      const { text } = await api.translateText(token, source, target);
      setMessageTranslations((prev) => ({ ...prev, [message.id]: text }));
    } catch (translateError) {
      setError(translateError instanceof Error ? translateError.message : t(language, 'translateFailed'));
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }

  // Reply: set the reply target so the composer shows the reply bar; the next
  // sent message references this message (Discord-style inline reply).
  function replyToMessage(message: MessengerMessage) {
    setMessageMenu(null);
    setReactionPicker(null);
    setReplyTarget({
      id: message.id,
      senderId: message.senderId,
      senderGroup: message.senderGroup,
      body: message.body,
      imageData: message.imageData,
      imageName: message.imageName,
      mediaItems: message.mediaItems,
      createdAt: message.createdAt
    });
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  function forwardBodyForMessage(message: Pick<MessengerMessage, 'body' | 'imageData' | 'imageName'>) {
    if (message.body.trim()) return message.body;
    if (isVideoCircleAttachment(message.imageData, message.imageName)) return language === 'ru' ? 'Видео кружок' : 'Video message';
    if (isVoiceAttachment(message.imageData, message.imageName)) return language === 'ru' ? 'Голосовое сообщение' : 'Voice message';
    if (message.imageData) return message.imageName || t(language, 'imageMessage');
    return '';
  }

  // Forward: open the shared "Forward to" modal seeded with this message body.
  function forwardMessage(message: MessengerMessage) {
    setMessageMenu(null);
    setReactionPicker(null);
    const text = forwardBodyForMessage(message);
    if (!text && !message.imageData) return;
    const senderName = message.senderGroup?.name || (message.senderId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? message.senderId.slice(0, 8)));
    setForwardSeed({
      body: text,
      senderName,
      sourceId: message.id,
      imageData: message.imageData,
      imageName: message.imageName,
      imageSpoiler: message.imageSpoiler
    });
  }

  // Send forwarded text to each selected user/group target, with an optional
  // caption appended below the forwarded body. Prefixed with a "Forwarded from
  // X:" line so the recipient can tell it is a forward, not a self-typed msg.
  async function performForward(targets: ForwardTarget[], caption: string) {
    const seed = forwardSeed;
    setForwardSeed(null);
    if (!seed) return;
    const body = encodeForward(seed.senderName, seed.body, caption, seed.sourceId);
    const rawImage = seed.imageData
      ? { dataUrl: seed.imageData, name: seed.imageName ?? undefined, spoiler: seed.imageSpoiler }
      : undefined;
    const image = rawImage?.dataUrl.startsWith('data:image/')
      ? (await uploadPendingChatImages([{ dataUrl: rawImage.dataUrl, name: rawImage.name ?? t(language, 'imageMessage'), spoiler: Boolean(rawImage.spoiler) }]))[0]
      : rawImage;
    const resolveGroupChannelId = async (groupId: string) => {
      const recentChannelId = groupConversations.find((conversation) => conversation.group.id === groupId)?.message.channelId;
      if (recentChannelId) return recentChannelId;
      const bootstrap = await api.getGroupBootstrap(token, groupId);
      return bootstrap.channels.find((channel) => channel.type === 'text')?.id ?? null;
    };
    for (const target of targets) {
      try {
        if (target.kind === 'user') {
          const payload = await api.sendMessage(token, target.id, body, image);
          if (selectedUser?.id === target.id) {
            setMessages((current) => (current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message]));
          }
          upsertConversation(payload.message);
        } else {
          const channelId = await resolveGroupChannelId(target.id);
          if (!channelId) throw new Error('No visible text channel for this group');
          await api.sendGroupMessage(token, target.id, body, channelId, image);
        }
      } catch (forwardError) {
        setError(forwardError instanceof Error ? forwardError.message : t(language, 'unknownError'));
      }
    }
  }

  // Toggle a one-click reaction on a DM message; the server broadcasts the
  // updated message which replaces it via the socket handler.
  async function toggleReaction(message: MessengerMessage, emoji: string) {
    const pendingKey = `${message.id}:${emoji}`;
    if (reactionTogglePendingRef.current.has(pendingKey)) return;
    reactionTogglePendingRef.current.add(pendingKey);
    setReactionPicker(null);
    setMessageMenu(null);
    recordRecentEmoji(emoji);
    applyOptimisticReaction(message, emoji);
    try {
      const payload = await api.toggleMessageReaction(token, message.id, emoji);
      replaceMessage(payload.message, emoji);
    } catch (reactError) {
      replaceMessage(message);
      setError(reactError instanceof Error ? reactError.message : t(language, 'unknownError'));
    } finally {
      reactionTogglePendingRef.current.delete(pendingKey);
    }
  }

  async function editMessage(message: MessengerMessage) {
    if (!canEditMessage(message)) return;
    setEditingMessage(message);
    setPendingImages([]);
    setEditingMediaItems(getMessageMediaItems(message).map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? t(language, 'imageMessage'), spoiler: item.spoiler })));
    replaceMessageDraft(message.body);
    setMessageMenu(null);
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  async function removeMessage(message: MessengerMessage) {
    try {
      const payload = await api.deleteMessage(token, message.id);
      replaceMessage(payload.message);
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setEditingMediaItems([]);
        replaceMessageDraft('');
      }
      setMessageMenu(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t(language, 'unknownError'));
    }
  }

  async function clearOpenConversation() {
    const target = clearConversationConfirm;
    if (!target) return;
    try {
      await api.clearConversation(token, target.id, clearForEveryone);
      const cacheKey = dmCacheKey(currentUser.id, target.id);
      messageCacheRef.current.set(cacheKey, []);
      messageCacheLoadedAtRef.current.set(cacheKey, Date.now());
      if (selectedUser?.id === target.id) {
        setMessages([]);
        setHasMoreMessages(false);
      }
      setConversations((current) => current.filter((conversation) => conversation.user.id !== target.id));
      setClearConversationConfirm(null);
      setClearForEveryone(false);
      void api.getConversations(token).then((payload) => setConversations(payload.conversations)).catch(() => undefined);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : t(language, 'unknownError'));
    }
  }

  async function chooseChatBackground(file: File | undefined) {
    if (!file || !selectedUser) return;
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) return;
    const targetUserId = selectedUser.id;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      const payload = await api.setConversationBackground(token, targetUserId, dataUrl);
      setDmBackgrounds((current) => ({ ...current, [targetUserId]: payload.settings.backgroundData }));
      setMessages((current) => (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message]));
      upsertConversation(payload.message);
    } catch (backgroundError) {
      setError(backgroundError instanceof Error ? backgroundError.message : t(language, 'unknownError'));
    }
  }

  async function clearChatBackground() {
    if (!selectedUser) return;
    const targetUserId = selectedUser.id;
    try {
      const payload = await api.setConversationBackground(token, targetUserId, '');
      setDmBackgrounds((current) => ({ ...current, [targetUserId]: payload.settings.backgroundData }));
      setMessages((current) => (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message]));
      upsertConversation(payload.message);
    } catch (backgroundError) {
      setError(backgroundError instanceof Error ? backgroundError.message : t(language, 'unknownError'));
    }
  }

  async function pinMessage(message: MessengerMessage) {
    try {
      const payload = await api.pinMessage(token, message.id);
      replaceMessage(payload.message);
      const otherId = payload.message.senderId === currentUser.id ? payload.message.recipientId : payload.message.senderId;
      if (selectedUserRef.current?.id === otherId) applyConversationPinnedMessage(payload.message);
      setMessageMenu(null);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : t(language, 'unknownError'));
    }
  }

  function updateMessageDraft(value: string) {
    messageDraftRef.current = value;
    // Typing does not push into `messageDraft` state (the input is local for
    // performance), so mirror just the slash-command prefix into state. That
    // re-renders only while a command is being typed, not on every keystroke.
    const slashPrefix = value.startsWith('/') && !value.includes(' ') ? value : '';
    setComposerSlashPrefix((current) => (current === slashPrefix ? current : slashPrefix));
    if (!selectedUser || editingMessage) return;
    const hasText = Boolean(value.trim());
    emitTyping(selectedUser.id, hasText);

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (hasText) {
      const recipientId = selectedUser.id;
      typingTimerRef.current = window.setTimeout(() => {
        emitTyping(recipientId, false);
      }, 1200);
    }
  }

  function insertEmoji(emoji: string) {
    messageInputRef.current?.insertText(emoji);
  }

  // Open the composer context menu at the cursor. Always shown so the user can
  // Paste even with an empty selection; when text is selected, Copy/Cut/Translate
  // become available too.
  function openComposerMenu(event: MouseEvent<HTMLElement>) {
    const selection = messageInputRef.current?.getSelection() ?? { start: messageDraftRef.current.length, end: messageDraftRef.current.length };
    const start = selection.start;
    const end = selection.end;
    const hasSelection = end > start && Boolean(messageDraftRef.current.slice(start, end));
    event.preventDefault();
    setComposerMenu({ x: event.clientX, y: event.clientY, start, end, hasSelection });
  }

  function openImageCaptionMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    setImageCaptionMenu({ x: event.clientX, y: event.clientY });
  }

  // Copy the current composer selection to the system clipboard.
  async function copyComposerSelection() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu || !menu.hasSelection) return;
    const draft = messageDraftRef.current;
    const text = draft.slice(menu.start, menu.end);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
  }

  // Cut the current composer selection: copy it, then remove it from the draft
  // and place the caret where the selection was.
  async function cutComposerSelection() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu || !menu.hasSelection) return;
    const draft = messageDraftRef.current;
    const text = draft.slice(menu.start, menu.end);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
    const next = draft.slice(0, menu.start) + draft.slice(menu.end);
    replaceMessageDraft(next);
    window.setTimeout(() => {
      messageInputRef.current?.setSelection(menu.start);
    }, 0);
  }

  // Paste clipboard media first; if there is no image, paste text into the
  // composer, replacing the current selection.
  async function pasteIntoComposer() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu) return;
    if (!editingMessage) {
      const files = await readClipboardImageFiles(MAX_CHAT_MEDIA_BATCH - pendingImages.length);
      if (files.length > 0) {
        for (const file of files) await prepareImageFromFile(file);
        return;
      }
    }
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch { return; }
    if (!clip) return;
    const draft = messageDraftRef.current;
    const next = draft.slice(0, menu.start) + clip + draft.slice(menu.end);
    replaceMessageDraft(next);
    window.setTimeout(() => {
      const caret = menu.start + clip.length;
      messageInputRef.current?.setSelection(caret);
    }, 0);
  }

  async function pasteIntoImageCaption() {
    setImageCaptionMenu(null);
    const files = await readClipboardImageFiles(MAX_CHAT_MEDIA_BATCH - pendingImages.length);
    if (files.length > 0) {
      for (const file of files) await prepareImageFromFile(file);
      return;
    }
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch { return; }
    if (clip) imageCaptionInputRef.current?.replaceSelection(clip);
  }

  // Copy a chat message's text body to the system clipboard from its right-click
  // menu. Strips internal pack-link tokens so only the readable text is copied.
  async function copyMessageText(message: MessengerMessage) {
    setMessageMenu(null);
    const raw = message.body ?? '';
    const text = hasPackLink(raw) ? stripPackLinks(raw) : raw;
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
  }

  // Translate the currently selected text in the composer into the user's chosen
  // composer target language and replace the selection in place.
  async function translateComposerSelection() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu) return;
    const draft = messageDraftRef.current;
    const source = draft.slice(menu.start, menu.end);
    if (!source.trim() || composerTranslating) return;
    setComposerTranslating(true);
    try {
      const target = getSavedComposerTranslateTargetName();
      const { text } = await api.translateText(token, source, target);
      const next = draft.slice(0, menu.start) + text + draft.slice(menu.end);
      replaceMessageDraft(next);
      window.setTimeout(() => {
        const caret = menu.start + text.length;
        messageInputRef.current?.setSelection(caret);
      }, 0);
    } catch (translateError) {
      setError(translateError instanceof Error ? translateError.message : t(language, 'translateFailed'));
    } finally {
      setComposerTranslating(false);
    }
  }

  // Send a Tenor GIF as an image message using its remote URL as the media src.
  async function sendGif(gif: TenorGif) {
    if (!selectedUser) return;
    setEmojiOpen(false);
    setError('');
    emitTyping(selectedUser.id, false);
    try {
      const payload = await api.sendMessage(token, selectedUser.id, '', { dataUrl: gif.url, name: gif.description });
      setMessages((current) => (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message]));
      upsertConversation(payload.message);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t(language, 'unknownError'));
    }
  }

  function insertImageEmoji(emoji: string) {
    imageCaptionInputRef.current?.insertText(emoji);
  }

  // Returns the conversation-list preview. When `kind` is 'plain' the value is a
  // simple label (deleted / call / image); when 'body' it is the raw message
  // body that may contain custom-emoji tokens and is rendered with images.
  function messagePreviewText(message: MessengerMessage): { kind: 'plain' | 'body'; value: string } {
    if (message.deletedAt) return { kind: 'plain', value: t(language, 'messageDeleted') };
    const callLabel = callMessageLabel(message, currentUser.id, language);
    if (callLabel) return { kind: 'plain', value: `\u{1F4DE} ${callLabel}` };
    const ttlMarker = parseChatTtlMarker(message.body);
    if (ttlMarker !== null) {
      return {
        kind: 'plain',
        value: language === 'ru'
          ? (ttlMarker > 0 ? '⏱ Исчезающие сообщения включены' : '⏱ Исчезающие сообщения выключены')
          : (ttlMarker > 0 ? '⏱ Disappearing messages on' : '⏱ Disappearing messages off')
      };
    }
    const backgroundAction = parseChatBackgroundMarker(message.body);
    if (backgroundAction) {
      return {
        kind: 'plain',
        value: language === 'ru'
          ? (backgroundAction === 'set' ? '\u0424\u043e\u043d \u0447\u0430\u0442\u0430 \u0438\u0437\u043c\u0435\u043d\u0435\u043d' : '\u0424\u043e\u043d \u0447\u0430\u0442\u0430 \u0443\u0431\u0440\u0430\u043d')
          : (backgroundAction === 'set' ? 'Chat background changed' : 'Chat background removed')
      };
    }
    const fwd = parseForward(message.body);
    if (fwd) return { kind: 'body', value: fwd.caption || fwd.body };
    if (message.body) return { kind: 'body', value: message.body };
    if (isVideoCircleAttachment(message.imageData, message.imageName)) {
      return { kind: 'plain', value: language === 'ru' ? 'Видео кружок' : 'Video message' };
    }
    if (isVoiceAttachment(message.imageData, message.imageName)) {
      return { kind: 'plain', value: language === 'ru' ? 'Голосовое сообщение' : 'Voice message' };
    }
    return { kind: 'plain', value: message.imageData ? t(language, 'imageMessage') : '' };
  }

  function canAcceptImageDrop(event: DragEvent<HTMLElement>) {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes('Files') && !types.includes('application/notoc-storage-item')) return false;
    // Block drags that originate from avatar/presence images inside the app
    // (e.g. dragging a user avatar from the rail or chat thread).
    const src = event.target as Element | null;
    if (src?.closest?.('.messenger-avatar-wrap, .message-avatar, .profile-avatar-wrap, .group-embed-avatar, .window-title-avatar, .profile-mutual-item img, .messenger-person-card img')) {
      return false;
    }
    return true;
  }

  async function prepareImageFromFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError(t(language, 'imageOnlyMessage'));
      return;
    }

    if (file.size > MAX_CHAT_IMAGE_SIZE) {
      setError(t(language, 'chatImageTooLarge'));
      return;
    }

    const dataUrl = await readImageAsDataUrl(file);
    setPendingImages((current) => [...current, { dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
    setEmojiOpen(false);
    setImageEmojiOpen(false);
    setError('');
  }

  function prepareImageFromStorage(raw: string) {
    const item = JSON.parse(raw) as StorageItem;
    if (!isImageStorageItem(item) || !item.content) {
      setError(t(language, 'imageOnlyMessage'));
      return false;
    }

    if ((item.size ?? item.content.length) > MAX_CHAT_IMAGE_SIZE) {
      setError(t(language, 'chatImageTooLarge'));
      return false;
    }

    const content = item.content;
    setPendingImages((current) => [...current, { dataUrl: content, name: item.name, spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
    setEmojiOpen(false);
    setImageEmojiOpen(false);
    setError('');
    return true;
  }

  async function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    if (!selectedUser || editingMessage || !canAcceptImageDrop(event)) return;

    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setImageDragging(false);

    const storageItem = event.dataTransfer.getData('application/notoc-storage-item');
    if (storageItem) {
      try {
        prepareImageFromStorage(storageItem);
      } catch {
        setError(t(language, 'imageReadFailed'));
      }
      return;
    }

    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/')).slice(0, MAX_CHAT_MEDIA_BATCH);
    if (imageFiles.length === 0) {
      setError(t(language, 'imageOnlyMessage'));
      return;
    }

    try {
      for (const file of imageFiles) await prepareImageFromFile(file);
    } catch {
      setError(t(language, 'imageReadFailed'));
    }
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLElement>) {
    if (editingMessage) return;
    const files = clipboardImageFiles(event.clipboardData).slice(0, MAX_CHAT_MEDIA_BATCH);
    if (files.length === 0) return;
    const signature = files.map((file) => `${file.name}:${file.size}:${file.type}:${file.lastModified}`).join('|');
    const now = Date.now();
    if (lastPasteRef.current?.signature === signature && now - lastPasteRef.current.at < 350) return;
    lastPasteRef.current = { signature, at: now };
    event.preventDefault();
    for (const file of files) await prepareImageFromFile(file);
  }

  function closeImageDraft() {
    setPendingImages([]);
    setImageCaptionDraft('');
    setImageEmojiOpen(false);
  }

  function isOnline(person: PublicUser) {
    if (person.id === currentUser.id) return selfStatus.status !== 'invisible';
    return Boolean(presenceStatuses[person.id]) || onlineUserIds.includes(person.id);
  }

  function visiblePresenceStatus(person: PublicUser): PresenceStatus | null {
    if (person.id === currentUser.id) return selfStatus.status === 'invisible' ? null : selfStatus.status;
    return presenceStatuses[person.id] ?? (onlineUserIds.includes(person.id) ? 'online' : null);
  }

  function presenceDotClass(person: PublicUser) {
    const status = visiblePresenceStatus(person);
    return status ? `presence-dot status-${status}` : 'presence-dot';
  }

  function presenceLabel(person: PublicUser) {
    const status = visiblePresenceStatus(person);
    if (status === 'idle') return t(language, 'statusIdle');
    if (status === 'dnd') return t(language, 'statusDnd');
    if (person.id === currentUser.id && selfStatus.status === 'invisible') return t(language, 'statusInvisible');
    if (!status) return t(language, 'offline');
    return t(language, 'statusOnline');
  }

  function isOutgoing(person: PublicUser) {
    return requests.outgoing.some((request) => request.id === person.id);
  }

  function unreadCountForUser(userId: string) {
    return conversations.find((conversation) => conversation.user.id === userId)?.unreadCount ?? 0;
  }

  function canEditMessage(message: MessengerMessage) {
    if (message.senderId !== currentUser.id || message.deletedAt) return false;
    if (Date.now() - new Date(message.createdAt).getTime() > MESSAGE_EDIT_WINDOW_MS) return false;
    const messageTime = new Date(message.createdAt).getTime();
    const newerMessages = messages.filter((item) => !item.deletedAt && new Date(item.createdAt).getTime() > messageTime).length;
    return newerMessages < MESSAGE_EDIT_RECENT_LIMIT;
  }

  function openUserMenu(event: MouseEvent, person: PublicUser) {
    event.preventDefault();
    event.stopPropagation();
    setMessageMenu(null);
    setUserMenu({
      x: event.clientX,
      y: event.clientY,
      user: person
    });
  }

  function renderPerson(person: PublicUser, source: 'friend' | 'search' | 'incoming' | 'outgoing') {
    const friend = friends.some((candidate) => candidate.id === person.id);
    const outgoing = isOutgoing(person);
    const unreadCount = unreadCountForUser(person.id);

    const plate = nameplateStyle(person);
    return (
      <article className={`${selectedUser?.id === person.id ? 'messenger-person-card active' : 'messenger-person-card'}${plate ? ' has-nameplate' : ''}`} style={plate} key={`${source}-${person.id}`} onContextMenu={(event) => openUserMenu(event, person)}>
        <button className="messenger-person-main" type="button" onClick={() => void chooseUser(person)}>
          <span className="messenger-avatar-wrap">
            <img src={person.avatarData} alt="" draggable={false} />
            <i className={`${presenceDotClass(person)}${typingUserIds.includes(person.id) ? ' typing' : ''}`}>
              {typingUserIds.includes(person.id) ? <span className="typing-presence-dots" aria-hidden="true"><b /><b /><b /></span> : null}
            </i>
          </span>
          <span>
            <UserName user={person} as="strong" />
            <small>{presenceLabel(person)}</small>
          </span>
        </button>
        <div className="messenger-person-actions">
          {unreadCount > 0 ? <span className="unread-badge">{unreadLabel(unreadCount)}</span> : null}
          {source === 'incoming' ? (
            <button className="primary-action compact-action" type="button" onClick={() => void acceptRequest(person)}>
              {t(language, 'acceptRequest')}
            </button>
          ) : null}
          {source === 'incoming' ? (
            <button className="secondary-action compact-action" type="button" onClick={() => void deleteRequest(person)}>
              {t(language, 'declineRequest')}
            </button>
          ) : null}
          {!friend && source !== 'incoming' ? (
            <button className="secondary-action compact-action" type="button" onClick={() => void (outgoing ? deleteRequest(person) : addPerson(person))}>
              {outgoing ? t(language, 'cancelRequest') : t(language, 'addFriend')}
            </button>
          ) : null}
          {friend ? (
            <button className="secondary-action compact-action" type="button" onClick={() => void chooseUser(person)}>
              {t(language, 'message')}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  function renderFriendsContent() {
    const onlineFriends = friends.filter(isOnline);
    const filter = friendFilter.trim().toLowerCase();

    if (friendsTab === 'requests') {
      return (
        <div className="messenger-friends-content">
          <section className="messenger-requests-panel">
            <div className="messenger-section-title compact-title">
              <strong>{t(language, 'friendRequests')}</strong>
              <span>{requests.incoming.length + requests.outgoing.length}</span>
            </div>
            <div className="messenger-request-columns two-columns">
              <div className="messenger-request-group">
                <p className="field-label compact">{t(language, 'incomingRequests')}</p>
                {requests.incoming.length === 0 ? <small className="muted-line">0</small> : null}
                {requests.incoming.map((person) => renderPerson(person, 'incoming'))}
              </div>
              <div className="messenger-request-group">
                <p className="field-label compact">{t(language, 'outgoingRequests')}</p>
                {requests.outgoing.length === 0 ? <small className="muted-line">0</small> : null}
                {requests.outgoing.map((person) => renderPerson(person, 'outgoing'))}
              </div>
            </div>
          </section>
        </div>
      );
    }

    if (friendsTab === 'sendRequest') {
      return (
        <div className="messenger-friends-content with-search">
          <section className="messenger-command-card">
            <input
              id="messenger-search"
              className="text-field"
              value={query}
              maxLength={24}
              placeholder={t(language, 'searchByNickname')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <small>{hasSearchQuery ? (loading ? t(language, 'checking') : t(language, 'searchResults')) : t(language, 'typeNicknameHint')}</small>
          </section>
          <section className="messenger-list-section">
            <div className="messenger-section-title">
              <strong>{t(language, 'searchResults')}</strong>
              <span>{hasSearchQuery ? searchResults.length : 0}</span>
            </div>
            <div className="messenger-people-list">
              {!hasSearchQuery ? <div className="explorer-empty">{t(language, 'typeNicknameHint')}</div> : null}
              {hasSearchQuery && searchResults.length === 0 && !loading ? <div className="explorer-empty">{t(language, 'noPeopleFound')}</div> : null}
              {hasSearchQuery ? searchResults.map((person) => renderPerson(person, 'search')) : null}
            </div>
          </section>
        </div>
      );
    }

    const visibleFriends = (friendsTab === 'online' ? onlineFriends : friends)
      .filter((person) => !filter || person.nickname.toLowerCase().includes(filter));

    return (
      <div className="messenger-friends-content friends-list-mode">
        <section className="messenger-friends-overview">
          <div className="messenger-friends-stat">
            <strong>{onlineFriends.length}</strong>
            <span>{t(language, 'onlineFriends')}</span>
          </div>
          <div className="messenger-friends-stat">
            <strong>{friends.length}</strong>
            <span>{t(language, 'allFriends')}</span>
          </div>
          <div className="messenger-friends-filter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            <input
              type="text"
              value={friendFilter}
              placeholder={t(language, 'search')}
              onChange={(event) => setFriendFilter(event.target.value)}
            />
          </div>
        </section>
        <section className="messenger-list-section">
          <div className="messenger-section-title">
            <strong>{friendsTab === 'online' ? t(language, 'onlineFriends') : t(language, 'allFriends')}</strong>
            <span>{visibleFriends.length}</span>
          </div>
          <div className="messenger-people-list">
            {filter && visibleFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noPeopleFound')}</div> : null}
            {!filter && friendsTab === 'online' && visibleFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noOnlineFriends')}</div> : null}
            {!filter && friendsTab === 'all' && visibleFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noFriends')}</div> : null}
            {visibleFriends.map((person) => renderPerson(person, 'friend'))}
          </div>
        </section>
      </div>
    );
  }

  // Centered header title reflecting the current location: an open chat shows the
  // peer's avatar + nickname, an open server shows its avatar + name, otherwise
  // the active tab (Friends / Direct messages / a Friends sub-tab) is shown.
  const friendsTabLabelKey: Record<FriendsTab, Parameters<typeof t>[1]> = {
    online: 'onlineFriends',
    all: 'allFriends',
    requests: 'friendRequests',
    sendRequest: 'sendRequest'
  };
  let centerTitle: React.ReactNode;
  if (selectedGroup) {
    centerTitle = (
      <>
        <img className="window-title-avatar" src={selectedGroup.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(selectedGroup.name[0] || '?').toUpperCase()}</text></svg>`} alt="" />
        <span>{selectedGroup.name}</span>
      </>
    );
  } else if (activeView !== 'friends' && selectedUser) {
    centerTitle = (
      <>
        <img className="window-title-avatar" src={selectedUser.avatarData} alt="" />
        <span>{selectedUser.nickname}</span>
      </>
    );
  } else if (activeView === 'friends') {
    centerTitle = <span>{t(language, friendsTabLabelKey[friendsTab])}</span>;
  } else {
    centerTitle = <span>{t(language, 'directMessages')}</span>;
  }

  const canGoBack = navState.index > 0;
  const canGoForward = navState.index < navState.entries.length - 1;
  const messengerTitleContent = (
    <div className="messenger-title-nav" aria-label={t(language, 'messenger')}>
      <button
        type="button"
        className="messenger-title-nav-button"
        aria-label={language === 'ru' ? 'Назад' : language === 'uk' ? 'Назад' : 'Back'}
        disabled={!canGoBack}
        onClick={() => moveMessengerHistory(-1)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        className="messenger-title-nav-button"
        aria-label={language === 'ru' ? 'Вперёд' : language === 'uk' ? 'Вперед' : 'Forward'}
        disabled={!canGoForward}
        onClick={() => moveMessengerHistory(1)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      <button
        type="button"
        className="messenger-title-nav-button messenger-title-home-button"
        aria-label={t(language, 'directMessages')}
        title={t(language, 'directMessages')}
        disabled={activeView === 'directMessages' && !selectedGroup && !selectedUser}
        onClick={openDirectMessagesHome}
      >
        <span className="watch-title-home-icon" aria-hidden="true" style={{ WebkitMaskImage: `url("${MESSENGER_HOME_ICON}")`, maskImage: `url("${MESSENGER_HOME_ICON}")` }} />
      </button>
      {onOpenInbox ? (
        <button
          type="button"
          className="messenger-title-nav-button messenger-title-inbox-button"
          aria-label={language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail'}
          title={language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail'}
          onClick={onOpenInbox}
        >
          <span className="messenger-header-inbox-icon" aria-hidden="true" />
          {inboxUnreadCount > 0 ? <span className="unread-badge inbox-button-badge">{unreadLabel(inboxUnreadCount)}</span> : null}
        </button>
      ) : null}
    </div>
  );

  return (
    <WindowFrame
      language={language}
      title={t(language, 'messenger')}
      titleContent={messengerTitleContent}
      centerTitle={centerTitle}
      className="messenger-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 470), y: 70 }}
      storageKey="messenger"
      minSize={{ width: 980, height: 620 }}
      defaultSize={{ width: 1240, height: 800 }}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      {onOpenInbox ? (
        <button
          type="button"
          className="messenger-header-inbox-button"
          aria-label={language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail'}
          title={language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail'}
          onClick={(event) => {
            event.stopPropagation();
            onOpenInbox();
          }}
        >
          <span className="messenger-header-inbox-icon" aria-hidden="true" />
          {inboxUnreadCount > 0 ? <span className="unread-badge inbox-button-badge">{unreadLabel(inboxUnreadCount)}</span> : null}
        </button>
      ) : null}
      <div
        className={imageDragging ? 'messenger-shell image-dragging' : 'messenger-shell'}
        onDragEnter={(event) => {
          if (!imageDropEnabled || !canAcceptImageDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current += 1;
          setImageDragging(true);
        }}
        onDragOver={(event) => {
          if (!imageDropEnabled || !canAcceptImageDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!imageDropEnabled || !canAcceptImageDrop(event)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setImageDragging(false);
        }}
        onDrop={(event) => void handleImageDrop(event)}
      >
        <nav className="messenger-rail" aria-label={t(language, 'friends')}>
          <div className="messenger-rail-list">
            <RailFolders
              scope="friends"
              language={language}
              items={friends.map<RailItem>((friend) => ({
                id: friend.id,
                name: friend.nickname,
                avatar: friend.avatarData,
                presence: visiblePresenceStatus(friend) ?? 'offline',
                unread: unreadCountForUser(friend.id),
                typing: typingUserIds.includes(friend.id),
                active: selectedUser?.id === friend.id,
                onOpen: () => void chooseUser(friend),
                onContextMenu: (event) => openUserMenu(event, friend)
              }))}
            />
            {groups.length > 0 ? <hr className="messenger-rail-divider" /> : null}
            <RailFolders
              scope="groups"
              language={language}
              items={groups.map<RailItem>((group) => ({
                id: group.id,
                name: group.name,
                avatar: group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(group.name[0]||'?').toUpperCase()}</text></svg>`,
                unread: groupMentionCounts[group.id] ?? 0,
                active: selectedGroup?.id === group.id,
                onOpen: () => { setSelectedGroup(group); setSelectedUser(null); setMessages([]); }
              }))}
            />
          </div>
          <button className="messenger-rail-create-group" type="button" onClick={() => setShowCreateGroup(true)} title={t(language, 'createGroup')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </nav>

        <div className="messenger-main">
        <div className={`${selectedGroup ? 'messenger-body group-selected' : activeView === 'friends' ? 'messenger-body friends-mode' : 'messenger-body'}${rightPanelOpen && selectedUser && !selectedGroup ? ' right-open' : ''}`} style={!selectedGroup && splitWidth ? { '--split-width': `${splitWidth}px` } as React.CSSProperties : undefined}>
        {selectedGroup ? null : searchMode && selectedUser ? (
          <aside ref={searchPanelRef} className="messenger-conversations-panel messenger-search-panel">
            <div className="messenger-search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
              <input
                autoFocus
                type="text"
                value={convSearchQuery}
                placeholder={t(language, 'search')}
                onChange={(e) => setConvSearchQuery(e.target.value)}
              />
              {convSearchQuery ? (
                <button type="button" className="messenger-search-clear" onClick={() => { setConvSearchQuery(''); setConvSearchResults([]); }} aria-label="clear">×</button>
              ) : null}
            </div>
            <div className="messenger-search-results">
              {convSearchLoading ? <div className="explorer-empty">…</div> : null}
              {!convSearchLoading && convSearchQuery.trim() && convSearchResults.length === 0 ? (
                <div className="explorer-empty">{t(language, 'noMessages')}</div>
              ) : null}
              {convSearchResults.map((result) => {
                const sender = result.senderId === currentUser.id ? currentUser : selectedUser;
                return (
                  <button
                    key={result.id}
                    type="button"
                    className="messenger-search-result"
                    onClick={() => void jumpToMessage(result.id)}
                  >
                    <span className="messenger-avatar-wrap">
                      <img src={sender?.avatarData ?? ''} alt="" draggable={false} />
                    </span>
                    <span className="messenger-search-result-text">
                      <span className="messenger-search-result-head">
                        <strong>{sender?.nickname ?? ''}</strong>
                        <small>{formatMessageDate(result.createdAt, language)}</small>
                      </span>
                      <MessagePreviewText text={result.body || (isVoiceAttachment(result.imageData, result.imageName) ? '🎤' : isVideoCircleAttachment(result.imageData, result.imageName) ? '📹' : result.imageData ? '📷' : '')} />
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : <aside className="messenger-conversations-panel">
          <div className="messenger-left-nav">
            <button className="messenger-left-nav-button" type="button" onClick={() => { setActiveView('friends'); setSelectedGroup(null); setSelectedUser(null); setMessages([]); }}>
              <span className="messenger-left-nav-icon friends" aria-hidden="true" />
              <strong>{t(language, 'friends')}</strong>
            </button>
          </div>
          <div className="messenger-section-title compact-title">
            <strong>{t(language, 'directMessages')}</strong>
            <span>{conversations.length + 1}</span>
          </div>
          <button
            className={isAiAssistantSelected ? 'messenger-conversation active messenger-conversation-ai' : 'messenger-conversation messenger-conversation-ai'}
            type="button"
            onClick={() => void chooseUser(aiAssistantUser)}
          >
            <span className="messenger-avatar-wrap">
              <img src={aiAssistantUser.avatarData} alt="" draggable={false} />
            </span>
            <span className="messenger-conversation-text">
              <UserName user={aiAssistantUser} as="strong" />
              <small>{language === 'ru' ? 'Личный AI-ассистент' : language === 'uk' ? 'Особистий AI-асистент' : 'Personal AI assistant'}</small>
            </span>
            <span className="messenger-conversation-meta">
              <span className="messenger-conversation-date-row">
                <time>{language === 'ru' ? 'сейчас' : language === 'uk' ? 'зараз' : 'now'}</time>
              </span>
            </span>
          </button>
          <button
            className={selectedUser?.id === currentUser.id ? 'messenger-conversation active messenger-conversation-saved' : 'messenger-conversation messenger-conversation-saved'}
            type="button"
            onClick={() => void chooseUser(currentUser)}
          >
            <span className="messenger-avatar-wrap messenger-saved-avatar">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 2h12a2 2 0 0 1 2 2v18l-8-4.5L4 22V4a2 2 0 0 1 2-2z"/></svg>
            </span>
            <span className="messenger-conversation-text">
              <strong>{language === 'ru' ? 'Избранное' : language === 'uk' ? 'Збережене' : 'Saved Messages'}</strong>
              <small>{language === 'ru' ? 'Заметки и файлы для себя' : language === 'uk' ? 'Нотатки та файли для себе' : 'Notes and files for yourself'}</small>
            </span>
          </button>
          <div className="messenger-search-box messenger-direct-message-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            <input
              type="text"
              value={globalSearchOpen ? globalSearchQuery : directMessageFilter}
              placeholder={globalSearchOpen
                ? (language === 'ru' ? 'Поиск по всем перепискам' : language === 'uk' ? 'Пошук за всіма чатами' : 'Search all conversations')
                : t(language, 'search')}
              aria-label={t(language, 'search')}
              onChange={(event) => (globalSearchOpen ? setGlobalSearchQuery(event.target.value) : setDirectMessageFilter(event.target.value))}
            />
            {(globalSearchOpen ? globalSearchQuery : directMessageFilter) ? (
              <button
                type="button"
                className="messenger-search-clear"
                onClick={() => (globalSearchOpen ? setGlobalSearchQuery('') : setDirectMessageFilter(''))}
                aria-label="clear"
              >×</button>
            ) : null}
            <button
              type="button"
              className={globalSearchOpen ? 'dm-global-search-toggle active' : 'dm-global-search-toggle'}
              title={language === 'ru' ? 'Искать во всех переписках' : 'Search across all conversations'}
              aria-label={language === 'ru' ? 'Искать во всех переписках' : 'Search across all conversations'}
              onClick={() => {
                setGlobalSearchOpen((open) => !open);
                setGlobalSearchQuery('');
                setDirectMessageFilter('');
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>
            </button>
          </div>
          {globalSearchOpen ? (
            <div className="dm-global-search-kinds">
              {(['all', 'media', 'links'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={globalSearchKind === kind ? 'active' : ''}
                  onClick={() => setGlobalSearchKind(kind)}
                >
                  {kind === 'all'
                    ? (language === 'ru' ? 'Все' : 'All')
                    : kind === 'media'
                      ? (language === 'ru' ? 'Фото' : 'Media')
                      : (language === 'ru' ? 'Ссылки' : 'Links')}
                </button>
              ))}
            </div>
          ) : (
            <div className="dm-list-filters">
              {(['all', 'unread', 'archived'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={dmListFilter === filter ? 'active' : ''}
                  onClick={() => setDmListFilter(filter)}
                >
                  {filter === 'all'
                    ? (language === 'ru' ? 'Все' : 'All')
                    : filter === 'unread'
                      ? (language === 'ru' ? 'Непрочитанные' : 'Unread')
                      : (language === 'ru' ? 'Архив' : 'Archive')}
                </button>
              ))}
            </div>
          )}
          <div className="messenger-conversation-list">
            {globalSearchOpen ? (
              <>
                {globalSearchLoading ? <div className="explorer-empty">{t(language, 'checking')}</div> : null}
                {!globalSearchLoading && globalSearchQuery.trim().length >= 2 && globalSearchResults.length === 0 ? (
                  <div className="explorer-empty">{t(language, 'noMessages')}</div>
                ) : null}
                {!globalSearchLoading && globalSearchQuery.trim().length < 2 ? (
                  <div className="explorer-empty">{language === 'ru' ? 'Введите минимум 2 символа' : 'Type at least 2 characters'}</div>
                ) : null}
                {globalSearchResults.map((result) => (
                  <button
                    key={result.message.id}
                    type="button"
                    className="messenger-search-result"
                    onClick={() => {
                      setGlobalSearchOpen(false);
                      setGlobalSearchQuery('');
                      void chooseUser(result.user).then(() => jumpToMessage(result.message.id));
                    }}
                  >
                    <span className="messenger-avatar-wrap">
                      <img src={result.user.avatarData} alt="" draggable={false} />
                    </span>
                    <span className="messenger-search-result-text">
                      <span className="messenger-search-result-head">
                        <strong>{result.user.nickname}</strong>
                        <small>{formatMessageDate(result.message.createdAt, language)}</small>
                      </span>
                      <MessagePreviewText text={result.message.body || (result.message.imageData ? '📷' : '')} />
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            {!globalSearchOpen && visibleConversations.length === 0 ? <div className="explorer-empty">{directMessageFilter.trim() ? t(language, 'noPeopleFound') : t(language, 'noMessages')}</div> : null}
            {globalSearchOpen ? null : visibleConversations.map((conversation) => {
              const convPlate = nameplateStyle(conversation.user);
              const pinned = pinnedConversations.has(conversation.user.id);
              const showReadState = conversation.message.senderId === currentUser.id && !conversation.message.pending;
              const readStateStyle = {
                '--read-state-icon': `url("${conversation.message.readAt ? MESSENGER_READ_ICON : MESSENGER_UNREAD_ICON}")`
              } as CSSProperties;
              const readStateIcon = showReadState ? (
                <span
                  className={conversation.message.readAt ? 'conversation-read-state read' : 'conversation-read-state unread'}
                  style={readStateStyle}
                  aria-hidden="true"
                />
              ) : null;
              return (
              <button className={`${selectedUser?.id === conversation.user.id ? 'messenger-conversation active' : 'messenger-conversation'}${convPlate ? ' has-nameplate' : ''}`} style={convPlate} type="button" key={conversation.user.id} onClick={() => void chooseUser(conversation.user)} onContextMenu={(event) => openUserMenu(event, conversation.user)}>
                <span className="messenger-avatar-wrap">
                  <img src={conversation.user.avatarData} alt="" draggable={false} />
                  <i className={`${presenceDotClass(conversation.user)}${typingUserIds.includes(conversation.user.id) ? ' typing' : ''}`}>
                    {typingUserIds.includes(conversation.user.id) ? <span className="typing-presence-dots" aria-hidden="true"><b /><b /><b /></span> : null}
                  </i>
                  {presenceActivities[conversation.user.id] ? (
                    <span
                      className="presence-activity-badge"
                      title={presenceActivities[conversation.user.id] === 'voice'
                        ? (language === 'ru' ? 'В голосовом канале' : 'In a voice channel')
                        : (language === 'ru' ? 'Смотрит Watch Together' : 'Watching together')}
                      aria-hidden="true"
                    >
                      {presenceActivities[conversation.user.id] === 'voice' ? '🎧' : '📺'}
                    </span>
                  ) : null}
                </span>
                <span className="messenger-conversation-text">
                  <UserName user={conversation.user} as="strong" />
                  <small>
                    {(() => {
                      const preview = messagePreviewText(conversation.message);
                      if (isVoiceAttachment(conversation.message.imageData, conversation.message.imageName) || isVideoCircleAttachment(conversation.message.imageData, conversation.message.imageName)) {
                        return (
                          <span className="voice-message-preview">
                            <span className={isVideoCircleAttachment(conversation.message.imageData, conversation.message.imageName) ? 'voice-message-preview-icon video' : 'voice-message-preview-icon'} aria-hidden="true" />
                            <span className="voice-message-preview-label">{preview.value}</span>
                          </span>
                        );
                      }
                      return preview.kind === 'body' ? <MessagePreviewText text={expandCustomEmojiShortcodes(preview.value)} /> : preview.value;
                    })()}
                  </small>
                </span>
                <span className="messenger-conversation-meta">
                  <span className="messenger-conversation-date-row">
                    {conversation.message.readAt && readStateIcon ? (
                      <Tooltip label={readReceiptLabel(conversation.user, conversation.message.readAt, language)} className="conversation-read-tooltip">
                        {readStateIcon}
                      </Tooltip>
                    ) : readStateIcon}
                    <time>{formatConversationDate(conversation.message.createdAt, language)}</time>
                  </span>
                  {conversation.unreadCount > 0 ? <span className="unread-badge">{unreadLabel(conversation.unreadCount)}</span> : null}
                  {conversation.unreadCount === 0 && pinned ? <span className="conversation-pin-icon" style={{ '--pin-icon': `url("${MESSENGER_PIN_ICON}")` } as CSSProperties} aria-hidden="true" /> : null}
                </span>
              </button>
              );
            })}
          </div>
        </aside>}
        {!selectedGroup ? <div className={resizing ? 'messenger-splitter resizing' : 'messenger-splitter'} onMouseDown={(event) => { event.preventDefault(); setResizing(true); }} /> : null}

        <section className={`${selectedGroup ? 'messenger-chat-panel group-mode' : 'messenger-chat-panel'}${isAiAssistantSelected ? ' ai-dm-selected' : ''}${showCallStage ? ' has-call-stage' : ''}${showCallStage && callChatCollapsed ? ' call-chat-collapsed' : ''}`}>
          {selectedGroup ? (
            <GroupChatView token={token} language={language} currentUser={currentUser} group={selectedGroup} onlineUserIds={onlineUserIds} presenceStatuses={presenceStatuses}
              initialChannelId={(localGroupRequest ?? initialGroupRequest)?.groupId === selectedGroup.id ? (localGroupRequest ?? initialGroupRequest)?.channelId ?? null : null}
              initialChannelRequestId={(localGroupRequest ?? initialGroupRequest)?.groupId === selectedGroup.id ? (localGroupRequest ?? initialGroupRequest)?.requestId ?? 0 : 0}
              voiceRoom={voiceRoom}
              onClose={() => { setSelectedGroup(null); setActiveView('directMessages'); setSelectedUser(null); setMessages([]); }}
              onViewProfile={(user, group, preload, anchorRect) => { setProfileUser(user); setProfileGroup(group); setProfilePreload(preload); setProfileAnchor(anchorRect ?? null); }}
              onCloseProfile={() => { setProfileUser(null); setProfileGroup(undefined); setProfilePreload(undefined); setProfileAnchor(null); }}
              onViewDesktop={onViewDesktop}
              onGroupJoin={(group) => setGroups((prev) => prev.find((g) => g.id === group.id) ? prev : [...prev, group])}
              memberGroupIds={memberGroupIds}
              onGroupNavigate={(groupId, channelId = null) => {
                const g = groups.find((x) => x.id === groupId) ?? groupConversations.find((x) => x.group.id === groupId)?.group ?? null;
                if (g) setLocalGroupRequest((current) => ({ groupId, group: g, channelId, requestId: (current?.requestId ?? 0) + 1 }));
              }}
              onOpenWatchTogether={onOpenWatchTogether}
              onForwardMessage={(seed) => setForwardSeed(seed)}
              deletedForwardSourceIds={deletedForwardSourceIds}
              onForwardSourceDeleted={(sourceId) => setDeletedForwardSourceIds((current) => new Set(current).add(sourceId))}
              onGroupLeft={(groupId) => {
                setGroups((current) => current.filter((g) => g.id !== groupId));
                setGroupConversations((current) => current.filter((gc) => gc.group.id !== groupId));
                setSelectedGroup((current) => current?.id === groupId ? null : current);
              }} />
          ) : activeView === 'friends' ? (
            <div className="messenger-friends-hub">
              <nav className="messenger-friend-tabs" aria-label={t(language, 'friends')}>
                <button className={friendsTab === 'online' ? 'messenger-nav-tab active' : 'messenger-nav-tab'} type="button" onClick={() => setFriendsTab('online')}>{t(language, 'onlineFriends')}</button>
                <button className={friendsTab === 'all' ? 'messenger-nav-tab active' : 'messenger-nav-tab'} type="button" onClick={() => setFriendsTab('all')}>{t(language, 'allFriends')}</button>
                <button className={friendsTab === 'requests' ? 'messenger-nav-tab active' : 'messenger-nav-tab'} type="button" onClick={() => setFriendsTab('requests')}>{t(language, 'friendRequests')}</button>
                <button className={friendsTab === 'sendRequest' ? 'messenger-nav-tab active' : 'messenger-nav-tab'} type="button" onClick={() => setFriendsTab('sendRequest')}>{t(language, 'sendRequest')}</button>
              </nav>
              {renderFriendsContent()}
            </div>
          ) : selectedUser && isAiAssistantSelected ? (
            <AiDmThread
              token={token}
              language={language}
              currentUser={currentUser}
              assistant={aiAssistantUser}
              onClose={openDirectMessagesHome}
              onUserChange={onUserChange}
              onAssistantSettingsChange={(settings) => {
                setAiAssistantName(settings.assistantName?.trim() || 'NotAI');
                setAiAssistantAvatarData(settings.assistantAvatarData || '');
              }}
            />
          ) : selectedUser ? (
            <>
              <header className="messenger-chat-header" onContextMenu={(event) => openUserMenu(event, selectedUser)}>
                <span className="messenger-avatar-wrap large" style={{ cursor: 'pointer' }} onClick={(event) => { setProfileUser(selectedUser); setProfileAnchor(rectFrom(event)); }}>
                  <img src={selectedUser.avatarData} alt="" draggable={false} />
                  <i className={`${presenceDotClass(selectedUser)}${selectedTyping ? ' typing' : ''}`}>
                    {selectedTyping ? <span className="typing-presence-dots" aria-hidden="true"><b /><b /><b /></span> : null}
                  </i>
                </span>
                <div>
                  <UserName user={selectedUser} as="h3" />
                  <SpotifyActivityLine token={token} userId={selectedUser.id} className="messenger-user-substatus" />
                  <small>{presenceLabel(selectedUser)}</small>
                </div>

                <div className="messenger-chat-header-actions">
                  {showCallStage ? null : (
                  <button
                    className="messenger-call-button"
                    type="button"
                    title={t(language, 'startCall')}
                    disabled={voiceCall.phase !== 'idle' || !isOnline(selectedUser) || blockState.blocked || blockState.blockedMe}
                    onClick={(event) => { event.stopPropagation(); void voiceCall.startCall(selectedUser); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.2 2.2z"/></svg>
                  </button>
                  )}
                  <button
                    className={searchMode ? 'messenger-call-button active' : 'messenger-call-button'}
                    type="button"
                    title={t(language, 'search')}
                    onClick={(event) => { event.stopPropagation(); setSearchMode((v) => { const next = !v; if (!next) { setConvSearchQuery(''); setConvSearchResults([]); } return next; }); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
                  </button>
                  <button
                    className={rightPanelOpen ? 'messenger-call-button active' : 'messenger-call-button'}
                    type="button"
                    title={t(language, 'profileInfo')}
                    onClick={(event) => { event.stopPropagation(); if (rightPanelOpen) setRightPanelOpen(false); else openRightPanel(); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
                  </button>
                  <button
                    className="messenger-call-button"
                    type="button"
                    title={language === 'ru' ? 'Действия' : 'Actions'}
                    onClick={(event) => {
                      event.stopPropagation();
                      setChatMenu((current) => current ? null : { x: event.clientX, y: event.clientY });
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                  </button>
                </div>
              </header>
              <VoicePlaybackBar language={language} />
              <VideoCirclePlaybackBar language={language} />
              <input
                ref={backgroundInputRef}
                className="hidden-file"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  void chooseChatBackground(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />

              {showCallStage ? (
                <CallStagePanel
                  call={voiceCall}
                  language={language}
                  currentUser={currentUser}
                  chatCollapsed={callChatCollapsed}
                  onToggleChat={() => setCallChatCollapsed((v) => !v)}
                />
              ) : null}

              {error ? <div className="inline-error messenger-error">{error}</div> : null}

              <div
                className={selectedChatBackground ? 'messenger-thread-wrap chat-enlarged dm-custom-background' : 'messenger-thread-wrap chat-enlarged'}
                style={selectedChatBackgroundStyle}
              >
                {(() => {
                  const pinnedSource = conversationPinnedMessages.length > 0 ? conversationPinnedMessages : messages;
                  const pinned = pinnedSource
                    .filter((m) => m.pinnedAt && !m.deletedAt)
                    .sort((a, b) => new Date(b.pinnedAt!).getTime() - new Date(a.pinnedAt!).getTime());
                  if (pinned.length === 0) return null;
                  const current = pinned[Math.min(pinCursor, pinned.length - 1)] ?? pinned[0];
                  const sender = current.senderGroup ? null : (current.senderId === currentUser.id ? currentUser : selectedUser);
                  const senderName = sender?.nickname ?? '';
                  return (
                    <div className="messenger-pinned" onClick={(e) => {
                      e.stopPropagation();
                      void jumpToMessage(current.id);
                      // Advance to the next pin so repeated clicks cycle through all of them.
                      setPinCursor((prev) => (prev + 1) % pinned.length);
                    }}>
                      <div className="messenger-pinned-header">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                        <span>{pinned.length} {t(language, 'pinnedMessages')}</span>
                      </div>
                      <div key={current.id} className="messenger-pinned-message">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                        {current.senderGroup ? <strong>{current.senderGroup.name}</strong> : sender ? <UserName user={sender} as="strong" /> : <strong>{senderName}</strong>}
                        <span>{current.body || (isVideoCircleAttachment(current.imageData, current.imageName) ? '📹' : isVoiceAttachment(current.imageData, current.imageName) ? '🎤' : current.imageData ? '📷' : '')}</span>
                      </div>
                    </div>
                  );
                })()}
                {scheduledViewOpen ? (
                  <div className="messenger-thread scheduled-view">
                    <div className="scheduled-view-head">
                      <button type="button" className="scheduled-view-back" onClick={() => setScheduledViewOpen(false)}>
                        <span aria-hidden="true">←</span>
                        {t(language, 'back')}
                      </button>
                      <strong>{language === 'ru' ? 'Запланированные сообщения' : language === 'uk' ? 'Заплановані повідомлення' : 'Scheduled messages'}</strong>
                      <span className="scheduled-view-count">{scheduledForSelectedUser.length}</span>
                    </div>
                    {scheduledForSelectedUser.length === 0 ? (
                      <p className="scheduled-view-empty">
                        {language === 'ru'
                          ? 'Здесь появятся сообщения, для которых вы установили таймер.'
                          : language === 'uk'
                            ? 'Тут зʼявляться повідомлення з таймером.'
                            : 'Messages you schedule will show up here.'}
                      </p>
                    ) : null}
                    {scheduledForSelectedUser.map((message) => (
                      <div key={message.id} className="scheduled-view-row">
                        <div className="scheduled-view-when">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                          {message.awaitingOnline
                            ? (language === 'ru' ? 'Когда собеседник будет в сети' : language === 'uk' ? 'Коли співрозмовник буде онлайн' : 'When they come online')
                            : message.scheduledAt
                              ? `${formatMessageDate(message.scheduledAt, language)}, ${formatMessageTime(message.scheduledAt, language)}`
                              : ''}
                          <button
                            type="button"
                            className="scheduled-view-cancel"
                            title={t(language, 'cancel')}
                            aria-label={t(language, 'cancel')}
                            onClick={() => {
                              api.cancelScheduledMessage(token, message.id)
                                .then(() => setScheduledMessages((current) => current.filter((m) => m.id !== message.id)))
                                .catch(() => undefined);
                            }}
                          >✕</button>
                        </div>
                        {/* Same bubble markup as the live thread (avatar column,
                            meta line, body) so scheduled messages render exactly
                            like sent ones. */}
                        <article
                          className={[
                            'message-bubble',
                            'message-group-start',
                            'message-group-end',
                            'message-avatar-active',
                            'mine',
                            message.imageData ? 'has-image' : '',
                            message.imageData && !message.body ? 'image-only' : ''
                          ].filter(Boolean).join(' ')}
                          data-time={message.scheduledAt ? formatMessageTime(message.scheduledAt, language) : ''}
                        >
                          <img className="message-avatar" src={currentUser.avatarData} alt="" draggable={false} />
                          <div className="message-body">
                            <div className="message-meta">
                              <UserName user={currentUser} as="strong" className="message-author" />
                              <time className="message-time">
                                {message.scheduledAt && !message.awaitingOnline
                                  ? formatMessageTime(message.scheduledAt, language)
                                  : (language === 'ru' ? 'в сети' : 'online')}
                              </time>
                            </div>
                            {message.imageData ? (
                              <button
                                type="button"
                                className="message-image"
                                onClick={() => openImageViewer(message.imageData ?? '', message.imageName ?? t(language, 'imageMessage'))}
                              >
                                <img src={message.imageData} alt="" loading="lazy" decoding="async" />
                              </button>
                            ) : null}
                            {message.body ? <p className="message-text"><MessageText text={message.body} /></p> : null}
                          </div>
                        </article>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div
                  ref={threadRef}
                  className={scheduledViewOpen ? 'messenger-thread hidden-behind-scheduled' : 'messenger-thread'}
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    userNearThreadBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 200;
                    if (event.currentTarget.scrollTop <= 80 && hasMoreMessages && !loadingOlderRef.current) {
                      void loadOlderMessages();
                    }
                  }}
                >
                  {loadingOlder ? <div className="messenger-load-older">…</div> : null}
                  {threadLoading && messages.length === 0 ? (
                    <div className="messenger-skeleton" aria-hidden="true">
                      {CHAT_SKELETON_ROWS.map((row, i) => (
                        <div key={i} className={row.mine ? 'skeleton-row mine' : 'skeleton-row'}>
                          {!row.mine ? <div className="skeleton-avatar" /> : null}
                          <div className="skeleton-bubbles">
                            <div className="skeleton-line short" />
                            <div className="skeleton-line" style={{ width: `${row.width}%` }} />
                            {row.extra ? <div className="skeleton-line" style={{ width: `${row.extra}%` }} /> : null}
                            {row.media ? <div className="skeleton-media" /> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!threadLoading && messages.every((message) => message.deletedAt) ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
                {messages.map((message, index) => {
                  if (message.deletedAt) return null;
                  const callLabel = callMessageLabel(message, currentUser.id, language);
                  const isCallLog = Boolean(callLabel);
                  const isVoiceMessage = isVoiceAttachment(message.imageData, message.imageName);
                  const isVideoCircleMessage = isVideoCircleAttachment(message.imageData, message.imageName);
                  const forwarded = parseForward(message.body);
                  const backgroundAction = parseChatBackgroundMarker(message.body);
                  const spoilerHidden = Boolean(message.imageData && message.imageSpoiler && !revealedSpoilers.includes(message.id));
                  const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
                  const previousMessage = index === 0 ? null : messages[index - 1];
                  if (previousMessage && canAppendToImageAlbum(previousMessage, message)) return null;
                  const isStartOfGroup = showDateDivider || !previousMessage || messageRunIdentity(previousMessage) !== messageRunIdentity(message) || (new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime() > 120000);
                  const albumItems: MessengerMessage[] = [];
                  if (isAlbumImageMessage(message)) {
                    albumItems.push(message);
                    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
                      const candidate = messages[nextIndex];
                      const previousAlbumItem = albumItems[albumItems.length - 1];
                      if (!canAppendToImageAlbum(previousAlbumItem, candidate)) break;
                      albumItems.push(candidate);
                    }
                  }
                  const renderAlbumItems = getMessageMediaItems(message).length > 1
                    ? getMessageMediaItems(message).map((item, itemIndex) => ({
                      id: `${message.id}-${itemIndex}`,
                      dataUrl: item.dataUrl,
                      name: item.name,
                      spoiler: item.spoiler,
                      spoilerId: `${message.id}:${itemIndex}`,
                      createdAt: message.createdAt
                    }))
                    : albumItems.map((item) => ({
                      id: item.id,
                      dataUrl: item.imageData ?? '',
                      name: item.imageName,
                      spoiler: item.imageSpoiler,
                      spoilerId: item.id,
                      createdAt: item.createdAt
                    }));
                  const groupEndMessage = albumItems.length > 1 ? albumItems[albumItems.length - 1] : message;
                  const nextMessage = messages[index + (albumItems.length > 1 ? albumItems.length : 1)];
                  const isEndOfGroup = !nextMessage || shouldShowDateDivider(nextMessage.createdAt, groupEndMessage.createdAt) || messageRunIdentity(nextMessage) !== messageRunIdentity(groupEndMessage) || (new Date(nextMessage.createdAt).getTime() - new Date(groupEndMessage.createdAt).getTime() > 120000);
                  const showGroupAvatar = isEndOfGroup;
                  const messageRunKey = messageRunKeys.get(message.id) ?? message.id;
                  const hasRichContent = !message.deletedAt && Boolean(
                    message.imageData ||
                    message.replyTo ||
                    (message.body && (
                      forwarded ||
                      extractSharedPack(message.body) ||
                      extractGroupInviteCode(message.body) ||
                      extractWatchInvite(message.body) ||
                      extractProfileUserId(message.body)
                    ))
                  );
                  const mentionsCurrentUser = message.senderId !== currentUser.id
                    && !message.deletedAt
                    && Boolean(message.body)
                    && messageMentionTokens(message.body).has(mentionToken(currentUser.nickname));
                  const bubbleClasses = [
                    'message-bubble',
                    !isCallLog && isStartOfGroup ? 'message-group-start' : '',
                    !isCallLog && isEndOfGroup ? 'message-group-end' : '',
                    !isCallLog && showGroupAvatar ? 'message-avatar-active' : '',
                    message.senderId === currentUser.id ? 'mine' : '',
                    message.imageData && !isVoiceMessage && !isVideoCircleMessage ? 'has-image' : '',
                    message.imageData && !message.body && !isVoiceMessage && !isVideoCircleMessage ? 'image-only' : '',
                    hasRichContent ? 'message-rich-content' : '',
                    isCallLog ? 'call-log-bubble' : '',
                    message.pinnedAt ? 'pinned' : '',
                    mentionsCurrentUser ? 'message-mention-highlight' : '',
                    message.pending ? 'pending' : ''
                  ].filter(Boolean).join(' ');
                  const senderUser = message.senderGroup ? null : (message.senderId === currentUser.id ? currentUser : selectedUser);
                  const senderAvatar = message.senderGroup?.avatarData || (message.senderId === currentUser.id ? currentUser.avatarData : (selectedUser?.avatarData ?? ''));
                  const senderName = message.senderGroup?.name || (message.senderId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? ''));
                  const callLogText = callLabel ? callLogSystemText(message, currentUser.id, language) : null;

                  {
                    const ttlMarkerSeconds = parseChatTtlMarker(message.body);
                    if (ttlMarkerSeconds !== null) {
                      return (
                        <Fragment key={message.clientKey ?? message.id}>
                          {showDateDivider ? (
                            <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
                          ) : null}
                          <div className="dm-background-event" id={'msg-' + message.id} data-message-id={message.id}>
                            <div className="dm-background-event-card">
                              <div className="dm-background-event-title">
                                ⏱ {chatTtlEventText(ttlMarkerSeconds, senderName, language)}
                              </div>
                              <time>{formatMessageTime(message.createdAt, language)}</time>
                            </div>
                          </div>
                        </Fragment>
                      );
                    }
                  }
                  if (backgroundAction) {
                    return (
                      <Fragment key={message.clientKey ?? message.id}>
                        {showDateDivider ? (
                          <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
                        ) : null}
                        <div className="dm-background-event" id={'msg-' + message.id} data-message-id={message.id}>
                          <div className="dm-background-event-card">
                            <div className="dm-background-event-title">
                              {chatBackgroundEventText(backgroundAction, senderName, language)}
                            </div>
                            <time>{formatMessageTime(message.createdAt, language)}</time>
                            {backgroundAction === 'set' && message.imageData ? (
                              <button
                                type="button"
                                className="dm-background-preview"
                                onClick={() => openImageViewer(message.imageData ?? '', message.imageName ?? 'chat-background')}
                              >
                                <img src={message.imageData} alt="" loading="lazy" decoding="async" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </Fragment>
                    );
                  }

                  return (
                    <Fragment key={message.clientKey ?? message.id}>
                    {showDateDivider ? (
                      <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
                    ) : null}
                    <article
                      className={bubbleClasses}
                      id={'msg-' + message.id}
                      data-time={formatMessageTime(message.createdAt, language)}
                      data-message-id={message.id}
                      data-message-run={messageRunKey}
                      onContextMenu={(event) => {
                        if (message.deletedAt) return;
                        event.preventDefault();
                        setMessageMenu({
                          x: event.clientX,
                          y: event.clientY,
                          message
                        });
                      }}
                    >
                      <img
                        className="message-avatar"
                        src={senderAvatar}
                        alt=""
                        draggable={false}
                        style={{ cursor: 'pointer' }}
                        onClick={(event) => {
                          if (message.senderGroup) {
                            void openSenderGroupProfile(message.senderGroup, rectFrom(event));
                            return;
                          }
                          setProfileUser(message.senderId === currentUser.id ? currentUser : selectedUser!);
                          setProfileAnchor(rectFrom(event));
                        }}
                      />
                      <div className="message-body">
                        {!message.deletedAt && message.replyTo ? (
                          <ReplyQuote
                            reply={message.replyTo}
                            resolveName={(userId) => (userId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? userId.slice(0, 8)))}
                            onJump={(messageId) => {
                              const el = document.getElementById('msg-' + messageId);
                              const tNode = threadRef.current;
                              if (el && tNode) {
                                const tRect = tNode.getBoundingClientRect();
                                const elRect = el.getBoundingClientRect();
                                tNode.scrollBy({ top: elRect.top - tRect.top - 80, behavior: 'smooth' });
                                el.classList.add('message-jump-highlight');
                                window.setTimeout(() => el.classList.remove('message-jump-highlight'), 1200);
                              }
                            }}
                          />
                        ) : null}
                        {isStartOfGroup && !callLabel ? (
                          <div className="message-meta">
                            {senderUser
                              ? <UserName user={senderUser} as="strong" className="message-author" />
                              : <strong className="message-author">{senderName}</strong>}
                            <time className="message-time">
                              {formatMessageTime(message.createdAt, language)}
                              {message.editedAt ? ` · ${t(language, 'edited')}` : ''}
                              {message.pinnedAt ? <span className="pin-badge"> · <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: 'middle', marginBottom: 2 }}><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></span> : null}
                            </time>
                          </div>
                        ) : null}
                        {message.deletedAt ? (
                          <p className="message-deleted">{t(language, 'messageDeleted')}</p>
                        ) : (
                          <>
                            {renderAlbumItems.length > 1 ? (
                              <div className={`message-media-album album-count-${Math.min(renderAlbumItems.length, 6)}`}>
                                {renderAlbumItems.map((item) => {
                                  const itemSpoilerHidden = Boolean(item.dataUrl && item.spoiler && !revealedSpoilers.includes(item.spoilerId));
                                  return (
                                    <button
                                      key={item.id}
                                      className={itemSpoilerHidden ? 'message-album-item spoiler' : 'message-album-item'}
                                      type="button"
                                      onContextMenu={(event) => openImageMessageMenu(event, message, item.dataUrl)}
                                      onClick={() => {
                                        if (!item.dataUrl) return;
                                        if (itemSpoilerHidden) {
                                          setRevealedSpoilers((current) => (current.includes(item.spoilerId) ? current : [...current, item.spoilerId]));
                                          return;
                                        }
                                        openImageViewer(item.dataUrl, item.name ?? t(language, 'imageMessage'));
                                      }}
                                    >
                                      <img src={item.dataUrl} alt={item.name ?? ''} loading="lazy" decoding="async" onLoad={handleThreadMediaLoad} />
                                      {itemSpoilerHidden ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : message.imageData && !forwarded && isVideoCircleAttachment(message.imageData, message.imageName) ? (
                              <VideoCircleMessagePlayer src={message.imageData} senderName={senderName} createdAt={message.createdAt} />
                            ) : message.imageData && !forwarded && isVoiceAttachment(message.imageData, message.imageName) ? (
                              <VoiceMessagePlayer src={message.imageData} senderName={senderName} createdAt={message.createdAt} transcribe={!message.pending ? () => api.transcribeMessage(token, message.id).then((r) => r.transcript) : undefined} />
                            ) : message.imageData && !forwarded && isGifAttachment(message) && !spoilerHidden ? (
                              <ChatGifAttachment
                                src={message.imageData}
                                name={message.imageName ?? 'GIF'}
                                language={language}
                                onOpen={() => openImageViewer(message.imageData ?? '', message.imageName ?? 'GIF')}
                                onLoad={handleThreadMediaLoad}
                              />
                            ) : message.viewOnce && (message.viewOnceSeenAt || (!message.imageData && !openedViewOnce[message.id])) ? (
                              <div className="view-once-placeholder">
                                <span aria-hidden="true">👁</span>
                                {language === 'ru' ? 'Фото просмотрено' : language === 'uk' ? 'Фото переглянуто' : 'Photo viewed'}
                              </div>
                            ) : message.viewOnce && message.senderId !== currentUser.id && !openedViewOnce[message.id] ? (
                              <button
                                type="button"
                                className="view-once-open"
                                onClick={() => {
                                  api.openViewOnceMedia(token, message.id)
                                    .then((payload) => {
                                      setOpenedViewOnce((current) => ({ ...current, [message.id]: payload.mediaItems }));
                                      const first = payload.mediaItems[0];
                                      if (first) openImageViewer(first.dataUrl, first.name ?? t(language, 'imageMessage'));
                                    })
                                    .catch(() => undefined);
                                }}
                              >
                                <span aria-hidden="true">👁</span>
                                {language === 'ru' ? 'Открыть один раз' : 'Open once'}
                              </button>
                            ) : message.imageData && !forwarded ? (
                              <button
                                className={spoilerHidden ? 'message-image spoiler' : 'message-image'}
                                type="button"
                                onContextMenu={(event) => message.imageData ? openImageMessageMenu(event, message, message.imageData) : undefined}
                                onClick={() => {
                                  if (!message.imageData) return;
                                  if (spoilerHidden) {
                                    setRevealedSpoilers((current) => (current.includes(message.id) ? current : [...current, message.id]));
                                    return;
                                  }
                                  openImageViewer(message.imageData, message.imageName ?? t(language, 'imageMessage'));
                                }}
                              >
                                <img src={message.imageData} alt={message.imageName ?? ''} loading="lazy" decoding="async" onLoad={handleThreadMediaLoad} />
                                {spoilerHidden ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
                              </button>
                            ) : null}
                            {callLogText ? (
                              <p className="message-text call-log-message">
                                <span className="call-log-icon" aria-hidden="true" />
                                {senderUser
                                  ? <UserName user={senderUser} as="strong" className="message-author call-log-author" />
                                  : <strong className="message-author call-log-author">{senderName}</strong>}
                                <span className="call-log-copy">{callLogText}</span>
                                <time className="message-time call-log-time">{formatMessageTime(message.createdAt, language)}</time>
                              </p>
                            ) : message.body && forwarded ? (
                              (() => {
                                const fwd = forwarded;
                                const forwardDeleted = Boolean(fwd.sourceId && deletedForwardSourceIds.has(fwd.sourceId));
                                return (
                                  <>
                                    <ForwardedCard senderName={fwd.senderName} language={language}>
                                      {forwardDeleted ? (
                                        <p className="message-deleted">{t(language, 'messageDeleted')}</p>
                                      ) : fwd.body.trim() && !(
                                        message.imageData &&
                                        (isVideoCircleAttachment(message.imageData, message.imageName) || isVoiceAttachment(message.imageData, message.imageName)) &&
                                        ['Видео кружок', 'Video message', 'Голосовое сообщение', 'Voice message'].includes(fwd.body.trim())
                                      ) ? <MessageText text={expandCustomEmojiShortcodes(fwd.body)} /> : null}
                                      {!forwardDeleted && message.imageData && isVideoCircleAttachment(message.imageData, message.imageName) ? (
                                        <VideoCircleMessagePlayer src={message.imageData} senderName={fwd.senderName} createdAt={message.createdAt} />
                                      ) : !forwardDeleted && message.imageData && isVoiceAttachment(message.imageData, message.imageName) ? (
                                        <VoiceMessagePlayer src={message.imageData} senderName={fwd.senderName} createdAt={message.createdAt} />
                                      ) : !forwardDeleted && message.imageData && isGifAttachment(message) && !spoilerHidden ? (
                                        <ChatGifAttachment
                                          src={message.imageData}
                                          name={message.imageName ?? 'GIF'}
                                          language={language}
                                          onOpen={() => openImageViewer(message.imageData ?? '', message.imageName ?? 'GIF')}
                                          onLoad={handleThreadMediaLoad}
                                        />
                                      ) : !forwardDeleted && message.imageData ? (
                                        <button
                                          className={spoilerHidden ? 'message-image spoiler' : 'message-image'}
                                          type="button"
                                          onContextMenu={(event) => message.imageData ? openImageMessageMenu(event, message, message.imageData) : undefined}
                                          onClick={() => {
                                            if (!message.imageData) return;
                                            if (spoilerHidden) {
                                              setRevealedSpoilers((current) => (current.includes(message.id) ? current : [...current, message.id]));
                                              return;
                                            }
                                            openImageViewer(message.imageData, message.imageName ?? t(language, 'imageMessage'));
                                          }}
                                        >
                                          <img src={message.imageData} alt={message.imageName ?? ''} loading="lazy" decoding="async" onLoad={handleThreadMediaLoad} />
                                          {spoilerHidden ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
                                        </button>
                                      ) : null}
                                    </ForwardedCard>
                                    {fwd.caption ? <p className="message-text"><MessageText text={fwd.caption} /></p> : null}
                                  </>
                                );
                              })()
                            ) : message.body ? (
                              <>
                                {(() => {
                                  // Hide the long pack-link token from the bubble; the embed renders below.
                                  const original = hasPackLink(message.body) ? stripPackLinks(message.body) : message.body;
                                  // Show the ephemeral translation in place of the original when present.
                                  const translated = messageTranslations[message.id];
                                  const visibleBody = translated ?? original;
                                  if (translatingIds.has(message.id) && !translated) {
                                    return <p className="message-text message-text-translating">{t(language, 'translating')}</p>;
                                  }
                                  if (!visibleBody) return null;
                                  return (
                                    <p className="message-text">
                                      <MessageText text={visibleBody} />
                                      {translated ? <span className="message-translated-tag"> · {t(language, 'translate').toLowerCase()}</span> : null}
                                    </p>
                                  );
                                })()}
                                {(() => {
                                  const sharedPack = extractSharedPack(message.body);
                                  return sharedPack ? <CustomEmojiPackEmbed token={token} language={language} shared={sharedPack} /> : null;
                                })()}
                                {(() => {
                                  const inviteCode = extractGroupInviteCode(message.body);
                                  const inviteChannelId = extractGroupInviteChannelId(message.body);
                                  return inviteCode ? <InviteEmbed token={token} language={language} inviteCode={inviteCode} channelId={inviteChannelId} currentUserId={currentUser.id} memberGroupIds={memberGroupIds} onJoined={(group) => setGroups((prev) => prev.find((g) => g.id === group.id) ? prev : [...prev, group])} onNavigate={(groupId, channelId = null) => { const g = groups.find((x) => x.id === groupId) ?? groupConversations.find((x) => x.group.id === groupId)?.group; if (g) setLocalGroupRequest((current) => ({ groupId, group: g, channelId, requestId: (current?.requestId ?? 0) + 1 })); }} /> : null;
                                })()}
                                {(() => {
                                  const watchInvite = extractWatchInvite(message.body);
                                  return watchInvite ? <WatchInviteEmbed language={language} invite={watchInvite} onOpen={onOpenWatchTogether} /> : null;
                                })()}
                                {(() => {
                                  const profileUserId = extractProfileUserId(message.body);
                                  return profileUserId ? (
                                    <UserEmbed
                                      token={token}
                                      language={language}
                                      userId={profileUserId}
                                      currentUserId={currentUser.id}
                                      onOpenChat={(u) => void chooseUser(u)}
                                      onOpenProfile={(u, anchorRect) => { setProfileUser(u); setProfileAnchor(anchorRect ?? null); }}
                                      onOpenDesktop={onViewDesktop}
                                      onEditProfile={onEditProfile}
                                    />
                                  ) : null;
                                })()}
                                {message.linkPreview && !extractGroupInviteCode(message.body) && !extractWatchInvite(message.body) && !extractProfileUserId(message.body) ? (
                                  <LinkPreviewCard preview={message.linkPreview} />
                                ) : null}
                              </>
                            ) : null}
                          </>
                        )}
                        {!message.deletedAt && message.reactions.length > 0 ? (
                          <div className="message-reactions">
                            {message.reactions.map((reaction) => {
                              const mine = reaction.userIds.includes(currentUser.id);
                              return (
                                <button
                                  key={reaction.emoji}
                                  type="button"
                                  className={mine ? 'message-reaction mine' : 'message-reaction'}
                                  onClick={() => void toggleReaction(message, reaction.emoji)}
                                >
                                  <ReactionEmoji emoji={reaction.emoji} />
                                  <span className="message-reaction-count">{reaction.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      {!message.deletedAt ? (
                        <div className="message-hover-toolbar" role="toolbar" aria-label={t(language, 'addReaction')}>
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="message-action quick-react"
                              onClick={() => void toggleReaction(message, emoji)}
                            >
                              <ReactionEmoji emoji={emoji} size={20} />
                            </button>
                          ))}
                          <button
                            type="button"
                            className="message-action"
                            title={t(language, 'addReaction')}
                            onClick={(event) => {
                              const anchor = event.currentTarget as HTMLElement;
                              reactionAnchorRef.current = anchor;
                              setReactionPicker((current) => (current?.message.id === message.id ? null : { message, anchor }));
                            }}
                          >
                            <EmojiToggleIcon />
                          </button>
                          <button type="button" className="message-action" title={t(language, 'reply')} onClick={() => replyToMessage(message)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 17 4 12 9 7" />
                              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                            </svg>
                          </button>
                          <button type="button" className="message-action" title={t(language, 'forward')} onClick={() => forwardMessage(message)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 17 20 12 15 7" />
                              <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </article>
                    </Fragment>
                  );
                })}
              </div>
            </div>

              {messageMenu ? createPortal(
                <div ref={messageMenuRef} className="context-menu context-menu-with-reactions messenger-message-menu" style={{ left: messageMenuPos.x, top: messageMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
                  {!messageMenu.message.deletedAt ? (
                    <div className="context-menu-reactions">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="context-reaction"
                          onClick={() => void toggleReaction(messageMenu.message, emoji)}
                        >
                          <ReactionEmoji emoji={emoji} size={22} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" className="context-menu-action" onClick={() => {
                    if (messageMenu.message.pinnedAt) {
                      void pinMessage(messageMenu.message);
                      setMessageMenu(null);
                    } else {
                      setPinConfirm(messageMenu.message);
                      setMessageMenu(null);
                    }
                  }}>
                    <span className="context-menu-action-text">{messageMenu.message.pinnedAt ? t(language, 'unpin') : t(language, 'pinMessage')}</span>
                    <MenuPinIcon />
                  </button>
                  <button type="button" className="context-menu-action" onClick={() => replyToMessage(messageMenu.message)}>
                    <span className="context-menu-action-text">{t(language, 'reply')}</span>
                    <MenuReplyIcon />
                  </button>
                  <div className="context-menu-remind">
                    <span className="context-menu-remind-label">{language === 'ru' ? 'Напомнить через' : 'Remind me in'}</span>
                    <div className="context-menu-remind-options">
                      {([[3600, '1h'], [10800, '3h'], [86400, '24h']] as const).map(([seconds, label]) => (
                        <button
                          key={seconds}
                          type="button"
                          onClick={() => {
                            const messageId = messageMenu.message.id;
                            setMessageMenu(null);
                            api.remindAboutMessage(token, messageId, seconds).catch(() => undefined);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="context-menu-action" onClick={() => forwardMessage(messageMenu.message)}>
                    <span className="context-menu-action-text">{t(language, 'forward')}</span>
                    <MenuForwardIcon />
                  </button>
                  {messageMenu.message.body && !messageMenu.message.deletedAt ? (
                    <button type="button" className="context-menu-action" onClick={() => void copyMessageText(messageMenu.message)}>
                      <span className="context-menu-action-text">{t(language, 'copy')}</span>
                      <MenuCopyIcon />
                    </button>
                  ) : null}
                  {messageMenu.imageSrc && !messageMenu.message.deletedAt ? (
                    <button type="button" className="context-menu-action" onClick={() => { void copyImageToClipboard(messageMenu.imageSrc!); setMessageMenu(null); }}>
                      <span className="context-menu-action-text">{language === 'ru' ? 'Копировать изображение' : 'Copy image'}</span>
                      <MenuCopyIcon />
                    </button>
                  ) : null}
                  {messageMenu.message.body && !messageMenu.message.deletedAt && !parseCallMarker(messageMenu.message.body) ? (
                    <button type="button" className="context-menu-action" onClick={() => void translateMessage(messageMenu.message)}>
                      <span className="context-menu-action-text">{messageTranslations[messageMenu.message.id] ? t(language, 'showOriginal') : t(language, 'translate')}</span>
                      <MenuTranslateIcon />
                    </button>
                  ) : null}
                  {canEditMessage(messageMenu.message) ? <button type="button" className="context-menu-action" onClick={() => void editMessage(messageMenu.message)}>
                    <span className="context-menu-action-text">{t(language, 'editMessage')}</span>
                    <MenuEditIcon />
                  </button> : null}
                  {messageMenu.message.senderId === currentUser.id && !parseCallMarker(messageMenu.message.body) ? <button type="button" className="context-menu-action danger-text" onClick={() => { setDeleteConfirm(messageMenu.message); setMessageMenu(null); }}>
                    <span className="context-menu-action-text">{t(language, 'deleteMessage')}</span>
                    <MenuDeleteIcon />
                  </button> : null}
                </div>,
                document.body
              ) : null}

              {mediaContextMenu ? createPortal(
                <div
                  className="context-menu media-context-menu"
                  style={{ left: mediaContextMenu.x, top: mediaContextMenu.y }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button type="button" onClick={() => { void copyImageToClipboard(mediaContextMenu.src); setMediaContextMenu(null); }}>
                    {language === 'ru' ? 'Копировать изображение' : 'Copy image'}
                  </button>
                </div>,
                document.body
              ) : null}

              {chatMenu && selectedUser ? (
                <div ref={chatMenuRef} className="context-menu messenger-chat-menu-inline" onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" className="context-menu-action" onClick={() => { setClearConversationConfirm(selectedUser); setClearForEveryone(false); setChatMenu(null); }}>
                    <span className="context-menu-action-text">{language === 'ru' ? 'Очистить историю' : 'Clear history'}</span>
                    <MenuDeleteIcon />
                  </button>
                  <button type="button" className="context-menu-action" onClick={() => { backgroundInputRef.current?.click(); setChatMenu(null); }}>
                    <span className="context-menu-action-text">{language === 'ru' ? 'Установить фон' : 'Set background'}</span>
                    <MenuEditIcon />
                  </button>
                  {selectedChatBackground ? (
                    <button type="button" className="context-menu-action" onClick={() => { void clearChatBackground(); setChatMenu(null); }}>
                      <span className="context-menu-action-text">{language === 'ru' ? 'Убрать фон' : 'Remove background'}</span>
                      <MenuDeleteIcon />
                    </button>
                  ) : null}
                  <div className="context-menu-ttl">
                    <span className="context-menu-ttl-label">{language === 'ru' ? 'Таймер сообщений' : 'Message timer'}</span>
                    <div className="context-menu-ttl-options">
                      {([[0, language === 'ru' ? 'Выкл' : 'Off'], [3600, '1h'], [86400, '24h'], [604800, '7d']] as const).map(([seconds, label]) => (
                        <button
                          key={seconds}
                          type="button"
                          className={(dmTtls[selectedUser.id] ?? 0) === seconds ? 'active' : ''}
                          onClick={() => {
                            const userId = selectedUser.id;
                            setChatMenu(null);
                            api.setConversationTtl(token, userId, seconds)
                              .then((payload) => setDmTtls((current) => ({ ...current, [userId]: payload.settings.messageTtlSeconds })))
                              .catch(() => undefined);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {composerMenu ? createPortal(
                <div ref={composerMenuRef} className="context-menu" style={{ left: composerMenuPos.x, top: composerMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" className="context-menu-action" onClick={() => void pasteIntoComposer()}>
                    <span className="context-menu-action-text">{t(language, 'paste')}</span>
                    <MenuPasteIcon />
                  </button>
                  <button type="button" className="context-menu-action" disabled={!composerMenu.hasSelection} onClick={() => void copyComposerSelection()}>
                    <span className="context-menu-action-text">{t(language, 'copy')}</span>
                    <MenuCopyIcon />
                  </button>
                  <button type="button" className="context-menu-action" disabled={!composerMenu.hasSelection} onClick={() => void cutComposerSelection()}>
                    <span className="context-menu-action-text">{t(language, 'cut')}</span>
                    <MenuCutIcon />
                  </button>
                  {composerMenu.hasSelection ? (
                    <button type="button" className="context-menu-action" disabled={composerTranslating} onClick={() => void translateComposerSelection()}>
                      <span className="context-menu-action-text">{composerTranslating ? t(language, 'translating') : t(language, 'translateSelection')}</span>
                      <MenuTranslateIcon />
                    </button>
                  ) : null}
                  {/* The composer keeps its text in a ref (the input is local
                      for typing performance), so read the ref rather than the
                      debounced `messageDraft` state. */}
                  {selectedUser && !editingMessage && (messageDraftRef.current.trim() || pendingImages.length > 0) ? (
                    <>
                      <hr className="context-menu-divider" />
                      <button
                        type="button"
                        className="context-menu-action"
                        onClick={() => {
                          setComposerMenu(null);
                          setScheduleChoice('1h');
                          setScheduleCustom('');
                          setScheduleModalOpen(true);
                        }}
                      >
                        <span className="context-menu-action-text">
                          {language === 'ru' ? 'Установить таймер' : language === 'uk' ? 'Встановити таймер' : 'Set timer'}
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                      </button>
                      <button
                        type="button"
                        className="context-menu-action"
                        onClick={() => {
                          setComposerMenu(null);
                          void sendMessage(undefined, { sendWhenOnline: true });
                        }}
                      >
                        <span className="context-menu-action-text">
                          {language === 'ru' ? 'Отправить, когда будет в сети' : language === 'uk' ? 'Надіслати, коли буде онлайн' : 'Send when they are online'}
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>
                      </button>
                    </>
                  ) : null}
                </div>,
                document.body
              ) : null}

              {scheduleModalOpen && selectedUser ? (
                <div className="messenger-inline-modal schedule-modal-layer" onClick={() => setScheduleModalOpen(false)}>
                  <div className="schedule-modal" onClick={(event) => event.stopPropagation()}>
                    <h3>{language === 'ru' ? 'Когда отправить?' : language === 'uk' ? 'Коли надіслати?' : 'When to send?'}</h3>
                    <div className="schedule-modal-options">
                      {([
                        ['1h', language === 'ru' ? 'Через час' : language === 'uk' ? 'Через годину' : 'In 1 hour'],
                        ['3h', language === 'ru' ? 'Через 3 часа' : language === 'uk' ? 'Через 3 години' : 'In 3 hours'],
                        ['tomorrow', language === 'ru' ? 'Завтра утром' : language === 'uk' ? 'Завтра вранці' : 'Tomorrow morning'],
                        ['custom', language === 'ru' ? 'Своё время' : language === 'uk' ? 'Свій час' : 'Custom time']
                      ] as const).map(([value, label]) => (
                        <label key={value} className={scheduleChoice === value ? 'schedule-modal-option active' : 'schedule-modal-option'}>
                          <input
                            type="radio"
                            name="schedule-choice"
                            checked={scheduleChoice === value}
                            onChange={() => setScheduleChoice(value)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    {scheduleChoice === 'custom' ? (
                      <input
                        type="datetime-local"
                        className="messenger-input schedule-modal-custom"
                        value={scheduleCustom}
                        onChange={(event) => setScheduleCustom(event.target.value)}
                      />
                    ) : null}
                    <div className="schedule-modal-actions">
                      <button type="button" className="secondary-action" onClick={() => setScheduleModalOpen(false)}>
                        {t(language, 'cancel')}
                      </button>
                      <button
                        type="button"
                        className="primary-action"
                        disabled={scheduleChoice === 'custom' && !scheduleCustom}
                        onClick={() => {
                          let when: Date | null = null;
                          if (scheduleChoice === '1h') when = new Date(Date.now() + 3600 * 1000);
                          else if (scheduleChoice === '3h') when = new Date(Date.now() + 3 * 3600 * 1000);
                          else if (scheduleChoice === 'tomorrow') {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            tomorrow.setHours(9, 0, 0, 0);
                            when = tomorrow;
                          } else if (scheduleCustom) {
                            const parsed = new Date(scheduleCustom);
                            if (!Number.isNaN(parsed.getTime())) when = parsed;
                          }
                          if (!when || when.getTime() - Date.now() < 30_000) {
                            setError(language === 'ru' ? 'Выберите время в будущем' : 'Pick a time in the future');
                            return;
                          }
                          setScheduleModalOpen(false);
                          void sendMessage(undefined, { scheduledAt: when.toISOString() });
                        }}
                      >
                        OK
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {blockState.blocked || blockState.blockedMe ? (
                <div className="messenger-block-banner">
                  {blockState.blocked ? (
                    <>
                      <span>{t(language, 'youBlockedUser')}</span>
                      <button type="button" onClick={() => void toggleBlock()}>{t(language, 'unblockUser')}</button>
                    </>
                  ) : (
                    <span>{t(language, 'youAreBlocked')}</span>
                  )}
                </div>
              ) : (
              <form
                className="messenger-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                {selectedTyping ? (
                  <div className="dm-typing-line">
                    <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                    <span>{t(language, 'typing', { name: selectedUser.nickname })}</span>
                  </div>
                ) : null}
                {editingMessage ? (
                  <div className="messenger-edit-preview">
                    <img src={currentUser.avatarData} alt="" />
                    <div>
                      <strong>{currentUser.nickname}</strong>
                      <time>{formatMessageTime(editingMessage.createdAt, language)}</time>
                      <p>{editingMessage.body}</p>
                      {editingMediaItems.length > 0 ? (
                        <div className="message-edit-media-grid">
                          {editingMediaItems.map((item, index) => (
                            <div key={`${item.name}-${index}`} className="message-edit-media-item">
                              <img src={item.dataUrl} alt="" draggable={false} />
                              <button type="button" className="message-edit-media-remove" aria-label={t(language, 'delete')} onClick={() => {
                                if (editingMediaItems.length === 1 && !messageDraft.trim()) {
                                  setDeleteConfirm(editingMessage);
                                  return;
                                }
                                setEditingMediaItems((current) => current.filter((_, i) => i !== index));
                              }}>
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => {
                      setEditingMessage(null);
                      setEditingMediaItems([]);
                      replaceMessageDraft('');
                    }}>
                      {t(language, 'cancel')}
                    </button>
                  </div>
                ) : null}
                {!editingMessage && replyTarget ? (
                  <ReplyComposerBar
                    reply={replyTarget}
                    language={language}
                    resolveName={(userId) => (userId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? userId.slice(0, 8)))}
                    onCancel={() => setReplyTarget(null)}
                  />
                ) : null}
                <input ref={imageFileInputRef} className="hidden-file" type="file" accept="image/*" multiple
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []).slice(0, MAX_CHAT_MEDIA_BATCH);
                    event.currentTarget.value = '';
                    files.forEach((file) => void prepareImageFromFile(file));
                  }} />
                {composerSlashPrefix ? (
                  <div className="slash-command-hints">
                    {SLASH_COMMANDS.filter((command) => command.name.startsWith(composerSlashPrefix.slice(1).toLowerCase())).map((command) => (
                      <button key={command.name} type="button" onClick={() => replaceMessageDraft(`/${command.name} `)}>
                        <strong>/{command.name}</strong>
                        <span>{command.hint}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="emoji-input-shell messenger-emoji-input">
                  <button className="emoji-toggle inline messenger-attach-inline" type="button" aria-label={t(language, 'imageMessage')}
                    disabled={Boolean(editingMessage)}
                    style={{ display: canChooseGroupIdentityInDm ? undefined : 'none' }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); imageFileInputRef.current?.click(); }}>
                    <AttachIcon />
                  </button>
                  {pendingImages.length > 0 && !editingMessage ? (
                    <button
                      className={viewOnceArmed ? 'emoji-toggle inline dm-view-once-toggle active' : 'emoji-toggle inline dm-view-once-toggle'}
                      type="button"
                      title={language === 'ru' ? 'Просмотр один раз' : 'View once'}
                      aria-label={language === 'ru' ? 'Просмотр один раз' : 'View once'}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => { event.stopPropagation(); setViewOnceArmed((value) => !value); }}
                    >
                      <span aria-hidden="true">1</span>
                    </button>
                  ) : null}
                  <button
                    className={selectedGroupIdentity ? 'messenger-identity-toggle active' : 'messenger-identity-toggle'}
                    type="button"
                    disabled={Boolean(editingMessage)}
                    aria-label={language === 'ru' ? 'Отправить сообщение как' : 'Send message as'}
                    title={selectedGroupIdentity ? selectedGroupIdentity.name : currentUser.nickname}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setGroupIdentityModalOpen(true);
                    }}
                  >
                    <img src={selectedGroupIdentity?.avatarData || currentUser.avatarData} alt="" draggable={false} />
                  </button>
                  <EmojiInlineInput
                    ref={messageInputRef}
                    className="emoji-inline-input messenger-input"
                    value={messageDraft}
                    localValue
                    syncKey={messageDraftSyncKey}
                    placeholder={t(language, 'messagePlaceholder')}
                    mentionUsers={selectedUser ? [selectedUser] : []}
                    onChange={(event) => updateMessageDraft(event.target.value)}
                    onPaste={handleComposerPaste}
                    onContextMenu={openComposerMenu}
                  />
                  {/* Both the GIF and the emoji buttons live inside the same anchor host.
                      The picker's outside-pointerdown close handler ignores clicks that land
                      inside `anchorRef`, so a second click on these buttons no longer triggers
                      an auto-close immediately followed by the button's own toggle re-opening it
                      (which made the GIF panel "close then instantly re-open"). The toggle below
                      is fully deterministic: same tab + open => close, otherwise open on that tab. */}
                  <div ref={messageEmojiAnchorRef} className="emoji-host inline">
                    <VoiceRecorderControl
                      language={language}
                      disabled={Boolean(editingMessage || pendingImages.length > 0)}
                      onSend={(recording) => sendMessage({ ...recording, spoiler: false })}
                    />
                    <button
                      className="emoji-toggle inline chat-gif-toggle"
                      type="button"
                      aria-label="GIF"
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (emojiOpen && pickerTab === 'gif') {
                          setEmojiOpen(false);
                        } else {
                          setPickerTab('gif');
                          setEmojiOpen(true);
                        }
                      }}
                    >
                      <GifIcon />
                    </button>
                    <button
                      className="emoji-toggle inline"
                      type="button"
                      aria-label={t(language, 'emoji')}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (emojiOpen && pickerTab === 'emoji') {
                          setEmojiOpen(false);
                        } else {
                          setPickerTab('emoji');
                          setEmojiOpen(true);
                        }
                      }}
                    >
                      <EmojiToggleIcon />
                    </button>
                    {scheduledForSelectedUser.length > 0 || scheduledViewOpen ? (
                    <button
                      className={scheduledViewOpen ? 'emoji-toggle inline dm-scheduled-toggle active' : 'emoji-toggle inline dm-scheduled-toggle'}
                      type="button"
                      title={language === 'ru' ? 'Запланированные сообщения' : language === 'uk' ? 'Заплановані повідомлення' : 'Scheduled messages'}
                      aria-label={language === 'ru' ? 'Запланированные сообщения' : 'Scheduled messages'}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => { event.stopPropagation(); setScheduledViewOpen((open) => !open); }}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M6 3h11a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z" />
                        <path d="M9 8h7M9 12h7" />
                      </svg>
                      {scheduledForSelectedUser.length > 0 ? <span className="dm-scheduled-count">{scheduledForSelectedUser.length}</span> : null}
                    </button>
                    ) : null}
                    {emojiOpen ? <EmojiPicker language={language} enlarged initialTab={pickerTab} anchorRef={messageEmojiAnchorRef} placement="top-end" onSelect={insertEmoji} onSelectGif={(gif) => void sendGif(gif)} onClose={() => setEmojiOpen(false)} token={token} currentUser={currentUser} /> : null}
                  </div>
                </div>
                {/* Submit on Enter; the hidden submit input keeps form submission working without a send button. */}
                <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
              </form>
              )}

              {pendingImages.length > 0 ? (
                <div className="messenger-image-draft-backdrop" onMouseDown={(event) => event.stopPropagation()}>
                  <form
                    className="messenger-image-draft-card"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendMessage();
                    }}
                  >
                    <div className="image-draft-header">
                      <div>
                        <strong>{t(language, 'imageMessage')}</strong>
                        <span>{pendingImages.length} / {MAX_CHAT_MEDIA_BATCH}</span>
                      </div>
                      <button
                        type="button"
                        aria-label={t(language, 'imageMessage')}
                        disabled={pendingImages.length >= MAX_CHAT_MEDIA_BATCH}
                        onClick={() => imageFileInputRef.current?.click()}
                      >
                        +
                      </button>
                      <button type="button" aria-label={t(language, 'close')} onClick={closeImageDraft}>×</button>
                    </div>
                    <div className={pendingImages.length === 1 ? 'image-draft-preview' : 'image-draft-preview media-grid'}>
                      {pendingImages.map((item, index) => (
                        <button key={`${item.name}-${index}`} type="button" className="image-draft-thumb" onClick={() => setPendingImages((current) => current.filter((_, i) => i !== index))}>
                          <img src={item.dataUrl} alt={item.name} />
                          <span aria-hidden="true">×</span>
                        </button>
                      ))}
                    </div>
                    <label className="spoiler-toggle">
                      <input type="checkbox" checked={pendingImages.every((item) => item.spoiler)} onChange={(event) => setPendingImages((current) => current.map((item) => ({ ...item, spoiler: event.target.checked })))} />
                      <span className="spoiler-checkbox" aria-hidden="true" />
                      <span>{t(language, 'spoiler')}</span>
                    </label>
                    <div className="emoji-input-shell image-caption-input">
                      <EmojiInlineInput ref={imageCaptionInputRef} className="emoji-inline-input" value={imageCaptionDraft} placeholder={t(language, 'imageCaptionPlaceholder')} onChange={(event) => setImageCaptionDraft(event.target.value)} onPaste={handleComposerPaste} onContextMenu={openImageCaptionMenu} autoFocus />
                      <div ref={imageEmojiAnchorRef} className="emoji-host inline">
                        <button
                          className="emoji-toggle inline"
                          type="button"
                          aria-label={t(language, 'emoji')}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setImageEmojiOpen((value) => !value);
                          }}
                        >
                          <EmojiToggleIcon />
                        </button>
                        {imageEmojiOpen ? <EmojiPicker language={language} enlarged anchorRef={imageEmojiAnchorRef} placement="top-end" onSelect={insertImageEmoji} onClose={() => setImageEmojiOpen(false)} token={token} currentUser={currentUser} /> : null}
                      </div>
                    </div>
                    <div className="image-draft-actions">
                      <button className="secondary-action" type="button" onClick={closeImageDraft}>{t(language, 'cancel')}</button>
                      <button type="submit" className="primary-action">{t(language, 'sendMessage')}</button>
                    </div>
                  </form>
                </div>
              ) : null}
              {imageCaptionMenu ? createPortal(
                <div ref={imageCaptionMenuRef} className="context-menu" style={{ left: imageCaptionMenuPos.x, top: imageCaptionMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" className="context-menu-action" onClick={() => void pasteIntoImageCaption()}>
                    <span className="context-menu-action-text">{t(language, 'paste')}</span>
                    <MenuPasteIcon />
                  </button>
                </div>,
                document.body
              ) : null}
            </>
          ) : (
            <div className="messenger-empty-state">
              <span className="messenger-empty-icon" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <strong className="messenger-empty-title">
                {language === 'ru' ? 'Выберите чат' : language === 'uk' ? 'Оберіть чат' : 'Select a chat'}
              </strong>
              <p className="messenger-empty-hint">
                {language === 'ru'
                  ? 'Откройте диалог слева, чтобы начать переписку'
                  : language === 'uk'
                    ? 'Відкрийте діалог ліворуч, щоб почати листування'
                    : 'Open a conversation on the left to start messaging'}
              </p>
            </div>
          )}
        </section>

        {rightPanelOpen && selectedUser && !selectedGroup ? (
          <aside className="messenger-right-panel">
            <button className="messenger-right-close" type="button" onClick={() => setRightPanelOpen(false)} aria-label={t(language, 'close')}>&times;</button>
            <div
              className="messenger-right-hero"
              style={{ background: wallpaperBackground((rightPanelUser ?? selectedUser).wallpaper, (rightPanelUser ?? selectedUser).theme) }}
            >
              <div className="messenger-right-hero-overlay" />
              <button className="messenger-right-avatar-button" type="button" onClick={(event) => { setProfileUser(rightPanelUser ?? selectedUser); setProfileAnchor(rectFrom(event)); }}>
                <img className="messenger-right-avatar" src={(rightPanelUser ?? selectedUser).avatarData} alt="" draggable={false} />
              </button>
              <UserName user={rightPanelUser ?? selectedUser} as="h3" className="messenger-right-name" />
              <SpotifyActivityLine token={token} userId={selectedUser.id} className="messenger-right-activity" />
              <small className="messenger-right-presence">{presenceLabel(selectedUser)}</small>
            </div>
            <div className="messenger-right-body">
              <div className="messenger-right-actions">
                <button type="button" onClick={(event) => { setProfileUser(rightPanelUser ?? selectedUser); setProfileAnchor(rectFrom(event)); }}>
                  <span className="messenger-right-action-icon">i</span>
                  <span>{t(language, 'viewProfile')}</span>
                </button>
                <button type="button" onClick={() => onViewDesktop(rightPanelUser ?? selectedUser)}>
                  <span className="messenger-right-action-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6M12 16v4"/></svg>
                  </span>
                  <span>{t(language, 'viewDesktop')}</span>
                </button>
              </div>

              <div className="messenger-right-section">
                {(['images', 'gifs', 'links', 'groups', 'friends'] as RightPanelSection[]).map((section) => {
                  const count = panelSectionCount(section);
                  return (
                    <button key={section} className="messenger-right-row" type="button" onClick={() => openPanelSection(section)}>
                      <span className={`messenger-right-row-icon ${section}`} aria-hidden="true" />
                      <span>{panelSectionLabel(section)}</span>
                      <strong>{count === null ? '...' : count}</strong>
                    </button>
                  );
                })}
              </div>

              <div className="messenger-right-preview">
                <div className="messenger-right-preview-head">
                  <strong>{t(language, 'sharedImages')}</strong>
                  <button type="button" onClick={() => openPanelSection('images')}>{imageItems.length}</button>
                </div>
                {sharedImages === null ? (
                  <div className="messenger-right-loading">{t(language, 'checking')}</div>
                ) : imageItems.length > 0 ? (
                  <div className="messenger-right-media-strip">
                    {imageItems.slice(0, 9).map((item) => (
                      <button key={item.key} type="button" onClick={() => openImageViewer(item.src, item.name)}>
                        <img src={item.src} alt="" loading="lazy" decoding="async" draggable={false} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="messenger-right-empty">{t(language, 'noMessages')}</div>
                )}
              </div>

              <button
                className={blockState.blocked ? 'messenger-right-row danger active' : 'messenger-right-row danger'}
                type="button"
                onClick={() => void toggleBlock()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>
                <span>{blockState.blocked ? t(language, 'unblockUser') : t(language, 'blockUser')}</span>
              </button>
            </div>
          </aside>
        ) : null}

        {panelSection && selectedUser ? createPortal(
          <div className="messenger-images-backdrop" onClick={() => setPanelSection(null)}>
            <div className="messenger-images-modal" onClick={(e) => e.stopPropagation()}>
              <header className="messenger-images-head">
                <strong>{panelSectionLabel(panelSection)}</strong>
                <span>{panelSectionCount(panelSection) === null ? t(language, 'checking') : panelSectionCount(panelSection)}</span>
                <button type="button" onClick={() => setPanelSection(null)} aria-label={t(language, 'close')}>&times;</button>
              </header>

              {panelSection === 'images' || panelSection === 'gifs' ? (
                sharedImages === null ? (
                  <div className="messenger-panel-loading">{t(language, 'checking')}</div>
                ) : (
                  <div className="messenger-images-grid">
                    {(panelSection === 'images' ? imageItems : gifItems).length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
                    {(panelSection === 'images' ? imageItems : gifItems).map((img) => (
                      <article key={img.key} className="messenger-images-card">
                        <button
                          type="button"
                          className="messenger-images-cell"
                          title={formatMessageDate(img.createdAt, language)}
                          onClick={() => openImageViewer(img.src, img.name)}
                        >
                          <img src={img.src} alt="" loading="lazy" decoding="async" draggable={false} />
                        </button>
                        <button type="button" className="messenger-images-jump" disabled={!img.messageId} onClick={() => img.messageId ? jumpFromPanel(img.messageId) : undefined}>
                          {formatMessageDate(img.createdAt, language)}
                        </button>
                      </article>
                    ))}
                  </div>
                )
              ) : (
                <div className="messenger-section-list">
                  {panelSection === 'links' ? (
                    sharedLinks === null ? <div className="messenger-panel-loading">{t(language, 'checking')}</div> :
                    linkItems.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> :
                    linkItems.map((item) => (
                      <article key={`${item.message.id}-${item.index}`} className="messenger-section-link-card">
                        <a
                          className="messenger-section-link"
                          href={item.url}
                          onClick={(event) => {
                            event.preventDefault();
                            openExternalUrl(item.url);
                          }}
                        >
                          <span className="messenger-section-link-host">{linkHost(item.url)}</span>
                          <span className="messenger-section-link-url">{item.url}</span>
                          {item.message.body.trim() !== item.url ? (
                            <small><MessagePreviewText text={item.message.body} size={14} /></small>
                          ) : null}
                        </a>
                        <div className="messenger-section-link-actions">
                          <small>{formatMessageDate(item.message.createdAt, language)}</small>
                          <button type="button" onClick={() => jumpFromPanel(item.message.id)}>{t(language, 'message')}</button>
                          <button type="button" onClick={() => void copyPanelLink(item.url)}>{t(language, 'copy')}</button>
                        </div>
                      </article>
                    ))
                  ) : panelSection === 'groups' ? (
                    mutualGroups === null ? <div className="messenger-panel-loading">{t(language, 'checking')}</div> :
                    mutualGroups.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> :
                    (mutualGroups ?? []).map((g) => (
                      <button key={g.id} type="button" className="messenger-section-row" onClick={() => {
                        setPanelSection(null);
                        setRightPanelOpen(false);
                        setGroups((current) => current.some((group) => group.id === g.id) ? current : [g, ...current]);
                        setSelectedGroup(g);
                        setSelectedUser(null);
                        setMessages([]);
                      }}>
                        <img src={groupAvatarSrc(g)} alt="" />
                        <span>
                          <strong>{g.name}</strong>
                          <small>{formatMessageDate(g.createdAt, language)}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    mutualFriends === null ? <div className="messenger-panel-loading">{t(language, 'checking')}</div> :
                    mutualFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> :
                    (mutualFriends ?? []).map((f) => (
                      <article key={f.id} className="messenger-section-person">
                        <button
                          type="button"
                          className="messenger-section-row"
                          onClick={(event) => {
                            const anchor = event.currentTarget.querySelector('img') ?? event.currentTarget;
                            const rect = anchor.getBoundingClientRect();
                            setProfileUser(f);
                            setProfileAnchor({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
                          }}
                        >
                          <img src={f.avatarData} alt="" />
                          <span>
                            <UserName user={f} as="strong" />
                            <SpotifyActivityLine token={token} userId={f.id} className="messenger-section-spotify" />
                            <small>{presenceLabel(f)}</small>
                          </span>
                        </button>
                        <button type="button" className="messenger-section-person-action" onClick={() => { setPanelSection(null); void chooseUser(f); }}>
                          {t(language, 'message')}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        ) : null}

        {userMenu ? createPortal(
          <div ref={userMenuRef} className="context-menu messenger-user-menu" style={{ left: userMenuPos.x, top: userMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => {
              setProfileUser(userMenu.user);
              setProfileAnchor({ left: userMenu.x, top: userMenu.y, right: userMenu.x, bottom: userMenu.y });
              setUserMenu(null);
            }}>
              {t(language, 'viewProfile')}
            </button>
            <button type="button" onClick={() => {
              onViewDesktop(userMenu.user);
              setUserMenu(null);
            }}>
              {t(language, 'viewDesktop')}
            </button>
            <button type="button" onClick={() => {
              setPinnedConversations((prev) => {
                const next = new Set(prev);
                if (next.has(userMenu.user.id)) next.delete(userMenu.user.id);
                else next.add(userMenu.user.id);
                savePinned(next);
                return next;
              });
              setUserMenu(null);
            }}>
              {pinnedConversations.has(userMenu.user.id) ? t(language, 'unpin') : t(language, 'pin')}
            </button>
            <button type="button" onClick={() => {
              setArchivedConversations((prev) => {
                const next = new Set(prev);
                if (next.has(userMenu.user.id)) next.delete(userMenu.user.id);
                else next.add(userMenu.user.id);
                saveArchived(next);
                return next;
              });
              setUserMenu(null);
            }}>
              {archivedConversations.has(userMenu.user.id)
                ? (language === 'ru' ? 'Убрать из архива' : 'Unarchive')
                : (language === 'ru' ? 'В архив' : 'Archive')}
            </button>
            <button type="button" onClick={() => {
              setAutoTranslateChats((prev) => {
                const next = new Set(prev);
                if (next.has(userMenu.user.id)) next.delete(userMenu.user.id);
                else next.add(userMenu.user.id);
                saveAutoTranslate(next);
                return next;
              });
              setUserMenu(null);
            }}>
              {autoTranslateChats.has(userMenu.user.id)
                ? (language === 'ru' ? 'Выключить автоперевод' : 'Disable auto-translate')
                : (language === 'ru' ? 'Автоперевод входящих' : 'Auto-translate incoming')}
            </button>
          </div>,
          document.body
        ) : null}

        {groupIdentityModalOpen ? (
          <div className="messenger-window-popover-layer messenger-identity-layer" onClick={() => setGroupIdentityModalOpen(false)}>
            <div className="profile-modal-card messenger-identity-modal" onClick={(event) => event.stopPropagation()}>
              <h3>{language === 'ru' ? 'Отправить сообщение как...' : 'Send message as...'}</h3>
              {selectedUser?.allowGroupIdentityMessages === false ? (
                <p className="settings-hint" style={{ margin: 0 }}>
                  {language === 'ru' ? 'Этот пользователь запретил сообщения от имени групп.' : 'This user does not allow messages from group identities.'}
                </p>
              ) : null}
              <div className="messenger-identity-list">
                <button
                  type="button"
                  className={!selectedGroupIdentity ? 'messenger-identity-option active' : 'messenger-identity-option'}
                  onClick={() => {
                    setSelectedGroupIdentity(null);
                    setGroupIdentityModalOpen(false);
                  }}
                >
                  <img src={currentUser.avatarData} alt="" draggable={false} />
                  <span>
                    <strong>{currentUser.nickname}</strong>
                    <small>{language === 'ru' ? 'Ваш аккаунт' : 'Your account'}</small>
                  </span>
                </button>
                {groupIdentityLoading ? <div className="messenger-identity-empty">...</div> : null}
                {!groupIdentityLoading && groupIdentityOptions.length === 0 ? (
                  <div className="messenger-identity-empty">
                    {language === 'ru' ? 'Нет групп, где вы владелец, администратор или модератор.' : 'No groups where you are an owner, admin, or moderator.'}
                  </div>
                ) : null}
                {groupIdentityOptions.map(({ group, memberCount }) => (
                  <button
                    key={group.id}
                    type="button"
                    className={selectedGroupIdentity?.id === group.id ? 'messenger-identity-option active' : 'messenger-identity-option'}
                    disabled={selectedUser?.allowGroupIdentityMessages === false}
                    onClick={() => {
                      setSelectedGroupIdentity(group);
                      setGroupIdentityModalOpen(false);
                    }}
                  >
                    <img src={group.avatarData} alt="" draggable={false} />
                    <span>
                      <strong>{group.name}</strong>
                      <small>Member: {memberCount}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {groupIdentityProfile ? createPortal(
          <div className="profile-popover-backdrop messenger-group-profile-backdrop" style={{ zIndex: zIndex + 100 }} onClick={() => setGroupIdentityProfile(null)}>
            <div
              className="profile-modal-card profile-view-card profile-themed profile-anchored messenger-group-profile-modal"
              style={{
                ['--group-profile-banner' as string]: groupNameplateBackground(groupIdentityProfile.group),
                ...anchoredGroupProfileStyle(groupIdentityProfile.anchorRect)
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="profile-banner messenger-group-profile-banner" style={{ background: groupNameplateBackground(groupIdentityProfile.group) }} />
              <div className="profile-body">
                <div className="profile-main messenger-group-profile-main">
                  <div className="profile-avatar-status-row messenger-group-profile-avatar-row">
                    <div className="profile-avatar-wrap messenger-group-profile-avatar">
                      <img src={groupAvatarSrc(groupIdentityProfile.group)} alt="" draggable={false} />
                    </div>
                  </div>
                  <div className="profile-info messenger-group-profile-info">
                    <div className="profile-name-row messenger-group-profile-title">
                      <h3>{groupIdentityProfile.group.name}</h3>
                    </div>
                    <span className="profile-state">Member: {groupIdentityProfile.loading ? '...' : groupIdentityProfile.memberCount}</span>
                    {groupIdentityProfile.group.description ? (
                      <p className="profile-status messenger-group-profile-description">{groupIdentityProfile.group.description}</p>
                    ) : null}
                    {groupIdentityProfile.error ? (
                      <p className="messenger-group-profile-error">{groupIdentityProfile.error}</p>
                    ) : null}
                    <div className="profile-primary-actions messenger-group-profile-actions">
                      {groupIdentityProfile.isMember ? (
                        <>
                          <button className="primary-action" type="button" disabled={groupIdentityProfile.loading || groupIdentityProfileBusy} onClick={openGroupFromIdentityProfile}>
                            {language === 'ru' ? 'Открыть группу' : 'Open group'}
                          </button>
                          <button className="secondary-action danger" type="button" disabled={groupIdentityProfile.loading || groupIdentityProfileBusy} onClick={() => void leaveGroupFromIdentityProfile()}>
                            {groupIdentityProfileBusy ? '...' : (language === 'ru' ? 'Выйти из нее' : 'Leave group')}
                          </button>
                        </>
                      ) : (
                        <button className="primary-action" type="button" disabled={groupIdentityProfile.loading || groupIdentityProfileBusy} onClick={() => void joinGroupFromIdentityProfile()}>
                          {groupIdentityProfileBusy ? '...' : (language === 'ru' ? 'Вступить в группу' : 'Join group')}
                        </button>
                      )}
                    </div>
                </div>
              </div>
            </div>
            </div>
          </div>,
          document.body
        ) : null}

        {profileUser ? (
          <ProfileModal
            user={profileUser}
            currentUser={currentUser}
            group={profileGroup}
            initialGroupRoles={profilePreload?.groupRoles}
            initialUserRoles={profilePreload?.userRoles}
            onlineUserIds={onlineUserIds}
            presenceStatuses={presenceStatuses}
            language={language}
            token={token}
            zIndex={(imageViewer || profileAnchor) ? 100002 : (panelSection ? 4500 : zIndex + 100)}
            anchorRect={profileAnchor}
            onClose={() => { setProfileUser(null); setProfileGroup(undefined); setProfilePreload(undefined); setProfileAnchor(null); }}
            onUserChange={onUserChange}
            onOpenChat={(userId) => {
              setPanelSection(null);
              setProfileUser(null);
              setProfileGroup(undefined);
              setProfilePreload(undefined);
              setProfileAnchor(null);
              const conversation = conversations.find((c) => c.user.id === userId);
              if (conversation) {
                void chooseUser(conversation.user);
                return;
              }
              const friend = friends.find((f) => f.id === userId);
              if (friend) void chooseUser(friend);
            }}
            onOpenDesktop={(user) => {
              setPanelSection(null);
              setProfileUser(null);
              setProfileGroup(undefined);
              setProfilePreload(undefined);
              setProfileAnchor(null);
              onViewDesktop(user);
            }}
            onOpenProfile={(nextUser) => { setProfileUser(nextUser); setProfilePreload(undefined); setProfileAnchor(null); }}
            onOpenGroup={(group) => {
              setPanelSection(null);
              setProfileUser(null);
              setProfileGroup(undefined);
              setProfilePreload(undefined);
              setProfileAnchor(null);
              const known = groups.find((g) => g.id === group.id) ?? group;
              setGroups((prev) => prev.some((g) => g.id === known.id) ? prev : [...prev, known]);
              setSelectedGroup(known);
              setSelectedUser(null);
              setMessages([]);
            }}
            onEditProfile={onEditProfile}
          />
        ) : null}
        {pinConfirm ? (
          <div className="messenger-pin-confirm" onClick={() => setPinConfirm(null)}>
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 15 }}>{t(language, 'confirmPin')}</p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 13 }}>{t(language, 'confirmPinHint')}</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="secondary-action" type="button" onClick={() => setPinConfirm(null)}>{t(language, 'cancel')}</button>
                <button className="primary-action" type="button" onClick={() => { void pinMessage(pinConfirm); setPinConfirm(null); }}>{t(language, 'pinMessage')}</button>
              </div>
            </div>
          </div>
        ) : null}
        {deleteConfirm ? (
          <div className="messenger-pin-confirm" onClick={() => setDeleteConfirm(null)}>
            <div className="profile-modal-card messenger-delete-confirm-card" onClick={(e) => e.stopPropagation()}>
              <div className="profile-main" style={{ padding: 20, gap: 12, display: 'grid' }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{t(language, 'confirmDelete')}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src={deleteConfirm.senderId === currentUser.id ? currentUser.avatarData : (selectedUser?.avatarData ?? '')}
                    alt=""
                    style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div>
                    <strong style={{ fontSize: 13 }}>
                      {deleteConfirm.senderId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? '')}
                    </strong>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {new Intl.DateTimeFormat(LOCALES[language], {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: getSavedTimeFormat() === '12h'
                      }).format(new Date(deleteConfirm.createdAt))}
                    </div>
                  </div>
                </div>
                {deleteConfirm.body ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    <MessageText text={deleteConfirm.body} />
                  </p>
                ) : null}
                {deleteConfirm.imageData && isVideoCircleAttachment(deleteConfirm.imageData, deleteConfirm.imageName) ? (
                  <VideoCircleMessagePlayer src={deleteConfirm.imageData} />
                ) : deleteConfirm.imageData && isVoiceAttachment(deleteConfirm.imageData, deleteConfirm.imageName) ? (
                  <VoiceMessagePlayer src={deleteConfirm.imageData} />
                ) : deleteConfirm.imageData ? (
                  <img src={deleteConfirm.imageData} alt="" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, objectFit: 'contain' }} />
                ) : null}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button className="secondary-action" type="button" onClick={() => setDeleteConfirm(null)}>{t(language, 'cancel')}</button>
                  <button className="primary-action" type="button" style={{ background: 'var(--danger)' }} onClick={() => { void removeMessage(deleteConfirm); setDeleteConfirm(null); }}>{t(language, 'deleteMessage')}</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {clearConversationConfirm ? (
          <div className="messenger-pin-confirm" onClick={() => { setClearConversationConfirm(null); setClearForEveryone(false); }}>
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 390 }}>
              <div className="profile-main" style={{ padding: 20, gap: 14, display: 'grid' }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 16 }}>
                  {language === 'ru' ? 'Очистить историю?' : 'Clear history?'}
                </p>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.45 }}>
                  {language === 'ru'
                    ? `Сообщения с ${clearConversationConfirm.nickname} исчезнут из этого диалога.`
                    : `Messages with ${clearConversationConfirm.nickname} will disappear from this conversation.`}
                </p>
                <label className="settings-toggle-row" style={{ margin: 0 }}>
                  <input type="checkbox" checked={clearForEveryone} onChange={(event) => setClearForEveryone(event.target.checked)} />
                  <span>{language === 'ru' ? 'Удалить историю у собеседника тоже' : 'Also clear it for the other user'}</span>
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                  <button className="secondary-action" type="button" onClick={() => { setClearConversationConfirm(null); setClearForEveryone(false); }}>
                    {t(language, 'cancel')}
                  </button>
                  <button className="primary-action" type="button" style={{ background: 'var(--danger)' }} onClick={() => void clearOpenConversation()}>
                    {language === 'ru' ? 'Очистить' : 'Clear'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {imageDragging ? <div className="messenger-drop-overlay">{t(language, 'dropImageHere')}</div> : null}
        {showCreateGroup ? (
          <div className="messenger-inline-modal" onClick={() => setShowCreateGroup(false)}>
            <div onClick={(event) => event.stopPropagation()}>
              <GroupCreateModal token={token} language={language}
                onClose={() => setShowCreateGroup(false)}
                onCreated={(group) => { setGroups((current) => current.some((g) => g.id === group.id) ? current.map((g) => g.id === group.id ? group : g) : [group, ...current]); setSelectedGroup(group); setSelectedUser(null); setMessages([]); setShowCreateGroup(false); }} />
            </div>
          </div>
        ) : null}
        </div>
        </div>
      </div>
      {imageViewer ? (
        <MediaLightbox
          language={language}
          src={imageViewer.items[imageViewer.index]?.src ?? ''}
          name={imageViewer.items[imageViewer.index]?.name ?? t(language, 'imageMessage')}
          items={imageViewer.items}
          initialIndex={imageViewer.index}
          onNavigate={() => { setProfileUser(null); setProfileAnchor(null); }}
          onSenderClick={(item, anchorRect) => {
            if (!item.senderUser) return;
            if (profileUser?.id === item.senderUser.id) {
              setProfileUser(null);
              setProfileAnchor(null);
              return;
            }
            setProfileUser(item.senderUser);
            setProfileGroup(undefined);
            setProfilePreload(undefined);
            setProfileAnchor(anchorRect);
          }}
          onClose={() => {
            setImageViewer(null);
            setProfileUser(null);
            setProfileAnchor(null);
          }}
        />
      ) : null}
      {reactionPicker ? (
        <EmojiPicker
          language={language}
          enlarged
          anchorRef={reactionAnchorRef}
          placement="top-end"
          onSelect={(emoji) => { void toggleReaction(reactionPicker.message, emoji); }}
          onClose={() => setReactionPicker(null)}
          token={token}
          currentUser={currentUser}
          returnFullToken
        />
      ) : null}
      {forwardSeed !== null ? (
        <ForwardModal
          language={language}
          currentUser={currentUser}
          token={token}
          conversations={conversations}
          friends={friends}
          groups={groups}
          onClose={() => setForwardSeed(null)}
          onSend={(targets, caption) => void performForward(targets, caption)}
        />
      ) : null}
      {voiceCall.phase === 'incoming' || ((voiceCall.phase === 'outgoing' || voiceCall.phase === 'connecting') && !callConnectedActive) ? (
        <CallInviteModal call={voiceCall} language={language} />
      ) : null}
      <ScreenSourcePicker call={voiceCall} language={language} />
      <CallAudioSink call={voiceCall} />
      {/* Multi-party voice: play remote audio. The connected UI lives inside the
          group chat (VoiceStage), mirroring the 1:1 call experience. */}
      <VoiceAudioSink streams={voiceRoom.remoteStreams} deafened={voiceRoom.deafened} />
    </WindowFrame>
  );
}
