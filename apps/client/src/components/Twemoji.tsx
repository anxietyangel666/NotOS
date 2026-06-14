import { useRef, useCallback } from 'react';
import { emojiToTwemojiUrl, splitEmojiText } from '../utils/emoji';
import { getEmojiName } from '../utils/emoji-data';
import { showEmojiTooltip } from './EmojiTooltip';

export function Twemoji({ emoji, size = 20 }: { emoji: string; size?: number }) {
  const url = emojiToTwemojiUrl(emoji);
  const name = getEmojiName(emoji);
  const timerRef = useRef<number | null>(null);

  const show = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    timerRef.current = window.setTimeout(() => {
      showEmojiTooltip({ emoji, name, x: rect.left + rect.width / 2, y: rect.top - 38 });
    }, 400);
  }, [emoji, name]);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    showEmojiTooltip(null);
  }, []);

  if (!url) return <span>{emoji}</span>;
  return (
    <img src={url} alt={emoji} draggable={false}
      onMouseEnter={show} onMouseLeave={hide}
      style={{ width: size, height: size, verticalAlign: 'middle', display: 'inline-block', cursor: 'default' }} />
  );
}

export function MessageText({ text }: { text: string }) {
  const parts = splitEmojiText(text);
  if (parts.length === 1 && parts[0].type === 'text') {
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'emoji' ? (
          <Twemoji key={i} emoji={part.value} />
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );
}
