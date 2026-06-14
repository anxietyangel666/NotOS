import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

type WindowFrameProps = {
  language: Language;
  title: string;
  eyebrow?: string;
  /** Optional element (e.g. avatar) shown centered next to the title. */
  centerTitle?: ReactNode;
  className?: string;
  style?: CSSProperties;
  maximized: boolean;
  minimized?: boolean;
  zIndex: number;
  defaultPosition?: { x: number; y: number };
  minSize?: { width: number; height: number };
  storageKey?: string;
  onFocus: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  children: ReactNode;
};

/** Returns the usable area of the NotOS desktop container, falling back to the browser viewport. */
function getDesktopBounds(): { left: number; top: number; width: number; height: number } {
  const el = document.querySelector<HTMLElement>('.desktop');
  if (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/**
 * Compute a centered, clamped initial position for a window inside the desktop.
 * `hint` is the caller-supplied default (used as the preferred size hint for centering).
 */
function centeredPosition(
  hint: { x: number; y: number },
  minSize: { width: number; height: number },
  storedSize: { width: number; height: number } | null
): { x: number; y: number } {
  const bounds = getDesktopBounds();
  const winW = storedSize?.width ?? minSize.width;
  const winH = storedSize?.height ?? minSize.height;
  // Center within the desktop area
  const cx = bounds.left + Math.round((bounds.width - winW) / 2);
  const cy = bounds.top + Math.round((bounds.height - winH) / 2);
  // Clamp so the window is always fully visible
  const x = Math.max(bounds.left + 8, Math.min(bounds.left + bounds.width - minSize.width - 8, cx));
  const y = Math.max(bounds.top + 8, Math.min(bounds.top + bounds.height - 160, cy));
  // If the hint was already a sensible centered value (caller computed it from
  // window.innerWidth) and the desktop bounds match the viewport, prefer the
  // hint so we don't fight with the caller's intent.
  void hint;
  return { x, y };
}

/** Clamp a stored size so it never exceeds the current desktop area. */
function clampSize(
  size: { width: number; height: number },
  minSize: { width: number; height: number }
): { width: number; height: number } {
  const bounds = getDesktopBounds();
  return {
    width: Math.max(minSize.width, Math.min(bounds.width - 16, size.width)),
    height: Math.max(minSize.height, Math.min(bounds.height - 80, size.height))
  };
}

export function WindowFrame({
  language,
  title,
  eyebrow,
  centerTitle,
  className,
  style,
  maximized,
  minimized = false,
  zIndex,
  defaultPosition = { x: 120, y: 72 },
  minSize = { width: 360, height: 240 },
  storageKey,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose,
  children
}: WindowFrameProps) {
  const frameRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(() => {
    if (!storageKey) return null;
    try {
      const stored = localStorage.getItem(`notoc.window.${storageKey}`);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as { width: number; height: number };
      return clampSize(parsed, minSize);
    } catch { return null; }
  });
  const [position, setPosition] = useState(() => centeredPosition(defaultPosition, minSize, size));
  const [drag, setDrag] = useState<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [resize, setResize] = useState<{ startX: number; startY: number; baseWidth: number; baseHeight: number } | null>(null);

  useEffect(() => {
    if (!drag || maximized) return;
    const currentDrag = drag;
    // Prevent the browser from selecting/highlighting page text while dragging.
    document.body.classList.add('window-dragging');

    function move(event: MouseEvent) {
      const bounds = getDesktopBounds();
      setPosition({
        x: Math.max(bounds.left + 8, Math.min(bounds.left + bounds.width - minSize.width, currentDrag.baseX + event.clientX - currentDrag.startX)),
        y: Math.max(bounds.top + 8, Math.min(bounds.top + bounds.height - 160, currentDrag.baseY + event.clientY - currentDrag.startY))
      });
    }

    function up() {
      setDrag(null);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('window-dragging');
    };
  }, [drag, maximized]);

  useEffect(() => {
    if (!resize || maximized) return;
    const currentResize = resize;
    // Prevent text selection while resizing too.
    document.body.classList.add('window-dragging');

    function move(event: MouseEvent) {
      const bounds = getDesktopBounds();
      setSize({
        width: Math.max(minSize.width, Math.min(bounds.left + bounds.width - position.x - 8, currentResize.baseWidth + event.clientX - currentResize.startX)),
        height: Math.max(minSize.height, Math.min(bounds.top + bounds.height - position.y - 58, currentResize.baseHeight + event.clientY - currentResize.startY))
      });
    }

    function up() {
      setResize(null);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('window-dragging');
    };
  }, [maximized, minSize.height, minSize.width, position.x, position.y, resize]);

  useEffect(() => {
    if (!storageKey || !size) return;
    localStorage.setItem(`notoc.window.${storageKey}`, JSON.stringify(size));
  }, [size, storageKey]);

  const windowStyle = maximized
    ? { ...style, zIndex }
    : {
        ...style,
        left: position.x,
        top: position.y,
        zIndex,
        ...(minimized ? { display: 'none' } : {}),
        ...(size ? { width: size.width, height: size.height } : {})
      };

  return (
    <section
      ref={frameRef}
      className={`window-frame ${maximized ? 'maximized' : ''} ${className ?? ''}`}
      style={windowStyle}
      onMouseDown={onFocus}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div
        className="window-frame-header"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          if (maximized) {
            const bounds = getDesktopBounds();
            const restoredWidth = size?.width ?? Math.min(760, bounds.width - 32);
            const restoredX = Math.max(bounds.left + 8, Math.min(bounds.left + bounds.width - minSize.width, event.clientX - restoredWidth / 2));
            const restoredY = bounds.top + 8;
            setPosition({ x: restoredX, y: restoredY });
            setDrag({ startX: event.clientX, startY: event.clientY, baseX: restoredX, baseY: restoredY });
            onToggleMaximize();
            return;
          }
          setDrag({ startX: event.clientX, startY: event.clientY, baseX: position.x, baseY: position.y });
        }}
      >
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {centerTitle ? <div className="window-frame-center-title">{centerTitle}</div> : null}
        <div className="internal-window-controls">
          <button className="icon-action" type="button" aria-label={t(language, 'minimize')} onClick={onMinimize}>
            -
          </button>
          <button className="icon-action" type="button" aria-label={t(language, 'maximize')} onClick={onToggleMaximize}>
            □
          </button>
          <button className="icon-action danger-text" type="button" aria-label={t(language, 'close')} onClick={onClose}>
            x
          </button>
        </div>
      </div>
      {children}
      {!maximized ? (
        <span
          className="window-resize-handle"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onFocus();
            const bounds = frameRef.current?.getBoundingClientRect();
            if (!bounds) return;
            setResize({ startX: event.clientX, startY: event.clientY, baseWidth: bounds.width, baseHeight: bounds.height });
          }}
        />
      ) : null}
    </section>
  );
}
