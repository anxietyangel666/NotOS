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
  onDetach?: () => void;
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
 * Relative to the desktop container coordinate system (top: 0 is right beneath the titlebar).
 */
function centeredPosition(
  hint: { x: number; y: number },
  minSize: { width: number; height: number },
  storedSize: { width: number; height: number } | null
): { x: number; y: number } {
  const bounds = getDesktopBounds();
  const winW = storedSize?.width ?? minSize.width;
  const winH = storedSize?.height ?? minSize.height;
  const cx = Math.max(0, Math.round((bounds.width - winW) / 2));
  const cy = Math.max(0, Math.round((bounds.height - winH) / 2));
  const maxX = Math.max(0, bounds.width - winW);
  const maxY = Math.max(0, bounds.height - winH - 48);
  const x = Math.max(0, Math.min(maxX, cx));
  const y = Math.max(0, Math.min(maxY, cy));
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
  const minWidth = Math.min(minSize.width, maxWidth);
  const minHeight = Math.min(minSize.height, maxHeight);
  return {
    width: Math.max(minWidth, Math.min(maxWidth, size.width)),
    height: Math.max(minHeight, Math.min(maxHeight, size.height))
  };
}

/** Compute a scale factor between 0.82 and 1.45 based on window dimensions. */
function computeWindowScale(width: number, height: number): number {
  if (!width || !height) return 1;
  const widthRatio = width / 1050;
  const heightRatio = height / 700;
  const blend = widthRatio * 0.7 + heightRatio * 0.3;
  const raw = 0.65 + blend * 0.35;
  return Math.min(1.45, Math.max(0.82, Math.round(raw * 100) / 100));
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
  onDetach,
  children
}: WindowFrameProps) {
  const frameRef = useRef<HTMLElement | null>(null);
  const prevBoundsRef = useRef<{ width: number; height: number } | null>(null);
  const [windowScale, setWindowScale] = useState(1);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = (w?: number, h?: number) => {
      const width = w ?? el.offsetWidth;
      const height = h ?? el.offsetHeight;
      if (width && height) {
        const scale = computeWindowScale(width, height);
        setWindowScale(scale);
        el.style.setProperty('--win-scale', String(scale));
        el.style.setProperty('--win-font-scale', String(scale));
      }
    };
    update();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        update(width, height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maximized]);
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
    document.body.classList.add('window-dragging');

    function move(event: MouseEvent) {
      const bounds = getDesktopBounds();
      // Relative to desktop container; allow dragging all the way to top boundary (0)
      const minX = 0;
      const minY = 0;
      const maxX = Math.max(0, bounds.width - minSize.width);
      const maxY = Math.max(0, bounds.height - 48);
      setPosition({
        x: Math.max(minX, Math.min(maxX, currentDrag.baseX + event.clientX - currentDrag.startX)),
        y: Math.max(minY, Math.min(maxY, currentDrag.baseY + event.clientY - currentDrag.startY))
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
  }, [drag, maximized, minSize.width]);

  useEffect(() => {
    if (!resize || maximized) return;
    const currentResize = resize;
    document.body.classList.add('window-dragging');

    function move(event: MouseEvent) {
      const bounds = getDesktopBounds();
      setSize({
        width: Math.max(minSize.width, Math.min(bounds.width - position.x, currentResize.baseWidth + event.clientX - currentResize.startX)),
        height: Math.max(minSize.height, Math.min(bounds.height - position.y - 48, currentResize.baseHeight + event.clientY - currentResize.startY))
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

  useEffect(() => {
    if (!prevBoundsRef.current) {
      const initial = getDesktopBounds();
      prevBoundsRef.current = { width: initial.width, height: initial.height };
    }

    function handleViewportResize() {
      const bounds = getDesktopBounds();
      const prev = prevBoundsRef.current ?? { width: bounds.width, height: bounds.height };
      const deltaW = bounds.width - prev.width;
      const deltaH = bounds.height - prev.height;
      prevBoundsRef.current = { width: bounds.width, height: bounds.height };

      setSize((current) => {
        const baseW = current?.width ?? frameRef.current?.offsetWidth ?? minSize.width;
        const baseH = current?.height ?? frameRef.current?.offsetHeight ?? minSize.height;
        const next = clampSize({ width: baseW + deltaW, height: baseH + deltaH }, minSize);
        if (current && next.width === current.width && next.height === current.height) return current;
        return next;
      });

      setPosition((current) => {
        const winW = (size?.width ?? minSize.width) + deltaW;
        const maxX = Math.max(0, bounds.width - Math.min(winW, bounds.width));
        const maxY = Math.max(0, bounds.height - 48);
        const x = Math.max(0, Math.min(maxX, current.x));
        const y = Math.max(0, Math.min(maxY, current.y));
        if (x === current.x && y === current.y) return current;
        return { x, y };
      });
    }
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [minSize, size?.width, size?.height]);

  const windowStyle: CSSProperties = maximized
    ? {
        ...style,
        zIndex,
        ['--win-scale' as any]: windowScale,
        ['--win-font-scale' as any]: windowScale
      }
    : {
        ...style,
        left: position.x,
        top: position.y,
        zIndex,
        ['--win-scale' as any]: windowScale,
        ['--win-font-scale' as any]: windowScale,
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
            const restoredX = Math.max(0, Math.min(bounds.width - minSize.width, event.clientX - bounds.left - restoredWidth / 2));
            const restoredY = 0;
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
          {onDetach ? (
            <button
              className="icon-action detach-window-btn"
              type="button"
              aria-label={t(language, 'detachWindow')}
              title={t(language, 'detachWindow')}
              onClick={(event) => {
                event.stopPropagation();
                onDetach();
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          ) : null}
          <button className="icon-action btn-minimize" type="button" aria-label={t(language, 'minimize')} onClick={onMinimize}>
            <span className="window-control-icon minimize" aria-hidden="true" />
          </button>
          <button className="icon-action btn-maximize" type="button" aria-label={t(language, 'maximize')} onClick={onToggleMaximize}>
            □
          </button>
          <button className="icon-action danger-text btn-close" type="button" aria-label={t(language, 'close')} onClick={onClose}>
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
