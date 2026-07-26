import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { api } from '../api/client';
import { cacheUser, getOrFetchUser } from '../api/user-cache';
import { useSocket } from '../hooks/use-socket';
import type { ConnectionProvider, DesktopIconSize, DesktopSort, DesktopWallMessage, FriendRequests, Group, GroupMessage, Language, MentionNotification, MessengerMessage, NameStyle, NamePlate, PinnedCard, PublicUser, Theme, UserConnection } from '../api/types';
import { DEFAULT_NAMEPLATE, nameplateToCss } from '../api/types';
import type { AuthNotice } from '../app-types';
import { downloadAuthFile, openNativeImageFile, readImageAsDataUrl } from '../auth/auth-file';
import { useClock } from '../hooks/use-clock';
import { LANGUAGES, LOCALES, THEMES, TRANSLATE_LANGUAGES, findTranslateLanguage, t, getSavedTimeFormat, saveTimeFormat, getSavedTranslateTarget, saveTranslateTarget, getSavedComposerTranslateTarget, saveComposerTranslateTarget, type TimeFormat } from '../i18n';
import { addMusicTrack, deleteMusicTrack, getMusicTracks, saveMusicTracksOrder, type MusicTrack } from '../music-library';
import { AvatarCropper } from './AvatarCropper';
import { DesktopWall } from './DesktopWall';
import { DesktopIcons } from './DesktopIcons';
import { MessengerWindow, type OngoingCallInfo } from './MessengerWindow';
import { isVideoCircleAttachment, isVoiceAttachment } from './VoiceMessage';
import { AiChatWindow } from './AiChatWindow';
import { callMessageLabel, formatCallDuration } from '../utils/call-messages';
import { WatchTogetherWindow } from './WatchTogetherWindow';
import { PlayPauseIcon, PrevTrackIcon, NextTrackIcon, VolumeIcon } from './PlayerIcons';
import { ProfileModal } from './ProfileModal';
import { SaveBar } from './SaveBar';
import { NameStyleModal } from './NameStyleModal';
import { UserName } from './UserName';
import { UserStatusPanel } from './UserStatusPanel';
import {
  loadUserStatus,
  saveUserStatus,
  STATUS_CHANGED_EVENT,
  type PresenceStatus,
  type UserStatusState
} from '../utils/user-status';
import { applyPresenceChange, normalizePresenceSnapshot, onlineIdsFromPresence, type PresenceChangedPayload, type PresenceSnapshotPayload } from '../utils/presence';
import { PinnedImageCard } from './PinnedImageWindow';
import { PinnedVideoCard } from './PinnedVideoWindow';
import { RemoteDesktopWindow } from './RemoteDesktopWindow';
import { WindowFrame } from './WindowFrame';
import { PinSetupModal } from './PinSetupModal';
import { PinDisableModal } from './PinDisableModal';
import { VoiceSettings } from './VoiceSettings';
import { CustomEmojiSettings } from './CustomEmojiSettings';
import { EmojiPicker } from './EmojiPicker';
import { EmojiToggleIcon } from './ChatComposeIcons';
import { EMOJI_BURST_EVENT, playEmojiBurst, type EmojiBurstEventDetail } from './Twemoji';
import { ProfilePreviewCard } from './ProfilePreviewCard';
import { customEmojiToShortcodes, expandCustomEmojiShortcodes } from '../utils/custom-emoji';
import { parseForward } from '../utils/forward';
import { UpdatesWindow } from './UpdatesWindow';
import { InboxWindow } from './InboxWindow';
import { hasPin } from '../utils/pin-lock';
import { LATEST_UPDATE_ID, hasUnseenUpdate, markUpdatesSeen } from '../utils/updates';
import { DesktopNotifications, type DesktopNotification } from './DesktopNotifications';
import { ErrorBoundary } from './ErrorBoundary';
import { assetUrl } from '../utils/assets';

type DesktopProps = {
  token: string;
  user: PublicUser;
  language: Language;
  notice: AuthNotice | null;
  onNoticeClose: () => void;
  onUserChange: (user: PublicUser) => void;
  onLogout: () => void;
};

type SettingsTab = 'profile' | 'desktop' | 'appearance' | 'region' | 'connections' | 'music' | 'voice' | 'privacy' | 'security' | 'premium' | 'customEmoji';
type DesktopIconId = string;
type DesktopContextMenu =
  | { type: 'desktop'; x: number; y: number }
  | { type: 'shortcut'; x: number; y: number; iconId: string };

type MentionSocketPayload =
  | { kind: 'dm'; message: MessengerMessage; sender: PublicUser }
  | { kind: 'group'; message: GroupMessage; sender: PublicUser; group: Group };

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

// DesktopNotification type is imported from DesktopNotifications.tsx

type IconDragState = {
  ids: DesktopIconId[];
  startX: number;
  startY: number;
  basePositions: Record<string, { x: number; y: number }>;
  moved: boolean;
};

const LIGHT_WALLPAPER = 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
const DARK_WALLPAPER = 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)';
const EMPTY_INBOX_REQUESTS: FriendRequests = { incoming: [], outgoing: [] };

function friendRequestReadKey(user: FriendRequests['incoming'][number]) {
  return `friendRequest:${user.id}:${user.requestCreatedAt ?? user.createdAt}`;
}
function mentionReadKey(mention: MentionNotification) {
  return `mention:${mention.id}`;
}

const WALLPAPERS = [
  {
    name: 'Blue Air',
    value: 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 52%, #d6e9fb 100%)'
  },
  {
    name: 'Cloud Gray',
    value: 'linear-gradient(135deg, #eff4f8 0%, #ffffff 50%, #dde7ef 100%)'
  },
  {
    name: 'Night Blue',
    value: 'linear-gradient(135deg, #111827 0%, #172033 52%, #0b1220 100%)'
  },
  {
    name: 'Soft Mint',
    value: 'linear-gradient(135deg, #e8fbf4 0%, #f8fbff 52%, #d7f0e7 100%)'
  }
];

const ACCENT_COLORS = ['#0078D4', '#2AABEE', '#00A86B', '#7C3AED', '#E81123', '#FF8C00', '#D83B01', '#E3008C'];
const RIOT_REGIONS = [
  'br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', 'me1', 'na1', 'oc1', 'ru', 'sg2', 'tr1', 'tw2', 'vn2'
];
const CONNECTION_ICONS = {
  spotify: assetUrl('Icons/spotify.png'),
  riot: assetUrl('Icons/riot.png')
};
type ConnectionVisibilityDraft = Record<ConnectionProvider, { showProfile: boolean; showActivity: boolean }>;
function defaultConnectionVisibilityDraft(): ConnectionVisibilityDraft {
  return {
    spotify: { showProfile: true, showActivity: true },
    riot: { showProfile: true, showActivity: true }
  };
}
function readConnectionVisibility(connection: UserConnection | undefined | null) {
  return {
    showProfile: typeof connection?.metadata?.showProfile === 'boolean' ? connection.metadata.showProfile : true,
    showActivity: typeof connection?.metadata?.showActivity === 'boolean' ? connection.metadata.showActivity : true
  };
}
function connectionVisibilityFromConnections(connections: UserConnection[]) {
  const draft = defaultConnectionVisibilityDraft();
  for (const connection of connections) {
    if (!connection.connected) continue;
    draft[connection.provider] = readConnectionVisibility(connection);
  }
  return draft;
}
function connectionVisibilityIsDirty(connection: UserConnection, draft: ConnectionVisibilityDraft) {
  const saved = readConnectionVisibility(connection);
  const next = draft[connection.provider];
  return saved.showProfile !== next.showProfile || saved.showActivity !== next.showActivity;
}

const RECENT_WALLPAPERS_KEY = 'notoc.recentWallpapers';
const MAX_RECENT_WALLPAPERS = 8;
const WINDOW_MAXIMIZED_KEY = 'notoc.windowMaximized';

function loadWindowMaximized(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(WINDOW_MAXIMIZED_KEY) ?? '{}'); } catch { return {}; }
}

function saveWindowMaximized(value: Record<string, boolean>) {
  localStorage.setItem(WINDOW_MAXIMIZED_KEY, JSON.stringify(value));
}

const DEFAULT_ICON_POSITIONS = {
  messenger: { x: 18, y: 18 },
  inbox: { x: 150, y: 18 },
  watchTogether: { x: 18, y: 140 },
  updates: { x: 18, y: 262 },
  aiChat: { x: 18, y: 384 }
} satisfies Record<string, { x: number; y: number }>;

const MAX_IMPORTED_FILE_SIZE = 50 * 1024 * 1024;
const MAX_IMPORTED_VIDEO_SIZE = 150 * 1024 * 1024;

// Per-file size cap: videos may be up to 150 MB, everything else up to 50 MB.
function maxImportSizeForFile(file: File) {
  const mimeType = inferMimeType(file);
  return mimeType.startsWith('video/') ? MAX_IMPORTED_VIDEO_SIZE : MAX_IMPORTED_FILE_SIZE;
}

const ICON_METRICS: Record<DesktopIconSize, { width: number; height: number; gap: number }> = {
  small: { width: 92, height: 100, gap: 6 },
  medium: { width: 118, height: 126, gap: 6 },
  large: { width: 146, height: 150, gap: 8 }
};

const DESKTOP_GRID_MARGIN = 18;
const DESKTOP_GRID_TASKBAR_RESERVED = 76;

const SETTINGS_TABS: Array<{ id: SettingsTab; labelKey: Parameters<typeof t>[1] }> = [
  { id: 'desktop', labelKey: 'desktopSettings' },
  { id: 'appearance', labelKey: 'appearanceSettings' },
  { id: 'region', labelKey: 'languageAndTime' },
  { id: 'connections', labelKey: 'connectionsSettings' },
  { id: 'music', labelKey: 'music' },
  { id: 'voice', labelKey: 'voiceAndVideo' },
  { id: 'customEmoji', labelKey: 'customEmojiSettingsTitle' },
  { id: 'privacy', labelKey: 'privacySettings' },
  { id: 'security', labelKey: 'securitySettings' },
  { id: 'premium', labelKey: 'premiumSettings' }
];

const SETTINGS_HEADINGS: Record<SettingsTab, Array<{ id: string; labelKey: Parameters<typeof t>[1] }>> = {
  profile: [
    { id: 'profile-main', labelKey: 'profile' },
    { id: 'profile-style', labelKey: 'displayNameStyles' },
    { id: 'profile-theme', labelKey: 'profileTheme' },
    { id: 'profile-nameplate', labelKey: 'nameplate' },
    { id: 'profile-status', labelKey: 'profileStatus' }
  ],
  desktop: [
    { id: 'desktop-wallpaper', labelKey: 'wallpaper' },
    { id: 'desktop-icons', labelKey: 'iconLayout' }
  ],
  appearance: [
    { id: 'appearance-preview', labelKey: 'appearanceSettings' },
    { id: 'appearance-accent', labelKey: 'recentColors' },
    { id: 'appearance-theme', labelKey: 'customColor' },
    { id: 'appearance-transparency', labelKey: 'transparencyEffects' }
  ],
  region: [
    { id: 'region-language', labelKey: 'languageAndTime' },
    { id: 'region-translate', labelKey: 'translateTo' },
    { id: 'region-composer', labelKey: 'composerTranslateTo' },
    { id: 'region-time', labelKey: 'timeFormat' }
  ],
  connections: [],
  music: [],
  voice: [],
  customEmoji: [],
  privacy: [{ id: 'privacy-group-identity', labelKey: 'groupIdentityMessages' }],
  security: [],
  premium: []
};



function wallpaperToBackground(value: string, theme: Theme) {
  const isDark = theme === 'dark' || theme === 'system-black';
  if (!value) return isDark ? DARK_WALLPAPER : LIGHT_WALLPAPER;
  if (value.startsWith('data:image/')) return `url("${value}")`;
  return value;
}

function formatUserSince(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, language: Language) {
  return error instanceof Error ? error.message : t(language, 'unknownError');
}

function normalizeIconPositions(value: PublicUser['desktopIcons']): PublicUser['desktopIcons'] {
  return {
    ...value,
    messenger: { ...value.messenger, ...DEFAULT_ICON_POSITIONS.messenger, ...value.messenger, kind: 'app' },
    inbox: { ...value.inbox, ...DEFAULT_ICON_POSITIONS.inbox, ...value.inbox, kind: 'app' },
    watchTogether: { ...value.watchTogether, ...DEFAULT_ICON_POSITIONS.watchTogether, ...value.watchTogether, kind: 'app' },
    updates: { ...value.updates, ...DEFAULT_ICON_POSITIONS.updates, ...value.updates, kind: 'app' },
    aiChat: { ...value.aiChat, ...DEFAULT_ICON_POSITIONS.aiChat, ...value.aiChat, kind: 'app' }
  } satisfies PublicUser['desktopIcons'];
}

function desktopGridBounds(bounds: DOMRect | { width: number; height: number } | null | undefined, metrics: { width: number; height: number }) {
  const width = bounds?.width ?? window.innerWidth;
  const height = bounds?.height ?? window.innerHeight;
  return {
    maxX: Math.max(DESKTOP_GRID_MARGIN, width - metrics.width - DESKTOP_GRID_MARGIN),
    maxY: Math.max(DESKTOP_GRID_MARGIN, height - DESKTOP_GRID_TASKBAR_RESERVED - metrics.height)
  };
}

function snapDesktopIconPosition(
  x: number,
  y: number,
  metrics: { width: number; height: number; gap: number },
  bounds?: DOMRect | { width: number; height: number } | null
) {
  const stepX = metrics.width + metrics.gap;
  const stepY = metrics.height + metrics.gap;
  const { maxX, maxY } = desktopGridBounds(bounds, metrics);
  const maxColumn = Math.max(0, Math.floor((maxX - DESKTOP_GRID_MARGIN) / stepX));
  const maxRow = Math.max(0, Math.floor((maxY - DESKTOP_GRID_MARGIN) / stepY));
  const column = Math.max(0, Math.min(maxColumn, Math.round((x - DESKTOP_GRID_MARGIN) / stepX)));
  const row = Math.max(0, Math.min(maxRow, Math.round((y - DESKTOP_GRID_MARGIN) / stepY)));
  return {
    x: DESKTOP_GRID_MARGIN + column * stepX,
    y: DESKTOP_GRID_MARGIN + row * stepY
  };
}

function desktopGridPositionByIndex(
  index: number,
  metrics: { width: number; height: number; gap: number },
  bounds?: DOMRect | { width: number; height: number } | null
) {
  const stepX = metrics.width + metrics.gap;
  const stepY = metrics.height + metrics.gap;
  const { maxY } = desktopGridBounds(bounds, metrics);
  const rows = Math.max(1, Math.floor((maxY - DESKTOP_GRID_MARGIN) / stepY) + 1);
  const column = Math.floor(index / rows);
  const row = index % rows;
  return snapDesktopIconPosition(
    DESKTOP_GRID_MARGIN + column * stepX,
    DESKTOP_GRID_MARGIN + row * stepY,
    metrics,
    bounds
  );
}

function snapDesktopIconPositions(
  positions: PublicUser['desktopIcons'],
  metrics: { width: number; height: number; gap: number },
  bounds?: DOMRect | { width: number; height: number } | null
) {
  const next: PublicUser['desktopIcons'] = { ...positions };
  for (const [id, pos] of Object.entries(positions)) {
    if (!pos) continue;
    next[id] = { ...pos, ...snapDesktopIconPosition(pos.x, pos.y, metrics, bounds) };
  }
  return next;
}

function rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function readFileAsDataUrl(file: File, onProgress?: (fraction: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    };
    reader.onload = () => {
      onProgress?.(1);
      resolve(String(reader.result ?? ''));
    };
    reader.readAsDataURL(file);
  });
}

function inferMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'flac') return 'audio/flac';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'ogv') return 'video/ogg';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function dataUrlWithMime(dataUrl: string, mimeType: string) {
  if (!dataUrl.startsWith('data:application/octet-stream') || mimeType === 'application/octet-stream') return dataUrl;
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? `data:${mimeType};base64,${dataUrl.slice(commaIndex + 1)}` : dataUrl;
}

function notificationMessage(message: Pick<MessengerMessage, 'body' | 'imageData' | 'imageName'>, language: Language) {
  const fwd = parseForward(message.body);
  if (fwd) return `↪ ${fwd.caption || fwd.body}`;
  if (isVideoCircleAttachment(message.imageData, message.imageName)) {
    return language === 'ru' ? 'Р’РёРґРµРѕ РєСЂСѓР¶РѕРє' : 'Video message';
  }
  if (isVoiceAttachment(message.imageData, message.imageName)) {
    return language === 'ru' ? 'Р“РѕР»РѕСЃРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ' : 'Voice message';
  }
  return message.body || (message.imageData ? t(language, 'imageMessage') : '');
}

// Field-by-field nameplate comparison вЂ” avoids JSON.stringify on every render.
function nameplateIsDirty(
  draft: NonNullable<NamePlate>,
  saved: NonNullable<NamePlate>
): boolean {
  return (
    draft.type !== saved.type ||
    draft.color !== saved.color ||
    draft.gradientFrom !== saved.gradientFrom ||
    draft.gradientTo !== saved.gradientTo ||
    draft.image !== saved.image
  );
}

function nameStyleIsDirty(draft: NameStyle, saved: NameStyle): boolean {
  if (!draft && !saved) return false;
  if (!draft || !saved) return true;
  return draft.font !== saved.font || draft.effect !== saved.effect || draft.color !== saved.color;
}

function desktopIconsChanged(draft: PublicUser['desktopIcons'], saved: PublicUser['desktopIcons']): boolean {
  try {
    return JSON.stringify(draft) !== JSON.stringify(normalizeIconPositions(saved));
  } catch {
    return draft !== saved;
  }
}

function applyAppearanceToDocument(theme: Theme, accentColor: string, transparencyEnabled: boolean) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--blue', accentColor || '#2AABEE');
  document.documentElement.style.removeProperty('--blue-dark');
  document.documentElement.dataset.transparency = transparencyEnabled === false ? 'off' : 'on';
}

function runThemeWaveTransition(update: () => void) {
  const doc = document as ViewTransitionDocument;
  const canUseViewTransition =
    typeof doc.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!canUseViewTransition) {
    update();
    return;
  }

  const transition = doc.startViewTransition(update);
  const originX = 0;
  const originY = window.innerHeight;
  const endRadius = Math.hypot(window.innerWidth, window.innerHeight) + 48;

  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${originX}px ${originY}px)`,
            `circle(${endRadius}px at ${originX}px ${originY}px)`
          ]
        },
        {
          duration: 680,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)'
        } as KeyframeAnimationOptions
      );
    })
    .catch(() => undefined);
}

export function Desktop({ token, user, language, notice, onNoticeClose, onUserChange, onLogout }: DesktopProps) {
  const desktopRef = useRef<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<DesktopContextMenu | null>(null);
  const [settingsWindow, setSettingsWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [settingsMaximized, setSettingsMaximized] = useState(() => loadWindowMaximized().settings ?? false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [settingsNav, setSettingsNav] = useState<{ entries: SettingsTab[]; index: number }>({ entries: ['profile'], index: 0 });
  const [nicknameDraft, setNicknameDraft] = useState(user.nickname);
  const [nameStyleDraft, setNameStyleDraft] = useState<NameStyle>(user.nameStyle ?? null);
  const [profilePrimaryDraft, setProfilePrimaryDraft] = useState(user.profilePrimaryColor || '#2AABEE');
  const [profileAccentDraft, setProfileAccentDraft] = useState(user.profileAccentColor || '#5865F2');
  const [nameplateDraft, setNameplateDraft] = useState<NonNullable<NamePlate>>(user.nameplate ?? DEFAULT_NAMEPLATE);
  const [nameStyleModalOpen, setNameStyleModalOpen] = useState(false);
  const [confirmDeleteNameStyle, setConfirmDeleteNameStyle] = useState(false);
  const [statusDraft, setStatusDraft] = useState(() => customEmojiToShortcodes(user.status ?? ''));
  const [statusEmojiOpen, setStatusEmojiOpen] = useState(false);
  const statusEmojiAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [avatarDraft, setAvatarDraft] = useState(user.avatarData);
  const [wallpaperDraft, setWallpaperDraft] = useState(user.wallpaper);
  const [recentWallpapers, setRecentWallpapers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_WALLPAPERS_KEY) ?? '[]'); } catch { return []; }
  });
  const [languageDraft, setLanguageDraft] = useState<Language>(user.language);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [translateTarget, setTranslateTarget] = useState<string>(getSavedTranslateTarget);
  const [translateTargetOpen, setTranslateTargetOpen] = useState(false);
  const [translateSearch, setTranslateSearch] = useState('');
  const [composerTranslateTarget, setComposerTranslateTarget] = useState<string>(getSavedComposerTranslateTarget);
  const [composerTranslateTargetOpen, setComposerTranslateTargetOpen] = useState(false);
  const [composerTranslateSearch, setComposerTranslateSearch] = useState('');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(getSavedTimeFormat);
  const clock = useClock(language, getSavedTimeFormat());
  const [themeDraft, setThemeDraft] = useState<Theme>(user.theme);
  const [accentColorDraft, setAccentColorDraft] = useState(user.accentColor);
  const [transparencyDraft, setTransparencyDraft] = useState(user.transparencyEnabled);
  const [iconSizeDraft, setIconSizeDraft] = useState<DesktopIconSize>(user.desktopIconSize);
  const [hideIconsDraft, setHideIconsDraft] = useState(user.hideDesktopIcons);
  const [allowGroupIdentityMessagesDraft, setAllowGroupIdentityMessagesDraft] = useState(user.allowGroupIdentityMessages ?? true);
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [connectionVisibilityDraft, setConnectionVisibilityDraft] = useState<ConnectionVisibilityDraft>(() => defaultConnectionVisibilityDraft());
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsStatus, setConnectionsStatus] = useState('');
  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [riotConfigured, setRiotConfigured] = useState(false);
  const [riotGameName, setRiotGameName] = useState('');
  const [riotTagLine, setRiotTagLine] = useState('');
  const [riotRegion, setRiotRegion] = useState('euw1');
  const [cropSource, setCropSource] = useState<string | null>(null);
  const widgetPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const widgetVideoInputRef = useRef<HTMLInputElement | null>(null);
  const playlistAudioInputRef = useRef<HTMLInputElement | null>(null);
  const widgetDropPointRef = useRef<{ x: number; y: number } | null>(null);
  const [inboxWindow, setInboxWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [inboxMaximized, setInboxMaximized] = useState(() => loadWindowMaximized().inbox ?? false);
  const [inboxReadIds, setInboxReadIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`notoc.inbox.read.${user.id}`) ?? '[]');
      return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxRequests, setInboxRequests] = useState<FriendRequests>(EMPTY_INBOX_REQUESTS);
  const [inboxWallMessages, setInboxWallMessages] = useState<DesktopWallMessage[]>([]);
  const [mentionNotifications, setMentionNotifications] = useState<MentionNotification[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`notoc.inbox.mentions.${user.id}`) ?? '[]');
      return Array.isArray(stored) ? stored.filter((item) => item && typeof item.id === 'string') as MentionNotification[] : [];
    } catch {
      return [];
    }
  });
  const [messengerWindow, setMessengerWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [messengerMaximized, setMessengerMaximized] = useState(() => loadWindowMaximized().messenger ?? false);
  const [remoteDesktopWindow, setRemoteDesktopWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [remoteDesktopMaximized, setRemoteDesktopMaximized] = useState(() => loadWindowMaximized()['remote-desktop'] ?? false);
  const [remoteDesktopUser, setRemoteDesktopUser] = useState<PublicUser | null>(null);
  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null);
  const [activeChatGroupId, setActiveChatGroupId] = useState<string | null>(null);
  const [messengerChatRequest, setMessengerChatRequest] = useState<{ userId: string; requestId: number } | null>(null);
  const [messengerGroupRequest, setMessengerGroupRequest] = useState<{ groupId: string; group: Group; channelId: string | null; requestId: number } | null>(null);
  const [watchTogetherWindow, setWatchTogetherWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [watchTogetherMaximized, setWatchTogetherMaximized] = useState(() => loadWindowMaximized()['watch-together'] ?? false);
  const [watchTogetherInvite, setWatchTogetherInvite] = useState<{ code: string; requestId: number } | null>(null);
  const [aiChatWindow, setAiChatWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [aiChatMaximized, setAiChatMaximized] = useState(() => loadWindowMaximized()['ai-chat'] ?? false);
  const [pinnedCards, setPinnedCards] = useState<PinnedCard[]>(() => (Array.isArray(user.pinnedCards) ? user.pinnedCards : []));
  const [desktopWatcherCount, setDesktopWatcherCount] = useState(0);
  const [viewerCursors, setViewerCursors] = useState<Record<string, { nickname: string; x: number; y: number }>>({});
  // Use the shared socket from SocketProvider instead of creating a new one.
  const sharedSocket = useSocket();
  const socketRef = useRef<Socket | null>(null);
  socketRef.current = sharedSocket;
  const pinnedCardsRef = useRef<PinnedCard[]>(Array.isArray(user.pinnedCards) ? user.pinnedCards : []);
  const pinnedBroadcastRef = useRef(0);

  pinnedCardsRef.current = pinnedCards;
  // Window z-indexes start well above the desktop context menu (z 200) so an
  // open window always renders above the desktop right-click menu.
  const [windowZ, setWindowZ] = useState({ settings: 1010, inbox: 1011, messenger: 1012, remoteDesktop: 1013, aiChat: 1014, watchTogether: 1015 });
  const [nextZ, setNextZ] = useState(1015);
  const [iconPositions, setIconPositions] = useState<PublicUser['desktopIcons']>(() => normalizeIconPositions(user.desktopIcons));
  // The desktop size (px) for which the current iconPositions are valid. On
  // resize we rescale every icon's x/y by the width/height ratio so the layout
  // stays proportional (an icon dropped at the right edge in fullscreen stays at
  // the right edge in a smaller window). Initialised on first measure.
  const iconRefSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [selectedIconIds, setSelectedIconIds] = useState<DesktopIconId[]>([]);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragState, setDragState] = useState<IconDragState | null>(null);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [settingsError, setSettingsError] = useState('');
  const [saving, setSaving] = useState(false);
  // Bumped to shake the settings save bar when the user tries to close the
  // window while there are unsaved changes.
  const [settingsBarShake, setSettingsBarShake] = useState(0);
  // Tracks unsaved changes inside the self-contained Voice settings tab.
  const voiceDirtyRef = useRef(false);
  const handleVoiceDirtyChange = useCallback((dirty: boolean) => {
    voiceDirtyRef.current = dirty;
  }, []);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const [highlightSettingsHeading, setHighlightSettingsHeading] = useState<string | null>(null);
  const [legalContent, setLegalContent] = useState<'privacy' | 'terms' | null>(null);
  const [pinModal, setPinModal] = useState<'create' | 'change' | null>(null);
  const [pinDisableModal, setPinDisableModal] = useState(false);
  const [pinEnabled, setPinEnabled] = useState<boolean>(() => hasPin(user.id));
  const [pinStatusMessage, setPinStatusMessage] = useState('');
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [dragTrackIndex, setDragTrackIndex] = useState<number | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.55);
  const [musicTime, setMusicTime] = useState(0);
  const [musicDuration, setMusicDuration] = useState(0);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [notifications, setNotifications] = useState<DesktopNotification[]>([]);
  // Thin top progress bar shown while importing files to the desktop or a
  // folder. `null` means idle; otherwise a 0..1 fraction.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadHideTimer = useRef<number | null>(null);
  const [incomingCallToast, setIncomingCallToast] = useState<{ callId: string; caller: PublicUser } | null>(null);
  // Calls that already finished/were accepted; guards against the async user fetch
  // resolving AFTER the call was handled and re-showing a stale toast.
  const dismissedCallsRef = useRef<Set<string>>(new Set());
  const [pendingCallAccept, setPendingCallAccept] = useState<{ callId: string; callerId: string } | null>(null);
  const [ongoingCall, setOngoingCall] = useState<OngoingCallInfo | null>(null);
  const handleCallStateChange = useCallback((info: OngoingCallInfo | null) => setOngoingCall(info), []);
  const handlePendingCallHandled = useCallback(() => setPendingCallAccept(null), []);

  // Safety net: the desktop socket reconnects when its effect deps change, so a
  // `call:accepted`/`call:ended` can be missed. Never keep a ringing toast longer
  // than the server's ring timeout, and drop it as soon as a call is connected.
  useEffect(() => {
    if (!incomingCallToast) return;
    if (ongoingCall) {
      dismissedCallsRef.current.add(incomingCallToast.callId);
      setIncomingCallToast(null);
      return;
    }
    const timer = window.setTimeout(() => {
      dismissedCallsRef.current.add(incomingCallToast.callId);
      setIncomingCallToast(null);
    }, 45_000);
    return () => window.clearTimeout(timer);
  }, [incomingCallToast, ongoingCall]);
  const [cardNumberDraft, setCardNumberDraft] = useState('');
  const [cardHolderDraft, setCardHolderDraft] = useState('');
  const [cardExpiryDraft, setCardExpiryDraft] = useState('');
  const [cardCvcDraft, setCardCvcDraft] = useState('');
  const [premiumStatus, setPremiumStatus] = useState('');
  const [profileModalUser, setProfileModalUser] = useState<PublicUser | null>(null);
  // Avatar rect so the profile card pops out anchored beside it. Null в†’ centered.
  const [profileAnchor, setProfileAnchor] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  // What's New / updates center. `updatesInitialId` is set to the latest update
  // id when auto-opened on login (so it opens expanded), null when opened from
  // the desktop shortcut (so it shows the full list).
  const [updatesWindowOpen, setUpdatesWindowOpen] = useState(false);
  const [updatesInitialId, setUpdatesInitialId] = useState<string | null>(null);
  const [taskbarMenu, setTaskbarMenu] = useState<{ x: number; y: number } | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [presenceStatuses, setPresenceStatuses] = useState<Record<string, PresenceStatus>>({});
  const [userStatus, setUserStatus] = useState<UserStatusState>(loadUserStatus);
  const [statusPanel, setStatusPanel] = useState<{ left: number; bottom: number } | null>(null);
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setStatusDraft(customEmojiToShortcodes(user.status ?? ''));
  }, [user.status, user.id]);

  // Keep the local presence/voice state in sync with any other surface that
  // updates it (the panel persists + broadcasts via STATUS_CHANGED_EVENT).
  useEffect(() => {
    const onStatusChange = (event: Event) => {
      const detail = (event as CustomEvent<UserStatusState>).detail;
      if (detail) setUserStatus(detail);
    };
    window.addEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
    return () => window.removeEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
  }, []);

  const selectUserStatus = useCallback((status: PresenceStatus) => {
    setUserStatus((prev) => { const next = { ...prev, status }; saveUserStatus(next); return next; });
  }, []);

  const toggleSelfMute = useCallback(() => {
    setUserStatus((prev) => {
      const muted = !prev.voice.muted;
      const deafened = muted ? prev.voice.deafened : false;
      const next = { ...prev, voice: { muted, deafened } };
      saveUserStatus(next);
      return next;
    });
  }, []);

  const toggleSelfDeafen = useCallback(() => {
    setUserStatus((prev) => {
      const deafened = !prev.voice.deafened;
      const muted = deafened ? true : false;
      const next = { ...prev, voice: { muted, deafened } };
      saveUserStatus(next);
      return next;
    });
  }, []);

  const openStatusPanel = useCallback((event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const rect = statusTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStatusPanel((cur) => (cur ? null : { left: rect.left, bottom: rect.top }));
  }, []);

  useEffect(() => {
    if (!taskbarMenu) return;

    function closeTaskbarMenu(event: globalThis.MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.('.taskbar-user-menu')) return;
      setTaskbarMenu(null);
    }

    function closeTaskbarMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setTaskbarMenu(null);
    }

    window.addEventListener('mousedown', closeTaskbarMenu, true);
    window.addEventListener('keydown', closeTaskbarMenuOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeTaskbarMenu, true);
      window.removeEventListener('keydown', closeTaskbarMenuOnEscape);
    };
  }, [taskbarMenu]);

  useEffect(() => {
    localStorage.setItem(RECENT_WALLPAPERS_KEY, JSON.stringify(recentWallpapers));
  }, [recentWallpapers]);

  // Debounced: write to localStorage at most once per 300 ms instead of on
  // every individual window maximize/restore event.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveWindowMaximized({
        settings: settingsMaximized,
        inbox: inboxMaximized,
        messenger: messengerMaximized,
        'remote-desktop': remoteDesktopMaximized,
        'ai-chat': aiChatMaximized,
        'watch-together': watchTogetherMaximized
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settingsMaximized, inboxMaximized, messengerMaximized, remoteDesktopMaximized, aiChatMaximized, watchTogetherMaximized]);

  useEffect(() => {
    if (!wallpaperDraft) return;
    if (WALLPAPERS.some((w) => w.value === wallpaperDraft) || wallpaperDraft.startsWith('data:image/')) {
      setRecentWallpapers((current) => {
        const next = [wallpaperDraft, ...current.filter((w) => w !== wallpaperDraft)];
        return next.slice(0, MAX_RECENT_WALLPAPERS);
      });
    }
  }, [wallpaperDraft]);

  useEffect(() => {
    if (profileModalUser && profileModalUser.id === user.id) {
      setProfileModalUser(user);
    }
  }, [user, profileModalUser]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`notoc.inbox.read.${user.id}`) ?? '[]');
      setInboxReadIds(new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : []));
    } catch {
      setInboxReadIds(new Set());
    }
    try {
      const storedMentions = JSON.parse(localStorage.getItem(`notoc.inbox.mentions.${user.id}`) ?? '[]');
      setMentionNotifications(Array.isArray(storedMentions) ? storedMentions.filter((item) => item && typeof item.id === 'string') as MentionNotification[] : []);
    } catch {
      setMentionNotifications([]);
    }
  }, [user.id]);

  useEffect(() => {
    localStorage.setItem(`notoc.inbox.read.${user.id}`, JSON.stringify(Array.from(inboxReadIds).slice(-300)));
  }, [inboxReadIds, user.id]);

  useEffect(() => {
    localStorage.setItem(`notoc.inbox.mentions.${user.id}`, JSON.stringify(mentionNotifications.slice(0, 100)));
  }, [mentionNotifications, user.id]);

  useEffect(() => {
    setInboxLoading(true);
    setInboxRequests(EMPTY_INBOX_REQUESTS);
    setInboxWallMessages([]);
  }, [user.id]);

  const computedInboxUnreadCount = useMemo(() => {
    const requestCount = inboxRequests.incoming.reduce(
      (count, requestUser) => count + (inboxReadIds.has(friendRequestReadKey(requestUser)) ? 0 : 1),
      0
    );
    const wallCount = inboxWallMessages.reduce(
      (count, message) => count + (inboxReadIds.has(`desktopWall:${message.id}`) ? 0 : 1),
      0
    );
    const mentionCount = mentionNotifications.reduce(
      (count, mention) => count + (inboxReadIds.has(mentionReadKey(mention)) ? 0 : 1),
      0
    );
    return requestCount + wallCount + mentionCount;
  }, [inboxReadIds, inboxRequests.incoming, inboxWallMessages, mentionNotifications]);

  const groupMentionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const mention of mentionNotifications) {
      if (mention.kind !== 'group' || !mention.group) continue;
      if (inboxReadIds.has(mentionReadKey(mention))) continue;
      counts[mention.group.id] = (counts[mention.group.id] ?? 0) + 1;
    }
    return counts;
  }, [inboxReadIds, mentionNotifications]);

  useEffect(() => {
    setInboxUnreadCount(computedInboxUnreadCount);
  }, [computedInboxUnreadCount]);

  useEffect(() => {
    void window.notoc?.setUnreadBadge?.(inboxUnreadCount);
  }, [inboxUnreadCount]);

  useEffect(() => () => {
    void window.notoc?.setUnreadBadge?.(0);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);

  const desktopIcons = useMemo(
    () => {
      const builtinIcons = [
      { id: 'messenger' as const, letters: 'M', label: t(language, 'messenger'), iconType: 'messenger' },
      { id: 'inbox' as const, letters: 'IN', label: language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail', iconType: 'inbox', badgeCount: inboxUnreadCount },
      { id: 'watchTogether' as const, letters: 'WT', label: t(language, 'watchTogether'), iconType: 'watch-together' },
      { id: 'aiChat' as const, letters: 'AI', label: t(language, 'aiChat'), iconType: 'ai-chat' },
      { id: 'updates' as const, letters: '*', label: t(language, 'updates'), iconType: 'updates' }
      ];
      return builtinIcons;
    },
    [inboxUnreadCount, language]
  );

  const iconMetrics = ICON_METRICS[user.desktopIconSize] ?? ICON_METRICS.medium;

  async function loadConnections() {
    setConnectionsLoading(true);
    setConnectionsStatus('');
    try {
      const payload = await api.getConnections(token);
      setConnections(payload.connections);
      setConnectionVisibilityDraft(connectionVisibilityFromConnections(payload.connections));
      setSpotifyConfigured(payload.spotifyConfigured);
      setRiotConfigured(payload.riotConfigured);
      const riot = payload.connections.find((connection) => connection.provider === 'riot' && connection.connected);
      if (riot) {
        const meta = riot.metadata ?? {};
        const [name, tag = ''] = riot.displayName.split('#');
        setRiotGameName(typeof meta.gameName === 'string' ? meta.gameName : name);
        setRiotTagLine(typeof meta.tagLine === 'string' ? meta.tagLine : tag);
        setRiotRegion(typeof meta.region === 'string' ? meta.region : 'euw1');
      }
    } catch (error) {
      setConnectionsStatus(getErrorMessage(error, language));
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function connectSpotify() {
    setConnectionsStatus('');
    if (!spotifyConfigured) {
      setConnectionsStatus('Spotify is not configured on the server. Check SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REDIRECT_URI in Railway variables, then redeploy the server.');
      return;
    }
    try {
      const payload = await api.startSpotifyConnection(token);
      window.open(payload.url, '_blank', 'noopener,noreferrer,width=620,height=760');
      window.setTimeout(() => void loadConnections(), 2500);
      window.setTimeout(() => void loadConnections(), 7000);
    } catch (error) {
      setConnectionsStatus(getErrorMessage(error, language));
    }
  }

  async function connectRiot() {
    setConnectionsStatus('');
    if (!riotConfigured) {
      setConnectionsStatus('Riot is not configured on the server. Check RIOT_API_KEY in Railway variables, then redeploy the server.');
      return;
    }
    try {
      const payload = await api.connectRiot(token, {
        gameName: riotGameName.trim(),
        tagLine: riotTagLine.trim().replace(/^#/, ''),
        region: riotRegion
      });
      setConnections((current) => [payload.connection, ...current.filter((connection) => connection.provider !== 'riot')]);
      setConnectionVisibilityDraft((current) => ({ ...current, riot: readConnectionVisibility(payload.connection) }));
    } catch (error) {
      setConnectionsStatus(getErrorMessage(error, language));
    }
  }

  async function disconnectProvider(provider: 'spotify' | 'riot') {
    setConnectionsStatus('');
    try {
      await api.disconnectConnection(token, provider);
      setConnections((current) => current.filter((connection) => connection.provider !== provider));
      setConnectionVisibilityDraft((current) => ({ ...current, [provider]: { showProfile: true, showActivity: true } }));
    } catch (error) {
      setConnectionsStatus(getErrorMessage(error, language));
    }
  }

  function updateConnectionVisibility(provider: ConnectionProvider, patch: { showProfile?: boolean; showActivity?: boolean }) {
    setConnectionsStatus('');
    setConnectionVisibilityDraft((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch }
    }));
  }

  // Restore every settings draft to the persisted user values. Used both when
  // `user` changes and when the user clicks "Reset" in the save bar.
  function resetSettingsDrafts() {
    setNicknameDraft(user.nickname);
    setNameStyleDraft(user.nameStyle ?? null);
    setProfilePrimaryDraft(user.profilePrimaryColor || '#2AABEE');
    setProfileAccentDraft(user.profileAccentColor || '#5865F2');
    setNameplateDraft(user.nameplate ?? DEFAULT_NAMEPLATE);
    setStatusDraft(customEmojiToShortcodes(user.status ?? ''));
    setAvatarDraft(user.avatarData);
    setWallpaperDraft(user.wallpaper);
    setLanguageDraft(user.language);
    setThemeDraft(user.theme);
    setAccentColorDraft(user.accentColor);
    setTransparencyDraft(user.transparencyEnabled);
    setIconSizeDraft(user.desktopIconSize);
    setHideIconsDraft(user.hideDesktopIcons);
    setAllowGroupIdentityMessagesDraft(user.allowGroupIdentityMessages ?? true);
    setConnectionVisibilityDraft(connectionVisibilityFromConnections(connections));
    setTimeFormat(getSavedTimeFormat());
    setTranslateTarget(getSavedTranslateTarget());
    setComposerTranslateTarget(getSavedComposerTranslateTarget());
    applyAppearanceToDocument(user.theme, user.accentColor, user.transparencyEnabled);
  }

  function updateThemeDraftWithWave(nextTheme: Theme) {
    if (nextTheme === themeDraft) return;

    runThemeWaveTransition(() => {
      flushSync(() => setThemeDraft(nextTheme));
      applyAppearanceToDocument(nextTheme, accentColorDraft, transparencyDraft);
    });
  }

  useEffect(() => {
    setNicknameDraft(user.nickname);
    setNameStyleDraft(user.nameStyle ?? null);
    setProfilePrimaryDraft(user.profilePrimaryColor || '#2AABEE');
    setProfileAccentDraft(user.profileAccentColor || '#5865F2');
    setNameplateDraft(user.nameplate ?? DEFAULT_NAMEPLATE);
    setAvatarDraft(user.avatarData);
    setWallpaperDraft(user.wallpaper);
    setLanguageDraft(user.language);
    setThemeDraft(user.theme);
    setAccentColorDraft(user.accentColor);
    setTransparencyDraft(user.transparencyEnabled);
    setIconSizeDraft(user.desktopIconSize);
    setHideIconsDraft(user.hideDesktopIcons);
    setAllowGroupIdentityMessagesDraft(user.allowGroupIdentityMessages ?? true);
    setPinnedCards(Array.isArray(user.pinnedCards) ? user.pinnedCards : []);
    setIconPositions(() => {
      const normalized = normalizeIconPositions(user.desktopIcons);
      const bounds = desktopRef.current?.getBoundingClientRect();
      const metrics = ICON_METRICS[user.desktopIconSize] ?? ICON_METRICS.medium;
      return bounds ? snapDesktopIconPositions(normalized, metrics, bounds) : normalized;
    });
  }, [user.accentColor, user.allowGroupIdentityMessages, user.avatarData, user.desktopIconSize, user.desktopIcons, user.hideDesktopIcons, user.language, user.nickname, user.nameStyle, user.pinnedCards, user.profilePrimaryColor, user.profileAccentColor, user.theme, user.transparencyEnabled, user.wallpaper]);

  useEffect(() => {
    if (settingsWindow !== 'open') return;
    applyAppearanceToDocument(themeDraft, accentColorDraft, transparencyDraft);
  }, [settingsWindow, themeDraft, accentColorDraft, transparencyDraft]);

  useEffect(() => {
    if (settingsWindow !== 'open' || activeTab !== 'connections') return;
    void loadConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsWindow, activeTab, token]);

  const savedStatusDraft = customEmojiToShortcodes(user.status ?? '').trim();
  const connectionVisibilityDirty = connections.some((connection) => connection.connected && connectionVisibilityIsDirty(connection, connectionVisibilityDraft));

  // True when any settings draft differs from the persisted user values.
  const settingsDirty =
    nicknameDraft.trim() !== user.nickname ||
    statusDraft.trim() !== savedStatusDraft ||
    avatarDraft !== user.avatarData ||
    wallpaperDraft !== user.wallpaper ||
    languageDraft !== user.language ||
    themeDraft !== user.theme ||
    accentColorDraft !== user.accentColor ||
    transparencyDraft !== user.transparencyEnabled ||
    iconSizeDraft !== user.desktopIconSize ||
    hideIconsDraft !== user.hideDesktopIcons ||
    allowGroupIdentityMessagesDraft !== (user.allowGroupIdentityMessages ?? true) ||
    nameStyleIsDirty(nameStyleDraft ?? null, user.nameStyle ?? null) ||
    profilePrimaryDraft !== (user.profilePrimaryColor || '#2AABEE') ||
    profileAccentDraft !== (user.profileAccentColor || '#5865F2') ||
    // Compare nameplate field-by-field to avoid JSON.stringify on every render.
    nameplateIsDirty(nameplateDraft, user.nameplate ?? DEFAULT_NAMEPLATE) ||
    timeFormat !== getSavedTimeFormat() ||
    translateTarget !== getSavedTranslateTarget() ||
    composerTranslateTarget !== getSavedComposerTranslateTarget() ||
    connectionVisibilityDirty;

  // Close the settings window, shaking the relevant save bar if there are
  // unsaved edits (either the main settings draft or the Voice tab).
  function requestCloseSettingsWindow() {
    if (activeTab === 'voice' && voiceDirtyRef.current) {
      window.dispatchEvent(new CustomEvent('notoc:voiceSettingsShake'));
      return;
    }
    if (settingsDirty) {
      setSettingsBarShake((n) => n + 1);
      return;
    }
    setSettingsWindow('closed');
  }

  useEffect(() => {
    let alive = true;
    setMusicTracks([]);
    setCurrentTrackIndex(0);
    setMusicPlaying(false);
    audioRef.current?.pause();

    void getMusicTracks(user.id).then((tracks) => {
      if (alive) setMusicTracks(tracks);
    });

    return () => {
      alive = false;
    };
  }, [token, user.id]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = musicVolume;
  }, [musicVolume]);

  useEffect(() => {
    function handleOpenProfile(event: CustomEvent<PublicUser>) {
      setProfileModalUser(event.detail);
      setProfileAnchor(null);
    }
    window.addEventListener('open-profile', handleOpenProfile as EventListener);
    return () => window.removeEventListener('open-profile', handleOpenProfile as EventListener);
  }, []);

  // Show the What's New popup once after login whenever a newer update exists.
  useEffect(() => {
    if (notice) return; // let the security notice be dismissed first
    if (hasUnseenUpdate()) {
      setUpdatesInitialId(LATEST_UPDATE_ID);
      setUpdatesWindowOpen(true);
    }
  }, [notice]);

  useEffect(() => {
    const audio = audioRef.current;
    const track = musicTracks[currentTrackIndex];
    if (!audio) return;
    if (!track) {
      audio.removeAttribute('src');
      audio.load();
      setMusicTime(0);
      setMusicDuration(0);
      return;
    }
    if (audio.getAttribute('src') === track.dataUrl) return;
    audio.src = track.dataUrl;
    setMusicTime(0);
    setMusicDuration(0);
  }, [currentTrackIndex, musicTracks]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (musicPlaying) void audio.play().catch(() => setMusicPlaying(false));
    else audio.pause();
  }, [musicPlaying, currentTrackIndex]);

  useEffect(() => {
    if (!volumeOpen) return;

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (playerRef.current?.contains(event.target as Node)) return;
      setVolumeOpen(false);
    }

    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, [volumeOpen]);

  const bringToFront = useCallback((windowName: keyof typeof windowZ) => {
    setNextZ((current) => {
      const zIndex = current + 1;
      setWindowZ((value) => ({ ...value, [windowName]: zIndex }));
      return zIndex;
    });
  }, []);

  function pushNotification(notification: Omit<DesktopNotification, 'id'>) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setNotifications((current) => [...current.slice(-3), { id, ...notification }]);
    window.setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== id)), 5200);
  }

  // "Remind me about this message" fires from the messenger over a window
  // event so the toast shows even when the messenger window is closed.
  useEffect(() => {
    function onMessageReminder(event: Event) {
      const detail = (event as CustomEvent<{ title?: string; body?: string }>).detail;
      if (!detail) return;
      pushNotification({
        title: detail.title ?? (language === 'ru' ? 'Напоминание' : 'Reminder'),
        message: detail.body || (language === 'ru' ? 'Сообщение' : 'Message')
      });
    }
    window.addEventListener('notoc:message-reminder', onMessageReminder);
    return () => window.removeEventListener('notoc:message-reminder', onMessageReminder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;

    const onLocalEmojiBurst = (event: Event) => {
      const detail = (event as CustomEvent<EmojiBurstEventDetail>).detail;
      if (!detail) return;
      socket.emit('emoji:burst', detail);
    };
    const onRemoteEmojiBurst = (detail: EmojiBurstEventDetail) => {
      playEmojiBurst(detail);
    };

    window.addEventListener(EMOJI_BURST_EVENT, onLocalEmojiBurst as EventListener);
    socket.on('emoji:burst', onRemoteEmojiBurst);

    return () => {
      window.removeEventListener(EMOJI_BURST_EVENT, onLocalEmojiBurst as EventListener);
      socket.off('emoji:burst', onRemoteEmojiBurst);
    };
  }, [sharedSocket]);

  // Register socket event listeners on the shared socket from SocketProvider.
  // No longer creates its own io() connection вЂ” that is handled by SocketProvider.
  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;

    function onReady() {
      socket!.emit('desktop:screen', { width: window.innerWidth, height: window.innerHeight });
      const cards = pinnedCardsRef.current;
      if (!cards.length) return;
      broadcastPinnedCards(cards.map(currentCardPlacement), true);
    }

    function onWatchers(payload: { ownerId: string; count: number }) {
      if (payload.ownerId === user.id) setDesktopWatcherCount(payload.count);
    }

    function onCursor(payload: { ownerId: string; userId: string; nickname: string; x: number; y: number }) {
      if (payload.ownerId !== user.id || payload.userId === user.id) return;
      setViewerCursors((current) => ({ ...current, [payload.userId]: { nickname: payload.nickname, x: payload.x, y: payload.y } }));
    }

    function onCursorLeave(payload: { ownerId: string; userId: string }) {
      if (payload.ownerId !== user.id) return;
      setViewerCursors((current) => {
        if (!(payload.userId in current)) return current;
        const next = { ...current };
        delete next[payload.userId];
        return next;
      });
    }

    function onSettingsChanged(payload: { user: PublicUser }) {
      cacheUser(payload.user);
      onUserChange(payload.user);
      setPinnedCards(Array.isArray(payload.user.pinnedCards) ? payload.user.pinnedCards : []);
    }

    function onUserChanged(payload: { user: PublicUser }) {
      cacheUser(payload.user);
      setRemoteDesktopUser((current) => (current?.id === payload.user.id ? payload.user : current));
    }

    function onMessengerMessage(payload: { message: MessengerMessage }) {
      if (payload.message.senderId === user.id) return;
      if (messengerWindow === 'open' && activeChatUserId === payload.message.senderId) return;
      if (userStatus.status === 'dnd') return;
      void getOrFetchUser(payload.message.senderId, (id) =>
        api.getPublicUser(token, id).then((r) => r.user)
      ).then((sender) => {
        const callLabel = callMessageLabel(payload.message, user.id, language);
        pushNotification({
          title: t(language, 'newMessage'),
          message: `${sender.nickname}: ${callLabel ? `\u{1F4DE} ${callLabel}` : notificationMessage(payload.message, language)}`,
          avatarData: sender.avatarData,
          onOpen: () => openMessengerChat(payload.message.senderId)
        });
      });
    }

    function onMessengerMention(payload: MentionSocketPayload) {
      const message = payload.message;
      const mention: MentionNotification = {
        id: `${payload.kind}:${message.id}`,
        kind: payload.kind,
        messageId: message.id,
        createdAt: message.createdAt,
        sender: payload.sender,
        body: message.body,
        imageData: message.imageData,
        imageName: message.imageName,
        group: payload.kind === 'group' ? payload.group : undefined,
        channelId: payload.kind === 'group' ? payload.message.channelId : null
      };
      setMentionNotifications((current) => {
        if (current.some((item) => item.id === mention.id)) return current;
        return [mention, ...current].slice(0, 100);
      });

      if (payload.kind !== 'group') return;
      if (messengerWindow === 'open' && activeChatGroupId === payload.group.id) return;
      if (userStatus.status === 'dnd') return;
      pushNotification({
        title: payload.group.name,
        message: `${payload.sender.nickname}: ${notificationMessage(payload.message, language)}`,
        avatarData: payload.group.avatarData || payload.sender.avatarData,
        onOpen: () => openMessengerGroup(payload.group, payload.message.channelId)
      });
    }

    function onPresenceSnapshot(payload: PresenceSnapshotPayload) {
      const next = normalizePresenceSnapshot(payload);
      setPresenceStatuses(next);
      setOnlineUserIds(onlineIdsFromPresence(next));
    }

    function onCallIncoming(payload: { callId: string; callerId: string; callerNickname: string }) {
      void getOrFetchUser(payload.callerId, (id) =>
        api.getPublicUser(token, id).then((r) => r.user)
      ).then((caller) => {
        if (dismissedCallsRef.current.has(payload.callId)) return;
        setIncomingCallToast({ callId: payload.callId, caller });
      }).catch(() => undefined);
    }

    const dismissCallToast = (payload?: { callId?: string }) => {
      if (payload?.callId) {
        if (dismissedCallsRef.current.size > 100) dismissedCallsRef.current.clear();
        dismissedCallsRef.current.add(payload.callId);
      }
      setIncomingCallToast((current) => {
        if (!current) return null;
        if (payload?.callId && current.callId !== payload.callId) return current;
        return null;
      });
    };

    function onPresenceChanged(payload: PresenceChangedPayload) {
      setPresenceStatuses((current) => {
        const next = applyPresenceChange(current, payload);
        setOnlineUserIds(onlineIdsFromPresence(next));
        return next;
      });
    }

    socket.on('system:ready', onReady);
    socket.on('desktop:watchers', onWatchers);
    socket.on('desktop:cursor', onCursor);
    socket.on('desktop:cursorLeave', onCursorLeave);
    socket.on('desktop:settingsChanged', onSettingsChanged);
    socket.on('desktop:userChanged', onUserChanged);
    socket.on('messenger:message', onMessengerMessage);
    socket.on('messenger:mention', onMessengerMention);
    socket.on('presence:snapshot', onPresenceSnapshot);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:ended', dismissCallToast);
    socket.on('call:accepted', dismissCallToast);
    socket.on('presence:changed', onPresenceChanged);
    socket.emit('presence:getSnapshot');

    // Emit screen size immediately in case 'system:ready' already fired.
    socket.emit('desktop:screen', { width: window.innerWidth, height: window.innerHeight });

    return () => {
      socket.off('system:ready', onReady);
      socket.off('desktop:watchers', onWatchers);
      socket.off('desktop:cursor', onCursor);
      socket.off('desktop:cursorLeave', onCursorLeave);
      socket.off('desktop:settingsChanged', onSettingsChanged);
      socket.off('desktop:userChanged', onUserChanged);
      socket.off('messenger:message', onMessengerMessage);
      socket.off('messenger:mention', onMessengerMention);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:ended', dismissCallToast);
      socket.off('call:accepted', dismissCallToast);
      socket.off('presence:changed', onPresenceChanged);
    };
  }, [activeChatGroupId, activeChatUserId, language, messengerWindow, onUserChange, sharedSocket, token, user.id, userStatus.status]);

  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;

    function onInboxWallCreated(payload: { ownerId: string; message: DesktopWallMessage }) {
      if (payload.ownerId !== user.id || payload.message.author.id === user.id) return;
      setInboxWallMessages((current) => (
        current.some((message) => message.id === payload.message.id)
          ? current
          : [payload.message, ...current].slice(0, 40)
      ));
    }

    function onInboxWallDeleted(payload: { ownerId: string; messageId: string }) {
      if (payload.ownerId !== user.id) return;
      setInboxWallMessages((current) => current.filter((message) => message.id !== payload.messageId));
    }

    function onInboxFriendsChanged(payload: { requests: FriendRequests }) {
      setInboxRequests(payload.requests);
    }

    socket.on('desktopWall:messageCreated', onInboxWallCreated);
    socket.on('desktopWall:messageDeleted', onInboxWallDeleted);
    socket.on('messenger:friendsChanged', onInboxFriendsChanged);

    return () => {
      socket.off('desktopWall:messageCreated', onInboxWallCreated);
      socket.off('desktopWall:messageDeleted', onInboxWallDeleted);
      socket.off('messenger:friendsChanged', onInboxFriendsChanged);
    };
  }, [sharedSocket, user.id]);

  useEffect(() => {
    if (desktopWatcherCount <= 0) return;
    let lastSent = 0;
    function handleMove(event: globalThis.MouseEvent) {
      const now = Date.now();
      if (now - lastSent < 40) return;
      lastSent = now;
      socketRef.current?.emit('desktop:cursor', { ownerId: user.id, x: event.clientX / Math.max(1, window.innerWidth), y: event.clientY / Math.max(1, window.innerHeight) });
    }
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [desktopWatcherCount, user.id]);

  useEffect(() => {
    let timer = 0;
    const sizeKey = `notoc.desktop.size.${user.id}`;
    const persistSize = (size: { width: number; height: number }) => {
      iconRefSizeRef.current = size;
      try { localStorage.setItem(sizeKey, JSON.stringify(size)); } catch { /* ignore */ }
    };

    // Rescale every icon's x/y from the reference size to the current desktop
    // size so the layout stays proportional across window sizes.
    function rescaleIcons() {
      const rect = desktopRef.current?.getBoundingClientRect();
      const prev = iconRefSizeRef.current;
      if (!rect || rect.width <= 0 || rect.height <= 0 || !prev) return;
      if (rect.width === prev.width && rect.height === prev.height) return;
      const sx = rect.width / prev.width;
      const sy = rect.height / prev.height;
      persistSize({ width: rect.width, height: rect.height });
      setIconPositions((current) => {
        const next: PublicUser['desktopIcons'] = { ...current };
        for (const [id, pos] of Object.entries(current)) {
          if (!pos) continue;
          next[id] = { ...pos, ...snapDesktopIconPosition(pos.x * sx, pos.y * sy, iconMetrics, rect) };
        }
        return next;
      });
    }

    // On mount: if the desktop opens at a different size than positions were
    // last saved at (e.g. saved fullscreen, reopened in a small window),
    // rescale once so nothing lands off-screen.
    const rect = desktopRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      let savedSize: { width: number; height: number } | null = null;
      try { savedSize = JSON.parse(localStorage.getItem(sizeKey) ?? 'null'); } catch { /* ignore */ }
      if (savedSize && savedSize.width > 0 && savedSize.height > 0
        && (savedSize.width !== rect.width || savedSize.height !== rect.height)) {
        iconRefSizeRef.current = savedSize;
        rescaleIcons();
      } else {
        persistSize({ width: rect.width, height: rect.height });
        setIconPositions((current) => snapDesktopIconPositions(current, iconMetrics, rect));
      }
    }

    function handleResize() {
      rescaleIcons();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        socketRef.current?.emit('desktop:screen', { width: window.innerWidth, height: window.innerHeight });
      }, 200);
    }
    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [iconMetrics, user.id]);

  function openContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    // Do not open the desktop menu when a blocking modal/window is in front.
    // The settings window is a draggable, non-blocking window, so right-clicking
    // the desktop background should still open the desktop menu.
    if (updatesWindowOpen || profileModalUser || notice) return;
    const target = event.target as HTMLElement;
    if (target.closest('.window-frame, .messenger-window, .remote-desktop-window, .modal-backdrop, .desktop-wall-shell, .taskbar')) return;
    setContextMenu({
      type: 'desktop',
      x: Math.min(event.clientX, window.innerWidth - 250),
      y: Math.min(event.clientY, window.innerHeight - 160)
    });
  }

  function canDropIconOnDesktop(target: Element | null) {
    return Boolean(target?.closest('.desktop')) && !target?.closest('.window-frame, .messenger-window, .remote-desktop-window, .desktop-wall-shell, .taskbar');
  }

  function finishIconDrag(currentDrag: IconDragState, clientX: number, clientY: number) {
    const dx = clientX - currentDrag.startX;
    const dy = clientY - currentDrag.startY;
    const nextPositions = { ...iconPositions };
    const bounds = desktopRef.current?.getBoundingClientRect();

    for (const id of currentDrag.ids) {
      const base = currentDrag.basePositions[id];
      if (!base) continue;
      nextPositions[id] = {
        ...nextPositions[id],
        ...snapDesktopIconPosition(base.x + dx, base.y + dy, iconMetrics, bounds)
      };
    }

    // Apply the final left/top and clear the transform offset in the same
    // batched update, then drop the drag state. Clearing dragDelta before
    // removing the dragging flag avoids a one-frame mismatch where the tile
    // still has a translate offset while transitions are re-enabled, which is
    // what caused the icon to "fly" to the drop position.
    setIconPositions(nextPositions);
    setDragDelta({ x: 0, y: 0 });
    setDragState(null);

    const dropTarget = clientX || clientY ? document.elementFromPoint(clientX, clientY) : null;
    const droppedOnDesktop = canDropIconOnDesktop(dropTarget);
    if (droppedOnDesktop && (currentDrag.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      void api.updateMe(token, { desktopIcons: nextPositions }).then((result) => onUserChange(result.user));
    }
  }

  useEffect(() => {
    if (!dragState) return;
    const currentDrag = dragState;

    function move(event: globalThis.MouseEvent) {
      const dx = event.clientX - currentDrag.startX;
      const dy = event.clientY - currentDrag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        setDragState((current) => (current && !current.moved ? { ...current, moved: true } : current));
      }
      setDragDelta({ x: dx, y: dy });
    }

    function up(event: globalThis.MouseEvent) {
      finishIconDrag(currentDrag, event.clientX, event.clientY);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragState, iconMetrics, iconPositions, onUserChange, token]);

  useEffect(() => {
    if (!selectionStart) return;
    const start = selectionStart;

    function move(event: globalThis.MouseEvent) {
      const bounds = desktopRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const currentX = event.clientX - bounds.left;
      const currentY = event.clientY - bounds.top;
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);
      setSelectionRect({ x, y, width, height });
      const selected = desktopIcons
        .filter((icon) =>
          rectsIntersect({ x, y, width, height }, {
            x: iconPositions[icon.id].x,
            y: iconPositions[icon.id].y,
            width: iconMetrics.width,
            height: iconMetrics.height
          })
        )
        .map((icon) => icon.id);
      setSelectedIconIds(selected);
    }

    function up() {
      if (selectionRect) {
        const selected = desktopIcons
          .filter((icon) =>
            rectsIntersect(selectionRect, {
              x: iconPositions[icon.id].x,
              y: iconPositions[icon.id].y,
              width: iconMetrics.width,
              height: iconMetrics.height
            })
          )
          .map((icon) => icon.id);
        setSelectedIconIds(selected);
      }

      setSelectionStart(null);
      setSelectionRect(null);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [desktopIcons, iconPositions, iconMetrics, selectionRect, selectionStart]);

  const selectSettingsTab = useCallback((tab: SettingsTab, push = true) => {
    setActiveTab(tab);
    if (push) {
      setSettingsNav((nav) => {
        const current = nav.entries[nav.index];
        if (current === tab) return nav;
        return {
          entries: [...nav.entries.slice(0, nav.index + 1), tab],
          index: nav.index + 1
        };
      });
    }
    window.requestAnimationFrame(() => {
      settingsContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  function navigateSettingsHistory(delta: -1 | 1) {
    const nextIndex = settingsNav.index + delta;
    if (nextIndex < 0 || nextIndex >= settingsNav.entries.length) return;
    const tab = settingsNav.entries[nextIndex];
    setSettingsNav((nav) => ({ ...nav, index: nextIndex }));
    selectSettingsTab(tab, false);
  }

  function scrollToSettingsHeading(id: string) {
    const root = settingsContentRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-settings-heading="${id}"]`);
    if (!target) return;
    root.scrollTo({
      top: Math.max(0, target.offsetTop - root.offsetTop - 12),
      behavior: 'smooth'
    });
    setHighlightSettingsHeading(null);
    window.setTimeout(() => setHighlightSettingsHeading(id), 20);
    window.setTimeout(() => setHighlightSettingsHeading((current) => current === id ? null : current), 900);
  }

  function settingsHeadingClass(id: string, base = '') {
    return [base, highlightSettingsHeading === id ? 'settings-heading-flash' : ''].filter(Boolean).join(' ');
  }

  function renderSettingsHeadingLinks(tab: SettingsTab) {
    if (activeTab !== tab) return null;
    const headings = SETTINGS_HEADINGS[tab] ?? [];
    if (!headings.length) return null;
    return (
      <div className="settings-heading-links">
        {headings.map((heading) => (
          <button key={heading.id} type="button" onClick={() => scrollToSettingsHeading(heading.id)}>
            {t(language, heading.labelKey)}
          </button>
        ))}
      </div>
    );
  }

  const openSettings = useCallback((tab: SettingsTab) => {
    selectSettingsTab(tab);
    setSettingsError('');
    setSettingsWindow('open');
    bringToFront('settings');
    setContextMenu(null);
  }, [bringToFront, selectSettingsTab]);

  const openMessenger = useCallback(() => {
    setMessengerWindow('open');
    bringToFront('messenger');
  }, [bringToFront]);

  const openInbox = useCallback(() => {
    setInboxWindow('open');
    bringToFront('inbox');
  }, [bringToFront]);

  const openUpdates = useCallback(() => {
    setUpdatesInitialId(null);
    setUpdatesWindowOpen(true);
  }, []);

  function closeUpdates() {
    setUpdatesWindowOpen(false);
    markUpdatesSeen();
  }

  function openMessengerChat(userId: string) {
    setMessengerChatRequest((current) => ({ userId, requestId: (current?.requestId ?? 0) + 1 }));
    setMessengerWindow('open');
    bringToFront('messenger');
  }

  function openMessengerGroup(group: Group, channelId: string | null = null) {
    setMessengerGroupRequest((current) => ({ groupId: group.id, group, channelId, requestId: (current?.requestId ?? 0) + 1 }));
    setMessengerWindow('open');
    bringToFront('messenger');
  }

  const markGroupMentionsRead = useCallback((groupId: string) => {
    setInboxReadIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const mention of mentionNotifications) {
        if (mention.kind === 'group' && mention.group?.id === groupId && !next.has(mentionReadKey(mention))) {
          next.add(mentionReadKey(mention));
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [mentionNotifications]);

  const openAiChat = useCallback(() => {
    setAiChatWindow('open');
    bringToFront('aiChat');
  }, [bringToFront]);

  const openWatchTogether = useCallback((inviteCode?: string) => {
    if (inviteCode) {
      setWatchTogetherInvite({ code: inviteCode, requestId: Date.now() });
    }
    setWatchTogetherWindow('open');
    bringToFront('watchTogether');
  }, [bringToFront]);

  function makeCardId() {
    return crypto.randomUUID ? crypto.randomUUID() : `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Compute the live placement (relative position + pixel size) of a card from
  // its own localStorage entries, falling back to the persisted card values.
  function currentCardPlacement(card: PinnedCard): PinnedCard {
    let x = card.x;
    let y = card.y;
    try {
      const saved = JSON.parse(localStorage.getItem(`notoc.pinned-image-pos.${card.id}`) ?? 'null');
      if (saved && typeof saved.relX === 'number' && typeof saved.relY === 'number') {
        x = saved.relX;
        y = saved.relY;
      }
    } catch {}
    let width = card.width;
    let height = card.height;
    try {
      const saved = JSON.parse(localStorage.getItem(`notoc.pinned-image-size.${card.id}`) ?? 'null');
      if (saved && typeof saved.width === 'number' && typeof saved.height === 'number') {
        width = saved.width;
        height = saved.height;
      }
    } catch {}
    return { ...card, x, y, width, height };
  }

  function broadcastPinnedCards(cards: PinnedCard[], force = false) {
    const now = Date.now();
    if (!force && now - pinnedBroadcastRef.current < 40) return;
    pinnedBroadcastRef.current = now;
    // Only the placement is needed by watchers (the media comes from the
    // persisted user). Stripping the (potentially huge) base64 imageData here
    // is critical: otherwise every drag tick would serialize hundreds of MB
    // over the socket and freeze the whole app.
    const placements = cards.map((card) => ({ id: card.id, x: card.x, y: card.y, width: card.width, height: card.height, kind: card.kind }));
    socketRef.current?.emit('desktop:pinnedCards', { cards: placements });
  }

  function cardPositionFromPoint(point: { x: number; y: number } | null, width: number, height: number) {
    const bounds = desktopRef.current?.getBoundingClientRect();
    const px = bounds ? point?.x ?? bounds.left + 120 : point?.x ?? 120;
    const py = bounds ? point?.y ?? bounds.top + 120 : point?.y ?? 120;
    const x = bounds ? Math.min(0.92, Math.max(0.02, (px - bounds.left) / Math.max(1, bounds.width))) : 0.08;
    const y = bounds ? Math.min(0.86, Math.max(0.04, (py - bounds.top) / Math.max(1, bounds.height))) : 0.12;
    return { x, y, width, height };
  }

  async function addDesktopWidgetFromFile(file: File | undefined, kind: 'image' | 'video') {
    if (!file) return;
    const mimeType = inferMimeType(file);
    if (kind === 'image' && !mimeType.startsWith('image/')) return;
    if (kind === 'video' && !mimeType.startsWith('video/')) return;
    if (file.size > maxImportSizeForFile(file)) {
      window.alert(getErrorMessage(new Error(t(language, 'fileTooLarge')), language));
      return;
    }

    beginOrUpdateUpload(0.05);
    const previous = pinnedCardsRef.current;
    try {
      const dataUrl = dataUrlWithMime(await readFileAsDataUrl(file, (fraction) => beginOrUpdateUpload(Math.min(0.9, Math.max(0.05, fraction * 0.9)))), mimeType);
      const size = kind === 'video' ? { width: 260, height: 170 } : { width: 220, height: 170 };
      const newCard: PinnedCard = {
        id: makeCardId(),
        imageData: dataUrl,
        name: file.name,
        kind,
        ...cardPositionFromPoint(widgetDropPointRef.current, size.width, size.height)
      };
      const next = [...previous, newCard];
      setPinnedCards(next);
      const result = await api.updateMe(token, { pinnedCards: next });
      onUserChange(result.user);
      broadcastPinnedCards(next.map(currentCardPlacement), true);
      finishUpload();
    } catch (error) {
      finishUpload();
      setPinnedCards(previous);
      window.alert(getErrorMessage(error, language));
    } finally {
      widgetDropPointRef.current = null;
    }
  }

  function chooseDesktopWidget(kind: 'image' | 'video', point: { x: number; y: number }) {
    widgetDropPointRef.current = point;
    setContextMenu(null);
    const input = kind === 'image' ? widgetPhotoInputRef.current : widgetVideoInputRef.current;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  // A single card moved/resized: broadcast the new placement of every card.
  // On move-end (persist=true) the new positions are saved to the DB.
  function handleCardMove(cardId: string, placement: { x: number; y: number; width: number; height: number }, persist = false) {
    const next = pinnedCardsRef.current.map((card) =>
      card.id === cardId ? { ...card, ...placement } : currentCardPlacement(card)
    );
    broadcastPinnedCards(next, persist);
    if (persist) {
      setPinnedCards(next);
      void api.updateMe(token, { pinnedCards: next }).then((result) => onUserChange(result.user));
    }
  }

  function unpinCard(cardId: string) {
    const previous = pinnedCards;
    const next = previous.filter((card) => card.id !== cardId);
    setPinnedCards(next);
    localStorage.removeItem(`notoc.pinned-image-pos.${cardId}`);
    localStorage.removeItem(`notoc.pinned-image-size.${cardId}`);
    broadcastPinnedCards(next.map(currentCardPlacement), true);
    api.updateMe(token, { pinnedCards: next })
      .then((result) => onUserChange(result.user))
      .catch(() => setPinnedCards(previous));
  }

  async function applyDesktopView(nextSize: DesktopIconSize) {
    setIconSizeDraft(nextSize);
    const nextMetrics = ICON_METRICS[nextSize] ?? ICON_METRICS.medium;
    const bounds = desktopRef.current?.getBoundingClientRect();
    const nextPositions = { ...iconPositions };
    [...desktopIcons]
      .sort((left, right) => {
        const leftPos = iconPositions[left.id] ?? DEFAULT_ICON_POSITIONS[left.id as keyof typeof DEFAULT_ICON_POSITIONS];
        const rightPos = iconPositions[right.id] ?? DEFAULT_ICON_POSITIONS[right.id as keyof typeof DEFAULT_ICON_POSITIONS];
        return (leftPos?.x ?? 0) - (rightPos?.x ?? 0) || (leftPos?.y ?? 0) - (rightPos?.y ?? 0) || left.label.localeCompare(right.label);
      })
      .forEach((icon, index) => {
        nextPositions[icon.id] = {
          ...nextPositions[icon.id],
          ...desktopGridPositionByIndex(index, nextMetrics, bounds)
        };
      });
    setIconPositions(nextPositions);
    const result = await api.updateMe(token, { desktopIconSize: nextSize, desktopIcons: nextPositions });
    onUserChange(result.user);
  }

  async function toggleHideDesktopIcons(nextValue: boolean) {
    setHideIconsDraft(nextValue);
    const result = await api.updateMe(token, { hideDesktopIcons: nextValue });
    onUserChange(result.user);
  }

  function sortedIcons(sortBy: DesktopSort) {
    const appOrder = { messenger: 0, inbox: 1, watchTogether: 2, updates: 3, aiChat: 4 };
    return [...desktopIcons].sort((left, right) => {
      const leftMeta = iconPositions[left.id];
      const rightMeta = iconPositions[right.id];
      if (sortBy === 'type') return (leftMeta?.itemType ?? 'app').localeCompare(rightMeta?.itemType ?? 'app') || left.label.localeCompare(right.label);
      if (sortBy === 'size') return (leftMeta?.size ?? appOrder[left.id as keyof typeof appOrder] ?? 0) - (rightMeta?.size ?? appOrder[right.id as keyof typeof appOrder] ?? 0);
      if (sortBy === 'date') return String(rightMeta?.updatedAt ?? '').localeCompare(String(leftMeta?.updatedAt ?? '')) || left.label.localeCompare(right.label);
      return left.label.localeCompare(right.label);
    });
  }

  async function applySort(sortBy: DesktopSort) {
    const metrics = ICON_METRICS[user.desktopIconSize] ?? ICON_METRICS.medium;
    const bounds = desktopRef.current?.getBoundingClientRect();
    const nextPositions = { ...iconPositions };
    sortedIcons(sortBy).forEach((icon, index) => {
      const position = desktopGridPositionByIndex(index, metrics, bounds);
      nextPositions[icon.id] = {
        ...nextPositions[icon.id],
        ...position
      };
    });
    setIconPositions(nextPositions);
    const result = await api.updateMe(token, { desktopIcons: nextPositions, desktopSort: sortBy });
    onUserChange(result.user);
  }

  async function removeTrack(id: string) {
    await deleteMusicTrack(user.id, id);
    setMusicTracks((current) => current.filter((track) => track.id !== id));
    setCurrentTrackIndex(0);
  }

  // Show/advance the thin top upload progress bar (fraction 0..1).
  function beginOrUpdateUpload(fraction: number) {
    if (uploadHideTimer.current) {
      window.clearTimeout(uploadHideTimer.current);
      uploadHideTimer.current = null;
    }
    setUploadProgress(Math.max(0, Math.min(1, fraction)));
  }

  // Snap the bar to 100% then fade it out shortly after.
  function finishUpload() {
    setUploadProgress(1);
    if (uploadHideTimer.current) window.clearTimeout(uploadHideTimer.current);
    uploadHideTimer.current = window.setTimeout(() => {
      setUploadProgress(null);
      uploadHideTimer.current = null;
    }, 450);
  }

  async function addTrackFromLocalFile(file: File | undefined) {
    if (!file) return;
    const mimeType = inferMimeType(file);
    if (!mimeType.startsWith('audio/')) return;
    if (file.size > MAX_IMPORTED_FILE_SIZE) {
      window.alert(getErrorMessage(new Error(t(language, 'fileTooLarge')), language));
      return;
    }
    beginOrUpdateUpload(0.05);
    try {
      const dataUrl = dataUrlWithMime(await readFileAsDataUrl(file, (fraction) => beginOrUpdateUpload(Math.min(0.9, Math.max(0.05, fraction * 0.9)))), mimeType);
      const storageItemId = `local-audio:${file.name}:${file.size}:${file.lastModified}`;
      const added = await addMusicTrack(user.id, { storageItemId, name: file.name, dataUrl });
      setMusicTracks((current) => [...current.filter((track) => track.storageItemId !== storageItemId), added]);
      finishUpload();
    } catch (error) {
      finishUpload();
      window.alert(getErrorMessage(error, language));
    }
  }

  function previousTrack() {
    setCurrentTrackIndex((index) => (musicTracks.length ? (index - 1 + musicTracks.length) % musicTracks.length : 0));
    setMusicPlaying(true);
  }

  function nextTrack() {
    setCurrentTrackIndex((index) => (musicTracks.length ? (index + 1) % musicTracks.length : 0));
    setMusicPlaying(true);
  }

  function toggleMusic() {
    const audio = audioRef.current;
    if (!audio || !musicTracks.length) return;
    if (musicPlaying) {
      audio.pause();
      setMusicPlaying(false);
      return;
    }
    void audio.play().then(() => setMusicPlaying(true)).catch(() => setMusicPlaying(false));
  }

  function seekMusic(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setMusicTime(value);
  }

  function pauseDesktopMusic() {
    audioRef.current?.pause();
    setMusicPlaying(false);
  }

  const openShortcut = useCallback(async (iconId: string) => {
    if (iconId === 'messenger') {
      openMessenger();
      return;
    }
    if (iconId === 'inbox') {
      openInbox();
      return;
    }
    if (iconId === 'aiChat') {
      openAiChat();
      return;
    }
    if (iconId === 'watchTogether') {
      openWatchTogether();
      return;
    }
    if (iconId === 'updates') {
      openUpdates();
      return;
    }
  }, [openAiChat, openInbox, openMessenger, openUpdates, openWatchTogether]);

  const handleDesktopIconMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>, iconId: string) => {
    const ids = selectedIconIds.includes(iconId) ? selectedIconIds : [iconId];
    setSelectedIconIds(ids);
    const basePositions = Object.fromEntries(
      ids.map((id) => [id, { x: iconPositions[id]?.x ?? 8, y: iconPositions[id]?.y ?? 8 }])
    );
    setDragState({
      ids,
      startX: event.clientX,
      startY: event.clientY,
      basePositions,
      moved: false
    });
    setDragDelta({ x: 0, y: 0 });
  }, [iconPositions, selectedIconIds]);

  const handleDesktopIconContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, iconId: string) => {
    setSelectedIconIds([iconId]);
    setContextMenu({ type: 'shortcut', iconId, x: event.clientX, y: event.clientY });
  }, []);

  const handleDesktopIconDoubleClick = useCallback((iconId: string) => {
    void openShortcut(iconId);
  }, [openShortcut]);

  async function saveSettings() {
    setSaving(true);
    setSettingsError('');
    const nextTheme = themeDraft;
    const nextAccent = accentColorDraft;
    const nextTransparency = transparencyDraft;
    const previousAppearance = {
      theme: user.theme,
      accentColor: user.accentColor,
      transparencyEnabled: user.transparencyEnabled
    };

    if (
      nextTheme !== user.theme ||
      nextAccent !== user.accentColor ||
      nextTransparency !== user.transparencyEnabled
    ) {
      applyAppearanceToDocument(nextTheme, nextAccent, nextTransparency);
    }

    try {
      const input: Parameters<typeof api.updateMe>[1] = {};
      const nextNickname = nicknameDraft.trim();
      const nextStatusDraft = statusDraft.trim();
      const statusChanged = nextStatusDraft !== customEmojiToShortcodes(user.status ?? '').trim();

      if (nextNickname !== user.nickname) input.nickname = nextNickname;
      if (statusChanged) input.status = expandCustomEmojiShortcodes(nextStatusDraft);
      if (avatarDraft !== user.avatarData) input.avatarData = avatarDraft;
      if (wallpaperDraft !== user.wallpaper) input.wallpaper = wallpaperDraft;
      if (languageDraft !== user.language) input.language = languageDraft;
      if (nextTheme !== user.theme) input.theme = nextTheme;
      if (nextAccent !== user.accentColor) input.accentColor = nextAccent;
      if (nextTransparency !== user.transparencyEnabled) input.transparencyEnabled = nextTransparency;
      if (iconSizeDraft !== user.desktopIconSize) input.desktopIconSize = iconSizeDraft;
      if (hideIconsDraft !== user.hideDesktopIcons) input.hideDesktopIcons = hideIconsDraft;
      if (allowGroupIdentityMessagesDraft !== (user.allowGroupIdentityMessages ?? true)) input.allowGroupIdentityMessages = allowGroupIdentityMessagesDraft;
      if (desktopIconsChanged(iconPositions, user.desktopIcons)) input.desktopIcons = iconPositions;
      if (nameStyleIsDirty(nameStyleDraft ?? null, user.nameStyle ?? null)) input.nameStyle = nameStyleDraft;
      if (profilePrimaryDraft !== (user.profilePrimaryColor || '#2AABEE')) input.profilePrimaryColor = profilePrimaryDraft;
      if (profileAccentDraft !== (user.profileAccentColor || '#5865F2')) input.profileAccentColor = profileAccentDraft;
      if (nameplateIsDirty(nameplateDraft, user.nameplate ?? DEFAULT_NAMEPLATE)) input.nameplate = nameplateDraft;

      if (Object.keys(input).length > 0) {
        const result = await api.updateMe(token, input);
        onUserChange(result.user);
      }
      for (const connection of connections) {
        if (!connection.connected || !connectionVisibilityIsDirty(connection, connectionVisibilityDraft)) continue;
        const payload = await api.updateConnectionVisibility(token, connection.provider, connectionVisibilityDraft[connection.provider]);
        if (payload.connection) {
          setConnections((current) => current.map((item) => (
            item.provider === connection.provider ? payload.connection! : item
          )));
          setConnectionVisibilityDraft((current) => ({
            ...current,
            [connection.provider]: readConnectionVisibility(payload.connection)
          }));
        }
      }
      saveTimeFormat(timeFormat);
      saveTranslateTarget(translateTarget);
      saveComposerTranslateTarget(composerTranslateTarget);
      // Language is applied through App state via onUserChange. A hard reload
      // here can leave the Electron shell on a white screen while boot caches
      // and sockets are being recreated.
    } catch (error) {
      applyAppearanceToDocument(previousAppearance.theme, previousAppearance.accentColor, previousAppearance.transparencyEnabled);
      setSettingsError(getErrorMessage(error, language));
    } finally {
      setSaving(false);
    }
  }

  function submitPremiumPayment() {
    const digits = cardNumberDraft.replace(/\D/g, '');
    const cvc = cardCvcDraft.replace(/\D/g, '');
    const validExpiry = /^(0[1-9]|1[0-2])\/\d{2}$/.test(cardExpiryDraft.trim());
    const valid = digits.length >= 13 && digits.length <= 19 && cardHolderDraft.trim().length >= 3 && validExpiry && cvc.length >= 3 && cvc.length <= 4;
    setPremiumStatus(t(language, valid ? 'premiumApproved' : 'premiumInvalid'));
  }

  async function handleImageUpload(file: File | undefined, kind: 'avatar' | 'wallpaper') {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setSettingsError(kind === 'avatar' ? t(language, 'invalidAvatarType') : t(language, 'imageMustBeWallpaper'));
      return;
    }

    if (kind === 'avatar' && file.size > 900_000) {
      setSettingsError(t(language, 'avatarTooLarge'));
      return;
    }

    if (kind === 'wallpaper' && file.size > 1_200_000) {
      setSettingsError(t(language, 'wallpaperTooLarge'));
      return;
    }

    try {
      const dataUrl = await readImageAsDataUrl(file);
      if (kind === 'avatar') setCropSource(dataUrl);
      else setWallpaperDraft(dataUrl);
      setSettingsError('');
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  // Upload an image / GIF for the user's nameplate (shown behind their card in
  // friend / group lists).
  async function handleNameplateUpload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSettingsError(t(language, 'imageMustBeWallpaper'));
      return;
    }
    if (file.size > 5_000_000) {
      setSettingsError(t(language, 'wallpaperTooLarge'));
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setNameplateDraft((current) => ({ ...current, type: 'image', image: dataUrl }));
      setSettingsError('');
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  async function chooseNativeImage(kind: 'avatar' | 'wallpaper') {
    try {
      const nativeImage = await openNativeImageFile();

      if (nativeImage) {
        if (kind === 'wallpaper' && nativeImage.dataUrl.length > 2_000_000) {
          setSettingsError(t(language, 'wallpaperTooLarge'));
          return;
        }
        if (kind === 'avatar') setCropSource(nativeImage.dataUrl);
        else setWallpaperDraft(nativeImage.dataUrl);
        setSettingsError('');
      } else {
        document.getElementById(kind === 'avatar' ? 'settings-avatar-file' : 'wallpaper-file')?.click();
      }
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  const openRemoteDesktopWindow = useCallback((owner: PublicUser) => {
    setRemoteDesktopUser(owner);
    setRemoteDesktopWindow('open');
    bringToFront('remoteDesktop');
  }, [bringToFront]);

  async function openRemoteDesktopById(remoteUserId: string) {
    try {
      const result = await api.getPublicUser(token, remoteUserId);
      openRemoteDesktopWindow(result.user);
    } catch (error) {
      window.alert(getErrorMessage(error, language));
    }
  }

  const viewRemoteDesktop = useCallback((owner: PublicUser) => {
    openRemoteDesktopWindow(owner);
  }, [openRemoteDesktopWindow]);

  const focusMessengerWindow = useCallback(() => bringToFront('messenger'), [bringToFront]);
  const closeMessengerWindow = useCallback(() => setMessengerWindow('closed'), []);
  const minimizeMessengerWindow = useCallback(() => setMessengerWindow('minimized'), []);
  const toggleMessengerMaximized = useCallback(() => setMessengerMaximized((value) => !value), []);
  const editProfileFromMessenger = useCallback(() => openSettings('profile'), [openSettings]);

  const messengerNode = useMemo(() => {
    if (messengerWindow === 'closed' && !ongoingCall && !pendingCallAccept) return null;
    return (
      <MessengerWindow
        token={token}
        language={language}
        currentUser={user}
        initialChatUserId={messengerChatRequest?.userId ?? null}
        initialChatRequestId={messengerChatRequest?.requestId ?? 0}
        initialGroupRequest={messengerGroupRequest}
        maximized={messengerMaximized}
        minimized={messengerWindow !== 'open'}
        zIndex={windowZ.messenger}
        pendingCallAccept={pendingCallAccept}
        onPendingCallHandled={handlePendingCallHandled}
        onCallStateChange={handleCallStateChange}
        onFocus={focusMessengerWindow}
        onClose={closeMessengerWindow}
        onMinimize={minimizeMessengerWindow}
        onToggleMaximize={toggleMessengerMaximized}
        onViewDesktop={viewRemoteDesktop}
        onActiveChatChange={setActiveChatUserId}
        onActiveGroupChange={setActiveChatGroupId}
        groupMentionCounts={groupMentionCounts}
        onGroupMentionsRead={markGroupMentionsRead}
        onUserChange={onUserChange}
        onEditProfile={editProfileFromMessenger}
        onOpenWatchTogether={openWatchTogether}
        onOpenInbox={openInbox}
        inboxUnreadCount={inboxUnreadCount}
      />
    );
  }, [
    closeMessengerWindow,
    editProfileFromMessenger,
    focusMessengerWindow,
    groupMentionCounts,
    handleCallStateChange,
    handlePendingCallHandled,
    inboxUnreadCount,
    language,
    markGroupMentionsRead,
    messengerChatRequest,
    messengerGroupRequest,
    messengerMaximized,
    messengerWindow,
    minimizeMessengerWindow,
    onUserChange,
    ongoingCall,
    openInbox,
    openWatchTogether,
    pendingCallAccept,
    toggleMessengerMaximized,
    token,
    user,
    viewRemoteDesktop,
    windowZ.messenger
  ]);

  return (
    <main
      ref={desktopRef}
      className="desktop"
      style={{ backgroundImage: wallpaperToBackground(user.wallpaper, user.theme) }}
      onContextMenu={openContextMenu}
      onDragOver={() => undefined}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          return;
        }
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('.desktop-tile, .taskbar, .desktop-wall-shell, .settings-window, .notice-window, .messenger-window, .remote-desktop-window, .ai-chat-window, .window-frame, .context-menu, .desktop-profile-info')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        setSelectedIconIds([]);
        setSelectionStart({ x, y });
        setSelectionRect({ x, y, width: 0, height: 0 });
      }}
      onClick={() => setContextMenu(null)}
    >
      <input
        ref={widgetPhotoInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => void addDesktopWidgetFromFile(event.currentTarget.files?.[0], 'image')}
      />
      <input
        ref={widgetVideoInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => void addDesktopWidgetFromFile(event.currentTarget.files?.[0], 'video')}
      />
      <input
        ref={playlistAudioInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(event) => void addTrackFromLocalFile(event.currentTarget.files?.[0])}
      />
      {uploadProgress !== null ? (
        <div className="desktop-upload-bar" role="progressbar" aria-label={t(language, 'uploading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress * 100)}>
          <span className="desktop-upload-bar-fill" style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
        </div>
      ) : null}

      <aside className="desktop-profile-info">
        <strong>
          {(() => {
            // Render the desktop header so the nickname keeps the user's name
            // style. The translation contains a {name} placeholder; we split on
            // a sentinel and inject the styled <UserName/> in its place.
            const SENTINEL = '\u0000NAME\u0000';
            const label = t(language, 'appDesktop', { name: SENTINEL });
            const [before, after] = label.split(SENTINEL);
            return (
              <>
                {before}
                <UserName user={user} />
                {after}
              </>
            );
          })()}
        </strong>
        <span>{t(language, 'accountSince', { date: formatUserSince(user.createdAt, language) })}</span>
        <div className="desktop-player" ref={playerRef}>
          <audio
            ref={audioRef}
            onEnded={nextTrack}
            onTimeUpdate={(event) => setMusicTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => setMusicDuration(event.currentTarget.duration || 0)}
          />
          <button className="player-button" type="button" aria-label={t(language, 'previousTrack')} onClick={previousTrack} disabled={!musicTracks.length}>
            <PrevTrackIcon />
          </button>
          <button className="player-button main" type="button" aria-label={t(language, 'playPause')} onClick={toggleMusic} disabled={!musicTracks.length}>
            <PlayPauseIcon playing={musicPlaying} />
          </button>
          <button className="player-button" type="button" aria-label={t(language, 'nextTrack')} onClick={nextTrack} disabled={!musicTracks.length}>
            <NextTrackIcon />
          </button>
          <span className="player-title" title={musicTracks[currentTrackIndex]?.name ?? t(language, 'music')}>
            {musicTracks[currentTrackIndex]?.name ?? t(language, 'music')}
          </span>
          <div className="volume-wrap">
            <button className="player-button" type="button" aria-label={t(language, 'volume')} onClick={() => setVolumeOpen((value) => !value)}>
              <VolumeIcon muted={musicVolume === 0} />
            </button>
            {volumeOpen ? (
              <div className="volume-popover">
                <input type="range" min="0" max="1" step="0.01" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} />
              </div>
            ) : null}
          </div>
          <div className="player-progress-row">
            <span>{formatPlaybackTime(musicTime)}</span>
            <input
              type="range"
              min="0"
              max={musicDuration || 0}
              step="0.1"
              value={Math.min(musicTime, musicDuration || 0)}
              onChange={(event) => seekMusic(Number(event.target.value))}
              disabled={!musicTracks.length || !musicDuration}
            />
            <span>{formatPlaybackTime(musicDuration)}</span>
          </div>
        </div>
      </aside>

      <DesktopWall
          token={token}
          language={language}
          owner={user}
          currentUser={user}
          onOpenProfile={(author, anchorRect) => { setProfileModalUser(author); setProfileAnchor(anchorRect ?? null); }}
        />

      <DesktopIcons
        language={language}
        user={user}
        desktopIcons={desktopIcons}
        iconPositions={iconPositions}
        iconMetrics={iconMetrics}
        selectedIconIds={selectedIconIds}
        renamingIconId={null}
        renameDraft=""
        dragState={dragState}
        dragDelta={dragDelta}
        onMouseDown={handleDesktopIconMouseDown}
        onContextMenu={handleDesktopIconContextMenu}
        onDoubleClick={handleDesktopIconDoubleClick}
      />

      {selectionRect ? (
        <div
          className="selection-rect"
          style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.width, height: selectionRect.height }}
        />
      ) : null}

      {contextMenu ? (
        <div className="context-menu desktop-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.type === 'shortcut' ? (
            <>
              <button type="button" onClick={() => void openShortcut(contextMenu.iconId)}>{t(language, 'open')}</button>
            </>
          ) : (
            <>
              <div className="context-submenu-host">
                <button type="button">{t(language, 'view')} <span>{'>'}</span></button>
                <div className="context-submenu">
                  <button type="button" onClick={() => void applyDesktopView('small')}>{user.desktopIconSize === 'small' ? '\u2713 ' : ''}{t(language, 'smallIcons')}</button>
                  <button type="button" onClick={() => void applyDesktopView('medium')}>{user.desktopIconSize === 'medium' ? '\u2713 ' : ''}{t(language, 'mediumIcons')}</button>
                  <button type="button" onClick={() => void applyDesktopView('large')}>{user.desktopIconSize === 'large' ? '\u2713 ' : ''}{t(language, 'largeIcons')}</button>
                  <button type="button" onClick={() => void toggleHideDesktopIcons(!user.hideDesktopIcons)}>
                    {user.hideDesktopIcons ? '\u2713 ' : ''}{t(language, 'hideShortcuts')}
                  </button>
                </div>
              </div>
              <div className="context-submenu-host">
                <button type="button">{t(language, 'sortBy')} <span>{'>'}</span></button>
                <div className="context-submenu">
                  <button type="button" onClick={() => void applySort('name')}>{t(language, 'sortName')}</button>
                  <button type="button" onClick={() => void applySort('type')}>{t(language, 'sortType')}</button>
                  <button type="button" onClick={() => void applySort('size')}>{t(language, 'sortSize')}</button>
                  <button type="button" onClick={() => void applySort('date')}>{t(language, 'sortDate')}</button>
                </div>
              </div>
              <div className="context-submenu-host">
                <button type="button">{language === 'ru' ? 'Виджет' : language === 'uk' ? 'Віджет' : 'Widget'} <span>{'>'}</span></button>
                <div className="context-submenu">
                  <button type="button" onClick={() => chooseDesktopWidget('image', { x: contextMenu.x, y: contextMenu.y })}>{language === 'ru' ? 'Фото' : language === 'uk' ? 'Фото' : 'Photo'}</button>
                  <button type="button" onClick={() => chooseDesktopWidget('video', { x: contextMenu.x, y: contextMenu.y })}>{language === 'ru' ? 'Видео' : language === 'uk' ? 'Відео' : 'Video'}</button>
                </div>
              </div>
              <button type="button" onClick={() => openSettings('desktop')}>{t(language, 'openSettings')}</button>
            </>
          )}
        </div>
      ) : null}

      {settingsWindow === 'open' ? (
        <WindowFrame
          language={language}
          title={t(language, 'settings')}
          titleContent={(
            <div className="settings-title-nav">
              <button type="button" className="messenger-title-nav-button" aria-label="Back" disabled={settingsNav.index <= 0} onClick={() => navigateSettingsHistory(-1)}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <button type="button" className="messenger-title-nav-button" aria-label="Forward" disabled={settingsNav.index >= settingsNav.entries.length - 1} onClick={() => navigateSettingsHistory(1)}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>
          )}
          className="settings-window"
          maximized={settingsMaximized}
          zIndex={windowZ.settings}
          defaultPosition={{ x: Math.max(32, window.innerWidth / 2 - 380), y: 64 }}
          minSize={{ width: 820, height: 620 }}
          defaultSize={{ width: 940, height: 720 }}
          storageKey="settings"
          onFocus={() => bringToFront('settings')}
          onClose={requestCloseSettingsWindow}
          onMinimize={() => setSettingsWindow('minimized')}
          onToggleMaximize={() => setSettingsMaximized((value) => !value)}
        >
              <div className="settings-shell">
              <div className="settings-sidebar">
                <button className={activeTab === 'profile' ? 'settings-profile-head active' : 'settings-profile-head'} type="button" onClick={() => selectSettingsTab('profile')}>
                  <img className="settings-avatar-small" src={avatarDraft} alt="" />
                  <div className="settings-profile-info">
                    <strong>{user.nickname}</strong>
                    <span>{t(language, 'editProfile')}</span>
                  </div>
                </button>
                {renderSettingsHeadingLinks('profile')}
                <div className="settings-search-wrap">
                  <span className="settings-search-icon">⌕</span>
                  <input
                    className="settings-search-input"
                    type="text"
                    placeholder={t(language, 'searchSettings')}
                    value={settingsSearch}
                    onChange={(e) => setSettingsSearch(e.target.value)}
                  />
                </div>
                <div className="settings-sidebar-body">
                  <nav className="settings-tabs" aria-label={t(language, 'settings')}>
                    {SETTINGS_TABS.filter((tab) => {
                      if (!settingsSearch.trim()) return true;
                      const label = t(language, tab.labelKey).toLowerCase();
                      const query = settingsSearch.toLowerCase();
                      return label.includes(query);
                    }).map((tab) => (
                      <div className="settings-tab-group" key={tab.id}>
                        <button
                          className={activeTab === tab.id ? 'settings-tab active' : 'settings-tab'}
                          type="button"
                          onClick={() => selectSettingsTab(tab.id)}
                        >
                          {t(language, tab.labelKey)}
                        </button>
                        {renderSettingsHeadingLinks(tab.id)}
                      </div>
                    ))}
                  </nav>
                  <button className="settings-logout" type="button" onClick={() => setConfirmLogout(true)}>
                    {t(language, 'logout')}
                  </button>
                  <div className="settings-footer">
                    <span className="settings-version">NotOS v1.0.0</span>
                    <div className="settings-links">
                      <button type="button" onClick={() => setLegalContent('privacy')}>{t(language, 'privacyPolicy')}</button>
                      <button type="button" onClick={() => setLegalContent('terms')}>{t(language, 'termsOfService')}</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-content" ref={settingsContentRef}>
                {activeTab === 'profile' ? (
                  <section className="settings-section">
                    <h3 className={settingsHeadingClass('profile-main')} data-settings-heading="profile-main">{t(language, 'profile')}</h3>
                    <div className="profile-layout">
                      <div className="profile-fields">
                        <div className="settings-avatar-row">
                          <img className="settings-avatar-preview" src={avatarDraft} alt={t(language, 'userAvatar')} />
                          <div>
                            <p>{t(language, 'userAvatar')}</p>
                            <input
                              id="settings-avatar-file"
                              className="hidden-file"
                              type="file"
                              accept="image/*"
                              onChange={(event) => void handleImageUpload(event.currentTarget.files?.[0], 'avatar')}
                            />
                            <button className="secondary-action" type="button" onClick={() => void chooseNativeImage('avatar')}>
                              {t(language, 'uploadAvatar')}
                            </button>
                          </div>
                        </div>
                        <label className="field-label" htmlFor="settings-nickname">
                          {t(language, 'nickname')}
                        </label>
                        <input
                          id="settings-nickname"
                          className="text-field"
                          value={nicknameDraft}
                          maxLength={24}
                          onChange={(event) => setNicknameDraft(event.target.value)}
                        />
                        <p className={settingsHeadingClass('profile-style', 'field-label')} data-settings-heading="profile-style">{t(language, 'displayNameStyles')}</p>
                        <div className="name-style-controls">
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => setNameStyleModalOpen(true)}
                          >
                            {t(language, 'editStyle')}
                          </button>
                          <button
                            className="secondary-action danger-text"
                            type="button"
                            disabled={!nameStyleDraft}
                            onClick={() => setConfirmDeleteNameStyle(true)}
                          >
                            {t(language, 'deleteStyle')}
                          </button>
                        </div>
                        <p className={settingsHeadingClass('profile-theme', 'field-label')} data-settings-heading="profile-theme">{t(language, 'profileTheme')}</p>
                        <div className="profile-theme-row">
                          <label className="profile-theme-swatch" style={{ background: profilePrimaryDraft }}>
                            <span className="profile-theme-swatch-label">{t(language, 'profileThemePrimary')}</span>
                            <input
                              type="color"
                              className="profile-theme-input"
                              value={profilePrimaryDraft}
                              onChange={(event) => setProfilePrimaryDraft(event.target.value)}
                            />
                          </label>
                          <label className="profile-theme-swatch" style={{ background: profileAccentDraft }}>
                            <span className="profile-theme-swatch-label">{t(language, 'profileThemeAccent')}</span>
                            <input
                              type="color"
                              className="profile-theme-input"
                              value={profileAccentDraft}
                              onChange={(event) => setProfileAccentDraft(event.target.value)}
                            />
                          </label>
                        </div>

                        <p className={settingsHeadingClass('profile-nameplate', 'field-label')} data-settings-heading="profile-nameplate">{t(language, 'nameplate')}</p>
                        <div className="nameplate-editor">
                          <small className="muted-line">{t(language, 'nameplateHint')}</small>
                          <div
                            className="nameplate-preview"
                            style={{ background: nameplateToCss(nameplateDraft) ?? undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
                          >
                            <img src={avatarDraft} alt="" />
                            <strong>{nicknameDraft || t(language, 'nickname')}</strong>
                          </div>
                          <div className="nameplate-types">
                            {(['none', 'color', 'gradient', 'image'] as const).map((type) => (
                              <button
                                key={type}
                                type="button"
                                className={nameplateDraft.type === type ? 'nameplate-type active' : 'nameplate-type'}
                                onClick={() => setNameplateDraft((current) => ({ ...current, type }))}
                              >
                                {t(language, type === 'none' ? 'nameplateNone' : type === 'color' ? 'nameplateColor' : type === 'gradient' ? 'nameplateGradient' : 'nameplateImage')}
                              </button>
                            ))}
                          </div>
                          {nameplateDraft.type === 'color' ? (
                            <label className="nameplate-field">
                              <span>{t(language, 'nameplateColor')}</span>
                              <input type="color" value={nameplateDraft.color} onChange={(event) => setNameplateDraft((c) => ({ ...c, color: event.target.value }))} />
                            </label>
                          ) : null}
                          {nameplateDraft.type === 'gradient' ? (
                            <div className="nameplate-gradient-row">
                              <label className="nameplate-field">
                                <span>{t(language, 'nameplateFrom')}</span>
                                <input type="color" value={nameplateDraft.gradientFrom} onChange={(event) => setNameplateDraft((c) => ({ ...c, gradientFrom: event.target.value }))} />
                              </label>
                              <label className="nameplate-field">
                                <span>{t(language, 'nameplateTo')}</span>
                                <input type="color" value={nameplateDraft.gradientTo} onChange={(event) => setNameplateDraft((c) => ({ ...c, gradientTo: event.target.value }))} />
                              </label>
                            </div>
                          ) : null}
                          {nameplateDraft.type === 'image' ? (
                            <label className="secondary-action" style={{ textAlign: 'center', cursor: 'pointer' }}>
                              {t(language, 'nameplateUpload')}
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(event) => { void handleNameplateUpload(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
                              />
                            </label>
                          ) : null}
                        </div>

                        <label className={settingsHeadingClass('profile-status', 'field-label')} data-settings-heading="profile-status" htmlFor="settings-status">
                          {t(language, 'profileStatus')}
                    </label>
                    <div className="status-field-wrap">
                      <textarea
                        id="settings-status"
                        className="text-field"
                        value={statusDraft}
                        maxLength={200}
                        rows={3}
                        onChange={(event) => setStatusDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        ref={statusEmojiAnchorRef}
                        className="status-emoji-button"
                        aria-label={t(language, 'emoji')}
                        onClick={() => setStatusEmojiOpen((open) => !open)}
                      >
                        <EmojiToggleIcon />
                      </button>
                      {statusEmojiOpen ? (
                        <EmojiPicker
                          language={language}
                          anchorRef={statusEmojiAnchorRef}
                          placement="bottom-end"
                          onSelect={(emoji) => setStatusDraft((value) => customEmojiToShortcodes(`${value}${emoji}`))}
                          onClose={() => setStatusEmojiOpen(false)}
                        />
                      ) : null}
                    </div>
                    </div>
                    <div className="profile-preview">
                      <ProfilePreviewCard
                        user={user}
                        language={language}
                        bannerBackground={wallpaperToBackground(wallpaperDraft, themeDraft)}
                        avatar={avatarDraft}
                        nickname={nicknameDraft}
                        status={expandCustomEmojiShortcodes(statusDraft)}
                        nameStyle={nameStyleDraft}
                        primaryColor={profilePrimaryDraft}
                        accentColor={profileAccentDraft}
                      />
                    </div>
                  </div>
                  </section>
                ) : null}

                {activeTab === 'desktop' ? (
                  <section className="settings-section">
                    <h3 className={settingsHeadingClass('desktop-wallpaper')} data-settings-heading="desktop-wallpaper">{t(language, 'wallpaper')}</h3>
                    <p className="settings-hint">{t(language, 'wallpaperHint')}</p>
                    <div className="settings-grid-2col">
                      <div className="settings-grid-col">
                        <div className="wallpaper-preview" style={{ backgroundImage: wallpaperToBackground(wallpaperDraft, themeDraft) }} />
                        <div className="wallpaper-grid">
                          {WALLPAPERS.map((wallpaper) => (
                            <button
                              key={wallpaper.name}
                              className="wallpaper-option"
                              style={{ backgroundImage: wallpaper.value }}
                              type="button"
                              onClick={() => setWallpaperDraft(wallpaper.value)}
                            >
                              {wallpaper.name}
                            </button>
                          ))}
                        </div>
                        {recentWallpapers.length > 0 ? (
                          <>
                            <p className="field-label compact" style={{ marginTop: 12 }}>{t(language, 'recentlyUsed')}</p>
                            <div className="wallpaper-grid">
                              {recentWallpapers.map((wp) => (
                                <button
                                  key={wp}
                                  className="wallpaper-option"
                                  style={{ backgroundImage: wp.startsWith('data:image/') ? `url("${wp}")` : wp }}
                                  type="button"
                                  onClick={() => setWallpaperDraft(wp)}
                                />
                              ))}
                            </div>
                          </>
                        ) : null}
                        <input
                          id="wallpaper-file"
                          className="hidden-file"
                          type="file"
                          accept="image/*"
                          onChange={(event) => void handleImageUpload(event.currentTarget.files?.[0], 'wallpaper')}
                        />
                        <div className="inline-actions">
                          <button className="secondary-action" type="button" onClick={() => void chooseNativeImage('wallpaper')}>
                            {t(language, 'uploadImage')}
                          </button>
                          <button className="secondary-action" type="button" onClick={() => setWallpaperDraft('')}>
                            {t(language, 'defaultWallpaper')}
                          </button>
                        </div>
                      </div>
                      <div className="settings-grid-col">
                        <div className="settings-subsection">
                          <p className={settingsHeadingClass('desktop-icons', 'field-label compact')} data-settings-heading="desktop-icons">{t(language, 'iconLayout')}</p>
                          <div className="choice-list theme-choice-list">
                            {(['small', 'medium', 'large'] as DesktopIconSize[]).map((size) => (
                              <button className={iconSizeDraft === size ? 'choice-item active' : 'choice-item'} key={size} type="button" onClick={() => setIconSizeDraft(size)}>
                                {size === 'small' ? t(language, 'smallIcons') : size === 'medium' ? t(language, 'mediumIcons') : t(language, 'largeIcons')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="toggle-row">
                          <input type="checkbox" checked={hideIconsDraft} onChange={(event) => setHideIconsDraft(event.target.checked)} />
                          <span>{t(language, 'hideShortcuts')}</span>
                          <strong>{hideIconsDraft ? t(language, 'transparencyOn') : t(language, 'transparencyOff')}</strong>
                        </label>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeTab === 'appearance' ? (
                  <section className="settings-section">
                    <h3 className={settingsHeadingClass('appearance-preview')} data-settings-heading="appearance-preview">{t(language, 'appearanceSettings')}</h3>
                    <div className="settings-grid-2col">
                      <div className="settings-grid-col">
                        <div className="appearance-preview" style={{ '--preview-accent': accentColorDraft } as CSSProperties}>
                          <div className="preview-wallpaper" />
                          <div className="preview-start">Aa</div>
                          <div className="preview-window">
                            <span />
                            <p>{t(language, 'appDesktop', { name: user.nickname })}</p>
                          </div>
                        </div>
                        <div className="settings-subsection">
                          <p className={settingsHeadingClass('appearance-accent', 'field-label compact')} data-settings-heading="appearance-accent">{t(language, 'recentColors')}</p>
                          <div className="accent-grid">
                            {ACCENT_COLORS.slice(0, 5).map((color) => (
                              <button
                                key={color}
                                className={accentColorDraft.toLowerCase() === color.toLowerCase() ? 'accent-swatch active' : 'accent-swatch'}
                                style={{ background: color }}
                                type="button"
                                onClick={() => setAccentColorDraft(color)}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="settings-subsection">
                          <p className="field-label compact">{t(language, 'systemColors')}</p>
                          <div className="accent-grid">
                            {ACCENT_COLORS.map((color) => (
                              <button
                                key={color}
                                className={accentColorDraft.toLowerCase() === color.toLowerCase() ? 'accent-swatch active' : 'accent-swatch'}
                                style={{ background: color }}
                                type="button"
                                onClick={() => setAccentColorDraft(color)}
                              />
                            ))}
                            <input
                              className="color-input"
                              type="color"
                              value={accentColorDraft}
                              aria-label={t(language, 'accentColor')}
                              onChange={(event) => setAccentColorDraft(event.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="settings-grid-col">
                        <div className="settings-subsection">
                          <p className={settingsHeadingClass('appearance-theme', 'field-label compact')} data-settings-heading="appearance-theme">{t(language, 'customColor')}</p>
                          <div className="choice-list theme-choice-list">
                            {THEMES.map((item) => (
                              <button
                                key={item.code}
                                className={themeDraft === item.code ? 'choice-item active' : 'choice-item'}
                                type="button"
                                onClick={() => updateThemeDraftWithWave(item.code)}
                              >
                                <span className={`theme-swatch ${item.code}`} />
                                {t(language, item.nameKey)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="toggle-row">
                          <input type="checkbox" checked={transparencyDraft} onChange={(event) => setTransparencyDraft(event.target.checked)} />
                          <span className={settingsHeadingClass('appearance-transparency')} data-settings-heading="appearance-transparency">{t(language, 'transparencyEffects')}</span>
                          <strong>{transparencyDraft ? t(language, 'transparencyOn') : t(language, 'transparencyOff')}</strong>
                        </label>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeTab === 'region' ? (
                  <section className="settings-section">
                    <h3 className={settingsHeadingClass('region-language')} data-settings-heading="region-language">{t(language, 'languageAndTime')}</h3>
                    <div className="settings-subsection">
                      <p className="settings-hint">{t(language, 'chooseLanguage')}</p>
                      <div style={{ position: 'relative' }}>
                        <button
                          className="choice-item"
                          type="button"
                          style={{ width: '100%', justifyContent: 'space-between' }}
                          onClick={() => setLanguageOpen((v) => !v)}
                        >
                          <span><span className="flag-label">{LANGUAGES.find((l) => l.code === languageDraft)?.label}</span> {LANGUAGES.find((l) => l.code === languageDraft)?.name}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>v</span>
                        </button>
                        {languageOpen ? (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 10,
                            marginTop: 4,
                            padding: 4,
                            border: '1px solid var(--line)',
                            borderRadius: 10,
                            background: 'var(--panel)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
                          }}>
                            {LANGUAGES.map((item) => (
                              <button
                                key={item.code}
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  width: '100%',
                                  padding: '8px 10px',
                                  border: 'none',
                                  borderRadius: 6,
                                  background: languageDraft === item.code ? 'var(--bg-soft)' : 'transparent',
                                  color: 'var(--text)',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  fontSize: 13
                                }}
                                onClick={() => { setLanguageDraft(item.code); setLanguageOpen(false); }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-soft)'; }}
                                onMouseLeave={(e) => { if (languageDraft !== item.code) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                              >
                                <span className="flag-label">{item.label}</span>
                                <span>{item.name}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="settings-subsection">
                      <p className={settingsHeadingClass('region-translate', 'field-label compact')} data-settings-heading="region-translate">{t(language, 'translateTo')}</p>
                      <p className="settings-hint">{t(language, 'translateToHint')}</p>
                      <div style={{ position: 'relative' }}>
                        <button
                          className="choice-item"
                          type="button"
                          style={{ width: '100%', justifyContent: 'space-between' }}
                          onClick={() => { setTranslateTargetOpen((v) => !v); setTranslateSearch(''); }}
                        >
                          <span>{findTranslateLanguage(translateTarget)?.native ?? findTranslateLanguage(translateTarget)?.name ?? translateTarget}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>v</span>
                        </button>
                        {translateTargetOpen ? (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 10,
                            marginTop: 4,
                            padding: 4,
                            border: '1px solid var(--line)',
                            borderRadius: 10,
                            background: 'var(--panel)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
                          }}>
                            <input
                              type="text"
                              autoFocus
                              value={translateSearch}
                              onChange={(e) => setTranslateSearch(e.target.value)}
                              placeholder={t(language, 'searchLanguage')}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '8px 10px',
                                marginBottom: 4,
                                border: '1px solid var(--line)',
                                borderRadius: 6,
                                background: 'var(--bg-soft)',
                                color: 'var(--text)',
                                fontSize: 13,
                                outline: 'none'
                              }}
                            />
                            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                              {(() => {
                                const q = translateSearch.trim().toLowerCase();
                                const list = q
                                  ? TRANSLATE_LANGUAGES.filter((item) =>
                                      item.name.toLowerCase().includes(q) ||
                                      item.native.toLowerCase().includes(q) ||
                                      item.code.toLowerCase().includes(q))
                                  : TRANSLATE_LANGUAGES;
                                if (list.length === 0) {
                                  return <p className="settings-hint" style={{ padding: '8px 10px', margin: 0 }}>{t(language, 'noPeopleFound')}</p>;
                                }
                                return list.map((item) => (
                                  <button
                                    key={item.code}
                                    type="button"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      width: '100%',
                                      padding: '8px 10px',
                                      border: 'none',
                                      borderRadius: 6,
                                      background: translateTarget === item.code ? 'var(--bg-soft)' : 'transparent',
                                      color: 'var(--text)',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: 13
                                    }}
                                    onClick={() => { setTranslateTarget(item.code); setTranslateTargetOpen(false); }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-soft)'; }}
                                    onMouseLeave={(e) => { if (translateTarget !== item.code) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  >
                                    <span>{item.native}</span>
                                    {item.native !== item.name ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>{item.name}</span> : null}
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="settings-subsection">
                      <p className={settingsHeadingClass('region-composer', 'field-label compact')} data-settings-heading="region-composer">{t(language, 'composerTranslateTo')}</p>
                      <p className="settings-hint">{t(language, 'composerTranslateToHint')}</p>
                      <div style={{ position: 'relative' }}>
                        <button
                          className="choice-item"
                          type="button"
                          style={{ width: '100%', justifyContent: 'space-between' }}
                          onClick={() => { setComposerTranslateTargetOpen((v) => !v); setComposerTranslateSearch(''); }}
                        >
                          <span>{findTranslateLanguage(composerTranslateTarget)?.native ?? findTranslateLanguage(composerTranslateTarget)?.name ?? composerTranslateTarget}</span>
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>v</span>
                        </button>
                        {composerTranslateTargetOpen ? (
                          <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 10,
                            marginTop: 4,
                            padding: 4,
                            border: '1px solid var(--line)',
                            borderRadius: 10,
                            background: 'var(--panel)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
                          }}>
                            <input
                              type="text"
                              autoFocus
                              value={composerTranslateSearch}
                              onChange={(e) => setComposerTranslateSearch(e.target.value)}
                              placeholder={t(language, 'searchLanguage')}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '8px 10px',
                                marginBottom: 4,
                                border: '1px solid var(--line)',
                                borderRadius: 6,
                                background: 'var(--bg-soft)',
                                color: 'var(--text)',
                                fontSize: 13,
                                outline: 'none'
                              }}
                            />
                            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                              {(() => {
                                const q = composerTranslateSearch.trim().toLowerCase();
                                const list = q
                                  ? TRANSLATE_LANGUAGES.filter((item) =>
                                      item.name.toLowerCase().includes(q) ||
                                      item.native.toLowerCase().includes(q) ||
                                      item.code.toLowerCase().includes(q))
                                  : TRANSLATE_LANGUAGES;
                                if (list.length === 0) {
                                  return <p className="settings-hint" style={{ padding: '8px 10px', margin: 0 }}>{t(language, 'noPeopleFound')}</p>;
                                }
                                return list.map((item) => (
                                  <button
                                    key={item.code}
                                    type="button"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      width: '100%',
                                      padding: '8px 10px',
                                      border: 'none',
                                      borderRadius: 6,
                                      background: composerTranslateTarget === item.code ? 'var(--bg-soft)' : 'transparent',
                                      color: 'var(--text)',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: 13
                                    }}
                                    onClick={() => { setComposerTranslateTarget(item.code); setComposerTranslateTargetOpen(false); }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-soft)'; }}
                                    onMouseLeave={(e) => { if (composerTranslateTarget !== item.code) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  >
                                    <span>{item.native}</span>
                                    {item.native !== item.name ? <span style={{ color: 'var(--muted)', fontSize: 12 }}>{item.name}</span> : null}
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="settings-subsection">
                      <p className={settingsHeadingClass('region-time', 'field-label compact')} data-settings-heading="region-time">{t(language, 'timeFormat')}</p>
                      <div className="choice-list" style={{ display: 'flex', gap: 6 }}>
                        <button
                          className={timeFormat === '24h' ? 'choice-item active' : 'choice-item'}
                          type="button"
                          style={{ flex: 1 }}
                          onClick={() => setTimeFormat('24h')}
                        >
                          24{t(language, 'hours')}
                        </button>
                        <button
                          className={timeFormat === '12h' ? 'choice-item active' : 'choice-item'}
                          type="button"
                          style={{ flex: 1 }}
                          onClick={() => setTimeFormat('12h')}
                        >
                          12{t(language, 'hours')}
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeTab === 'connections' ? (
                  <section className="settings-section connections-settings">
                    <h3>{t(language, 'connectionsSettings')}</h3>
                    <p className="settings-hint">Connect external accounts to show Spotify listening status and League of Legends activity on your profile.</p>

                    {(() => {
                      const spotify = connections.find((connection) => connection.provider === 'spotify' && connection.connected);
                      const riot = connections.find((connection) => connection.provider === 'riot' && connection.connected);
                      const spotifyShowProfile = connectionVisibilityDraft.spotify.showProfile;
                      const spotifyShowActivity = connectionVisibilityDraft.spotify.showActivity;
                      const riotShowProfile = connectionVisibilityDraft.riot.showProfile;
                      const riotShowActivity = connectionVisibilityDraft.riot.showActivity;
                      return (
                        <div className="connections-list">
                          <div className="connection-card spotify">
                            <div className="connection-card-main">
                              <img className="connection-service-icon" src={CONNECTION_ICONS.spotify} alt="" />
                              <span>
                                <strong>Spotify</strong>
                                <small>{spotify ? spotify.displayName : 'Show currently playing track in profile'}</small>
                              </span>
                            </div>
                            <div className="connection-actions">
                              {spotify ? (
                                <button className="secondary-action danger-text" type="button" onClick={() => void disconnectProvider('spotify')}>Disconnect</button>
                              ) : (
                                <button className="primary-action" type="button" disabled={connectionsLoading} onClick={() => void connectSpotify()}>
                                  Connect
                                </button>
                              )}
                            </div>
                            {!spotifyConfigured ? <p className="settings-hint">Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the server.</p> : null}
                            {spotify ? (
                              <div className="connection-visibility">
                                <label className="connection-toggle-row">
                                  <span>
                                    <strong>Show in profile</strong>
                                    <small>Display Spotify in your profile connections.</small>
                                  </span>
                                  <input type="checkbox" checked={spotifyShowProfile} onChange={(event) => void updateConnectionVisibility('spotify', { showProfile: event.target.checked })} />
                                </label>
                                <label className="connection-toggle-row">
                                  <span>
                                    <strong>Show activity</strong>
                                    <small>Display the track you are listening to now.</small>
                                  </span>
                                  <input type="checkbox" checked={spotifyShowActivity} onChange={(event) => void updateConnectionVisibility('spotify', { showActivity: event.target.checked })} />
                                </label>
                              </div>
                            ) : null}
                          </div>

                          <div className="connection-card riot">
                            <div className="connection-card-main">
                              <img className="connection-service-icon" src={CONNECTION_ICONS.riot} alt="" />
                              <span>
                                <strong>Riot Games</strong>
                                <small>{riot ? riot.displayName : 'Show active League of Legends game in profile'}</small>
                              </span>
                            </div>
                            <div className="riot-connect-form">
                              <input className="text-field" value={riotGameName} placeholder="Riot name" onChange={(event) => setRiotGameName(event.target.value)} />
                              <input className="text-field" value={riotTagLine} placeholder="TAG" onChange={(event) => setRiotTagLine(event.target.value)} />
                              <select className="text-field" value={riotRegion} onChange={(event) => setRiotRegion(event.target.value)}>
                                {RIOT_REGIONS.map((region) => <option key={region} value={region}>{region.toUpperCase()}</option>)}
                              </select>
                            </div>
                            <div className="connection-actions">
                              <button className="primary-action" type="button" disabled={connectionsLoading || !riotGameName.trim() || !riotTagLine.trim()} onClick={() => void connectRiot()}>
                                {riot ? 'Update' : 'Connect'}
                              </button>
                              {riot ? <button className="secondary-action danger-text" type="button" onClick={() => void disconnectProvider('riot')}>Disconnect</button> : null}
                            </div>
                            {!riotConfigured ? <p className="settings-hint">Set RIOT_API_KEY on the server to validate Riot IDs and read LoL activity.</p> : null}
                            {riot ? (
                              <div className="connection-visibility">
                                <label className="connection-toggle-row">
                                  <span>
                                    <strong>Show in profile</strong>
                                    <small>Display Riot Games in your profile connections.</small>
                                  </span>
                                  <input type="checkbox" checked={riotShowProfile} onChange={(event) => void updateConnectionVisibility('riot', { showProfile: event.target.checked })} />
                                </label>
                                <label className="connection-toggle-row">
                                  <span>
                                    <strong>Show activity</strong>
                                    <small>Display active League of Legends game status.</small>
                                  </span>
                                  <input type="checkbox" checked={riotShowActivity} onChange={(event) => void updateConnectionVisibility('riot', { showActivity: event.target.checked })} />
                                </label>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}

                    {connectionsLoading ? <p className="settings-hint">Loading connections...</p> : null}
                    {connectionsStatus ? <p className="settings-hint">{connectionsStatus}</p> : null}
                  </section>
                ) : null}

                {activeTab === 'music' ? (
                  <section className="settings-section settings-music-section">
                    <h3>{t(language, 'playlist')}</h3>
                    <div className="settings-music-shell single">
                      <div className="settings-music-panel">
                        <header>
                          <strong>{t(language, 'playlist')}</strong>
                          <button
                            className="secondary-action compact"
                            type="button"
                            onClick={() => {
                              if (playlistAudioInputRef.current) {
                                playlistAudioInputRef.current.value = '';
                                playlistAudioInputRef.current.click();
                              }
                            }}
                          >
                            {language === 'ru' ? 'Из ПК' : language === 'uk' ? 'З ПК' : 'Add from PC'}
                          </button>
                        </header>
                        <div className="settings-music-list">
                          {musicTracks.length === 0 ? <div className="explorer-empty">{t(language, 'emptyPlaylist')}</div> : null}
                          {musicTracks.map((track, index) => (
                            <div
                              className={'settings-music-row' + (index === currentTrackIndex ? ' active' : '') +
                                (index === dragTrackIndex ? ' dragging' : '')}
                              key={track.id}
                              draggable
                              onDragStart={(e) => { setDragTrackIndex(index); e.dataTransfer.effectAllowed = 'move'; }}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (dragTrackIndex === null || dragTrackIndex === index) return;
                                const reordered = [...musicTracks];
                                const [moved] = reordered.splice(dragTrackIndex, 1);
                                reordered.splice(index, 0, moved);
                                setMusicTracks(reordered);
                                void saveMusicTracksOrder(user.id, reordered);
                                setCurrentTrackIndex((prev) => {
                                  if (prev === dragTrackIndex) return index;
                                  if (dragTrackIndex < prev && index >= prev) return prev - 1;
                                  if (dragTrackIndex > prev && index <= prev) return prev + 1;
                                  return prev;
                                });
                                setDragTrackIndex(null);
                              }}
                              onDragEnd={() => setDragTrackIndex(null)}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrentTrackIndex(index);
                                  setMusicPlaying(true);
                                }}
                              >
                                <span>{index === currentTrackIndex ? '>' : '-'}</span>
                                <strong>{track.name}</strong>
                              </button>
                              <button className="icon-action danger-text" type="button" onClick={() => void removeTrack(track.id)}>
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeTab === 'voice' ? (
                  <section className="settings-section">
                    <VoiceSettings language={language} onDirtyChange={handleVoiceDirtyChange} />
                  </section>
                ) : null}

                {activeTab === 'customEmoji' ? (
                  <section className="settings-section">
                    <CustomEmojiSettings language={language} currentUser={user} />
                  </section>
                ) : null}

                {activeTab === 'privacy' ? (
                  <section className="settings-section">
                    <h3 className={settingsHeadingClass('privacy-group-identity')} data-settings-heading="privacy-group-identity">{t(language, 'privacySettings')}</h3>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>{t(language, 'groupIdentityMessages')}</strong>
                        <small>{t(language, 'groupIdentityMessagesHint')}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={allowGroupIdentityMessagesDraft}
                        onChange={(event) => setAllowGroupIdentityMessagesDraft(event.target.checked)}
                      />
                    </label>
                  </section>
                ) : null}

                {activeTab === 'security' ? (
                  <section className="settings-section">
                    <h3>{t(language, 'securitySettings')}</h3>
                    <div className="security-row">
                      <div className="security-row-text">
                        <strong>{t(language, 'securityPin')}</strong>
                        <p className="settings-hint">{t(language, 'securityPinDescription')}</p>
                        <p className={pinEnabled ? 'security-status enabled' : 'security-status'}>
                          <span className="security-status-dot" aria-hidden="true" />
                          {pinEnabled ? t(language, 'securityPinEnabled') : t(language, 'securityPinDisabled')}
                        </p>
                      </div>
                      <div className="security-row-actions">
                        {pinEnabled ? (
                          <>
                            <button className="secondary-action" type="button" onClick={() => { setPinStatusMessage(''); setPinModal('change'); }}>
                              {t(language, 'changePin')}
                            </button>
                            <button className="secondary-action danger-text" type="button" onClick={() => { setPinStatusMessage(''); setPinDisableModal(true); }}>
                              {t(language, 'removePin')}
                            </button>
                          </>
                        ) : (
                          <button className="primary-action" type="button" onClick={() => { setPinStatusMessage(''); setPinModal('create'); }}>
                            {t(language, 'setPin')}
                          </button>
                        )}
                      </div>
                    </div>
                    {pinStatusMessage ? <p className="settings-hint">{pinStatusMessage}</p> : null}
                  </section>
                ) : null}

                {activeTab === 'premium' ? (
                  <section className="settings-section">
                    <h3>{t(language, 'premiumTitle')}</h3>
                    <p className="settings-hint">{t(language, 'premiumHint')}</p>
                    <div className="payment-card-preview">
                      <span>NotOS Premium</span>
                      <strong>{cardNumberDraft.replace(/\d(?=\d{4})/g, '•') || '•••• •••• •••• ••••'}</strong>
                      <small>{cardHolderDraft || t(language, 'cardHolder')} В· {cardExpiryDraft || 'MM/YY'}</small>
                    </div>
                    <label className="field-label" htmlFor="premium-card-number">{t(language, 'cardNumber')}</label>
                    <input id="premium-card-number" className="text-field" inputMode="numeric" value={cardNumberDraft} placeholder="4242 4242 4242 4242" onChange={(event) => setCardNumberDraft(event.target.value)} />
                    <label className="field-label" htmlFor="premium-card-holder">{t(language, 'cardHolder')}</label>
                    <input id="premium-card-holder" className="text-field" value={cardHolderDraft} placeholder="NOTOS USER" onChange={(event) => setCardHolderDraft(event.target.value.toUpperCase())} />
                    <div className="payment-grid">
                      <label className="field-label" htmlFor="premium-card-expiry">{t(language, 'cardExpiry')}</label>
                      <label className="field-label" htmlFor="premium-card-cvc">{t(language, 'cardCvc')}</label>
                      <input id="premium-card-expiry" className="text-field" value={cardExpiryDraft} placeholder="12/30" onChange={(event) => setCardExpiryDraft(event.target.value)} />
                      <input id="premium-card-cvc" className="text-field" inputMode="numeric" value={cardCvcDraft} placeholder="123" onChange={(event) => setCardCvcDraft(event.target.value)} />
                    </div>
                    <button className="primary-action" type="button" onClick={submitPremiumPayment}>{t(language, 'premiumPay')}</button>
                    {premiumStatus ? <p className="settings-hint">{premiumStatus}</p> : null}
                  </section>
                ) : null}

              </div>
            </div>

            {activeTab !== 'premium' && activeTab !== 'security' ? (
              <SaveBar
                language={language}
                dirty={settingsDirty}
                shakeKey={settingsBarShake}
                saving={saving}
                onReset={resetSettingsDrafts}
                onSave={() => void saveSettings()}
              />
            ) : null}

            {settingsError ? <div className="inline-error settings-error">{settingsError}</div> : null}

            {confirmLogout ? (
              <div className="modal-backdrop" onClick={() => setConfirmLogout(false)}>
                <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
                  <p>{t(language, 'confirmLogout')}</p>
                  <div className="confirm-actions">
                    <button className="secondary-action" type="button" onClick={() => setConfirmLogout(false)}>{t(language, 'cancel')}</button>
                    <button className="primary-action danger-text" type="button" onClick={onLogout}>{t(language, 'logout')}</button>
                  </div>
                </section>
              </div>
            ) : null}

            {legalContent ? (
              <div className="modal-backdrop" onClick={() => setLegalContent(null)}>
                <section className="legal-window" onClick={(event) => event.stopPropagation()}>
                  <div className="legal-header">
                    <h2>{t(language, legalContent === 'privacy' ? 'privacyPolicy' : 'termsOfService')}</h2>
                    <button className="icon-action" type="button" onClick={() => setLegalContent(null)}>x</button>
                  </div>
                  <div className="legal-body">
                    <h3>1. {t(language, 'informationCollection')}</h3>
                    <p>{t(language, 'infoCollectionText')}</p>
                    <h3>2. {t(language, 'dataUsage')}</h3>
                    <p>{t(language, 'dataUsageText')}</p>
                    <h3>3. {t(language, 'dataSecurity')}</h3>
                    <p>{t(language, 'dataSecurityText')}</p>
                    <h3>4. {t(language, 'contactInfo')}</h3>
                    <p>{t(language, 'contactText')}</p>
                  </div>
                </section>
              </div>
            ) : null}

            {nameStyleModalOpen ? (
              <NameStyleModal
                language={language}
                user={{
                  ...user,
                  nickname: nicknameDraft || user.nickname,
                  avatarData: avatarDraft,
                  wallpaper: wallpaperDraft,
                  status: expandCustomEmojiShortcodes(statusDraft),
                  profilePrimaryColor: profilePrimaryDraft,
                  profileAccentColor: profileAccentDraft
                }}
                initialStyle={nameStyleDraft}
                zIndex={(windowZ.settings ?? 1010) + 40}
                onCancel={() => setNameStyleModalOpen(false)}
                onAccept={(style) => {
                  setNameStyleDraft(style);
                  setNameStyleModalOpen(false);
                }}
              />
            ) : null}

            {confirmDeleteNameStyle ? (
              <div className="modal-backdrop important" onClick={() => setConfirmDeleteNameStyle(false)}>
                <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
                  <p>{t(language, 'confirmDeleteStyle')}</p>
                  <div className="confirm-actions">
                    <button className="secondary-action" type="button" onClick={() => setConfirmDeleteNameStyle(false)}>
                      {t(language, 'cancel')}
                    </button>
                    <button
                      className="primary-action danger-text"
                      type="button"
                      onClick={() => {
                        setNameStyleDraft(null);
                        setConfirmDeleteNameStyle(false);
                      }}
                    >
                      {t(language, 'deleteStyle')}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {pinModal ? (
              <PinSetupModal
                language={language}
                userId={user.id}
                mode={pinModal}
                onClose={() => setPinModal(null)}
                onSaved={() => {
                  setPinEnabled(true);
                  setPinStatusMessage(t(language, 'pinSavedHint'));
                  setPinModal(null);
                }}
              />
            ) : null}

            {pinDisableModal ? (
              <PinDisableModal
                language={language}
                userId={user.id}
                onClose={() => setPinDisableModal(false)}
                onRemoved={() => {
                  setPinEnabled(false);
                  setPinStatusMessage(t(language, 'pinRemoved'));
                  setPinDisableModal(false);
                }}
              />
            ) : null}
        </WindowFrame>
      ) : null}

      {notice ? (
        <div className="modal-backdrop important" onClick={onNoticeClose}>
          <section className="notice-window" onClick={(event) => event.stopPropagation()}>
            <p className="eyebrow">{t(language, 'securityCheckpoint')}</p>
            <h2>{notice.title}</h2>
            <p>{notice.message}</p>
            {notice.recoveryKey ? <code className="recovery-code">{notice.recoveryKey}</code> : null}
            <div className="notice-actions">
              {notice.authFile ? (
                <button className="secondary-action" type="button" onClick={() => void downloadAuthFile(notice.authFile!)}>
                  {t(language, 'downloadAgain')}
                </button>
              ) : null}
              <button className="primary-action" type="button" onClick={onNoticeClose}>
                {t(language, 'enterDesktop')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {updatesWindowOpen ? (
        <UpdatesWindow language={language} initialUpdateId={updatesInitialId} onClose={closeUpdates} />
      ) : null}

      {inboxWindow !== 'closed' ? (
        <InboxWindow
          token={token}
          language={language}
          currentUser={user}
          minimized={inboxWindow === 'minimized'}
          maximized={inboxMaximized}
          zIndex={windowZ.inbox}
          readIds={inboxReadIds}
          initialRequests={inboxRequests}
          initialWallMessages={inboxWallMessages}
          mentionItems={mentionNotifications}
          initialLoading={inboxLoading}
          onReadIdsChange={setInboxReadIds}
          onUnreadCountChange={setInboxUnreadCount}
          onFocus={() => bringToFront('inbox')}
          onClose={() => setInboxWindow('closed')}
          onMinimize={() => setInboxWindow('minimized')}
          onToggleMaximize={() => setInboxMaximized((value) => !value)}
          onOpenProfile={(profileUser, anchorRect) => { setProfileModalUser(profileUser); setProfileAnchor(anchorRect ?? null); }}
          onOpenMention={(mention) => {
            if (mention.kind === 'group' && mention.group) {
              openMessengerGroup(mention.group, mention.channelId ?? null);
            } else {
              openMessengerChat(mention.sender.id);
            }
          }}
        />
      ) : null}

      {pinnedCards.map((card) =>
        card.kind === 'video' ? (
          <PinnedVideoCard
            key={card.id}
            cardId={card.id}
            language={language}
            videoUrl={card.imageData}
            videoName={card.name}
            onClose={unpinCard}
            onMove={(cardId, placement) => handleCardMove(cardId, placement)}
            onMoveEnd={(cardId, placement) => handleCardMove(cardId, placement, true)}
          />
        ) : (
          <PinnedImageCard
            key={card.id}
            cardId={card.id}
            language={language}
            imageUrl={card.imageData}
            imageName={card.name}
            onClose={unpinCard}
            onMove={(cardId, placement) => handleCardMove(cardId, placement)}
            onMoveEnd={(cardId, placement) => handleCardMove(cardId, placement, true)}
          />
        )
      )}

      {Object.entries(viewerCursors).map(([cursorUserId, cursor]) => (
        <div key={cursorUserId} className="remote-cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
          <span className="remote-cursor-name">{cursor.nickname}</span>
          <span className="remote-cursor-pointer" />
        </div>
      ))}

      {watchTogetherWindow !== 'closed' ? (
        <WatchTogetherWindow
          language={language}
          currentUser={user}
          token={token}
          minimized={watchTogetherWindow === 'minimized'}
          maximized={watchTogetherMaximized}
          zIndex={windowZ.watchTogether}
          initialInvite={watchTogetherInvite}
          onFocus={() => bringToFront('watchTogether')}
          onClose={() => setWatchTogetherWindow('closed')}
          onMinimize={() => setWatchTogetherWindow('minimized')}
          onToggleMaximize={() => setWatchTogetherMaximized((value) => !value)}
        />
      ) : null}

      {aiChatWindow !== 'closed' ? (
        <ErrorBoundary
          fallback={(error, reset) => (
            <WindowFrame
              language={language}
              title={t(language, 'aiChat')}
              className="ai-chat-window"
              minimized={aiChatWindow === 'minimized'}
              maximized={aiChatMaximized}
              zIndex={windowZ.aiChat}
              storageKey="ai-chat"
              defaultPosition={{ x: 160, y: 80 }}
              minSize={{ width: 760, height: 520 }}
              defaultSize={{ width: 960, height: 680 }}
              onFocus={() => bringToFront('aiChat')}
              onClose={() => setAiChatWindow('closed')}
              onMinimize={() => setAiChatWindow('minimized')}
              onToggleMaximize={() => setAiChatMaximized((value) => !value)}
            >
              <div className="ai-chat-crash">
                <strong>{language === 'ru' ? 'AI Chat не смог открыться' : language === 'uk' ? 'AI Chat не вдалося відкрити' : 'AI Chat could not open'}</strong>
                <p>{error?.message || t(language, 'aiError')}</p>
                <button className="primary-action" type="button" onClick={reset}>
                  {t(language, 'retry')}
                </button>
              </div>
            </WindowFrame>
          )}
        >
          <AiChatWindow
            token={token}
            userId={user.id}
            language={language}
            minimized={aiChatWindow === 'minimized'}
            maximized={aiChatMaximized}
            zIndex={windowZ.aiChat}
            onFocus={() => bringToFront('aiChat')}
            onClose={() => setAiChatWindow('closed')}
            onMinimize={() => setAiChatWindow('minimized')}
            onToggleMaximize={() => setAiChatMaximized((value) => !value)}
          />
        </ErrorBoundary>
      ) : null}

      {messengerNode}

      {remoteDesktopWindow !== 'closed' && remoteDesktopUser ? (
        <RemoteDesktopWindow
          token={token}
          language={language}
          owner={remoteDesktopUser}
          currentUser={user}
          minimized={remoteDesktopWindow === 'minimized'}
          maximized={remoteDesktopMaximized}
          zIndex={windowZ.remoteDesktop}
          onFocus={() => bringToFront('remoteDesktop')}
          onClose={() => setRemoteDesktopWindow('closed')}
          onMinimize={() => setRemoteDesktopWindow('minimized')}
          onToggleMaximize={() => setRemoteDesktopMaximized((value) => !value)}
        />
      ) : null}

      {cropSource ? (
        <AvatarCropper
          imageDataUrl={cropSource}
          language={language}
          onCancel={() => setCropSource(null)}
          onApply={(nextAvatar) => {
            setAvatarDraft(nextAvatar);
            setCropSource(null);
          }}
        />
      ) : null}

      {notifications.length ? (
        <div className="desktop-notifications" aria-live="polite">
          {notifications.map((notification) => (
            <article
              className={notification.onOpen ? 'desktop-toast clickable' : 'desktop-toast'}
              key={notification.id}
              role={notification.onOpen ? 'button' : undefined}
              tabIndex={notification.onOpen ? 0 : undefined}
              onClick={() => {
                notification.onOpen?.();
                setNotifications((current) => current.filter((item) => item.id !== notification.id));
              }}
              onKeyDown={(event) => {
                if (!notification.onOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
                if ((event.target as HTMLElement).closest('button')) return;
                event.preventDefault();
                notification.onOpen();
                setNotifications((current) => current.filter((item) => item.id !== notification.id));
              }}
            >
              {notification.avatarData ? <img src={notification.avatarData} alt="" /> : <span className="desktop-toast-mark">M</span>}
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
              </div>
              <button type="button" aria-label={t(language, 'close')} onClick={(event) => {
                event.stopPropagation();
                setNotifications((current) => current.filter((item) => item.id !== notification.id));
              }}>
                x
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {incomingCallToast && !ongoingCall ? (
        <div className="desktop-call-toast" role="alert">
          <div className="desktop-call-toast-avatar">
            <img src={incomingCallToast.caller.avatarData} alt="" />
            <span className="desktop-call-ring" />
          </div>
          <div className="desktop-call-toast-info">
            <strong>{incomingCallToast.caller.nickname}</strong>
            <small>{t(language, 'incomingCall')}</small>
          </div>
          <div className="desktop-call-toast-actions">
            <button
              className="call-btn accept"
              type="button"
              title={t(language, 'acceptCall')}
              onClick={() => {
                dismissedCallsRef.current.add(incomingCallToast.callId);
                setPendingCallAccept({ callId: incomingCallToast.callId, callerId: incomingCallToast.caller.id });
                openMessengerChat(incomingCallToast.caller.id);
                setIncomingCallToast(null);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.2 2.2z"/></svg>
            </button>
            <button
              className="call-btn decline"
              type="button"
              title={t(language, 'declineCall')}
              onClick={() => {
                dismissedCallsRef.current.add(incomingCallToast.callId);
                socketRef.current?.emit('call:decline', { callId: incomingCallToast.callId });
                setIncomingCallToast(null);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
            </button>
          </div>
        </div>
      ) : null}

      {ongoingCall?.peer && messengerWindow !== 'open' && !incomingCallToast ? (
        <div
          className={ongoingCall.videoStream ? 'desktop-call-toast ongoing with-video' : 'desktop-call-toast ongoing'}
          role="status"
          onClick={() => openMessengerChat(ongoingCall.peer!.id)}
          title={t(language, 'ongoingCall')}
        >
          {ongoingCall.videoStream ? (
            <video
              className="desktop-call-toast-video"
              autoPlay
              playsInline
              muted
              ref={(el) => {
                if (el && el.srcObject !== ongoingCall.videoStream) {
                  el.srcObject = ongoingCall.videoStream;
                  void el.play().catch(() => undefined);
                }
              }}
            />
          ) : null}
          <div className="desktop-call-toast-avatar">
            <img src={ongoingCall.peer.avatarData} alt="" />
            <span className="desktop-call-ring active" />
          </div>
          <div className="desktop-call-toast-info">
            <strong>{ongoingCall.peer.nickname}</strong>
            <small>
              {ongoingCall.phase === 'active'
                ? `${t(language, 'ongoingCall')} В· ${formatCallDuration(ongoingCall.elapsed)}`
                : t(language, 'callConnecting')}
            </small>
          </div>
          <div className="desktop-call-toast-actions">
            <button
              className="call-btn decline"
              type="button"
              title={t(language, 'endCall')}
              onClick={(event) => {
                event.stopPropagation();
                ongoingCall.hangup();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
            </button>
          </div>
        </div>
      ) : null}

      <footer className="taskbar">
        <div className="profile-start-wrap">
          <button
            ref={statusTriggerRef}
            className="profile-start"
            type="button"
            onClick={openStatusPanel}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setTaskbarMenu({
                x: Math.min(Math.max(event.clientX, 8), window.innerWidth - 260 - 8),
                y: Math.max(event.clientY - 8, 8)
              });
            }}
          >
            <span className="profile-start-avatar">
              <img src={user.avatarData} alt="" />
              <i className={`presence-dot status-${userStatus.status}`} />
            </span>
            <span className="profile-start-name"><UserName user={user} /></span>
          </button>
          <div className="profile-start-voice" aria-label={t(language, 'voiceVideoSettings')}>
            <button
              type="button"
              className={userStatus.voice.muted ? 'profile-voice-btn danger' : 'profile-voice-btn'}
              title={userStatus.voice.muted ? t(language, 'unmuteMic') : t(language, 'muteMic')}
              aria-pressed={userStatus.voice.muted}
              onClick={(event) => {
                event.stopPropagation();
                toggleSelfMute();
              }}
            >
              {userStatus.voice.muted ? (
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M2.7 3.7 1.3 5.1l8.7 8.7V14a2 2 0 0 0 2 2c.3 0 .6-.1.8-.2l1.5 1.5A6 6 0 0 1 6 12H4a8 8 0 0 0 7 7.9V22h2v-2.1c1.1-.1 2.2-.5 3.2-1.1l3.5 3.5 1.4-1.4L2.7 3.7zM14 11.2V5a2 2 0 0 0-4 0v2.2l4 4zM18 12c0 .9-.2 1.7-.5 2.4l1.5 1.5c.6-1.1 1-2.4 1-3.9h-2z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>
              )}
            </button>
            <button
              type="button"
              className={userStatus.voice.deafened ? 'profile-voice-btn danger' : 'profile-voice-btn'}
              title={userStatus.voice.deafened ? t(language, 'undeafen') : t(language, 'deafen')}
              aria-pressed={userStatus.voice.deafened}
              onClick={(event) => {
                event.stopPropagation();
                toggleSelfDeafen();
              }}
            >
              {userStatus.voice.deafened ? (
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M2.7 3.7 1.3 5.1 4.4 8.2A9 9 0 0 0 3 13v4a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 .9-3.4l13 13 1.4-1.4L2.7 3.7zM12 4a9 9 0 0 1 9 9v4a3 3 0 0 1-1.6 2.6L17 17.2V13h2a7 7 0 0 0-9.3-6.6L8.1 4.8A9 9 0 0 1 12 4z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 14 0v1h-2v7h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9z"/></svg>
              )}
            </button>
          </div>
        </div>
        {statusPanel ? (
          <UserStatusPanel
            language={language}
            user={user}
            status={userStatus.status}
            voice={userStatus.voice}
            anchor={statusPanel}
            triggerElement={statusTriggerRef.current}
            onSelectStatus={selectUserStatus}
            onToggleMute={toggleSelfMute}
            onToggleDeafen={toggleSelfDeafen}
            onOpenVoiceSettings={() => { setStatusPanel(null); openSettings('voice'); }}
            onClose={() => setStatusPanel(null)}
          />
        ) : null}
        {taskbarMenu ? createPortal(
          <div
            className="context-menu messenger-user-menu taskbar-user-menu"
            style={{ left: taskbarMenu.x, top: taskbarMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => { setProfileModalUser(user); setProfileAnchor({ left: taskbarMenu.x, top: taskbarMenu.y, right: taskbarMenu.x, bottom: taskbarMenu.y }); setTaskbarMenu(null); }}>
              {t(language, 'viewProfile')}
            </button>
          </div>,
          document.body
        ) : null}
        {profileModalUser ? (
          <ProfileModal
            key={profileModalUser.id}
            user={profileModalUser}
            currentUser={user}
            onlineUserIds={onlineUserIds}
            presenceStatuses={presenceStatuses}
            language={language}
            token={token}
            translucent
            zIndex={Math.max(...Object.values(windowZ)) + 1}
            anchorRect={profileAnchor}
            onClose={() => { setProfileModalUser(null); setProfileAnchor(null); }}
            onUserChange={(updatedUser) => {
              onUserChange(updatedUser);
            }}
            onOpenChat={openMessengerChat}
            onOpenDesktop={openRemoteDesktopWindow}
            onOpenProfile={(nextUser) => { setProfileModalUser(nextUser); setProfileAnchor(null); }}
            onOpenGroup={() => {
              setProfileModalUser(null);
              setProfileAnchor(null);
              openMessenger();
            }}
            onEditProfile={() => {
              setProfileModalUser(null);
              setProfileAnchor(null);
              openSettings('profile');
            }}
          />
        ) : null}
        {settingsWindow !== 'closed' ? (
          <button className={settingsWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setSettingsWindow('open');
            bringToFront('settings');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-settings">ST</span>
            {t(language, 'settings')}
          </button>
        ) : null}
        {messengerWindow !== 'closed' ? (
          <button className={messengerWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setMessengerWindow('open');
            bringToFront('messenger');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-messenger">M</span>
            {t(language, 'messenger')}
          </button>
        ) : null}
        {inboxWindow !== 'closed' ? (
          <button className={inboxWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setInboxWindow('open');
            bringToFront('inbox');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-inbox">
              IN
              {inboxUnreadCount > 0 ? (
                <span className="unread-badge taskbar-icon-badge">{inboxUnreadCount > 9 ? '9+' : inboxUnreadCount}</span>
              ) : null}
            </span>
            {language === 'ru' ? 'Почта' : language === 'uk' ? 'Пошта' : 'Mail'}
          </button>
        ) : null}
        {watchTogetherWindow !== 'closed' ? (
          <button className={watchTogetherWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setWatchTogetherWindow('open');
            bringToFront('watchTogether');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-watch-together">WT</span>
            {t(language, 'watchTogether')}
          </button>
        ) : null}
        {aiChatWindow !== 'closed' ? (
          <button className={aiChatWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setAiChatWindow('open');
            bringToFront('aiChat');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-ai-chat">AI</span>
            {t(language, 'aiChat')}
          </button>
        ) : null}
        {remoteDesktopWindow !== 'closed' && remoteDesktopUser ? (
          <button className={remoteDesktopWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setRemoteDesktopWindow('open');
            bringToFront('remoteDesktop');
          }}>
            <span className="taskbar-app-icon tile-icon tile-icon-remote">PC</span>
            {remoteDesktopUser.nickname}
          </button>
        ) : null}
        <div className="taskbar-spacer" />
        <div className="taskbar-clock" aria-label="Time">
          <span>{clock.time}</span>
          <span>{clock.date}</span>
        </div>
      </footer>
    </main>
  );
}
