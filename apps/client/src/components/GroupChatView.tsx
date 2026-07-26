import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { readImageAsDataUrl } from '../auth/auth-file';
import type { ChannelPermissionOverride, ChatMediaItem, CustomCategory, Group, GroupChannel, GroupFolder, GroupInvite, GroupMember, GroupMessage, GroupRole, Language, NamePlate, PublicUser } from '../api/types';
import { CustomizationModal } from './CustomizationModal';
import { DEFAULT_NAMEPLATE } from '../api/types';
import type { VoiceRoom } from '../hooks/use-voice-room';
import type { TenorGif } from '../utils/tenor';
import { VoiceStage } from './VoiceStage';
import { t, getSavedTimeFormat, getSavedTranslateTargetName, getSavedComposerTranslateTargetName } from '../i18n';
import { AvatarCropper } from './AvatarCropper';
import { NameplateCropper } from './NameplateCropper';
import { EmojiPicker } from './EmojiPicker';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { InviteEmbed } from './InviteEmbed';
import { MessageText, Twemoji } from './Twemoji';
import { expandCustomEmojiShortcodes, extractSharedPack, stripPackLinks, hasPackLink } from '../utils/custom-emoji';
import { recordRecentEmoji } from '../utils/recent-emoji';
import { QUICK_REACTIONS, ReactionEmoji, ReplyQuote, ReplyComposerBar, ForwardedCard, MenuReplyIcon, MenuForwardIcon, MenuPinIcon, MenuDeleteIcon, MenuEditIcon, MenuTranslateIcon, MenuCopyIcon, MenuCutIcon, MenuPasteIcon } from './MessageActions';
import { parseForward } from '../utils/forward';
import type { MessageReplySnippet } from '../api/types';
import { CustomEmojiPackEmbed } from './CustomEmojiPackEmbed';
import { EmojiToggleIcon, AttachIcon, GifIcon } from './ChatComposeIcons';
import { UserName } from './UserName';
import { useSocket } from '../hooks/use-socket';
import { useAnchoredMenu } from '../hooks/use-anchored-menu';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';
import { isVideoCircleAttachment, isVoiceAttachment, VideoCircleMessagePlayer, VideoCirclePlaybackBar, VoiceMessagePlayer, VoicePlaybackBar, VoiceRecorderControl } from './VoiceMessage';
import { useUserStatus, type PresenceStatus } from '../utils/user-status';
import { buildGroupInviteLink, extractGroupInviteChannelId, extractGroupInviteCode } from '../utils/group-invite-link';
import { extractWatchInvite } from '../utils/watch-invite-link';
import { WatchInviteEmbed } from './WatchInviteEmbed';
import { LinkPreviewCard } from './LinkPreviewCard';
import { PollEmbed, extractPollId } from './PollEmbed';
import { GameEmbed, parseGameBody } from './GameEmbed';
import { PollCreateModal } from './PollCreateModal';
import { applySlashCommand, SLASH_COMMANDS } from '../utils/slash-commands';
import { copyImageToClipboard, MediaLightbox, type MediaLightboxItem } from './MediaLightbox';

import {
  CHANNEL_PANEL_MAX,
  CHANNEL_PANEL_MIN,
  CHAT_SKELETON_ROWS,
  EVERYONE_ROLE_ID,
  GROUP_IDENTITY_PERMISSIONS,
  GROUP_TYPING_IDLE_MS,
  GROUP_TYPING_STALE_MS,
  MAX_CHAT_IMAGE_SIZE,
  MAX_CHAT_MEDIA_BATCH,
  MEMBER_PANEL_MAX,
  MEMBER_PANEL_MIN,
  MENTIONABLE_PERMISSION,
  MENTION_EVERYONE_PERMISSION
} from './group-chat/constants';
import {
  permissionDraftToOverrides,
  permissionOverridesToDraft,
  type ChannelPermissionValue,
  type ChannelSettingsTab
} from './group-chat/permissions';
import {
  canAppendToImageAlbum,
  clipboardImageFiles,
  getMessageMediaItems,
  groupMessageRunIdentity,
  isAlbumImageMessage,
  isGifAttachment,
  isGifSource,
  isImageAttachment,
  isImageSource,
  mentionToken,
  messageMentionTokens,
  readClipboardImageFiles
} from './group-chat/media';
import {
  GROUP_BOOTSTRAP_CACHE_TTL_MS,
  GROUP_MESSAGES_CACHE_TTL_MS,
  getGroupCache,
  groupDataCache,
  loadPanelWidth,
  savePanelWidth
} from './group-chat/group-cache';
import { GroupChatGifAttachment } from './group-chat/GroupChatGifAttachment';
import { GroupSettingsModal } from './group-chat/GroupSettingsModal';
import { ChannelSettingsModal } from './group-chat/ChannelSettingsModal';
import { FolderSettingsModal } from './group-chat/FolderSettingsModal';
import { GroupChannelsPanel } from './group-chat/GroupChannelsPanel';
import { CreateChannelModal, CreateFolderModal, DeleteChannelOrFolderModal, DeleteMessageConfirmModal } from './group-chat/GroupChatModals';
import { GroupMemberPanel } from './group-chat/GroupMemberPanel';

type GroupChatViewProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  group: Group;
  initialChannelId?: string | null;
  initialChannelRequestId?: number;
  onlineUserIds?: string[];
  presenceStatuses?: Record<string, PresenceStatus>;
  onClose: () => void;
  onViewProfile?: (user: PublicUser, group?: Group, preload?: { groupRoles: GroupRole[]; userRoles: GroupRole[] }, anchorRect?: { left: number; top: number; right: number; bottom: number } | null) => void;
  onCloseProfile?: () => void;
  onViewDesktop?: (user: PublicUser) => void;
  onGroupJoin?: (group: Group) => void;
  memberGroupIds?: Set<string>;
  onGroupNavigate?: (groupId: string, channelId?: string | null) => void;
  onGroupLeft?: (groupId: string) => void;
  voiceRoom?: VoiceRoom;
  onOpenWatchTogether?: (inviteCode?: string) => void;
  // Opens the shared "Forward to" modal (owned by MessengerWindow) seeded with
  // the given message body.
  onForwardMessage?: (seed: { body: string; senderName: string; sourceId: string; imageData: string | null; imageName: string | null; imageSpoiler: boolean }) => void;
  deletedForwardSourceIds?: Set<string>;
  onForwardSourceDeleted?: (sourceId: string) => void;
};

export function GroupChatView({ token, language, currentUser, group, initialChannelId = null, initialChannelRequestId = 0, onlineUserIds = [], presenceStatuses = {}, onClose, onViewProfile, onCloseProfile, onViewDesktop, onGroupJoin, memberGroupIds, onGroupNavigate, onGroupLeft, voiceRoom, onOpenWatchTogether, onForwardMessage, deletedForwardSourceIds: externalDeletedForwardSourceIds, onForwardSourceDeleted }: GroupChatViewProps) {
  const selfStatus = useUserStatus();
  // Reuse the single session-wide socket (SocketProvider) instead of opening a
  // second connection. A duplicate connection caused presence churn: opening a
  // group made other online members briefly flip to "offline" everywhere.
  const sharedSocket = useSocket();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [roles, setRoles] = useState<GroupRole[]>([]);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  // Pagination: whether an older page of the open channel exists, plus guards
  // so scroll-up only triggers one "load older" request at a time.
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const userNearThreadBottomRef = useRef(true);
  const threadAutoScrollStateRef = useRef<{ key: string; lastId: string | null; length: number }>({ key: '', lastId: null, length: 0 });
  const olderScrollAnchorRef = useRef<{ previousTop: number; previousHeight: number; until: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [sendAsGroupIdentity, setSendAsGroupIdentity] = useState(false);
  const [selfTypingChannel, setSelfTypingChannel] = useState<string | null>(null);
  const [groupTyping, setGroupTyping] = useState<Record<string, { channelId: string | null; at: number }>>({});
  const [memberPanelWidth, setMemberPanelWidth] = useState(() => loadPanelWidth('member', 280));
  const [channelPanelWidth, setChannelPanelWidth] = useState(() => loadPanelWidth('channel', 240));
  const [resizing, setResizing] = useState(false);
  const [resizingChannels, setResizingChannels] = useState(false);
  const [groupSearchOpen, setGroupSearchOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupSearchActiveId, setGroupSearchActiveId] = useState<string | null>(null);
  // AI "what did I miss?" summary of the active channel.
  const [channelSummary, setChannelSummary] = useState<{ open: boolean; loading: boolean; text: string; error: string }>({ open: false, loading: false, text: '', error: '' });
  // Thread side panel: replies hanging off a root channel message.
  const [threadViewRootId, setThreadViewRootId] = useState<string | null>(null);
  const [threadViewRoot, setThreadViewRoot] = useState<GroupMessage | null>(null);
  const [threadViewMessages, setThreadViewMessages] = useState<GroupMessage[]>([]);
  const [threadViewLoading, setThreadViewLoading] = useState(false);
  const [threadViewDraft, setThreadViewDraft] = useState('');
  const [threadViewSending, setThreadViewSending] = useState(false);
  const threadViewRootRef = useRef<string | null>(null);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [groupMembersHidden, setGroupMembersHidden] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: GroupMessage; imageSrc?: string } | null>(null);
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; kind: 'channel' | 'folder'; id: string; name: string } | null>(null);
  // Ephemeral, per-message translations keyed by message id. Reset on channel
  // switch and when the chat view unmounts (close/reopen messenger).
  const [messageTranslations, setMessageTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  // The message whose reaction emoji picker is open, anchored to its toolbar
  // emoji button. Null when no reaction picker is showing.
  const [reactionPicker, setReactionPicker] = useState<{ message: GroupMessage; anchor: HTMLElement } | null>(null);
  const reactionAnchorRef = useRef<HTMLElement | null>(null);
  const reactionTogglePendingRef = useRef<Set<string>>(new Set());

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

  function mergePendingReactions(message: GroupMessage, local: GroupMessage | undefined, confirmedEmoji?: string) {
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

  function preservePendingReactions(incoming: GroupMessage[], current: GroupMessage[]) {
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

  function mergeLiveGroupMessage(current: GroupMessage[], msg: GroupMessage) {
    if (current.some((m) => m.id === msg.id)) return current;
    const pendingIdx = current.findIndex(
      (m) =>
        m.pending &&
        m.senderId === msg.senderId &&
        m.body === msg.body &&
        m.channelId === msg.channelId &&
        (m.imageName ?? null) === (msg.imageName ?? null)
    );
    if (pendingIdx !== -1) {
      const next = current.slice();
      next[pendingIdx] = { ...msg, clientKey: current[pendingIdx].clientKey };
      return next;
    }
    return [...current, msg];
  }

  function isFeedRelatedMessage(message: Pick<GroupMessage, 'channelId' | 'feedMirror' | 'feedSourceId'>, sourceChannels: GroupChannel[]) {
    return Boolean(
      message.feedMirror ||
      message.feedSourceId ||
      (message.channelId && sourceChannels.some((channel) => channel.id === message.channelId && channel.type === 'feed'))
    );
  }

  function markDeletedReplyInGroup(message: GroupMessage, deletedMessageId: string, deletedAt: string): GroupMessage {
    if (message.replyTo?.id === deletedMessageId && !message.replyTo.deletedAt) {
      return {
        ...message,
        replyTo: {
          ...message.replyTo,
          body: '',
          imageData: null,
          imageName: null,
          mediaItems: [],
          deletedAt
        }
      };
    }
    return message;
  }
  // The message being replied to (shows the reply bar above the composer).
  const [replyTarget, setReplyTarget] = useState<MessageReplySnippet | null>(null);
  const [deletedForwardSourceIds, setDeletedForwardSourceIds] = useState<Set<string>>(() => new Set());
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; user: PublicUser } | null>(null);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelType, setCreateChannelType] = useState<'text' | 'voice' | 'feed'>('text');
  const [newChannelName, setNewChannelName] = useState('');
  // Confirmation dialog before deleting a channel or folder.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'channel' | 'folder'; id: string; name: string } | null>(null);
  // Channel / folder settings dialog (rename, and member limit for voice).
  const [editTarget, setEditTarget] = useState<{ kind: 'channel' | 'folder'; id: string } | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [editLimitDraft, setEditLimitDraft] = useState<string>('');
  const [editTopicDraft, setEditTopicDraft] = useState('');
  const editTopicTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editSlowmodeDraft, setEditSlowmodeDraft] = useState('0');
  const [editNsfwDraft, setEditNsfwDraft] = useState(false);
  const [editBitrateDraft, setEditBitrateDraft] = useState('64000');
  const [channelSettingsTab, setChannelSettingsTab] = useState<ChannelSettingsTab>('overview');
  const [channelRoleDraft, setChannelRoleDraft] = useState<string[]>([]);
  const [selectedChannelPermissionRoleId, setSelectedChannelPermissionRoleId] = useState<string | null>(null);
  const [channelPermissionDraft, setChannelPermissionDraft] = useState<Record<string, Record<string, ChannelPermissionValue>>>({});
  const [savedChannelPermissionDraft, setSavedChannelPermissionDraft] = useState<Record<string, Record<string, ChannelPermissionValue>>>({});
  // Bumped to shake the channel/folder edit save bar on a blocked close.
  const [editBarShake, setEditBarShake] = useState(0);
  // When the user is connected to a voice channel and clicks it again, the
  // voice stage (chat + screen share) opens inline above the chat.
  const [voiceStageOpen, setVoiceStageOpen] = useState(false);
  const [folders, setFolders] = useState<GroupFolder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [slowmodeUntilByChannel, setSlowmodeUntilByChannel] = useState<Record<string, number>>(() => ({ ...getGroupCache(group.id).slowmodeUntilByChannel }));
  const [slowmodeNow, setSlowmodeNow] = useState(() => Date.now());
  const [acceptedNsfwChannels, setAcceptedNsfwChannels] = useState<Set<string>>(() => new Set(getGroupCache(group.id).acceptedNsfwChannels));
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftHoist, setDraftHoist] = useState(false);
  // Roles tab: search query, the role currently open in the editor sub-view
  // (null = the list view), which role's "..." menu popup is open, and a flag
  // for the transient "ID copied" feedback.
  const [roleSearch, setRoleSearch] = useState('');
  const [roleSort, setRoleSort] = useState<'position' | 'name' | 'members'>('position');
  const [roleEditorTab, setRoleEditorTab] = useState<'display' | 'permissions' | 'members'>('display');
  const [rolePermissionSearch, setRolePermissionSearch] = useState('');
  const [roleMemberSearch, setRoleMemberSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (id: string) => setCollapsedCategories((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [roleEditorId, setRoleEditorId] = useState<string | null>(null);
  const [roleMenuOpen, setRoleMenuOpen] = useState<string | null>(null);
  const [roleIdCopied, setRoleIdCopied] = useState<string | null>(null);
  const [memberRoleMenu, setMemberRoleMenu] = useState<string | null>(null);
  const [memberRoleDetailsMenu, setMemberRoleDetailsMenu] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberSort, setMemberSort] = useState<'joined' | 'accountCreated' | 'alphabetical'>('joined');
  const [memberRoleFilter, setMemberRoleFilter] = useState('all');
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set());
  const [bulkRoleMenu, setBulkRoleMenu] = useState<'add' | 'remove' | null>(null);
  // The role auto-assigned when a member joins the server, plus its dropdown.
  const [defaultRoleId, setDefaultRoleId] = useState<string | null>(group.defaultRoleId ?? null);
  const [everyonePermissions, setEveryonePermissions] = useState<string[]>(group.everyonePermissions ?? []);
  const [defaultRoleMenuOpen, setDefaultRoleMenuOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'overview' | 'invite' | 'roles' | 'members' | 'customization'>('overview');
  // Server profile customization: admin-defined categories, the caller's
  // selected option ids, whether a required onboarding flow is pending, and
  // whether the member-facing "Настроить профиль" modal is open.
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  // Monotonic counter of customization toggles in flight. Used to ignore stale
  // out-of-order server responses so rapid clicking doesn't make the checkmark
  // flicker on/off.
  const toggleSeqRef = useRef(0);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Bumped to shake the save bar (red) when the user tries to close settings
  // while there are unsaved changes in the role editor.
  const [saveBarShake, setSaveBarShake] = useState(0);

  // Leaving the Roles tab (or closing settings) returns the role editor to the
  // list view and dismisses any open "..." menu.
  useEffect(() => {
    if (settingsTab !== 'roles' || !showSettings) {
      setRoleEditorId(null);
      setRoleMenuOpen(null);
    }
  }, [settingsTab, showSettings]);

  useEffect(() => {
    if (showSettings) return;
    setSelectedMemberIds(new Set());
    setBulkRoleMenu(null);
    setMemberRoleMenu(null);
    setMemberRoleDetailsMenu(null);
  }, [showSettings]);

  // Close the role "..." popup menu when clicking anywhere outside of it.
  useEffect(() => {
    if (!roleMenuOpen) return;
    const onDocClick = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.group-roles-menu-wrap')) return;
      setRoleMenuOpen(null);
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [roleMenuOpen]);

  // Close the "default role on join" dropdown on any outside click.
  useEffect(() => {
    if (!defaultRoleMenuOpen) return;
    const onDocClick = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.group-default-role-wrap')) return;
      setDefaultRoleMenuOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [defaultRoleMenuOpen]);
  const [draggedItem, setDraggedItem] = useState<{ type: 'channel' | 'folder'; id: string } | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ dataUrl: string; name: string; spoiler: boolean }>>([]);
  const [imageCaptionDraft, setImageCaptionDraft] = useState('');
  const [editingMediaItems, setEditingMediaItems] = useState<Array<{ dataUrl: string; name: string; spoiler: boolean }>>([]);
  const [revealedSpoilers, setRevealedSpoilers] = useState<string[]>([]);
  // Index into the pinned-messages list that the pin bar currently points at.
  // Clicking the bar jumps to that pin and advances to the next one.
  const [pinCursor, setPinCursor] = useState(0);
  const [channelPinnedMessages, setChannelPinnedMessages] = useState<GroupMessage[]>([]);
  const [channelMediaMessages, setChannelMediaMessages] = useState<GroupMessage[]>([]);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageEmojiOpen, setImageEmojiOpen] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const [mediaContextMenu, setMediaContextMenu] = useState<{ x: number; y: number; src: string } | null>(null);
  const [lightboxProfileUserId, setLightboxProfileUserId] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const lastPasteRef = useRef<{ signature: string; at: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageCaptionInputRef = useRef<EmojiInlineInputHandle | null>(null);
  const groupSearchInputRef = useRef<HTMLInputElement | null>(null);
  const channelsRef = useRef<GroupChannel[]>([]);

  // Persist channel placement (folder + ordering) to the server and broadcast to other members.
  async function persistChannelOrder(nextChannels: GroupChannel[]) {
    const items = nextChannels.map((c, index) => ({ id: c.id, position: index, folderId: c.folderId }));
    try {
      const payload = await api.reorderGroupChannels(token, group.id, items);
      setChannels(payload.channels);
    } catch {
      // reload authoritative state on failure
      void api.getGroupChannels(token, group.id).then((p) => setChannels(p.channels));
    }
  }

  function isFeedChildChannel(channel: GroupChannel | undefined | null) {
    return Boolean(channel?.feedParentChannelId);
  }

  function isFeedInternalChannel(channel: GroupChannel | undefined | null) {
    return Boolean(channel && (channel.type === 'feed' || channel.feedParentChannelId));
  }

  function isFeedManagedChannel(channel: GroupChannel | undefined | null) {
    return Boolean(channel && (channel.type === 'feed' || channel.feedParentChannelId));
  }

  function moveFeedWithChildren(sourceChannels: GroupChannel[], dragged: GroupChannel, targetFolderId: string | null, insertAt: number) {
    const linkedChildren = dragged.type === 'feed'
      ? sourceChannels.filter((channel) => channel.feedParentChannelId === dragged.id)
      : [];
    const movingIds = new Set([dragged.id, ...linkedChildren.map((channel) => channel.id)]);
    const without = sourceChannels.filter((channel) => !movingIds.has(channel.id));
    const safeInsertAt = Math.max(0, Math.min(insertAt, without.length));
    const moved = [
      { ...dragged, folderId: targetFolderId },
      ...linkedChildren.map((channel) => ({ ...channel, folderId: targetFolderId }))
    ];
    without.splice(safeInsertAt, 0, ...moved);
    return without;
  }

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // Persist folder ordering to the server and broadcast to other members.
  async function persistFolderOrder(nextFolders: GroupFolder[]) {
    try {
      await Promise.all(nextFolders.map((f, index) =>
        f.position === index ? Promise.resolve() : api.updateGroupFolder(token, group.id, f.id, { position: index })
      ));
    } catch {
      void api.getGroupFolders(token, group.id).then((p) => setFolders(p.folders));
    }
  }

  const handleChannelDragStart = (e: React.DragEvent, channelId: string) => {
    if (!canManageChannels) return;
    const channel = channels.find((item) => item.id === channelId);
    if (isFeedInternalChannel(channel)) {
      e.preventDefault();
      return;
    }
    // Stop the event from bubbling to the enclosing folder's draggable handler,
    // which would otherwise overwrite draggedItem with the folder and break
    // reordering channels inside a folder.
    e.stopPropagation();
    setDraggedItem({ type: 'channel', id: channelId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    if (!canManageChannels) return;
    setDraggedItem({ type: 'folder', id: folderId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Decide whether the cursor is on the top or bottom half of the hovered element.
  function dropsBefore(e: React.DragEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2;
  }

  // Drop a channel onto another channel: reorder relative to it and adopt its folder.
  const handleDropOnChannel = (e: React.DragEvent, targetChannelId: string, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem || draggedItem.type !== 'channel') { setDraggedItem(null); return; }
    if (draggedItem.id === targetChannelId) { setDraggedItem(null); return; }
    const dragged = channels.find((c) => c.id === draggedItem.id);
    if (!dragged || isFeedInternalChannel(dragged)) { setDraggedItem(null); return; }

    const before = dropsBefore(e);
    const linkedIds = new Set([dragged.id, ...channels.filter((channel) => channel.feedParentChannelId === dragged.id).map((channel) => channel.id)]);
    const without = channels.filter((c) => !linkedIds.has(c.id));
    let targetIndex = without.findIndex((c) => c.id === targetChannelId);
    if (targetIndex < 0) { setDraggedItem(null); return; }
    if (!before) targetIndex += 1;
    const next = moveFeedWithChildren(channels, dragged, targetFolderId, targetIndex);
    setChannels(next);
    void persistChannelOrder(next);
    setDraggedItem(null);
  };

  // Drop a channel into a folder (append), or reorder a folder relative to another folder.
  const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.type === 'channel') {
      const dragged = channels.find((c) => c.id === draggedItem.id);
      if (dragged && !isFeedInternalChannel(dragged)) {
        // Move into this folder and place it at the end of the folder's channels.
        const linkedIds = new Set([dragged.id, ...channels.filter((channel) => channel.feedParentChannelId === dragged.id).map((channel) => channel.id)]);
        const without = channels.filter((c) => !linkedIds.has(c.id));
        const lastInFolder = without.map((c, i) => ({ c, i })).filter((x) => x.c.folderId === targetFolderId).pop();
        const insertAt = lastInFolder ? lastInFolder.i + 1 : without.length;
        const next = moveFeedWithChildren(channels, dragged, targetFolderId, insertAt);
        setChannels(next);
        void persistChannelOrder(next);
      }
    } else if (draggedItem.type === 'folder' && draggedItem.id !== targetFolderId) {
      const dragged = folders.find((f) => f.id === draggedItem.id);
      if (dragged) {
        const before = dropsBefore(e);
        const without = folders.filter((f) => f.id !== draggedItem.id);
        let targetIndex = without.findIndex((f) => f.id === targetFolderId);
        if (!before) targetIndex += 1;
        without.splice(targetIndex, 0, dragged);
        setFolders(without);
        void persistFolderOrder(without);
      }
    }
    setDraggedItem(null);
  };

  // Drop a channel onto the root area: detach from any folder and append to the root list.
  const handleDropOnRoot = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'channel') { setDraggedItem(null); return; }
    const dragged = channels.find((c) => c.id === draggedItem.id);
    if (dragged && !isFeedInternalChannel(dragged)) {
      const linkedIds = new Set([dragged.id, ...channels.filter((channel) => channel.feedParentChannelId === dragged.id).map((channel) => channel.id)]);
      const without = channels.filter((c) => !linkedIds.has(c.id));
      const next = moveFeedWithChildren(channels, dragged, null, without.length);
      setChannels(next);
      void persistChannelOrder(next);
    }
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };
  const [inviteCode, setInviteCode] = useState(group.inviteCode);
  const [newName, setNewName] = useState(group.name);
  const [newDescription, setNewDescription] = useState(group.description ?? '');
  const [copied, setCopied] = useState(false);
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [nameplateDraft, setNameplateDraft] = useState<NonNullable<NamePlate>>(group.nameplate ?? DEFAULT_NAMEPLATE);
  // Baseline of the persisted overview values. Updated when the group prop
  // changes and after a successful save so the save bar clears immediately.
  const [savedOverview, setSavedOverview] = useState(() => ({
    name: group.name,
    description: group.description ?? '',
    avatarData: group.avatarData,
    nameplate: JSON.stringify(group.nameplate ?? DEFAULT_NAMEPLATE)
  }));
  const [cropSource, setCropSource] = useState<string | null>(null);
  // Quick nameplate popup opened directly under the group title.
  const [platePopupOpen, setPlatePopupOpen] = useState(false);
  const [platePopupPos, setPlatePopupPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const platePopupRef = useRef<HTMLDivElement | null>(null);
  // Image awaiting region selection for the nameplate crop.
  const [plateCropSource, setPlateCropSource] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [deleteMessageConfirm, setDeleteMessageConfirm] = useState<GroupMessage | null>(null);
  const [editingRoleMeta, setEditingRoleMeta] = useState<{ id: string; name: string; color: string } | null>(null);
  // True when the open role editor has unsaved edits (permissions, hoist,
  // name or color differ from the persisted role). Drives the slide-up
  // save/reset bar and the "block close" flash on the × button.
  const roleEditorDirty = useMemo(() => {
    if (roleEditorId === null) return false;
    if (roleEditorId === EVERYONE_ROLE_ID) {
      return draftPermissions.length !== everyonePermissions.length ||
        [...draftPermissions].sort().join('|') !== [...everyonePermissions].sort().join('|');
    }
    const role = roles.find((r) => r.id === roleEditorId);
    if (!role) return false;
    const permsChanged =
      draftPermissions.length !== role.permissions.length ||
      [...draftPermissions].sort().join('|') !== [...role.permissions].sort().join('|');
    const hoistChanged = draftHoist !== role.hoist;
    const meta = editingRoleMeta && editingRoleMeta.id === role.id ? editingRoleMeta : null;
    const nameChanged = meta ? meta.name.trim() !== role.name : false;
    const colorChanged = meta ? meta.color !== role.color : false;
    return permsChanged || hoistChanged || nameChanged || colorChanged;
  }, [roleEditorId, roles, draftPermissions, draftHoist, editingRoleMeta, everyonePermissions]);

  // True when the Overview tab (name / description / avatar / nameplate) has
  // unsaved edits versus the persisted group.
  const overviewDirty = useMemo(() => {
    const nameChanged = newName.trim() !== savedOverview.name && newName.trim().length > 0;
    const descChanged = newDescription.trim() !== savedOverview.description.trim();
    const avatarChanged = newAvatar !== null && newAvatar !== savedOverview.avatarData;
    const plateChanged = JSON.stringify(nameplateDraft) !== savedOverview.nameplate;
    return nameChanged || descChanged || avatarChanged || plateChanged;
  }, [newName, newDescription, newAvatar, nameplateDraft, savedOverview]);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const memberMenuRef = useRef<HTMLDivElement | null>(null);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);
  // Clamp context menus into the viewport so right-clicking near the bottom/right
  // edge of a small window never hides part of the menu.
  const messageMenuPos = useAnchoredMenu(messageMenu ? { x: messageMenu.x, y: messageMenu.y } : null, menuRef);
  const memberMenuPos = useAnchoredMenu(memberMenu ? { x: memberMenu.x, y: memberMenu.y } : null, memberMenuRef);
  const channelMenuPos = useAnchoredMenu(channelMenu ? { x: channelMenu.x, y: channelMenu.y } : null, channelMenuRef);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<EmojiInlineInputHandle | null>(null);
  const consumedInitialChannelRef = useRef<string | null>(null);
  // Right-click menu for the channel composer.
  const [composerMenu, setComposerMenu] = useState<{ x: number; y: number; start: number; end: number; hasSelection: boolean } | null>(null);
  const [imageCaptionMenu, setImageCaptionMenu] = useState<{ x: number; y: number } | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  // Clamp the composer menu inside the viewport so it never spills off-screen.
  const composerMenuPos = useAnchoredMenu(composerMenu ? { x: composerMenu.x, y: composerMenu.y } : null, composerMenuRef);
  const imageCaptionMenuRef = useRef<HTMLDivElement | null>(null);
  const imageCaptionMenuPos = useAnchoredMenu(imageCaptionMenu, imageCaptionMenuRef);
  const [composerTranslating, setComposerTranslating] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const groupEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const activeChannelRef = useRef<string | null>(null);
  const loadedMediaChannelRef = useRef<string | null>(null);
  const loadingMediaChannelRef = useRef<string | null>(null);
  const groupTypingTimerRef = useRef<number | null>(null);

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
  const localGroupTypingRef = useRef<{ channelId: string | null; active: boolean; emittedAt: number }>({ channelId: null, active: false, emittedAt: 0 });

  // The voice channel of THIS group the user is currently connected to (if any).
  const voiceConnectedChannel = useMemo(
    () => (voiceRoom?.activeChannelId ? channels.find((c) => c.id === voiceRoom.activeChannelId && c.type === 'voice') ?? null : null),
    [voiceRoom?.activeChannelId, channels]
  );

  // Open the voice view automatically when joining, close it when leaving.
  useEffect(() => {
    if (voiceConnectedChannel) setVoiceStageOpen(true);
    else setVoiceStageOpen(false);
  }, [voiceConnectedChannel]);

  // Whether to show the dedicated voice view (stage + ephemeral chat) instead of
  // the text channel thread.
  const showVoiceView = Boolean(voiceStageOpen && voiceConnectedChannel);
  const activeChannelObj = channels.find((c) => c.id === activeChannel) ?? null;
  const activeChannelName = activeChannelObj?.name ?? 'general';
  const activeChannelTopic = activeChannelObj?.type === 'text' || activeChannelObj?.type === 'feed' ? (activeChannelObj.topic ?? '').trim() : '';
  const groupSearchLabel = t(language, 'search');
  const groupMembersLabel = t(language, 'members');
  const groupSearchMatches = useMemo(() => {
    const query = groupSearchQuery.trim().toLowerCase();
    if (!query) return [];
    return messages.filter((message) => !message.deletedAt && (message.body ?? '').toLowerCase().includes(query));
  }, [groupSearchQuery, messages]);
  const groupSearchMatchIds = useMemo(() => new Set(groupSearchMatches.map((message) => message.id)), [groupSearchMatches]);

  useEffect(() => {
    if (!groupSearchOpen) return;
    const frame = window.requestAnimationFrame(() => groupSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [groupSearchOpen]);

  useEffect(() => {
    setGroupSearchOpen(false);
    setGroupSearchQuery('');
    setGroupSearchActiveId(null);
    setRevealedSpoilers([]);
  }, [group.id, activeChannel]);

  function jumpToGroupSearchMatch(direction = 1) {
    if (groupSearchMatches.length === 0) return;
    const currentIndex = groupSearchActiveId
      ? groupSearchMatches.findIndex((message) => message.id === groupSearchActiveId)
      : -1;
    const fallbackIndex = direction < 0 ? groupSearchMatches.length - 1 : 0;
    const nextIndex = currentIndex >= 0
      ? (currentIndex + direction + groupSearchMatches.length) % groupSearchMatches.length
      : fallbackIndex;
    const nextMessage = groupSearchMatches[nextIndex];
    setGroupSearchActiveId(nextMessage.id);
    const el = document.getElementById('gmsg-' + nextMessage.id);
    if (el && threadRef.current) {
      const tNode = threadRef.current;
      const tRect = tNode.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      tNode.scrollBy({ top: elRect.top - tRect.top - 96, behavior: 'smooth' });
      el.classList.add('message-jump-highlight');
      window.setTimeout(() => el.classList.remove('message-jump-highlight'), 1200);
    }
  }

  const currentMember = useMemo(() => members.find((m) => m.user.id === currentUser.id), [members, currentUser.id]);
  const currentRoleIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentMember?.roleId) ids.add(currentMember.roleId);
    for (const id of currentMember?.roleIds ?? []) ids.add(id);
    return ids;
  }, [currentMember]);
  const currentRoles = useMemo(() => roles.filter((r) => currentRoleIds.has(r.id)), [roles, currentRoleIds]);
  const currentPermissionSet = useMemo(() => {
    const permissions = new Set(everyonePermissions);
    for (const role of currentRoles) for (const permission of role.permissions ?? []) permissions.add(permission);
    return permissions;
  }, [everyonePermissions, currentRoles]);
  const ownerRoleId = useMemo(() => roles.find((r) => r.isOwner)?.id, [roles]);
  // The group creator is always treated as owner/admin, even when their current
  // role has no admin permissions (or they hold a plain custom role).
  const isOwner = useMemo(
    () => currentUser.id === group.ownerId || currentRoles.some((r) => r.isOwner) || currentMember?.role === 'Owner',
    [currentUser.id, group.ownerId, currentRoles, currentMember]
  );
  const canManageRoles = useMemo(() => isOwner || currentPermissionSet.has('ManageRoles'), [isOwner, currentPermissionSet]);
  const canManageChannels = useMemo(() => isOwner || currentPermissionSet.has('ManageChannels'), [isOwner, currentPermissionSet]);
  const canKickMembers = useMemo(() => isOwner || currentPermissionSet.has('KickMembers'), [isOwner, currentPermissionSet]);
  const canDeleteAny = useMemo(() => isOwner || currentPermissionSet.has('DeleteAnyMessage'), [isOwner, currentPermissionSet]);
  const canManageInvites = useMemo(() => isOwner || currentPermissionSet.has('ManageInvites'), [isOwner, currentPermissionSet]);
  const canUseGroupIdentity = useMemo(
    () => isOwner || GROUP_IDENTITY_PERMISSIONS.some((permission) => currentPermissionSet.has(permission)),
    [isOwner, currentPermissionSet]
  );
  const canMentionEveryone = useMemo(() => isOwner || currentPermissionSet.has(MENTION_EVERYONE_PERMISSION) || currentRoles.some((r) => r.isOwner), [isOwner, currentPermissionSet, currentRoles]);
  const activeChannelPermissionSet = useMemo(() => {
    const permissions = new Set<string>();
    for (const permission of currentPermissionSet) permissions.add(permission);
    return permissions;
  }, [currentPermissionSet]);
  const canPublishInActiveFeed = activeChannelObj?.type !== 'feed' || canUseGroupIdentity;
  const canSendInActiveChannel = useMemo(
    () => Boolean(activeChannelObj && (activeChannelObj.type === 'text' || activeChannelObj.type === 'feed') && canPublishInActiveFeed && (isOwner || activeChannelPermissionSet.has('SendMessages'))),
    [activeChannelObj, canPublishInActiveFeed, isOwner, activeChannelPermissionSet]
  );
  const canAttachInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('AttachFiles'), [isOwner, activeChannelPermissionSet]);
  const canSendVoiceMessagesInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('SendVoiceMessages'), [isOwner, activeChannelPermissionSet]);
  const canSendVideoCirclesInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('SendVideoCircles'), [isOwner, activeChannelPermissionSet]);
  const canReactInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('AddReactions'), [isOwner, activeChannelPermissionSet]);
  const canCreatePollsInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('CreatePolls'), [isOwner, activeChannelPermissionSet]);
  const canUseExternalEmojisInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('UseExternalEmojis'), [isOwner, activeChannelPermissionSet]);
  const canPinInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('PinMessages'), [isOwner, activeChannelPermissionSet]);
  const canManageMessagesInActiveChannel = useMemo(() => isOwner || activeChannelPermissionSet.has('ManageMessages') || canDeleteAny, [isOwner, activeChannelPermissionSet, canDeleteAny]);
  const canBypassActiveSlowmode = useMemo(() => isOwner || activeChannelPermissionSet.has('BypassSlowmode'), [isOwner, activeChannelPermissionSet]);

  useEffect(() => {
    if (!canUseGroupIdentity) setSendAsGroupIdentity(false);
  }, [canUseGroupIdentity, group.id]);
  const activeSlowmodeSeconds = activeChannelObj?.type === 'text' || activeChannelObj?.type === 'feed' ? (activeChannelObj.slowmodeSeconds ?? 0) : 0;
  const activeSlowmodeRemainingMs = activeChannel && !canBypassActiveSlowmode
    ? Math.max(0, (slowmodeUntilByChannel[activeChannel] ?? 0) - slowmodeNow)
    : 0;
  const activeSlowmodeRemainingSeconds = Math.ceil(activeSlowmodeRemainingMs / 1000);
  const activeNsfwBlocked = Boolean((activeChannelObj?.type === 'text' || activeChannelObj?.type === 'feed') && activeChannelObj.nsfw && activeChannel && !acceptedNsfwChannels.has(activeChannel));
  const mentionableRoles = useMemo(() => roles.filter((role) => role.isOwner || role.permissions?.includes(MENTIONABLE_PERMISSION)), [roles]);

  useEffect(() => {
    if (!activeChannel || activeSlowmodeSeconds <= 0 || canBypassActiveSlowmode) return;
    setSlowmodeNow(Date.now());
    const timer = window.setInterval(() => setSlowmodeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeChannel, activeSlowmodeSeconds, canBypassActiveSlowmode]);

  useEffect(() => {
    getGroupCache(group.id).slowmodeUntilByChannel = slowmodeUntilByChannel;
  }, [group.id, slowmodeUntilByChannel]);

  useEffect(() => {
    getGroupCache(group.id).acceptedNsfwChannels = new Set(acceptedNsfwChannels);
  }, [group.id, acceptedNsfwChannels]);

  const currentMentionRoleTokens = useMemo(() => {
    const tokens = new Set<string>();
    for (const role of mentionableRoles) {
      if (currentRoleIds.has(role.id)) tokens.add(mentionToken(role.name));
    }
    return tokens;
  }, [currentRoleIds, mentionableRoles]);
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  function receivesEveryoneMentionFrom(senderId: string) {
    if (senderId === currentUser.id) return canMentionEveryone;
    const senderMember = members.find((member) => member.user.id === senderId);
    const senderRoleIds = senderMember?.roleIds ?? [];
    const senderRoles = senderRoleIds.map((roleId) => roleById.get(roleId)).filter(Boolean) as GroupRole[];
    const senderIsAdmin = group.ownerId === senderId || senderRoles.some((role) => role.isOwner);
    if (senderIsAdmin) return true;
    return senderRoles.some((role) => role.permissions?.includes(MENTION_EVERYONE_PERMISSION));
  }
  const senderCanMentionEveryone = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const member of members) {
      const senderRoleIds = member.roleIds?.length ? member.roleIds : member.roleId ? [member.roleId] : [];
      const senderRoles = senderRoleIds.map((roleId) => roleById.get(roleId)).filter(Boolean) as GroupRole[];
      map.set(
        member.user.id,
        group.ownerId === member.user.id ||
          senderRoles.some((role) => role.isOwner || role.permissions?.includes(MENTION_EVERYONE_PERMISSION))
      );
    }
    map.set(currentUser.id, canMentionEveryone);
    return map;
  }, [members, roleById, group.ownerId, currentUser.id, canMentionEveryone]);
  const mentionedMessageIds = useMemo(() => {
    const ownToken = mentionToken(currentUser.nickname);
    const roleTokens = Array.from(currentMentionRoleTokens);
    const highlighted = new Set<string>();
    for (const message of messages) {
      if (message.deletedAt || !message.body || !message.body.includes('@')) continue;
      const tokens = messageMentionTokens(message.body);
      if (
        tokens.has(ownToken) ||
        (tokens.has('everyone') && Boolean(senderCanMentionEveryone.get(message.senderId))) ||
        roleTokens.some((token) => tokens.has(token))
      ) {
        highlighted.add(message.id);
      }
    }
    return highlighted;
  }, [messages, currentUser.nickname, currentMentionRoleTokens, senderCanMentionEveryone]);
  // A member counts as an "admin" (can open group settings) when they own the
  // group or hold any management permission. Plain members instead get a
  // "Copy group link" action.
  const isGroupAdmin = useMemo(
    () => isOwner || canManageRoles || canManageChannels || canKickMembers,
    [isOwner, canManageRoles, canManageChannels, canKickMembers]
  );
  function getHeldRoleIds(member: GroupMember) {
    return member.roleIds?.length ? member.roleIds : member.roleId ? [member.roleId] : [];
  }
  function memberHasRole(member: GroupMember, roleId: string) {
    return getHeldRoleIds(member).includes(roleId);
  }
  const settingsMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return [...members]
      .filter((member) => {
        if (memberRoleFilter !== 'all' && !memberHasRole(member, memberRoleFilter)) return false;
        if (!query) return true;
        return member.user.nickname.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (memberSort === 'alphabetical') {
          return a.user.nickname.localeCompare(b.user.nickname, language === 'ru' ? 'ru' : undefined, { sensitivity: 'base' });
        }
        if (memberSort === 'accountCreated') {
          return new Date(b.user.createdAt).getTime() - new Date(a.user.createdAt).getTime();
        }
        return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
      });
  }, [members, memberSearch, memberSort, memberRoleFilter, language]);
  const selectedVisibleMemberIds = useMemo(
    () => settingsMembers.filter((member) => selectedMemberIds.has(member.user.id)).map((member) => member.user.id),
    [settingsMembers, selectedMemberIds]
  );

  useEffect(() => {
    if (!showSettings || settingsTab !== 'invite' || !canManageInvites) return;
    void api.getGroupInvites(token, group.id).then((payload) => setGroupInvites(payload.invites)).catch(() => setGroupInvites([]));
  }, [showSettings, settingsTab, canManageInvites, token, group.id]);

  useEffect(() => {
    if (editTarget?.kind !== 'channel' || channelSettingsTab !== 'invites' || !canManageInvites) return;
    void api.getGroupInvites(token, group.id, editTarget.id).then((payload) => setGroupInvites(payload.invites)).catch(() => setGroupInvites([]));
  }, [editTarget, channelSettingsTab, canManageInvites, token, group.id]);

  useEffect(() => {
    if (editTarget?.kind !== 'channel' || channelSettingsTab !== 'permissions' || !canManageRoles) return;
    void api.getChannelPermissions(token, group.id, editTarget.id)
      .then((payload) => {
        const draft = permissionOverridesToDraft(payload.overrides);
        setChannelPermissionDraft(draft);
        setSavedChannelPermissionDraft(draft);
      })
      .catch(() => undefined);
  }, [editTarget, channelSettingsTab, canManageRoles, token, group.id]);

  useEffect(() => {
    setNewName(group.name);
    setNewDescription(group.description ?? '');
    setInviteCode(group.inviteCode);
    setNameplateDraft(group.nameplate ?? DEFAULT_NAMEPLATE);
    setSavedOverview({
      name: group.name,
      description: group.description ?? '',
      avatarData: group.avatarData,
      nameplate: JSON.stringify(group.nameplate ?? DEFAULT_NAMEPLATE)
    });
    setDefaultRoleId(group.defaultRoleId ?? null);
    setEveryonePermissions(group.everyonePermissions ?? []);
  }, [group.id, group.name, group.inviteCode, group.nameplate, group.description, group.avatarData, group.defaultRoleId, group.everyonePermissions]);

  // Load initial data
  useEffect(() => {
    // Seed from the session cache so a previously-opened group renders instantly
    // instead of flashing empty for the 1-2s the network takes. For a group we
    // have never opened, the cache is empty (renders blank, same as before).
    const cache = getGroupCache(group.id);
    setChannels(cache.channels);
    setRoles(cache.roles);
    setMembers(cache.members);
    setFolders(cache.folders);
    setCustomCategories(cache.customCategories);
    setSelectedOptionIds(cache.selectedOptionIds);
    setOnboardingRequired(cache.onboardingRequired);
    if (cache.onboardingRequired) setCustomizeOpen(true);
    const cachedActiveChannel = cache.activeChannel && cache.channels.some((channel) => channel.id === cache.activeChannel)
      ? cache.activeChannel
      : cache.channels.find((channel) => channel.type !== 'voice')?.id ?? cache.channels[0]?.id ?? null;
    if (cachedActiveChannel && cache.activeChannel !== cachedActiveChannel) cache.activeChannel = cachedActiveChannel;
    setActiveChannel(cachedActiveChannel);
    setMessages(cachedActiveChannel ? (cache.messages.get(cachedActiveChannel) ?? []) : []);
    if (cache.channels.length > 0 && Date.now() - cache.bootstrapLoadedAt <= GROUP_BOOTSTRAP_CACHE_TTL_MS) {
      voiceRoom?.requestGroupRooms(group.id);
      return;
    }

    let cancelled = false;
    void api.getGroupBootstrap(token, group.id).then((payload) => {
      // Ignore a stale response if the user already switched to another group.
      if (cancelled) return;
      setChannels(payload.channels);
      setRoles(payload.roles);
      setMembers(payload.members);
      setFolders(payload.folders);
      setCustomCategories(payload.customization.categories);
      setSelectedOptionIds(payload.customization.selectedOptionIds);
      setOnboardingRequired(payload.customization.onboardingRequired);
      if (payload.customization.onboardingRequired) setCustomizeOpen(true);
      // Write fresh data back to the cache for the next time this group opens.
      const entry = getGroupCache(group.id);
      entry.channels = payload.channels;
      entry.roles = payload.roles;
      entry.members = payload.members;
      entry.folders = payload.folders;
      entry.customCategories = payload.customization.categories;
      entry.selectedOptionIds = payload.customization.selectedOptionIds;
      entry.onboardingRequired = payload.customization.onboardingRequired;
      entry.bootstrapLoadedAt = Date.now();
      if (payload.channels.length > 0) {
        // Keep the cached active channel if it still exists, otherwise pick the
        // first text channel. Avoids resetting the user's channel on revalidate.
        const cachedStillValid = cache.activeChannel && payload.channels.some((c) => c.id === cache.activeChannel);
        const firstText = payload.channels.find((c) => c.type !== 'voice') ?? payload.channels[0];
        const nextActive = cachedStillValid ? cache.activeChannel : firstText.id;
        entry.activeChannel = nextActive;
        setActiveChannel(nextActive);
      }
    }).catch(() => {
      void Promise.all([
        api.getGroupChannels(token, group.id),
        api.getGroupRoles(token, group.id),
        api.getGroupMembers(token, group.id),
        api.getGroupFolders(token, group.id),
        api.getGroupCustomization(token, group.id)
      ]).then(([chanPayload, rolePayload, memPayload, folderPayload, customizationPayload]) => {
        if (cancelled) return;
        setChannels(chanPayload.channels);
        setRoles(rolePayload.roles);
        setMembers(memPayload.members);
        setFolders(folderPayload.folders);
        setCustomCategories(customizationPayload.categories);
        setSelectedOptionIds(customizationPayload.selectedOptionIds);
        setOnboardingRequired(customizationPayload.onboardingRequired);
        if (customizationPayload.onboardingRequired) setCustomizeOpen(true);
        const entry = getGroupCache(group.id);
        entry.channels = chanPayload.channels;
        entry.roles = rolePayload.roles;
        entry.members = memPayload.members;
        entry.folders = folderPayload.folders;
        entry.customCategories = customizationPayload.categories;
        entry.selectedOptionIds = customizationPayload.selectedOptionIds;
        entry.onboardingRequired = customizationPayload.onboardingRequired;
        entry.bootstrapLoadedAt = Date.now();
        const firstText = chanPayload.channels.find((channel) => channel.type !== 'voice') ?? chanPayload.channels[0];
        if (firstText) {
          entry.activeChannel = firstText.id;
          setActiveChannel(firstText.id);
        }
      }).catch(() => undefined);
    });
    // Ask the server who is currently in this group's voice channels so the
    // participants list and x/N badges show before we join.
    voiceRoom?.requestGroupRooms(group.id);

    return () => {
      cancelled = true;
    };
  }, [token, group.id]);

  // Load messages for active channel
  // Translations are ephemeral: clear them when switching channels or groups so
  // messages always show their original text again.
  useEffect(() => {
    setMessageTranslations({});
    setTranslatingIds(new Set());
    setReplyTarget(null);
    setReactionPicker(null);
    olderScrollAnchorRef.current = null;
  }, [group.id, activeChannel]);

  useEffect(() => {
    if (!activeChannel) return;
    // Show cached messages for this channel immediately, then revalidate.
    const cache = getGroupCache(group.id);
    const cachedMessages = cache.messages.get(activeChannel);
    if (cachedMessages) setMessages(cachedMessages);
    const cachedHasMore = cache.messageHasMore.get(activeChannel) ?? false;
    const cachedLoadedAt = cache.messageLoadedAt.get(activeChannel) ?? 0;
    // Only show skeleton placeholders when there is no cached thread to display.
    setThreadLoading(!cachedMessages);
    setHasMoreMessages(cachedMessages ? cachedHasMore : false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    cache.activeChannel = activeChannel;
    if (cachedMessages && Date.now() - cachedLoadedAt <= GROUP_MESSAGES_CACHE_TTL_MS) {
      setThreadLoading(false);
      return;
    }

    let cancelled = false;
    void api.getGroupMessages(token, group.id, activeChannel).then((payload) => {
      if (cancelled) return;
      setThreadLoading(false);
      setHasMoreMessages(payload.hasMore);
      setMessages((current) => {
        const merged = preservePendingReactions(payload.messages, current);
        const entry = getGroupCache(group.id);
        entry.messages.set(activeChannel, merged);
        entry.messageHasMore.set(activeChannel, payload.hasMore);
        entry.messageLoadedAt.set(activeChannel, Date.now());
        return merged;
      });
    }).catch(() => {
      if (!cancelled) setThreadLoading(false);
    });
    return () => { cancelled = true; };
  }, [token, group.id, activeChannel]);

  useEffect(() => {
    if (!activeChannel) {
      setChannelPinnedMessages([]);
      setChannelMediaMessages([]);
      loadedMediaChannelRef.current = null;
      loadingMediaChannelRef.current = null;
      return;
    }
    let cancelled = false;
    setPinCursor(0);
    setChannelMediaMessages([]);
    loadedMediaChannelRef.current = null;
    loadingMediaChannelRef.current = null;
    void api.getGroupPinnedMessages(token, group.id, activeChannel, { limit: 100 })
      .then((payload) => {
        if (!cancelled) setChannelPinnedMessages(payload.messages);
      })
      .catch(() => {
        if (!cancelled) setChannelPinnedMessages([]);
      });
    return () => { cancelled = true; };
  }, [token, group.id, activeChannel]);

  useEffect(() => {
    const thread = threadRef.current;
    const key = `${group.id}:${activeChannel ?? ''}`;
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
  }, [messages.length, group.id, activeChannel, currentUser.id]);

  useEffect(() => {
    if (threadRef.current) {
      userNearThreadBottomRef.current = threadRef.current.scrollHeight - threadRef.current.scrollTop - threadRef.current.clientHeight < 200;
      window.requestAnimationFrame(() => {
        if (threadRef.current) {
          userNearThreadBottomRef.current = threadRef.current.scrollHeight - threadRef.current.scrollTop - threadRef.current.clientHeight < 200;
        }
      });
    }
  }, [group.id, activeChannel]);

  // Load the previous (older) page of channel messages on scroll-up. The oldest
  // currently-loaded message id is the cursor; scroll position is preserved by
  // measuring the height delta after prepending.
  async function loadOlderMessages() {
    if (!activeChannel || loadingOlderRef.current || !hasMoreMessages) return;
    const oldest = messages[0];
    if (!oldest) return;
    const channel = activeChannel;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const thread = threadRef.current;
    const previousHeight = thread?.scrollHeight ?? 0;
    const previousTop = thread?.scrollTop ?? 0;
    olderScrollAnchorRef.current = { previousTop, previousHeight, until: Date.now() + 8000 };
    try {
      const payload = await api.getGroupMessages(token, group.id, channel, { before: oldest.id });
      if (channel !== activeChannelRef.current) return;
      if (payload.messages.length > 0) {
        setMessages((current) => {
          const seen = new Set(current.map((m) => m.id));
          const older = payload.messages.filter((m) => !seen.has(m.id));
          const next = [...older, ...current];
          const entry = getGroupCache(group.id);
          entry.messages.set(channel, next);
          entry.messageLoadedAt.set(channel, Date.now());
          return next;
        });
        scheduleOlderScrollRestore();
      } else {
        olderScrollAnchorRef.current = null;
      }
      setHasMoreMessages(payload.hasMore);
      getGroupCache(group.id).messageHasMore.set(channel, payload.hasMore);
    } catch {
      olderScrollAnchorRef.current = null;
      // Leave the thread as-is on failure.
    } finally {
      setLoadingOlder(false);
      window.setTimeout(() => { loadingOlderRef.current = false; }, 1200);
    }
  }

  // Mirror live state into the session cache so socket-driven updates (new
  // messages, channel/member/role changes) are reflected the next time this
  // group is reopened, keeping the instant-render cache fresh.
  useEffect(() => {
    const entry = getGroupCache(group.id);
    entry.channels = channels;
    entry.roles = roles;
    entry.members = members;
    entry.folders = folders;
    channelsRef.current = channels;
  }, [group.id, channels, roles, members, folders]);

  useEffect(() => {
    if (!activeChannel) return;
    const entry = getGroupCache(group.id);
    entry.activeChannel = activeChannel;
    entry.messages.set(activeChannel, messages);
  }, [group.id, activeChannel, messages]);

  useEffect(() => {
    if (!initialChannelId) return;
    const requestKey = `${initialChannelRequestId}:${initialChannelId}`;
    if (consumedInitialChannelRef.current === requestKey) return;
    if (!channels.some((channel) => channel.id === initialChannelId)) return;
    consumedInitialChannelRef.current = requestKey;
    setActiveChannel(initialChannelId);
  }, [channels, initialChannelId, initialChannelRequestId]);

  // Listen for real-time group messages via the shared session socket.
  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;
    function handleNewMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      if (msg.groupId !== group.id) return;
      const entry = getGroupCache(group.id);
      if (msg.channelId) {
        const cached = entry.messages.get(msg.channelId) ?? [];
        entry.messages.set(msg.channelId, mergeLiveGroupMessage(cached, msg));
        entry.messageLoadedAt.set(msg.channelId, Date.now());
      }
      setMessages((current) => {
        if (current.some((m) => m.id === msg.id)) return current;
        if (activeChannelRef.current !== null && msg.channelId !== activeChannelRef.current) return current;
        // If this is the broadcast for our own just-sent message, replace the
        // pending optimistic bubble in place (keep its clientKey) instead of
        // appending a duplicate — avoids the brief flash/jump.
        const pendingIdx = current.findIndex(
          (m) =>
            m.pending &&
            m.senderId === msg.senderId &&
            m.body === msg.body &&
            m.channelId === msg.channelId &&
            (m.imageName ?? null) === (msg.imageName ?? null)
        );
        if (pendingIdx !== -1) {
          const next = current.slice();
          next[pendingIdx] = { ...msg, clientKey: current[pendingIdx].clientKey };
          return next;
        }
        return [...current, msg];
      });
      if (msg.channelId === activeChannelRef.current) {
        if (msg.pinnedAt && !msg.deletedAt) {
          setChannelPinnedMessages((current) => [msg, ...current.filter((m) => m.id !== msg.id)]);
        }
        if (!msg.deletedAt && getMessageMediaItems(msg).some((item) => item.dataUrl && !isVoiceAttachment(item.dataUrl, item.name) && !isVideoCircleAttachment(item.dataUrl, item.name))) {
          setChannelMediaMessages((current) => current.some((m) => m.id === msg.id) ? current : [...current, msg]);
        }
      }
    }
    function handleUpdateMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      if (msg.groupId !== group.id) return;
      const entry = getGroupCache(group.id);
      if (msg.deletedAt) {
        onForwardSourceDeleted?.(msg.id);
        if (msg.feedSourceId) onForwardSourceDeleted?.(msg.feedSourceId);
        setDeletedForwardSourceIds((current) => {
          const next = new Set(current);
          next.add(msg.id);
          if (msg.feedSourceId) next.add(msg.feedSourceId);
          return next;
        });
      }
      if (msg.channelId) {
        const cached = entry.messages.get(msg.channelId);
        if (cached) {
          const deletedReplyId = msg.feedSourceId ?? msg.id;
          const nextCached = msg.deletedAt
            ? cached
                .filter((m) => m.id !== msg.id)
                .map((m) => markDeletedReplyInGroup(m, deletedReplyId, msg.deletedAt!))
            : cached.map((m) => {
                if (m.id === msg.id) return mergePendingReactions(msg, m);
                return m;
              });
          entry.messages.set(msg.channelId, nextCached);
        }
      }
      setMessages((current) => {
        if (msg.deletedAt) {
          return current
            .filter((m) => m.id !== msg.id)
            .map((m) => markDeletedReplyInGroup(m, msg.feedSourceId ?? msg.id, msg.deletedAt!));
        }
        const next = current.map((m) => {
          if (m.id === msg.id) return mergePendingReactions(msg, m);
          return m;
        });
        const channel = activeChannelRef.current;
        if (channel) getGroupCache(group.id).messages.set(channel, next);
        return next;
      });
      if (msg.channelId === activeChannelRef.current) {
        setChannelPinnedMessages((current) => {
          if (msg.deletedAt || !msg.pinnedAt) return current.filter((m) => m.id !== msg.id);
          const next = [msg, ...current.filter((m) => m.id !== msg.id)];
          return next.sort((a, b) => new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime());
        });
        setChannelMediaMessages((current) => {
          if (msg.deletedAt) return current.filter((m) => m.id !== msg.id);
          const hasMedia = getMessageMediaItems(msg).some((item) => item.dataUrl && !isVoiceAttachment(item.dataUrl, item.name) && !isVideoCircleAttachment(item.dataUrl, item.name));
          if (!hasMedia) return current.filter((m) => m.id !== msg.id);
          const next = current.some((m) => m.id === msg.id) ? current.map((m) => m.id === msg.id ? msg : m) : [...current, msg];
          return next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      }
    }
    function handleChannelCreated(payload: { channel: GroupChannel }) {
      if (payload.channel.groupId !== group.id) return;
      setChannels((current) => current.some((c) => c.id === payload.channel.id) ? current : [...current, payload.channel]);
    }
    function handleChannelDeleted(payload: { channelId: string; groupId: string }) {
      if (payload.groupId !== group.id) return;
      setChannels((current) => current.filter((c) => c.id !== payload.channelId));
    }
    function handleChannelUpdated(payload: { channel: GroupChannel }) {
      if (payload.channel.groupId !== group.id) return;
      setChannels((current) => {
        const next = current.map((c) => c.id === payload.channel.id ? payload.channel : c);
        return [...next].sort((a, b) => a.position - b.position);
      });
    }
    function handleChannelsReordered(payload: { groupId: string; channels: GroupChannel[] }) {
      if (payload.groupId !== group.id) return;
      if (payload.channels.length > 0) setChannels(payload.channels);
      else void api.getGroupChannels(token, group.id).then((fresh) => setChannels(fresh.channels)).catch(() => undefined);
    }
    function handleFolderCreated(payload: { folder: GroupFolder }) {
      if (payload.folder.groupId !== group.id) return;
      setFolders((current) => current.some((f) => f.id === payload.folder.id) ? current : [...current, payload.folder]);
    }
    function handleFolderUpdated(payload: { folder: GroupFolder }) {
      if (payload.folder.groupId !== group.id) return;
      setFolders((current) => [...current.map((f) => f.id === payload.folder.id ? payload.folder : f)].sort((a, b) => a.position - b.position));
    }
    function handleFolderDeleted(payload: { folderId: string; groupId: string; channels: GroupChannel[] }) {
      if (payload.groupId !== group.id) return;
      setFolders((current) => current.filter((f) => f.id !== payload.folderId));
      if (payload.channels) setChannels(payload.channels);
    }
    function handleRolesChanged(payload: { groupId: string }) {
      if (payload.groupId !== group.id) return;
      void api.getGroupRoles(token, group.id).then((p) => setRoles(p.roles));
      void api.getGroupMembers(token, group.id).then((p) => setMembers(p.members));
    }
    function handleMemberJoined(payload: { groupId: string }) {
      if (payload.groupId !== group.id) return;
      void api.getGroupMembers(token, group.id).then((p) => setMembers(p.members));
    }
    function handleMemberRoleChanged(payload: { groupId: string; members: GroupMember[] }) {
      if (payload.groupId !== group.id) return;
      setMembers(payload.members);
    }
    function handleCustomizationChanged(payload: { groupId: string; categories: CustomCategory[] }) {
      if (payload.groupId !== group.id) return;
      setCustomCategories(payload.categories);
    }
    // Sent only to the affected member after they toggle an option: refresh the
    // channel/folder lists so newly unlocked (or hidden) ones appear instantly.
    function handleCustomizationApplied(payload: { groupId: string; channels: GroupChannel[]; folders: GroupFolder[] }) {
      if (payload.groupId !== group.id) return;
      setChannels(payload.channels);
      setFolders(payload.folders);
    }
    function handleThreadMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      if (msg.groupId !== group.id || !msg.threadRootId) return;
      const rootId = msg.threadRootId;
      // Bump the root's reply counter in the channel flow.
      setMessages((current) => current.map((m) => (m.id === rootId ? { ...m, threadCount: (m.threadCount ?? 0) + 1 } : m)));
      if (threadViewRootRef.current === rootId) {
        setThreadViewMessages((current) => current.some((m) => m.id === msg.id) ? current : [...current, msg]);
      }
    }

    socket.on('messenger:groupMessage', handleNewMessage);
    socket.on('messenger:groupThreadMessage', handleThreadMessage);
    socket.on('messenger:groupMessageUpdated', handleUpdateMessage);
    socket.on('messenger:groupMessageDeleted', handleUpdateMessage);
    socket.on('messenger:groupChannelCreated', handleChannelCreated);
    socket.on('messenger:groupChannelDeleted', handleChannelDeleted);
    socket.on('messenger:groupChannelUpdated', handleChannelUpdated);
    socket.on('messenger:groupChannelsReordered', handleChannelsReordered);
    socket.on('messenger:groupFolderCreated', handleFolderCreated);
    socket.on('messenger:groupFolderUpdated', handleFolderUpdated);
    socket.on('messenger:groupFolderDeleted', handleFolderDeleted);
    socket.on('messenger:groupRolesChanged', handleRolesChanged);
    socket.on('messenger:groupMemberRoleChanged', handleMemberRoleChanged);
    socket.on('messenger:groupMemberJoined', handleMemberJoined);
    socket.on('messenger:groupCustomizationChanged', handleCustomizationChanged);
    socket.on('messenger:groupCustomizationApplied', handleCustomizationApplied);
    // Only detach our own listeners; never disconnect the shared session socket
    // (doing so would tear down presence and every other live feature).
    return () => {
      socket.off('messenger:groupMessage', handleNewMessage);
      socket.off('messenger:groupThreadMessage', handleThreadMessage);
      socket.off('messenger:groupMessageUpdated', handleUpdateMessage);
      socket.off('messenger:groupMessageDeleted', handleUpdateMessage);
      socket.off('messenger:groupChannelCreated', handleChannelCreated);
      socket.off('messenger:groupChannelDeleted', handleChannelDeleted);
      socket.off('messenger:groupChannelUpdated', handleChannelUpdated);
      socket.off('messenger:groupChannelsReordered', handleChannelsReordered);
      socket.off('messenger:groupFolderCreated', handleFolderCreated);
      socket.off('messenger:groupFolderUpdated', handleFolderUpdated);
      socket.off('messenger:groupFolderDeleted', handleFolderDeleted);
      socket.off('messenger:groupRolesChanged', handleRolesChanged);
      socket.off('messenger:groupMemberRoleChanged', handleMemberRoleChanged);
      socket.off('messenger:groupMemberJoined', handleMemberJoined);
      socket.off('messenger:groupCustomizationChanged', handleCustomizationChanged);
      socket.off('messenger:groupCustomizationApplied', handleCustomizationApplied);
    };
  }, [sharedSocket, token, group.id]);

  // Sync activeChannel ref for socket handler
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);

  useEffect(() => {
    if (!activeChannel) return;
    setGroupTyping((current) => {
      const next = { ...current };
      let changed = false;
      for (const [userId, info] of Object.entries(next)) {
        if (info.channelId !== activeChannel) {
          delete next[userId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeChannel]);

  useEffect(() => {
    if (!sharedSocket) return;
    function handleGroupTyping(payload: { groupId?: string; channelId?: string | null; userId?: string; typing?: boolean }) {
      if (payload.groupId !== group.id || typeof payload.userId !== 'string' || payload.userId === currentUser.id) return;
      const channelId = payload.channelId ?? null;
      if (channelId !== activeChannelRef.current) {
        if (!payload.typing) {
          setGroupTyping((current) => {
            if (!current[payload.userId!]) return current;
            const next = { ...current };
            delete next[payload.userId!];
            return next;
          });
        }
        return;
      }
      setGroupTyping((current) => {
        if (!payload.typing) {
          if (!current[payload.userId!]) return current;
          const next = { ...current };
          delete next[payload.userId!];
          return next;
        }
        return { ...current, [payload.userId!]: { channelId, at: Date.now() } };
      });
    }
    sharedSocket.on('group:typing', handleGroupTyping);
    return () => {
      sharedSocket.off('group:typing', handleGroupTyping);
    };
  }, [sharedSocket, group.id, currentUser.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setGroupTyping((current) => {
        const next = { ...current };
        let changed = false;
        for (const [userId, info] of Object.entries(next)) {
          if (now - info.at > GROUP_TYPING_STALE_MS) {
            delete next[userId];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (groupTypingTimerRef.current) window.clearTimeout(groupTypingTimerRef.current);
      if (sharedSocket) {
        sharedSocket.emit('group:typing', { groupId: group.id, channelId: activeChannelRef.current, typing: false });
      }
    };
  }, [sharedSocket, group.id]);

  // Close context menus on outside click
  useEffect(() => {
    if (!messageMenu && !memberMenu && !channelMenu && !groupMenuOpen && !composerMenu && !imageCaptionMenu) return;
    function close(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.('.context-menu')) return;
      setMessageMenu(null);
      setMemberMenu(null);
      setChannelMenu(null);
      setGroupMenuOpen(false);
      setComposerMenu(null);
      setImageCaptionMenu(null);
    }
    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', close);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', close);
    };
  }, [messageMenu, memberMenu, channelMenu, groupMenuOpen, composerMenu, imageCaptionMenu]);

  // Close the quick nameplate popup on outside click. Keep it open while the
  // crop modal is showing so clicks inside the cropper don't dismiss it.
  useEffect(() => {
    if (!platePopupOpen) return;
    function close(event: globalThis.MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.('.nameplate-quick-popup')) return;
      if (target?.closest?.('.modal-backdrop')) return;
      if (target?.closest?.('.group-name-btn')) return;
      setPlatePopupOpen(false);
    }
    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', close);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', close);
    };
  }, [platePopupOpen]);

  useEffect(() => {
    if (!resizing) return;
    function move(event: globalThis.MouseEvent) {
      const panel = document.querySelector('.messenger-chat-panel');
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      setMemberPanelWidth(Math.max(MEMBER_PANEL_MIN, Math.min(MEMBER_PANEL_MAX, panelRect.right - event.clientX)));
    }
    function up() { setResizing(false); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
    return () => window.removeEventListener('mousemove', move);
  }, [resizing]);

  useEffect(() => {
    if (!resizingChannels) return;
    function move(event: globalThis.MouseEvent) {
      const layout = document.querySelector('.group-chat-layout');
      if (!layout) return;
      const layoutRect = layout.getBoundingClientRect();
      setChannelPanelWidth(Math.max(CHANNEL_PANEL_MIN, Math.min(CHANNEL_PANEL_MAX, event.clientX - layoutRect.left)));
    }
    function up() { setResizingChannels(false); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
    return () => window.removeEventListener('mousemove', move);
  }, [resizingChannels]);

  // Persist widths after a drag finishes (not on every pixel move).
  useEffect(() => { if (!resizing) savePanelWidth('member', memberPanelWidth); }, [resizing, memberPanelWidth]);
  useEffect(() => { if (!resizingChannels) savePanelWidth('channel', channelPanelWidth); }, [resizingChannels, channelPanelWidth]);

  const knownSenders = useMemo(() => {
    const map = new Map(members.map((m) => [m.user.id, m.user]));
    map.set(currentUser.id, currentUser);
    return map;
  }, [members, currentUser]);

  const messageRunKeys = useMemo(() => {
    const keys = new Map<string, string>();
    let runKey = '';
    messages.forEach((message, index) => {
      const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
      const previous = index === 0 ? null : messages[index - 1];
      const isStartOfGroup = showDateDivider || !previous || groupMessageRunIdentity(previous) !== groupMessageRunIdentity(message) || (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 120000);
      if (isStartOfGroup) runKey = message.id;
      keys.set(message.id, runKey || message.id);
    });
    return keys;
  }, [messages]);

  const visibleTypingMembers = useMemo(() => {
    const now = Date.now();
    return Object.entries(groupTyping)
      .filter(([userId, info]) =>
        userId !== currentUser.id &&
        info.channelId === activeChannel &&
        now - info.at < GROUP_TYPING_STALE_MS
      )
      .map(([userId]) => knownSenders.get(userId))
      .filter((user): user is PublicUser => Boolean(user));
  }, [groupTyping, activeChannel, currentUser.id, knownSenders]);

  const typingMemberIds = useMemo(() => {
    const next = new Set(visibleTypingMembers.map((user) => user.id));
    if (selfTypingChannel === activeChannel) next.add(currentUser.id);
    return next;
  }, [visibleTypingMembers, selfTypingChannel, activeChannel, currentUser.id]);

  const groupTypingText = useMemo(() => {
    if (visibleTypingMembers.length === 0) return '';
    if (visibleTypingMembers.length === 1) {
      return language === 'ru'
        ? `${visibleTypingMembers[0].nickname} печатает`
        : `${visibleTypingMembers[0].nickname} is typing`;
    }
    if (visibleTypingMembers.length === 2) {
      const [first, second] = visibleTypingMembers;
      return language === 'ru'
        ? `${first.nickname} и ${second.nickname} печатают`
        : `${first.nickname} and ${second.nickname} are typing`;
    }
    return language === 'ru' ? 'Несколько человек печатают' : 'Several people are typing';
  }, [visibleTypingMembers, language]);

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const isSelfInvisible = selfStatus.status === 'invisible';
  const memberPresenceStatus = (userId: string): PresenceStatus | null => {
    if (userId === currentUser.id) return isSelfInvisible ? null : selfStatus.status;
    return presenceStatuses[userId] ?? (onlineSet.has(userId) ? 'online' : null);
  };
  const isMemberOnline = (userId: string) => {
    return Boolean(memberPresenceStatus(userId));
  };

  // Group members into Discord-style categories for the right-hand member list:
  //  - Offline members always go to a single "Offline" group (any role).
  //  - Online members whose primary role is "hoisted" (displayed) are grouped
  //    under that role; the owner role is always treated as hoisted.
  //  - Other online members fall into a single "Online" group.
  // Empty categories are not rendered.
  const memberCategories = useMemo(() => {
    type Category = { key: string; label: string; color?: string; position: number; members: GroupMember[] };
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const roleGroups = new Map<string, Category>();
    const online: GroupMember[] = [];
    const offline: GroupMember[] = [];

    for (const member of members) {
      if (!isMemberOnline(member.user.id)) {
        offline.push(member);
        continue;
      }
      const role = member.roleId ? roleById.get(member.roleId) : undefined;
      const hoisted = role && (role.isOwner || role.hoist);
      if (role && hoisted) {
        const existing = roleGroups.get(role.id);
        if (existing) existing.members.push(member);
        else roleGroups.set(role.id, { key: role.id, label: role.name, color: role.color, position: role.position, members: [member] });
      } else {
        online.push(member);
      }
    }

    const categories: Category[] = [...roleGroups.values()].sort((a, b) => a.position - b.position);
    if (online.length > 0) categories.push({ key: 'online', label: t(language, 'memberGroupOnline'), position: 9998, members: online });
    if (offline.length > 0) categories.push({ key: 'offline', label: t(language, 'memberGroupOffline'), position: 9999, members: offline });
    return categories.filter((c) => c.members.length > 0);
  }, [members, roles, onlineSet, currentUser.id, isSelfInvisible, language]);

  function senderName(senderId: string) {
    return knownSenders.get(senderId)?.nickname ?? senderId.slice(0, 8);
  }

  // Build the roles a member holds from already-loaded state so the profile can
  // render them instantly (no network wait) when opened from this group view.
  function buildProfilePreload(userId: string): { groupRoles: GroupRole[]; userRoles: GroupRole[] } {
    const member = members.find((m) => m.user.id === userId);
    const heldRoleIds = new Set(
      member?.roleIds && member.roleIds.length > 0
        ? member.roleIds
        : member?.roleId ? [member.roleId] : []
    );
    const userRoles = roles
      .filter((r) => heldRoleIds.has(r.id))
      .sort((a, b) => a.position - b.position);
    return { groupRoles: roles, userRoles };
  }

  function formatTime(value: string) {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uk' ? 'uk-UA' : 'en-US', {
      hour: '2-digit', minute: '2-digit', hour12: getSavedTimeFormat() === '12h'
    }).format(new Date(value));
  }

  function formatShortDate(value: string) {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uk' ? 'uk-UA' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value));
  }

  function formatDuration(seconds: number) {
    if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
    if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.max(1, seconds)}s`;
  }

  function formatCountdown(seconds: number) {
    const safe = Math.max(0, Math.ceil(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  async function copyEntityId(id: string) {
    try { await navigator.clipboard.writeText(id); } catch { /* clipboard can be blocked */ }
    setChannelMenu(null);
  }

  function applyTopicFormat(marker: string) {
    const textarea = editTopicTextareaRef.current;
    const start = textarea?.selectionStart ?? editTopicDraft.length;
    const end = textarea?.selectionEnd ?? start;
    const selected = editTopicDraft.slice(start, end);
    const insert = `${marker}${selected}${marker}`;
    const next = `${editTopicDraft.slice(0, start)}${insert}${editTopicDraft.slice(end)}`.slice(0, 1024);
    const caretStart = start + marker.length;
    const caretEnd = caretStart + selected.length;
    setEditTopicDraft(next);
    window.requestAnimationFrame(() => {
      editTopicTextareaRef.current?.focus();
      editTopicTextareaRef.current?.setSelectionRange(caretStart, Math.min(caretEnd, next.length));
    });
  }

  async function uploadPendingChatImages(items: Array<{ dataUrl: string; name: string; spoiler: boolean }>) {
    const uploaded: Array<{ dataUrl: string; name: string; spoiler: boolean }> = [];
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

  async function sendMessage(attachmentOverride?: { dataUrl: string; name: string; spoiler: boolean }) {
    if (!activeChannel) return;
    if (!canSendInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0) return;
    const voiceOverride = Boolean(attachmentOverride && isVoiceAttachment(attachmentOverride.dataUrl, attachmentOverride.name));
    const videoCircleOverride = Boolean(attachmentOverride && isVideoCircleAttachment(attachmentOverride.dataUrl, attachmentOverride.name));
    const recordingOverride = voiceOverride || videoCircleOverride;
    const batchImages = attachmentOverride ? [attachmentOverride] : pendingImages;
    const image = batchImages[0] ?? null;
    if (voiceOverride && !canSendVoiceMessagesInActiveChannel) return;
    if (videoCircleOverride && !canSendVideoCirclesInActiveChannel) return;
    if (image && !recordingOverride && !canAttachInActiveChannel) return;
    const body = recordingOverride ? '' : applySlashCommand(expandCustomEmojiShortcodes((image ? imageCaptionDraft : draft).trim()));
    if (!canUseExternalEmojisInActiveChannel && body.includes('<ce:')) return;
    if (!body && !image) return;
    emitGroupTyping(false, activeChannel);
    if (!recordingOverride) {
      if (image) setImageCaptionDraft('');
      else setDraft('');
      setPendingImages([]);
    }
    setImageEmojiOpen(false);
    const activeReplyTarget = replyTarget && messages.some((message) => message.id === replyTarget.id || message.feedSourceId === replyTarget.id)
      ? replyTarget
      : null;
    const replyTo = activeReplyTarget?.id;
    const previousReply = activeReplyTarget;
    setReplyTarget(null);
    const postingToFeed = activeChannelObj?.type === 'feed';
    const activeSenderGroup = postingToFeed
      ? { id: group.id, name: group.name, avatarData: group.avatarData }
      : canUseGroupIdentity && sendAsGroupIdentity
      ? { id: group.id, name: group.name, avatarData: group.avatarData }
      : null;

    // Optimistic render: show the message instantly with a stable clientKey.
    // When the server responds we reconcile IN PLACE (keep the same clientKey)
    // so React updates the existing bubble instead of remounting it — that
    // remount was what made the message flash and jump. Rolled back on failure.
    const clientKey = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: GroupMessage = {
      id: clientKey,
      groupId: group.id,
      channelId: activeChannel,
      senderId: currentUser.id,
      senderGroup: activeSenderGroup,
      body,
      imageData: image ? image.dataUrl : null,
      imageName: image ? image.name ?? null : null,
      imageSpoiler: image ? image.spoiler ?? false : false,
      mediaItems: !recordingOverride && batchImages.length > 1
        ? batchImages.map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: item.spoiler }))
        : image ? [{ dataUrl: image.dataUrl, name: image.name ?? null, spoiler: image.spoiler }] : [],
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      feedSourceId: null,
      feedMirror: false,
      viewCount: 0,
      reactions: [],
      replyTo: previousReply,
      createdAt: new Date().toISOString(),
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
      const payload = await api.sendGroupMessage(token, group.id, body, activeChannel, uploadedImage && !mediaItems ? { dataUrl: uploadedImage.dataUrl, name: uploadedImage.name, spoiler: uploadedImage.spoiler } : undefined, replyTo, activeSenderGroup?.id ?? null, mediaItems);
      setMessages((current) => {
        // If the socket broadcast already delivered the real message, drop our
        // placeholder. Otherwise replace it in place, preserving clientKey.
        const realAlreadyHere = current.some((m) => m.id === payload.message.id && m.clientKey !== clientKey);
        if (realAlreadyHere) return current.filter((m) => m.clientKey !== clientKey);
        return current.map((m) => (m.clientKey === clientKey ? { ...payload.message, clientKey } : m));
      });
      if (activeSlowmodeSeconds > 0 && !canBypassActiveSlowmode) {
        setSlowmodeUntilByChannel((current) => ({ ...current, [activeChannel]: Date.now() + activeSlowmodeSeconds * 1000 }));
        setSlowmodeNow(Date.now());
      }
    } catch (error) {
      // Drop the placeholder and restore the draft/image so the user can retry.
      setMessages((current) => current.filter((m) => m.clientKey !== clientKey));
      if (!recordingOverride) {
        if (image) { setImageCaptionDraft(body); setPendingImages(batchImages); }
        else setDraft(body);
      }
      if (previousReply) setReplyTarget(previousReply);
      const retryAfterMs = typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
        ? (error as { retryAfterMs: number }).retryAfterMs
        : 0;
      if ((error as { code?: string }).code === 'SLOWMODE_ACTIVE' || retryAfterMs > 0) {
        setSlowmodeUntilByChannel((current) => ({ ...current, [activeChannel]: Date.now() + Math.max(retryAfterMs, activeSlowmodeSeconds * 1000) }));
        setSlowmodeNow(Date.now());
      }
      if (recordingOverride) throw error;
    }
  }

  async function prepareImageFromFile(file: File | undefined) {
    if (!file) return;
    if (!canAttachInActiveChannel || activeNsfwBlocked) return;
    if (!file.type.startsWith('image/')) { return; }
    if (file.size > MAX_CHAT_IMAGE_SIZE) { return; }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPendingImages((current) => [...current, { dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
      setEmojiOpen(false);
      setImageEmojiOpen(false);
    } catch { }
  }

  function handleImageDrop(e: React.DragEvent<HTMLDivElement>) {
    if (editingMessage || !activeChannel) return;
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setImageDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')).slice(0, MAX_CHAT_MEDIA_BATCH);
    files.forEach((file) => void prepareImageFromFile(file));
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLElement>) {
    if (editingMessage || !canAttachInActiveChannel || activeNsfwBlocked) return;
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

  function openImageViewer(src: string, name: string) {
    const items: MediaLightboxItem[] = [];
    const mediaMessages = channelMediaMessages.length > 0 ? channelMediaMessages : messages;
    for (const message of mediaMessages) {
      if (message.deletedAt) continue;
      const senderUser = message.senderGroup ? null : (knownSenders.get(message.senderId) ?? (message.senderId === currentUser.id ? currentUser : null));
      const senderName = message.senderGroup?.name || senderUser?.nickname || currentUser.nickname;
      for (const item of getMessageMediaItems(message)) {
        if (!item.dataUrl || isVoiceAttachment(item.dataUrl, item.name) || isVideoCircleAttachment(item.dataUrl, item.name)) continue;
        items.push({
          src: item.dataUrl,
          name: item.name ?? t(language, 'imageMessage'),
          senderName,
          senderUser: senderUser ?? undefined,
          createdAt: message.createdAt
        });
      }
    }
    if (!items.some((item) => item.src === src)) items.push({ src, name });
    const index = items.findIndex((item) => item.src === src);
    setImageViewer(index >= 0 ? { items, index } : { items: [{ src, name }], index: 0 });
    loadChannelMediaMessages();
  }

  function loadChannelMediaMessages() {
    const channelId = activeChannelRef.current;
    if (!channelId) return;
    const key = `${group.id}:${channelId}`;
    if (loadedMediaChannelRef.current === key || loadingMediaChannelRef.current === key) return;

    loadingMediaChannelRef.current = key;
    void api.getGroupMediaMessages(token, group.id, channelId, { limit: 500 })
      .then((payload) => {
        if (activeChannelRef.current !== channelId) return;
        loadedMediaChannelRef.current = key;
        setChannelMediaMessages(payload.messages);
      })
      .catch(() => {
        if (activeChannelRef.current === channelId) setChannelMediaMessages([]);
      })
      .finally(() => {
        if (loadingMediaChannelRef.current === key) loadingMediaChannelRef.current = null;
      });
  }

  function openImageMessageMenu(event: MouseEvent<HTMLElement>, message: GroupMessage, src: string) {
    event.preventDefault();
    event.stopPropagation();
    if (message.deletedAt) return;
    setMessageMenu({ x: event.clientX, y: event.clientY, message, imageSrc: src });
  }

  function emitGroupTyping(typing: boolean, channelId = activeChannelRef.current) {
    if (!channelId) return;
    const local = localGroupTypingRef.current;
    const now = Date.now();
    if (typing && local.active && local.channelId === channelId && now - local.emittedAt < 1200) return;
    if (!typing && (!local.active || (local.channelId !== null && local.channelId !== channelId))) return;
    localGroupTypingRef.current = { channelId, active: typing, emittedAt: now };
    setSelfTypingChannel(typing ? channelId : null);
    sharedSocket?.emit('group:typing', { groupId: group.id, channelId, typing });
  }

  function updateGroupDraft(value: string) {
    setDraft(value);
    if (!activeChannel) return;
    emitGroupTyping(value.trim().length > 0, activeChannel);
    if (groupTypingTimerRef.current) window.clearTimeout(groupTypingTimerRef.current);
    if (value.trim().length > 0) {
      groupTypingTimerRef.current = window.setTimeout(() => emitGroupTyping(false, activeChannel), GROUP_TYPING_IDLE_MS);
    } else {
      groupTypingTimerRef.current = null;
    }
  }

  async function editMessage(message: GroupMessage) {
    setEditingMessage(message);
    setEditingMediaItems(getMessageMediaItems(message).map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? t(language, 'imageMessage'), spoiler: item.spoiler })));
    updateGroupDraft(message.body);
    setMessageMenu(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function saveEdit() {
    if (!editingMessage) return;
    const body = expandCustomEmojiShortcodes(draft.trim());
    const nextMediaItems = editingMediaItems.map((item) => ({ dataUrl: item.dataUrl, name: item.name, spoiler: item.spoiler }));
    if (!body && nextMediaItems.length === 0) { setEditingMessage(null); setEditingMediaItems([]); emitGroupTyping(false); setDraft(''); return; }
    try {
      const payload = await api.editGroupMessage(token, editingMessage.id, body, nextMediaItems);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      setEditingMessage(null);
      setEditingMediaItems([]);
      emitGroupTyping(false);
      setDraft('');
    } catch { }
  }

  async function deleteMessage(message: GroupMessage) {
    try {
      const payload = await api.deleteGroupMessage(token, message.id);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setEditingMediaItems([]);
        setDraft('');
      }
      setMessageMenu(null);
    } catch { }
  }

  // Toggle an emoji reaction on a message. Optimistically updates the local
  // reaction list, then reconciles with the server response (a socket event
  // also broadcasts the authoritative state to every member).
  async function toggleReaction(message: GroupMessage, emoji: string) {
    if (!canReactInActiveChannel) return;
    const pendingKey = `${message.id}:${emoji}`;
    if (reactionTogglePendingRef.current.has(pendingKey)) return;
    reactionTogglePendingRef.current.add(pendingKey);
    setMessageMenu(null);
    setReactionPicker(null);
    recordRecentEmoji(emoji);
    setMessages((current) => {
      const nextMessages = current.map((m) => {
        if (m.id !== message.id) return m;
        const reactions = m.reactions ?? [];
        const existing = reactions.find((r) => r.emoji === emoji);
        const mine = existing?.userIds.includes(currentUser.id);
        let next;
        if (existing) {
          next = reactions
            .map((r) => r.emoji !== emoji ? r : {
              ...r,
              count: mine ? r.count - 1 : r.count + 1,
              userIds: mine ? r.userIds.filter((id) => id !== currentUser.id) : [...r.userIds, currentUser.id]
            })
            .filter((r) => r.count > 0);
        } else {
          next = [...reactions, { emoji, count: 1, userIds: [currentUser.id] }];
        }
        return { ...m, reactions: next };
      });
      const channel = activeChannelRef.current;
      if (channel) getGroupCache(group.id).messages.set(channel, nextMessages);
      return nextMessages;
    });
    try {
      const payload = await api.toggleGroupMessageReaction(token, message.id, emoji);
      setMessages((current) => {
        const nextMessages = current.map((m) => m.id === payload.message.id ? mergePendingReactions(payload.message, m, emoji) : m);
        const channel = activeChannelRef.current;
        if (channel) getGroupCache(group.id).messages.set(channel, nextMessages);
        return nextMessages;
      });
    } catch {
      // On failure, reload the authoritative thread state.
      if (activeChannel) {
        void api.getGroupMessages(token, group.id, activeChannel).then((p) => setMessages(p.messages)).catch(() => undefined);
      }
    } finally {
      reactionTogglePendingRef.current.delete(pendingKey);
    }
  }

  // Reply: set the reply target so the composer shows the reply bar; the next
  // sent message references this message (Discord-style inline reply).
  function replyToMessage(message: GroupMessage) {
    setMessageMenu(null);
    setReactionPicker(null);
    setReplyTarget({
      id: message.feedSourceId ?? message.id,
      senderId: message.senderId,
      senderGroup: message.senderGroup,
      body: message.body,
      imageData: message.imageData,
      imageName: message.imageName,
      mediaItems: message.mediaItems,
      feedPost: isFeedRelatedMessage(message, channels),
      feedSourceId: message.feedSourceId,
      feedMirror: message.feedMirror,
      viewCount: message.viewCount,
      reactions: message.reactions,
      createdAt: message.createdAt
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commentOnFeedPost(message: GroupMessage) {
    setMessageMenu(null);
    setReactionPicker(null);
    const feedChannel = channels.find((channel) => channel.id === message.channelId && channel.type === 'feed')
      ?? channels.find((channel) => channel.id === activeChannel && channel.type === 'feed');
    const chatChannelId = feedChannel?.feedChatChannelId
      ?? channels.find((channel) => channel.feedParentChannelId === feedChannel?.id)?.id
      ?? null;
    if (!chatChannelId) return;
    const nextReply: MessageReplySnippet = {
      id: message.feedSourceId ?? message.id,
      senderId: message.senderId,
      senderGroup: message.senderGroup,
      body: message.body,
      imageData: message.imageData,
      imageName: message.imageName,
      mediaItems: message.mediaItems,
      feedPost: true,
      feedSourceId: message.feedSourceId,
      feedMirror: message.feedMirror,
      viewCount: message.viewCount,
      reactions: message.reactions,
      createdAt: message.createdAt
    };
    setActiveChannel(chatChannelId);
    window.setTimeout(() => {
      setReplyTarget(nextReply);
      inputRef.current?.focus();
    }, 0);
  }

  function forwardBodyForMessage(message: Pick<GroupMessage, 'body' | 'imageData' | 'imageName'>) {
    if (message.body.trim()) return message.body;
    if (isVideoCircleAttachment(message.imageData, message.imageName)) return language === 'ru' ? 'Видео кружок' : 'Video message';
    if (isVoiceAttachment(message.imageData, message.imageName)) return language === 'ru' ? 'Голосовое сообщение' : 'Voice message';
    if (message.imageData) return message.imageName || t(language, 'imageMessage');
    return '';
  }

  // Translate the message body into the user's chosen target language and keep
  // the result in ephemeral state. Right-clicking again toggles back to the
  // original by dropping the stored translation.
  async function translateMessage(message: GroupMessage) {
    setMessageMenu(null);
    if (messageTranslations[message.id]) {
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
    } catch {
      // No error toast system in the group view; leave the original on failure.
    } finally {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }

  // Open the composer context menu at the cursor. Always shown so the user can
  // Paste with an empty selection; when text is selected, Copy/Cut/Translate are
  // available too.
  function openComposerMenu(event: MouseEvent<HTMLElement>) {
    const selection = inputRef.current?.getSelection() ?? { start: draft.length, end: draft.length };
    const start = selection.start;
    const end = selection.end;
    const hasSelection = end > start && Boolean(draft.slice(start, end));
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
    try { await navigator.clipboard.writeText(draft.slice(menu.start, menu.end)); } catch { /* blocked */ }
  }

  // Cut the current composer selection: copy then remove from the draft.
  async function cutComposerSelection() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu || !menu.hasSelection) return;
    try { await navigator.clipboard.writeText(draft.slice(menu.start, menu.end)); } catch { /* blocked */ }
    const next = draft.slice(0, menu.start) + draft.slice(menu.end);
    updateGroupDraft(next);
    window.setTimeout(() => {
      inputRef.current?.setSelection(menu.start);
    }, 0);
  }

  // Paste clipboard media first; if there is no image, paste text into the composer.
  async function pasteIntoComposer() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu) return;
    if (!editingMessage && canAttachInActiveChannel && !activeNsfwBlocked) {
      const files = await readClipboardImageFiles(MAX_CHAT_MEDIA_BATCH - pendingImages.length);
      if (files.length > 0) {
        for (const file of files) await prepareImageFromFile(file);
        return;
      }
    }
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch { return; }
    if (!clip) return;
    const next = draft.slice(0, menu.start) + clip + draft.slice(menu.end);
    updateGroupDraft(next);
    window.setTimeout(() => {
      const caret = menu.start + clip.length;
      inputRef.current?.setSelection(caret);
    }, 0);
  }

  async function pasteIntoImageCaption() {
    setImageCaptionMenu(null);
    if (canAttachInActiveChannel && !activeNsfwBlocked) {
      const files = await readClipboardImageFiles(MAX_CHAT_MEDIA_BATCH - pendingImages.length);
      if (files.length > 0) {
        for (const file of files) await prepareImageFromFile(file);
        return;
      }
    }
    let clip = '';
    try { clip = await navigator.clipboard.readText(); } catch { return; }
    if (clip) imageCaptionInputRef.current?.replaceSelection(clip);
  }

  // Copy a chat message's text body to the system clipboard from its right-click
  // menu. Strips internal pack-link tokens so only readable text is copied.
  async function copyMessageText(message: GroupMessage) {
    setMessageMenu(null);
    const raw = message.body ?? '';
    const text = hasPackLink(raw) ? stripPackLinks(raw) : raw;
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); } catch { /* blocked */ }
  }

  // Translate the selected text in the composer into the user's chosen composer
  // target language and replace the selection in place.
  async function translateComposerSelection() {
    const menu = composerMenu;
    setComposerMenu(null);
    if (!menu) return;
    const source = draft.slice(menu.start, menu.end);
    if (!source.trim() || composerTranslating) return;
    setComposerTranslating(true);
    try {
      const target = getSavedComposerTranslateTargetName();
      const { text } = await api.translateText(token, source, target);
      const next = draft.slice(0, menu.start) + text + draft.slice(menu.end);
      updateGroupDraft(next);
      window.setTimeout(() => {
        const caret = menu.start + text.length;
        inputRef.current?.setSelection(caret);
      }, 0);
    } catch {
      // No error toast system in the group view; leave the original on failure.
    } finally {
      setComposerTranslating(false);
    }
  }

  // Forward: open the shared "Forward to" modal seeded with this message body.
  function forwardMessage(message: GroupMessage) {
    setMessageMenu(null);
    setReactionPicker(null);
    const text = forwardBodyForMessage(message);
    if (!text && !message.imageData) return;
    const senderName = message.senderGroup?.name ?? knownSenders.get(message.senderId)?.nickname ?? message.senderId.slice(0, 8);
    onForwardMessage?.({
      body: text,
      senderName,
      sourceId: message.feedSourceId ?? message.id,
      imageData: message.imageData,
      imageName: message.imageName,
      imageSpoiler: message.imageSpoiler
    });
  }

  async function togglePinMessage(message: GroupMessage) {
    if (!canPinInActiveChannel) return;
    try {
      const payload = await api.pinGroupMessage(token, message.id);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      setChannelPinnedMessages((current) => {
        if (!payload.message.pinnedAt) return current.filter((m) => m.id !== payload.message.id);
        const next = [payload.message, ...current.filter((m) => m.id !== payload.message.id)];
        return next.sort((a, b) => new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime());
      });
      setMessageMenu(null);
    } catch { }
  }

  function canEditMsg(message: GroupMessage) {
    if (message.senderId !== currentUser.id || message.deletedAt) return false;
    return Date.now() - new Date(message.createdAt).getTime() < 10 * 60 * 1000;
  }

  async function handleSaveSettings() {
    const updates: { name?: string; avatarData?: string; nameplate?: NamePlate; description?: string } = {};
    if (newName.trim() && newName.trim() !== savedOverview.name) updates.name = newName.trim();
    if (newAvatar !== null) updates.avatarData = newAvatar;
    if (newDescription.trim() !== savedOverview.description.trim()) updates.description = newDescription.trim();
    if (JSON.stringify(nameplateDraft) !== savedOverview.nameplate) updates.nameplate = nameplateDraft;
    try {
      if (Object.keys(updates).length > 0) await api.updateGroup(token, group.id, updates);
      // Adopt the just-saved values as the new baseline so the save bar clears
      // even though the parent `group` prop may not refresh immediately.
      setSavedOverview((prev) => ({
        name: updates.name ?? prev.name,
        description: updates.description ?? prev.description,
        avatarData: newAvatar ?? prev.avatarData,
        nameplate: JSON.stringify(nameplateDraft)
      }));
      setNewAvatar(null);
      setSettingsError('');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : t(language, 'unknownError'));
    }
  }

  async function handleNameplateUpload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5_000_000) {
      setSettingsError(t(language, 'avatarTooLarge'));
      return;
    }
    try {
      // Open the rectangular cropper so the user picks the region shown in the
      // nameplate (same flow as the quick popup).
      setPlateCropSource(await readImageAsDataUrl(file));
      setSettingsError('');
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  // Read an image for the quick popup, then open the rectangular cropper so the
  // user can pick the region shown in the nameplate.
  async function handlePlateCropUpload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5_000_000) {
      setSettingsError(t(language, 'avatarTooLarge'));
      return;
    }
    try {
      setPlateCropSource(await readImageAsDataUrl(file));
      setSettingsError('');
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  // Persist a nameplate change made from the quick popup immediately.
  async function saveNameplate(plate: NonNullable<NamePlate>) {
    setNameplateDraft(plate);
    try {
      await api.updateGroup(token, group.id, { nameplate: plate });
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : t(language, 'unknownError'));
    }
  }

  async function handleAvatarUpload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5_000_000) {
      setSettingsError(t(language, 'avatarTooLarge'));
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setSettingsError('');
      // Open the avatar cropper (same flow as the profile avatar) so the user can pick a region.
      setCropSource(dataUrl);
    } catch {
      setSettingsError(t(language, 'imageReadFailed'));
    }
  }

  async function handleRegenerateInvite() {
    setSettingsError('');
    try {
      const payload = await api.regenerateInvite(token, group.id);
      setInviteCode(payload.inviteCode);
      if (payload.invite) {
        setGroupInvites((current) => [payload.invite!, ...current.filter((invite) => invite.id !== payload.invite!.id)]);
      } else {
        try {
          const fresh = await api.getGroupInvites(token, group.id);
          setGroupInvites(fresh.invites);
        } catch {
          setGroupInvites((current) => current.filter(Boolean));
        }
      }
    } catch {
      setSettingsError(language === 'ru' ? 'Не удалось создать invite link' : 'Could not create invite link');
    }
  }

  async function handleCreateChannelInvite(channelId: string) {
    setSettingsError('');
    try {
      const payload = await api.regenerateInvite(token, group.id, channelId);
      if (payload.invite) {
        setGroupInvites((current) => [payload.invite!, ...current.filter((invite) => invite.id !== payload.invite!.id)]);
      }
    } catch {
      setSettingsError(language === 'ru' ? 'Не удалось создать invite link' : 'Could not create invite link');
    }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(buildGroupInviteLink(inviteCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleCopyInviteCode(code: string, channelId?: string | null) {
    try {
      await navigator.clipboard.writeText(buildGroupInviteLink(code, channelId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleDeleteInvite(inviteId: string) {
    setSettingsError('');
    try {
      await api.deleteGroupInvite(token, group.id, inviteId);
      setGroupInvites((current) => current.filter((invite) => invite.id !== inviteId));
    } catch {
      setSettingsError(language === 'ru' ? 'Не удалось удалить invite link' : 'Could not delete invite link');
    }
  }

  async function handleCreateChannel() {
    if (!newChannelName.trim() || !canManageChannels) return;
    try {
      const payload = await api.createGroupChannel(token, group.id, newChannelName.trim(), createChannelType);
      // The socket event may have already added this channel; avoid creating a duplicate.
      setChannels((current) => {
        const incoming = payload.channels ?? [payload.channel];
        const next = [...current];
        for (const channel of incoming) {
          if (!next.some((item) => item.id === channel.id)) next.push(channel);
        }
        return next.sort((a, b) => a.position - b.position);
      });
      if (payload.folder) {
        setFolders((current) => current.some((folder) => folder.id === payload.folder!.id) ? current : [...current, payload.folder!].sort((a, b) => a.position - b.position));
      }
      // Text/feed channels open immediately; voice channels are joined explicitly.
      if (payload.channel.type === 'text' || payload.channel.type === 'feed') setActiveChannel(payload.channel.id);
      setNewChannelName('');
      setShowCreateChannel(false);
      setCreateChannelType('text');
    } catch { }
  }

  // Opens the channel/folder settings dialog (rename, and member limit for voice).
  function openChannelSettings(channelId: string) {
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return;
    setEditTarget({ kind: 'channel', id: channelId });
    setChannelSettingsTab('overview');
    setEditNameDraft(channel.name);
    setEditLimitDraft(channel.userLimit != null ? String(channel.userLimit) : '');
    setEditTopicDraft(channel.topic ?? '');
    setEditSlowmodeDraft(String(channel.slowmodeSeconds ?? 0));
    setEditNsfwDraft(Boolean(channel.nsfw));
    setEditBitrateDraft(String(channel.bitrate ?? 64000));
    setChannelRoleDraft(channel.requiredRoleIds ?? []);
    setSelectedChannelPermissionRoleId(null);
    setChannelPermissionDraft({});
    setSavedChannelPermissionDraft({});
    setSettingsError('');
  }

  function openFolderSettings(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setEditTarget({ kind: 'folder', id: folderId });
    setEditNameDraft(folder.name);
    setEditLimitDraft('');
    setEditTopicDraft('');
    setEditSlowmodeDraft('0');
    setEditNsfwDraft(false);
    setEditBitrateDraft('64000');
    setChannelRoleDraft([]);
  }

  async function saveEditTarget() {
    if (!editTarget) return;
    if (editTarget.kind === 'folder' && !canManageChannels) return;
    const name = editNameDraft.trim();
    try {
      if (editTarget.kind === 'channel') {
        const channel = channels.find((c) => c.id === editTarget.id);
        if (!channel) return;
        if (!name) {
          setSettingsError(language === 'ru' ? 'Название канала не может быть пустым' : 'Channel name cannot be empty');
          setEditBarShake((n) => n + 1);
          return;
        }
        const limit = editLimitDraft.trim() === '' ? null : Math.max(1, Math.min(99, Number(editLimitDraft) || 1));
        const slowmode = Math.max(0, Math.min(21600, Number(editSlowmodeDraft) || 0));
        const bitrate = Math.max(8000, Math.min(384000, Number(editBitrateDraft) || 64000));
        const updates: { name?: string; userLimit?: number | null; topic?: string; slowmodeSeconds?: number; nsfw?: boolean; bitrate?: number } = {};
        updates.name = name;
        updates.topic = editTopicDraft.trim();
        updates.slowmodeSeconds = slowmode;
        updates.nsfw = editNsfwDraft;
        if (channel?.type === 'voice') updates.userLimit = limit;
        if (channel?.type === 'voice') updates.bitrate = bitrate;
        const payload = await api.updateGroupChannel(token, group.id, editTarget.id, updates);
        setChannels((current) => current.map((c) => c.id === payload.channel.id ? payload.channel : c));
        setEditNameDraft(payload.channel.name);
        setEditLimitDraft(payload.channel.userLimit != null ? String(payload.channel.userLimit) : '');
        setEditTopicDraft(payload.channel.topic ?? '');
        setEditSlowmodeDraft(String(payload.channel.slowmodeSeconds ?? 0));
        setEditNsfwDraft(Boolean(payload.channel.nsfw));
        setEditBitrateDraft(String(payload.channel.bitrate ?? 64000));
        setChannelRoleDraft(payload.channel.requiredRoleIds ?? channelRoleDraft);
        setSettingsError('');
      } else {
        if (name) {
          const payload = await api.updateGroupFolder(token, group.id, editTarget.id, { name });
          setFolders((current) => current.map((f) => f.id === payload.folder.id ? payload.folder : f));
        }
        setEditTarget(null);
      }
    } catch {
      setSettingsError(t(language, 'unknownError'));
    }
  }

  async function saveChannelPermissions() {
    if (!editTarget || editTarget.kind !== 'channel' || !canManageRoles) return;
    try {
      const overrides = permissionDraftToOverrides(channelPermissionDraft);
      const payload = await api.setChannelPermissions(token, group.id, editTarget.id, overrides);
      const savedDraft = permissionOverridesToDraft(payload.overrides);
      const roleIds = Array.from(new Set(overrides.filter((override) => override.permission === 'ViewChannel' && override.value === 'allow').map((override) => override.roleId)));
      setChannels((current) => current.map((channel) => (
        channel.id === editTarget.id ? { ...channel, requiredRoleIds: roleIds } : channel
      )));
      setChannelRoleDraft(roleIds);
      setChannelPermissionDraft(savedDraft);
      setSavedChannelPermissionDraft(savedDraft);
      setSettingsError('');
    } catch {
      setSettingsError(t(language, 'unknownError'));
    }
  }

  // True when the channel/folder edit dialog has unsaved name/limit changes.
  function isEditTargetDirty() {
    if (!editTarget) return false;
    if (editTarget.kind === 'channel') {
      const channel = channels.find((c) => c.id === editTarget.id);
      if (!channel) return false;
      const nameChanged = editNameDraft.trim() !== channel.name;
      const currentLimit = channel.userLimit != null ? String(channel.userLimit) : '';
      const limitChanged = channel.type === 'voice' && editLimitDraft.trim() !== currentLimit;
      const topicChanged = editTopicDraft.trim() !== (channel.topic ?? '');
      const slowmodeChanged = String(Number(editSlowmodeDraft) || 0) !== String(channel.slowmodeSeconds ?? 0);
      const nsfwChanged = editNsfwDraft !== Boolean(channel.nsfw);
      const bitrateChanged = channel.type === 'voice' && String(Number(editBitrateDraft) || 64000) !== String(channel.bitrate ?? 64000);
      return nameChanged || limitChanged || topicChanged || slowmodeChanged || nsfwChanged || bitrateChanged;
    }
    const folder = folders.find((f) => f.id === editTarget.id);
    return !!folder && editNameDraft.trim() !== folder.name;
  }

  function isChannelPermissionsDirty() {
    if (!editTarget || editTarget.kind !== 'channel') return false;
    return JSON.stringify(channelPermissionDraft) !== JSON.stringify(savedChannelPermissionDraft);
  }

  function hasChannelSettingsDirtyState() {
    return isEditTargetDirty() || isChannelPermissionsDirty();
  }

  // Restore the edit dialog drafts to the persisted channel/folder values.
  function resetEditTarget() {
    if (!editTarget) return;
    if (editTarget.kind === 'channel') {
      const channel = channels.find((c) => c.id === editTarget.id);
      if (!channel) return;
      setEditNameDraft(channel.name);
      setEditLimitDraft(channel.userLimit != null ? String(channel.userLimit) : '');
      setEditTopicDraft(channel.topic ?? '');
      setEditSlowmodeDraft(String(channel.slowmodeSeconds ?? 0));
      setEditNsfwDraft(Boolean(channel.nsfw));
      setEditBitrateDraft(String(channel.bitrate ?? 64000));
      setChannelRoleDraft(channel.requiredRoleIds ?? []);
      setChannelPermissionDraft(savedChannelPermissionDraft);
    } else {
      const folder = folders.find((f) => f.id === editTarget.id);
      if (folder) setEditNameDraft(folder.name);
    }
    setSettingsError('');
  }

  // Close the edit dialog, but shake the save bar if there are unsaved changes.
  function requestCloseEditTarget() {
    if (hasChannelSettingsDirtyState()) {
      setEditBarShake((n) => n + 1);
      return;
    }
    setEditTarget(null);
  }

  function switchChannelSettingsTab(tab: ChannelSettingsTab) {
    if (tab === channelSettingsTab) return;
    const currentTabDirty =
      (channelSettingsTab === 'overview' && isEditTargetDirty()) ||
      (channelSettingsTab === 'permissions' && isChannelPermissionsDirty());
    if (currentTabDirty) {
      setEditBarShake((n) => n + 1);
      return;
    }
    setSettingsError('');
    setChannelSettingsTab(tab);
  }

  // Click a voice channel: join it (or re-open the voice view if already here).
  function handleVoiceChannelClick(channelId: string) {
    if (!voiceRoom) return;
    emitGroupTyping(false);
    if (voiceRoom.activeChannelId === channelId) {
      setVoiceStageOpen(true);
    } else {
      void voiceRoom.join(channelId);
    }
  }

  // Open a text channel: shows the normal chat. The voice connection stays
  // alive, but its full-screen voice view is hidden so the text chat is shown.
  function openTextChannel(channelId: string) {
    emitGroupTyping(false);
    setActiveChannel(channelId);
    setVoiceStageOpen(false);
  }

  async function handleDeleteChannel(channelId: string) {
    const channel = channels.find((item) => item.id === channelId);
    if (isFeedManagedChannel(channel)) return;
    try {
      await api.deleteGroupChannel(token, group.id, channelId);
      setChannels((current) => current.filter((c) => c.id !== channelId));
      if (activeChannel === channelId) {
        const remaining = channels.filter((c) => c.id !== channelId);
        setActiveChannel(remaining[0]?.id ?? null);
      }
    } catch { }
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || !canManageChannels) return;
    try {
      const payload = await api.createGroupFolder(token, group.id, name);
      setFolders((current) => current.some((f) => f.id === payload.folder.id) ? current : [...current, payload.folder]);
      setNewFolderName('');
      setShowCreateFolder(false);
    } catch { }
  }

  async function handleDeleteFolder(folderId: string) {
    if (!canManageChannels) return;
    try {
      await api.deleteGroupFolder(token, group.id, folderId);
      setFolders((current) => current.filter((f) => f.id !== folderId));
      void api.getGroupChannels(token, group.id).then((payload) => setChannels(payload.channels)).catch(() => undefined);
    } catch { }
  }

  // Load a role into the editor drafts and open the editor sub-view.
  function openRoleEditor(role: GroupRole) {
    setRoleEditorId(role.id);
    setRoleEditorTab('display');
    setRolePermissionSearch('');
    setRoleMemberSearch('');
    setDraftPermissions([...role.permissions]);
    setDraftHoist(role.hoist);
    setEditingRoleMeta({ id: role.id, name: role.name, color: role.color });
    setRoleMenuOpen(null);
  }

  function openEveryoneRoleEditor() {
    setRoleEditorId(EVERYONE_ROLE_ID);
    setRoleEditorTab('permissions');
    setRolePermissionSearch('');
    setRoleMemberSearch('');
    setDraftPermissions([...everyonePermissions]);
    setDraftHoist(false);
    setEditingRoleMeta({ id: EVERYONE_ROLE_ID, name: '@everyone', color: '#8a8a8a' });
    setRoleMenuOpen(null);
  }

  // Leave the editor sub-view and return to the role list.
  function closeRoleEditor() {
    setRoleEditorId(null);
    setDraftPermissions([]);
    setDraftHoist(false);
    setEditingRoleMeta(null);
    setRoleEditorTab('display');
    setRolePermissionSearch('');
    setRoleMemberSearch('');
  }

  // Discard unsaved role-editor edits, restoring the drafts to the persisted role.
  function resetRoleDrafts() {
    if (roleEditorId === EVERYONE_ROLE_ID) {
      setDraftPermissions([...everyonePermissions]);
      setDraftHoist(false);
      setEditingRoleMeta({ id: EVERYONE_ROLE_ID, name: '@everyone', color: '#8a8a8a' });
      return;
    }
    const role = roles.find((r) => r.id === roleEditorId);
    if (!role) return;
    setDraftPermissions([...role.permissions]);
    setDraftHoist(role.hoist);
    setEditingRoleMeta({ id: role.id, name: role.name, color: role.color });
  }

  // Restore the Overview drafts to the last-saved baseline values.
  function resetOverviewDrafts() {
    setNewName(savedOverview.name);
    setNewDescription(savedOverview.description);
    setNewAvatar(null);
    try {
      setNameplateDraft(JSON.parse(savedOverview.nameplate));
    } catch {
      setNameplateDraft(group.nameplate ?? DEFAULT_NAMEPLATE);
    }
  }

  // Whole-modal dirty flag across whichever surface is currently editable.
  const settingsDirty = roleEditorDirty || overviewDirty;

  // Close the whole settings modal. If anything has unsaved changes, block the
  // close and shake the save bar instead.
  function requestCloseSettings() {
    if (settingsDirty) {
      setSaveBarShake((n) => n + 1);
      return;
    }
    setShowSettings(false);
  }

  // Create a fresh role and immediately open it in the editor for tweaking.
  async function handleCreateRole() {
    if (!canManageRoles) return;
    try {
      const { role } = await api.createGroupRole(token, group.id, t(language, 'newRoleName'), '#8a8a8a');
      const rolePayload = await api.getGroupRoles(token, group.id);
      setRoles(rolePayload.roles);
      const created = rolePayload.roles.find((r) => r.id === role.id) ?? role;
      openRoleEditor(created);
    } catch { }
  }

  async function handleDeleteRole(roleId: string) {
    setSettingsError('');
    try {
      await api.deleteGroupRole(token, group.id, roleId);
      const rolePayload = await api.getGroupRoles(token, group.id);
      setRoles(rolePayload.roles);
      const memPayload = await api.getGroupMembers(token, group.id);
      setMembers(memPayload.members);
      setRoleMenuOpen(null);
      if (roleEditorId === roleId) closeRoleEditor();
    } catch {
      setSettingsError(language === 'ru' ? 'Не удалось удалить роль' : 'Could not delete role');
    }
  }

  async function handleCopyRoleId(roleId: string) {
    try {
      await navigator.clipboard.writeText(roleId);
      setRoleIdCopied(roleId);
      setRoleMenuOpen(null);
      window.setTimeout(() => setRoleIdCopied((cur) => (cur === roleId ? null : cur)), 1500);
    } catch { }
  }

  async function handleSaveRolePermissions(roleId: string) {
    try {
      if (roleId === EVERYONE_ROLE_ID) {
        const payload = await api.updateGroupEveryonePermissions(token, group.id, draftPermissions);
        setEveryonePermissions(payload.group.everyonePermissions ?? []);
        setDraftPermissions([...(payload.group.everyonePermissions ?? [])]);
        setEditingRoleMeta({ id: EVERYONE_ROLE_ID, name: '@everyone', color: '#8a8a8a' });
        return;
      }
      const meta = editingRoleMeta && editingRoleMeta.id === roleId ? editingRoleMeta : null;
      const payload = await api.updateGroupRole(token, group.id, roleId, { permissions: draftPermissions, hoist: draftHoist, name: meta && meta.name.trim() ? meta.name.trim() : undefined, color: meta ? meta.color : undefined });
      setRoles((current) => current.map((role) => role.id === payload.role.id ? payload.role : role));
      setDraftPermissions([...payload.role.permissions]);
      setDraftHoist(payload.role.hoist);
      setEditingRoleMeta({ id: payload.role.id, name: payload.role.name, color: payload.role.color });
    } catch { }
  }

  // Set (or clear) the role automatically granted to members on joining.
  async function handleSetDefaultRole(roleId: string | null) {
    setDefaultRoleMenuOpen(false);
    const previous = defaultRoleId;
    setDefaultRoleId(roleId); // optimistic
    try {
      await api.setGroupDefaultRole(token, group.id, roleId);
    } catch {
      setDefaultRoleId(previous);
    }
  }

  // Member self-service: toggle a customization option. Applies an optimistic
  // update so the checkmark flips instantly, then reconciles with the server
  // (which also runs the radio logic for 'single' categories).
  async function handleToggleOption(optionId: string) {
    const category = customCategories.find((c) => c.options.some((o) => o.id === optionId));
    const seq = ++toggleSeqRef.current;

    // Optimistic update via a functional setState so it always builds on the
    // latest state, never a stale closure captured at click time.
    setSelectedOptionIds((current) => {
      if (current.includes(optionId)) return current.filter((id) => id !== optionId);
      if (category?.selectionType === 'single') {
        // Radio: drop the other options in this category, add the new one.
        const siblingIds = new Set(category.options.map((o) => o.id));
        return [...current.filter((id) => !siblingIds.has(id)), optionId];
      }
      return [...current, optionId];
    });

    try {
      const result = await api.toggleCustomOption(token, group.id, optionId);
      // Only the most recent toggle may reconcile UI state. Older, out-of-order
      // responses are ignored so the checkmark stops flickering.
      if (seq !== toggleSeqRef.current) return;
      setSelectedOptionIds(result.selectedOptionIds);
      setChannels(result.channels);
      setFolders(result.folders);
    } catch {
      // Re-sync from the server only if this was the latest request.
      if (seq !== toggleSeqRef.current) return;
      try {
        const fresh = await api.getGroupCustomization(token, group.id);
        if (seq === toggleSeqRef.current) setSelectedOptionIds(fresh.selectedOptionIds);
      } catch { }
    }
  }

  // Finish the required onboarding flow and unlock the server.
  async function handleCompleteOnboarding() {
    try {
      await api.completeCustomization(token, group.id);
    } catch { }
    setOnboardingRequired(false);
    setCustomizeOpen(false);
  }

  async function handleRemoveMember(userId: string) {
    try {
      await api.removeGroupMember(token, group.id, userId);
      setMembers((current) => current.filter((m) => m.user.id !== userId));
    } catch { }
  }

  async function handleAddMemberRole(userId: string, roleId: string) {
    setSettingsError('');
    const previousMembers = members;
    const role = roles.find((item) => item.id === roleId);
    try {
      setMembers((current) => current.map((member) => {
        if (member.user.id !== userId) return member;
        const roleIds = member.roleIds.includes(roleId) ? member.roleIds : [...member.roleIds, roleId];
        return {
          ...member,
          roleIds,
          roleId: member.roleId ?? roleId,
          role: member.roleId ? member.role : (role?.name ?? member.role)
        };
      }));
      const payload = await api.updateGroupMemberRole(token, group.id, userId, { addRoleId: roleId });
      setMembers(payload.members);
    } catch {
      setMembers(previousMembers);
      setSettingsError(language === 'ru' ? 'Не удалось добавить роль участнику' : 'Could not add member role');
    }
  }

  async function handleRemoveMemberRole(userId: string, roleId: string) {
    setSettingsError('');
    const previousMembers = members;
    try {
      setMembers((current) => current.map((member) => {
        if (member.user.id !== userId) return member;
        const roleIds = member.roleIds.filter((id) => id !== roleId);
        const removesPrimary = member.roleId === roleId;
        return {
          ...member,
          roleIds,
          roleId: removesPrimary ? null : member.roleId,
          role: removesPrimary ? 'member' : member.role
        };
      }));
      const payload = await api.updateGroupMemberRole(token, group.id, userId, { removeRoleId: roleId });
      setMembers(payload.members);
    } catch {
      setMembers(previousMembers);
      setSettingsError(language === 'ru' ? 'Не удалось снять роль участника' : 'Could not remove member role');
    }
  }

  function toggleSelectedMember(userId: string) {
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleAllVisibleMembers() {
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      const allSelected = settingsMembers.length > 0 && settingsMembers.every((member) => next.has(member.user.id));
      for (const member of settingsMembers) {
        if (allSelected) next.delete(member.user.id);
        else next.add(member.user.id);
      }
      return next;
    });
  }

  async function handleBulkMemberRole(action: 'add' | 'remove', roleId: string) {
    const targetIds = [...selectedMemberIds];
    if (targetIds.length === 0) return;
    setSettingsError('');
    setBulkRoleMenu(null);
    const previousMembers = members;
    const role = roles.find((item) => item.id === roleId);
    const eligibleIds = targetIds.filter((userId) => {
      const member = members.find((m) => m.user.id === userId);
      if (!member) return false;
      const hasRole = memberHasRole(member, roleId);
      return action === 'add' ? !hasRole : hasRole;
    });
    if (eligibleIds.length === 0) {
      setSelectedMemberIds(new Set());
      return;
    }
    try {
      const eligibleSet = new Set(eligibleIds);
      setMembers((current) => current.map((member) => {
        if (!eligibleSet.has(member.user.id)) return member;
        if (action === 'add') {
          const roleIds = member.roleIds.includes(roleId) ? member.roleIds : [...member.roleIds, roleId];
          return {
            ...member,
            roleIds,
            roleId: member.roleId ?? roleId,
            role: member.roleId ? member.role : (role?.name ?? member.role)
          };
        }
        const roleIds = member.roleIds.filter((id) => id !== roleId);
        const removesPrimary = member.roleId === roleId;
        return {
          ...member,
          roleIds,
          roleId: removesPrimary ? (roleIds[0] ?? null) : member.roleId,
          role: removesPrimary ? 'member' : member.role
        };
      }));
      const payload = await api.updateGroupMembersRole(token, group.id, action === 'add'
        ? { userIds: eligibleIds, addRoleId: roleId }
        : { userIds: eligibleIds, removeRoleId: roleId });
      setMembers(payload.members);
      setSelectedMemberIds(new Set());
    } catch {
      setMembers(previousMembers);
      setSettingsError(language === 'ru' ? 'Не удалось применить массовое действие с ролью' : 'Could not apply bulk role action');
    }
  }

  async function handleLeaveGroup() {
    try {
      await api.removeGroupMember(token, group.id, currentUser.id);
      onGroupLeft?.(group.id);
      onClose();
    } catch { }
  }

  // Deletion is only allowed for the owner and only when no other members
  // remain. The owner themselves does not count.
  const otherMembersCount = members.filter((m) => m.user.id !== group.ownerId).length;

  function requestDeleteGroup() {
    setSettingsError('');
    if (otherMembersCount > 0) {
      setSettingsError(t(language, 'deleteGroupHasMembers'));
      return;
    }
    setConfirmDeleteGroup(true);
  }

  async function handleDeleteGroup() {
    if (otherMembersCount > 0) {
      setConfirmDeleteGroup(false);
      setSettingsError(t(language, 'deleteGroupHasMembers'));
      return;
    }
    try {
      await api.deleteGroup(token, group.id);
      setConfirmDeleteGroup(false);
      onGroupLeft?.(group.id);
      onClose();
    } catch {
      setConfirmDeleteGroup(false);
      setSettingsError(t(language, 'unknownError'));
    }
  }

  function insertEmoji(emoji: string) {
    if (!canUseExternalEmojisInActiveChannel && (emoji.includes('<ce:') || /^:[a-z0-9_+-]+:\s*$/i.test(emoji))) return;
    inputRef.current?.insertText(emoji);
  }

  // Send a Tenor GIF into the active channel as an image message.
  async function sendGif(gif: TenorGif) {
    if (!activeChannel) return;
    if (!canAttachInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0) return;
    setEmojiOpen(false);
    try {
      const payload = await api.sendGroupMessage(token, group.id, '', activeChannel, { dataUrl: gif.url, name: gif.description });
      setMessages((current) => (current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message]));
      if (activeSlowmodeSeconds > 0 && !canBypassActiveSlowmode) {
        setSlowmodeUntilByChannel((current) => ({ ...current, [activeChannel]: Date.now() + activeSlowmodeSeconds * 1000 }));
        setSlowmodeNow(Date.now());
      }
    } catch { }
  }

  function insertImageEmoji(emoji: string) {
    if (!canUseExternalEmojisInActiveChannel && (emoji.includes('<ce:') || /^:[a-z0-9_+-]+:\s*$/i.test(emoji))) return;
    imageCaptionInputRef.current?.insertText(emoji);
  }

  // Renders a single channel button (text or voice) for both the folder and
  // root channel lists.

  function openThreadView(message: GroupMessage) {
    const rootId = message.feedSourceId ?? message.id;
    threadViewRootRef.current = rootId;
    setThreadViewRootId(rootId);
    setThreadViewRoot(message);
    setThreadViewMessages([]);
    setThreadViewDraft('');
    setThreadViewLoading(true);
    api.getGroupThread(token, group.id, rootId)
      .then((payload) => {
        if (threadViewRootRef.current !== rootId) return;
        setThreadViewRoot(payload.root);
        setThreadViewMessages(payload.messages);
      })
      .catch(() => undefined)
      .finally(() => {
        if (threadViewRootRef.current === rootId) setThreadViewLoading(false);
      });
  }

  function closeThreadView() {
    threadViewRootRef.current = null;
    setThreadViewRootId(null);
    setThreadViewRoot(null);
    setThreadViewMessages([]);
    setThreadViewDraft('');
  }

  async function sendThreadViewMessage() {
    const rootId = threadViewRootRef.current;
    const body = applySlashCommand(expandCustomEmojiShortcodes(threadViewDraft.trim()));
    if (!rootId || !body || threadViewSending) return;
    setThreadViewSending(true);
    try {
      const payload = await api.sendGroupThreadMessage(token, group.id, rootId, body);
      setThreadViewDraft('');
      setThreadViewMessages((current) => current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message]);
      setMessages((current) => current.map((m) => (m.id === rootId ? { ...m, threadCount: Math.max((m.threadCount ?? 0), threadViewMessages.length + 1) } : m)));
    } catch {
      // Keep the draft so the user can retry.
    }
    setThreadViewSending(false);
  }

  // Close the thread panel when the user switches channel or group.
  useEffect(() => {
    closeThreadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, group.id]);

  const messengerSettingsTarget = typeof document !== 'undefined'
    ? document.querySelector<HTMLElement>('.messenger-window .messenger-shell') ?? document.body
    : null;
  const groupLayoutClassName = [
    'group-chat-layout',
    imageDragging ? 'image-dragging' : '',
    resizing || resizingChannels ? 'resizing-panels' : '',
    groupMembersHidden ? 'group-members-hidden' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={groupLayoutClassName} style={{ '--member-width': `${memberPanelWidth}px`, '--channel-width': `${channelPanelWidth}px` } as React.CSSProperties}
      onDragEnter={(e) => {
        if (editingMessage || !activeChannel || !canAttachInActiveChannel || activeNsfwBlocked || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        setImageDragging(true);
      }}
      onDragOver={(e) => {
        if (editingMessage || !activeChannel || !canAttachInActiveChannel || activeNsfwBlocked || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (editingMessage || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setImageDragging(false);
      }}
      onDrop={handleImageDrop}>
      <GroupChannelsPanel
        language={language}
        currentUser={currentUser}
        group={group}
        channels={channels}
        folders={folders}
        activeChannel={activeChannel}
        voiceRoom={voiceRoom}
        groupSearchOpen={groupSearchOpen}
        setGroupSearchOpen={setGroupSearchOpen}
        groupSearchQuery={groupSearchQuery}
        setGroupSearchQuery={setGroupSearchQuery}
        groupSearchActiveId={groupSearchActiveId}
        setGroupSearchActiveId={setGroupSearchActiveId}
        groupSearchMatches={groupSearchMatches}
        groupSearchInputRef={groupSearchInputRef}
        jumpToGroupSearchMatch={jumpToGroupSearchMatch}
        knownSenders={knownSenders}
        threadRef={threadRef}
        nameplateDraft={nameplateDraft}
        newAvatar={newAvatar}
        isOwner={isOwner}
        saveNameplate={saveNameplate}
        handlePlateCropUpload={handlePlateCropUpload}
        platePopupOpen={platePopupOpen}
        setPlatePopupOpen={setPlatePopupOpen}
        platePopupPos={platePopupPos}
        setPlatePopupPos={setPlatePopupPos}
        platePopupRef={platePopupRef}
        setGroupMenuOpen={setGroupMenuOpen}
        canManageChannels={canManageChannels}
        isGroupAdmin={isGroupAdmin}
        setCreateChannelType={setCreateChannelType}
        setShowCreateChannel={setShowCreateChannel}
        setShowCreateFolder={setShowCreateFolder}
        setShowSettings={setShowSettings}
        setCustomizeOpen={setCustomizeOpen}
        handleCopyInvite={handleCopyInvite}
        collapsedFolders={collapsedFolders}
        toggleFolderCollapsed={toggleFolderCollapsed}
        draggedItem={draggedItem}
        handleChannelDragStart={handleChannelDragStart}
        handleFolderDragStart={handleFolderDragStart}
        handleDragOver={handleDragOver}
        handleDropOnChannel={handleDropOnChannel}
        handleDropOnFolder={handleDropOnFolder}
        handleDropOnRoot={handleDropOnRoot}
        handleDragEnd={handleDragEnd}
        setChannelMenu={setChannelMenu}
        setDeleteTarget={setDeleteTarget}
        handleVoiceChannelClick={handleVoiceChannelClick}
        openTextChannel={openTextChannel}
        openChannelSettings={openChannelSettings}
        isFeedInternalChannel={isFeedInternalChannel}
        isFeedManagedChannel={isFeedManagedChannel}
        setVoiceStageOpen={setVoiceStageOpen}
      />

      <div className={resizingChannels ? 'group-channel-splitter resizing' : 'group-channel-splitter'} onMouseDown={(e) => { e.preventDefault(); setResizingChannels(true); }} />

      <div className={`group-chat-main${showVoiceView ? ' has-voice-stage' : ''}`}>
        <header className="group-chat-header">
          {showVoiceView ? (
            <h3 className="group-chat-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M3 10v4h4l5 5V5L7 10H3z"/></svg>
              {voiceConnectedChannel!.name}
            </h3>
          ) : (
            <h3 className="group-chat-title">
              {activeChannelObj?.type === 'feed'
                ? <span className="group-channel-feed-icon group-chat-title-feed" aria-hidden="true" />
                : <span className="group-chat-title-hashtag" aria-hidden="true" />}
              <span className="group-chat-name">{activeChannelName}</span>
              {activeChannelTopic ? <span className="group-chat-topic">{activeChannelTopic}</span> : null}
            </h3>
          )}
          <div className="messenger-chat-header-actions">
            {!showVoiceView && activeChannel ? (
              <button
                className={channelSummary.open ? 'messenger-call-button active' : 'messenger-call-button'}
                type="button"
                title={t(language, 'whatDidIMiss')}
                aria-label={t(language, 'whatDidIMiss')}
                onClick={() => {
                  if (channelSummary.open) {
                    setChannelSummary({ open: false, loading: false, text: '', error: '' });
                    return;
                  }
                  setChannelSummary({ open: true, loading: true, text: '', error: '' });
                  api.summarizeGroupChannel(token, group.id, activeChannel, 100)
                    .then((result) => setChannelSummary({
                      open: true,
                      loading: false,
                      text: result.summary || t(language, 'recapEmpty'),
                      error: ''
                    }))
                    .catch(() => setChannelSummary({
                      open: true,
                      loading: false,
                      text: '',
                      error: t(language, 'recapFailed')
                    }));
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg>
              </button>
            ) : null}
            <button
              className={groupSearchOpen ? 'messenger-call-button active' : 'messenger-call-button'}
              type="button"
              title={groupSearchLabel}
              aria-label={groupSearchLabel}
              onClick={() => {
                setGroupSearchOpen((open) => {
                  const next = !open;
                  if (!next) {
                    setGroupSearchQuery('');
                    setGroupSearchActiveId(null);
                  }
                  return next;
                });
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            </button>
            <button
              className={!groupMembersHidden ? 'messenger-call-button active' : 'messenger-call-button'}
              type="button"
              title={groupMembersLabel}
              aria-label={groupMembersLabel}
              onClick={() => setGroupMembersHidden((hidden) => !hidden)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
            </button>
          </div>
        </header>
        {threadViewRootId ? (
          <div className="thread-panel">
            <div className="thread-panel-head">
              <strong>{t(language, 'thread')}</strong>
              <button type="button" onClick={closeThreadView} aria-label="close">✕</button>
            </div>
            {threadViewRoot ? (
              <div className="thread-panel-root">
                <img src={knownSenders.get(threadViewRoot.senderId)?.avatarData ?? ''} alt="" />
                <div className="thread-panel-root-text">
                  <span className="thread-panel-author">{senderName(threadViewRoot.senderId)}</span>
                  <span className="thread-panel-body">{threadViewRoot.body ? <MessageText text={threadViewRoot.body} /> : (threadViewRoot.imageData ? '📷' : '')}</span>
                </div>
              </div>
            ) : null}
            <div className="thread-panel-messages">
              {threadViewLoading ? (
                <p className="thread-panel-hint">{t(language, 'threadLoading')}</p>
              ) : threadViewMessages.length === 0 ? (
                <p className="thread-panel-hint">{t(language, 'threadEmpty')}</p>
              ) : threadViewMessages.map((reply) => (
                <div key={reply.id} className="thread-panel-message">
                  <img src={knownSenders.get(reply.senderId)?.avatarData ?? ''} alt="" />
                  <div className="thread-panel-message-text">
                    <span className="thread-panel-message-head">
                      <span className="thread-panel-author">{senderName(reply.senderId)}</span>
                      <time>{formatTime(reply.createdAt)}</time>
                    </span>
                    <span className="thread-panel-body"><MessageText text={reply.body} /></span>
                  </div>
                </div>
              ))}
            </div>
            <div className="thread-panel-compose">
              <input
                type="text"
                className="messenger-input"
                value={threadViewDraft}
                placeholder={t(language, 'threadReplyPlaceholder')}
                onChange={(event) => setThreadViewDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void sendThreadViewMessage(); }}
              />
              <button type="button" className="primary-action" disabled={!threadViewDraft.trim() || threadViewSending} onClick={() => void sendThreadViewMessage()}>
                {t(language, 'sendShort')}
              </button>
            </div>
          </div>
        ) : null}
        {channelSummary.open ? (
          <div className="channel-summary-panel">
            <div className="channel-summary-head">
              <strong>{t(language, 'channelRecap')}</strong>
              <button type="button" onClick={() => setChannelSummary({ open: false, loading: false, text: '', error: '' })} aria-label="close">✕</button>
            </div>
            {channelSummary.loading ? (
              <p className="channel-summary-loading">{t(language, 'recapLoading')}</p>
            ) : channelSummary.error ? (
              <p className="channel-summary-error">{channelSummary.error}</p>
            ) : (
              <div className="channel-summary-text">{channelSummary.text}</div>
            )}
          </div>
        ) : null}
        {showVoiceView ? null : (
          <>
            <VoicePlaybackBar language={language} />
            <VideoCirclePlaybackBar language={language} />
          </>
        )}

        {/* Dedicated voice view: top stage + bottom ephemeral chat. The text
            channel thread is hidden while connected and viewing the voice
            channel. Opening another text channel hides this and shows the chat. */}
        {showVoiceView ? (
          <VoiceStage
            language={language}
            currentUser={currentUser}
            channelName={voiceConnectedChannel!.name}
            voiceRoom={voiceRoom!}
            token={token}
          />
        ) : (
        <>
        <div className="messenger-thread-wrap chat-enlarged">
        {(() => {
          const pinnedSource = channelPinnedMessages.length > 0 ? channelPinnedMessages : messages;
          const pinned = pinnedSource
            .filter((m) => m.pinnedAt && !m.deletedAt)
            .sort((a, b) => new Date(b.pinnedAt!).getTime() - new Date(a.pinnedAt!).getTime());
          if (pinned.length === 0) return null;
          const current = pinned[Math.min(pinCursor, pinned.length - 1)] ?? pinned[0];
          const sender = knownSenders.get(current.senderId);
          return (
            <div className="messenger-pinned" onClick={(e) => {
              e.stopPropagation();
              const el = document.getElementById('gmsg-' + current.id);
              if (el && threadRef.current) {
                const tNode = threadRef.current;
                const tRect = tNode.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                tNode.scrollBy({ top: elRect.top - tRect.top - 80, behavior: 'smooth' });
              }
              setPinCursor((prev) => (prev + 1) % pinned.length);
            }}>
              <div className="messenger-pinned-header">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                <span>{pinned.length} {t(language, 'pinnedMessages')}</span>
              </div>
              <div className="messenger-pinned-message">
                {current.senderGroup ? <strong>{current.senderGroup.name}</strong> : sender ? <UserName user={sender} as="strong" /> : <strong>{senderName(current.senderId)}</strong>}
                <span>{current.body || (isVoiceAttachment(current.imageData, current.imageName) ? '🎤' : isVideoCircleAttachment(current.imageData, current.imageName) ? '📹' : current.imageData ? '📷' : '')}</span>
              </div>
            </div>
          );
        })()}

        <div
          ref={threadRef}
          className={activeNsfwBlocked ? 'messenger-thread nsfw-blurred' : 'messenger-thread'}
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
            const isMine = message.senderId === currentUser.id;
            const isFeedPost = activeChannelObj?.type === 'feed' || message.feedMirror;
            if (message.deletedAt) return null;
            const isVoiceMessage = isVoiceAttachment(message.imageData, message.imageName);
            const isVideoCircleMessage = isVideoCircleAttachment(message.imageData, message.imageName);
            const forwarded = parseForward(message.body);
            const mentionsCurrentUser = mentionedMessageIds.has(message.id);
            const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
            const previousMessage = index === 0 ? null : messages[index - 1];
            if (previousMessage && canAppendToImageAlbum(previousMessage, message)) return null;
            const isStartOfGroup = showDateDivider || !previousMessage || groupMessageRunIdentity(previousMessage) !== groupMessageRunIdentity(message) || (new Date(message.createdAt).getTime() - new Date(previousMessage.createdAt).getTime() > 120000);
            const albumItems: GroupMessage[] = [];
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
            const isEndOfGroup = !nextMessage || shouldShowDateDivider(nextMessage.createdAt, groupEndMessage.createdAt) || groupMessageRunIdentity(nextMessage) !== groupMessageRunIdentity(groupEndMessage) || (new Date(nextMessage.createdAt).getTime() - new Date(groupEndMessage.createdAt).getTime() > 120000);
            const showGroupAvatar = isEndOfGroup;
            const messageRunKey = messageRunKeys.get(message.id) ?? message.id;
            const hasRichContent = !message.deletedAt && Boolean(
              message.imageData ||
              message.replyTo ||
              (message.body && (
                forwarded ||
                extractSharedPack(message.body) ||
                extractGroupInviteCode(message.body) ||
                extractWatchInvite(message.body)
              ))
            );
            const bubbleClasses = [
              'message-bubble',
              isStartOfGroup ? 'message-group-start' : '',
              isEndOfGroup ? 'message-group-end' : '',
              showGroupAvatar ? 'message-avatar-active' : '',
              isMine ? 'mine' : '',
              message.imageData && !isVoiceMessage && !isVideoCircleMessage ? 'has-image' : '',
              message.imageData && !message.body && !isVoiceMessage && !isVideoCircleMessage ? 'image-only' : '',
              hasRichContent ? 'message-rich-content' : '',
              message.pinnedAt ? 'pinned' : '',
              groupSearchMatchIds.has(message.id) ? 'group-search-match' : '',
              groupSearchActiveId === message.id ? 'group-search-active' : '',
              mentionsCurrentUser ? 'message-mention-highlight' : '',
              isFeedPost ? 'feed-post' : '',
              message.feedMirror ? 'feed-mirror' : '',
              message.pending ? 'pending' : ''
            ].filter(Boolean).join(' ');
            const senderUser = message.senderGroup ? null : knownSenders.get(message.senderId);
            const senderAvatar = message.senderGroup?.avatarData || senderUser?.avatarData || currentUser.avatarData;
            const senderName = message.senderGroup?.name || senderUser?.nickname || currentUser.nickname;
            return (
              <Fragment key={message.clientKey ?? message.id}>
              {showDateDivider ? (
                <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
              ) : null}
              <article className={bubbleClasses}
                id={'gmsg-' + message.id}
                data-time={formatTime(message.createdAt)}
                data-message-id={message.id}
                data-message-run={messageRunKey}
                onContextMenu={(event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (message.deletedAt) return;
                  setMessageMenu({ x: event.clientX, y: event.clientY, message });
                }}
              >
                <img className="message-avatar" src={senderAvatar} alt="" draggable={false} style={{ cursor: message.senderGroup ? 'default' : 'pointer' }} onClick={(event) => { if (message.senderGroup) return; const r = event.currentTarget.getBoundingClientRect(); onViewProfile?.(knownSenders.get(message.senderId) as PublicUser, group, buildProfilePreload(message.senderId), { left: r.left, top: r.top, right: r.right, bottom: r.bottom }); }} />
                <div className="message-body">
                  {isFeedPost ? (
                    <div className="feed-post-head">
                      <img src={group.avatarData} alt="" />
                      <strong>{group.name}</strong>
                    </div>
                  ) : null}
                  {!message.deletedAt && message.replyTo ? (
                    <ReplyQuote
                      reply={message.replyTo}
                      resolveName={(userId) => knownSenders.get(userId)?.nickname ?? userId.slice(0, 8)}
                      onJump={(messageId) => {
                        const localTarget = messages.find((item) => item.id === messageId || item.feedSourceId === messageId);
                        const el = document.getElementById('gmsg-' + (localTarget?.id ?? messageId));
                        if (el && threadRef.current) {
                          const tNode = threadRef.current;
                          const tRect = tNode.getBoundingClientRect();
                          const elRect = el.getBoundingClientRect();
                          tNode.scrollBy({ top: elRect.top - tRect.top - 80, behavior: 'smooth' });
                          el.classList.add('message-jump-highlight');
                          window.setTimeout(() => el.classList.remove('message-jump-highlight'), 1200);
                        }
                      }}
                    />
                  ) : null}
                  {isStartOfGroup ? (
                    <div className="message-meta">
                      {senderUser
                        ? <UserName user={senderUser} as="strong" className="message-author" />
                        : <strong className="message-author">{senderName}</strong>}
                      <time className="message-time">
                        {formatTime(message.createdAt)}
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
                                <img src={item.dataUrl} alt={item.name ?? ''} onLoad={handleThreadMediaLoad} />
                                {itemSpoilerHidden ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : message.imageData && !forwarded ? (() => {
                        const spoilerHidden = Boolean(message.imageSpoiler && !revealedSpoilers.includes(message.id));
                        if (isVideoCircleAttachment(message.imageData, message.imageName)) {
                          return <VideoCircleMessagePlayer src={message.imageData} senderName={senderName} createdAt={message.createdAt} />;
                        }
                        if (isVoiceAttachment(message.imageData, message.imageName)) {
                          return <VoiceMessagePlayer src={message.imageData} senderName={senderName} createdAt={message.createdAt} transcribe={!message.pending ? () => api.transcribeGroupMessage(token, group.id, message.id).then((r) => r.transcript) : undefined} />;
                        }
                        if (isGifAttachment(message) && !spoilerHidden && message.imageData) {
                          return (
                            <GroupChatGifAttachment
                              src={message.imageData}
                              name={message.imageName ?? 'GIF'}
                              language={language}
                              onOpen={() => {
                                if (!message.imageData) return;
                                openImageViewer(message.imageData, message.imageName ?? 'GIF');
                              }}
                              onLoad={handleThreadMediaLoad}
                            />
                          );
                        }
                        return (
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
                            }}>
                            <img src={message.imageData} alt={message.imageName ?? ''} onLoad={handleThreadMediaLoad} />
                            {spoilerHidden ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
                          </button>
                        );
                      })() : null}
                      {extractPollId(message.body) ? (
                        <PollEmbed token={token} language={language} pollId={extractPollId(message.body)!} currentUserId={currentUser.id} />
                      ) : parseGameBody(message.body) ? (
                        <GameEmbed game={parseGameBody(message.body)!} language={language} />
                      ) : message.body && forwarded ? (
                        (() => {
                          const fwd = forwarded;
                          const forwardDeleted = Boolean(fwd.sourceId && (deletedForwardSourceIds.has(fwd.sourceId) || externalDeletedForwardSourceIds?.has(fwd.sourceId)));
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
                                ) : !forwardDeleted && message.imageData && isGifAttachment(message) ? (
                                  <GroupChatGifAttachment
                                    src={message.imageData}
                                    name={message.imageName ?? 'GIF'}
                                    language={language}
                                    onOpen={() => {
                                      if (!message.imageData) return;
                                      openImageViewer(message.imageData, message.imageName ?? 'GIF');
                                    }}
                                  />
                                ) : !forwardDeleted && message.imageData ? (
                                  <button
                                    className={message.imageSpoiler && !revealedSpoilers.includes(message.id) ? 'message-image spoiler' : 'message-image'}
                                    type="button"
                                    onContextMenu={(event) => message.imageData ? openImageMessageMenu(event, message, message.imageData) : undefined}
                                    onClick={() => {
                                      if (!message.imageData) return;
                                      if (message.imageSpoiler && !revealedSpoilers.includes(message.id)) {
                                        setRevealedSpoilers((current) => (current.includes(message.id) ? current : [...current, message.id]));
                                        return;
                                      }
                                      openImageViewer(message.imageData, message.imageName ?? t(language, 'imageMessage'));
                                    }}
                                  >
                                    <img src={message.imageData} alt={message.imageName ?? ''} />
                                    {message.imageSpoiler && !revealedSpoilers.includes(message.id) ? <span className="spoiler-label">{t(language, 'spoiler')}</span> : null}
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
                            const original = hasPackLink(message.body) ? stripPackLinks(message.body) : message.body;
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
                            return inviteCode ? <InviteEmbed token={token} language={language} inviteCode={inviteCode} channelId={inviteChannelId} currentUserId={currentUser.id} memberGroupIds={memberGroupIds} onJoined={onGroupJoin} onNavigate={onGroupNavigate} /> : null;
                          })()}
                          {(() => {
                            const watchInvite = extractWatchInvite(message.body);
                            return watchInvite ? <WatchInviteEmbed language={language} invite={watchInvite} onOpen={onOpenWatchTogether} /> : null;
                          })()}
                          {message.linkPreview && !extractGroupInviteCode(message.body) && !extractWatchInvite(message.body) ? (
                            <LinkPreviewCard preview={message.linkPreview} />
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )}
                  {!message.deletedAt && (message.reactions?.length ?? 0) > 0 ? (
                    <div className="message-reactions">
                      {message.reactions.map((reaction) => {
                        const mine = reaction.userIds.includes(currentUser.id);
                        return (
                          <button
                            key={reaction.emoji}
                            type="button"
                            className={mine ? 'message-reaction mine' : 'message-reaction'}
                            disabled={!canReactInActiveChannel}
                            onClick={() => void toggleReaction(message, reaction.emoji)}
                          >
                            <ReactionEmoji emoji={reaction.emoji} />
                            <span className="message-reaction-count">{reaction.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {!message.deletedAt && !isFeedPost && (message.threadCount ?? 0) > 0 ? (
                    <button type="button" className="message-thread-chip" onClick={() => openThreadView(message)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {message.threadCount} {t(language, message.threadCount === 1 ? 'threadReplyOne' : (message.threadCount ?? 0) < 5 ? 'threadReplyFew' : 'threadReplyMany')}
                    </button>
                  ) : null}
                  {!message.deletedAt && isFeedPost ? (
                    <div className="feed-post-footer">
                      {activeChannelObj?.type === 'feed' ? (
                      <button type="button" className="feed-comment-button" onClick={() => commentOnFeedPost(message)}>
                        {language === 'ru' ? 'Оставить комментарий' : 'Leave a comment'}
                      </button>
                      ) : <span />}
                      <span className="feed-post-stats">
                        <span>{message.viewCount ?? 0} {language === 'ru' ? 'просмотров' : 'views'}</span>
                        <span>{formatShortDate(message.createdAt)} {formatTime(message.createdAt)}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
                {!message.deletedAt ? (
                  <div className="message-hover-toolbar" role="toolbar" aria-label={t(language, 'addReaction')}>
                    {canReactInActiveChannel ? QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="message-action quick-react"
                        onClick={() => void toggleReaction(message, emoji)}
                      >
                        <ReactionEmoji emoji={emoji} size={20} />
                      </button>
                    )) : null}
                    {canReactInActiveChannel ? (
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
                    ) : null}
                    <button type="button" className="message-action" title={t(language, 'reply')} onClick={() => replyToMessage(message)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 17 4 12 9 7" />
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                      </svg>
                    </button>
                    <button type="button" className="message-action" title={t(language, 'forward')} onClick={() => void forwardMessage(message)}>
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
        {activeNsfwBlocked ? (
          <div className="group-nsfw-overlay">
            <div className="group-nsfw-card">
              <strong>{language === 'ru' ? 'NSFW канал' : 'NSFW channel'}</strong>
              <p>{language === 'ru' ? 'В этом канале может быть контент для взрослых.' : 'This channel may contain adult content.'}</p>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  if (!activeChannel) return;
                  setAcceptedNsfwChannels((current) => new Set(current).add(activeChannel));
                }}
              >
                {language === 'ru' ? 'Продолжить' : 'Continue'}
              </button>
            </div>
          </div>
        ) : null}
        </div>

        <form className="messenger-compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingMessage) void saveEdit();
            else void sendMessage();
          }}>
          {editingMessage ? (
            <div className="messenger-edit-preview">
              <img src={currentUser.avatarData} alt="" />
              <div>
                <strong>{currentUser.nickname}</strong>
                <time>{formatTime(editingMessage.createdAt)}</time>
                <p>{editingMessage.body}</p>
                {editingMediaItems.length > 0 ? (
                  <div className="message-edit-media-grid">
                    {editingMediaItems.map((item, index) => (
                      <div key={`${item.name}-${index}`} className="message-edit-media-item">
                        <img src={item.dataUrl} alt="" draggable={false} />
                        <button type="button" className="message-edit-media-remove" aria-label={t(language, 'delete')} onClick={() => {
                          if (editingMediaItems.length === 1 && !draft.trim()) {
                            setDeleteMessageConfirm(editingMessage);
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
              <button type="button" onClick={() => { setEditingMessage(null); setEditingMediaItems([]); emitGroupTyping(false); setDraft(''); }}>
                {t(language, 'cancel')}
              </button>
            </div>
          ) : null}
          {!editingMessage && replyTarget ? (
            <ReplyComposerBar
              reply={replyTarget}
              language={language}
              resolveName={(userId) => knownSenders.get(userId)?.nickname ?? userId.slice(0, 8)}
              onCancel={() => setReplyTarget(null)}
            />
          ) : null}
          {!editingMessage && activeNsfwBlocked ? (
            <div className="messenger-edit-preview messenger-channel-notice">
              <div>
                <strong>{language === 'ru' ? 'NSFW предупреждение' : 'NSFW warning'}</strong>
                <p>{language === 'ru' ? 'Подтвердите просмотр канала, чтобы писать.' : 'Confirm the channel warning to send messages.'}</p>
              </div>
            </div>
          ) : null}
          {!editingMessage && !activeNsfwBlocked && activeSlowmodeSeconds > 0 && !canBypassActiveSlowmode ? (
            <div className="messenger-edit-preview messenger-channel-notice">
              <div>
                <strong>{language === 'ru' ? 'Slowmode' : 'Slowmode'}</strong>
                <p>
                  {activeSlowmodeRemainingMs > 0
                    ? (language === 'ru' ? `Можно писать через ${formatCountdown(activeSlowmodeRemainingSeconds)}` : `You can send again in ${formatCountdown(activeSlowmodeRemainingSeconds)}`)
                    : (language === 'ru' ? `В этом канале slowmode: ${formatDuration(activeSlowmodeSeconds)}` : `Slowmode is enabled: ${formatDuration(activeSlowmodeSeconds)}`)}
                </p>
              </div>
            </div>
          ) : null}
          {groupTypingText ? (
            <div className="group-typing-line">
              <span>{groupTypingText}</span>
              <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
            </div>
          ) : null}
          <input ref={imageInputRef} className="hidden-file" type="file" accept="image/*" multiple
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []).slice(0, MAX_CHAT_MEDIA_BATCH);
              e.currentTarget.value = '';
              files.forEach((file) => void prepareImageFromFile(file));
            }} />
          {draft.startsWith('/') && !draft.includes(' ') ? (
            <div className="slash-command-hints">
              {SLASH_COMMANDS.filter((command) => command.name.startsWith(draft.slice(1).toLowerCase())).map((command) => (
                <button key={command.name} type="button" onClick={() => updateGroupDraft(`/${command.name} `)}>
                  <strong>/{command.name}</strong>
                  <span>{command.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="emoji-input-shell messenger-emoji-input">
            <button className="emoji-toggle inline messenger-attach-inline" type="button" aria-label={t(language, 'imageMessage')}
              disabled={Boolean(editingMessage) || !canAttachInActiveChannel || activeNsfwBlocked}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); imageInputRef.current?.click(); }}>
              <AttachIcon />
            </button>
            {canUseGroupIdentity && activeChannelObj?.type !== 'feed' ? (
              <button
                className={sendAsGroupIdentity ? 'messenger-identity-toggle active' : 'messenger-identity-toggle'}
                type="button"
                disabled={Boolean(editingMessage)}
                aria-label={language === 'ru' ? 'Писать от имени группы' : 'Send as group'}
                title={sendAsGroupIdentity ? group.name : currentUser.nickname}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setSendAsGroupIdentity((value) => !value);
                }}
              >
                <img src={sendAsGroupIdentity ? group.avatarData : currentUser.avatarData} alt="" draggable={false} />
              </button>
            ) : null}
            <EmojiInlineInput ref={inputRef} className="emoji-inline-input messenger-input" value={draft}
              placeholder={!canSendInActiveChannel
                ? (language === 'ru' ? 'Нет прав писать в этот канал' : 'You cannot send messages here')
                : activeChannelObj?.type === 'feed'
                  ? (language === 'ru' ? 'Опубликовать пост' : 'Publish a post')
                  : `# ${activeChannelName}`}
              disabled={!canSendInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0}
              mentionUsers={members.map((member) => member.user)}
              mentionRoles={mentionableRoles.map((role) => ({ id: role.id, name: role.name, color: role.color }))}
              mentionEveryone={canMentionEveryone && !activeNsfwBlocked}
              onChange={(event) => updateGroupDraft(event.target.value)} onPaste={handleComposerPaste} onContextMenu={openComposerMenu} />
            {/* GIF + emoji buttons share the same anchor host so the picker's
                outside-pointerdown close handler does not auto-close on a second
                click (which previously caused the GIF panel to close then instantly
                re-open). Toggle is deterministic: same tab + open => close. */}
            <div ref={groupEmojiAnchorRef} className="emoji-host inline">
              <VoiceRecorderControl
                language={language}
                disabled={Boolean(editingMessage || pendingImages.length > 0 || !canSendInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0)}
                voiceDisabled={!canSendVoiceMessagesInActiveChannel}
                videoDisabled={!canSendVideoCirclesInActiveChannel}
                onSend={(recording) => sendMessage({ ...recording, spoiler: false })}
              />
              <button
                className="emoji-toggle inline chat-gif-toggle"
                type="button"
                aria-label="GIF"
                disabled={!canAttachInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0}
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
                disabled={!canSendInActiveChannel || activeNsfwBlocked || activeSlowmodeRemainingMs > 0}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (emojiOpen && pickerTab === 'emoji') {
                    setEmojiOpen(false);
                  } else {
                    setPickerTab('emoji');
                    setEmojiOpen(true);
                  }
                }}>
                <EmojiToggleIcon />
              </button>
              {emojiOpen ? <EmojiPicker language={language} enlarged initialTab={pickerTab} anchorRef={groupEmojiAnchorRef} placement="top-end" onSelect={insertEmoji} onSelectGif={(gif) => void sendGif(gif)} onClose={() => setEmojiOpen(false)} token={token} currentUser={currentUser} /> : null}
            </div>
          </div>
          {/* Submit on Enter; hidden submit keeps form submission working without a send button. */}
          <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
        </form>

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
            {activeChannel && activeChannelObj?.type === 'text' && canCreatePollsInActiveChannel ? (
              <>
                <hr className="context-menu-divider" />
                <button
                  type="button"
                  className="context-menu-action"
                  onClick={() => {
                    setComposerMenu(null);
                    setPollModalOpen(true);
                  }}
                >
                  <span className="context-menu-action-text">{t(language, 'createPoll')}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 20V10M12 20V4M18 20v-7"/></svg>
                </button>
              </>
            ) : null}
          </div>,
          document.body
        ) : null}
        {pollModalOpen && activeChannel ? (
          <PollCreateModal
            language={language}
            onClose={() => setPollModalOpen(false)}
            onCreate={async (poll) => {
              if (!activeChannel) return;
              await api.createGroupPoll(token, group.id, activeChannel, poll);
            }}
          />
        ) : null}

        {pendingImages.length > 0 ? (
          <div className="messenger-image-draft-backdrop" onMouseDown={(event) => event.stopPropagation()}>
            <form className="messenger-image-draft-card"
              onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
              <div className="image-draft-header">
                <div>
                  <strong>{t(language, 'imageMessage')}</strong>
                  <span>{pendingImages.length} / {MAX_CHAT_MEDIA_BATCH}</span>
                </div>
                <button
                  type="button"
                  aria-label={t(language, 'imageMessage')}
                  disabled={pendingImages.length >= MAX_CHAT_MEDIA_BATCH || !canAttachInActiveChannel || activeNsfwBlocked}
                  onClick={() => imageInputRef.current?.click()}
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
                  <button className="emoji-toggle inline" type="button" aria-label={t(language, 'emoji')}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); setImageEmojiOpen((value) => !value); }}>
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
        )}
      </div>

      <div className={resizing ? 'group-member-splitter resizing' : 'group-member-splitter'} onMouseDown={(e) => { e.preventDefault(); setResizing(true); }} />
      <GroupMemberPanel
        token={token}
        language={language}
        group={group}
        members={members}
        memberCategories={memberCategories}
        ownerRoleId={ownerRoleId}
        typingMemberIds={typingMemberIds}
        canKickMembers={canKickMembers}
        isMemberOnline={isMemberOnline}
        memberPresenceStatus={memberPresenceStatus}
        buildProfilePreload={buildProfilePreload}
        onViewProfile={onViewProfile}
        setMemberMenu={setMemberMenu}
        handleRemoveMember={handleRemoveMember}
      />

      {memberMenu ? createPortal(
        <div ref={memberMenuRef} className="context-menu" style={{ left: memberMenuPos.x, top: memberMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { onViewProfile?.(memberMenu.user, group, buildProfilePreload(memberMenu.user.id), { left: memberMenu.x, top: memberMenu.y, right: memberMenu.x, bottom: memberMenu.y }); setMemberMenu(null); }}>
            {t(language, 'viewProfile')}
          </button>
          {onViewDesktop ? (
            <button type="button" onClick={() => { onViewDesktop(memberMenu.user); setMemberMenu(null); }}>
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}

      {channelMenu ? createPortal(
        <div ref={channelMenuRef} className="context-menu" style={{ left: channelMenuPos.x, top: channelMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className="context-menu-action" onClick={() => void copyEntityId(channelMenu.id)}>
            <span className="context-menu-action-text">{language === 'ru' ? 'Скопировать ID' : 'Copy ID'}</span>
            <MenuCopyIcon />
          </button>
          {channelMenu.kind === 'channel' ? (
            <button type="button" className="context-menu-action" onClick={() => { openChannelSettings(channelMenu.id); setChannelMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'channelSettings')}</span>
              <MenuEditIcon />
            </button>
          ) : null}
          {canManageChannels && channelMenu.kind === 'folder' ? (
            <button type="button" className="context-menu-action" onClick={() => { openFolderSettings(channelMenu.id); setChannelMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'folderSettings')}</span>
              <MenuEditIcon />
            </button>
          ) : null}
          {channelMenu.kind === 'channel' && channelMenu.name !== 'general' && !isFeedManagedChannel(channels.find((channel) => channel.id === channelMenu.id)) ? (
            <button type="button" className="context-menu-action danger-text" onClick={() => { setDeleteTarget({ kind: 'channel', id: channelMenu.id, name: channelMenu.name }); setChannelMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'deleteChannel')}</span>
              <MenuDeleteIcon />
            </button>
          ) : null}
          {canManageChannels && channelMenu.kind === 'folder' ? (
            <button type="button" className="context-menu-action danger-text" onClick={() => { setDeleteTarget({ kind: 'folder', id: channelMenu.id, name: channelMenu.name }); setChannelMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'deleteFolder')}</span>
              <MenuDeleteIcon />
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}

      {messageMenu ? createPortal(
        <div ref={menuRef} className="context-menu context-menu-with-reactions" style={{ left: messageMenuPos.x, top: messageMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
          {!messageMenu.message.deletedAt && canReactInActiveChannel ? (
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
          {!messageMenu.message.deletedAt ? (
            <button type="button" className="context-menu-action" onClick={() => replyToMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{t(language, 'reply')}</span>
              <MenuReplyIcon />
            </button>
          ) : null}
          {!messageMenu.message.deletedAt && !messageMenu.message.threadRootId && activeChannelObj?.type === 'text' ? (
            <button type="button" className="context-menu-action" onClick={() => { openThreadView(messageMenu.message); setMessageMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'replyInThread')}</span>
              <MenuReplyIcon />
            </button>
          ) : null}
          {!messageMenu.message.deletedAt ? (
            <button type="button" className="context-menu-action" onClick={() => void forwardMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{t(language, 'forward')}</span>
              <MenuForwardIcon />
            </button>
          ) : null}
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
          {messageMenu.message.body && !messageMenu.message.deletedAt ? (
            <button type="button" className="context-menu-action" onClick={() => void translateMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{messageTranslations[messageMenu.message.id] ? t(language, 'showOriginal') : t(language, 'translate')}</span>
              <MenuTranslateIcon />
            </button>
          ) : null}
          {canPinInActiveChannel ? (
            <button type="button" className="context-menu-action" onClick={() => void togglePinMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{messageMenu.message.pinnedAt ? t(language, 'unpin') : t(language, 'pinMessage')}</span>
              <MenuPinIcon />
            </button>
          ) : null}
          {canEditMsg(messageMenu.message) ? (
            <button type="button" className="context-menu-action" onClick={() => void editMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{t(language, 'editMessage')}</span>
              <MenuEditIcon />
            </button>
          ) : null}
          {(messageMenu.message.senderId === currentUser.id || canManageMessagesInActiveChannel) && !messageMenu.message.deletedAt ? (
            <button type="button" className="context-menu-action danger-text" onClick={() => { setDeleteMessageConfirm(messageMenu.message); setMessageMenu(null); }}>
              <span className="context-menu-action-text">{t(language, 'deleteMessage')}</span>
              <MenuDeleteIcon />
            </button>
          ) : null}
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

      {reactionPicker && canReactInActiveChannel ? (
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

      {showSettings && messengerSettingsTarget ? createPortal(
        <GroupSettingsModal
          token={token}
          language={language}
          currentUser={currentUser}
          group={group}
          channels={channels}
          roles={roles}
          members={members}
          customCategories={customCategories}
          setCustomCategories={setCustomCategories}
          groupInvites={groupInvites}
          settingsTab={settingsTab}
          setSettingsTab={setSettingsTab}
          isOwner={isOwner}
          canManageRoles={canManageRoles}
          canManageInvites={canManageInvites}
          canKickMembers={canKickMembers}
          otherMembersCount={otherMembersCount}
          copied={copied}
          newAvatar={newAvatar}
          newName={newName}
          setNewName={setNewName}
          newDescription={newDescription}
          setNewDescription={setNewDescription}
          nameplateDraft={nameplateDraft}
          setNameplateDraft={setNameplateDraft}
          defaultRoleId={defaultRoleId}
          defaultRoleMenuOpen={defaultRoleMenuOpen}
          setDefaultRoleMenuOpen={setDefaultRoleMenuOpen}
          roleEditorId={roleEditorId}
          roleEditorTab={roleEditorTab}
          setRoleEditorTab={setRoleEditorTab}
          roleSearch={roleSearch}
          setRoleSearch={setRoleSearch}
          roleSort={roleSort}
          setRoleSort={setRoleSort}
          roleMenuOpen={roleMenuOpen}
          setRoleMenuOpen={setRoleMenuOpen}
          roleIdCopied={roleIdCopied}
          collapsedCategories={collapsedCategories}
          toggleCategory={toggleCategory}
          everyonePermissions={everyonePermissions}
          editingRoleMeta={editingRoleMeta}
          setEditingRoleMeta={setEditingRoleMeta}
          draftHoist={draftHoist}
          setDraftHoist={setDraftHoist}
          draftPermissions={draftPermissions}
          setDraftPermissions={setDraftPermissions}
          rolePermissionSearch={rolePermissionSearch}
          setRolePermissionSearch={setRolePermissionSearch}
          roleMemberSearch={roleMemberSearch}
          setRoleMemberSearch={setRoleMemberSearch}
          memberSearch={memberSearch}
          setMemberSearch={setMemberSearch}
          memberSort={memberSort}
          setMemberSort={setMemberSort}
          memberRoleFilter={memberRoleFilter}
          setMemberRoleFilter={setMemberRoleFilter}
          settingsMembers={settingsMembers}
          selectedMemberIds={selectedMemberIds}
          setSelectedMemberIds={setSelectedMemberIds}
          selectedVisibleMemberIds={selectedVisibleMemberIds}
          bulkRoleMenu={bulkRoleMenu}
          setBulkRoleMenu={setBulkRoleMenu}
          memberRoleMenu={memberRoleMenu}
          setMemberRoleMenu={setMemberRoleMenu}
          memberRoleDetailsMenu={memberRoleDetailsMenu}
          setMemberRoleDetailsMenu={setMemberRoleDetailsMenu}
          settingsError={settingsError}
          overviewDirty={overviewDirty}
          roleEditorDirty={roleEditorDirty}
          saveBarShake={saveBarShake}
          confirmDeleteGroup={confirmDeleteGroup}
          setConfirmDeleteGroup={setConfirmDeleteGroup}
          requestCloseSettings={requestCloseSettings}
          requestDeleteGroup={requestDeleteGroup}
          handleAvatarUpload={handleAvatarUpload}
          handleNameplateUpload={handleNameplateUpload}
          handleRegenerateInvite={handleRegenerateInvite}
          handleCopyInviteCode={handleCopyInviteCode}
          handleDeleteInvite={handleDeleteInvite}
          handleSetDefaultRole={handleSetDefaultRole}
          handleCreateRole={handleCreateRole}
          handleDeleteRole={handleDeleteRole}
          handleCopyRoleId={handleCopyRoleId}
          openRoleEditor={openRoleEditor}
          openEveryoneRoleEditor={openEveryoneRoleEditor}
          closeRoleEditor={closeRoleEditor}
          resetRoleDrafts={resetRoleDrafts}
          handleSaveRolePermissions={handleSaveRolePermissions}
          memberHasRole={memberHasRole}
          getHeldRoleIds={getHeldRoleIds}
          handleAddMemberRole={handleAddMemberRole}
          handleRemoveMemberRole={handleRemoveMemberRole}
          handleBulkMemberRole={handleBulkMemberRole}
          toggleSelectedMember={toggleSelectedMember}
          toggleAllVisibleMembers={toggleAllVisibleMembers}
          handleRemoveMember={handleRemoveMember}
          handleLeaveGroup={handleLeaveGroup}
          handleDeleteGroup={handleDeleteGroup}
          handleSaveSettings={handleSaveSettings}
          resetOverviewDrafts={resetOverviewDrafts}
          formatShortDate={formatShortDate}
        />,
        messengerSettingsTarget
      ) : null}

      {showCreateChannel ? (
        <CreateChannelModal
          language={language}
          createChannelType={createChannelType}
          newChannelName={newChannelName}
          setNewChannelName={setNewChannelName}
          handleCreateChannel={handleCreateChannel}
          onClose={() => { setShowCreateChannel(false); setNewChannelName(''); }}
        />
      ) : null}

      {showCreateFolder ? (
        <CreateFolderModal
          language={language}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          handleCreateFolder={handleCreateFolder}
          onClose={() => { setShowCreateFolder(false); setNewFolderName(''); }}
        />
      ) : null}

      {editTarget?.kind === 'channel' && messengerSettingsTarget ? createPortal(
        <ChannelSettingsModal
          language={language}
          group={group}
          channelId={editTarget.id}
          channels={channels}
          roles={roles}
          everyonePermissions={everyonePermissions}
          groupInvites={groupInvites}
          copied={copied}
          settingsError={settingsError}
          channelSettingsTab={channelSettingsTab}
          switchChannelSettingsTab={switchChannelSettingsTab}
          canManageRoles={canManageRoles}
          canManageInvites={canManageInvites}
          editNameDraft={editNameDraft}
          setEditNameDraft={setEditNameDraft}
          editTopicDraft={editTopicDraft}
          setEditTopicDraft={setEditTopicDraft}
          editTopicTextareaRef={editTopicTextareaRef}
          editSlowmodeDraft={editSlowmodeDraft}
          setEditSlowmodeDraft={setEditSlowmodeDraft}
          editNsfwDraft={editNsfwDraft}
          setEditNsfwDraft={setEditNsfwDraft}
          editBitrateDraft={editBitrateDraft}
          setEditBitrateDraft={setEditBitrateDraft}
          editLimitDraft={editLimitDraft}
          setEditLimitDraft={setEditLimitDraft}
          editBarShake={editBarShake}
          selectedChannelPermissionRoleId={selectedChannelPermissionRoleId}
          setSelectedChannelPermissionRoleId={setSelectedChannelPermissionRoleId}
          channelPermissionDraft={channelPermissionDraft}
          setChannelPermissionDraft={setChannelPermissionDraft}
          isFeedManagedChannel={isFeedManagedChannel}
          isEditTargetDirty={isEditTargetDirty}
          isChannelPermissionsDirty={isChannelPermissionsDirty}
          requestCloseEditTarget={requestCloseEditTarget}
          resetEditTarget={resetEditTarget}
          saveEditTarget={saveEditTarget}
          saveChannelPermissions={saveChannelPermissions}
          applyTopicFormat={applyTopicFormat}
          handleCreateChannelInvite={handleCreateChannelInvite}
          handleCopyInviteCode={handleCopyInviteCode}
          handleDeleteInvite={handleDeleteInvite}
          handleDeleteChannel={handleDeleteChannel}
          closeEditTarget={() => setEditTarget(null)}
          formatShortDate={formatShortDate}
        />,
        messengerSettingsTarget
      ) : null}

      {editTarget?.kind === 'folder' ? (
        <FolderSettingsModal
          language={language}
          editNameDraft={editNameDraft}
          setEditNameDraft={setEditNameDraft}
          editBarShake={editBarShake}
          isEditTargetDirty={isEditTargetDirty}
          requestCloseEditTarget={requestCloseEditTarget}
          resetEditTarget={resetEditTarget}
          saveEditTarget={saveEditTarget}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteChannelOrFolderModal
          language={language}
          deleteTarget={deleteTarget}
          handleDeleteChannel={handleDeleteChannel}
          handleDeleteFolder={handleDeleteFolder}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}

      {deleteMessageConfirm ? (
        <DeleteMessageConfirmModal
          language={language}
          message={deleteMessageConfirm}
          deleteMessage={deleteMessage}
          onClose={() => setDeleteMessageConfirm(null)}
        />
      ) : null}

      {/* Electron screen-source picker: choose which window/screen to share. */}
      {voiceRoom?.screenSources ? createPortal(
        <div className="call-source-backdrop" onMouseDown={() => voiceRoom.cancelScreenPicker()}>
          <div className="call-source-card" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{t(language, 'chooseScreen')}</h3>
            <div className="call-source-grid">
              {voiceRoom.screenSources.length === 0 ? <p className="settings-hint">{t(language, 'noScreenSources')}</p> : null}
              {voiceRoom.screenSources.map((source) => (
                <button key={source.id} className="call-source-item" type="button" onClick={() => void voiceRoom.startScreenShare(source.id)}>
                  <img src={source.thumbnail} alt="" />
                  <span>{source.name}</span>
                </button>
              ))}
            </div>
            <div className="call-source-actions">
              <button className="secondary-action" type="button" onClick={() => voiceRoom.cancelScreenPicker()}>{t(language, 'cancel')}</button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {cropSource ? (
        <AvatarCropper
          imageDataUrl={cropSource}
          language={language}
          onCancel={() => setCropSource(null)}
          onApply={(nextAvatar) => {
            setNewAvatar(nextAvatar);
            setCropSource(null);
          }}
        />
      ) : null}

      {plateCropSource ? (
        <NameplateCropper
          imageDataUrl={plateCropSource}
          language={language}
          onCancel={() => setPlateCropSource(null)}
          onApply={(cropped) => {
            void saveNameplate({ ...nameplateDraft, type: 'image', image: cropped });
            setPlateCropSource(null);
          }}
        />
      ) : null}

      {imageViewer ? (
        <MediaLightbox
          language={language}
          src={imageViewer.items[imageViewer.index]?.src ?? ''}
          name={imageViewer.items[imageViewer.index]?.name ?? t(language, 'imageMessage')}
          items={imageViewer.items}
          initialIndex={imageViewer.index}
          onNavigate={() => {
            setLightboxProfileUserId(null);
            onCloseProfile?.();
          }}
          onSenderClick={(item, anchorRect) => {
            if (!item.senderUser) return;
            if (lightboxProfileUserId === item.senderUser.id) {
              setLightboxProfileUserId(null);
              onCloseProfile?.();
              return;
            }
            setLightboxProfileUserId(item.senderUser.id);
            onViewProfile?.(item.senderUser, group, buildProfilePreload(item.senderUser.id), anchorRect);
          }}
          onClose={() => {
            setImageViewer(null);
            setLightboxProfileUserId(null);
            onCloseProfile?.();
          }}
        />
      ) : null}

      {customizeOpen ? (
        <CustomizationModal
          language={language}
          group={group}
          categories={customCategories}
          selectedOptionIds={selectedOptionIds}
          onboardingRequired={onboardingRequired}
          onToggle={handleToggleOption}
          onComplete={handleCompleteOnboarding}
          onClose={() => setCustomizeOpen(false)}
        />
      ) : null}
    </div>
  );
}
