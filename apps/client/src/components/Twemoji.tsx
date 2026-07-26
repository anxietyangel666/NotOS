import { useState, useEffect, type MouseEvent } from 'react';
import { emojiToTwemojiUrl, splitEmojiText } from '../utils/emoji';
import { splitMediaText } from '../utils/media-url';
import { splitCustomEmoji } from '../utils/custom-emoji';
import { openExternalUrl } from '../utils/external-url';
import { gifFromUrl, isFavoriteGifUrl, toggleFavoriteGif, subscribeFavoriteGifs } from '../utils/tenor';
import { MediaLightbox } from './MediaLightbox';
import { useEmojiTooltip } from './EmojiTooltip';
import { getEmojiName } from '../utils/emoji-data';

// Inline emoji should sit at text height. Emoji-only messages are intentionally
// larger, matching Discord's "big emoji" treatment.
const CHAT_INLINE_EMOJI_SIZE = 20;
const CHAT_BIG_EMOJI_SIZE = 56;
const LINK_RE = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_LINK_PUNCT_RE = /[),.;!?]+$/;
const EMOJI_BURST_THRESHOLD = 3;
const EMOJI_BURST_WINDOW_MS = 720;
const EMOJI_BURST_COUNT = 34;
export const EMOJI_BURST_EVENT = 'notoc:emoji-burst';

export type EmojiBurstPayload =
  | { type: 'image'; src: string; label: string }
  | { type: 'text'; value: string };

export type EmojiBurstEventDetail = {
  x: number;
  y: number;
  messageId?: string;
  emojiIndex?: number;
  payload: EmojiBurstPayload;
};

const emojiBurstClicks = new Map<string, { count: number; lastAt: number }>();

type TextLinkPart =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string };

function emojiBurstAnchors(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLElement>('.custom-emoji-inline, .emoji-inline-twemoji, .emoji-inline-text'));
}

function clippedBoundsForElement(element: HTMLElement) {
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  let parent = element.parentElement;

  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
    if (/(auto|scroll|hidden|clip)/.test(overflow)) {
      const rect = parent.getBoundingClientRect();
      left = Math.max(left, rect.left);
      top = Math.max(top, rect.top);
      right = Math.min(right, rect.right);
      bottom = Math.min(bottom, rect.bottom);
      if (right <= left || bottom <= top) return null;
    }
    parent = parent.parentElement;
  }

  return { left, top, right, bottom };
}

function isElementCenterVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const bounds = clippedBoundsForElement(element);
  if (!bounds) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function resolveEmojiBurstOrigin(detail: EmojiBurstEventDetail) {
  if (!detail.messageId) return { x: detail.x, y: detail.y };
  const message = document.querySelector<HTMLElement>(`.message-bubble[data-message-id="${CSS.escape(detail.messageId)}"]`);
  if (!message) return null;
  const messageRect = message.getBoundingClientRect();
  if (messageRect.bottom <= 0 || messageRect.top >= window.innerHeight || messageRect.right <= 0 || messageRect.left >= window.innerWidth) return null;
  const anchors = emojiBurstAnchors(message);
  const anchor = typeof detail.emojiIndex === 'number' ? anchors[detail.emojiIndex] : null;
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  if (!isElementCenterVisible(anchor)) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function playEmojiBurst(detail: EmojiBurstEventDetail) {
  if (typeof document === 'undefined') return false;
  const origin = resolveEmojiBurstOrigin(detail);
  if (!origin) return false;

  for (let i = 0; i < EMOJI_BURST_COUNT; i += 1) {
    const particle = detail.payload.type === 'image' ? document.createElement('img') : document.createElement('span');
    const angle = Math.random() * Math.PI * 2;
    const distance = 92 + Math.random() * 188;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 26 - Math.random() * 88;
    const duration = 740 + Math.random() * 520;
    const size = 18 + Math.random() * 20;

    particle.className = 'emoji-confetti-particle';
    particle.setAttribute('aria-hidden', 'true');
    if (detail.payload.type === 'image') {
      const image = particle as HTMLImageElement;
      image.src = detail.payload.src;
      image.alt = detail.payload.label;
      image.draggable = false;
    } else {
      particle.textContent = detail.payload.value;
    }

    particle.style.left = `${origin.x}px`;
    particle.style.top = `${origin.y}px`;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.setProperty('--emoji-confetti-dx', `${dx}px`);
    particle.style.setProperty('--emoji-confetti-dy', `${dy}px`);
    particle.style.setProperty('--emoji-confetti-rot', `${Math.round(-260 + Math.random() * 520)}deg`);
    particle.style.setProperty('--emoji-confetti-scale', `${0.72 + Math.random() * 0.72}`);
    particle.style.setProperty('--emoji-confetti-duration', `${duration}ms`);

    document.body.appendChild(particle);
    window.setTimeout(() => particle.remove(), duration + 120);
  }

  return true;
}

function handleEmojiBurstClick(event: MouseEvent<HTMLElement>, key: string, payload: EmojiBurstPayload) {
  event.stopPropagation();

  const now = performance.now();
  const previous = emojiBurstClicks.get(key);
  const count = previous && now - previous.lastAt <= EMOJI_BURST_WINDOW_MS ? previous.count + 1 : 1;

  if (count >= EMOJI_BURST_THRESHOLD) {
    emojiBurstClicks.delete(key);
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const message = target.closest<HTMLElement>('.message-bubble[data-message-id]');
    const anchors = message ? emojiBurstAnchors(message) : [];
    const detail: EmojiBurstEventDetail = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      messageId: message?.dataset.messageId,
      emojiIndex: message ? anchors.indexOf(target) : undefined,
      payload
    };
    if (playEmojiBurst(detail)) {
      window.dispatchEvent(new CustomEvent<EmojiBurstEventDetail>(EMOJI_BURST_EVENT, { detail }));
    }
    return;
  }

  emojiBurstClicks.set(key, { count, lastAt: now });
}

function splitLinkText(text: string): TextLinkPart[] {
  const parts: TextLinkPart[] = [];
  let lastIndex = 0;
  LINK_RE.lastIndex = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trailing = raw.match(TRAILING_LINK_PUNCT_RE)?.[0] ?? '';
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    if (!url) continue;
    if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    parts.push({ type: 'link', value: url });
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

// A custom (image-based) emoji rendered inline in a chat body. The shortcode is
// used as alt text; the URL drives the image.
function CustomEmojiImg({ name, url, size = CHAT_INLINE_EMOJI_SIZE }: { name: string; url: string; size?: number }) {
  const emojiTooltip = useEmojiTooltip({ name, imageSrc: url });

  return (
    <>
      <img src={url} alt={`:${name}:`} draggable={false} loading="lazy" decoding="async"
        className="custom-emoji-inline"
        // Inline emoji can live inside clickable containers (e.g. a desktop-wall
        // message that opens the author profile on click). Swallow the click here
        // so tapping an emoji never triggers that container action.
        onMouseEnter={emojiTooltip.triggerProps.onMouseEnter}
        onMouseLeave={emojiTooltip.triggerProps.onMouseLeave}
        onMouseMove={emojiTooltip.triggerProps.onMouseMove}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => handleEmojiBurstClick(event, `custom:${name}:${url}`, { type: 'image', src: url, label: `:${name}:` })}
        style={{ width: size, height: size, verticalAlign: '-0.22em', display: 'inline-block', cursor: 'pointer' }} />
      {emojiTooltip.tooltip}
    </>
  );
}

export function Twemoji({ emoji, size = 20 }: { emoji: string; size?: number }) {
  const url = emojiToTwemojiUrl(emoji);
  const emojiTooltip = useEmojiTooltip({ name: getEmojiName(emoji), imageSrc: url ?? undefined, emoji });

  if (!url) {
    return (
      <>
        <span
          className="emoji-inline-text"
          onMouseEnter={emojiTooltip.triggerProps.onMouseEnter}
          onMouseLeave={emojiTooltip.triggerProps.onMouseLeave}
          onMouseMove={emojiTooltip.triggerProps.onMouseMove}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => handleEmojiBurstClick(event, `unicode:${emoji}`, { type: 'text', value: emoji })}
        >
          {emoji}
        </span>
        {emojiTooltip.tooltip}
      </>
    );
  }
  return (
    <>
      <img src={url} alt={emoji} draggable={false}
        className="emoji-inline-twemoji"
        onMouseEnter={emojiTooltip.triggerProps.onMouseEnter}
        onMouseLeave={emojiTooltip.triggerProps.onMouseLeave}
        onMouseMove={emojiTooltip.triggerProps.onMouseMove}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => handleEmojiBurstClick(event, `twemoji:${emoji}`, { type: 'image', src: url, label: emoji })}
        style={{ width: size, height: size, verticalAlign: 'middle', display: 'inline-block', cursor: 'pointer' }} />
      {emojiTooltip.tooltip}
    </>
  );
}

function isEmojiOnlyText(text: string): boolean {
  let emojiCount = 0;
  for (const customPart of splitCustomEmoji(text)) {
    if (customPart.type === 'custom-emoji') {
      emojiCount += 1;
      continue;
    }

    for (const unicodePart of splitEmojiText(customPart.value)) {
      if (unicodePart.type === 'emoji') {
        emojiCount += 1;
      } else if (unicodePart.value.trim()) {
        return false;
      }
    }
  }
  return emojiCount > 0;
}

// Renders plain text with unicode emoji turned into Twemoji images.
function UnicodeEmojiText({ text, emojiSize = CHAT_INLINE_EMOJI_SIZE }: { text: string; emojiSize?: number }) {
  const parts = splitEmojiText(text);
  if (parts.length === 1 && parts[0].type === 'text') {
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'emoji' ? (
          <Twemoji key={i} emoji={part.value} size={emojiSize} />
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );
}

function LinkedUnicodeText({ text, emojiSize = CHAT_INLINE_EMOJI_SIZE }: { text: string; emojiSize?: number }) {
  const parts = splitLinkText(text);
  if (parts.length === 1 && parts[0].type === 'text') {
    return <UnicodeEmojiText text={text} emojiSize={emojiSize} />;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            className="message-link"
            href={part.value}
            rel="noreferrer"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openExternalUrl(part.value);
            }}
          >
            {part.value}
          </a>
        ) : (
          <UnicodeEmojiText key={i} text={part.value} emojiSize={emojiSize} />
        )
      )}
    </>
  );
}

// Public text renderer: first pulls out custom-emoji tokens, then runs the
// remaining text through the unicode-emoji renderer.
export function MessageText({ text }: { text: string }) {
  const parts = splitCustomEmoji(text);
  const emojiSize = isEmojiOnlyText(text) ? CHAT_BIG_EMOJI_SIZE : CHAT_INLINE_EMOJI_SIZE;
  if (parts.length === 1 && parts[0].type === 'text') {
    return <LinkedUnicodeText text={text} emojiSize={emojiSize} />;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'custom-emoji' ? (
          <CustomEmojiImg key={i} name={part.name} url={part.url} size={emojiSize} />
        ) : (
          <LinkedUnicodeText key={i} text={part.value} emojiSize={emojiSize} />
        )
      )}
    </>
  );
}

// Compact, single-line renderer for list previews (e.g. the DM conversation
// list). Custom emoji render as small inline images; unicode emoji render at a
// matching small size. No media/GIF expansion happens here.
export function MessagePreviewText({ text, size = 16 }: { text: string; size?: number }) {
  const parts = splitCustomEmoji(text);
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'custom-emoji' ? (
          <CustomEmojiImg key={i} name={part.name} url={part.url} size={size} />
        ) : (
          <PreviewUnicodeText key={i} text={part.value} size={size} />
        )
      )}
    </>
  );
}

function PreviewUnicodeText({ text, size }: { text: string; size: number }) {
  const parts = splitEmojiText(text);
  if (parts.length === 1 && parts[0].type === 'text') return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'emoji' ? (
          <Twemoji key={i} emoji={part.value} size={size} />
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );
}

// Fullscreen GIF viewer rendered to <body> so it overlays any window. Mirrors
// the direct-message image viewer (same `chat-image-viewer` chrome, click-to-zoom
// and a caption) so opening a GIF on the desktop wall looks identical to opening
// one in a private chat. Closes on backdrop click or Escape.
function ChatGifViewer({ url, name = 'GIF', onClose }: { url: string; name?: string; onClose: () => void }) {
  return <MediaLightbox src={url} name={name} onClose={onClose} />;
}

// Inline GIF in a plain-text chat body: preview thumbnail, a favorite star
// overlay (synced with the GIF picker), and a click that opens the custom
// viewer instead of a browser tab.
function ChatGif({ url }: { url: string }) {
  const [favorite, setFavorite] = useState(() => isFavoriteGifUrl(url));
  const [viewerOpen, setViewerOpen] = useState(false);

  // The favorites store is the single source of truth. We never optimistically
  // flip local state on click; instead toggleFavoriteGif notifies every mounted
  // star (including duplicates of the same GIF) so they all update together and
  // in sync, with no toggle race.
  useEffect(() => subscribeFavoriteGifs(() => setFavorite(isFavoriteGifUrl(url))), [url]);

  return (
    <span className="chat-inline-gif">
      <button
        type="button"
        className="chat-inline-gif-pick"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setViewerOpen(true); }}
      >
        <img src={url} alt="GIF" loading="lazy" decoding="async" draggable={false} />
      </button>
      <button
        type="button"
        className={favorite ? 'gif-fav-star active' : 'gif-fav-star'}
        aria-pressed={favorite}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavoriteGif(gifFromUrl(url));
        }}
      >
        <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true">
          <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.56l-5.9 3.11 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z"
            fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </button>
      {viewerOpen ? <ChatGifViewer url={url} onClose={() => setViewerOpen(false)} /> : null}
    </span>
  );
}

// Renders a chat body and turns any image/GIF URLs into inline media, while
// keeping the rest of the text (and emoji) intact. Used where messages are
// plain text and GIFs are sent as raw URLs (desktop wall, temporary voice chat).
export function MessageBody({ text }: { text: string }) {
  // Pull custom-emoji tokens out first so their embedded image URL is not
  // mistaken for a standalone inline GIF by the media splitter.
  const ceParts = splitCustomEmoji(text);
  const emojiSize = isEmojiOnlyText(text) ? CHAT_BIG_EMOJI_SIZE : CHAT_INLINE_EMOJI_SIZE;
  return (
    <>
      {ceParts.map((cePart, ceIndex) => {
        if (cePart.type === 'custom-emoji') {
          return <CustomEmojiImg key={`ce-${ceIndex}`} name={cePart.name} url={cePart.url} size={emojiSize} />;
        }
        const parts = splitMediaText(cePart.value);
        return parts.map((part, i) =>
          part.type === 'media' ? (
            <ChatGif key={`${ceIndex}-${i}`} url={part.value} />
          ) : (
            <MessageText key={`${ceIndex}-${i}`} text={part.value} />
          )
        );
      })}
    </>
  );
}
