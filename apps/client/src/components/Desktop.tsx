import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { api } from '../api/client';
import { cacheUser, getOrFetchUser } from '../api/user-cache';
import { useSocket } from '../hooks/use-socket';
import type { DesktopIconSize, DesktopSort, Language, MessengerMessage, NameStyle, NamePlate, PinnedCard, PublicUser, StoragePayload, Theme } from '../api/types';
import { DEFAULT_NAMEPLATE, nameplateToCss } from '../api/types';
import type { StorageItem } from '../api/types';
import type { AuthNotice } from '../app-types';
import { downloadAuthFile, openNativeImageFile, readImageAsDataUrl } from '../auth/auth-file';
import { useClock } from '../hooks/use-clock';
import { LANGUAGES, LOCALES, THEMES, t, getSavedTimeFormat, saveTimeFormat, type TimeFormat } from '../i18n';
import { addMusicTrack, deleteMusicTrack, getMusicTracks, saveMusicTracksOrder, type MusicTrack } from '../music-library';
import { AvatarCropper } from './AvatarCropper';
import { DesktopWall } from './DesktopWall';
import { MessengerWindow, type OngoingCallInfo } from './MessengerWindow';
import { AiChatWindow } from './AiChatWindow';
import { callMessageLabel, formatCallDuration } from '../utils/call-messages';
import { MusicPlayerWindow } from './MusicPlayerWindow';
import { PlayPauseIcon, PrevTrackIcon, NextTrackIcon, VolumeIcon } from './PlayerIcons';
import { ProfileModal } from './ProfileModal';
import { SaveBar } from './SaveBar';
import { NameStyleModal } from './NameStyleModal';
import { UserBadges } from './UserBadges';
import { UserName } from './UserName';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';
import { ImageViewerWindow } from './ImageViewerWindow';
import { VideoViewerWindow } from './VideoViewerWindow';
import { PinnedImageCard } from './PinnedImageWindow';
import { PinnedVideoCard } from './PinnedVideoWindow';
import { NotepadWindow } from './NotepadWindow';
import { RemoteDesktopWindow } from './RemoteDesktopWindow';
import { VirtualExplorer } from './VirtualExplorer';
import { WindowFrame } from './WindowFrame';
import { PinSetupModal } from './PinSetupModal';
import { PinDisableModal } from './PinDisableModal';
import { VoiceSettings } from './VoiceSettings';
import { UpdatesWindow } from './UpdatesWindow';
import { hasPin } from '../utils/pin-lock';
import { LATEST_UPDATE_ID, hasUnseenUpdate, markUpdatesSeen } from '../utils/updates';

type DesktopProps = {
  token: string;
  user: PublicUser;
  language: Language;
  notice: AuthNotice | null;
  onNoticeClose: () => void;
  onUserChange: (user: PublicUser) => void;
  onLogout: () => void;
};

type SettingsTab = 'profile' | 'desktop' | 'appearance' | 'region' | 'music' | 'voice' | 'security' | 'premium';
type DesktopIconId = string;
type DesktopContextMenu =
  | { type: 'desktop'; x: number; y: number }
  | { type: 'shortcut'; x: number; y: number; iconId: string };

type DesktopNotification = {
  id: string;
  title: string;
  message: string;
  avatarData?: string;
  onOpen?: () => void;
};

type IconDragState = {
  ids: DesktopIconId[];
  startX: number;
  startY: number;
  basePositions: Record<string, { x: number; y: number }>;
  moved: boolean;
};

const LIGHT_WALLPAPER = 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
const DARK_WALLPAPER = 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)';

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
  storage: { x: 18, y: 140 },
  musicPlayer: { x: 18, y: 262 },
  updates: { x: 18, y: 384 },
  aiChat: { x: 18, y: 506 }
} satisfies Record<string, { x: number; y: number }>;

const DESKTOP_FOLDER_ID = 'system-desktop';
const MAX_IMPORTED_FILE_SIZE = 50 * 1024 * 1024;
const MAX_IMPORTED_VIDEO_SIZE = 150 * 1024 * 1024;

// Per-file size cap: videos may be up to 150 MB, everything else up to 50 MB.
function maxImportSizeForFile(file: File) {
  const mimeType = inferMimeType(file);
  return mimeType.startsWith('video/') ? MAX_IMPORTED_VIDEO_SIZE : MAX_IMPORTED_FILE_SIZE;
}

const ICON_METRICS: Record<DesktopIconSize, { width: number; height: number; gap: number }> = {
  small: { width: 92, height: 82, gap: 10 },
  medium: { width: 118, height: 108, gap: 14 },
  large: { width: 146, height: 132, gap: 18 }
};

const SETTINGS_TABS: Array<{ id: SettingsTab; labelKey: Parameters<typeof t>[1] }> = [
  { id: 'desktop', labelKey: 'desktopSettings' },
  { id: 'appearance', labelKey: 'appearanceSettings' },
  { id: 'region', labelKey: 'languageAndTime' },
  { id: 'music', labelKey: 'music' },
  { id: 'voice', labelKey: 'voiceAndVideo' },
  { id: 'security', labelKey: 'securitySettings' },
  { id: 'premium', labelKey: 'premiumSettings' }
];



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
    storage: { ...value.storage, ...DEFAULT_ICON_POSITIONS.storage, ...value.storage, kind: 'app' },
    musicPlayer: { ...value.musicPlayer, ...DEFAULT_ICON_POSITIONS.musicPlayer, ...value.musicPlayer, kind: 'app' },
    updates: { ...value.updates, ...DEFAULT_ICON_POSITIONS.updates, ...value.updates, kind: 'app' },
    aiChat: { ...value.aiChat, ...DEFAULT_ICON_POSITIONS.aiChat, ...value.aiChat, kind: 'app' }
  } satisfies PublicUser['desktopIcons'];
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

function isAudioStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('audio/') || item.content?.startsWith('data:audio/'));
}

function isImageStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('image/') || item.content?.startsWith('data:image/'));
}

function isVideoStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('video/') || item.content?.startsWith('data:video/'));
}

function now() {
  return new Date().toISOString();
}

function makeStorageId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureDesktopFolder(items: StorageItem[]) {
  if (items.some((item) => item.id === DESKTOP_FOLDER_ID)) return items;
  const timestamp = now();
  return [
    ...items,
    {
      id: DESKTOP_FOLDER_ID,
      type: 'folder' as const,
      name: 'Desktop',
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
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

function notificationMessage(message: Pick<MessengerMessage, 'body' | 'imageData'>, language: Language) {
  return message.body || (message.imageData ? t(language, 'imageMessage') : '');
}

// Field-by-field nameplate comparison — avoids JSON.stringify on every render.
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

export function Desktop({ token, user, language, notice, onNoticeClose, onUserChange, onLogout }: DesktopProps) {
  const desktopRef = useRef<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<DesktopContextMenu | null>(null);
  const [settingsWindow, setSettingsWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [settingsMaximized, setSettingsMaximized] = useState(() => loadWindowMaximized().settings ?? false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [nicknameDraft, setNicknameDraft] = useState(user.nickname);
  const [nameStyleDraft, setNameStyleDraft] = useState<NameStyle>(user.nameStyle ?? null);
  const [profilePrimaryDraft, setProfilePrimaryDraft] = useState(user.profilePrimaryColor || '#2AABEE');
  const [profileAccentDraft, setProfileAccentDraft] = useState(user.profileAccentColor || '#5865F2');
  const [nameplateDraft, setNameplateDraft] = useState<NonNullable<NamePlate>>(user.nameplate ?? DEFAULT_NAMEPLATE);
  const [nameStyleModalOpen, setNameStyleModalOpen] = useState(false);
  const [confirmDeleteNameStyle, setConfirmDeleteNameStyle] = useState(false);
  const [statusDraft, setStatusDraft] = useState(user.status ?? '');
  const [avatarDraft, setAvatarDraft] = useState(user.avatarData);
  const [wallpaperDraft, setWallpaperDraft] = useState(user.wallpaper);
  const [recentWallpapers, setRecentWallpapers] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_WALLPAPERS_KEY) ?? '[]'); } catch { return []; }
  });
  const [languageDraft, setLanguageDraft] = useState<Language>(user.language);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(getSavedTimeFormat);
  const clock = useClock(language, getSavedTimeFormat());
  const [themeDraft, setThemeDraft] = useState<Theme>(user.theme);
  const [accentColorDraft, setAccentColorDraft] = useState(user.accentColor);
  const [transparencyDraft, setTransparencyDraft] = useState(user.transparencyEnabled);
  const [iconSizeDraft, setIconSizeDraft] = useState<DesktopIconSize>(user.desktopIconSize);
  const [hideIconsDraft, setHideIconsDraft] = useState(user.hideDesktopIcons);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [storageWindow, setStorageWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [storageMaximized, setStorageMaximized] = useState(() => loadWindowMaximized().explorer ?? false);
  const [explorerFolderId, setExplorerFolderId] = useState<string | null>(null);
  const [messengerWindow, setMessengerWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [messengerMaximized, setMessengerMaximized] = useState(() => loadWindowMaximized().messenger ?? false);
  const [remoteDesktopWindow, setRemoteDesktopWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [remoteDesktopMaximized, setRemoteDesktopMaximized] = useState(() => loadWindowMaximized()['remote-desktop'] ?? false);
  const [remoteDesktopUser, setRemoteDesktopUser] = useState<PublicUser | null>(null);
  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null);
  const [messengerChatRequest, setMessengerChatRequest] = useState<{ userId: string; requestId: number } | null>(null);
  const [notepadWindow, setNotepadWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [notepadMaximized, setNotepadMaximized] = useState(() => loadWindowMaximized().notepad ?? false);
  const [notepadItemId, setNotepadItemId] = useState<string | null>(null);
  const [notepadTitle, setNotepadTitle] = useState(t(language, 'notepad'));
  const [musicPlayerWindow, setMusicPlayerWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [musicPlayerMaximized, setMusicPlayerMaximized] = useState(() => loadWindowMaximized()['music-player'] ?? false);
  const [musicPlayerInitialTrackId, setMusicPlayerInitialTrackId] = useState<string | null>(null);
  const [imageViewerWindow, setImageViewerWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [imageViewerMaximized, setImageViewerMaximized] = useState(() => loadWindowMaximized()['image-viewer'] ?? false);
  const [aiChatWindow, setAiChatWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [aiChatMaximized, setAiChatMaximized] = useState(() => loadWindowMaximized()['ai-chat'] ?? false);
  const [imageViewerItemId, setImageViewerItemId] = useState<string | null>(null);
  const [videoViewerWindow, setVideoViewerWindow] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [videoViewerMaximized, setVideoViewerMaximized] = useState(() => loadWindowMaximized()['video-viewer'] ?? false);
  const [videoViewerItemId, setVideoViewerItemId] = useState<string | null>(null);
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
  const [windowZ, setWindowZ] = useState({ settings: 1010, explorer: 1011, notepad: 1012, messenger: 1013, remoteDesktop: 1014, musicPlayer: 1015, imageViewer: 1016, aiChat: 1017, videoViewer: 1018 });
  const [nextZ, setNextZ] = useState(1020);
  const [iconPositions, setIconPositions] = useState<PublicUser['desktopIcons']>(() => normalizeIconPositions(user.desktopIcons));
  const [selectedIconIds, setSelectedIconIds] = useState<DesktopIconId[]>([]);
  const [renamingIconId, setRenamingIconId] = useState<DesktopIconId | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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
  const [legalContent, setLegalContent] = useState<'privacy' | 'terms' | null>(null);
  const [pinModal, setPinModal] = useState<'create' | 'change' | null>(null);
  const [pinDisableModal, setPinDisableModal] = useState(false);
  const [pinEnabled, setPinEnabled] = useState<boolean>(() => hasPin(user.id));
  const [pinStatusMessage, setPinStatusMessage] = useState('');
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [storageItems, setStorageItems] = useState<StorageItem[]>([]);
  const [storageAudioFiles, setStorageAudioFiles] = useState<StorageItem[]>([]);
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
  // What's New / updates center. `updatesInitialId` is set to the latest update
  // id when auto-opened on login (so it opens expanded), null when opened from
  // the desktop shortcut (so it shows the full list).
  const [updatesWindowOpen, setUpdatesWindowOpen] = useState(false);
  const [updatesInitialId, setUpdatesInitialId] = useState<string | null>(null);
  const [taskbarMenu, setTaskbarMenu] = useState<{ x: number; y: number } | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    setStatusDraft(user.status ?? '');
  }, [user.status, user.id]);

  useEffect(() => {
    localStorage.setItem(RECENT_WALLPAPERS_KEY, JSON.stringify(recentWallpapers));
  }, [recentWallpapers]);

  // Debounced: write to localStorage at most once per 300 ms instead of on
  // every individual window maximize/restore event.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveWindowMaximized({
        settings: settingsMaximized,
        explorer: storageMaximized,
        messenger: messengerMaximized,
        'remote-desktop': remoteDesktopMaximized,
        notepad: notepadMaximized,
        'music-player': musicPlayerMaximized,
        'image-viewer': imageViewerMaximized,
        'ai-chat': aiChatMaximized,
        'video-viewer': videoViewerMaximized
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settingsMaximized, storageMaximized, messengerMaximized, remoteDesktopMaximized, notepadMaximized, musicPlayerMaximized, imageViewerMaximized, aiChatMaximized, videoViewerMaximized]);

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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);

  const desktopIcons = useMemo(
    () => {
      const builtinIcons = [
      { id: 'messenger' as const, letters: 'M', label: t(language, 'messenger'), iconType: 'messenger' },
      { id: 'storage' as const, letters: 'DB', label: t(language, 'storage'), iconType: 'storage' },
      { id: 'musicPlayer' as const, letters: 'MP', label: t(language, 'musicPlayer'), iconType: 'music-player' },
      { id: 'aiChat' as const, letters: 'AI', label: t(language, 'aiChat'), iconType: 'ai-chat' },
      { id: 'updates' as const, letters: '★', label: t(language, 'updates'), iconType: 'updates' }
      ];
      const fileIcons = Object.entries(iconPositions)
        .filter(([id, value]) => id.startsWith('file:') && value.kind === 'storage-item')
        .map(([id, value]) => {
          const item = storageItems.find((candidate) => candidate.id === value.storageItemId);
          const audio = item ? isAudioStorageItem(item) : false;
          const image = item ? isImageStorageItem(item) : false;
          const video = item ? isVideoStorageItem(item) : false;

          return {
            id,
            letters: value.itemType === 'folder' ? 'DIR' : value.itemType === 'text' ? 'TXT' : audio ? 'MP' : image ? 'IMG' : video ? 'VID' : 'FILE',
            label: value.label ?? t(language, 'textFile'),
            iconType: value.itemType === 'file' && audio ? 'music-player' : value.itemType === 'file' && image ? 'image' : value.itemType === 'file' && video ? 'video' : value.itemType ?? 'text'
          };
        });
      return [...builtinIcons, ...fileIcons];
    },
    [iconPositions, language, storageItems]
  );

  const iconMetrics = ICON_METRICS[user.desktopIconSize] ?? ICON_METRICS.medium;
  const imageViewerItem = useMemo(() => storageItems.find((item) => item.id === imageViewerItemId) ?? null, [imageViewerItemId, storageItems]);
  const videoViewerItem = useMemo(() => storageItems.find((item) => item.id === videoViewerItemId) ?? null, [videoViewerItemId, storageItems]);

  // Restore every settings draft to the persisted user values. Used both when
  // `user` changes and when the user clicks "Reset" in the save bar.
  function resetSettingsDrafts() {
    setNicknameDraft(user.nickname);
    setNameStyleDraft(user.nameStyle ?? null);
    setProfilePrimaryDraft(user.profilePrimaryColor || '#2AABEE');
    setProfileAccentDraft(user.profileAccentColor || '#5865F2');
    setNameplateDraft(user.nameplate ?? DEFAULT_NAMEPLATE);
    setStatusDraft(user.status ?? '');
    setAvatarDraft(user.avatarData);
    setWallpaperDraft(user.wallpaper);
    setLanguageDraft(user.language);
    setThemeDraft(user.theme);
    setAccentColorDraft(user.accentColor);
    setTransparencyDraft(user.transparencyEnabled);
    setIconSizeDraft(user.desktopIconSize);
    setHideIconsDraft(user.hideDesktopIcons);
    setTimeFormat(getSavedTimeFormat());
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
    setPinnedCards(Array.isArray(user.pinnedCards) ? user.pinnedCards : []);
    setIconPositions(normalizeIconPositions(user.desktopIcons));
  }, [user.accentColor, user.avatarData, user.desktopIconSize, user.desktopIcons, user.hideDesktopIcons, user.language, user.nickname, user.nameStyle, user.pinnedCards, user.profilePrimaryColor, user.profileAccentColor, user.theme, user.transparencyEnabled, user.wallpaper]);

  // True when any settings draft differs from the persisted user values.
  const settingsDirty = useMemo(() => {
    return (
      nicknameDraft.trim() !== user.nickname ||
      statusDraft.trim() !== (user.status ?? '').trim() ||
      avatarDraft !== user.avatarData ||
      wallpaperDraft !== user.wallpaper ||
      languageDraft !== user.language ||
      themeDraft !== user.theme ||
      accentColorDraft !== user.accentColor ||
      transparencyDraft !== user.transparencyEnabled ||
      iconSizeDraft !== user.desktopIconSize ||
      hideIconsDraft !== user.hideDesktopIcons ||
      (nameStyleDraft ?? null) !== (user.nameStyle ?? null) ||
      profilePrimaryDraft !== (user.profilePrimaryColor || '#2AABEE') ||
      profileAccentDraft !== (user.profileAccentColor || '#5865F2') ||
      // Compare nameplate field-by-field to avoid JSON.stringify on every render.
      nameplateIsDirty(nameplateDraft, user.nameplate ?? DEFAULT_NAMEPLATE) ||
      timeFormat !== getSavedTimeFormat()
    );
  }, [nicknameDraft, statusDraft, avatarDraft, wallpaperDraft, languageDraft, themeDraft, accentColorDraft, transparencyDraft, iconSizeDraft, hideIconsDraft, nameStyleDraft, profilePrimaryDraft, profileAccentDraft, nameplateDraft, timeFormat, user]);

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
    void api.getStorage(token).then((payload) => {
      if (!alive) return;
      const items = ensureDesktopFolder(payload.items);
      setStorageItems(items);
      setStorageAudioFiles(items.filter(isAudioStorageItem));
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
    if (activeTab !== 'music') return;
    void refreshStorageAudioFiles();
  }, [activeTab]);

  useEffect(() => {
    if (!volumeOpen) return;

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (playerRef.current?.contains(event.target as Node)) return;
      setVolumeOpen(false);
    }

    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, [volumeOpen]);

  function bringToFront(windowName: keyof typeof windowZ) {
    const zIndex = nextZ + 1;
    setNextZ(zIndex);
    setWindowZ((value) => ({ ...value, [windowName]: zIndex }));
  }

  function pushNotification(notification: Omit<DesktopNotification, 'id'>) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setNotifications((current) => [...current.slice(-3), { id, ...notification }]);
    window.setTimeout(() => setNotifications((current) => current.filter((item) => item.id !== id)), 5200);
  }

  // Register socket event listeners on the shared socket from SocketProvider.
  // No longer creates its own io() connection — that is handled by SocketProvider.
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

    function onStorageChanged(payload: StoragePayload) {
      const items = ensureDesktopFolder(payload.items);
      setStorageItems(items);
      setStorageAudioFiles(items.filter(isAudioStorageItem));
    }

    function onMessengerMessage(payload: { message: MessengerMessage }) {
      if (payload.message.senderId === user.id) return;
      if (messengerWindow === 'open' && activeChatUserId === payload.message.senderId) return;
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

    function onPresenceSnapshot(payload: { onlineUserIds: string[] }) {
      setOnlineUserIds(payload.onlineUserIds);
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

    function onPresenceChanged(payload: { userId: string; online: boolean }) {
      setOnlineUserIds((current) => {
        if (payload.online) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((userId) => userId !== payload.userId);
      });
    }

    socket.on('system:ready', onReady);
    socket.on('desktop:watchers', onWatchers);
    socket.on('desktop:cursor', onCursor);
    socket.on('desktop:cursorLeave', onCursorLeave);
    socket.on('desktop:settingsChanged', onSettingsChanged);
    socket.on('desktop:userChanged', onUserChanged);
    socket.on('storage:changed', onStorageChanged);
    socket.on('messenger:message', onMessengerMessage);
    socket.on('presence:snapshot', onPresenceSnapshot);
    socket.on('call:incoming', onCallIncoming);
    socket.on('call:ended', dismissCallToast);
    socket.on('call:accepted', dismissCallToast);
    socket.on('presence:changed', onPresenceChanged);

    // Emit screen size immediately in case 'system:ready' already fired.
    socket.emit('desktop:screen', { width: window.innerWidth, height: window.innerHeight });

    return () => {
      socket.off('system:ready', onReady);
      socket.off('desktop:watchers', onWatchers);
      socket.off('desktop:cursor', onCursor);
      socket.off('desktop:cursorLeave', onCursorLeave);
      socket.off('desktop:settingsChanged', onSettingsChanged);
      socket.off('desktop:userChanged', onUserChanged);
      socket.off('storage:changed', onStorageChanged);
      socket.off('messenger:message', onMessengerMessage);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('call:incoming', onCallIncoming);
      socket.off('call:ended', dismissCallToast);
      socket.off('call:accepted', dismissCallToast);
      socket.off('presence:changed', onPresenceChanged);
    };
  }, [activeChatUserId, language, messengerWindow, onUserChange, sharedSocket, token, user.id]);

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
    function handleResize() {
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
  }, []);

  function openContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    // Do not open the desktop menu when a blocking modal/window is in front.
    // The settings window is a draggable, non-blocking window, so right-clicking
    // the desktop background should still open the desktop menu.
    if (updatesWindowOpen || profileModalUser || notice) return;
    const target = event.target as HTMLElement;
    if (target.closest('.window-frame, .messenger-window, .explorer-window, .notepad-window, .remote-desktop-window, .music-player-window, .image-viewer-window, .modal-backdrop, .desktop-wall-shell, .taskbar')) return;
    setContextMenu({
      type: 'desktop',
      x: Math.min(event.clientX, window.innerWidth - 250),
      y: Math.min(event.clientY, window.innerHeight - 160)
    });
  }

  function canDropIconOnDesktop(target: Element | null) {
    return Boolean(target?.closest('.desktop')) && !target?.closest('.window-frame, .messenger-window, .explorer-window, .notepad-window, .remote-desktop-window, .music-player-window, .image-viewer-window, .desktop-wall-shell, .taskbar');
  }

  function finishIconDrag(currentDrag: IconDragState, clientX: number, clientY: number) {
    const dx = clientX - currentDrag.startX;
    const dy = clientY - currentDrag.startY;
    const nextPositions = { ...iconPositions };

    for (const id of currentDrag.ids) {
      const base = currentDrag.basePositions[id];
      if (!base) continue;
      nextPositions[id] = { ...nextPositions[id], x: Math.max(8, base.x + dx), y: Math.max(8, base.y + dy) };
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
  }, [dragState, iconPositions, onUserChange, token]);

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

  function openSettings(tab: SettingsTab) {
    setActiveTab(tab);
    setSettingsError('');
    setSettingsWindow('open');
    bringToFront('settings');
    setContextMenu(null);
  }

  function openExplorer(folderId: string | null = null) {
    setExplorerFolderId(folderId);
    setStorageWindow('open');
    bringToFront('explorer');
  }

  function openMessenger() {
    setMessengerWindow('open');
    bringToFront('messenger');
  }

  function openUpdates() {
    setUpdatesInitialId(null);
    setUpdatesWindowOpen(true);
  }

  function closeUpdates() {
    setUpdatesWindowOpen(false);
    markUpdatesSeen();
  }

  function openMessengerChat(userId: string) {
    setMessengerChatRequest((current) => ({ userId, requestId: (current?.requestId ?? 0) + 1 }));
    setMessengerWindow('open');
    bringToFront('messenger');
  }

  function openMusicPlayer(trackId?: string | null) {
    if (trackId) setMusicPlayerInitialTrackId(trackId);
    setMusicPlayerWindow('open');
    bringToFront('musicPlayer');
  }

  function openAiChat() {
    setAiChatWindow('open');
    bringToFront('aiChat');
  }

  function openNotepad(itemId: string, title?: string) {
    setNotepadItemId(itemId);
    setNotepadTitle(title ?? t(language, 'notepad'));
    setNotepadWindow('open');
    bringToFront('notepad');
  }

  function openImageViewer(itemId: string) {
    setImageViewerItemId(itemId);
    setImageViewerWindow('open');
    bringToFront('imageViewer');
  }

  function openVideoViewer(itemId: string) {
    setVideoViewerItemId(itemId);
    setVideoViewerWindow('open');
    bringToFront('videoViewer');
  }

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

  function pinImage(item: StorageItem) {
    if (!item.content) return;
    const previous = pinnedCards;
    const newCard: PinnedCard = {
      id: makeCardId(),
      imageData: item.content,
      name: item.name,
      kind: 'image',
      // New cards are nudged so they do not stack exactly on existing ones.
      x: Math.min(0.6, 0.04 + previous.length * 0.03),
      y: Math.min(0.6, 0.12 + previous.length * 0.03),
      width: 200,
      height: 160
    };
    const next = [...previous, newCard];
    setPinnedCards(next);
    setImageViewerWindow('closed');
    api.updateMe(token, { pinnedCards: next })
      .then((result) => {
        onUserChange(result.user);
        broadcastPinnedCards(next.map(currentCardPlacement), true);
      })
      .catch(() => {
        setPinnedCards(previous);
        pushNotification({ title: t(language, 'pinToDesktop'), message: t(language, 'pinImageFailed') });
      });
  }

  function pinVideo(item: StorageItem) {
    if (!item.content) return;
    const previous = pinnedCards;
    const newCard: PinnedCard = {
      id: makeCardId(),
      imageData: item.content,
      name: item.name,
      kind: 'video',
      x: Math.min(0.6, 0.04 + previous.length * 0.03),
      y: Math.min(0.6, 0.12 + previous.length * 0.03),
      width: 240,
      height: 160
    };
    const next = [...previous, newCard];
    setPinnedCards(next);
    setVideoViewerWindow('closed');
    api.updateMe(token, { pinnedCards: next })
      .then((result) => {
        onUserChange(result.user);
        broadcastPinnedCards(next.map(currentCardPlacement), true);
      })
      .catch(() => {
        setPinnedCards(previous);
        pushNotification({ title: t(language, 'pinToDesktop'), message: t(language, 'pinVideoFailed') });
      });
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
    const result = await api.updateMe(token, { desktopIconSize: nextSize });
    onUserChange(result.user);
  }

  async function toggleHideDesktopIcons(nextValue: boolean) {
    setHideIconsDraft(nextValue);
    const result = await api.updateMe(token, { hideDesktopIcons: nextValue });
    onUserChange(result.user);
  }

  function sortedIcons(sortBy: DesktopSort) {
    const appOrder = { messenger: 0, storage: 1, musicPlayer: 2 };
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
    const nextPositions = { ...iconPositions };
    sortedIcons(sortBy).forEach((icon, index) => {
      const column = Math.floor(index / 6);
      const row = index % 6;
      nextPositions[icon.id] = {
        ...nextPositions[icon.id],
        x: 18 + column * (metrics.width + 18),
        y: 18 + row * (metrics.height + metrics.gap)
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

  async function refreshStorageAudioFiles() {
    const payload = await api.getStorage(token);
    const items = ensureDesktopFolder(payload.items);
    setStorageItems(items);
    setStorageAudioFiles(items.filter(isAudioStorageItem));
  }

  async function saveStorageItems(nextItems: StorageItem[]) {
    const items = ensureDesktopFolder(nextItems);
    setStorageItems(items);
    const payload = await api.updateStorage(token, { items });
    const savedItems = ensureDesktopFolder(payload.items);
    setStorageItems(savedItems);
    setStorageAudioFiles(savedItems.filter(isAudioStorageItem));
  }

  function shortcutMeta(item: StorageItem, x: number, y: number, index = 0) {
    const bounds = desktopRef.current?.getBoundingClientRect();
    const relativeX = bounds ? x - bounds.left : x;
    const relativeY = bounds ? y - bounds.top : y;

    return {
      x: Math.max(8, relativeX - iconMetrics.width / 2 + index * Math.min(iconMetrics.width + 10, 132)),
      y: Math.max(8, relativeY - iconMetrics.height / 2),
      kind: 'storage-item' as const,
      storageItemId: item.id,
      label: item.name,
      itemType: item.type,
      size: item.size ?? item.content?.length ?? 0,
      updatedAt: item.updatedAt
    };
  }

  async function updateDesktopShortcutsForItems(items: StorageItem[], x: number, y: number) {
    const nextPositions = { ...iconPositions };
    items.forEach((item, index) => {
      nextPositions[`file:${item.id}`] = shortcutMeta(item, x, y, index);
    });
    setIconPositions(nextPositions);
    const result = await api.updateMe(token, { desktopIcons: nextPositions });
    onUserChange(result.user);
  }

  async function placeStorageItemOnDesktop(item: StorageItem, x: number, y: number) {
    if (item.id === DESKTOP_FOLDER_ID) return;
    const timestamp = now();
    const updatedItem = { ...item, parentId: DESKTOP_FOLDER_ID, updatedAt: timestamp };
    const nextItems = ensureDesktopFolder(storageItems).map((candidate) => (candidate.id === item.id ? updatedItem : candidate));
    await saveStorageItems(nextItems);
    await updateDesktopShortcutsForItems([updatedItem], x, y);
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

  async function importFilesToDesktop(files: FileList, x: number, y: number) {
    const incoming = Array.from(files);
    const oversized = incoming.find((file) => file.size > maxImportSizeForFile(file));
    if (oversized) {
      const limitMb = Math.round(maxImportSizeForFile(oversized) / (1024 * 1024));
      window.alert(`${oversized.name}: ${t(language, 'fileTooLargeLimit', { limit: String(limitMb) })}`);
      return;
    }

    // Drive the thin top progress bar across the read phase of every file plus
    // a final save phase, so the bar fills smoothly left-to-right.
    const totalBytes = incoming.reduce((sum, file) => sum + file.size, 0) || 1;
    const readBytes = new Array(incoming.length).fill(0);
    // The read phase represents 90% of the bar; the save phase the last 10%.
    const reportRead = () => {
      const done = readBytes.reduce((sum, value) => sum + value, 0);
      beginOrUpdateUpload((done / totalBytes) * 0.9);
    };
    beginOrUpdateUpload(0);

    try {
      const timestamp = now();
      const imported = await Promise.all(
        incoming.map(async (file, index) => {
          const mimeType = inferMimeType(file);
          const dataUrl = await readFileAsDataUrl(file, (fraction) => {
            readBytes[index] = fraction * file.size;
            reportRead();
          });
          readBytes[index] = file.size;
          reportRead();
          return {
            id: makeStorageId(),
            type: 'file' as const,
            name: file.name,
            parentId: DESKTOP_FOLDER_ID,
            content: dataUrlWithMime(dataUrl, mimeType),
            mimeType,
            size: file.size,
            createdAt: timestamp,
            updatedAt: timestamp
          };
        })
      );

      beginOrUpdateUpload(0.92);
      await saveStorageItems([...ensureDesktopFolder(storageItems), ...imported]);
      await updateDesktopShortcutsForItems(imported, x, y);
      finishUpload();
    } catch (error) {
      finishUpload();
      window.alert(getErrorMessage(error, language));
    }
  }

  async function addTrackFromStorage(item: StorageItem) {
    if (!item.content) return;
    const added = await addMusicTrack(user.id, { storageItemId: item.id, name: item.name, dataUrl: item.content });
    setMusicTracks((current) => [...current.filter((track) => track.storageItemId !== item.id), added]);
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

  function openShortcut(iconId: string) {
    if (iconId === 'storage') {
      openExplorer(null);
      return;
    }
    if (iconId === 'messenger') {
      openMessenger();
      return;
    }
    if (iconId === 'musicPlayer') {
      openMusicPlayer();
      return;
    }
    if (iconId === 'aiChat') {
      openAiChat();
      return;
    }
    if (iconId === 'updates') {
      openUpdates();
      return;
    }
    const shortcut = iconPositions[iconId];
    if (shortcut?.itemType === 'folder' && shortcut.storageItemId) openExplorer(shortcut.storageItemId);
    if (shortcut?.itemType === 'text' && shortcut.storageItemId) openNotepad(shortcut.storageItemId, shortcut.label);
    if (shortcut?.itemType === 'file' && shortcut.storageItemId) {
      const item = storageItems.find((candidate) => candidate.id === shortcut.storageItemId);
      if (item && isAudioStorageItem(item)) openMusicPlayer(item.id);
      if (item && isImageStorageItem(item)) openImageViewer(item.id);
      if (item && isVideoStorageItem(item)) openVideoViewer(item.id);
    }
  }

  // Built-in app shortcuts cannot be renamed or deleted.
  function isBuiltinApp(iconId: string) {
    return iconId === 'messenger' || iconId === 'storage' || iconId === 'musicPlayer' || iconId === 'updates' || iconId === 'aiChat';
  }

  // App shortcuts (messenger/storage/musicPlayer/updates) are not renameable.
  function canRenameShortcut(iconId: string) {
    return iconId.startsWith('file:');
  }

  // Returns the extension part (".jpg", ".mp3", ...) that must not be edited.
  function shortcutExtension(iconId: string) {
    const meta = iconPositions[iconId];
    // Only real files carry an extension; folders and text notes do not.
    if (!meta || meta.itemType !== 'file') return '';
    const label = meta.label ?? '';
    const dot = label.lastIndexOf('.');
    if (dot <= 0 || dot === label.length - 1) return '';
    return label.slice(dot);
  }

  function beginRenameShortcut(iconId: string) {
    if (!canRenameShortcut(iconId)) return;
    const currentName = iconPositions[iconId]?.label ?? desktopIcons.find((icon) => icon.id === iconId)?.label ?? '';
    const ext = shortcutExtension(iconId);
    // Edit only the base name; the extension is kept and re-appended on commit.
    setRenameDraft(ext ? currentName.slice(0, currentName.length - ext.length) : currentName);
    setRenamingIconId(iconId);
    setContextMenu(null);
  }

  async function commitRenameShortcut(iconId: string) {
    const ext = shortcutExtension(iconId);
    const base = renameDraft.trim();
    setRenamingIconId(null);
    if (!base) return;
    const nextName = `${base}${ext}`;
    if (nextName === iconPositions[iconId]?.label) return;

    const nextPositions = { ...iconPositions, [iconId]: { ...iconPositions[iconId], label: nextName } };
    setIconPositions(nextPositions);

    // Keep the underlying storage item name in sync when possible.
    const storageItemId = iconPositions[iconId]?.storageItemId;
    if (storageItemId) {
      const target = storageItems.find((candidate) => candidate.id === storageItemId);
      if (target && target.name !== nextName) {
        void saveStorageItems(storageItems.map((item) => (item.id === storageItemId ? { ...item, name: nextName, updatedAt: now() } : item)));
      }
    }

    const result = await api.updateMe(token, { desktopIcons: nextPositions });
    onUserChange(result.user);
  }

  async function deleteShortcut(iconId: string) {
    if (isBuiltinApp(iconId)) return;
    setContextMenu(null);
    const nextPositions = { ...iconPositions };
    delete nextPositions[iconId];
    // Apply the removal optimistically and keep it: the desktop icon list is
    // derived from `iconPositions`, so removing the entry here makes the
    // shortcut disappear immediately and stay gone.
    setIconPositions(nextPositions);
    setSelectedIconIds((ids) => ids.filter((id) => id !== iconId));
    try {
      const result = await api.updateMe(token, { desktopIcons: nextPositions });
      onUserChange(result.user);
    } catch {
      // On failure, restore the shortcut so the desktop stays consistent.
      setIconPositions(iconPositions);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setSettingsError('');

    try {
      const result = await api.updateMe(token, {
        nickname: nicknameDraft.trim(),
        status: statusDraft.trim(),
        avatarData: avatarDraft,
        wallpaper: wallpaperDraft,
        language: languageDraft,
        theme: themeDraft,
        accentColor: accentColorDraft,
        transparencyEnabled: transparencyDraft,
        desktopIconSize: iconSizeDraft,
        hideDesktopIcons: hideIconsDraft,
        desktopIcons: iconPositions,
        nameStyle: nameStyleDraft,
        profilePrimaryColor: profilePrimaryDraft,
        profileAccentColor: profileAccentDraft,
        nameplate: nameplateDraft
      });
      onUserChange(result.user);
      saveTimeFormat(timeFormat);
      void saveMusicTracksOrder(user.id, musicTracks);
    } catch (error) {
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

  function createStorageShortcut(item: StorageItem, x: number, y: number) {
    const bounds = desktopRef.current?.getBoundingClientRect();
    const relativeX = bounds ? x - bounds.left : x;
    const relativeY = bounds ? y - bounds.top : y;
    const id = `file:${item.id}`;
    const nextPositions = {
      ...iconPositions,
      [id]: {
        x: Math.max(8, relativeX - iconMetrics.width / 2),
        y: Math.max(8, relativeY - iconMetrics.height / 2),
        kind: 'storage-item' as const,
        storageItemId: item.id,
        label: item.name,
        itemType: item.type,
        size: item.size ?? item.content?.length ?? 0,
        updatedAt: item.updatedAt
      }
    };

    setIconPositions(nextPositions);
    void api.updateMe(token, { desktopIcons: nextPositions }).then((result) => onUserChange(result.user));
  }

  function openRemoteDesktopWindow(owner: PublicUser) {
    setRemoteDesktopUser(owner);
    setRemoteDesktopWindow('open');
    bringToFront('remoteDesktop');
  }

  async function openRemoteDesktopById(remoteUserId: string) {
    try {
      const result = await api.getPublicUser(token, remoteUserId);
      openRemoteDesktopWindow(result.user);
    } catch (error) {
      window.alert(getErrorMessage(error, language));
    }
  }

  function viewRemoteDesktop(owner: PublicUser) {
    openRemoteDesktopWindow(owner);
  }

  return (
    <main
      ref={desktopRef}
      className="desktop"
      style={{ backgroundImage: wallpaperToBackground(user.wallpaper, user.theme) }}
      onContextMenu={openContextMenu}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/notoc-storage-item') || Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void importFilesToDesktop(event.dataTransfer.files, event.clientX, event.clientY);
          return;
        }

        const raw = event.dataTransfer.getData('application/notoc-storage-item');
        if (!raw) return;
        event.preventDefault();
        void placeStorageItemOnDesktop(JSON.parse(raw) as StorageItem, event.clientX, event.clientY);
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('.desktop-tile, .taskbar, .desktop-wall-shell, .settings-window, .notice-window, .explorer-window, .notepad-window, .messenger-window, .remote-desktop-window, .music-player-window, .image-viewer-window, .ai-chat-window, .window-frame, .context-menu, .desktop-profile-info')) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        setSelectedIconIds([]);
        setSelectionStart({ x, y });
        setSelectionRect({ x, y, width: 0, height: 0 });
      }}
      onClick={() => setContextMenu(null)}
    >
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
          onOpenProfile={(author) => setProfileModalUser(author)}
        />

      <section className={`${dragState?.moved ? 'desktop-icons dragging' : 'desktop-icons'} icon-size-${user.desktopIconSize}`} aria-label={t(language, 'desktopSettings')} hidden={user.hideDesktopIcons}>
        {!user.hideDesktopIcons && desktopIcons.map((icon) => (
          <button
            key={icon.id}
            className={selectedIconIds.includes(icon.id) ? 'desktop-tile selected' : 'desktop-tile'}
            style={{
              left: iconPositions[icon.id].x,
              top: iconPositions[icon.id].y,
              transform: dragState?.ids.includes(icon.id) ? `translate3d(${dragDelta.x}px, ${dragDelta.y}px, 0)` : undefined
            }}
            type="button"
            draggable={false}
            data-dragging={dragState?.ids.includes(icon.id) ? 'true' : undefined}
            onDragStart={(event) => {
              event.preventDefault();
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              const ids = selectedIconIds.includes(icon.id) ? selectedIconIds : [icon.id];
              setSelectedIconIds(ids);
              // Reveal the full label of the icon the user clicked; clicking
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
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedIconIds([icon.id]);
              setContextMenu({ type: 'shortcut', iconId: icon.id, x: event.clientX, y: event.clientY });
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              openShortcut(icon.id);
            }}
          >
            <span className={`tile-icon tile-icon-${icon.iconType}`}>{icon.letters}</span>
            {renamingIconId === icon.id ? (
              <input
                className="desktop-tile-rename"
                autoFocus
                value={renameDraft}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={() => void commitRenameShortcut(icon.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitRenameShortcut(icon.id);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setRenamingIconId(null);
                  }
                }}
              />
            ) : (
              <span className={selectedIconIds.length === 1 && selectedIconIds[0] === icon.id ? 'tile-label expanded' : 'tile-label'} title={icon.label}>{icon.label}</span>
            )}
          </button>
        ))}
      </section>

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
              <button type="button" onClick={() => openShortcut(contextMenu.iconId)}>{t(language, 'open')}</button>
              {canRenameShortcut(contextMenu.iconId) ? (
                <button type="button" onClick={() => beginRenameShortcut(contextMenu.iconId)}>{t(language, 'rename')}</button>
              ) : null}
              {!isBuiltinApp(contextMenu.iconId) ? (
                <button className="danger-text" type="button" onClick={() => void deleteShortcut(contextMenu.iconId)}>{t(language, 'delete')}</button>
              ) : null}
            </>
          ) : (
            <>
              <div className="context-submenu-host">
                <button type="button">{t(language, 'view')} <span>›</span></button>
                <div className="context-submenu">
                  <button type="button" onClick={() => void applyDesktopView('small')}>{user.desktopIconSize === 'small' ? '✓ ' : ''}{t(language, 'smallIcons')}</button>
                  <button type="button" onClick={() => void applyDesktopView('medium')}>{user.desktopIconSize === 'medium' ? '✓ ' : ''}{t(language, 'mediumIcons')}</button>
                  <button type="button" onClick={() => void applyDesktopView('large')}>{user.desktopIconSize === 'large' ? '✓ ' : ''}{t(language, 'largeIcons')}</button>
                  <button type="button" onClick={() => void toggleHideDesktopIcons(!user.hideDesktopIcons)}>
                    {user.hideDesktopIcons ? '✓ ' : ''}{t(language, 'hideShortcuts')}
                  </button>
                </div>
              </div>
              <div className="context-submenu-host">
                <button type="button">{t(language, 'sortBy')} <span>›</span></button>
                <div className="context-submenu">
                  <button type="button" onClick={() => void applySort('name')}>{t(language, 'sortName')}</button>
                  <button type="button" onClick={() => void applySort('type')}>{t(language, 'sortType')}</button>
                  <button type="button" onClick={() => void applySort('size')}>{t(language, 'sortSize')}</button>
                  <button type="button" onClick={() => void applySort('date')}>{t(language, 'sortDate')}</button>
                </div>
              </div>
              <button type="button" onClick={() => openSettings('desktop')}>{t(language, 'openSettings')}</button>
              <button type="button" onClick={() => openExplorer(null)}>{t(language, 'openStorage')}</button>
            </>
          )}
        </div>
      ) : null}

      {settingsWindow === 'open' ? (
        <WindowFrame
          language={language}
          title={t(language, 'settings')}
          eyebrow=""
          className="settings-window"
          maximized={settingsMaximized}
          zIndex={windowZ.settings}
          defaultPosition={{ x: Math.max(32, window.innerWidth / 2 - 380), y: 64 }}
          storageKey="settings"
          onFocus={() => bringToFront('settings')}
          onClose={requestCloseSettingsWindow}
          onMinimize={() => setSettingsWindow('minimized')}
          onToggleMaximize={() => setSettingsMaximized((value) => !value)}
        >
              <div className="settings-shell">
              <div className="settings-sidebar">
                <button className={activeTab === 'profile' ? 'settings-profile-head active' : 'settings-profile-head'} type="button" onClick={() => setActiveTab('profile')}>
                  <img className="settings-avatar-small" src={avatarDraft} alt="" />
                  <div className="settings-profile-info">
                    <strong>{user.nickname}</strong>
                    <span>{t(language, 'editProfile')}</span>
                  </div>
                </button>
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
                      <button
                        key={tab.id}
                        className={activeTab === tab.id ? 'settings-tab active' : 'settings-tab'}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {t(language, tab.labelKey)}
                      </button>
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

              <div className="settings-content">
                {activeTab === 'profile' ? (
                  <section className="settings-section">
                    <h3>{t(language, 'profile')}</h3>
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
                        <p className="field-label">{t(language, 'displayNameStyles')}</p>
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
                        <p className="field-label">{t(language, 'profileTheme')}</p>
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

                        <p className="field-label">{t(language, 'nameplate')}</p>
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

                        <label className="field-label" htmlFor="settings-status">
                          {t(language, 'profileStatus')}
                    </label>
                    <textarea
                      id="settings-status"
                      className="text-field"
                      value={statusDraft}
                      maxLength={200}
                      rows={3}
                      onChange={(event) => setStatusDraft(event.target.value)}
                    />
                    </div>
                    <div className="profile-preview">
                      <div
                        className="profile-modal-card profile-themed"
                        style={{
                          position: 'relative',
                          boxShadow: 'none',
                          width: '100%',
                          ['--profile-primary' as string]: profilePrimaryDraft,
                          ['--profile-accent' as string]: profileAccentDraft
                        } as CSSProperties}
                      >
                        <div className="profile-banner" style={{ backgroundImage: wallpaperToBackground(wallpaperDraft, themeDraft), height: 100 }} />
                        <div className="profile-body">
                          <div className="profile-main">
                            <div className="profile-avatar-wrap">
                              <img src={avatarDraft} alt="" />
                              <span className="profile-presence online" />
                            </div>
                            <div className="profile-info">
                              <div className="profile-name-row">
                                <h3 className={nameStyleClass(nameStyleDraft)} style={nameStyleToCss(nameStyleDraft)}>{nicknameDraft || t(language, 'nickname')}</h3>
                                <small className="profile-state online">{t(language, 'online')}</small>
                              </div>
                              <UserBadges user={user} language={language} />
                              {statusDraft ? <p className="profile-status">{statusDraft}</p> : null}
                              <div className="profile-dates">
                                <span>{t(language, 'memberSince')} {new Date(user.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  </section>
                ) : null}

                {activeTab === 'desktop' ? (
                  <section className="settings-section">
                    <h3>{t(language, 'wallpaper')}</h3>
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
                          <p className="field-label compact">{t(language, 'iconLayout')}</p>
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
                    <h3>{t(language, 'appearanceSettings')}</h3>
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
                          <p className="field-label compact">{t(language, 'recentColors')}</p>
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
                          <p className="field-label compact">{t(language, 'customColor')}</p>
                          <div className="choice-list theme-choice-list">
                            {THEMES.map((item) => (
                              <button
                                key={item.code}
                                className={themeDraft === item.code ? 'choice-item active' : 'choice-item'}
                                type="button"
                                onClick={() => setThemeDraft(item.code)}
                              >
                                <span className={`theme-swatch ${item.code}`} />
                                {t(language, item.nameKey)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="toggle-row">
                          <input type="checkbox" checked={transparencyDraft} onChange={(event) => setTransparencyDraft(event.target.checked)} />
                          <span>{t(language, 'transparencyEffects')}</span>
                          <strong>{transparencyDraft ? t(language, 'transparencyOn') : t(language, 'transparencyOff')}</strong>
                        </label>
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeTab === 'region' ? (
                  <section className="settings-section">
                    <h3>{t(language, 'languageAndTime')}</h3>
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
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>▼</span>
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
                      <p className="field-label compact">{t(language, 'timeFormat')}</p>
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

                {activeTab === 'music' ? (
                  <section className="settings-section settings-music-section">
                    <h3>{t(language, 'playlist')}</h3>
                    <div className="settings-music-shell">
                      <div className="settings-music-panel">
                        <header>
                          <strong>{t(language, 'addFromStorage')}</strong>
                          <button className="secondary-action compact" type="button" onClick={() => void refreshStorageAudioFiles()}>
                            {t(language, 'openStorage')}
                          </button>
                        </header>
                        <div className="settings-music-list">
                          {storageAudioFiles.length === 0 ? <div className="explorer-empty">{t(language, 'noAudioFiles')}</div> : null}
                          {storageAudioFiles.map((item) => (
                            <button className="settings-music-row" key={item.id} type="button" onClick={() => void addTrackFromStorage(item)}>
                              <span>♪</span>
                              <strong>{item.name}</strong>
                              <small>{Math.ceil((item.size ?? 0) / 1024)} KB</small>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-music-panel">
                        <header>
                          <strong>{t(language, 'playlist')}</strong>
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
                                <span>{index === currentTrackIndex ? '▶' : '♪'}</span>
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
                  <VoiceSettings language={language} onDirtyChange={handleVoiceDirtyChange} />
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
                      <small>{cardHolderDraft || t(language, 'cardHolder')} · {cardExpiryDraft || 'MM/YY'}</small>
                    </div>
                    <label className="field-label" htmlFor="premium-card-number">{t(language, 'cardNumber')}</label>
                    <input id="premium-card-number" className="text-field" inputMode="numeric" value={cardNumberDraft} placeholder="4242 4242 4242 4242" onChange={(event) => setCardNumberDraft(event.target.value)} />
                    <label className="field-label" htmlFor="premium-card-holder">{t(language, 'cardHolder')}</label>
                    <input id="premium-card-holder" className="text-field" value={cardHolderDraft} placeholder="NOTOC USER" onChange={(event) => setCardHolderDraft(event.target.value.toUpperCase())} />
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
                    <button className="icon-action" type="button" onClick={() => setLegalContent(null)}>✕</button>
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
                  status: statusDraft,
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

      {storageWindow === 'open' ? (
        <VirtualExplorer
          language={language}
          items={storageItems}
          maximized={storageMaximized}
          zIndex={windowZ.explorer}
          initialFolderId={explorerFolderId}
          onFocus={() => bringToFront('explorer')}
          onClose={() => setStorageWindow('closed')}
          onMinimize={() => setStorageWindow('minimized')}
          onToggleMaximize={() => setStorageMaximized((value) => !value)}
          onOpenTextFile={(item) => openNotepad(item.id, item.name)}
          onOpenAudioFile={(item) => openMusicPlayer(item.id)}
          onOpenImageFile={(item) => openImageViewer(item.id)}
          onOpenVideoFile={(item) => openVideoViewer(item.id)}
          onSaveItems={saveStorageItems}
          onUploadProgress={(fraction) => {
            if (fraction === null) finishUpload();
            else beginOrUpdateUpload(fraction);
          }}
        />
      ) : null}

      {imageViewerWindow !== 'closed' && imageViewerItem ? (
        <ImageViewerWindow
          language={language}
          item={imageViewerItem}
          minimized={imageViewerWindow === 'minimized'}
          maximized={imageViewerMaximized}
          zIndex={windowZ.imageViewer}
          onFocus={() => bringToFront('imageViewer')}
          onClose={() => setImageViewerWindow('closed')}
          onMinimize={() => setImageViewerWindow('minimized')}
          onToggleMaximize={() => setImageViewerMaximized((value) => !value)}
          onPin={() => pinImage(imageViewerItem)}
        />
      ) : null}

      {videoViewerWindow !== 'closed' && videoViewerItem ? (
        <VideoViewerWindow
          language={language}
          item={videoViewerItem}
          minimized={videoViewerWindow === 'minimized'}
          maximized={videoViewerMaximized}
          zIndex={windowZ.videoViewer}
          onFocus={() => bringToFront('videoViewer')}
          onClose={() => setVideoViewerWindow('closed')}
          onMinimize={() => setVideoViewerWindow('minimized')}
          onToggleMaximize={() => setVideoViewerMaximized((value) => !value)}
          onPin={() => pinVideo(videoViewerItem)}
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

      {musicPlayerWindow !== 'closed' ? (
        <MusicPlayerWindow
          language={language}
          tracks={storageAudioFiles}
          initialTrackId={musicPlayerInitialTrackId}
          minimized={musicPlayerWindow === 'minimized'}
          maximized={musicPlayerMaximized}
          zIndex={windowZ.musicPlayer}
          onFocus={() => bringToFront('musicPlayer')}
          onClose={() => setMusicPlayerWindow('closed')}
          onMinimize={() => setMusicPlayerWindow('minimized')}
          onToggleMaximize={() => setMusicPlayerMaximized((value) => !value)}
          onPlayStart={pauseDesktopMusic}
          onRefresh={refreshStorageAudioFiles}
        />
      ) : null}

      {aiChatWindow !== 'closed' ? (
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
      ) : null}

      {messengerWindow !== 'closed' || ongoingCall || pendingCallAccept ? (
        <MessengerWindow
          token={token}
          language={language}
          currentUser={user}
          initialChatUserId={messengerChatRequest?.userId ?? null}
          initialChatRequestId={messengerChatRequest?.requestId ?? 0}
          maximized={messengerMaximized}
          minimized={messengerWindow !== 'open'}
          zIndex={windowZ.messenger}
          pendingCallAccept={pendingCallAccept}
          onPendingCallHandled={handlePendingCallHandled}
          onCallStateChange={handleCallStateChange}
          onFocus={() => bringToFront('messenger')}
          onClose={() => setMessengerWindow('closed')}
          onMinimize={() => setMessengerWindow('minimized')}
          onToggleMaximize={() => setMessengerMaximized((value) => !value)}
          onViewDesktop={viewRemoteDesktop}
          onActiveChatChange={setActiveChatUserId}
          onUserChange={onUserChange}
          onEditProfile={() => openSettings('profile')}
        />
      ) : null}

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

      {notepadWindow === 'open' && notepadItemId ? (
        <NotepadWindow
          token={token}
          language={language}
          itemId={notepadItemId}
          items={storageItems}
          maximized={notepadMaximized}
          zIndex={windowZ.notepad}
          onFocus={() => bringToFront('notepad')}
          onClose={() => setNotepadWindow('closed')}
          onMinimize={() => setNotepadWindow('minimized')}
          onToggleMaximize={() => setNotepadMaximized((value) => !value)}
          onTitleChange={setNotepadTitle}
          onSaveItems={saveStorageItems}
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
                ? `${t(language, 'ongoingCall')} · ${formatCallDuration(ongoingCall.elapsed)}`
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
        <button
          className="profile-start"
          type="button"
          onClick={() => setProfileModalUser(user)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setTaskbarMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <img src={user.avatarData} alt="" />
          <UserName user={user} />
        </button>
        {taskbarMenu ? createPortal(
          <div
            className="context-menu messenger-user-menu"
            style={{ left: taskbarMenu.x, top: taskbarMenu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => { setProfileModalUser(user); setTaskbarMenu(null); }}>
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
            language={language}
            token={token}
            translucent
            zIndex={Math.max(...Object.values(windowZ)) + 1}
            onClose={() => setProfileModalUser(null)}
            onUserChange={(updatedUser) => {
              onUserChange(updatedUser);
            }}
            onOpenDesktop={openRemoteDesktopWindow}
            onOpenProfile={(nextUser) => setProfileModalUser(nextUser)}
            onOpenGroup={() => {
              setProfileModalUser(null);
              openMessenger();
            }}
            onEditProfile={() => {
              setProfileModalUser(null);
              openSettings('profile');
            }}
          />
        ) : null}
        {settingsWindow !== 'closed' ? (
          <button className={settingsWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setSettingsWindow('open');
            bringToFront('settings');
          }}>
            <span>ST</span>
            {t(language, 'settings')}
          </button>
        ) : null}
        {storageWindow !== 'closed' ? (
          <button className={storageWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setStorageWindow('open');
            bringToFront('explorer');
          }}>
            <span>DB</span>
            {t(language, 'explorer')}
          </button>
        ) : null}
        {messengerWindow !== 'closed' ? (
          <button className={messengerWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setMessengerWindow('open');
            bringToFront('messenger');
          }}>
            <span>M</span>
            {t(language, 'messenger')}
          </button>
        ) : null}
        {musicPlayerWindow !== 'closed' ? (
          <button className={musicPlayerWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setMusicPlayerWindow('open');
            bringToFront('musicPlayer');
          }}>
            <span>MP</span>
            {t(language, 'musicPlayer')}
          </button>
        ) : null}
        {aiChatWindow !== 'closed' ? (
          <button className={aiChatWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setAiChatWindow('open');
            bringToFront('aiChat');
          }}>
            <span>AI</span>
            {t(language, 'aiChat')}
          </button>
        ) : null}
        {imageViewerWindow !== 'closed' && imageViewerItem ? (
          <button className={imageViewerWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setImageViewerWindow('open');
            bringToFront('imageViewer');
          }}>
            <span>IMG</span>
            {imageViewerItem.name}
          </button>
        ) : null}
        {videoViewerWindow !== 'closed' && videoViewerItem ? (
          <button className={videoViewerWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setVideoViewerWindow('open');
            bringToFront('videoViewer');
          }}>
            <span>VID</span>
            {videoViewerItem.name}
          </button>
        ) : null}
        {remoteDesktopWindow !== 'closed' && remoteDesktopUser ? (
          <button className={remoteDesktopWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setRemoteDesktopWindow('open');
            bringToFront('remoteDesktop');
          }}>
            <span>PC</span>
            {remoteDesktopUser.nickname}
          </button>
        ) : null}
        {notepadWindow !== 'closed' && notepadItemId ? (
          <button className={notepadWindow === 'open' ? 'taskbar-app active' : 'taskbar-app'} type="button" onClick={() => {
            setNotepadWindow('open');
            bringToFront('notepad');
          }}>
            <span>TXT</span>
            {notepadTitle}
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
