import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { UserName } from './UserName';

type MediaLightboxProps = {
  language?: Language;
  src: string;
  name: string;
  items?: MediaLightboxItem[];
  initialIndex?: number;
  onNavigate?: () => void;
  onSenderClick?: (item: MediaLightboxItem, anchorRect: { left: number; top: number; right: number; bottom: number } | null) => void;
  onClose: () => void;
};

type Point = { x: number; y: number };
export type MediaLightboxItem = {
  src: string;
  name: string;
  senderName?: string;
  senderUser?: PublicUser;
  createdAt?: string;
};

function safeFileName(value: string) {
  const base = value.trim() || 'image';
  return base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 160);
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function imageSourceToPngBlob(src: string) {
  const response = await fetch(src);
  const blob = await response.blob();
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ?? blob;
  } catch {
    return blob;
  }
}

export async function copyImageToClipboard(src: string) {
  if (window.notoc?.copyImageToClipboard) {
    const dataUrl = src.startsWith('data:image/')
      ? src
      : await blobToDataUrl(await (await fetch(src)).blob());
    const result = await window.notoc.copyImageToClipboard(dataUrl);
    if (result?.ok) return;
  }
  const blob = await imageSourceToPngBlob(src);
  const type = blob.type || 'image/png';
  const clipboardItem = new ClipboardItem({ [type]: blob });
  await navigator.clipboard.write([clipboardItem]);
}

export function downloadImage(src: string, name: string) {
  const anchor = document.createElement('a');
  anchor.href = src;
  anchor.download = safeFileName(name || 'image');
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function MediaLightbox({ language = 'en', src, name, items, initialIndex = 0, onNavigate, onSenderClick, onClose }: MediaLightboxProps) {
  const list = items?.length ? items : [{ src, name }];
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, list.length - 1)));
  const active = list[index] ?? list[0] ?? { src, name };
  const [naturalSize, setNaturalSize] = useState({ src: '', width: 0, height: 0 });
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; pan: Point } | null>(null);

  useEffect(() => {
    const handleResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const handlePointerDown = () => setMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') showPrevious();
      if (event.key === 'ArrowRight') showNext();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [list.length, onClose]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNaturalSize({ src: '', width: 0, height: 0 });
  }, [active.src]);

  function showPrevious() {
    onNavigate?.();
    setIndex((current) => (list.length > 1 ? (current - 1 + list.length) % list.length : current));
  }

  function showNext() {
    onNavigate?.();
    setIndex((current) => (list.length > 1 ? (current + 1) % list.length : current));
  }

  function formatCreatedAt(value?: string) {
    if (!value) return '';
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  const displaySize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return { width: 640, height: 420 };
    const maxWidth = Math.max(280, viewport.width - 96);
    const maxHeight = Math.max(220, viewport.height - 150);
    const fitScale = Math.min(maxWidth / naturalSize.width, maxHeight / naturalSize.height);
    // Discord-like viewer sizing: large media is fitted to the viewport, while
    // tiny GIFs are enlarged enough to be useful without becoming excessively blurry.
    const usefulScale = Math.max(1, Math.min(2, 640 / Math.max(naturalSize.width, naturalSize.height)));
    const scale = Math.min(fitScale, usefulScale);
    return {
      width: Math.max(1, Math.round(naturalSize.width * scale)),
      height: Math.max(1, Math.round(naturalSize.height * scale))
    };
  }, [naturalSize, viewport]);
  const activeImageReady = naturalSize.src === active.src && naturalSize.width > 0 && naturalSize.height > 0;

  function setZoomLevel(next: number) {
    const value = clampZoom(next);
    setZoom(value);
    if (value === 1) setPan({ x: 0, y: 0 });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoomLevel(zoom * (event.deltaY < 0 ? 1.18 : 0.85));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.pan.x + event.clientX - drag.x,
      y: drag.pan.y + event.clientY - drag.y
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLImageElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  return createPortal(
    <div className="media-lightbox" role="dialog" aria-modal="true" aria-label={active.name} onClick={onClose} onWheel={handleWheel}>
      <div className="media-lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoomLevel(zoom / 1.25)}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoomLevel(zoom * 1.25)}>+</button>
        <button type="button" className="media-lightbox-close" aria-label={t(language, 'close')} onClick={onClose}>×</button>
      </div>
      {list.length > 1 ? (
        <>
          <button type="button" className="media-lightbox-nav media-lightbox-prev" aria-label="Previous" onClick={(event) => { event.stopPropagation(); showPrevious(); }}>‹</button>
          <button type="button" className="media-lightbox-nav media-lightbox-next" aria-label="Next" onClick={(event) => { event.stopPropagation(); showNext(); }}>›</button>
        </>
      ) : null}
      <div className="media-lightbox-stage">
        <img
          src={active.src}
          alt={active.name}
          draggable={false}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setZoomLevel(zoom > 1 ? 1 : 2);
          }}
          onLoad={(event) => setNaturalSize({
            src: active.src,
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight
          })}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            width: displaySize.width,
            height: displaySize.height,
            visibility: activeImageReady ? 'visible' : 'hidden',
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            cursor: zoom > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'zoom-in'
          }}
        />
      </div>
      <button
        type="button"
        className="media-lightbox-download"
        aria-label={language === 'ru' ? 'Скачать' : 'Download'}
        title={language === 'ru' ? 'Скачать' : 'Download'}
        onClick={(event) => {
          event.stopPropagation();
          downloadImage(active.src, active.name);
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      </button>
      {menu ? (
        <div className="context-menu media-lightbox-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { void copyImageToClipboard(active.src); setMenu(null); }}>
            {language === 'ru' ? 'Копировать изображение' : 'Copy image'}
          </button>
        </div>
      ) : null}
      <div className="media-lightbox-info" onClick={(event) => event.stopPropagation()}>
        <span>{index + 1} / {list.length}</span>
        {active.senderName ? (
          <div>
            {onSenderClick ? (
              <button
                type="button"
                className="media-lightbox-sender"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  onSenderClick(active, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
                }}
              >
                {active.senderUser ? <UserName user={active.senderUser} as="strong" /> : <strong>{active.senderName}</strong>}
              </button>
            ) : active.senderUser ? (
              <UserName user={active.senderUser} as="strong" />
            ) : (
              <strong>{active.senderName}</strong>
            )}
            {active.createdAt ? <time>{formatCreatedAt(active.createdAt)}</time> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
