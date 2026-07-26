import { useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type EmojiTooltipOptions = {
  name: string;
  imageSrc?: string;
  emoji?: string;
  delayMs?: number;
};

export function useEmojiTooltip({ name, imageSrc, emoji, delayMs = 1000 }: EmojiTooltipOptions): {
  triggerProps: Pick<HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave' | 'onMouseMove'>;
  tooltip: ReactNode;
} {
  const timerRef = useRef<number | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function hide() {
    clearTimer();
    setPos(null);
  }

  function show(event: MouseEvent<HTMLElement>) {
    clearTimer();
    cursorRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = window.setTimeout(() => {
      const cursor = cursorRef.current;
      if (!cursor) return;
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - 8, cursor.x + 14)),
        y: Math.max(24, Math.min(window.innerHeight - 24, cursor.y))
      });
    }, delayMs);
  }

  function move(event: MouseEvent<HTMLElement>) {
    cursorRef.current = { x: event.clientX, y: event.clientY };
    if (pos) {
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - 8, event.clientX + 14)),
        y: Math.max(24, Math.min(window.innerHeight - 24, event.clientY))
      });
    }
  }

  const tooltip = pos
    ? createPortal(
        <div className="emoji-tooltip" style={{ left: pos.x, top: pos.y }} role="tooltip">
          <span className="emoji-tooltip-preview" aria-hidden="true">
            {imageSrc ? <img src={imageSrc} alt="" draggable={false} /> : <span>{emoji}</span>}
          </span>
          <span className="emoji-tooltip-name">{name}</span>
        </div>,
        document.body
      )
    : null;

  return {
    triggerProps: {
      onMouseEnter: show,
      onMouseLeave: hide,
      onMouseMove: move
    },
    tooltip
  };
}

export function showEmojiTooltip(_data: unknown): void {
  // Compatibility no-op for older imports.
}
