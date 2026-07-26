import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

type WindowFrameProps = {
  language: Language;
  title: string;
  titleContent?: ReactNode;
  /** Optional element (e.g. avatar) shown centered next to the title. */
  centerTitle?: ReactNode;
  className?: string;
  style?: CSSProperties;
  maximized: boolean;
  minimized?: boolean;
  zIndex: number;
  defaultPosition?: { x: number; y: number };
  minSize?: { width: number; height: number };
  defaultSize?: { width: number; height: number };
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
  const maxX = Math.max(bounds.left + 8, bounds.left + bounds.width - winW - 8);
  const maxY = Math.max(bounds.top + 8, bounds.top + bounds.height - winH - 58);
  const x = Math.max(bounds.left + 8, Math.min(maxX, cx));
  const y = Math.max(bounds.top + 8, Math.min(maxY, cy));
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
  // Maximum usable area inside the desktop.
  const maxWidth = Math.max(0, bounds.width - 16);
  const maxHeight = Math.max(0, bounds.height - 80);
  // The effective minimum can never exceed the available area, otherwise a
  // window keeps a min size larger than the (shrunken) app window and overflows.
  const minWidth = Math.min(minSize.width, maxWidth);
  const minHeight = Math.min(minSize.height, maxHeight);
  return {
    width: Math.max(minWidth, Math.min(maxWidth, size.width)),
    height: Math.max(minHeight, Math.min(maxHeight, size.height))
  };
}

export function WindowFrame({
  language,
  title,
  titleContent,
  centerTitle,
  className,
  style,
  maximized,
  minimized = false,
  zIndex,
  defaultPosition = { x: 120, y: 72 },
  minSize = { width: 360, height: 240 },
  defaultSize,
  storageKey,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose,
  children
}: WindowFrameProps) {
  const frameRef = useRef<HTMLElement | null>(null);
  // Last known desktop area, used to compute how much the app window shrank or
  // grew between two resize events so inner windows can follow that delta 1:1.
  const prevBoundsRef = useRef<{ width: number; height: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(`notoc.window.${storageKey}`);
        if (stored) {
          const parsed = JSON.parse(stored) as { width: number; height: number };
          return clampSize(parsed, minSize);
        }
      } catch { /* use the default size */ }
    }
    return defaultSize ? clampSize(defaultSize, minSize) : null;
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

  // Make inner windows track the application window when it is resized: when the
  // app (desktop area) shrinks or grows by N pixels, each open window changes
  // its size by exactly the same N pixels (per axis), so windows scale 1:1 with
  // the app frame. The result is then clamped so a window never drops below its
  // min size or overflows the available area, and its position is pulled back
  // inside the desktop bounds.
  useEffect(() => {
    // Seed the previous-bounds baseline on mount so the first resize computes a
    // correct delta rather than treating the whole area as the change.
    if (!prevBoundsRef.current) {
      const initial = getDesktopBounds();
      prevBoundsRef.current = { width: initial.width, height: initial.height };
    }

    function handleViewportResize() {
      const bounds = getDesktopBounds();
      const prev = prevBoundsRef.current ?? { width: bounds.width, height: bounds.height };
      // How much the app window changed since the last event (negative = shrank).
      const deltaW = bounds.width - prev.width;
      const deltaH = bounds.height - prev.height;
      prevBoundsRef.current = { width: bounds.width, height: bounds.height };

      setSize((current) => {
        // Even windows without an explicit stored size adopt one now so they can
        // follow the app frame; base it on the rendered frame, falling back to
        // the min size.
        const baseW = current?.width ?? frameRef.current?.offsetWidth ?? minSize.width;
        const baseH = current?.height ?? frameRef.current?.offsetHeight ?? minSize.height;
        const next = clampSize({ width: baseW + deltaW, height: baseH + deltaH }, minSize);
        if (current && next.width === current.width && next.height === current.height) return current;
        return next;
      });

      setPosition((current) => {
        const winW = (size?.width ?? minSize.width) + deltaW;
        const winH = (size?.height ?? minSize.height) + deltaH;
        const maxX = bounds.left + bounds.width - Math.min(winW, bounds.width - 16) - 8;
        const maxY = bounds.top + bounds.height - 160;
        const x = Math.max(bounds.left + 8, Math.min(maxX, current.x));
        const y = Math.max(bounds.top + 8, Math.min(maxY, current.y));
        if (x === current.x && y === current.y) return current;
        return { x, y };
      });
    }
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [minSize, size?.width, size?.height]);

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
        <div className="window-frame-title-slot">
          {titleContent}
        </div>
        <div className="window-frame-center-title">
          {centerTitle ?? <span>{title}</span>}
        </div>
        <div className="internal-window-controls">
          <button className="icon-action" type="button" aria-label={t(language, 'minimize')} onClick={onMinimize}>
            <span className="window-control-icon minimize" aria-hidden="true" />
          </button>
          <button className="icon-action" type="button" aria-label={t(language, 'maximize')} onClick={onToggleMaximize}>
            □
          </button>
          <button className="icon-action danger-text" type="button" aria-label={t(language, 'close')} onClick={onClose}>
            <span className="window-control-icon close" aria-hidden="true" />
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
