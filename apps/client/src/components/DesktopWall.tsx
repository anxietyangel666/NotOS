import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, api } from '../api/client';
import type { DesktopWallMessage, Language, PublicUser } from '../api/types';
import { LOCALES, t, getSavedTimeFormat } from '../i18n';
import { EmojiPicker } from './EmojiPicker';
import { EmojiToggleIcon } from './ChatComposeIcons';
import { UserName } from './UserName';

type DesktopWallProps = {
  token: string;
  language: Language;
  owner: PublicUser;
  currentUser: PublicUser;
  onOpenProfile?: (user: PublicUser) => void;
};

function formatWallTime(value: string, language: Language) {
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(new Date(value));
}

export function DesktopWall({ token, language, owner, currentUser, onOpenProfile }: DesktopWallProps) {
  const wallRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<DesktopWallMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(`notoc.wall.collapsed.${owner.id}`) === '1');
  const [page, setPage] = useState(0);
  const [messagesPerPage, setMessagesPerPage] = useState(8);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const pageCount = Math.max(1, Math.ceil(messages.length / messagesPerPage));
  const visibleMessages = messages.slice(page * messagesPerPage, page * messagesPerPage + messagesPerPage);

  function upsertMessage(message: DesktopWallMessage) {
    setMessages((current) => [message, ...current.filter((item) => item.id !== message.id)]);
  }

  useEffect(() => {
    localStorage.setItem(`notoc.wall.collapsed.${owner.id}`, collapsed ? '1' : '0');
  }, [collapsed, owner.id]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    const list = listRef.current;
    const wall = wallRef.current;
    if (!list || !wall) return;
    const listTarget = list;
    const wallTarget = wall;

    function updatePageSize() {
      const itemHeight = 72;
      const availableHeight = Math.max(listTarget.clientHeight, wallTarget.clientHeight - 132, window.innerHeight - 180);
      setMessagesPerPage(Math.max(4, Math.floor(availableHeight / itemHeight)));
    }

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(listTarget);
    observer.observe(wallTarget);
    window.addEventListener('resize', updatePageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePageSize);
    };
  }, [collapsed]);

  useEffect(() => {
    let alive = true;
    api
      .getDesktopWall(token, owner.id)
      .then((payload) => {
        if (alive) setMessages(payload.messages);
      })
      .catch((loadError) => {
        if (alive) setError(loadError instanceof Error ? loadError.message : t(language, 'unknownError'));
      });

    const socket = io(API_URL, { auth: { token } });

    socket.on('desktopWall:messageCreated', (payload: { ownerId: string; message: DesktopWallMessage }) => {
      if (payload.ownerId !== owner.id) return;
      upsertMessage(payload.message);
    });

    socket.on('desktopWall:messageDeleted', (payload: { ownerId: string; messageId: string }) => {
      if (payload.ownerId !== owner.id) return;
      setMessages((current) => current.filter((message) => message.id !== payload.messageId));
    });

    socket.on('desktop:userChanged', (payload: { user: PublicUser }) => {
      setMessages((current) => current.map((message) => (message.author.id === payload.user.id ? { ...message, author: payload.user } : message)));
    });

    return () => {
      alive = false;
      socket.disconnect();
    };
  }, [language, owner.id, token]);

  async function publishMessage() {
    const body = draft.trim();
    if (!body) return;

    setDraft('');
    setError('');

    try {
      const payload = await api.createDesktopWallMessage(token, owner.id, body);
      upsertMessage(payload.message);
    } catch (publishError) {
      setDraft(body);
      setError(publishError instanceof Error ? publishError.message : t(language, 'unknownError'));
    }
  }

  async function removeMessage(message: DesktopWallMessage) {
    try {
      await api.deleteDesktopWallMessage(token, message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (deleteError) {
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
          <input className="emoji-inline-input" value={draft} maxLength={260} placeholder={t(language, 'wallPlaceholder')} onChange={(event) => setDraft(event.target.value)} />
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
            {emojiOpen ? <EmojiPicker language={language} anchorRef={emojiAnchorRef} placement="left-start" onSelect={(emoji) => setDraft((value) => `${value}${emoji}`)} onClose={() => setEmojiOpen(false)} /> : null}
          </div>
        </div>
        {/* Submit on Enter; hidden submit keeps form submission working without a publish button. */}
        <button type="submit" className="hidden-submit" tabIndex={-1} aria-hidden="true" />
      </form>

      {error ? <div className="inline-error desktop-wall-error">{error}</div> : null}

      <div ref={listRef} className="desktop-wall-list">
        {messages.length === 0 ? <div className="explorer-empty desktop-wall-empty">{t(language, 'wallEmpty')}</div> : null}
        {visibleMessages.map((message) => {
          const canDelete = currentUser.id === owner.id || currentUser.id === message.author.id;
          const handleAuthorClick = () => onOpenProfile?.(message.author);
          return (
            <article className="desktop-wall-message" key={message.id}>
              <button type="button" className="desktop-wall-author" onClick={handleAuthorClick}>
                <img src={message.author.avatarData} alt="" />
              </button>
              <div onClick={handleAuthorClick} style={{ cursor: 'pointer' }}>
                <div className="desktop-wall-message-meta">
                  <UserName user={message.author} as="strong" />
                  <time>{formatWallTime(message.createdAt, language)}</time>
                </div>
                <p>{message.body}</p>
              </div>
              {canDelete ? (
                <button className="desktop-wall-delete" type="button" aria-label={t(language, 'delete')} onClick={() => void removeMessage(message)}>
                  x
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {messages.length > messagesPerPage ? (
        <div className="desktop-wall-pages">
          <button className="secondary-action compact-action" type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
            {t(language, 'previousTrack')}
          </button>
          <span>{page + 1}/{pageCount}</span>
          <button className="secondary-action compact-action" type="button" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
            {t(language, 'nextTrack')}
          </button>
        </div>
      ) : null}
        </section>
      ) : null}
    </aside>
  );
}
