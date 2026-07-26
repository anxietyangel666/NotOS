import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Group, Language, MessageReplySnippet, PublicUser } from '../api/types';
import { t } from '../i18n';
import { emojiToTwemojiUrl } from '../utils/emoji';
import { MessagePreviewText } from './Twemoji';
import { splitCustomEmoji, expandCustomEmojiShortcodes } from '../utils/custom-emoji';
import { EmojiPicker } from './EmojiPicker';
import { EmojiToggleIcon } from './ChatComposeIcons';
import { assetUrl } from '../utils/assets';
import { isVideoCircleAttachment, isVoiceAttachment, VideoCircleMessagePlayer, VoiceMessagePlayer } from './VoiceMessage';

// The five one-click reactions shown in hover toolbars and right-click menus
// (Discord-style: thumbs up, heart, smile, laugh, fire). The unicode glyphs
// render through the Twemoji pipeline (see Twemoji.tsx), not as system emoji.
export const QUICK_REACTIONS = ['👍', '❤️', '😄', '😂', '🔥'];

// Render a reaction/quick emoji which may be a unicode emoji or a custom-emoji
// token (`<ce:name:url>`), at a compact chip size.
export function ReactionEmoji({ emoji, size = 22 }: { emoji: string; size?: number }) {
  const parts = splitCustomEmoji(emoji);
  const custom = parts.find((part) => part.type === 'custom-emoji');
  if (custom && custom.type === 'custom-emoji') {
    return <img className="reaction-emoji-img" src={custom.url} alt={`:${custom.name}:`} width={size} height={size} draggable={false} loading="lazy" decoding="async" />;
  }
  const url = emojiToTwemojiUrl(emoji);
  if (!url) return <span className="reaction-emoji-text" aria-hidden="true">{emoji}</span>;
  return <img className="reaction-emoji-img" src={url} alt={emoji} width={size} height={size} draggable={false} loading="lazy" decoding="async" />;
}

// A plain-text preview of a message body for quote bars: custom-emoji tokens
// collapse to their `:shortcode:` and the text is trimmed to one line.
function previewText(body: string, imageData: string | null, imageName: string | null): string {
  let text = expandCustomEmojiShortcodes(body || '');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text && isVideoCircleAttachment(imageData, imageName)) return '📹';
  if (!text && isVoiceAttachment(imageData, imageName)) return '🎤';
  if (!text && imageName) return '📷';
  if (!text) return '📷';
  return text;
}

function deletedPreview(language: Language) {
  return language === 'ru' ? 'Сообщение удалено' : 'Message deleted';
}

// Small "replying to" quote rendered above a message bubble. Mirrors Discord's
// inline reply indicator.
export function ReplyQuote({ reply, resolveName, onJump }: { reply: MessageReplySnippet; resolveName: (userId: string) => string; onJump?: (messageId: string) => void }) {
  const deleted = Boolean(reply.deletedAt);
  const hasVoice = !deleted && isVoiceAttachment(reply.imageData, reply.imageName);
  const hasVideoCircle = !deleted && isVideoCircleAttachment(reply.imageData, reply.imageName);
  const authorName = reply.senderGroup?.name || resolveName(reply.senderId);
  return (
    <div className={hasVoice || hasVideoCircle ? 'message-reply-quote has-media' : 'message-reply-quote'}>
      <button type="button" className="message-reply-jump" onClick={() => onJump?.(reply.id)}>
        <svg className="message-reply-corner" width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden="true">
          <path d="M21 2H8a5 5 0 0 0-5 5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="message-reply-author">{authorName}</span>
        <span className="message-reply-text"><MessagePreviewText text={deleted ? deletedPreview('ru' as Language) : previewText(reply.body, reply.imageData, reply.imageName)} size={17} /></span>
      </button>
      {hasVideoCircle && reply.imageData ? (
        <div className="message-reply-media">
          <VideoCircleMessagePlayer src={reply.imageData} senderName={authorName} />
        </div>
      ) : hasVoice && reply.imageData ? (
        <div className="message-reply-media">
          <VoiceMessagePlayer src={reply.imageData} senderName={authorName} />
        </div>
      ) : null}
    </div>
  );
}

// A styled "Forwarded" card (Discord-style) shown in place of a raw
// "Forwarded from X:" text line. The forwarded content is passed in as a
// rendered node so each chat surface can reuse its own MessageText pipeline.
export function ForwardedCard({ senderName, language, children }: { senderName: string; language: Language; children: React.ReactNode }) {
  return (
    <div className="message-forward-card">
      <div className="message-forward-head">
        <svg className="message-forward-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 17 20 12 15 7" />
          <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
        </svg>
        <span className="message-forward-label">{t(language, 'forwardedFrom')}</span>
        <span className="message-forward-author">{senderName}</span>
      </div>
      <div className="message-forward-body">{children}</div>
    </div>
  );
}

// The "edit-style" bar shown above the composer while composing a reply. Shows
// the author + a short snippet and a cancel button.
export function ReplyComposerBar({ reply, resolveName, onCancel, language }: { reply: MessageReplySnippet; resolveName: (userId: string) => string; onCancel: () => void; language: Language }) {
  const authorName = reply.senderGroup?.name || resolveName(reply.senderId);
  return (
    <div className="reply-composer-bar">
      <div className="reply-composer-info">
        <span className="reply-composer-label">{t(language, 'reply')}</span>
        <span className="reply-composer-author">{authorName}</span>
        <span className="reply-composer-text"><MessagePreviewText text={reply.deletedAt ? deletedPreview(language) : previewText(reply.body, reply.imageData, reply.imageName)} size={16} /></span>
      </div>
      <button type="button" className="reply-composer-cancel" aria-label={t(language, 'cancel')} onClick={onCancel}>✕</button>
    </div>
  );
}

export type ForwardTarget =
  | { kind: 'user'; id: string; name: string; avatar: string }
  | { kind: 'group'; id: string; name: string; avatar: string };

// Centered "Forward to" modal (Discord-style): a search box, a multi-select
// list of recent chats + friends + groups, an optional caption with emoji, and
// a Send button. Calls onSend with the selected targets and the caption.
export function ForwardModal({
  language,
  currentUser,
  token,
  conversations,
  friends,
  groups,
  onClose,
  onSend
}: {
  language: Language;
  currentUser: PublicUser;
  token: string;
  conversations: { user: PublicUser }[];
  friends: PublicUser[];
  groups: Group[];
  onClose: () => void;
  onSend: (targets: ForwardTarget[], caption: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLInputElement | null>(null);

  // Build the candidate target list: conversation partners + friends + groups,
  // de-duplicated, users before groups.
  const targets = useMemo<ForwardTarget[]>(() => {
    const seen = new Set<string>();
    const list: ForwardTarget[] = [];
    const addUser = (user: PublicUser) => {
      const key = `user:${user.id}`;
      if (user.id === currentUser.id || seen.has(key)) return;
      seen.add(key);
      list.push({ kind: 'user', id: user.id, name: user.nickname, avatar: user.avatarData });
    };
    conversations.forEach((c) => addUser(c.user));
    friends.forEach((f) => addUser(f));
    groups.forEach((g) => {
      const key = `group:${g.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ kind: 'group', id: g.id, name: g.name, avatar: g.avatarData });
    });
    return list;
  }, [conversations, friends, groups, currentUser.id]);

  const normalized = query.trim().toLowerCase();
  const visible = useMemo(
    () => (normalized ? targets.filter((target) => target.name.toLowerCase().includes(normalized)) : targets),
    [targets, normalized]
  );

  const toggle = (target: ForwardTarget) => {
    const key = `${target.kind}:${target.id}`;
    setSelected((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  };

  const selectedTargets = useMemo(
    () => targets.filter((target) => selected.includes(`${target.kind}:${target.id}`)),
    [targets, selected]
  );

  function send() {
    if (selectedTargets.length === 0) return;
    onSend(selectedTargets, expandCustomEmojiShortcodes(caption.trim()));
    onClose();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="forward-modal-backdrop" onMouseDown={onClose}>
      <div className="forward-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="forward-modal-header">
          <strong>{t(language, 'forwardTo')}</strong>
          <button type="button" className="forward-modal-close" aria-label={t(language, 'close')} onClick={onClose}>✕</button>
        </div>

        <input
          className="text-field forward-search"
          autoFocus
          value={query}
          placeholder={t(language, 'forwardSearch')}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="forward-target-list">
          {visible.length === 0 ? (
            <div className="gif-status">{t(language, 'forwardNoTargets')}</div>
          ) : (
            visible.map((target) => {
              const key = `${target.kind}:${target.id}`;
              const isSelected = selected.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={isSelected ? 'forward-target selected' : 'forward-target'}
                  onClick={() => toggle(target)}
                >
                  <img className="forward-target-avatar" src={target.avatar} alt="" draggable={false} />
                  <span className="forward-target-name">{target.name}</span>
                  {target.kind === 'group' ? <span className="forward-target-badge">#</span> : null}
                  <span className={isSelected ? 'forward-check checked' : 'forward-check'} aria-hidden="true">
                    {isSelected ? '✓' : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="forward-compose">
          <div className="emoji-input-shell">
            <input
              ref={captionRef}
              className="emoji-inline-input"
              value={caption}
              placeholder={t(language, 'forwardCaption')}
              onChange={(event) => setCaption(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); send(); } }}
            />
            <div ref={emojiAnchorRef} className="emoji-host inline">
              <button type="button" className="emoji-toggle inline" aria-label={t(language, 'emoji')}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setEmojiOpen((value) => !value); }}>
                <EmojiToggleIcon />
              </button>
              {emojiOpen ? (
                <EmojiPicker
                  language={language}
                  anchorRef={emojiAnchorRef}
                  placement="top-end"
                  onSelect={(emoji) => { setCaption((current) => current + emoji); captionRef.current?.focus(); }}
                  onClose={() => setEmojiOpen(false)}
                  token={token}
                  currentUser={currentUser}
                />
              ) : null}
            </div>
          </div>
          <button type="button" className="primary-action forward-send" disabled={selectedTargets.length === 0} onClick={send}>
            {t(language, 'forwardSend')}{selectedTargets.length > 0 ? ` (${selectedTargets.length})` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Icons for the right-click context menu action buttons ──
// Reply and Forward mirror the inline SVGs that already live in the message
// hover toolbars (MessengerWindow.tsx / GroupChatView.tsx). Pin and Delete use
// the same CSS-mask silhouette technique as the chat compose icons so they
// automatically pick up the active theme color.
const PIN_ICON_URL = assetUrl('Emoji/pin-filled.svg');
const DELETE_ICON_URL = assetUrl('Emoji/delete.svg');
const EDIT_ICON_URL = assetUrl('Emoji/edit.svg');
const TRANSLATE_ICON_URL = assetUrl('Emoji/translate.svg');
// Clipboard action icons (sourced from the Img set, served from public/Emoji).
// They use the same CSS-mask silhouette technique so they inherit the theme
// color in the context menus.
const COPY_ICON_URL = assetUrl('Emoji/copy.svg');
const CUT_ICON_URL = assetUrl('Emoji/cut.svg');
const PASTE_ICON_URL = assetUrl('Emoji/paste.svg');

function maskStyle(url: string, scale = 100): React.CSSProperties {
  const size = `${scale}%`;
  return {
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: size,
    maskImage: `url("${url}")`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: size
  } as React.CSSProperties;
}

export function MenuReplyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export function MenuForwardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

export function MenuPinIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(PIN_ICON_URL, 110) }}
      aria-hidden="true"
    />
  );
}

export function MenuDeleteIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(DELETE_ICON_URL, 110) }}
      aria-hidden="true"
    />
  );
}

export function MenuEditIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(EDIT_ICON_URL, 110) }}
      aria-hidden="true"
    />
  );
}

export function MenuTranslateIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(TRANSLATE_ICON_URL, 100) }}
      aria-hidden="true"
    />
  );
}

export function MenuCopyIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(COPY_ICON_URL, 92) }}
      aria-hidden="true"
    />
  );
}

export function MenuCutIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(CUT_ICON_URL, 104) }}
      aria-hidden="true"
    />
  );
}

export function MenuPasteIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="menu-action-icon"
      style={{ width: size, height: size, ...maskStyle(PASTE_ICON_URL, 100) }}
      aria-hidden="true"
    />
  );
}
