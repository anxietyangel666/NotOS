import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';

type NameplateCropperProps = {
  imageDataUrl: string;
  language: Language;
  /** Aspect ratio (width / height) of the crop region. Defaults to the nameplate banner ratio. */
  aspect?: number;
  onCancel: () => void;
  onApply: (imageData: string) => void;
};

// Visible stage width used for translating drag offsets to canvas pixels.
const STAGE_WIDTH = 360;

// Crops the chosen rectangular region of the source image into a banner-shaped
// PNG that fills the nameplate area. The preview and the canvas use the exact
// same geometry so what the user sees is what gets saved.
async function cropNameplate(
  imageDataUrl: string,
  natW: number,
  natH: number,
  aspect: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
  stageWidth: number,
  stageHeight: number
) {
  const image = new Image();
  image.src = imageDataUrl;
  await image.decode();

  const outWidth = 600;
  const outHeight = Math.round(outWidth / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext('2d');
  if (!context) return imageDataUrl;

  context.clearRect(0, 0, outWidth, outHeight);

  // The preview scales the image to cover the stage, then applies the zoom.
  const coverScale = Math.max(stageWidth / natW, stageHeight / natH);
  const previewW = natW * coverScale * zoom;
  const previewH = natH * coverScale * zoom;
  const previewX = (stageWidth - previewW) / 2 + offsetX;
  const previewY = (stageHeight - previewH) / 2 + offsetY;

  // Map preview pixels -> canvas pixels with a single uniform factor.
  const k = outWidth / stageWidth;
  context.drawImage(image, previewX * k, previewY * k, previewW * k, previewH * k);

  return canvas.toDataURL('image/png');
}

export function NameplateCropper({ imageDataUrl, language, aspect = 3, onCancel, onApply }: NameplateCropperProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Natural (intrinsic) dimensions of the source image, loaded once.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  const stageHeight = Math.round(STAGE_WIDTH / aspect);

  // Load the image to learn its intrinsic size so the preview matches the canvas.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => { if (!cancelled) setNat({ w: image.naturalWidth, h: image.naturalHeight }); };
    image.src = imageDataUrl;
    return () => { cancelled = true; };
  }, [imageDataUrl]);

  // The displayed image size inside the stage: cover-fit, then user zoom.
  const coverScale = nat ? Math.max(STAGE_WIDTH / nat.w, stageHeight / nat.h) : 1;
  const dispW = nat ? nat.w * coverScale * zoom : STAGE_WIDTH;
  const dispH = nat ? nat.h * coverScale * zoom : stageHeight;

  // Clamp the offset so the image always fully covers the stage (no black gaps).
  function clamp(x: number, y: number) {
    const maxX = Math.max(0, (dispW - STAGE_WIDTH) / 2);
    const maxY = Math.max(0, (dispH - stageHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    };
  }

  // Re-clamp whenever zoom changes so the image never leaves a black edge.
  useEffect(() => {
    setOffset((o) => clamp(o.x, o.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, nat]);

  useEffect(() => {
    if (!drag) return;
    const currentDrag = drag;
    function move(event: MouseEvent) {
      setOffset(clamp(currentDrag.baseX + event.clientX - currentDrag.startX, currentDrag.baseY + event.clientY - currentDrag.startY));
    }
    function up() { setDrag(null); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, dispW, dispH]);

  async function applyCrop() {
    if (!nat) return;
    setBusy(true);
    try {
      onApply(await cropNameplate(imageDataUrl, nat.w, nat.h, aspect, zoom, offset.x, offset.y, STAGE_WIDTH, stageHeight));
    } finally {
      setBusy(false);
    }
  }

  // Position the image by explicit pixel size + top/left so the preview is an
  // exact 1:1 representation of what the canvas will draw.
  const imgLeft = (STAGE_WIDTH - dispW) / 2 + offset.x;
  const imgTop = (stageHeight - dispH) / 2 + offset.y;

  return createPortal(
    <div className="modal-backdrop important nameplate-crop-backdrop" onClick={onCancel}>
      <section className="avatar-crop-window" onClick={(event) => event.stopPropagation()}>
        <div className="window-header">
          <div>
            <p className="eyebrow">{t(language, 'nameplate')}</p>
            <h2>{t(language, 'nameplateCropTitle')}</h2>
          </div>
          <button className="icon-action" type="button" onClick={onCancel}>
            x
          </button>
        </div>

        <p className="settings-hint">{t(language, 'nameplateCropHint')}</p>

        <div className="avatar-crop-stage">
          <div
            className={drag ? 'nameplate-crop-rect dragging' : 'nameplate-crop-rect'}
            style={{ width: STAGE_WIDTH, height: stageHeight }}
            onMouseDown={(event) => {
              event.preventDefault();
              setDrag({ startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y });
            }}
          >
            <img
              src={imageDataUrl}
              alt=""
              style={{ position: 'absolute', left: `${imgLeft}px`, top: `${imgTop}px`, width: `${dispW}px`, height: `${dispH}px` }}
              draggable={false}
            />
          </div>
        </div>

        <div className="crop-controls">
          <label>
            <span>{t(language, 'zoom')}</span>
            <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
        </div>

        <div className="settings-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {t(language, 'cancel')}
          </button>
          <button className="primary-action" type="button" disabled={busy || !nat} onClick={() => void applyCrop()}>
            {busy ? t(language, 'saving') : t(language, 'apply')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
