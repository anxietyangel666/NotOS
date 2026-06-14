import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { io } from 'socket.io-client';
import { api } from '../api/client';
import { readImageAsDataUrl } from '../auth/auth-file';
import type { Group, GroupChannel, GroupFolder, GroupMember, GroupMessage, GroupRole, Language, NamePlate, PublicUser } from '../api/types';
import { DEFAULT_NAMEPLATE, nameplateToCss } from '../api/types';
import type { VoiceRoom } from '../hooks/use-voice-room';
import { VoiceStage } from './VoiceStage';
import { t, getSavedTimeFormat } from '../i18n';
import { AvatarCropper } from './AvatarCropper';
import { NameplateCropper } from './NameplateCropper';
import { EmojiPicker } from './EmojiPicker';
import { InviteEmbed } from './InviteEmbed';
import { MessageText, Twemoji } from './Twemoji';
import { EmojiToggleIcon, AttachIcon } from './ChatComposeIcons';
import { UserName } from './UserName';
import { MicMuteIcon, ScreenShareIcon } from './PlayerIcons';
import { API_URL } from '../api/client';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';

const INVITE_RE = /gc_[A-Za-z0-9]{12}/g;
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;

const CHANNEL_PANEL_MIN = 200;
const CHANNEL_PANEL_MAX = 460;
const MEMBER_PANEL_MIN = 240;
const MEMBER_PANEL_MAX = 500;

function panelWidthKey(panel: 'channel' | 'member') {
  return `notoc.groupChat.${panel}PanelWidth`;
}

// Persist the channel/member panel widths so they survive reopening the messenger.
function loadPanelWidth(panel: 'channel' | 'member', fallback: number) {
  try {
    const raw = localStorage.getItem(panelWidthKey(panel));
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function savePanelWidth(panel: 'channel' | 'member', width: number) {
  try {
    localStorage.setItem(panelWidthKey(panel), String(Math.round(width)));
  } catch { }
}

function extractInviteCode(text: string) {
  INVITE_RE.lastIndex = 0;
  const match = INVITE_RE.exec(text);
  return match?.[0] ?? null;
}

type GroupChatViewProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  group: Group;
  onlineUserIds?: string[];
  onClose: () => void;
  onViewProfile?: (user: PublicUser, group?: Group) => void;
  onViewDesktop?: (user: PublicUser) => void;
  onGroupJoin?: (group: Group) => void;
  memberGroupIds?: Set<string>;
  onGroupNavigate?: (groupId: string) => void;
  onGroupLeft?: (groupId: string) => void;
  voiceRoom?: VoiceRoom;
};

export function GroupChatView({ token, language, currentUser, group, onlineUserIds = [], onClose, onViewProfile, onViewDesktop, onGroupJoin, memberGroupIds, onGroupNavigate, onGroupLeft, voiceRoom }: GroupChatViewProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [roles, setRoles] = useState<GroupRole[]>([]);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [memberPanelWidth, setMemberPanelWidth] = useState(() => loadPanelWidth('member', 280));
  const [channelPanelWidth, setChannelPanelWidth] = useState(() => loadPanelWidth('channel', 240));
  const [resizing, setResizing] = useState(false);
  const [resizingChannels, setResizingChannels] = useState(false);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: GroupMessage } | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ x: number; y: number; user: PublicUser } | null>(null);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text');
  const [newChannelName, setNewChannelName] = useState('');
  // Confirmation dialog before deleting a channel or folder.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'channel' | 'folder'; id: string; name: string } | null>(null);
  // Channel / folder settings dialog (rename, and member limit for voice).
  const [editTarget, setEditTarget] = useState<{ kind: 'channel' | 'folder'; id: string } | null>(null);
  const [editNameDraft, setEditNameDraft] = useState('');
  const [editLimitDraft, setEditLimitDraft] = useState<string>('');
  // When the user is connected to a voice channel and clicks it again, the
  // voice stage (chat + screen share) opens inline above the chat.
  const [voiceStageOpen, setVoiceStageOpen] = useState(false);
  const [folders, setFolders] = useState<GroupFolder[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#8a8a8a');
  const [editingRolePermissions, setEditingRolePermissions] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftHoist, setDraftHoist] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'overview' | 'invite' | 'roles' | 'members'>('overview');
  const [draggedItem, setDraggedItem] = useState<{ type: 'channel' | 'folder'; id: string } | null>(null);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; name: string; spoiler: boolean } | null>(null);
  const [imageCaptionDraft, setImageCaptionDraft] = useState('');
  const [revealedSpoilers, setRevealedSpoilers] = useState<string[]>([]);
  // Index into the pinned-messages list that the pin bar currently points at.
  // Clicking the bar jumps to that pin and advances to the next one.
  const [pinCursor, setPinCursor] = useState(0);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageEmojiOpen, setImageEmojiOpen] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; name: string } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageZoomOrigin, setImageZoomOrigin] = useState({ x: 50, y: 50 });
  const dragDepthRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const chatImgRef = useRef<HTMLImageElement | null>(null);

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
    if (!dragged) { setDraggedItem(null); return; }

    const before = dropsBefore(e);
    const without = channels.filter((c) => c.id !== draggedItem.id);
    let targetIndex = without.findIndex((c) => c.id === targetChannelId);
    if (targetIndex < 0) { setDraggedItem(null); return; }
    if (!before) targetIndex += 1;
    const moved = { ...dragged, folderId: targetFolderId };
    without.splice(targetIndex, 0, moved);
    setChannels(without);
    void persistChannelOrder(without);
    setDraggedItem(null);
  };

  // Drop a channel into a folder (append), or reorder a folder relative to another folder.
  const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.type === 'channel') {
      const dragged = channels.find((c) => c.id === draggedItem.id);
      if (dragged) {
        // Move into this folder and place it at the end of the folder's channels.
        const without = channels.filter((c) => c.id !== draggedItem.id);
        const moved = { ...dragged, folderId: targetFolderId };
        const lastInFolder = without.map((c, i) => ({ c, i })).filter((x) => x.c.folderId === targetFolderId).pop();
        const insertAt = lastInFolder ? lastInFolder.i + 1 : without.length;
        without.splice(insertAt, 0, moved);
        setChannels(without);
        void persistChannelOrder(without);
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
    if (dragged) {
      const without = channels.filter((c) => c.id !== draggedItem.id);
      const moved = { ...dragged, folderId: null };
      without.push(moved);
      setChannels(without);
      void persistChannelOrder(without);
    }
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };
  const [inviteCode, setInviteCode] = useState(group.inviteCode);
  const [newName, setNewName] = useState(group.name);
  const [copied, setCopied] = useState(false);
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [nameplateDraft, setNameplateDraft] = useState<NonNullable<NamePlate>>(group.nameplate ?? DEFAULT_NAMEPLATE);
  const [cropSource, setCropSource] = useState<string | null>(null);
  // Quick nameplate popup opened directly under the group title.
  const [platePopupOpen, setPlatePopupOpen] = useState(false);
  const [platePopupPos, setPlatePopupPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const platePopupRef = useRef<HTMLDivElement | null>(null);
  // Image awaiting region selection for the nameplate crop.
  const [plateCropSource, setPlateCropSource] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [editingRoleMeta, setEditingRoleMeta] = useState<{ id: string; name: string; color: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const groupEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const activeChannelRef = useRef<string | null>(null);

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

  const currentMember = useMemo(() => members.find((m) => m.user.id === currentUser.id), [members, currentUser.id]);
  const currentRole = useMemo(() => {
    if (!currentMember?.roleId) return null;
    return roles.find((r) => r.id === currentMember.roleId);
  }, [roles, currentMember]);
  const ownerRoleId = useMemo(() => roles.find((r) => r.isOwner)?.id, [roles]);
  const isOwner = useMemo(() => currentRole?.isOwner ?? currentMember?.role === 'Owner', [currentRole, currentMember]);
  const canManageRoles = useMemo(() => isOwner || (currentRole?.permissions?.includes('ManageRoles') ?? false), [isOwner, currentRole]);
  const canManageChannels = useMemo(() => isOwner || (currentRole?.permissions?.includes('ManageChannels') ?? false), [isOwner, currentRole]);
  const canKickMembers = useMemo(() => isOwner || (currentRole?.permissions?.includes('KickMembers') ?? false), [isOwner, currentRole]);
  const canDeleteAny = useMemo(() => isOwner || (currentRole?.permissions?.includes('DeleteAnyMessage') ?? false), [isOwner, currentRole]);
  // A member counts as an "admin" (can open group settings) when they own the
  // group or hold any management permission. Plain members instead get a
  // "Copy group link" action.
  const isGroupAdmin = useMemo(
    () => isOwner || canManageRoles || canManageChannels || canKickMembers,
    [isOwner, canManageRoles, canManageChannels, canKickMembers]
  );

  useEffect(() => {
    setNewName(group.name);
    setInviteCode(group.inviteCode);
    setNameplateDraft(group.nameplate ?? DEFAULT_NAMEPLATE);
  }, [group.id, group.name, group.inviteCode, group.nameplate]);

  // Load initial data
  useEffect(() => {
    // Clear the previous group's data immediately so switching groups does not
    // briefly show the old group's channels, messages and members for the 1-2s
    // it takes the new group's data to load. Without this reset the stale state
    // from the previous group lingers until the async requests below resolve.
    setChannels([]);
    setMessages([]);
    setMembers([]);
    setRoles([]);
    setFolders([]);
    setActiveChannel(null);

    let cancelled = false;
    void Promise.all([
      api.getGroupChannels(token, group.id),
      api.getGroupRoles(token, group.id),
      api.getGroupMembers(token, group.id),
      api.getGroupFolders(token, group.id)
    ]).then(([chanPayload, rolePayload, memPayload, folderPayload]) => {
      // Ignore a stale response if the user already switched to another group.
      if (cancelled) return;
      setChannels(chanPayload.channels);
      setRoles(rolePayload.roles);
      setMembers(memPayload.members);
      setFolders(folderPayload.folders);
      if (chanPayload.channels.length > 0) {
        const firstText = chanPayload.channels.find((c) => c.type !== 'voice') ?? chanPayload.channels[0];
        setActiveChannel(firstText.id);
      }
    });
    // Ask the server who is currently in this group's voice channels so the
    // participants list and x/N badges show before we join.
    voiceRoom?.requestGroupRooms(group.id);

    return () => {
      cancelled = true;
    };
  }, [token, group.id]);

  // Load messages for active channel
  useEffect(() => {
    if (!activeChannel) return;
    void api.getGroupMessages(token, group.id, activeChannel).then((payload) => {
      setMessages(payload.messages);
    });
  }, [token, group.id, activeChannel]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length]);

  // Listen for real-time group messages via direct socket connection
  useEffect(() => {
    const socket = io(API_URL, { auth: { token } });
    function handleNewMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      if (msg.groupId !== group.id) return;
      setMessages((current) => {
        if (current.some((m) => m.id === msg.id)) return current;
        if (activeChannelRef.current !== null && msg.channelId !== activeChannelRef.current) return current;
        return [...current, msg];
      });
    }
    function handleUpdateMessage(payload: { message: GroupMessage }) {
      const msg = payload.message;
      if (msg.groupId !== group.id) return;
      setMessages((current) => current.map((m) => m.id === msg.id ? msg : m));
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
      setChannels(payload.channels);
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
    socket.on('messenger:groupMessage', handleNewMessage);
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
    return () => {
      socket.disconnect();
    };
  }, [token, group.id]);

  // Sync activeChannel ref for socket handler
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);

  // Close context menus on outside click
  useEffect(() => {
    if (!messageMenu && !memberMenu && !groupMenuOpen) return;
    function close(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.('.context-menu')) return;
      setMessageMenu(null);
      setMemberMenu(null);
      setGroupMenuOpen(false);
    }
    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', close);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', close);
    };
  }, [messageMenu, memberMenu, groupMenuOpen]);

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
    return map;
  }, [members]);

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const isMemberOnline = (userId: string) => userId === currentUser.id || onlineSet.has(userId);

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
  }, [members, roles, onlineSet, currentUser.id, language]);

  function senderName(senderId: string) {
    return knownSenders.get(senderId)?.nickname ?? senderId.slice(0, 8);
  }

  function formatTime(value: string) {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uk' ? 'uk-UA' : 'en-US', {
      hour: '2-digit', minute: '2-digit', hour12: getSavedTimeFormat() === '12h'
    }).format(new Date(value));
  }

  async function sendMessage() {
    if (!activeChannel) return;
    const image = pendingImage;
    const body = (image ? imageCaptionDraft : draft).trim();
    if (!body && !image) return;
    if (image) setImageCaptionDraft('');
    else setDraft('');
    setPendingImage(null);
    setImageEmojiOpen(false);
    try {
      const payload = await api.sendGroupMessage(token, group.id, body, activeChannel, image ? { dataUrl: image.dataUrl, name: image.name, spoiler: image.spoiler } : undefined);
      setMessages((current) => (current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message]));
    } catch {
      // Restore the draft/image so the user can retry on failure.
      if (image) { setImageCaptionDraft(body); setPendingImage(image); }
      else setDraft(body);
    }
  }

  async function prepareImageFromFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { return; }
    if (file.size > MAX_CHAT_IMAGE_SIZE) { return; }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPendingImage({ dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false });
      setImageCaptionDraft('');
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
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    void prepareImageFromFile(file);
  }

  function closeImageDraft() {
    setPendingImage(null);
    setImageCaptionDraft('');
    setImageEmojiOpen(false);
  }

  async function editMessage(message: GroupMessage) {
    setEditingMessage(message);
    setDraft(message.body);
    setMessageMenu(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function saveEdit() {
    if (!editingMessage) return;
    const body = draft.trim();
    if (!body) { setEditingMessage(null); setDraft(''); return; }
    try {
      const payload = await api.editGroupMessage(token, editingMessage.id, body);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      setEditingMessage(null);
      setDraft('');
    } catch { }
  }

  async function deleteMessage(message: GroupMessage) {
    try {
      const payload = await api.deleteGroupMessage(token, message.id);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      setMessageMenu(null);
    } catch { }
  }

  async function togglePinMessage(message: GroupMessage) {
    try {
      const payload = await api.pinGroupMessage(token, message.id);
      setMessages((current) => current.map((m) => m.id === payload.message.id ? payload.message : m));
      setMessageMenu(null);
    } catch { }
  }

  function canEditMsg(message: GroupMessage) {
    if (message.senderId !== currentUser.id || message.deletedAt) return false;
    return Date.now() - new Date(message.createdAt).getTime() < 10 * 60 * 1000;
  }

  async function handleSaveSettings() {
    const updates: { name?: string; avatarData?: string; nameplate?: NamePlate } = {};
    if (newName.trim() && newName.trim() !== group.name) updates.name = newName.trim();
    if (newAvatar !== null) updates.avatarData = newAvatar;
    // Always send the nameplate so changes (including clearing to "none") persist.
    updates.nameplate = nameplateDraft;
    try {
      if (Object.keys(updates).length > 0) await api.updateGroup(token, group.id, updates);
      setNewAvatar(null);
      setSettingsError('');
      setShowSettings(false);
    } catch {
      setSettingsError(t(language, 'unknownError'));
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
    } catch {
      setSettingsError(t(language, 'unknownError'));
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
    try {
      const payload = await api.regenerateInvite(token, group.id);
      setInviteCode(payload.inviteCode);
    } catch { }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { }
  }

  async function handleCreateChannel() {
    if (!newChannelName.trim() || !canManageChannels) return;
    try {
      const payload = await api.createGroupChannel(token, group.id, newChannelName.trim(), createChannelType);
      // The socket event may have already added this channel; avoid creating a duplicate.
      setChannels((current) => current.some((c) => c.id === payload.channel.id) ? current : [...current, payload.channel]);
      // Text channels open immediately; voice channels are joined explicitly.
      if (payload.channel.type === 'text') setActiveChannel(payload.channel.id);
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
    setEditNameDraft(channel.name);
    setEditLimitDraft(channel.userLimit != null ? String(channel.userLimit) : '');
  }

  function openFolderSettings(folderId: string) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setEditTarget({ kind: 'folder', id: folderId });
    setEditNameDraft(folder.name);
    setEditLimitDraft('');
  }

  async function saveEditTarget() {
    if (!editTarget || !canManageChannels) return;
    const name = editNameDraft.trim();
    try {
      if (editTarget.kind === 'channel') {
        const channel = channels.find((c) => c.id === editTarget.id);
        const limit = editLimitDraft.trim() === '' ? null : Math.max(1, Math.min(99, Number(editLimitDraft) || 1));
        const updates: { name?: string; userLimit?: number | null } = {};
        if (name) updates.name = name;
        if (channel?.type === 'voice') updates.userLimit = limit;
        const payload = await api.updateGroupChannel(token, group.id, editTarget.id, updates);
        setChannels((current) => current.map((c) => c.id === payload.channel.id ? payload.channel : c));
      } else {
        if (name) {
          const payload = await api.updateGroupFolder(token, group.id, editTarget.id, { name });
          setFolders((current) => current.map((f) => f.id === payload.folder.id ? payload.folder : f));
        }
      }
      setEditTarget(null);
    } catch { }
  }

  // Click a voice channel: join it (or re-open the voice view if already here).
  function handleVoiceChannelClick(channelId: string) {
    if (!voiceRoom) return;
    if (voiceRoom.activeChannelId === channelId) {
      setVoiceStageOpen(true);
    } else {
      void voiceRoom.join(channelId);
    }
  }

  // Open a text channel: shows the normal chat. The voice connection stays
  // alive, but its full-screen voice view is hidden so the text chat is shown.
  function openTextChannel(channelId: string) {
    setActiveChannel(channelId);
    setVoiceStageOpen(false);
  }

  async function handleDeleteChannel(channelId: string) {
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
      // detach channels locally; server also broadcasts an authoritative list
      setChannels((current) => current.map((c) => c.folderId === folderId ? { ...c, folderId: null } : c));
    } catch { }
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || !canManageRoles) return;
    try {
      await api.createGroupRole(token, group.id, newRoleName.trim(), newRoleColor);
      const rolePayload = await api.getGroupRoles(token, group.id);
      setRoles(rolePayload.roles);
      setNewRoleName('');
      setShowCreateRole(false);
    } catch { }
  }

  async function handleDeleteRole(roleId: string) {
    try {
      await api.deleteGroupRole(token, group.id, roleId);
      const rolePayload = await api.getGroupRoles(token, group.id);
      setRoles(rolePayload.roles);
      const memPayload = await api.getGroupMembers(token, group.id);
      setMembers(memPayload.members);
    } catch { }
  }

  async function handleSaveRolePermissions(roleId: string) {
    try {
      const meta = editingRoleMeta && editingRoleMeta.id === roleId ? editingRoleMeta : null;
      await api.updateGroupRole(token, group.id, roleId, { permissions: draftPermissions, hoist: draftHoist, name: meta && meta.name.trim() ? meta.name.trim() : undefined, color: meta ? meta.color : undefined });
      const rolePayload = await api.getGroupRoles(token, group.id);
      setRoles(rolePayload.roles);
      setEditingRolePermissions(null);
      setDraftPermissions([]);
      setDraftHoist(false);
      setEditingRoleMeta(null);
    } catch { }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await api.removeGroupMember(token, group.id, userId);
      setMembers((current) => current.filter((m) => m.user.id !== userId));
    } catch { }
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
    setDraft((v) => `${v}${emoji}`);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function insertImageEmoji(emoji: string) {
    setImageCaptionDraft((v) => `${v}${emoji}`);
  }

  // Renders a single channel button (text or voice) for both the folder and
  // root channel lists.
  function renderChannelButton(channel: GroupChannel, folderId: string | null) {
    const isVoice = channel.type === 'voice';
    const inThisVoice = isVoice && voiceRoom?.activeChannelId === channel.id;
    const voiceParticipants = isVoice ? (voiceRoom?.channelParticipants.get(channel.id) ?? []) : [];
    const isActive = isVoice ? inThisVoice : activeChannel === channel.id;
    return (
      <button key={channel.id}
        className={`group-channel ${isVoice ? 'voice-channel' : ''} ${isActive ? 'active' : ''} ${draggedItem?.type === 'channel' && draggedItem.id !== channel.id ? 'drag-over' : ''}`}
        type="button"
        draggable={canManageChannels}
        onDragStart={(e) => handleChannelDragStart(e, channel.id)}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDropOnChannel(e, channel.id, folderId)}
        onDragEnd={handleDragEnd}
        onClick={() => isVoice ? handleVoiceChannelClick(channel.id) : openTextChannel(channel.id)}>
        <span className="group-channel-hash">
          {isVoice
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zm-2.5-9v2a7 7 0 0 1 0 14v2a9 9 0 0 0 0-18z"/></svg>
            : '#'}
        </span>
        <span className="group-channel-name">{channel.name}</span>
        {isVoice && channel.userLimit != null ? (
          <span className="group-channel-count">{voiceParticipants.length}/{channel.userLimit}</span>
        ) : null}
        {canManageChannels ? (
          <span className="group-channel-gear" title={t(language, 'channelSettings')}
            onClick={(e) => { e.stopPropagation(); openChannelSettings(channel.id); }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </span>
        ) : null}
        {canManageChannels && channel.name !== 'general' ? (
          <span className="group-channel-delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'channel', id: channel.id, name: channel.name }); }}>✕</span>
        ) : null}
      </button>
    );
  }

  // Bottom participant list for a voice channel (shown under it when occupied).
  function renderVoiceParticipants(channelId: string) {
    const list = voiceRoom?.channelParticipants.get(channelId) ?? [];
    if (list.length === 0) return null;
    return (
      <div className="voice-participants">
        {list.map((p) => (
          <div key={p.userId} className={`voice-participant ${voiceRoom?.talkingIds.has(p.userId) ? 'talking' : ''}`}
            title={p.user.nickname}
            onClick={() => { if (voiceRoom?.activeChannelId === channelId) setVoiceStageOpen(true); }}>
            <img src={p.user.avatarData} alt="" />
            <span className="voice-participant-name"><UserName user={p.user} /></span>
            {p.muted ? <span className="voice-participant-muted"><MicMuteIcon size={14} /></span> : null}
            {p.screen ? <span className="voice-participant-screen"><ScreenShareIcon size={14} /></span> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`group-chat-layout${imageDragging ? ' image-dragging' : ''}${resizing || resizingChannels ? ' resizing-panels' : ''}`} style={{ '--member-width': `${memberPanelWidth}px`, '--channel-width': `${channelPanelWidth}px` } as React.CSSProperties}
      onDragEnter={(e) => {
        if (editingMessage || !activeChannel || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        setImageDragging(true);
      }}
      onDragOver={(e) => {
        if (editingMessage || !activeChannel || !Array.from(e.dataTransfer.types).includes('Files')) return;
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
      {/* Channels sidebar */}
      <aside className="group-channels-panel">
        <div
          className={`group-channels-header${nameplateToCss(group.nameplate) ? ' has-nameplate' : ''}`}
          style={nameplateToCss(group.nameplate) ? { background: nameplateToCss(group.nameplate)!, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <button type="button" className="group-name-btn" onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const header = (e.currentTarget.closest('.group-channels-header') as HTMLElement) ?? e.currentTarget;
            const rect = header.getBoundingClientRect();
            setPlatePopupPos({ left: rect.left, top: rect.bottom + 4, width: rect.width });
            setPlatePopupOpen((v) => !v);
            setGroupMenuOpen(false);
          }}>
            <strong>{group.name}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          {platePopupOpen ? createPortal(
            <div
              ref={platePopupRef}
              className="nameplate-quick-popup"
              style={{ left: platePopupPos?.left ?? 0, top: platePopupPos?.top ?? 0, minWidth: Math.max(240, platePopupPos?.width ?? 0) }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Live preview of the current nameplate. */}
              <div
                className="nameplate-quick-preview"
                style={nameplateToCss(nameplateDraft) ? { background: nameplateToCss(nameplateDraft)!, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                <img src={newAvatar ?? group.avatarData} alt="" />
                <strong>{group.name}</strong>
              </div>

              {isOwner ? (
                <>
                  <div className="nameplate-types">
                    {(['none', 'color', 'gradient', 'image'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={nameplateDraft.type === type ? 'nameplate-type active' : 'nameplate-type'}
                        onClick={() => void saveNameplate({ ...nameplateDraft, type })}
                      >
                        {t(language, type === 'none' ? 'nameplateNone' : type === 'color' ? 'nameplateColor' : type === 'gradient' ? 'nameplateGradient' : 'nameplateImage')}
                      </button>
                    ))}
                  </div>

                  {nameplateDraft.type === 'color' ? (
                    <label className="nameplate-field">
                      <span>{t(language, 'nameplateColor')}</span>
                      <input type="color" value={nameplateDraft.color} onChange={(e) => void saveNameplate({ ...nameplateDraft, color: e.target.value })} />
                    </label>
                  ) : null}

                  {nameplateDraft.type === 'gradient' ? (
                    <div className="nameplate-gradient-row">
                      <label className="nameplate-field">
                        <span>{t(language, 'nameplateFrom')}</span>
                        <input type="color" value={nameplateDraft.gradientFrom} onChange={(e) => void saveNameplate({ ...nameplateDraft, gradientFrom: e.target.value })} />
                      </label>
                      <label className="nameplate-field">
                        <span>{t(language, 'nameplateTo')}</span>
                        <input type="color" value={nameplateDraft.gradientTo} onChange={(e) => void saveNameplate({ ...nameplateDraft, gradientTo: e.target.value })} />
                      </label>
                    </div>
                  ) : null}

                  {nameplateDraft.type === 'image' ? (
                    <div className="nameplate-quick-actions">
                      <label className="secondary-action" style={{ textAlign: 'center', cursor: 'pointer' }}>
                        {t(language, 'nameplateUpload')}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => { void handlePlateCropUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="nameplate-quick-menu">
                {canManageChannels ? (
                  <>
                    <button type="button" onClick={() => { setCreateChannelType('text'); setShowCreateChannel(true); setPlatePopupOpen(false); }}>{t(language, 'createChannel')}</button>
                    <button type="button" onClick={() => { setCreateChannelType('voice'); setShowCreateChannel(true); setPlatePopupOpen(false); }}>{t(language, 'createVoiceChannel')}</button>
                    <button type="button" onClick={() => { setShowCreateFolder(true); setPlatePopupOpen(false); }}>{t(language, 'createFolder')}</button>
                  </>
                ) : null}
                {isGroupAdmin ? (
                  <button type="button" onClick={() => { setShowSettings(true); setPlatePopupOpen(false); }}>{t(language, 'groupSettings')}</button>
                ) : (
                  <button type="button" onClick={() => { void handleCopyInvite(); setPlatePopupOpen(false); }}>{t(language, 'copyInviteLink')}</button>
                )}
              </div>
            </div>,
            document.body
          ) : null}
        </div>
        <div className="group-channels-list">
          {folders.map((folder) => {
            const collapsed = collapsedFolders.has(folder.id);
            const folderChannels = channels.filter((c) => c.folderId === folder.id);
            return (
              <div key={folder.id}
                className={`group-folder ${draggedItem?.type === 'folder' && draggedItem.id !== folder.id ? 'drag-over' : ''}`}
                draggable={canManageChannels}
                onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnFolder(e, folder.id)}
                onDragEnd={handleDragEnd}>
                <button type="button" className="group-folder-header" onClick={() => toggleFolderCollapsed(folder.id)}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  <span>{folder.name}</span>
                  {canManageChannels ? (
                    <span className="group-channel-delete" title={t(language, 'deleteFolder')} onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'folder', id: folder.id, name: folder.name }); }}>✕</span>
                  ) : null}
                </button>
                {!collapsed ? (
                  <div className="group-folder-channels" onDragOver={handleDragOver} onDrop={(e) => handleDropOnFolder(e, folder.id)}>
                    {folderChannels.map((channel) => (
                      <Fragment key={channel.id}>
                        {renderChannelButton(channel, folder.id)}
                        {channel.type === 'voice' ? renderVoiceParticipants(channel.id) : null}
                      </Fragment>
                    ))}
                    {folderChannels.length === 0 ? (
                      <div className="group-folder-empty">{t(language, 'dropChannelHere')}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {/* Root drop zone fills the remaining space so channels can be dragged out of folders. */}
          <div
            className={`group-channels-root ${draggedItem?.type === 'channel' ? 'droppable' : ''}`}
            onDragOver={handleDragOver}
            onDrop={handleDropOnRoot}>
            {channels.filter((c) => !c.folderId).map((channel) => (
              <Fragment key={channel.id}>
                {renderChannelButton(channel, null)}
                {channel.type === 'voice' ? renderVoiceParticipants(channel.id) : null}
              </Fragment>
            ))}
          </div>
        </div>
      </aside>

      <div className={resizingChannels ? 'group-channel-splitter resizing' : 'group-channel-splitter'} onMouseDown={(e) => { e.preventDefault(); setResizingChannels(true); }} />

      <div className={`group-chat-main${showVoiceView ? ' has-voice-stage' : ''}`}>
        <header className="group-chat-header">
          {showVoiceView ? (
            <h3>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M3 10v4h4l5 5V5L7 10H3z"/></svg>
              {voiceConnectedChannel!.name}
            </h3>
          ) : (
            <h3># {channels.find((c) => c.id === activeChannel)?.name ?? 'general'}</h3>
          )}
        </header>

        {/* Dedicated voice view: top stage + bottom ephemeral chat. The text
            channel thread is hidden while connected and viewing the voice
            channel. Opening another text channel hides this and shows the chat. */}
        {showVoiceView ? (
          <VoiceStage
            language={language}
            currentUser={currentUser}
            channelName={voiceConnectedChannel!.name}
            voiceRoom={voiceRoom!}
          />
        ) : (
        <>
        <div className="messenger-thread-wrap chat-enlarged">
        {(() => {
          const pinned = messages
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
                {sender ? <UserName user={sender} as="strong" /> : <strong>{senderName(current.senderId)}</strong>}
                <span>{current.body || (current.imageData ? '📷' : '')}</span>
              </div>
            </div>
          );
        })()}

        <div ref={threadRef} className="messenger-thread">
          {messages.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
          {messages.map((message, index) => {
            const isMine = message.senderId === currentUser.id;
            const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
            const isStartOfGroup = showDateDivider || index === 0 || messages[index - 1].senderId !== message.senderId || (new Date(message.createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime() > 120000);
            const bubbleClasses = [
              'message-bubble',
              isStartOfGroup ? 'message-group-start' : '',
              isMine ? 'mine' : '',
              message.pinnedAt ? 'pinned' : ''
            ].filter(Boolean).join(' ');
            const senderUser = knownSenders.get(message.senderId);
            const senderAvatar = senderUser?.avatarData ?? currentUser.avatarData;
            const senderName = senderUser?.nickname ?? currentUser.nickname;
            return (
              <Fragment key={message.id}>
              {showDateDivider ? (
                <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
              ) : null}
              <article className={bubbleClasses}
                id={'gmsg-' + message.id}
                data-time={formatTime(message.createdAt)}
                onContextMenu={(event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (message.deletedAt) return;
                  setMessageMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 90), message });
                }}>
                <img className="message-avatar" src={senderAvatar} alt="" draggable={false} style={{ cursor: 'pointer' }} onClick={() => onViewProfile?.(knownSenders.get(message.senderId) as PublicUser, group)} />
                <div className="message-body">
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
                      {message.imageData ? (() => {
                        const spoilerHidden = Boolean(message.imageSpoiler && !revealedSpoilers.includes(message.id));
                        return (
                          <button
                            className={spoilerHidden ? 'message-image spoiler' : 'message-image'}
                            type="button"
                            onClick={() => {
                              if (!message.imageData) return;
                              if (spoilerHidden) {
                                setRevealedSpoilers((current) => (current.includes(message.id) ? current : [...current, message.id]));
                                return;
                              }
                              setImageViewer({ src: message.imageData, name: message.imageName ?? t(language, 'imageMessage') });
                              setImageZoom(1);
                              setImageZoomOrigin({ x: 50, y: 50 });
                            }}>
                            <img src={message.imageData} alt={message.imageName ?? ''} onLoad={() => {
                              if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
                            }} />
                            {spoilerHidden ? <span>{t(language, 'spoiler')}</span> : null}
                          </button>
                        );
                      })() : null}
                      {message.body ? (
                        <>
                          <p className="message-text"><MessageText text={message.body ?? ''} /></p>
                          {(() => {
                            const inviteCode = extractInviteCode(message.body);
                            return inviteCode ? <InviteEmbed token={token} language={language} inviteCode={inviteCode} currentUserId={currentUser.id} memberGroupIds={memberGroupIds} onJoined={onGroupJoin} onNavigate={onGroupNavigate} /> : null;
                          })()}
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
              </Fragment>
            );
          })}
        </div>
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
              </div>
              <button type="button" onClick={() => { setEditingMessage(null); setDraft(''); }}>
                {t(language, 'cancel')}
              </button>
            </div>
          ) : null}
          <input ref={imageInputRef} className="hidden-file" type="file" accept="image/*"
            onChange={(e) => { void prepareImageFromFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
          <div className="emoji-input-shell messenger-emoji-input">
            <button className="emoji-toggle inline messenger-attach-inline" type="button" aria-label={t(language, 'imageMessage')}
              disabled={Boolean(editingMessage)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); imageInputRef.current?.click(); }}>
              <AttachIcon />
            </button>
            <input ref={inputRef} className="emoji-inline-input messenger-input" value={draft}
              placeholder={`# ${channels.find((c) => c.id === activeChannel)?.name ?? 'general'}`}
              onChange={(event) => setDraft(event.target.value)} />
            <div ref={groupEmojiAnchorRef} className="emoji-host inline">
              <button
                className="emoji-toggle inline"
                type="button"
                aria-label={t(language, 'emoji')}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setEmojiOpen((value) => !value);
                }}>
                <EmojiToggleIcon />
              </button>
              {emojiOpen ? <EmojiPicker language={language} enlarged anchorRef={groupEmojiAnchorRef} placement="top-end" onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} /> : null}
            </div>
          </div>
          {/* Submit on Enter; hidden submit keeps form submission working without a send button. */}
          <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
        </form>

        {pendingImage ? (
          <div className="messenger-image-draft-backdrop" onMouseDown={(event) => event.stopPropagation()}>
            <form className="messenger-image-draft-card"
              onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
              <img src={pendingImage.dataUrl} alt={pendingImage.name} />
              <label className="spoiler-toggle">
                <input type="checkbox" checked={pendingImage.spoiler} onChange={(event) => setPendingImage((current) => (current ? { ...current, spoiler: event.target.checked } : current))} />
                <span>{t(language, 'spoiler')}</span>
              </label>
              <div className="emoji-input-shell image-caption-input">
                <input className="emoji-inline-input" value={imageCaptionDraft} placeholder={t(language, 'imageCaptionPlaceholder')} onChange={(event) => setImageCaptionDraft(event.target.value)} autoFocus />
                <div ref={imageEmojiAnchorRef} className="emoji-host inline">
                  <button className="emoji-toggle inline" type="button" aria-label={t(language, 'emoji')}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); setImageEmojiOpen((value) => !value); }}>
                    <EmojiToggleIcon />
                  </button>
                  {imageEmojiOpen ? <EmojiPicker language={language} enlarged anchorRef={imageEmojiAnchorRef} placement="top-end" onSelect={insertImageEmoji} onClose={() => setImageEmojiOpen(false)} /> : null}
                </div>
              </div>
              <div className="image-draft-actions">
                <button className="secondary-action" type="button" onClick={closeImageDraft}>{t(language, 'cancel')}</button>
                {/* Hidden submit so pressing Enter in the caption sends the image. */}
                <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
              </div>
            </form>
          </div>
        ) : null}
        </>
        )}
      </div>

      <div className={resizing ? 'group-member-splitter resizing' : 'group-member-splitter'} onMouseDown={(e) => { e.preventDefault(); setResizing(true); }} />
      <aside className="group-member-panel">
        <div className="group-member-panel-header">
          <strong>{t(language, 'members')} ({members.length})</strong>
        </div>
        <div className="group-member-list">
          {memberCategories.map((category) => (
            <div key={category.key}>
              <div className="group-role-header" style={category.color ? { color: category.color } : undefined}>
                {category.label} — {category.members.length}
              </div>
              {category.members.map((member) => {
                const memberOnline = isMemberOnline(member.user.id);
                const plateCss = nameplateToCss(member.user.nameplate);
                return (
                <div className={`${memberOnline ? 'group-member-card' : 'group-member-card offline'}${plateCss ? ' has-nameplate' : ''}`} style={plateCss ? { background: plateCss } : undefined} key={member.user.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMemberMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 90), user: member.user });
                  }}>
                  <span className="messenger-avatar-wrap">
                    <img src={member.user.avatarData} alt="" />
                    <i className={memberOnline ? 'presence-dot online' : 'presence-dot'} />
                  </span>
                  <span className="group-member-name"><UserName user={member.user} />{member.roleId === ownerRoleId ? ' 👑' : ''}</span>
                  {canKickMembers && !member.role.includes('Owner') ? (
                    <button type="button" className="group-member-remove" onClick={() => void handleRemoveMember(member.user.id)} title="Remove">✕</button>
                  ) : null}
                </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {memberMenu ? createPortal(
        <div className="context-menu" style={{ left: memberMenu.x, top: memberMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { onViewProfile?.(memberMenu.user, group); setMemberMenu(null); }}>
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

      {messageMenu ? createPortal(
        <div ref={menuRef} className="context-menu" style={{ left: messageMenu.x, top: messageMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => void togglePinMessage(messageMenu.message)}>
            {messageMenu.message.pinnedAt ? t(language, 'unpin') : t(language, 'pinMessage')}
          </button>
          {canEditMsg(messageMenu.message) ? (
            <button type="button" onClick={() => void editMessage(messageMenu.message)}>{t(language, 'editMessage')}</button>
          ) : null}
          {(messageMenu.message.senderId === currentUser.id || canDeleteAny) && !messageMenu.message.deletedAt ? (
            <button type="button" onClick={() => void deleteMessage(messageMenu.message)}>{t(language, 'deleteMessage')}</button>
          ) : null}
        </div>,
        document.body
      ) : null}

      {showSettings ? (
        <div className="messenger-inline-modal" onClick={() => setShowSettings(false)}>
          <div className="group-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="group-settings-sidebar">
              <div className="group-settings-sidebar-header">
                <img className="group-settings-sidebar-avatar" src={group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="32" font-family="sans-serif">${(group.name[0]||'?').toUpperCase()}</text></svg>`} alt="" />
                <strong>{group.name}</strong>
              </div>
              <div className="group-settings-tabs-list">
                <button type="button" className={'group-settings-tab' + (settingsTab === 'overview' ? ' active' : '')} onClick={() => setSettingsTab('overview')}>
                  {t(language, 'overview')}
                </button>
                <button type="button" className={'group-settings-tab' + (settingsTab === 'invite' ? ' active' : '')} onClick={() => setSettingsTab('invite')}>
                  {t(language, 'inviteLink')}
                </button>
                {canManageRoles ? (
                  <button type="button" className={'group-settings-tab' + (settingsTab === 'roles' ? ' active' : '')} onClick={() => setSettingsTab('roles')}>
                    {t(language, 'roles')}
                  </button>
                ) : null}
                {canManageRoles ? (
                  <button type="button" className={'group-settings-tab' + (settingsTab === 'members' ? ' active' : '')} onClick={() => setSettingsTab('members')}>
                    {t(language, 'members')}
                  </button>
                ) : null}
              </div>
              {isOwner ? (
                <button
                  type="button"
                  className="group-settings-delete-tab"
                  disabled={otherMembersCount > 0}
                  title={otherMembersCount > 0 ? t(language, 'deleteGroupHasMembers') : t(language, 'deleteGroup')}
                  onClick={requestDeleteGroup}
                >
                  {t(language, 'deleteGroup')}
                </button>
              ) : null}
            </div>
            <div className="group-settings-content">
              {settingsTab === 'overview' ? (
                <>
                  <div className="group-settings-section">
                    <h3>{t(language, 'overview')}</h3>
                    <div className="group-settings-avatar-row">
                      {(newAvatar ?? group.avatarData) ? (
                        <img className="group-settings-avatar-preview" src={newAvatar ?? group.avatarData} alt="" />
                      ) : (
                        <span className="group-settings-avatar-fallback">{(group.name[0] ?? '?').toUpperCase()}</span>
                      )}
                      <input id="group-avatar-file" className="hidden-file" type="file" accept="image/*" onChange={(e) => void handleAvatarUpload(e.currentTarget.files?.[0])} />
                      {isOwner ? (
                        <button type="button" className="secondary-action" onClick={() => document.getElementById('group-avatar-file')?.click()}>{t(language, 'uploadAvatar')}</button>
                      ) : null}
                    </div>
                    <label>{t(language, 'groupName')}</label>
                    <input type="text" className="messenger-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </div>
                  <div className="group-settings-section">
                    <h3>{t(language, 'nameplate')}</h3>
                    <div className="nameplate-editor group-nameplate-editor">
                      <small className="muted-line">{t(language, 'groupNameplateHint')}</small>
                      <div
                        className="nameplate-preview group-nameplate-preview"
                        style={{ background: nameplateToCss(nameplateDraft) ?? undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
                      >
                        <img src={newAvatar ?? group.avatarData} alt="" />
                        <strong>{newName || group.name}</strong>
                      </div>
                      {isOwner ? (
                        <>
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
                              <input type="color" value={nameplateDraft.color} onChange={(e) => setNameplateDraft((c) => ({ ...c, color: e.target.value }))} />
                            </label>
                          ) : null}
                          {nameplateDraft.type === 'gradient' ? (
                            <div className="nameplate-gradient-row">
                              <label className="nameplate-field">
                                <span>{t(language, 'nameplateFrom')}</span>
                                <input type="color" value={nameplateDraft.gradientFrom} onChange={(e) => setNameplateDraft((c) => ({ ...c, gradientFrom: e.target.value }))} />
                              </label>
                              <label className="nameplate-field">
                                <span>{t(language, 'nameplateTo')}</span>
                                <input type="color" value={nameplateDraft.gradientTo} onChange={(e) => setNameplateDraft((c) => ({ ...c, gradientTo: e.target.value }))} />
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
                                onChange={(e) => { void handleNameplateUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
                              />
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {settingsTab === 'invite' ? (
                <div className="group-settings-section">
                  <h3>{t(language, 'inviteLink')}</h3>
                  <div className="invite-code-row">
                    <code>{inviteCode}</code>
                    <button type="button" onClick={() => void handleCopyInvite()}>{copied ? 'OK' : t(language, 'copyInviteLink')}</button>
                    {(isOwner || currentRole?.permissions?.includes('ManageInvites')) ? (
                      <button type="button" onClick={() => void handleRegenerateInvite()}>{t(language, 'regenerateInvite')}</button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {settingsTab === 'roles' && canManageRoles ? (
                <div className="group-settings-section">
                  <h3>{t(language, 'roles')}</h3>
                  <div className="group-settings-roles">
                    {roles.map((role) => (
                      <div className="group-settings-role" key={role.id}>
                        <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                        <span className="group-settings-role-name">{role.name}</span>
                        {!role.isOwner ? (
                          <div className="group-settings-role-actions">
                            <button type="button" className="group-settings-role-btn" title={t(language, 'editRole')}
                              onClick={() => {
                                if (editingRolePermissions === role.id) {
                                  setEditingRolePermissions(null);
                                  setEditingRoleMeta(null);
                                } else {
                                  setEditingRolePermissions(role.id);
                                  setDraftPermissions([...role.permissions]);
                                  setDraftHoist(role.hoist);
                                  setEditingRoleMeta({ id: role.id, name: role.name, color: role.color });
                                }
                              }}>
                              {editingRolePermissions === role.id ? '✕' : '⚙'}
                            </button>
                            <button type="button" className="group-settings-role-btn danger" title={t(language, 'deleteRole')}
                              onClick={() => void handleDeleteRole(role.id)}>🗑</button>
                          </div>
                        ) : null}
                        {editingRolePermissions === role.id ? (
                          <div className="group-role-permissions">
                            <div className="group-settings-role-create">
                              <input type="text" className="messenger-input" value={editingRoleMeta?.name ?? role.name} onChange={(e) => setEditingRoleMeta((prev) => ({ id: role.id, name: e.target.value, color: prev?.color ?? role.color }))} />
                              <input type="color" value={editingRoleMeta?.color ?? role.color} onChange={(e) => setEditingRoleMeta((prev) => ({ id: role.id, name: prev?.name ?? role.name, color: e.target.value }))} />
                            </div>
                            {['ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers'].map((perm) => (
                              <label key={perm} className="group-role-permission-item">
                                <input type="checkbox" checked={draftPermissions.includes(perm)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setDraftPermissions((prev) => [...prev, perm]);
                                    } else {
                                      setDraftPermissions((prev) => prev.filter((p) => p !== perm));
                                    }
                                  }} />
                                {t(language, perm as any) || perm}
                              </label>
                            ))}
                            <label className="group-role-permission-item group-role-hoist" title={t(language, 'roleDisplayHint')}>
                              <input type="checkbox" checked={draftHoist} onChange={(e) => setDraftHoist(e.target.checked)} />
                              {t(language, 'roleDisplaySeparately')}
                            </label>
                            <button type="button" className="group-settings-add-role" onClick={() => void handleSaveRolePermissions(role.id)}>{t(language, 'save')}</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {showCreateRole ? (
                      <div className="group-settings-role-create">
                        <input type="text" className="messenger-input" value={newRoleName}
                          onChange={(e) => setNewRoleName(e.target.value)}
                          placeholder="role name" />
                        <input type="color" value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} />
                        <button type="button" onClick={() => void handleCreateRole()}>+</button>
                        <button type="button" onClick={() => { setShowCreateRole(false); setNewRoleName(''); }}>✕</button>
                      </div>
                    ) : (
                      <button type="button" className="group-settings-add-role" onClick={() => setShowCreateRole(true)}>+ {t(language, 'addRole')}</button>
                    )}
                  </div>
                </div>
              ) : null}

              {settingsTab === 'members' && canManageRoles ? (
                <div className="group-settings-section">
                  <h3>{t(language, 'members')}</h3>
                  <div className="group-settings-members-list">
                    {members.map((member) => {
                      const memberRole = roles.find((r) => r.id === member.roleId);
                      return (
                        <div key={member.user.id} className="group-settings-member">
                          <img src={member.user.avatarData} alt="" className="group-settings-member-avatar" />
                          <span className="group-settings-member-name"><UserName user={member.user} /></span>
                          <select className="messenger-input group-settings-member-role-select"
                            value={member.roleId ?? ''}
                            onChange={(e) => {
                              const newRoleId = e.target.value || null;
                              void api.updateGroupMemberRole(token, group.id, member.user.id, newRoleId).then((payload) => {
                                setMembers(payload.members);
                              });
                            }}
                            disabled={member.user.id === currentUser.id && isOwner}>
                            <option value="">member</option>
                            {roles.filter((r) => !r.isOwner).map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                          {canKickMembers && member.user.id !== currentUser.id ? (
                            <button type="button" className="group-settings-member-kick" onClick={() => void handleRemoveMember(member.user.id)}>✕</button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {settingsError ? <div className="inline-error">{settingsError}</div> : null}
              <div className="group-settings-actions">
                {isOwner ? (
                  <button type="button" className="primary-action" onClick={() => void handleSaveSettings()}>{t(language, 'save')}</button>
                ) : null}
                {!isOwner ? (
                  <button type="button" className="secondary-action" onClick={() => void handleLeaveGroup()}>{t(language, 'leaveGroup')}</button>
                ) : null}
                <button type="button" className="secondary-action" onClick={() => setShowSettings(false)}>{t(language, 'close')}</button>
              </div>
            </div>
          </div>

          {confirmDeleteGroup ? createPortal(
            <div className="modal-backdrop important" onClick={() => setConfirmDeleteGroup(false)}>
              <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
                <p>{t(language, 'deleteGroupConfirm')}</p>
                <div className="confirm-actions">
                  <button className="secondary-action" type="button" onClick={() => setConfirmDeleteGroup(false)}>
                    {t(language, 'cancel')}
                  </button>
                  <button className="primary-action danger-text" type="button" onClick={() => void handleDeleteGroup()}>
                    {t(language, 'deleteGroup')}
                  </button>
                </div>
              </section>
            </div>,
            document.body
          ) : null}
        </div>
      ) : null}

      {showCreateChannel ? (
        <div className="messenger-inline-modal" onClick={() => { setShowCreateChannel(false); setNewChannelName(''); }}>
          <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, createChannelType === 'voice' ? 'createVoiceChannel' : 'createChannel')}</h3>
            <label>{t(language, 'channelName')}</label>
            <input type="text" className="messenger-input" value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateChannel(); }}
              placeholder="general"
              autoFocus />
            <div className="group-channel-modal-actions">
              <button type="button" className="primary-action" disabled={!newChannelName.trim()} onClick={() => void handleCreateChannel()}>{t(language, 'create')}</button>
              <button type="button" className="secondary-action" onClick={() => { setShowCreateChannel(false); setNewChannelName(''); }}>{t(language, 'close')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateFolder ? (
        <div className="messenger-inline-modal" onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }}>
          <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, 'createFolder')}</h3>
            <label>{t(language, 'folderName')}</label>
            <input type="text" className="messenger-input" value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateFolder(); }}
              placeholder="folder name"
              autoFocus />
            <div className="group-channel-modal-actions">
              <button type="button" className="primary-action" disabled={!newFolderName.trim()} onClick={() => void handleCreateFolder()}>{t(language, 'create')}</button>
              <button type="button" className="secondary-action" onClick={() => { setShowCreateFolder(false); setNewFolderName(''); }}>{t(language, 'close')}</button>
            </div>
          </div>
        </div>
      ) : null}

      {editTarget ? (() => {
        const channel = editTarget.kind === 'channel' ? channels.find((c) => c.id === editTarget.id) : null;
        const isVoice = channel?.type === 'voice';
        return (
          <div className="messenger-inline-modal" onClick={() => setEditTarget(null)}>
            <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{t(language, editTarget.kind === 'folder' ? 'folderSettings' : 'channelSettings')}</h3>
              <label>{t(language, editTarget.kind === 'folder' ? 'renameFolder' : 'renameChannel')}</label>
              <input type="text" className="messenger-input" value={editNameDraft}
                onChange={(e) => setEditNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEditTarget(); }}
                autoFocus />
              {isVoice ? (
                <>
                  <label>{t(language, 'memberLimit')}</label>
                  <input type="number" min={1} max={99} className="messenger-input" value={editLimitDraft}
                    placeholder={t(language, 'noLimit')}
                    onChange={(e) => setEditLimitDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEditTarget(); }} />
                </>
              ) : null}
              <div className="group-channel-modal-actions">
                <button type="button" className="primary-action" onClick={() => void saveEditTarget()}>{t(language, 'save')}</button>
                <button type="button" className="secondary-action" onClick={() => setEditTarget(null)}>{t(language, 'close')}</button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {deleteTarget ? (
        <div className="messenger-inline-modal" onClick={() => setDeleteTarget(null)}>
          <div className="group-channel-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t(language, deleteTarget.kind === 'folder' ? 'deleteFolder' : 'deleteChannel')}</h3>
            <p className="confirm-text">{t(language, deleteTarget.kind === 'folder' ? 'deleteFolderConfirm' : 'deleteChannelConfirm', { name: deleteTarget.name })}</p>
            <div className="group-channel-modal-actions">
              <button type="button" className="danger-action" onClick={() => {
                if (deleteTarget.kind === 'channel') void handleDeleteChannel(deleteTarget.id);
                else void handleDeleteFolder(deleteTarget.id);
                setDeleteTarget(null);
              }}>{t(language, 'delete')}</button>
              <button type="button" className="secondary-action" onClick={() => setDeleteTarget(null)}>{t(language, 'cancel')}</button>
            </div>
          </div>
        </div>
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
        <div className="chat-image-viewer" onClick={() => { setImageViewer(null); setImageZoom(1); setImageZoomOrigin({ x: 50, y: 50 }); }}>
          <figure onClick={(event) => {
            event.stopPropagation();
            const img = chatImgRef.current;
            if (!img) return;
            const rect = img.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 100;
            const y = ((event.clientY - rect.top) / rect.height) * 100;
            setImageZoomOrigin({ x, y });
            setImageZoom((s) => {
              const next = s * 1.2;
              return next >= 2.5 ? 1 : next;
            });
          }}>
            <img ref={chatImgRef} src={imageViewer.src} alt={imageViewer.name}
              style={{ transform: `scale(${imageZoom})`, transformOrigin: `${imageZoomOrigin.x}% ${imageZoomOrigin.y}%`, cursor: imageZoom >= 2.5 ? 'zoom-out' : 'zoom-in' }} />
            <figcaption>{imageViewer.name}</figcaption>
          </figure>
          <button type="button" className="chat-image-viewer-close" aria-label={t(language, 'close')} onClick={() => { setImageViewer(null); setImageZoom(1); setImageZoomOrigin({ x: 50, y: 50 }); }} />
        </div>
      ) : null}
    </div>
  );
}
