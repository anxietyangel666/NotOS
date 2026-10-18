import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent } from 'react';
import { api } from '../api/client';
import type { AiChat, AiChatMessage, AiChatSummary, AiQuota, AiSettings, ChatMediaItem, Language } from '../api/types';
import { LOCALES, t, getSavedTimeFormat } from '../i18n';
import { getMusicTracks } from '../music-library';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';
import { AiPersonaForm } from './AiPersonaForm';
import { SaveBar } from './SaveBar';
import { EmojiPicker } from './EmojiPicker';
import { AttachIcon, EmojiToggleIcon, GifIcon } from './ChatComposeIcons';
import { WindowFrame } from './WindowFrame';
import { readImageAsDataUrl } from '../auth/auth-file';
import { gifFromUrl, type TenorGif } from '../utils/tenor';

type AiTab = 'chat' | 'persona';

type PendingChatImage = {
  dataUrl: string;
  name: string;
  spoiler: boolean;
};

const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_CHAT_MEDIA_BATCH = 10;

function clipboardImageFiles(data: DataTransfer) {
  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (fromItems.length > 0) return fromItems;
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

function mediaItemsForAiMessage(message: AiChatMessage): ChatMediaItem[] {
  if (message.mediaItems && message.mediaItems.length > 0) return message.mediaItems;
  return message.imageData ? [{ dataUrl: message.imageData, name: message.imageName ?? null, spoiler: Boolean(message.imageSpoiler) }] : [];
}

// Locally-persisted favorite AI chats (by chat id). Favoriting pins a chat to
// the top of the list, mirroring the favorites available elsewhere in the app.
const AI_FAVORITES_KEY = 'notoc.ai.favorites';

function loadAiFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(AI_FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveAiFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(AI_FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    /* ignore quota errors */
  }
}

const DEFAULT_SETTINGS: AiSettings = {
  assistantName: 'NotAI',
  assistantAvatarData: '',
  gender: 'neutral',
  persona: 'friendly',
  tone: 'balanced',
  responseLength: 'balanced',
  emojiUsage: 'some',
  addressName: '',
  customInstructions: '',
  onboarded: false
};

function normalizeAiMessage(message: Partial<AiChatMessage> | null | undefined, index: number): AiChatMessage {
  const role = message?.role === 'assistant' || message?.role === 'user' ? message.role : 'assistant';
  const createdAt = typeof message?.createdAt === 'string' && !Number.isNaN(new Date(message.createdAt).getTime())
    ? message.createdAt
    : new Date().toISOString();
  return {
    id: typeof message?.id === 'string' && message.id ? message.id : `recovered-${index}`,
    role,
    content: typeof message?.content === 'string' ? message.content : '',
    imageData: message?.imageData ?? null,
    imageName: message?.imageName ?? null,
    imageSpoiler: message?.imageSpoiler ?? false,
    mediaItems: Array.isArray(message?.mediaItems) ? message.mediaItems : undefined,
    createdAt
  };
}

function normalizeAiChat(chat: AiChat | null | undefined): AiChat {
  return {
    id: chat?.id ?? '',
    title: chat?.title ?? 'New chat',
    updatedAt: chat?.updatedAt ?? new Date().toISOString(),
    messages: Array.isArray(chat?.messages) ? chat.messages.map(normalizeAiMessage) : []
  };
}

function normalizeAiChatList(chats: AiChatSummary[] | undefined | null) {
  return Array.isArray(chats) ? chats : [];
}

// Localized reset time (e.g. "today 14:00" style) for the quota panel.
function formatResetTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALES[language], {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: getSavedTimeFormat() === '12h'
  }).format(date);
}

// Localized HH:MM, honoring the user's 12h/24h (AM/PM) clock preference.
function formatTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALES[language], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: getSavedTimeFormat() === '12h'
  }).format(date);
}

type AiChatWindowProps = {
  token: string;
  userId: string;
  language: Language;
  maximized: boolean;
  minimized: boolean;
  zIndex: number;
  onFocus: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function AiChatWindow({
  token,
  userId,
  language,
  maximized,
  minimized,
  zIndex,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose
}: AiChatWindowProps) {
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<AiChat | null>(null);
  const [configured, setConfigured] = useState(true);
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function addImageFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/') || file.size > MAX_CHAT_IMAGE_SIZE) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPendingImages((current) => [...current, { dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
      setEmojiOpen(false);
    } catch {
      // ignore
    }
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLElement>) {
    const files = clipboardImageFiles(event.clipboardData).slice(0, MAX_CHAT_MEDIA_BATCH - pendingImages.length);
    if (files.length === 0) return;
    event.preventDefault();
    files.forEach((file) => void addImageFile(file));
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/')).slice(0, MAX_CHAT_MEDIA_BATCH - pendingImages.length);
    for (const file of files) {
      await addImageFile(file);
    }
  }

  function removePendingImage(index: number) {
    setPendingImages((current) => current.filter((_, i) => i !== index));
  }

  function sendGif(gif: TenorGif) {
    const normalized = gifFromUrl(gif.url, gif.description || 'GIF');
    setPendingImages((current) => [...current, { dataUrl: normalized.url, name: normalized.description, spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
    setEmojiOpen(false);
  }

  // Tabs + persona/quota state.
  const [tab, setTab] = useState<AiTab>('chat');
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [personaDraft, setPersonaDraft] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [savingPersona, setSavingPersona] = useState(false);
  const [personaSaved, setPersonaSaved] = useState(false);
  // Bumped to shake the persona save bar on a blocked close attempt.
  const [personaBarShake, setPersonaBarShake] = useState(0);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [showQuota, setShowQuota] = useState(false);
  // First-run onboarding: shown the very first time before a persona is set.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDraft, setOnboardingDraft] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [favorites, setFavorites] = useState<Set<string>>(loadAiFavorites);

  function toggleFavorite(chatId: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      saveAiFavorites(next);
      return next;
    });
  }

  // Favorites float to the top; the rest keep their existing order.
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 1 : 0;
      const bFav = favorites.has(b.id) ? 1 : 0;
      return bFav - aFav;
    });
  }, [chats, favorites]);

  // Load persona settings + quota on mount; trigger onboarding if not done yet.
  useEffect(() => {
    let alive = true;
    Promise.all([api.getAiSettings(token), api.getAiQuota(token)])
      .then(([settingsResult, quotaResult]) => {
        if (!alive) return;
        setSettings(settingsResult.settings);
        setPersonaDraft(settingsResult.settings);
        setQuota(quotaResult.quota);
        if (!settingsResult.settings.onboarded) {
          setOnboardingDraft(settingsResult.settings);
          setShowOnboarding(true);
        }
      })
      .catch(() => { /* ignore: persona/quota are non-critical for chatting */ });
    return () => { alive = false; };
  }, [token]);

  async function savePersona() {
    setSavingPersona(true);
    setPersonaSaved(false);
    try {
      const result = await api.updateAiSettings(token, personaDraft);
      setSettings(result.settings);
      setPersonaDraft(result.settings);
      setPersonaSaved(true);
      setTimeout(() => setPersonaSaved(false), 2000);
    } catch {
      setError(t(language, 'aiError'));
    } finally {
      setSavingPersona(false);
    }
  }

  // True when the persona form has unsaved edits versus the saved settings.
  const personaDirty = useMemo(
    () => JSON.stringify(personaDraft) !== JSON.stringify(settings),
    [personaDraft, settings]
  );

  async function completeOnboarding(persist: boolean) {
    try {
      const payload = persist ? { ...onboardingDraft, onboarded: true } : { onboarded: true };
      const result = await api.updateAiSettings(token, payload);
      setSettings(result.settings);
      setPersonaDraft(result.settings);
    } catch {
      // Even if saving fails, don't trap the user on the overlay.
    } finally {
      setShowOnboarding(false);
    }
  }

  async function refreshQuota() {
    try {
      const result = await api.getAiQuota(token);
      setQuota(result.quota);
    } catch {
      // ignore
    }
  }

  // Load the chat list (history sidebar) on mount.
  useEffect(() => {
    let alive = true;
    api.getAiChats(token)
      .then((result) => {
        if (!alive) return;
        const nextChats = normalizeAiChatList(result.chats);
        setChats(nextChats);
        setConfigured(result.configured);
        if (nextChats.length > 0) void openChat(nextChats[0].id);
      })
      .catch(() => { if (alive) setError(t(language, 'aiError')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeChat?.messages.length, sending]);

  async function refreshList() {
    try {
      const result = await api.getAiChats(token);
      setChats(normalizeAiChatList(result.chats));
      setConfigured(result.configured);
    } catch {
      // ignore
    }
  }

  async function openChat(chatId: string) {
    setError('');
    try {
      const result = await api.getAiChat(token, chatId);
      setActiveChat(normalizeAiChat(result.chat));
    } catch {
      setError(t(language, 'aiError'));
    }
  }

  async function createChat() {
    setError('');
    try {
      const result = await api.createAiChat(token);
      setActiveChat(normalizeAiChat(result.chat));
      await refreshList();
    } catch {
      setError(t(language, 'aiError'));
    }
  }

  async function deleteChat(chatId: string) {
    try {
      await api.deleteAiChat(token, chatId);
      if (activeChat?.id === chatId) setActiveChat(null);
      await refreshList();
    } catch {
      // ignore
    }
  }

  async function send() {
    const content = draft.trim();
    if ((!content && pendingImages.length === 0) || sending) return;
    setError('');
    setSending(true);

    const attachmentsToSend = pendingImages.map((item) => ({ dataUrl: item.dataUrl, name: item.name, spoiler: item.spoiler }));
    const primaryImage = attachmentsToSend[0] ?? null;

    // Ensure a chat exists before sending the first message.
    let chat = activeChat;
    try {
      if (!chat) {
        const created = await api.createAiChat(token);
        chat = normalizeAiChat(created.chat);
        setActiveChat(chat);
      }

      // Optimistically show the user's message with attachments.
      const optimisticChat: AiChat = {
        ...chat,
        messages: [
          ...chat.messages,
          {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            imageData: primaryImage?.dataUrl ?? null,
            imageName: primaryImage?.name ?? null,
            imageSpoiler: primaryImage?.spoiler ?? false,
            mediaItems: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
            createdAt: new Date().toISOString()
          }
        ]
      };
      setActiveChat(optimisticChat);
      setDraft('');
      setPendingImages([]);

      // Send the user's local date/time and AM/PM (12h/24h) preference so the
      // assistant can report times synced with the user's clock settings.
      const timeFormat = getSavedTimeFormat();
      const localDateTime = new Intl.DateTimeFormat(LOCALES[language], {
        dateStyle: 'full',
        timeStyle: 'short',
        hour12: timeFormat === '12h'
      }).format(new Date());

      // Music playlist lives in the browser; send track names so the assistant
      // knows what is in the playlist (shared by the player and the desktop).
      const tracks = await getMusicTracks(userId);
      const musicTracks = tracks.map((track) => ({ name: track.name }));

      const result = await api.sendAiMessage(token, chat.id, content, {
        localDateTime,
        timeFormat,
        musicTracks,
        image: primaryImage ? { ...primaryImage } : undefined,
        mediaItems: attachmentsToSend.length > 1 ? attachmentsToSend : undefined
      });
      setActiveChat(normalizeAiChat(result.chat));
      if (result.quota) setQuota(result.quota);
      if (result.settings) {
        setSettings(result.settings);
        setPersonaDraft(result.settings);
      }
      await refreshList();
    } catch (err) {
      // The server returns 429 with this message when the daily quota is hit.
      const message = err instanceof Error ? err.message : '';
      const quotaHit = /limit reached|quota/i.test(message);
      setError(quotaHit ? t(language, 'aiQuotaReached') : (message || t(language, 'aiError')));
      // Restore the draft and attachments so the user can retry.
      setDraft(content);
      setPendingImages(attachmentsToSend);
      if (chat) await openChat(chat.id);
      void refreshQuota();
    } finally {
      setSending(false);
    }
  }

  const quotaReached = quota ? !quota.unlimited && (quota.remaining ?? 1) <= 0 : false;

  return (
    <WindowFrame
      language={language}
      title={t(language, 'aiChat')}
      className="ai-chat-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      storageKey="ai-chat"
      defaultPosition={{ x: 160, y: 80 }}
      minSize={{ width: 760, height: 520 }}
      defaultSize={{ width: 960, height: 680 }}
      onFocus={onFocus}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
      onClose={() => {
        if (tab === 'persona' && personaDirty) {
          setPersonaBarShake((n) => n + 1);
          return;
        }
        onClose();
      }}
    >
      <div className="ai-chat-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'ai-chat-tab active' : 'ai-chat-tab'}
          onClick={() => setTab('chat')}
        >
          {t(language, 'aiTabChat')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'persona'}
          className={tab === 'persona' ? 'ai-chat-tab active' : 'ai-chat-tab'}
          onClick={() => setTab('persona')}
        >
          {t(language, 'aiTabPersona')}
        </button>
        <button
          type="button"
          className="ai-quota-open"
          title={t(language, 'aiTabQuota')}
          aria-label={t(language, 'aiTabQuota')}
          onClick={() => { setShowQuota(true); void refreshQuota(); }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12A10 10 0 1 1 12 2"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
          {t(language, 'aiTabQuota')}
        </button>
      </div>

      {tab === 'persona' ? (
        <div className="ai-panel">
          <p className="ai-panel-intro">{t(language, 'aiPersonaIntro')}</p>
          <AiPersonaForm token={token} language={language} draft={personaDraft} onChange={(patch) => setPersonaDraft((prev) => ({ ...prev, ...patch }))} />
          <SaveBar
            language={language}
            dirty={personaDirty}
            shakeKey={personaBarShake}
            saving={savingPersona}
            onReset={() => setPersonaDraft(settings)}
            onSave={() => void savePersona()}
          />
        </div>
      ) : (
      <div className="ai-chat-body">
        <aside className="ai-chat-sidebar">
          <button className="primary-action ai-chat-new" type="button" onClick={() => void createChat()}>
            + {t(language, 'aiNewChat')}
          </button>
          <p className="ai-chat-sidebar-label">{t(language, 'aiChats')}</p>
          <div className="ai-chat-list">
            {chats.length === 0 ? (
              <div className="ai-chat-empty-list">{t(language, 'aiNoChats')}</div>
            ) : (
              sortedChats.map((chat) => {
                const isFavorite = favorites.has(chat.id);
                return (
                <div
                  key={chat.id}
                  className={activeChat?.id === chat.id ? 'ai-chat-list-item active' : 'ai-chat-list-item'}
                  onClick={() => void openChat(chat.id)}
                >
                  {isFavorite ? <i className="pin-indicator ai-chat-fav-dot" /> : null}
                  <span className="ai-chat-list-title" title={chat.title}>{chat.title}</span>
                  <button
                    className={isFavorite ? 'ai-chat-fav active' : 'ai-chat-fav'}
                    type="button"
                    aria-pressed={isFavorite}
                    aria-label={isFavorite ? t(language, 'aiFavoriteRemove') : t(language, 'aiFavoriteAdd')}
                    title={isFavorite ? t(language, 'aiFavoriteRemove') : t(language, 'aiFavoriteAdd')}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(chat.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true">
                      <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.56l-5.9 3.11 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z"
                        fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    className="ai-chat-delete"
                    type="button"
                    aria-label={t(language, 'aiDeleteChat')}
                    title={t(language, 'aiDeleteChat')}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteChat(chat.id);
                    }}
                  >
                    x
                  </button>
                </div>
                );
              })
            )}
          </div>
        </aside>

        <div className="ai-chat-main">
          <div className="ai-chat-messages" ref={scrollRef}>
            {!configured ? (
              <div className="ai-chat-notice">{t(language, 'aiNotConfigured')}</div>
            ) : null}
            {activeChat && activeChat.messages.length > 0 ? (
              activeChat.messages.map((message, index) => {
                const previous = activeChat.messages[index - 1] ?? null;
                const showDateDivider = shouldShowDateDivider(
                  message.createdAt,
                  previous ? previous.createdAt : null
                );
                return (
                  <Fragment key={message.id}>
                    {showDateDivider ? (
                      <div className="message-date-divider">
                        <span>{formatMessageDate(message.createdAt, language)}</span>
                      </div>
                    ) : null}
                    <div className={`ai-message ai-message-${message.role}`}>
                      <div className="ai-message-bubble">
                        <time className="ai-message-time">{formatTime(message.createdAt, language)}</time>
                        {mediaItemsForAiMessage(message).length > 0 ? (
                          <div className={mediaItemsForAiMessage(message).length === 1 ? 'ai-message-media' : 'ai-message-media ai-message-media-grid'}>
                            {mediaItemsForAiMessage(message).map((item, itemIdx) => (
                              <div key={`${message.id}:${itemIdx}`} className="ai-message-media-item">
                                <img src={item.dataUrl} alt={item.name ?? ''} draggable={false} />
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {message.content ? <span className="ai-message-text">{message.content}</span> : null}
                      </div>
                    </div>
                  </Fragment>
                );
              })
            ) : (
              <div className="ai-chat-empty-state">{t(language, 'aiEmptyState')}</div>
            )}
            {sending ? (
              <div className="ai-message ai-message-assistant">
                <div className="ai-message-bubble ai-message-thinking">{t(language, 'aiThinking')}</div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="ai-chat-error-row">
              <span className="ai-chat-error">{error}</span>
              <button type="button" className="ai-chat-retry-btn" onClick={() => void send()}>
                {language === 'ru' ? 'Повторить' : language === 'uk' ? 'Повторити' : 'Retry'}
              </button>
            </div>
          ) : null}
          {quotaReached && !error ? <div className="ai-chat-error">{t(language, 'aiQuotaReached')}</div> : null}

          <div
            className="ai-chat-composer"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event)}
          >
            <input
              ref={fileInputRef}
              className="hidden-file"
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []).slice(0, MAX_CHAT_MEDIA_BATCH - pendingImages.length);
                event.currentTarget.value = '';
                files.forEach((file) => void addImageFile(file));
              }}
            />

            {pendingImages.length > 0 ? (
              <div className="ai-chat-attachments">
                {pendingImages.map((item, index) => (
                  <button
                    key={`${item.name}-${index}`}
                    type="button"
                    className="ai-chat-attachment"
                    title={item.name}
                    onClick={() => removePendingImage(index)}
                  >
                    <img src={item.dataUrl} alt={item.name} />
                    <span aria-hidden="true">&times;</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="ai-chat-composer-row">
              <button
                type="button"
                className="ai-chat-attach-btn"
                title={t(language, 'imageMessage')}
                aria-label={t(language, 'imageMessage')}
                disabled={sending || !configured || quotaReached}
                onClick={() => fileInputRef.current?.click()}
              >
                <AttachIcon />
              </button>

              <div className="ai-chat-input-shell">
                <textarea
                  ref={composerInputRef}
                  className="ai-chat-textarea"
                  rows={1}
                  placeholder={language === 'ru' ? 'Написать сообщение...' : language === 'uk' ? 'Написати повідомлення...' : 'Write a message...'}
                  value={draft}
                  disabled={sending || !configured || quotaReached}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={handleComposerPaste}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />

                <div ref={emojiAnchorRef} className="ai-chat-emoji-host">
                  <button
                    className="emoji-toggle inline chat-gif-toggle"
                    type="button"
                    aria-label="GIF"
                    disabled={sending || !configured || quotaReached}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPickerTab('gif');
                      setEmojiOpen((value) => !value);
                    }}
                  >
                    <GifIcon />
                  </button>

                  <button
                    className="emoji-toggle inline"
                    type="button"
                    aria-label={t(language, 'emoji')}
                    disabled={sending || !configured || quotaReached}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPickerTab('emoji');
                      setEmojiOpen((value) => !value);
                    }}
                  >
                    <EmojiToggleIcon />
                  </button>

                  {emojiOpen ? (
                    <EmojiPicker
                      language={language}
                      enlarged
                      initialTab={pickerTab}
                      anchorRef={emojiAnchorRef}
                      placement="top-end"
                      onSelect={(emoji) => {
                        setDraft((value) => `${value}${emoji}`);
                        window.setTimeout(() => composerInputRef.current?.focus(), 0);
                      }}
                      onSelectGif={sendGif}
                      onClose={() => setEmojiOpen(false)}
                      token={token}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {showQuota ? (
        <div className="ai-quota-overlay" onClick={() => setShowQuota(false)}>
          <div className="ai-quota-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ai-quota-modal-header">
              <h3 className="ai-quota-modal-title">{t(language, 'aiQuotaTitle')}</h3>
              <button
                type="button"
                className="ai-quota-close"
                aria-label={t(language, 'close')}
                title={t(language, 'close')}
                onClick={() => setShowQuota(false)}
              >
                x
              </button>
            </div>
            <QuotaPanel language={language} quota={quota} />
          </div>
        </div>
      ) : null}

      {showOnboarding ? (
        <div className="ai-onboarding-overlay">
          <div className="ai-onboarding-card">
            <h3 className="ai-onboarding-title">{t(language, 'aiOnboardingTitle')}</h3>
            <p className="ai-panel-intro">{t(language, 'aiPersonaIntro')}</p>
            <div className="ai-onboarding-scroll">
              <AiPersonaForm
                token={token}
                language={language}
                draft={onboardingDraft}
                onChange={(patch) => setOnboardingDraft((prev) => ({ ...prev, ...patch }))}
              />
            </div>
            <div className="ai-onboarding-actions">
              <button type="button" className="secondary-action" onClick={() => void completeOnboarding(false)}>
                {t(language, 'aiOnboardingSkip')}
              </button>
              <button type="button" className="primary-action" onClick={() => void completeOnboarding(true)}>
                {t(language, 'aiOnboardingStart')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </WindowFrame>
  );
}

type QuotaPanelProps = {
  language: Language;
  quota: AiQuota | null;
};

function QuotaPanel({ language, quota }: QuotaPanelProps) {
  if (!quota) {
    return <div className="ai-quota-loading">{t(language, 'aiThinking')}</div>;
  }

  if (quota.unlimited) {
    return (
      <div className="ai-quota">
        <div className="ai-quota-bar">
          <div className="ai-quota-fill ai-quota-fill-dev" style={{ width: '100%' }} />
        </div>
        <p className="ai-quota-unlimited">{t(language, 'aiQuotaUnlimited')}</p>
        <p className="ai-panel-intro">{t(language, 'aiQuotaUnlimitedDesc')}</p>
      </div>
    );
  }

  const limit = quota.limit ?? 0;
  const used = quota.used;
  const remaining = quota.remaining ?? 0;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = remaining <= 0;
  const warn = !danger && remaining <= Math.max(1, Math.round(limit * 0.2));

  return (
    <div className="ai-quota">
      <div className="ai-quota-bar">
        <div
          className={`ai-quota-fill${danger ? ' ai-quota-fill-danger' : warn ? ' ai-quota-fill-warn' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="ai-quota-usage">{t(language, 'aiQuotaUsage', { used: String(used), limit: String(limit) })}</p>
      <p className="ai-quota-remaining">{t(language, 'aiQuotaRemaining', { remaining: String(remaining) })}</p>
      {quota.resetAt ? (
        <p className="ai-panel-intro">{t(language, 'aiQuotaReset', { time: formatResetTime(quota.resetAt, language) })}</p>
      ) : null}
      <p className="ai-panel-intro ai-quota-info">{t(language, 'aiQuotaInfo', { limit: String(limit) })}</p>
    </div>
  );
}
