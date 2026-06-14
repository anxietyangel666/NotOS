import { useEffect, useRef, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

// The pinned card position is stored as a fraction of the viewport so it stays
// in the same relative spot when the app window is resized. Each card keeps its
// own localStorage entry keyed by its unique card id.
function posKey(cardId: string) {
  return `notoc.pinned-image-pos.${cardId}`;
}

function sizeKey(cardId: string) {
  return `notoc.pinned-image-size.${cardId}`;
}

function loadRelativePosition(cardId: string): { x: number; y: number } {
  try {
    const saved = localStorage.getItem(posKey(cardId));
    if (saved) {
      const parsed = JSON.parse(saved);
      // New format: fractional coordinates (0..1).
      if (typeof parsed.relX === 'number' && typeof parsed.relY === 'number') {
        return { x: parsed.relX * window.innerWidth, y: parsed.relY * window.innerHeight };
      }
      // Legacy format: absolute pixels.
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return { x: parsed.x, y: parsed.y };
      }
    }
  } catch {}
  return { x: 24, y: 72 };
}

function saveRelativePosition(cardId: string, pos: { x: number; y: number }) {
  localStorage.setItem(
    posKey(cardId),
    JSON.stringify({ relX: pos.x / Math.max(1, window.innerWidth), relY: pos.y / Math.max(1, window.innerHeight) })
  );
}

export type PinnedImagePlacement = { x: number; y: number; width: number; height: number };

type PinnedImageCardProps = {
  cardId: string;
  language: Language;
  imageUrl: string;
  imageName: string;
  onClose?: (cardId: string) => void;
  readOnly?: boolean;
  overridePosition?: { x: number; y: number } | null;
  overrideSize?: { width: number; height: number } | null;
  initialPlacement?: PinnedImagePlacement | null;
  onMove?: (cardId: string, placement: PinnedImagePlacement) => void;
  onMoveEnd?: (cardId: string, placement: PinnedImagePlacement) => void;
};

export function PinnedImageCard({ cardId, language, imageUrl, imageName, onClose, readOnly = false, overridePosition = null, overrideSize = null, initialPlacement = null, onMove, onMoveEnd }: PinnedImageCardProps) {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(() => {
    const loaded = initialPlacement
      ? { x: initialPlacement.x * window.innerWidth, y: initialPlacement.y * window.innerHeight }
      : loadRelativePosition(cardId);
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - 240;
    return {
      x: Math.min(Math.max(0, loaded.x), maxX),
      y: Math.min(Math.max(0, loaded.y), maxY)
    };
  });
  const [size, setSize] = useState(() => {
    if (initialPlacement) return { width: initialPlacement.width, height: initialPlacement.height };
    try {
      const saved = localStorage.getItem(sizeKey(cardId));
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed;
      }
    } catch {}
    return { width: 200, height: 160 };
  });
  const posRef = useRef(position);
  const sizeRef = useRef(size);
  const onMoveRef = useRef(onMove);
  const onMoveEndRef = useRef(onMoveEnd);

  posRef.current = position;
  sizeRef.current = size;
  onMoveRef.current = onMove;
  onMoveEndRef.current = onMoveEnd;

  const clampedPosition = {
    x: Math.min(Math.max(0, position.x), window.innerWidth - 220),
    y: Math.min(Math.max(0, position.y), window.innerHeight - 240)
  };

  function toPlacement(pos: { x: number; y: number }, dims: { width: number; height: number }): PinnedImagePlacement {
    return {
      x: pos.x / Math.max(1, window.innerWidth),
      y: pos.y / Math.max(1, window.innerHeight),
      width: dims.width,
      height: dims.height
    };
  }

  function startDrag(event: React.MouseEvent) {
    if (readOnly) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.stopPropagation();
    const startX = event.clientX, startY = event.clientY;
    const base = posRef.current;
    function move(event: MouseEvent) {
      const next = { x: Math.max(0, base.x + event.clientX - startX), y: Math.max(0, base.y + event.clientY - startY) };
      setPosition(next);
      onMoveRef.current?.(cardId, toPlacement(next, sizeRef.current));
    }
    function up() {
      saveRelativePosition(cardId, posRef.current);
      onMoveEndRef.current?.(cardId, toPlacement(posRef.current, sizeRef.current));
      window.removeEventListener('mousemove', move);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
  }

  // Keep the card in its relative spot (and broadcast it) when the app window
  // is resized, so it never ends up outside or in the wrong place.
  useEffect(() => {
    if (readOnly) return;
    function handleResize() {
      const loaded = loadRelativePosition(cardId);
      const next = {
        x: Math.min(Math.max(0, loaded.x), window.innerWidth - 220),
        y: Math.min(Math.max(0, loaded.y), window.innerHeight - 240)
      };
      setPosition(next);
      onMoveRef.current?.(cardId, toPlacement(next, sizeRef.current));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [cardId, readOnly]);

  function startResize(event: React.MouseEvent) {
    if (readOnly) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const base = sizeRef.current;
    function move(event: MouseEvent) {
      const next = { width: Math.max(120, base.width + event.clientX - startX), height: Math.max(80, base.height + event.clientY - startY) };
      setSize(next);
      onMoveRef.current?.(cardId, toPlacement(posRef.current, next));
    }
    function up() {
      localStorage.setItem(sizeKey(cardId), JSON.stringify(sizeRef.current));
      onMoveEndRef.current?.(cardId, toPlacement(posRef.current, sizeRef.current));
      window.removeEventListener('mousemove', move);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
  }

  const effectiveSize = overrideSize ?? size;
  const left = overridePosition ? `${Math.min(96, Math.max(0, overridePosition.x * 100))}%` : clampedPosition.x;
  const top = overridePosition ? `${Math.min(92, Math.max(0, overridePosition.y * 100))}%` : clampedPosition.y;

  return (
    <div className={readOnly ? 'pinned-image-card pinned-image-card--remote' : 'pinned-image-card'} style={{ left, top, width: effectiveSize.width }} onContextMenu={(event) => event.stopPropagation()}>
      <div className="pinned-image-bar" onMouseDown={readOnly ? undefined : startDrag} style={readOnly ? { cursor: 'default' } : undefined}>
        <button className="pinned-image-toggle" type="button" onClick={() => setMinimized((v) => !v)}>
          {minimized ? '\u25A1' : '_'}
        </button>
        {onClose ? <button className="pinned-image-card-close" type="button" aria-label={t(language, 'close')} onClick={() => onClose(cardId)}>x</button> : null}
      </div>
      {!minimized ? (
        <div className="pinned-image-card-img" style={{ height: effectiveSize.height }}>
          <img src={imageUrl} alt={imageName} />
        </div>
      ) : null}
      {!readOnly ? <span className="pinned-image-resize" onMouseDown={startResize} /> : null}
    </div>
  );
}
