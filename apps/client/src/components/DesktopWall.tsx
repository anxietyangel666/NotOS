import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { cacheUser } from '../api/user-cache';
import { useSocket } from '../hooks/use-socket';
import { useAnchoredMenu } from '../hooks/use-anchored-menu';
import type { DesktopWallMessage, Language, PublicUser } from '../api/types';
import { LOCALES, t, getSavedTimeFormat, getSavedTranslateTargetName } from '../i18n';
import { EmojiPicker } from './EmojiPicker';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { EmojiToggleIcon } from './ChatComposeIcons';
import { MessageBody } from './Twemoji';
import { expandCustomEmojiShortcodes, extractSharedPack, stripPackLinks, hasPackLink, splitCustomEmoji } from '../utils/custom-emoji';
import { isMediaUrl } from '../utils/media-url';
import { extractGroupInviteCode } from '../utils/group-invite-link';
import { extractProfileUserId } from '../utils/profile-link';
import { extractWatchInvite } from '../utils/watch-invite-link';
import { CustomEmojiPackEmbed } from './CustomEmojiPackEmbed';
import { MenuCopyIcon, MenuTranslateIcon, MenuDeleteIcon } from './MessageActions';
import { UserName } from './UserName';

type DesktopWallProps = {
  token: string;
  language: Language;
  owner: PublicUser;
  currentUser: PublicUser;
  onOpenProfile?: (user: PublicUser, anchorRect?: { left: number; top: number; right: number; bottom: number } | null) => void;
};

const WALL_CACHE_TTL_MS = 45_000;
const wallCache = new Map<string, { messages: DesktopWallMessage[]; hasMore: boolean; loadedAt: number }>();

// Disk snapshot of the wall so a cold app start paints instantly and
// revalidates in the background (loadedAt: 0 marks the entry as stale).
const WALL_STORAGE_PREFIX = 'notoc.wallCache.';
const WALL_STORAGE_MAX_BYTES = 300_000;

function hydrateWallCache(ownerId: string) {
  const inMemory = wallCache.get(ownerId);
  if (inMemory) return inMemory;
  try {
    const raw = localStorage.getItem(WALL_STORAGE_PREFIX + ownerId);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { messages: DesktopWallMessage[]; hasMore: boolean };
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      const entry = { messages: data.messages, hasMore: Boolean(data.hasMore), loadedAt: 0 };
      wallCache.set(ownerId, entry);
      return entry;
    }
  } catch { /* corrupt snapshot */ }
  return undefined;
}

function persistWallCache(ownerId: string) {
  const entry = wallCache.get(ownerId);
  if (!entry || entry.messages.length === 0) return;
  try {
    const payload = JSON.stringify({ messages: entry.messages.slice(0, 12), hasMore: entry.hasMore });
    if (payload.length <= WALL_STORAGE_MAX_BYTES) {
      localStorage.setItem(WALL_STORAGE_PREFIX + ownerId, payload);
    }
  } catch { /* quota exceeded */ }
}
const WALL_URL_RE = /https?:\/\/[^\s<>"')]+/gi;

function formatWallTime(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(new Date(value));
}

function containsWallEmbed(text: string) {
  if (hasPackLink(text) || extractGroupInviteCode(text) || extractProfileUserId(text) || extractWatchInvite(text)) return true;
  return splitCustomEmoji(text).some((part) => {
    if (part.type !== 'text') return false;
    WALL_URL_RE.lastIndex = 0;
    return Array.from(part.value.matchAll(WALL_URL_RE), (match) => match[0].replace(/[),.;!?]+$/g, '')).some(isMediaUrl);
  });
}

export function DesktopWall({ token, language, owner, currentUser, onOpenProfile }: DesktopWallProps) {
  const sharedSocket = useSocket();
  const wallRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<EmojiInlineInputHandle | null>(null);
  const cachedWall = hydrateWallCache(owner.id);
  const [messages, setMessages] = useState<DesktopWallMessage[]>(() => cachedWall?.messages ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(`notoc.wall.collapsed.${owner.id}`) === '1');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const draftContainsEmbed = draft.trim() ? containsWallEmbed(expandCustomEmojiShortcodes(draft.trim())) : false;
  // Lazy loading: whether an older page exists, plus a guard so scrolling only
  // fires one "load older" request at a time.
  const [hasMore, setHasMore] = useState(() => cachedWall?.hasMore ?? false);
  const hasMoreRef = useRef(hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  // Right-click context menu for a wall message (Copy / Translate / Delete).
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: DesktopWallMessage } | null>(null);
  const messageMenuRef = useRef<HTMLDivElement | null>(null);
  const messageMenuPos = useAnchoredMenu(messageMenu ? { x: messageMenu.x, y: messageMenu.y } : null, messageMenuRef);
  // Ephemeral per-message translations, keyed by message id (reset on close).
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());

  // Close the message menu on any outside mousedown.
  useEffect(() => {
    if (!messageMenu) return;
    function onDown(event: globalThis.MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.('.context-menu')) return;
      setMessageMenu(null);
    }
    const raf = window.requestAnimationFrame(() => window.addEventListener('mousedown', onDown));
    return () => { window.cancelAnimationFrame(raf); window.removeEventListener('mousedown', onDown); };
  }, [messageMenu]);

  // Copy a wall message's readable text to the clipboard.
  async function copyMessageText(message: DesktopWallMessage) {
    setMessageMenu(null);
    const raw = message.body ?? '';
    const text = hasPackLink(raw) ? stripPackLinks(raw) : raw;
    if (!text.trim()) return;
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
  }

  // Translate a wall message in place (toggle: re-running shows the original).
  async function translateMessage(message: DesktopWallMessage) {
    setMessageMenu(null);
    if (translations[message.id]) {
      setTranslations((current) => { const next = { ...current }; delete next[message.id]; return next; });
      return;
    }
    const raw = message.body ?? '';
    const source = hasPackLink(raw) ? stripPackLinks(raw) : raw;
    if (!source.trim() || translatingIds.has(message.id)) return;
    setTranslatingIds((current) => new Set(current).add(message.id));
    try {
      const { text } = await api.translateText(token, source, getSavedTranslateTargetName());
      setTranslations((current) => ({ ...current, [message.id]: text }));
    } catch {
      // Leave the original text on failure.
    } finally {
      setTranslatingIds((current) => { const next = new Set(current); next.delete(message.id); return next; });
    }
  }

  function upsertMessage(message: DesktopWallMessage) {
    setMessages((current) => {
      const next = [message, ...current.filter((item) => item.id !== message.id)];
      wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
      persistWallCache(owner.id);
      return next;
    });
  }

  useEffect(() => {
    localStorage.setItem(`notoc.wall.collapsed.${owner.id}`, collapsed ? '1' : '0');
  }, [collapsed, owner.id]);

  useEffect(() => {
    let alive = true;
    const cached = hydrateWallCache(owner.id);
    if (cached) {
      setMessages(cached.messages);
      setHasMore(cached.hasMore);
      hasMoreRef.current = cached.hasMore;
    } else {
      setMessages([]);
      setHasMore(false);
      hasMoreRef.current = false;
    }

    if (!collapsed && (!cached || Date.now() - cached.loadedAt > WALL_CACHE_TTL_MS)) {
      api
        .getDesktopWall(token, owner.id, { limit: 12 })
        .then((payload) => {
          if (!alive) return;
          wallCache.set(owner.id, { messages: payload.messages, hasMore: payload.hasMore, loadedAt: Date.now() });
          persistWallCache(owner.id);
          setMessages(payload.messages);
          setHasMore(payload.hasMore);
          hasMoreRef.current = payload.hasMore;
        })
        .catch((loadError) => {
          if (alive) setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
        });
    }

    const socket = sharedSocket;
    if (!socket) return () => { alive = false; };

    function onMessageCreated(payload: { ownerId: string; message: DesktopWallMessage }) {
      if (payload.ownerId !== owner.id) return;
      const msg = payload.message;
      setMessages((current) => {
        if (current.some((m) => m.id === msg.id)) return current;
        const pendingIdx = current.findIndex((m) => (m.clientKey && m.author.id === msg.author.id && m.body === msg.body) || m.id === msg.id);
        let next: DesktopWallMessage[];
        if (pendingIdx !== -1) {
          next = current.slice();
          next[pendingIdx] = { ...msg, clientKey: current[pendingIdx].clientKey };
        } else {
          next = [msg, ...current];
        }
        wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
        persistWallCache(owner.id);
        return next;
      });
    }

    function onMessageDeleted(payload: { ownerId: string; messageId: string }) {
      if (payload.ownerId !== owner.id) return;
      setMessages((current) => {
        const next = current.filter((message) => message.id !== payload.messageId);
        wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
        persistWallCache(owner.id);
        return next;
      });
    }

    function onUserChanged(payload: { user: PublicUser }) {
      cacheUser(payload.user);
      setMessages((current) => current.map((message) => (message.author.id === payload.user.id ? { ...message, author: payload.user } : message)));
    }

    socket.on('desktopWall:messageCreated', onMessageCreated);
    socket.on('desktopWall:messageDeleted', onMessageDeleted);
    socket.on('desktop:userChanged', onUserChanged);

    return () => {
      alive = false;
      socket.off('desktopWall:messageCreated', onMessageCreated);
      socket.off('desktopWall:messageDeleted', onMessageDeleted);
      socket.off('desktop:userChanged', onUserChanged);
    };
  }, [collapsed, language, owner.id, sharedSocket, token]);

  // Load the next (older) page of wall messages and append them to the bottom
  // of the list. The oldest currently-loaded message id is the cursor.
  async function loadMore() {
    if (loadingMoreRef.current || !hasMore) return;
    const oldest = messages[messages.length - 1];
    if (!oldest) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const payload = await api.getDesktopWall(token, owner.id, { before: oldest.id, limit: 12 });
      setMessages((current) => {
        const seen = new Set(current.map((item) => item.id));
        const next = [...current, ...payload.messages.filter((item) => !seen.has(item.id))];
        wallCache.set(owner.id, { messages: next, hasMore: payload.hasMore, loadedAt: Date.now() });
        persistWallCache(owner.id);
        return next;
      });
      setHasMore(payload.hasMore);
      hasMoreRef.current = payload.hasMore;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }

  async function publishMessage() {
    const body = expandCustomEmojiShortcodes(draft.trim());
    if (!body) return;
    if (containsWallEmbed(body)) {
      setError(t(language, 'wallEmbedsNotAllowed'));
      return;
    }

    setDraft('');
    setError('');

    // Optimistic render: show the post instantly with a stable clientKey
    const clientKey = `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: DesktopWallMessage = {
      id: clientKey,
      ownerId: owner.id,
      author: currentUser,
      body,
      createdAt: new Date().toISOString(),
      clientKey,
      pending: false
    };

    setMessages((current) => {
      const next = [optimistic, ...current];
      wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
      persistWallCache(owner.id);
      return next;
    });

    try {
      const payload = await api.createDesktopWallMessage(token, owner.id, body);
      setMessages((current) => {
        const realAlreadyHere = current.some((item) => item.id === payload.message.id && item.clientKey !== clientKey);
        if (realAlreadyHere) return current.filter((item) => item.clientKey !== clientKey);
        const next = current.map((item) => (item.clientKey === clientKey ? { ...payload.message, clientKey } : item));
        wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
        persistWallCache(owner.id);
        return next;
      });
    } catch (publishError) {
      setMessages((current) => {
        const next = current.filter((item) => item.clientKey !== clientKey);
        wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
        persistWallCache(owner.id);
        return next;
      });
      setDraft(body);
      setError(publishError instanceof Error ? publishError.message : t(language, 'unknownError'));
    }
  }

  async function removeMessage(message: DesktopWallMessage) {
    setMessageMenu(null);
    const prevMessages = messages;
    setMessages((current) => {
      const next = current.filter((item) => item.id !== message.id && (!message.clientKey || item.clientKey !== message.clientKey));
      wallCache.set(owner.id, { messages: next, hasMore: hasMoreRef.current, loadedAt: Date.now() });
      persistWallCache(owner.id);
      return next;
    });

    try {
      await api.deleteDesktopWallMessage(token, message.id);
    } catch (deleteError) {
      setMessages(prevMessages);
      wallCache.set(owner.id, { messages: prevMessages, hasMore: hasMoreRef.current, loadedAt: Date.now() });
      persistWallCache(owner.id);
      setError(deleteError instanceof Error ? deleteError.message : t(language, 'unknownError'));
    }
  }

  return (
    <aside className={collapsed ? 'desktop-wall-shell collapsed' : 'desktop-wall-shell'} onMouseDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button className="desktop-wall-toggle" type="button" aria-label={collapsed ? t(language, 'expand') : t(language, 'collapse')} onClick={() => setCollapsed((value) => !value)}>
        {collapsed ? '<' : '>'}
      </button>

      {!collapsed ? (
        <section ref={wallRef} className="desktop-wall">
      <form
        className="desktop-wall-form"
        onSubmit={(event) => {
          event.preventDefault();
          void publishMessage();
        }}
      >
        <div className="emoji-input-shell">
          <EmojiInlineInput
            ref={inputRef}
            className="emoji-inline-input"
            value={draft}
            maxLength={260}
            placeholder={t(language, 'wallPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (draft.trim() && !draftContainsEmbed) {
                  void publishMessage();
                }
              }
            }}
            previewSize={17}
          />
          <div ref={emojiAnchorRef} className="emoji-host inline">
            <button
              className="emoji-toggle inline"
              type="button"
              aria-label={t(language, 'emoji')}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                setEmojiOpen((value) => !value);
              }}
            >
              <EmojiToggleIcon />
            </button>
            {emojiOpen ? (
              <EmojiPicker
                language={language}
                anchorRef={emojiAnchorRef}
                placement="left-start"
                onSelect={(emoji) => {
                  inputRef.current?.insertText(emoji);
                  setEmojiOpen(false);
                }}
                onClose={() => setEmojiOpen(false)}
              />
            ) : null}
          </div>
        </div>
        {draftContainsEmbed ? <div className="desktop-wall-compose-warning">{t(language, 'wallEmbedsNotAllowed')}</div> : null}
      </form>

      {error ? <div className="inline-error desktop-wall-error">{error}</div> : null}

      <div
        ref={listRef}
        className="desktop-wall-list"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160 && hasMore && !loadingMoreRef.current) {
            void loadMore();
          }
        }}
      >
        {messages.length === 0 ? <div className="explorer-empty desktop-wall-empty">{t(language, 'wallEmpty')}</div> : null}
        {messages.map((message) => {
          const canDelete = currentUser.id === owner.id || currentUser.id === message.author.id;
          const handleAuthorClick = (event: { currentTarget: Element }) => {
            const r = event.currentTarget.getBoundingClientRect();
            onOpenProfile?.(message.author, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
          };
          return (
            <article
              className={message.pending ? 'desktop-wall-message pending' : 'desktop-wall-message'}
              key={message.clientKey ?? message.id}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMessageMenu({ x: event.clientX, y: event.clientY, message });
              }}
            >
              <button type="button" className="desktop-wall-author" onClick={handleAuthorClick}>
                <img src={message.author.avatarData} alt="" />
              </button>
              <div className="desktop-wall-message-content">
                {/* Only the author meta (name + time) opens the profile; the body
                    must stay interactive (GIF viewer, custom emoji) without
                    bubbling a click up to the profile handler. */}
                <div className="desktop-wall-message-meta" onClick={handleAuthorClick} style={{ cursor: 'pointer' }}>
                  <UserName user={message.author} as="strong" />
                  <time>{formatWallTime(message.createdAt, language)}</time>
                </div>
                {(() => {
                  const original = hasPackLink(message.body) ? stripPackLinks(message.body) : message.body;
                  const translated = translations[message.id];
                  if (translatingIds.has(message.id) && !translated) {
                    return <p className="message-text-translating">{t(language, 'translating')}</p>;
                  }
                  const visibleBody = translated ?? original;
                  if (!visibleBody) return null;
                  return (
                    <p>
                      <MessageBody text={visibleBody} />
                      {translated ? <span className="message-translated-tag"> · {t(language, 'translate').toLowerCase()}</span> : null}
                    </p>
                  );
                })()}
                {(() => {
                  const sharedPack = extractSharedPack(message.body);
                  return sharedPack ? <CustomEmojiPackEmbed token={token} language={language} shared={sharedPack} /> : null;
                })()}
              </div>
              {canDelete ? (
                <button className="desktop-wall-delete" type="button" aria-label={t(language, 'delete')} onClick={() => void removeMessage(message)}>
                  x
                </button>
              ) : null}
            </article>
          );
        })}
        {loadingMore ? <div className="desktop-wall-loading-more">…</div> : null}
      </div>

      {messageMenu ? createPortal(
        <div ref={messageMenuRef} className="context-menu" style={{ left: messageMenuPos.x, top: messageMenuPos.y }} onMouseDown={(event) => event.stopPropagation()}>
          {messageMenu.message.body ? (
            <button type="button" className="context-menu-action" onClick={() => void copyMessageText(messageMenu.message)}>
              <span className="context-menu-action-text">{t(language, 'copy')}</span>
              <MenuCopyIcon />
            </button>
          ) : null}
          {messageMenu.message.body ? (
            <button type="button" className="context-menu-action" onClick={() => void translateMessage(messageMenu.message)}>
              <span className="context-menu-action-text">{translations[messageMenu.message.id] ? t(language, 'showOriginal') : t(language, 'translate')}</span>
              <MenuTranslateIcon />
            </button>
          ) : null}
          {(currentUser.id === owner.id || currentUser.id === messageMenu.message.author.id) ? (
            <button type="button" className="context-menu-action danger-text" onClick={() => { const m = messageMenu.message; setMessageMenu(null); void removeMessage(m); }}>
              <span className="context-menu-action-text">{t(language, 'delete')}</span>
              <MenuDeleteIcon />
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
        </section>
      ) : null}
    </aside>
  );
}
