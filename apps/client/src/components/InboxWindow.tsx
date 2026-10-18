import { Fragment, useEffect, useMemo, useState, type Dispatch, type MouseEvent, type ReactNode, type SetStateAction } from 'react';
import { api } from '../api/client';
import type { DesktopWallMessage, FriendRequests, FriendRequestUser, Language, MentionNotification, PublicUser } from '../api/types';
import { useSocket } from '../hooks/use-socket';
import { MessageBody, MessagePreviewText } from './Twemoji';
import { UserName } from './UserName';
import { WindowFrame } from './WindowFrame';
import { isVideoCircleAttachment, isVoiceAttachment, VideoCircleMessagePlayer, VoiceMessagePlayer } from './VoiceMessage';
import { LOCALES } from '../i18n';

type InboxTab = 'all' | 'friendRequests' | 'desktopWall' | 'mentions';
type InboxItem =
  | { id: string; kind: 'friendRequest'; user: FriendRequestUser; createdAt: string; unread: boolean }
  | { id: string; kind: 'desktopWall'; message: DesktopWallMessage; createdAt: string; unread: boolean }
  | { id: string; kind: 'mention'; mention: MentionNotification; createdAt: string; unread: boolean };

type AnchorRect = { left: number; top: number; right: number; bottom: number };

type InboxWindowProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  minimized?: boolean;
  maximized: boolean;
  zIndex: number;
  readIds: Set<string>;
  initialRequests?: FriendRequests;
  initialWallMessages?: DesktopWallMessage[];
  mentionItems?: MentionNotification[];
  initialLoading?: boolean;
  onReadIdsChange: Dispatch<SetStateAction<Set<string>>>;
  onUnreadCountChange?: (count: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onOpenProfile: (user: PublicUser, anchorRect?: AnchorRect | null) => void;
  onOpenMention?: (mention: MentionNotification) => void;
};

const EMPTY_REQUESTS: FriendRequests = { incoming: [], outgoing: [] };

function inboxCopy(language: Language) {
  if (language === 'ru') {
    return {
      title: 'Почта',
      subtitle: 'Входящие уведомления NotOC',
      all: 'Все',
      friendRequests: 'Запросы в друзья',
      desktopWall: 'Стена рабочего стола',
      inbox: 'Входящие',
      noItems: 'Пока нет писем',
      noItemsHint: 'Здесь появятся заявки в друзья и новые записи на вашей стене.',
      requestTitle: 'Новая заявка в друзья',
      wallTitle: 'Новая запись на стене',
      requestPreview: 'хочет добавить вас в друзья.',
      wallPreview: 'оставил сообщение на вашей стене.',
      accept: 'Принять',
      decline: 'Отклонить',
      openProfile: 'Профиль',
      openDesktop: 'Рабочий стол',
      incoming: 'Входящее',
      markAllRead: 'Прочитано',
      unread: 'Новое'
    };
  }
  if (language === 'uk') {
    return {
      title: 'Пошта',
      subtitle: 'Вхідні сповіщення NotOC',
      all: 'Усе',
      friendRequests: 'Запити в друзі',
      desktopWall: 'Стіна робочого стола',
      inbox: 'Вхідні',
      noItems: 'Поки немає листів',
      noItemsHint: 'Тут зʼявляться запити в друзі та нові записи на вашій стіні.',
      requestTitle: 'Новий запит у друзі',
      wallTitle: 'Новий запис на стіні',
      requestPreview: 'хоче додати вас у друзі.',
      wallPreview: 'залишив повідомлення на вашій стіні.',
      accept: 'Прийняти',
      decline: 'Відхилити',
      openProfile: 'Профіль',
      openDesktop: 'Робочий стіл',
      incoming: 'Вхідне',
      markAllRead: 'Прочитано',
      unread: 'Нове'
    };
  }
  if (language === 'zh') {
    return {
      title: '收件箱',
      subtitle: 'NotOC 通知收件箱',
      all: '全部',
      friendRequests: '好友请求',
      desktopWall: '桌面墙',
      inbox: '收件箱',
      noItems: '还没有邮件',
      noItemsHint: '好友请求和桌面墙上的新内容会显示在这里。',
      requestTitle: '新的好友请求',
      wallTitle: '墙上的新内容',
      requestPreview: '想加你为好友。',
      wallPreview: '在你的墙上留了言。',
      accept: '接受',
      decline: '拒绝',
      openProfile: '资料',
      openDesktop: '桌面',
      incoming: '收到',
      markAllRead: '标为已读',
      unread: '新'
    };
  }
  if (language === 'zh-TW') {
    return {
      title: '收件匣',
      subtitle: 'NotOC 通知收件匣',
      all: '全部',
      friendRequests: '好友請求',
      desktopWall: '桌面牆',
      inbox: '收件匣',
      noItems: '尚無郵件',
      noItemsHint: '好友請求和桌面牆上的新內容會顯示在這裡。',
      requestTitle: '新的好友請求',
      wallTitle: '牆上的新內容',
      requestPreview: '想加你為好友。',
      wallPreview: '在你的牆上留了言。',
      accept: '接受',
      decline: '拒絕',
      openProfile: '個人檔案',
      openDesktop: '桌面',
      incoming: '收到',
      markAllRead: '標為已讀',
      unread: '新'
    };
  }
  return {
    title: 'Mail',
    subtitle: 'NotOC notification inbox',
    all: 'All',
    friendRequests: 'Friend requests',
    desktopWall: 'Desktop wall',
    inbox: 'Inbox',
    noItems: 'No mail yet',
    noItemsHint: 'Friend requests and new desktop wall posts will appear here.',
    requestTitle: 'New friend request',
    wallTitle: 'New wall post',
    requestPreview: 'wants to add you as a friend.',
    wallPreview: 'left a message on your wall.',
    accept: 'Accept',
    decline: 'Decline',
    openProfile: 'Profile',
    openDesktop: 'Desktop',
    incoming: 'Incoming',
    markAllRead: 'Mark read',
    unread: 'New'
  };
}

function formatInboxTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function mentionCopy(language: Language) {
  if (language === 'ru') {
    return { folder: 'Упоминания', title: 'Вас упомянули', preview: 'упомянул вас в чате.', openChat: 'Открыть чат', image: 'Изображение' };
  }
  if (language === 'uk') {
    return { folder: 'Згадки', title: 'Вас згадали', preview: 'згадав вас у чаті.', openChat: 'Відкрити чат', image: 'Зображення' };
  }
  if (language === 'zh') {
    return { folder: '提及', title: '有人提及了你', preview: '在聊天中提及了你。', openChat: '打开聊天', image: '图片' };
  }
  if (language === 'zh-TW') {
    return { folder: '提及', title: '有人提及了你', preview: '在聊天中提及了你。', openChat: '開啟聊天', image: '圖片' };
  }
  return { folder: 'Mentions', title: 'You were mentioned', preview: 'mentioned you in chat.', openChat: 'Open chat', image: 'Image' };
}

function itemSender(item: InboxItem) {
  if (item.kind === 'friendRequest') return item.user;
  if (item.kind === 'mention') return item.mention.sender;
  return item.message.author;
}

function itemTitle(item: InboxItem, copy: ReturnType<typeof inboxCopy>, mentionLabels: ReturnType<typeof mentionCopy>) {
  if (item.kind === 'friendRequest') return copy.requestTitle;
  if (item.kind === 'mention') return item.mention.kind === 'group' && item.mention.group ? `${mentionLabels.title}: ${item.mention.group.name}` : mentionLabels.title;
  return copy.wallTitle;
}

function itemKey(item: InboxItem) {
  return item.kind === 'friendRequest' ? `${item.kind}:${item.id}:${item.createdAt}` : `${item.kind}:${item.id}`;
}

function tabMatchesItem(tab: InboxTab, item: InboxItem) {
  if (tab === 'all') return true;
  return tab === 'friendRequests' ? item.kind === 'friendRequest' : item.kind === tab;
}

export function InboxWindow({
  token,
  language,
  currentUser,
  minimized = false,
  maximized,
  zIndex,
  readIds,
  initialRequests,
  initialWallMessages,
  mentionItems = [],
  initialLoading = true,
  onReadIdsChange,
  onUnreadCountChange,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onOpenProfile,
  onOpenMention
}: InboxWindowProps) {
  const copy = inboxCopy(language);
  const mentionLabels = mentionCopy(language);
  const [tab, setTab] = useState<InboxTab>('all');
  const [requests, setRequests] = useState<FriendRequests>(initialRequests ?? EMPTY_REQUESTS);
  const [wallMessages, setWallMessages] = useState<DesktopWallMessage[]>(initialWallMessages ?? []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialLoading);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const socket = useSocket();

  useEffect(() => {
    if (initialRequests) setRequests(initialRequests);
  }, [initialRequests]);

  useEffect(() => {
    if (initialWallMessages) setWallMessages(initialWallMessages);
  }, [initialWallMessages]);

  useEffect(() => {
    setLoading(initialLoading);
  }, [initialLoading]);

  useEffect(() => {
    let cancelled = false;
    if (!initialRequests && !initialWallMessages) setLoading(true);
    Promise.all([
      api.getFriendRequests(token),
      api.getDesktopWall(token, currentUser.id, { limit: 40 })
    ])
      .then(([requestPayload, wallPayload]) => {
        if (cancelled) return;
        setRequests(requestPayload.requests);
        setWallMessages(wallPayload.messages.filter((message) => message.author.id !== currentUser.id));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, currentUser.id]);

  useEffect(() => {
    if (!socket) return;

    function onWallCreated(payload: { ownerId: string; message: DesktopWallMessage }) {
      if (payload.ownerId !== currentUser.id || payload.message.author.id === currentUser.id) return;
      setWallMessages((current) => (
        current.some((message) => message.id === payload.message.id)
          ? current
          : [payload.message, ...current].slice(0, 40)
      ));
    }

    function onWallDeleted(payload: { ownerId: string; messageId: string }) {
      if (payload.ownerId !== currentUser.id) return;
      setWallMessages((current) => current.filter((message) => message.id !== payload.messageId));
    }

    function onFriendsChanged(payload: { requests: FriendRequests }) {
      setRequests(payload.requests);
    }

    socket.on('desktopWall:messageCreated', onWallCreated);
    socket.on('desktopWall:messageDeleted', onWallDeleted);
    socket.on('messenger:friendsChanged', onFriendsChanged);

    return () => {
      socket.off('desktopWall:messageCreated', onWallCreated);
      socket.off('desktopWall:messageDeleted', onWallDeleted);
      socket.off('messenger:friendsChanged', onFriendsChanged);
    };
  }, [currentUser.id, socket]);

  const items = useMemo<InboxItem[]>(() => {
    const requestItems = requests.incoming.map((user) => ({
      id: user.id,
      kind: 'friendRequest' as const,
      user,
      createdAt: user.requestCreatedAt ?? user.createdAt,
      unread: !readIds.has(`friendRequest:${user.id}:${user.requestCreatedAt ?? user.createdAt}`)
    }));
    const wallItems = wallMessages.map((message) => ({
      id: message.id,
      kind: 'desktopWall' as const,
      message,
      createdAt: message.createdAt,
      unread: !readIds.has(`desktopWall:${message.id}`)
    }));
    const mentionInboxItems = mentionItems.map((mention) => ({
      id: mention.id,
      kind: 'mention' as const,
      mention,
      createdAt: mention.createdAt,
      unread: !readIds.has(`mention:${mention.id}`)
    }));
    return [...requestItems, ...wallItems, ...mentionInboxItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [mentionItems, readIds, requests.incoming, wallMessages]);

  const filteredItems = items.filter((item) => tabMatchesItem(tab, item));
  const selectedItem = selectedKey ? filteredItems.find((item) => itemKey(item) === selectedKey) ?? null : null;
  const selectedSender = selectedItem ? itemSender(selectedItem) : null;
  const selectedIndex = selectedItem ? filteredItems.findIndex((item) => itemKey(item) === itemKey(selectedItem)) : -1;
  const canGoBack = selectedIndex > 0;
  const canGoForward = selectedIndex >= 0 && selectedIndex < filteredItems.length - 1;
  const unreadCount = items.filter((item) => item.unread).length;

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!selectedItem) return;
    const key = itemKey(selectedItem);
    onReadIdsChange((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, [onReadIdsChange, selectedItem]);

  async function handleAccept(userId: string) {
    setActionBusy(userId);
    try {
      const payload = await api.acceptFriendRequest(token, userId);
      setRequests(payload.requests);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDecline(userId: string) {
    setActionBusy(userId);
    try {
      const payload = await api.deleteFriendRequest(token, userId);
      setRequests(payload.requests);
    } finally {
      setActionBusy(null);
    }
  }

  function markAllRead() {
    onReadIdsChange((current) => {
      const next = new Set(current);
      for (const item of items) next.add(itemKey(item));
      return next;
    });
  }

  function moveSelection(delta: -1 | 1) {
    if (selectedIndex < 0) return;
    const nextItem = filteredItems[selectedIndex + delta];
    if (nextItem) setSelectedKey(itemKey(nextItem));
  }

  function openSenderProfile(user: PublicUser, event: MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenProfile(user, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }

  return (
    <WindowFrame
      language={language}
      title={copy.title}
      titleContent={(
        <div className="messenger-title-nav" aria-label={copy.title}>
          <button
            type="button"
            className="messenger-title-nav-button"
            aria-label="Back"
            disabled={!canGoBack}
            onClick={() => moveSelection(-1)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="messenger-title-nav-button"
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={() => moveSelection(1)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}
      centerTitle={<span>{copy.title}</span>}
      className="inbox-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 440), y: 78 }}
      storageKey="inbox"
      minSize={{ width: 760, height: 520 }}
      defaultSize={{ width: 980, height: 660 }}
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="inbox-shell">
        <aside className="inbox-sidebar">
          <div className="inbox-sidebar-label">{copy.inbox}</div>
          {([
            ['all', copy.all, items.length, (
              <svg key="all" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
            )],
            ['friendRequests', copy.friendRequests, requests.incoming.length, (
              <svg key="fr" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
            )],
            ['desktopWall', copy.desktopWall, wallMessages.length, (
              <svg key="wall" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10h8M8 14h5"/></svg>
            )],
            ['mentions', mentionLabels.folder, mentionItems.length, (
              <svg key="at" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>
            )]
          ] as Array<[InboxTab, string, number, ReactNode]>).map(([id, label, count, icon]) => (
            <button key={id} type="button" className={tab === id ? 'inbox-folder active' : 'inbox-folder'} onClick={() => { setTab(id); setSelectedKey(null); }}>
              <span className="inbox-folder-main">
                <span className="inbox-folder-icon">{icon}</span>
                <span>{label}</span>
              </span>
              {count > 0 ? <b>{count}</b> : null}
            </button>
          ))}
        </aside>

        {selectedItem && selectedSender ? (
          <section className="inbox-reading-pane">
            <article className="inbox-reading-message">
              <header className="inbox-reading-head">
                <button type="button" className="inbox-reading-back" aria-label="Back" onClick={() => setSelectedKey(null)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div>
                  <h3>{itemTitle(selectedItem, copy, mentionLabels)}</h3>
                  <time>{formatInboxTime(selectedItem.createdAt, language)}</time>
                </div>
                {selectedItem.unread ? <span>{copy.unread}</span> : null}
              </header>
              <div className="inbox-sender-card">
                <button type="button" className="inbox-sender-avatar" onClick={(event) => openSenderProfile(selectedSender, event)}>
                  <img src={selectedSender.avatarData} alt="" />
                </button>
                <div>
                  <UserName user={selectedSender} as="strong" />
                  <span>{selectedItem.kind === 'friendRequest' ? copy.requestPreview : selectedItem.kind === 'mention' ? mentionLabels.preview : copy.wallPreview}</span>
                </div>
              </div>
              <div className="inbox-reading-body">
                {selectedItem.kind === 'desktopWall' ? (
                  <div className="inbox-wall-body">
                    <MessageBody text={selectedItem.message.body} />
                  </div>
                ) : selectedItem.kind === 'mention' ? (
                  <div className="inbox-wall-body">
                    {selectedItem.mention.body ? <MessageBody text={selectedItem.mention.body} /> : null}
                    {selectedItem.mention.imageData && isVideoCircleAttachment(selectedItem.mention.imageData, selectedItem.mention.imageName) ? (
                      <VideoCircleMessagePlayer src={selectedItem.mention.imageData} />
                    ) : selectedItem.mention.imageData && isVoiceAttachment(selectedItem.mention.imageData, selectedItem.mention.imageName) ? (
                      <VoiceMessagePlayer src={selectedItem.mention.imageData} />
                    ) : selectedItem.mention.imageData ? (
                      <img className="inbox-mention-image" src={selectedItem.mention.imageData} alt={selectedItem.mention.imageName ?? mentionLabels.image} />
                    ) : null}
                  </div>
                ) : (
                  <div className="inbox-wall-body">
                    <UserName user={selectedItem.user} as="strong" /> <span>{copy.requestPreview}</span>
                  </div>
                )}
              </div>
              <div className="inbox-actions">
                {selectedItem.kind === 'friendRequest' ? (
                  <Fragment>
                    <button type="button" className="secondary-action" disabled={actionBusy === selectedItem.user.id} onClick={() => void handleDecline(selectedItem.user.id)}>{copy.decline}</button>
                    <button type="button" className="primary-action" disabled={actionBusy === selectedItem.user.id} onClick={() => void handleAccept(selectedItem.user.id)}>{copy.accept}</button>
                  </Fragment>
                ) : selectedItem.kind === 'mention' && onOpenMention ? (
                  <button type="button" className="primary-action" onClick={() => onOpenMention(selectedItem.mention)}>{mentionLabels.openChat}</button>
                ) : null}
              </div>
            </article>
          </section>
        ) : (
          <section className="inbox-list-pane">
            <header className="inbox-list-head">
              <div>
                <strong>{tab === 'all' ? copy.all : tab === 'friendRequests' ? copy.friendRequests : tab === 'mentions' ? mentionLabels.folder : copy.desktopWall}</strong>
                <span>{unreadCount ? `${unreadCount} ${copy.unread.toLowerCase()}` : copy.markAllRead}</span>
              </div>
              <button type="button" className="inbox-mark-read" onClick={markAllRead}>{copy.markAllRead}</button>
            </header>
            <div className="inbox-list">
              {loading ? <div className="inbox-empty">{copy.inbox}...</div> : null}
              {!loading && filteredItems.length === 0 ? (
                <div className="inbox-empty">
                  <span className="inbox-empty-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="2"/>
                      <path d="M3 7l9 6 9-6"/>
                    </svg>
                  </span>
                  <strong>{copy.noItems}</strong>
                  <span>{copy.noItemsHint}</span>
                </div>
              ) : null}
              {filteredItems.map((item) => {
                const sender = itemSender(item);
                return (
                  <article key={itemKey(item)} className={`inbox-message${item.unread ? ' unread' : ''}`}>
                    <button type="button" className="inbox-message-button" onClick={() => setSelectedKey(itemKey(item))}>
                      <img src={sender.avatarData} alt="" />
                      <div>
                        <span className="inbox-message-row">
                          <strong>{itemTitle(item, copy, mentionLabels)}</strong>
                          <time>{formatInboxTime(item.createdAt, language)}</time>
                        </span>
                        <span className="inbox-message-sender">{sender.nickname}</span>
                        <span className="inbox-message-preview">
                          {item.kind === 'friendRequest'
                            ? copy.requestPreview
                            : item.kind === 'mention'
                              ? <MessagePreviewText text={item.mention.body || (isVideoCircleAttachment(item.mention.imageData, item.mention.imageName) ? '📹' : isVoiceAttachment(item.mention.imageData, item.mention.imageName) ? '🎤' : item.mention.imageData ? mentionLabels.image : '')} size={15} />
                              : <MessagePreviewText text={item.message.body} size={15} />}
                        </span>
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </WindowFrame>
  );
}
