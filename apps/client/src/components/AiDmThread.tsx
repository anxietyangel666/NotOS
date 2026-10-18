import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent } from 'react';
import { api } from '../api/client';
import type { AiChat, AiQuota, AiSettings, ChatMediaItem, Language, MessengerMessage, PublicUser } from '../api/types';
import { LOCALES, t, getSavedTimeFormat } from '../i18n';
import { getMusicTracks } from '../music-library';
import { formatMessageDate, shouldShowDateDivider } from '../utils/message-date';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { EmojiPicker } from './EmojiPicker';
import { AttachIcon, EmojiToggleIcon, GifIcon } from './ChatComposeIcons';
import { readImageAsDataUrl } from '../auth/auth-file';
import { gifFromUrl, type TenorGif } from '../utils/tenor';

const DM_CHAT_KEY = 'notoc.ai.dm.chat-id';
const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_CHAT_MEDIA_BATCH = 10;

function loadDmChatId() {
  try {
    return localStorage.getItem(DM_CHAT_KEY) || '';
  } catch {
    return '';
  }
}

function saveDmChatId(chatId: string) {
  try {
    localStorage.setItem(DM_CHAT_KEY, chatId);
  } catch {
    /* ignore */
  }
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

type PendingChatImage = {
  dataUrl: string;
  name: string;
  spoiler: boolean;
};

function normalizeMessage(message: AiChat['messages'][number], index: number, currentUser: PublicUser, assistantId: string): MessengerMessage {
  const isAssistant = message.role === 'assistant';
  const mediaItems = (message.mediaItems && message.mediaItems.length > 0)
    ? message.mediaItems
    : message.imageData
      ? [{ dataUrl: message.imageData, name: message.imageName ?? null, spoiler: Boolean(message.imageSpoiler) }]
      : [];
  const createdAt = typeof message.createdAt === 'string' && !Number.isNaN(new Date(message.createdAt).getTime())
    ? message.createdAt
    : new Date().toISOString();
  return {
    id: message.id || `ai-${index}`,
    senderId: isAssistant ? assistantId : currentUser.id,
    recipientId: isAssistant ? currentUser.id : assistantId,
    senderGroup: null,
    body: message.content,
    imageData: mediaItems[0]?.dataUrl ?? null,
    imageName: mediaItems[0]?.name ?? null,
    imageSpoiler: mediaItems[0]?.spoiler ?? false,
    mediaItems,
    editedAt: null,
    deletedAt: null,
    readAt: createdAt,
    createdAt,
    pinnedAt: null,
    reactions: [],
    replyTo: null
  };
}

function toMessengerMessages(chat: AiChat, currentUser: PublicUser, assistantId: string) {
  return chat.messages.map((message, index) => normalizeMessage(message, index, currentUser, assistantId));
}

type AiDmThreadProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  assistant: PublicUser;
  onClose: () => void;
  onUserChange?: (user: PublicUser) => void;
  onAssistantSettingsChange?: (settings: AiSettings) => void;
};

export function AiDmThread({ token, language, currentUser, assistant, onClose, onUserChange, onAssistantSettingsChange }: AiDmThreadProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [configured, setConfigured] = useState(true);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [chat, setChat] = useState<AiChat | null>(null);
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [imageCaptionDraft, setImageCaptionDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingChatImage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [imageEmojiOpen, setImageEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<EmojiInlineInputHandle | null>(null);
  const imageCaptionInputRef = useRef<EmojiInlineInputHandle | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageEmojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const assistantName = settings?.assistantName?.trim() || assistant.nickname || 'NotAI';
  const assistantId = assistant.id;

  useEffect(() => {
    let alive = true;
    const storedChatId = loadDmChatId();

    // Instant render from local cache if previously opened
    if (storedChatId) {
      try {
        const cached = sessionStorage.getItem(`notoc.ai.dm.chat.${storedChatId}`);
        if (cached) {
          const parsed = JSON.parse(cached) as AiChat;
          setChat(parsed);
          setMessages(toMessengerMessages(parsed, currentUser, assistantId));
        }
      } catch {
        // ignore cache parse errors
      }
    }

    const fetchTasks = [
      api.getAiSettings(token).catch(() => null),
      api.getAiQuota(token).catch(() => null),
      storedChatId ? api.getAiChat(token, storedChatId).catch(() => null) : null
    ] as const;

    Promise.all(fetchTasks)
      .then(async ([settingsResult, quotaResult, chatResult]) => {
        if (!alive) return;
        if (settingsResult?.settings) setSettings(settingsResult.settings);
        if (quotaResult?.quota) setQuota(quotaResult.quota);

        let nextChat = chatResult?.chat ?? null;

        if (!nextChat) {
          try {
            const created = await api.createAiChat(token);
            saveDmChatId(created.chat.id);
            nextChat = created.chat;
          } catch {
            // ignore
          }
        }

        if (!alive || !nextChat) return;
        setChat(nextChat);
        setMessages(toMessengerMessages(nextChat, currentUser, assistantId));
        try {
          sessionStorage.setItem(`notoc.ai.dm.chat.${nextChat.id}`, JSON.stringify(nextChat));
        } catch {
          // ignore
        }
      })
      .catch(() => {
        if (!alive) return;
        setError(t(language, 'aiError'));
      });

    return () => {
      alive = false;
    };
  }, [assistantId, currentUser, language, token]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, sending]);

  const quotaReached = quota ? !quota.unlimited && (quota.remaining ?? 1) <= 0 : false;

  async function addImageFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/') || file.size > MAX_CHAT_IMAGE_SIZE) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPendingImages((current) => [...current, { dataUrl, name: file.name || t(language, 'imageMessage'), spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
      setEmojiOpen(false);
      setImageEmojiOpen(false);
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

  function clearPendingImages() {
    setPendingImages([]);
    setImageCaptionDraft('');
    setImageEmojiOpen(false);
  }

  function insertEmoji(emoji: string) {
    setDraft((value) => `${value}${emoji}`);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function insertImageEmoji(emoji: string) {
    imageCaptionInputRef.current?.insertText(emoji);
  }

  function sendGif(gif: TenorGif) {
    const normalized = gifFromUrl(gif.url, gif.description || 'GIF');
    setPendingImages((current) => [...current, { dataUrl: normalized.url, name: normalized.description, spoiler: false }].slice(0, MAX_CHAT_MEDIA_BATCH));
    setEmojiOpen(false);
  }

  function mediaItemsForMessage(message: MessengerMessage): ChatMediaItem[] {
    if (message.mediaItems && message.mediaItems.length > 0) return message.mediaItems;
    return message.imageData ? [{ dataUrl: message.imageData, name: message.imageName ?? null, spoiler: Boolean(message.imageSpoiler) }] : [];
  }

  async function createThread() {
    setError('');
    try {
      const created = await api.createAiChat(token);
      saveDmChatId(created.chat.id);
      setChat(created.chat);
      setMessages(toMessengerMessages(created.chat, currentUser, assistantId));
      setDraft('');
      clearPendingImages();
      setEmojiOpen(false);
      const quotaResult = await api.getAiQuota(token);
      setQuota(quotaResult.quota);
    } catch {
      setError(t(language, 'aiError'));
    }
  }

  async function sendMessage() {
    const content = (pendingImages.length > 0 ? imageCaptionDraft : draft).trim();
    if ((!content && pendingImages.length === 0) || sending || quotaReached) return;
    setError('');
    setSending(true);

    try {
      let activeChat = chat;
      if (!activeChat) {
        const created = await api.createAiChat(token);
        saveDmChatId(created.chat.id);
        activeChat = created.chat;
        setChat(activeChat);
      }

      const timeFormat = getSavedTimeFormat();
      const localDateTime = new Intl.DateTimeFormat(LOCALES[language], {
        dateStyle: 'full',
        timeStyle: 'short',
        hour12: timeFormat === '12h'
      }).format(new Date());
      const tracks = await getMusicTracks(currentUser.id);
      const musicTracks = tracks.map((track) => ({ name: track.name }));
      const attachments = pendingImages.map((item) => ({ dataUrl: item.dataUrl, name: item.name, spoiler: item.spoiler }));
      const primaryImage = attachments[0] ?? null;
      const payload = await api.sendAiMessage(token, activeChat.id, content, {
        localDateTime,
        timeFormat,
        musicTracks,
        image: primaryImage ? { ...primaryImage } : undefined,
        mediaItems: attachments.length > 1 ? attachments : undefined
      });

      setChat(payload.chat);
      setMessages(toMessengerMessages(payload.chat, currentUser, assistantId));
      try {
        sessionStorage.setItem(`notoc.ai.dm.chat.${payload.chat.id}`, JSON.stringify(payload.chat));
      } catch {
        // ignore
      }
      setQuota(payload.quota);
      setDraft('');
      clearPendingImages();
      if (payload.user) onUserChange?.(payload.user);
      if (payload.settings) {
        setSettings(payload.settings);
        onAssistantSettingsChange?.(payload.settings);
      }
    } catch {
      setError(t(language, 'aiError'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ai-chat-body ai-dm-thread">
      <div className="ai-chat-main ai-dm-main">
        <div className="messenger-chat-header ai-dm-header">
          <span className="messenger-avatar-wrap large">
            <img src={assistant.avatarData} alt="" draggable={false} />
          </span>
          <div>
            <h3 className="ai-dm-title">{assistantName}</h3>
            <small>{t(language, 'aiChat')}</small>
          </div>
          <div className="messenger-chat-header-actions">
            <button type="button" className="messenger-call-button" title={t(language, 'aiNewChat')} onClick={() => void createThread()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button type="button" className="messenger-call-button" title={t(language, 'close')} onClick={onClose}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="ai-chat-messages ai-dm-messages" ref={scrollRef}>
          {!configured ? <div className="ai-chat-notice">{t(language, 'aiNotConfigured')}</div> : null}
          {chat && messages.length > 0 ? (
            messages.map((message, index) => {
              const previous = messages[index - 1] ?? null;
              const showDateDivider = shouldShowDateDivider(message.createdAt, previous ? previous.createdAt : null);
              const isMine = message.senderId === currentUser.id;
              return (
                <Fragment key={message.id}>
                  {showDateDivider ? (
                    <div className="message-date-divider">
                      <span>{formatMessageDate(message.createdAt, language)}</span>
                    </div>
                  ) : null}
                  <div className={`ai-message ${isMine ? 'ai-message-user' : 'ai-message-assistant'}`}>
                    <div className="ai-message-bubble">
                      <time className="ai-message-time">
                        {new Intl.DateTimeFormat(LOCALES[language], {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: getSavedTimeFormat() === '12h'
                        }).format(new Date(message.createdAt))}
                      </time>
                      {mediaItemsForMessage(message).length > 0 ? (
                        <div className={mediaItemsForMessage(message).length === 1 ? 'ai-message-media' : 'ai-message-media ai-message-media-grid'}>
                          {mediaItemsForMessage(message).map((item, itemIndex) => (
                            <div
                              key={`${message.id}:${itemIndex}:${item.dataUrl}`}
                              className="ai-message-media-item"
                            >
                              <img src={item.dataUrl} alt={item.name ?? ''} draggable={false} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <span className="ai-message-text">{message.body}</span>
                    </div>
                  </div>
                </Fragment>
              );
            })
          ) : (
            <div className="ai-chat-empty-state">{t(language, 'aiEmptyState')}</div>
          )}
          {sending ? <div className="ai-message ai-message-assistant"><div className="ai-message-bubble ai-message-thinking">{t(language, 'aiThinking')}</div></div> : null}
        </div>

        {error ? <div className="ai-chat-error">{error}</div> : null}
        {quotaReached && !error ? <div className="ai-chat-error">{t(language, 'aiQuotaReached')}</div> : null}

        <div className="messenger-compose ai-dm-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void handleDrop(event)}>
          <input
            ref={imageInputRef}
            className="hidden-file"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []).slice(0, MAX_CHAT_MEDIA_BATCH - pendingImages.length);
              event.currentTarget.value = '';
              files.forEach((file) => void addImageFile(file));
            }}
          />
          <div className="messenger-compose-row">
            <button
              type="button"
              className="emoji-toggle inline messenger-attach-inline"
              title={t(language, 'imageMessage')}
              aria-label={t(language, 'imageMessage')}
              disabled={sending || !configured || quotaReached}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                imageInputRef.current?.click();
              }}
            >
              <AttachIcon />
            </button>
            <div className="messenger-input-shell">
              <EmojiInlineInput
                ref={composerInputRef}
                className="emoji-inline-input messenger-chat-inline-input"
                value={draft}
                placeholder={t(language, 'messagePlaceholder')}
                disabled={sending || !configured || quotaReached}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={handleComposerPaste}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <div ref={emojiAnchorRef} className="messenger-input-actions">
                <button
                  className="emoji-toggle inline chat-gif-toggle"
                  type="button"
                  aria-label="GIF"
                  disabled={sending || !configured || quotaReached}
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
                  disabled={sending || !configured || quotaReached}
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
                {emojiOpen ? (
                  <EmojiPicker
                    language={language}
                    enlarged
                    initialTab={pickerTab}
                    anchorRef={emojiAnchorRef}
                    placement="top-end"
                    onSelect={insertEmoji}
                    onSelectGif={sendGif}
                    onClose={() => setEmojiOpen(false)}
                    token={token}
                    currentUser={currentUser}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
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
                  onClick={() => imageInputRef.current?.click()}
                >
                  +
                </button>
                <button type="button" aria-label={t(language, 'close')} onClick={clearPendingImages}>x</button>
              </div>
              <div className={pendingImages.length === 1 ? 'image-draft-preview' : 'image-draft-preview media-grid'}>
                {pendingImages.map((item, index) => (
                  <button key={`${item.name}-${index}`} type="button" className="image-draft-thumb" onClick={() => removePendingImage(index)}>
                    <img src={item.dataUrl} alt={item.name} />
                    <span aria-hidden="true">x</span>
                  </button>
                ))}
              </div>
              <div className="image-caption-input">
                <EmojiInlineInput
                  ref={imageCaptionInputRef}
                  className="emoji-inline-input"
                  value={imageCaptionDraft}
                  placeholder={t(language, 'imageCaptionPlaceholder')}
                  disabled={sending || !configured || quotaReached}
                  onChange={(event) => setImageCaptionDraft(event.target.value)}
                  onPaste={handleComposerPaste}
                  autoFocus
                />
                <div ref={imageEmojiAnchorRef} className="emoji-host inline">
                  <button
                    className="emoji-toggle inline"
                    type="button"
                    aria-label={t(language, 'emoji')}
                    disabled={sending || !configured || quotaReached}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setImageEmojiOpen((value) => !value);
                    }}
                  >
                    <EmojiToggleIcon />
                  </button>
                  {imageEmojiOpen ? (
                    <EmojiPicker
                      language={language}
                      enlarged
                      anchorRef={imageEmojiAnchorRef}
                      placement="top-end"
                      onSelect={insertImageEmoji}
                      onClose={() => setImageEmojiOpen(false)}
                      token={token}
                      currentUser={currentUser}
                    />
                  ) : null}
                </div>
              </div>
              <div className="image-draft-actions">
                <button className="secondary-action" type="button" onClick={clearPendingImages}>{t(language, 'cancel')}</button>
                <button type="submit" className="primary-action" disabled={sending || !configured || quotaReached}>{t(language, 'sendMessage')}</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
