import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { emojiToTwemojiUrl } from '../utils/emoji';

type TooltipData = { emoji: string; name: string; x: number; y: number } | null;

let showTooltipFn: ((data: TooltipData) => void) | null = null;

export function showEmojiTooltip(data: TooltipData): void {
  showTooltipFn?.(data);
}

export function EmojiTooltipPortal() {
  const [data, setData] = useState<TooltipData>(null);

  const show = useCallback((d: TooltipData) => setData(d), []);
  useEffect(() => { showTooltipFn = show; return () => { showTooltipFn = null; }; }, [show]);
  useEffect(() => {
    if (!data) return;
    const h = () => setData(null);
    window.addEventListener('scroll', h, true);
    return () => window.removeEventListener('scroll', h, true);
  }, [data]);

  if (!data) return null;
  const url = emojiToTwemojiUrl(data.emoji);
  return createPortal(
    <div className="emoji-tooltip" style={{ top: data.y, left: data.x }}>
      {url ? (
        <img src={url} alt="" draggable={false}
          style={{ width: 20, height: 20, display: 'inline-block' }} />
      ) : null}
      <span>{data.name}</span>
    </div>,
    document.body
  );
}
