import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { api } from '../api/client';
import { cacheUser, getOrFetchUser } from '../api/user-cache';
import { useSocket } from '../hooks/use-socket';
import type { ConversationPreview, FriendRequests, Group, GroupConversationPreview, GroupMessage, GroupRole, Language, MessengerMessage, PublicUser, StorageItem } from '../api/types';
import { nameplateToCss } from '../api/types';
import { readImageAsDataUrl } from '../auth/auth-file';
import { LOCALES, t, getSavedTimeFormat } from '../i18n';
import { EmojiPicker } from './EmojiPicker';
import { GroupChatView } from './GroupChatView';
import { GroupCreateModal } from './GroupCreateModal';
import { RailFolders, type RailItem } from './RailFolders';
import { InviteEmbed } from './InviteEmbed';
import { UserEmbed } from './UserEmbed';
import { UserName } from './UserName';
import { extractProfileUserId } from '../utils/profile-link';
import { ProfileModal } from './ProfileModal';
import { MessageText, Twemoji } from './Twemoji';
import { EmojiToggleIcon, AttachIcon } from './ChatComposeIcons';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';
import { EmojiTooltipPortal } from './EmojiTooltip';
import { WindowFrame } from './WindowFrame';
import { CallAudioSink, CallInviteModal, CallStagePanel, ScreenSourcePicker } from './CallOverlay';
import { useVoiceCall, type CallEndedEvent } from '../hooks/use-voice-call';
import { useVoiceRoom } from '../hooks/use-voice-room';
import { VoiceAudioSink } from './VoiceAudioSink';
import { callMessageLabel } from '../utils/call-messages';

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
  onUserChange?: (user: PublicUser) => void;
  onEditProfile?: () => void;
};

type FriendsTab = 'online' | 'all' | 'requests' | 'sendRequest';

type PendingChatImage = {
  dataUrl: string;
  name: string;
  spoiler: boolean;
};

type FriendsChangedPayload = {
  friends: PublicUser[];
  requests: FriendRequests;
};

const EMPTY_REQUESTS: FriendRequests = { incoming: [], outgoing: [] };
const MESSAGE_EDIT_WINDOW_MS = 10 * 60 * 1000;
const MESSAGE_EDIT_RECENT_LIMIT = 5;
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
const PINNED_KEY = 'notoc.messenger.pinned';

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function savePinned(pinned: Set<string>) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned])); } catch { }
}

function formatMessageTime(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(new Date(value));
}

function uniqueById(users: PublicUser[]) {
  return Array.from(new Map(users.map((user) => [user.id, user])).values());
}

function unreadLabel(count: number) {
  return count > 9 ? '9+' : String(count);
}

// Builds the inline background style for a user's nameplate, applied behind
// that user's own card in friend / conversation lists.
function nameplateStyle(user: PublicUser): React.CSSProperties | undefined {
  const css = nameplateToCss(user.nameplate);
  return css ? { background: css } : undefined;
}

const INVITE_RE = /gc_[A-Za-z0-9]{12}/g;

function extractInviteCode(text: string) {
  INVITE_RE.lastIndex = 0;
  const match = INVITE_RE.exec(text);
  return match?.[0] ?? null;
}

function isImageStorageItem(item: StorageItem) {
  return item.type === 'file' && (item.mimeType?.startsWith('image/') || item.content?.startsWith('data:image/'));
}

export function MessengerWindow({
  token,
  language,
  currentUser,
  initialChatUserId,
  initialChatRequestId = 0,
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
  onUserChange,
  onEditProfile
}: MessengerWindowProps) {
  const sharedSocket = useSocket();
  const socketRef = useRef<Socket | null>(null);
  socketRef.current = sharedSocket;
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [callChatCollapsed, setCallChatCollapsed] = useState(false);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const imageCaptionInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const selectedUserRef = useRef<PublicUser | null>(null);
  const selectedGroupRef = useRef<Group | null>(null);
  const activeViewRef = useRef<'friends' | 'directMessages'>('directMessages');
  const typingTimerRef = useRef<number | null>(null);
  const peopleRef = useRef<PublicUser[]>([]);
  const conversationsRef = useRef<ConversationPreview[]>([]);
  const groupsRef = useRef<Group[]>([]);
  // Cache loaded conversation threads per user so reopening a chat renders
  // instantly while a fresh copy is fetched in the background.
  const messageCacheRef = useRef<Map<string, MessengerMessage[]>>(new Map());
  const dragDepthRef = useRef(0);
  const [activeView, setActiveView] = useState<'friends' | 'directMessages'>('directMessages');
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('online');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<FriendRequests>(EMPTY_REQUESTS);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedUser, setSelectedUser] = useState<PublicUser | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [imageCaptionDraft, setImageCaptionDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingChatImage | null>(null);
  const [imageDragging, setImageDragging] = useState(false);
  const [imageViewer, setImageViewer] = useState<{ src: string; name: string } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageZoomOrigin, setImageZoomOrigin] = useState({ x: 50, y: 50 });
  const chatImgRef = useRef<HTMLImageElement | null>(null);
  const [pinnedConversations, setPinnedConversations] = useState<Set<string>>(loadPinned);
  const [revealedSpoilers, setRevealedSpoilers] = useState<string[]>([]);
  // Pin bar cursor: clicking the bar jumps to the current pin and advances.
  const [pinCursor, setPinCursor] = useState(0);
  const [pinConfirm, setPinConfirm] = useState<MessengerMessage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<MessengerMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<MessengerMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: MessengerMessage } | null>(null);
  const [userMenu, setUserMenu] = useState<{ x: number; y: number; user: PublicUser } | null>(null);
  const [profileUser, setProfileUser] = useState<PublicUser | null>(null);
  const [profileGroup, setProfileGroup] = useState<Group | undefined>(undefined);
  // Preloaded roles passed from the group view so the profile shows them instantly.
  const [profilePreload, setProfilePreload] = useState<{ groupRoles: GroupRole[]; userRoles: GroupRole[] } | undefined>(undefined);
  const [splitWidth, setSplitWidth] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('notoc.messenger.splitWidth');
      return stored ? Number(stored) : null;
    } catch { return null; }
  });
  const [resizing, setResizing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [imageEmojiOpen, setImageEmojiOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupConversations, setGroupConversations] = useState<GroupConversationPreview[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const hasSearchQuery = query.trim().length >= 2;
  const selectedIsFriend = useMemo(() => Boolean(selectedUser && friends.some((friend) => friend.id === selectedUser.id)), [friends, selectedUser]);
  const selectedTyping = Boolean(selectedUser && typingUserIds.includes(selectedUser.id));
  const imageDropEnabled = Boolean(selectedUser && activeView === 'directMessages' && !editingMessage);
  const sortedConversations = useMemo(() => {
    const pinned = pinnedConversations;
    return [...conversations].sort((a, b) => {
      const aPinned = pinned.has(a.user.id) ? 1 : 0;
      const bPinned = pinned.has(b.user.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime();
    });
  }, [conversations, pinnedConversations]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
    selectedGroupRef.current = selectedGroup;
    activeViewRef.current = activeView;
    onActiveChatChange(activeView === 'directMessages' ? selectedUser?.id ?? null : null);
    return () => onActiveChatChange(null);
  }, [activeView, onActiveChatChange, selectedUser, selectedGroup]);

  useEffect(() => {
    if (activeView !== 'directMessages') return;
    window.requestAnimationFrame(() => {
      const thread = threadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
  }, [activeView, messages.length, selectedUser?.id]);

  // Reset the pin cursor whenever the open conversation changes.
  useEffect(() => { setPinCursor(0); }, [selectedUser?.id]);

  useEffect(() => {
    if (!messageMenu && !userMenu) return;

    function closeMenu(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.('.context-menu')) return;
      setMessageMenu(null);
      setUserMenu(null);
    }

    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', closeMenu);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', closeMenu);
    };
  }, [messageMenu, userMenu]);

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
      ...friends,
      ...requests.incoming,
      ...requests.outgoing,
      ...searchResults,
      ...conversations.map((conversation) => conversation.user),
      ...(selectedUser ? [selectedUser] : [])
    ]);
    conversationsRef.current = conversations;
    groupsRef.current = groups;
  }, [conversations, friends, groups, requests.incoming, requests.outgoing, searchResults, selectedUser]);

  useEffect(() => {
    if (!initialChatUserId) return;
    if (activeView === 'directMessages' && selectedUser?.id === initialChatUserId) return;
    const known = knownUser(initialChatUserId);

    if (known) {
      void chooseUser(known);
      return;
    }

    void api.getPublicUser(token, initialChatUserId).then((payload) => void chooseUser(payload.user));
  }, [initialChatRequestId, initialChatUserId, conversations, friends, requests.incoming, requests.outgoing, searchResults]);

  function replaceMessage(nextMessage: MessengerMessage) {
    const otherId = nextMessage.senderId === currentUser.id ? nextMessage.recipientId : nextMessage.senderId;
    const cached = messageCacheRef.current.get(otherId);
    if (cached) {
      messageCacheRef.current.set(otherId, cached.map((message) => (message.id === nextMessage.id ? nextMessage : message)));
    }
    setMessages((current) => current.map((message) => (message.id === nextMessage.id ? nextMessage : message)));
    setConversations((current) =>
      current.map((conversation) => (conversation.message.id === nextMessage.id ? { ...conversation, message: nextMessage } : conversation))
    );
    setEditingMessage((current) => (current?.id === nextMessage.id ? (nextMessage.deletedAt ? null : nextMessage) : current));
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
    Promise.all([api.getFriends(token), api.getFriendRequests(token), api.getConversations(token), api.getGroups(token), api.getGroupConversations(token)])
      .then(([friendPayload, requestPayload, conversationPayload, groupsPayload, groupConvPayload]) => {
        if (!alive) return;
        setFriends(friendPayload.friends);
        setRequests(requestPayload.requests);
        setConversations(conversationPayload.conversations);
        setGroups(groupsPayload.groups);
        setGroupConversations(groupConvPayload.conversations);
      })
      .catch((loadError) => {
        if (alive) setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
      });

    return () => {
      alive = false;
    };
  }, [language, token]);

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

  // Use the shared socket from SocketProvider — no longer creates its own connection.
  useEffect(() => {
    const socket = sharedSocket;
    if (!socket) return;
    setSocketInstance(socket);

    function onMessage(payload: { message: MessengerMessage }) {
      const message = payload.message;
      upsertConversation(message);
      const otherId = message.senderId === currentUser.id ? message.recipientId : message.senderId;
      const cached = messageCacheRef.current.get(otherId);
      if (cached && !cached.some((item) => item.id === message.id)) {
        messageCacheRef.current.set(otherId, [...cached, message]);
      }
      const selected = selectedUserRef.current;
      if (!selected || (message.senderId !== selected.id && message.recipientId !== selected.id)) return;
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    }

    function onMessageUpdated(payload: { message: MessengerMessage }) { replaceMessage(payload.message); }
    function onMessageDeleted(payload: { message: MessengerMessage }) { replaceMessage(payload.message); }
    function onMessagePinned(payload: { message: MessengerMessage }) { replaceMessage(payload.message); }

    function onFriendsChanged(payload: FriendsChangedPayload) {
      payload.friends.forEach(cacheUser);
      setFriends(uniqueById(payload.friends));
      setRequests(payload.requests);
    }

    function onUserChanged(payload: { user: PublicUser }) {
      cacheUser(payload.user);
      replaceKnownUser(payload.user);
    }

    function onPresenceSnapshot(payload: { onlineUserIds: string[] }) { setOnlineUserIds(payload.onlineUserIds); }

    function onPresenceChanged(payload: { userId: string; online: boolean }) {
      setOnlineUserIds((current) => {
        if (payload.online) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((userId) => userId !== payload.userId);
      });
    }

    function onTyping(payload: { userId: string; typing: boolean }) {
      setTypingUserIds((current) => {
        if (payload.typing) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((userId) => userId !== payload.userId);
      });
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

    socket.on('messenger:message', onMessage);
    socket.on('messenger:messageUpdated', onMessageUpdated);
    socket.on('messenger:messageDeleted', onMessageDeleted);
    socket.on('messenger:messagePinned', onMessagePinned);
    socket.on('messenger:friendsChanged', onFriendsChanged);
    socket.on('desktop:userChanged', onUserChanged);
    socket.on('presence:snapshot', onPresenceSnapshot);
    socket.on('presence:changed', onPresenceChanged);
    socket.on('messenger:typing', onTyping);
    socket.on('messenger:groupCreated', onGroupCreated);
    socket.on('messenger:groupUpdated', onGroupUpdated);
    socket.on('messenger:groupDeleted', onGroupDeleted);
    socket.on('messenger:groupInvited', onGroupInvited);
    socket.on('messenger:groupRemoved', onGroupRemoved);
    socket.on('messenger:groupMessage', onGroupMessage);
    socket.on('messenger:groupMessageUpdated', onGroupMessageUpdated);
    socket.on('messenger:groupMessageDeleted', onGroupMessageDeleted);

    return () => {
      setSocketInstance(null);
      socket.off('messenger:message', onMessage);
      socket.off('messenger:messageUpdated', onMessageUpdated);
      socket.off('messenger:messageDeleted', onMessageDeleted);
      socket.off('messenger:messagePinned', onMessagePinned);
      socket.off('messenger:friendsChanged', onFriendsChanged);
      socket.off('desktop:userChanged', onUserChanged);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('presence:changed', onPresenceChanged);
      socket.off('messenger:typing', onTyping);
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
      body: `\u{1F4DE} ${label}`,
      imageData: null,
      imageName: null,
      imageSpoiler: false,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      pinnedAt: null
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

  async function chooseUser(person: PublicUser) {
    setSelectedUser(person);
    setSelectedGroup(null);
    setActiveView('directMessages');
    // Show the cached thread immediately (if any) to avoid a visible empty
    // state while the latest messages are fetched in the background.
    setMessages(messageCacheRef.current.get(person.id) ?? []);
    setPinCursor(0);
    setEditingMessage(null);
    setUserMenu(null);
    setMessageDraft('');
    setImageCaptionDraft('');
    setPendingImage(null);
    setEmojiOpen(false);
    setImageEmojiOpen(false);
    setError('');
    socketRef.current?.emit('messenger:typing', { recipientId: person.id, typing: false });

    try {
      const payload = await api.getMessages(token, person.id);
      messageCacheRef.current.set(person.id, payload.messages);
      // Only apply if the user is still viewing this chat (avoids clobbering a
      // freshly opened different conversation when responses arrive out of order).
      if (selectedUserRef.current?.id === person.id) setMessages(payload.messages);
      setConversations((current) => {
        const conv = current.find((c) => c.user.id === person.id);
        if (!conv) return current;
        const latestMsg = payload.messages.length > 0 ? payload.messages[payload.messages.length - 1] : conv.message;
        return [{ ...conv, unreadCount: 0, message: latestMsg }, ...current.filter((c) => c.user.id !== person.id)];
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
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

  async function sendMessage() {
    if (!selectedUser) return;
    const image = pendingImage;
    const body = (image ? imageCaptionDraft : messageDraft).trim();
    if (!body && !image) return;

    if (editingMessage) {
      if (!body) return;
      try {
        const payload = await api.editMessage(token, editingMessage.id, body);
        replaceMessage(payload.message);
        setEditingMessage(null);
        setMessageDraft('');
      } catch (editError) {
        setError(editError instanceof Error ? editError.message : t(language, 'unknownError'));
      }
      return;
    }

    if (image) setImageCaptionDraft('');
    else setMessageDraft('');
    setPendingImage(null);
    setImageEmojiOpen(false);
    setError('');
    socketRef.current?.emit('messenger:typing', { recipientId: selectedUser.id, typing: false });

    try {
      const payload = await api.sendMessage(token, selectedUser.id, body, image ? { dataUrl: image.dataUrl, name: image.name, spoiler: image.spoiler } : undefined);
      setMessages((current) => (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message]));
      upsertConversation(payload.message);
    } catch (sendError) {
      if (image) setImageCaptionDraft(body);
      else setMessageDraft(body);
      setPendingImage(image);
      setError(sendError instanceof Error ? sendError.message : t(language, 'unknownError'));
    }
  }

  async function editMessage(message: MessengerMessage) {
    if (!canEditMessage(message)) return;
    setEditingMessage(message);
    setPendingImage(null);
    setMessageDraft(message.body);
    setMessageMenu(null);
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  async function removeMessage(message: MessengerMessage) {
    try {
      const payload = await api.deleteMessage(token, message.id);
      replaceMessage(payload.message);
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setMessageDraft('');
      }
      setMessageMenu(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t(language, 'unknownError'));
    }
  }

  async function pinMessage(message: MessengerMessage) {
    try {
      const payload = await api.pinMessage(token, message.id);
      replaceMessage(payload.message);
      setMessageMenu(null);
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : t(language, 'unknownError'));
    }
  }

  function updateMessageDraft(value: string) {
    setMessageDraft(value);
    if (!selectedUser || editingMessage) return;
    socketRef.current?.emit('messenger:typing', { recipientId: selectedUser.id, typing: Boolean(value.trim()) });

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socketRef.current?.emit('messenger:typing', { recipientId: selectedUser.id, typing: false });
    }, 1200);
  }

  function insertEmoji(emoji: string) {
    setMessageDraft((value) => `${value}${emoji}`);
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  function insertImageEmoji(emoji: string) {
    setImageCaptionDraft((value) => `${value}${emoji}`);
    window.setTimeout(() => imageCaptionInputRef.current?.focus(), 0);
  }

  function messagePreviewText(message: MessengerMessage) {
    if (message.deletedAt) return t(language, 'messageDeleted');
    const callLabel = callMessageLabel(message, currentUser.id, language);
    if (callLabel) return `\u{1F4DE} ${callLabel}`;
    return message.body || (message.imageData ? t(language, 'imageMessage') : '');
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
    setPendingImage({ dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false });
    setImageCaptionDraft('');
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

    setPendingImage({ dataUrl: item.content, name: item.name, spoiler: false });
    setImageCaptionDraft('');
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

    const imageFile = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/'));
    if (!imageFile) {
      setError(t(language, 'imageOnlyMessage'));
      return;
    }

    try {
      await prepareImageFromFile(imageFile);
    } catch {
      setError(t(language, 'imageReadFailed'));
    }
  }

  function closeImageDraft() {
    setPendingImage(null);
    setImageCaptionDraft('');
    setImageEmojiOpen(false);
  }

  function isOnline(person: PublicUser) {
    return onlineUserIds.includes(person.id);
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
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 90),
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
            <i className={isOnline(person) ? 'presence-dot online' : 'presence-dot'} />
          </span>
          <span>
            <UserName user={person} as="strong" />
            <small>{isOnline(person) ? t(language, 'online') : t(language, 'offline')}</small>
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

    const visibleFriends = friendsTab === 'online' ? onlineFriends : friends;

    return (
      <div className="messenger-friends-content">
        <section className="messenger-list-section">
          <div className="messenger-section-title">
            <strong>{friendsTab === 'online' ? t(language, 'onlineFriends') : t(language, 'allFriends')}</strong>
            <span>{visibleFriends.length}</span>
          </div>
          <div className="messenger-people-list">
            {friendsTab === 'online' && visibleFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noOnlineFriends')}</div> : null}
            {friendsTab === 'all' && visibleFriends.length === 0 ? <div className="explorer-empty">{t(language, 'noFriends')}</div> : null}
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

  return (
    <WindowFrame
      language={language}
      title={t(language, 'messenger')}
      centerTitle={centerTitle}
      className="messenger-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 470), y: 70 }}
      storageKey="messenger"
      minSize={{ width: 720, height: 400 }}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
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
                presence: isOnline(friend) ? 'online' : 'offline',
                unread: unreadCountForUser(friend.id),
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
        <nav className="messenger-topbar" aria-label={t(language, 'friends')}>
          <div className="messenger-topbar-friends">
            <button className={activeView === 'friends' ? 'messenger-friends-button active' : 'messenger-friends-button'} type="button" onClick={() => { setActiveView('friends'); setSelectedGroup(null); }}>
              {t(language, 'friends')}
            </button>
            <button className={activeView === 'directMessages' && !selectedGroup ? 'messenger-friends-button active' : 'messenger-friends-button'} type="button" onClick={() => { setActiveView('directMessages'); setSelectedGroup(null); setSelectedUser(null); setMessages([]); }}>
              {t(language, 'directMessages')}
            </button>
          </div>
        </nav>

        <div className={activeView === 'friends' || selectedGroup ? 'messenger-body friends-mode' : 'messenger-body'} style={!selectedGroup && splitWidth && activeView !== 'friends' ? { '--split-width': `${splitWidth}px` } as React.CSSProperties : undefined}>
        {activeView === 'friends' || selectedGroup ? null : <aside className="messenger-conversations-panel">
          <div className="messenger-section-title compact-title">
            <strong>{t(language, 'directMessages')}</strong>
            <span>{conversations.length}</span>
          </div>
          <div className="messenger-conversation-list">
            {sortedConversations.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
            {sortedConversations.map((conversation) => {
              const convPlate = nameplateStyle(conversation.user);
              return (
              <button className={`${selectedUser?.id === conversation.user.id ? 'messenger-conversation active' : 'messenger-conversation'}${convPlate ? ' has-nameplate' : ''}`} style={convPlate} type="button" key={conversation.user.id} onClick={() => void chooseUser(conversation.user)} onContextMenu={(event) => openUserMenu(event, conversation.user)}>
                <span className="messenger-avatar-wrap">
                  <img src={conversation.user.avatarData} alt="" draggable={false} />
                  <i className={isOnline(conversation.user) ? 'presence-dot online' : 'presence-dot'} />
                  {pinnedConversations.has(conversation.user.id) ? <i className="pin-indicator" /> : null}
                </span>
                <span className="messenger-conversation-text">
                  <strong>{conversation.user.nickname}</strong>
                  <small>{messagePreviewText(conversation.message)}</small>
                </span>
                {conversation.unreadCount > 0 ? <span className="unread-badge">{unreadLabel(conversation.unreadCount)}</span> : null}
              </button>
              );
            })}
          </div>
        </aside>}
        {activeView !== 'friends' && !selectedGroup ? <div className={resizing ? 'messenger-splitter resizing' : 'messenger-splitter'} onMouseDown={(event) => { event.preventDefault(); setResizing(true); }} /> : null}

        <section className={`${selectedGroup ? 'messenger-chat-panel group-mode' : 'messenger-chat-panel'}${showCallStage ? ' has-call-stage' : ''}${showCallStage && callChatCollapsed ? ' call-chat-collapsed' : ''}`}>
          {selectedGroup ? (
            <GroupChatView token={token} language={language} currentUser={currentUser} group={selectedGroup} onlineUserIds={onlineUserIds}
              voiceRoom={voiceRoom}
              onClose={() => { setSelectedGroup(null); setActiveView('directMessages'); setSelectedUser(null); setMessages([]); }}
              onViewProfile={(user, group, preload) => { setProfileUser(user); setProfileGroup(group); setProfilePreload(preload); }}
              onViewDesktop={onViewDesktop}
              onGroupJoin={(group) => setGroups((prev) => prev.find((g) => g.id === group.id) ? prev : [...prev, group])}
              memberGroupIds={new Set(groups.map((g) => g.id))}
              onGroupNavigate={(groupId) => { setSelectedGroup(groups.find((x) => x.id === groupId) ?? groupConversations.find((x) => x.group.id === groupId)?.group ?? null); }}
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
          ) : selectedUser ? (
            <>
              <header className="messenger-chat-header" onContextMenu={(event) => openUserMenu(event, selectedUser)}>
                <span className="messenger-avatar-wrap large" style={{ cursor: 'pointer' }} onClick={() => setProfileUser(selectedUser)}>
                  <img src={selectedUser.avatarData} alt="" draggable={false} />
                  <i className={isOnline(selectedUser) ? 'presence-dot online' : 'presence-dot'} />
                </span>
                <div>
                  <p className="eyebrow">{selectedIsFriend ? t(language, 'friends') : t(language, 'searchPeople')}</p>
                  <h3>{selectedUser.nickname}</h3>
                  <small>{selectedTyping ? t(language, 'typing', { name: selectedUser.nickname }) : isOnline(selectedUser) ? t(language, 'online') : t(language, 'offline')}</small>
                </div>

                <div className="messenger-chat-header-actions">
                  {showCallStage ? null : (
                  <button
                    className="messenger-call-button"
                    type="button"
                    title={t(language, 'startCall')}
                    disabled={voiceCall.phase !== 'idle' || !isOnline(selectedUser)}
                    onClick={(event) => { event.stopPropagation(); void voiceCall.startCall(selectedUser); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.2 2.2z"/></svg>
                  </button>
                  )}
                </div>
              </header>

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

              <div className="messenger-thread-wrap chat-enlarged">
                {(() => {
                  const pinned = messages
                    .filter((m) => m.pinnedAt && !m.deletedAt)
                    .sort((a, b) => new Date(b.pinnedAt!).getTime() - new Date(a.pinnedAt!).getTime());
                  if (pinned.length === 0) return null;
                  const current = pinned[Math.min(pinCursor, pinned.length - 1)] ?? pinned[0];
                  const sender = current.senderId === currentUser.id ? currentUser : selectedUser;
                  const senderName = sender?.nickname ?? '';
                  return (
                    <div className="messenger-pinned" onClick={(e) => {
                      e.stopPropagation();
                      const el = document.getElementById('msg-' + current.id);
                      if (el && threadRef.current) {
                        const node = threadRef.current;
                        const tRect = node.getBoundingClientRect();
                        const elRect = el.getBoundingClientRect();
                        node.scrollBy({ top: elRect.top - tRect.top - 80, behavior: 'smooth' });
                      }
                      // Advance to the next pin so repeated clicks cycle through all of them.
                      setPinCursor((prev) => (prev + 1) % pinned.length);
                    }}>
                      <div className="messenger-pinned-header">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                        <span>{pinned.length} {t(language, 'pinnedMessages')}</span>
                      </div>
                      <div key={current.id} className="messenger-pinned-message">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                        {sender ? <UserName user={sender} as="strong" /> : <strong>{senderName}</strong>}
                        <span>{current.body || (current.imageData ? '📷' : '')}</span>
                      </div>
                    </div>
                  );
                })()}
                <div ref={threadRef} className="messenger-thread">
                  {messages.length === 0 ? <div className="explorer-empty">{t(language, 'noMessages')}</div> : null}
                {messages.map((message, index) => {
                  const callLabel = callMessageLabel(message, currentUser.id, language);
                  const spoilerHidden = Boolean(message.imageData && message.imageSpoiler && !revealedSpoilers.includes(message.id));
                  const showDateDivider = shouldShowDateDivider(message.createdAt, index === 0 ? null : messages[index - 1].createdAt);
                  const isStartOfGroup = showDateDivider || index === 0 || messages[index - 1].senderId !== message.senderId || (new Date(message.createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime() > 120000);
                  const bubbleClasses = [
                    'message-bubble',
                    isStartOfGroup ? 'message-group-start' : '',
                    message.senderId === currentUser.id ? 'mine' : '',
                    message.imageData ? 'has-image' : '',
                    message.imageData && !message.body ? 'image-only' : '',
                    message.pinnedAt ? 'pinned' : ''
                  ].filter(Boolean).join(' ');
                  const senderUser = message.senderId === currentUser.id ? currentUser : selectedUser;
                  const senderAvatar = message.senderId === currentUser.id ? currentUser.avatarData : (selectedUser?.avatarData ?? '');
                  const senderName = message.senderId === currentUser.id ? currentUser.nickname : (selectedUser?.nickname ?? '');

                  return (
                    <Fragment key={message.id}>
                    {showDateDivider ? (
                      <div className="message-date-divider"><span>{formatMessageDate(message.createdAt, language)}</span></div>
                    ) : null}
                    <article
                      className={bubbleClasses}
                      id={'msg-' + message.id}
                      data-time={formatMessageTime(message.createdAt, language)}
                      onContextMenu={(event) => {
                        if (message.deletedAt) return;
                        event.preventDefault();
                        setMessageMenu({
                          x: Math.min(event.clientX, window.innerWidth - 180),
                          y: Math.min(event.clientY, window.innerHeight - 120),
                          message
                        });
                      }}
                    >
                      <img className="message-avatar" src={senderAvatar} alt="" draggable={false} style={{ cursor: 'pointer' }} onClick={() => setProfileUser(message.senderId === currentUser.id ? currentUser : selectedUser!)} />
                      <div className="message-body">
                        {isStartOfGroup ? (
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
                            {message.imageData ? (
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
                                }}
                              >
                                <img src={message.imageData} alt={message.imageName ?? ''} onLoad={() => {
                                  const thread = threadRef.current;
                                  if (thread) thread.scrollTop = thread.scrollHeight;
                                }} />
                                {spoilerHidden ? <span>{t(language, 'spoiler')}</span> : null}
                              </button>
                            ) : null}
                            {callLabel ? (
                              <p className="message-text call-log-message"><Twemoji emoji="📞" /> {callLabel}</p>
                            ) : message.body ? (
                              <>
                                <p className="message-text"><MessageText text={message.body ?? ''} /></p>
                                {(() => {
                                  const inviteCode = extractInviteCode(message.body);
                                  return inviteCode ? <InviteEmbed token={token} language={language} inviteCode={inviteCode} currentUserId={currentUser.id} memberGroupIds={new Set(groups.map((g) => g.id))} onJoined={(group) => setGroups((prev) => prev.find((g) => g.id === group.id) ? prev : [...prev, group])} onNavigate={(groupId) => { const g = groups.find((x) => x.id === groupId) ?? groupConversations.find((x) => x.group.id === groupId)?.group; if (g) { setSelectedGroup(g); setSelectedUser(null); setMessages([]); } }} /> : null;
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
                                      onOpenProfile={(u) => setProfileUser(u)}
                                      onOpenDesktop={onViewDesktop}
                                      onEditProfile={onEditProfile}
                                    />
                                  ) : null;
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

              {messageMenu ? createPortal(
                <div className="context-menu messenger-message-menu" style={{ left: messageMenu.x, top: messageMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" onClick={() => {
                    if (messageMenu.message.pinnedAt) {
                      void pinMessage(messageMenu.message);
                      setMessageMenu(null);
                    } else {
                      setPinConfirm(messageMenu.message);
                      setMessageMenu(null);
                    }
                  }}>
                    {messageMenu.message.pinnedAt ? t(language, 'unpin') : t(language, 'pinMessage')}
                  </button>
                  {canEditMessage(messageMenu.message) ? <button type="button" onClick={() => void editMessage(messageMenu.message)}>{t(language, 'editMessage')}</button> : null}
                  {messageMenu.message.senderId === currentUser.id ? <button className="danger-text" type="button" onClick={() => { setDeleteConfirm(messageMenu.message); setMessageMenu(null); }}>{t(language, 'deleteMessage')}</button> : null}
                </div>,
                document.body
              ) : null}

              <form
                className="messenger-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
              >
                {editingMessage ? (
                  <div className="messenger-edit-preview">
                    <img src={currentUser.avatarData} alt="" />
                    <div>
                      <strong>{currentUser.nickname}</strong>
                      <time>{formatMessageTime(editingMessage.createdAt, language)}</time>
                      <p>{editingMessage.body}</p>
                    </div>
                    <button type="button" onClick={() => {
                      setEditingMessage(null);
                      setMessageDraft('');
                    }}>
                      {t(language, 'cancel')}
                    </button>
                  </div>
                ) : null}
                <input ref={imageFileInputRef} className="hidden-file" type="file" accept="image/*"
                  onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void prepareImageFromFile(file); }} />
                <div className="emoji-input-shell messenger-emoji-input">
                  <button className="emoji-toggle inline messenger-attach-inline" type="button" aria-label={t(language, 'imageMessage')}
                    disabled={Boolean(editingMessage)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); imageFileInputRef.current?.click(); }}>
                    <AttachIcon />
                  </button>
                  <input ref={messageInputRef} className="emoji-inline-input messenger-input" value={messageDraft} placeholder={t(language, 'messagePlaceholder')} onChange={(event) => updateMessageDraft(event.target.value)} />
                  <div ref={messageEmojiAnchorRef} className="emoji-host inline">
                    <button
                      className="emoji-toggle inline"
                      type="button"
                      aria-label={t(language, 'emoji')}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEmojiOpen((value) => !value);
                      }}
                    >
                      <EmojiToggleIcon />
                    </button>
                    {emojiOpen ? <EmojiPicker language={language} enlarged anchorRef={messageEmojiAnchorRef} placement="top-end" onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} /> : null}
                  </div>
                </div>
                {/* Submit on Enter; the hidden submit input keeps form submission working without a send button. */}
                <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
              </form>

              {pendingImage ? (
                <div className="messenger-image-draft-backdrop" onMouseDown={(event) => event.stopPropagation()}>
                  <form
                    className="messenger-image-draft-card"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendMessage();
                    }}
                  >
                    <img src={pendingImage.dataUrl} alt={pendingImage.name} />
                    <label className="spoiler-toggle">
                      <input type="checkbox" checked={pendingImage.spoiler} onChange={(event) => setPendingImage((current) => (current ? { ...current, spoiler: event.target.checked } : current))} />
                      <span>{t(language, 'spoiler')}</span>
                    </label>
                    <div className="emoji-input-shell image-caption-input">
                      <input ref={imageCaptionInputRef} className="emoji-inline-input" value={imageCaptionDraft} placeholder={t(language, 'imageCaptionPlaceholder')} onChange={(event) => setImageCaptionDraft(event.target.value)} />
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
          ) : (
            <div className="messenger-empty-state">
              <div className="messenger-orb">M</div>
              <p className="eyebrow">{t(language, 'directMessages')}</p>
              <h3>{t(language, 'selectUserToMessage')}</h3>
            </div>
          )}
        </section>

        {userMenu ? createPortal(
          <div className="context-menu messenger-user-menu" style={{ left: userMenu.x, top: userMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => {
              setProfileUser(userMenu.user);
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
            language={language}
            token={token}
            zIndex={zIndex + 100}
            onClose={() => { setProfileUser(null); setProfileGroup(undefined); setProfilePreload(undefined); }}
            onUserChange={onUserChange}
            onOpenChat={(userId) => {
              const conversation = conversations.find((c) => c.user.id === userId);
              if (conversation) {
                void chooseUser(conversation.user);
                return;
              }
              const friend = friends.find((f) => f.id === userId);
              if (friend) void chooseUser(friend);
            }}
            onOpenDesktop={onViewDesktop}
            onOpenProfile={(nextUser) => { setProfileUser(nextUser); setProfilePreload(undefined); }}
            onOpenGroup={(group) => {
              setProfileUser(null);
              setProfileGroup(undefined);
              setProfilePreload(undefined);
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
            <div className="profile-modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
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
                {deleteConfirm.imageData ? (
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
      <EmojiTooltipPortal />
      {voiceCall.phase === 'incoming' || ((voiceCall.phase === 'outgoing' || voiceCall.phase === 'connecting') && !callConnectedActive) ? (
        <CallInviteModal call={voiceCall} language={language} />
      ) : null}
      <ScreenSourcePicker call={voiceCall} language={language} />
      <CallAudioSink call={voiceCall} />
      {/* Multi-party voice: play remote audio. The connected UI lives inside the
          group chat (VoiceStage), mirroring the 1:1 call experience. */}
      <VoiceAudioSink streams={voiceRoom.remoteStreams} />
    </WindowFrame>
  );
}
